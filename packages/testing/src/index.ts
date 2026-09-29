/**
 * `@vesk/testing` — a component test harness.
 *
 * A framework whose whole pitch is "no VDOM" has to be testable without a
 * browser. Before this, testing a `.vsk` component meant either booting a server
 * and driving Chrome, or hand-rolling a DOM shim — which is why so much of this
 * repo's own suite asserts on markup strings.
 *
 * The harness is deliberately small and honest about what it covers:
 *
 *   renderComponent() — compile + SSR a `.vsk` source string and give you the
 *     HTML, so a component's server output can be asserted with no server and
 *     no browser. This is the assertion most component tests actually want.
 *   mount() — take that SSR HTML, put it in a real DOM (linkedom), and drive
 *     it: text, attributes, click, input, effects flushed. Hydration runs when
 *     the runtime can be installed in that DOM.
 *
 * Anything that genuinely needs a browser (layout, service workers, real
 * event dispatch semantics) still belongs in `tests/hydration-test.mjs`. This
 * is for the other 90%.
 */
import { parseHTML } from 'linkedom';
import { renderPage } from '@vesk/compiler/src/server-codegen';

/** One rendered component: its HTML plus the props it was rendered with. */
export interface RenderedComponent {
  /** The SSR body HTML (no `<html>` wrapper). */
  html: string;
  /** The `<head>` the component declared, if any. */
  head: string;
  /** The props the component actually saw, after any load() merge. */
  props: Record<string, unknown>;
}

export interface RenderOptions {
  /**
   * Render as if hydrating. Hydrate mode is the default in a real app, and it
   * changes the emitted markup (markerless SSR), so a test that renders the
   * wrong mode is testing the wrong thing. Default: true.
   */
  hydrate?: boolean;
  /** File name used in error messages and source paths. */
  fileName?: string;
}

/**
 * Compile and server-render a component from `.vsk` source.
 *
 * Throws with the compiler's own diagnostic (code frame and all) when the
 * source does not compile — a test failure should read like a compile error,
 * not like an empty string.
 */
export function renderComponent(
  source: string,
  componentName?: string,
  props: Record<string, unknown> = {},
  options: RenderOptions = {},
): RenderedComponent {
  const hydrate = options.hydrate !== false;
  const result = renderPage(source, componentName || 'App', props, new Map(), {
    hydrate,
    sourcePath: options.fileName,
  }) as { body: string; head: string; props: Record<string, unknown> };
  return { html: result.body, head: result.head, props: result.props };
}

/** A mounted component in a real DOM, with the assertions people keep writing. */
export interface MountedComponent {
  /** The document the component is mounted in. */
  document: Document;
  /** The element the component was mounted into. */
  root: Element;
  /** Current HTML of the mount root. */
  html(): string;
  /** `textContent` of the first match, trimmed; `null` when absent. */
  text(selector: string): string | null;
  /** Attribute of the first match, or `null`. */
  attr(selector: string, name: string): string | null;
  /** Does a match exist? */
  has(selector: string): boolean;
  /** All matches, for list assertions. */
  all(selector: string): Element[];
  /** Click the first match and flush effects. */
  click(selector: string): Promise<MountedComponent>;
  /** Set an input's value, dispatch `input`, and flush. */
  input(selector: string, value: string): Promise<MountedComponent>;
  /** Run pending microtasks and effects, then let the DOM settle. */
  flush(): Promise<MountedComponent>;
  /** Poll `fn` until it is truthy or the budget runs out. */
  waitFor(fn: () => unknown, timeoutMs?: number): Promise<void>;
}

export interface MountOptions extends RenderOptions {
  /** HTML to mount instead of rendering (e.g. to hydrate a prerendered page). */
  html?: string;
  /** Selector for the mount root inside the document. Default `#root`. */
  rootSelector?: string;
}

const DEFAULT_WAIT_MS = 2000;

/**
 * Mount a component's SSR output into a real DOM and return a driver.
 *
 * The DOM is a linkedom document installed as the ambient `document` for the
 * duration of the returned driver's lifetime — `restore()` puts the previous
 * globals back, and `unmount()` also calls it.
 */
export function mount(
  source: string,
  componentName?: string,
  props: Record<string, unknown> = {},
  options: MountOptions = {},
): MountedComponent & { unmount(): void } {
  const html = options.html ?? renderComponent(source, componentName, props, options).html;
  const { document, window } = parseHTML(`<!DOCTYPE html><html><head></head><body><div id="root">${html}</div></body></html>`);

  const previous = {
    document: (globalThis as Record<string, unknown>).document,
    window: (globalThis as Record<string, unknown>).window,
    Event: (globalThis as Record<string, unknown>).Event,
    Node: (globalThis as Record<string, unknown>).Node,
  };
  const g = globalThis as Record<string, unknown>;
  g.document = document;
  g.window = window;
  g.Event = (window as unknown as Record<string, unknown>).Event;
  g.Node = (window as unknown as Record<string, unknown>).Node;

  const root = document.querySelector(options.rootSelector || '#root');
  if (!root) throw new Error(`mount: no ${options.rootSelector || '#root'} in the rendered output`);

  const q = <T extends Element>(selector: string): T | null => root.querySelector(selector) as T | null;

  const flush = async (): Promise<void> => {
    // Two turns: effects scheduled by an effect need a turn of their own, which
    // is exactly why a hand-written `await Promise.resolve()` is not enough.
    await Promise.resolve();
    await Promise.resolve();
  };

  const driver: MountedComponent & { unmount(): void } = {
    document: document as unknown as Document,
    root: root as unknown as Element,
    html: () => (root as unknown as Element).innerHTML,
    text: (selector) => {
      const el = q(selector);
      return el ? String(el.textContent || '').trim() : null;
    },
    attr: (selector, name) => {
      const el = q(selector);
      if (!el) return null;
      const v = el.getAttribute ? el.getAttribute(name) : null;
      return v === null ? null : v;
    },
    has: (selector) => q(selector) !== null,
    all: (selector) => Array.from(root.querySelectorAll(selector)) as unknown as Element[],
    click: async (selector) => {
      const el = q(selector) as unknown as (HTMLElement & { click?: () => void }) | null;
      if (!el) throw new Error(`mount: no element for ${selector}`);
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new window.Event('click', { bubbles: true } as never));
      await flush();
      return driver;
    },
    input: async (selector, value) => {
      const el = q(selector) as unknown as (HTMLElement & { value?: string }) | null;
      if (!el) throw new Error(`mount: no element for ${selector}`);
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true } as never));
      await flush();
      return driver;
    },
    flush: async () => {
      await flush();
      return driver;
    },
    waitFor: async (fn, timeoutMs = DEFAULT_WAIT_MS) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (fn()) return;
        if (Date.now() > deadline) {
          throw new Error(`mount: waitFor timed out after ${timeoutMs}ms\n  html: ${driver.html().slice(0, 400)}`);
        }
        await flush();
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    unmount: () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
    },
  };
  return driver;
}

/**
 * Read a value out of an attribute, decoded the way a browser would.
 * Small convenience for meta/link assertions (`content="a &amp; b"`).
 */
export function attrOf(html: string, selector: string, attribute: string): string | null {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const el = document.querySelector(selector);
  return el ? el.getAttribute(attribute) : null;
}
