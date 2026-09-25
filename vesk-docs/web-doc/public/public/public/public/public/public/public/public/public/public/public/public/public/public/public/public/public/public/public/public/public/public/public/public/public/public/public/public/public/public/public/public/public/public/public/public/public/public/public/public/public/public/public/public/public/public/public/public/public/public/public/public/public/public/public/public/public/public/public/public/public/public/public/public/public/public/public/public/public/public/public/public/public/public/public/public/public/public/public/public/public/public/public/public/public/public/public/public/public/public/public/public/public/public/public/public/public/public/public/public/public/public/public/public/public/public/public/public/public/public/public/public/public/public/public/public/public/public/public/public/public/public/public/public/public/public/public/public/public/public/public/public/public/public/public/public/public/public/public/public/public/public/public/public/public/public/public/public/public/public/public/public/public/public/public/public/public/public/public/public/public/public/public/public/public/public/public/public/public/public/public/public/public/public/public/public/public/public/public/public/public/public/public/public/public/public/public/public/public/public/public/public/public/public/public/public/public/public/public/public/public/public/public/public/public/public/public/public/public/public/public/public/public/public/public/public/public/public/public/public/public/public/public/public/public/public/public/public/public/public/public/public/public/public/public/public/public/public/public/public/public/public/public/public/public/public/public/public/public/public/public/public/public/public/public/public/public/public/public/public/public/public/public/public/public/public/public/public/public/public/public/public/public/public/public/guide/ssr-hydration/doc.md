# SSR & Hydration

Vesk renders every page to HTML on the server and attaches interactivity
on the client by **claiming** the existing DOM — no re-creating, no VDOM.

## Server rendering

- `render()` produces the HTML string for a component tree; dynamic text
  is escaped; `on*` handler attributes are excluded entirely.
- `<style>` blocks are hoisted into the output; `<Head>` content merges
  into `<head>` with dedup.
- Async components are awaited during render.
- Streaming is available via `renderPageStream()` (AsyncGenerator) — used
  by the production server to pipe responses chunk-by-chunk.
- Per-request state (SSR data) is isolated via `AsyncLocalStorage`, so
  concurrent requests never mix data.

```ts
/**
 * Render a page with layout chain, returning { body, head, props }.
 * Honors error boundaries: a thrown NotFoundError/Redirect propagates;
 * other errors render the nearest error.vsk in the page slot.
 */
function renderPage(...): Promise<RenderPageResult>;

/** Wrap rendered body in a full HTML5 document shell. */
function renderFullPage(result, options?): string;

/** Streaming SSR as an async iterable of HTML chunks. */
function renderPageStream(...): AsyncGenerator<string>;
```

## Hydration markers

The server emits `<!--vsk-->` comment markers before each non-static
subtree. Fully static trees carry zero markers and therefore need **no
hydration runtime at all** — pages without interactivity ship no JS.

## Client hydration

The client walks the container with a hydrate walker:

- `nextElement(tag?)` claims the next marker's sibling element,
- `subWalker(el)` descends into components,
- claimed markers are consumed; stray text nodes are cleaned up.

```ts
/**
 * Full hydration of a container against componentFn.
 */
function hydrate(container: HTMLElement, componentFn: Function,
                 props?: Record<string, unknown>): unknown;

/**
 * Viewport-priority hydration. In-viewport regions hydrate now; the rest
 * are renamed to vsk-hold and hydrated via IntersectionObserver as they
 * approach (rootMargin px, default 500). Waits for window load first.
 */
function hydrateViewport(container: HTMLElement, componentFn: Function,
                         props?: Record<string, unknown>, rootMargin?: number): Promise<void>;

/**
 * Idle hydration in chunks (chunkSize default 10) via requestIdleCallback
 * (setTimeout 50ms fallback), aborting after timeout ms (default 3000).
 * Returns { cancel() }.
 */
function hydrateIdle(container: HTMLElement, componentFn: Function,
                     props?: Record<string, unknown>,
                     options?: { chunkSize?: number; timeout?: number }): { cancel(): void };

/**
 * Defer hydration until first interaction. Default events:
 * ['click','touchstart','focus','mouseenter'] on the container.
 * Returns { cancel(), hydrateNow() }.
 */
function hydrateOnInteraction(container: HTMLElement, componentFn: Function,
                              props?: Record<string, unknown>,
                              options?: { events?: string[] }): { cancel(): void; hydrateNow(): void };

/** True if any <!--vsk--> markers remain unclaimed. */
function needsHydration(container: HTMLElement): boolean;

/** Count of remaining markers. */
function hydrationCount(container: HTMLElement): number;

/** Synchronous single-pass hydration (same shape as hydrate). */
function hydrateInitial(container: HTMLElement, componentFn: Function,
                        props?: Record<string, unknown>): void;
```

### Choosing a strategy

Pass via router options or use directly for custom shells:

```ts
createFileRouter(tree, { hydrate: 'viewport' });
```

| Strategy | Best for |
| --- | --- |
| `'full'` (default) | Typical apps |
| `'viewport'` | Long landing pages — above-the-fold interactive instantly |
| `'idle'` | Content sites — never blocks input |
| `'interaction'` | Widgets users rarely touch |

## Islands

Components marked `client` render on both sides and always appear in the
client bundle; `{#client}` blocks are SSR-stripped but present client-side.
See [Client Boundary](../language/client-boundary/doc.md).

## Regions & re-render

Dynamic subtrees compile to region primitives that own their DOM range:

- Conditionals → opaque dynamic regions (if/else-if/else chains included)
- Loops → keyed/unkeyed map regions with per-item markers; classic
  `for`/`while`/`switch`/`try` get flip-effect re-render
- Keyed lists diff keys (`reconcile`) creating/removing/reordering nodes

During hydrate-mode boot, regions claim their SSR content **in body
execution order** and place it in position — leftover markers indicate a
bug and are asserted zero in tests.

## Error isolation

A throwing page errors only itself: the SSR layer renders the nearest
`error.vsk` inside the layout chain with status 500 (partial output never
leaks); on the client the broken route's region shows its error UI while
navigation, footer and other islands keep working.

## Time-sliced helpers (advanced)

For custom shells you can combine `hydrateViewport` / `hydrateIdle` /
`hydrateOnInteraction` directly — they share the walker machinery and can
be cancelled via their returned handles.
