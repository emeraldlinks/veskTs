/**
 * Markerless hydration residue tests.
 *
 * The bug these pin: a component whose body leaves SSR element roots UNCLAIMED
 * (a fully-static sibling component, or the static markup preceding a
 * `{props.children}` slot) used to leave the shared positional walker parked on
 * that first unclaimed element. The NEXT sibling's claim then adopted it, so
 * the real subtree hydrated into detached nodes — event handlers attached to
 * nodes that are not in the document, the page markup left inert, and the
 * component reported as "rendered but dead".
 *
 * These are end-to-end on purpose: the failure is only visible when the REAL
 * SSR markup, the REAL generated hydrator and the REAL structural walker meet.
 * A string assertion on the emitted code cannot tell a working cursor step from
 * a no-op one — and neither can `curl`.
 *
 * Run: npx tsx packages/compiler/src/hydrate-residue.test.ts
 */
import { parseHTML } from 'linkedom';
import { renderPage } from '@vesk/compiler/src/server-render';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { createHydrateWalker } from '@vesk/runtime/src/hydrate';
import { root } from '@vesk/runtime/src/ripple-blocks';
import { flush_sync as flushSync } from '@vesk/runtime/src/ripple-runtime';
import * as runtime from '@vesk/runtime';

let passed = 0;
let failed = 0;
const failures: string[] = [];
const queue: Array<() => Promise<void>> = [];

function it(name: string, fn: () => void | Promise<void>): void {
	queue.push(async () => {
		try {
			await fn();
			passed++;
			console.log(`  ✓ ${name}`);
		} catch (e) {
			failed++;
			failures.push(name);
			console.log(`  ✗ ${name}`);
			console.log(`    ${(e as Error).message}`);
		}
	});
}

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

/** SSR one component in markerless hydrate mode and return its body HTML. */
function ssr(source: string, component: string, props: Record<string, unknown> = {}): string {
	const page = renderPage(source, component, props, new Map(), { hydrate: true, markerless: true }) as { body: string };
	return page.body;
}

interface Mounted {
	document: Document;
	root: HTMLElement;
	hydrators: Record<string, (props: Record<string, unknown>, registry: Map<unknown>, walker: unknown) => unknown>;
	restore(): void;
}

/**
 * Put SSR markup in a linkedom document, evaluate the real hydrate-mode client
 * module for its source, and return the `#root` plus its hydrator registry.
 *
 * `html` is passed in rather than rendered here so a test can express the
 * layout chain the way the adapter builds it: the page renders first, then each
 * layout wraps the accumulated markup.
 */
function mountHydrated(source: string, html: string): Mounted {
	const code = compileClient(source, null, { hydrate: true, forceClient: true, includeTopLevel: false });
	const { document, window } = parseHTML(
		`<!DOCTYPE html><html><head></head><body><div id="root">${html}</div></body></html>`,
	);

	const g = globalThis as Record<string, unknown>;
	const previous: Record<string, unknown> = {};
	const installed: Record<string, unknown> = {
		document,
		window,
		Event: (window as unknown as { Event: unknown }).Event,
		Node: (window as unknown as { Node: unknown }).Node,
		__hydrators: undefined,
	};
	for (const [key, value] of Object.entries(installed)) {
		previous[key] = g[key];
		g[key] = value;
	}

	// The CHUNK BUNDLER declares both registries in the shared module scope and
	// hoists them onto globalThis so separate chunks can see one another's
	// components. Hydrate-mode codegen emits `__hydrators[...]` for hydrator
	// calls and keeps `__components[...]` for nested FRESH renders (keyed map
	// items, self-claiming components) — those must never be text-rewritten to
	// the hydrator registry, which is what broke `NavIcon` in the portal chunk.
	// Mirror that preamble here instead of rewriting the registry name.
	const names = [...code.matchAll(/^import \{([^}]*)\} from '@vesk\/runtime';?\s*$/gm)]
		.flatMap((m) => m[1]!.split(','))
		.map((s) => s.trim())
		.filter(Boolean);
	const body = code
		.replace(/^import \{[^}]*\} from '@vesk\/runtime';?\s*$/gm, '')
		.replace(/^export default [A-Za-z0-9_$]+;?\s*$/gm, '')
		.replace(/^const __hydrators = \{\};$/m, 'const __hydrators = globalThis.__hydrators = globalThis.__hydrators || {};')
		.replace(/^const __components = \{\};$/m, 'const __components = globalThis.__components = globalThis.__components || {};');
	const values = names.map((n) => (runtime as unknown as Record<string, unknown>)[n]);
	const unbound = names.filter((_, i) => values[i] === undefined);
	assert(unbound.length === 0, `generated code imports runtime names this test cannot bind: ${unbound.join(', ')}`);
	// eslint-disable-next-line no-new-func
	new Function(...names, body)(...values);

	const mountRoot = document.getElementById('root') as unknown as HTMLElement;
	const hydrators = g.__hydrators as Mounted['hydrators'];

	return {
		document: document as unknown as Document,
		root: mountRoot,
		hydrators,
		restore() {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete g[key];
				else g[key] = value;
			}
		},
	};
}

/** Run a hydrator chain the way `renderLayoutChain` does: outermost first. */
function hydrateChain(m: Mounted, chain: Array<{ name: string; children?: (w: unknown) => unknown }>): void {
	const walker = createHydrateWalker(m.root);
	const step = (i: number, w: unknown): unknown => {
		if (i >= chain.length) return undefined;
		const node = chain[i]!;
		return m.hydrators[node.name]!({ children: (inner: unknown) => step(i + 1, inner) }, new Map(), w);
	};
	root(() => step(0, walker));
	flushSync();
}

function click(m: Mounted, selector: string): void {
	const el = m.document.querySelector(selector) as unknown as Record<string, () => void> | null;
	assert(el, `no element for ${selector}`);
	assert(typeof el.__evh_click === 'function', `${selector} owns no click handler in the DOCUMENT (it would if the handler landed on a detached node)`);
	el.__evh_click();
	flushSync();
}

const ISLAND = `component EffectIsland() {
  effect(() => {});
  <span class="island" />
}
`;

const TOGGLE = `component ChildToggle {
  const &[c, cCell] = track(false);
  <div class="cw">
    <span class="cn">{c ? 'CHILD-ON' : 'CHILD-OFF'}</span>
    <button class="cb" onClick={() => { c = !c; }}>cb</button>
  </div>
}
`;

console.log('\n=== hydrate: unclaimed residue must not swallow the next claim ===');

it('a static-but-live sibling component does not steal the following sibling\'s claim', () => {
	const source = `${ISLAND}
${TOGGLE}
component Page { <EffectIsland /> <ChildToggle /> }
export default Page;
`;
	const m = mountHydrated(source, ssr(source, 'Page'));
	try {
		hydrateChain(m, [{ name: 'Page' }]);
		const island = m.document.querySelector('.island');
		assert(island && m.root.contains(island), 'the static sibling stayed in the document');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-OFF'), 'SSR text preserved');
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the claimed cell re-renders the claimed node');
	} finally {
		m.restore();
	}
});

it('static element residue before a bare slot does not shift the slot claim', () => {
	const source = `${TOGGLE}
component RootLayout(props: { children?: any }) {
  <span class="st">static</span>
  {props.children}
}
export default RootLayout;
`;
	const html = ssr(source, 'RootLayout', { children: ssr(source, 'ChildToggle') });
	const m = mountHydrated(source, html);
	try {
		hydrateChain(m, [{ name: 'RootLayout' }, { name: 'ChildToggle' }]);
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the page component hydrated and reacted');
	} finally {
		m.restore();
	}
});

it('static residue inside a layout element, before its slot, is accounted for', () => {
	const source = `${TOGGLE}
component PublicLayout(props: { children?: any }) {
  <div class="gl"><span class="st">static</span><main class="slot">{props.children}</main></div>
}
export default PublicLayout;
`;
	const html = ssr(source, 'PublicLayout', { children: ssr(source, 'ChildToggle') });
	const m = mountHydrated(source, html);
	try {
		hydrateChain(m, [{ name: 'PublicLayout' }, { name: 'ChildToggle' }]);
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the page component hydrated and reacted');
	} finally {
		m.restore();
	}
});

console.log('\n=== hydrate: the reported layout repro (root layout sibling → group layout → page) ===');

it('a child component under a layout chain hydrates and stays interactive', () => {
	const source = `${ISLAND}
${TOGGLE}
component GroupPage { <h2 class="ph">page</h2> }
component PublicLayout(props: { children?: any }) {
  <div class="gl"><ChildToggle /><main class="slot">{props.children}</main></div>
}
component RootLayout(props: { children?: any }) {
  <EffectIsland />
  {props.children}
}
export default RootLayout;
`;
	const html = ssr(source, 'RootLayout', {
		children: ssr(source, 'PublicLayout', { children: ssr(source, 'GroupPage') }),
	});
	const m = mountHydrated(source, html);
	try {
		hydrateChain(m, [{ name: 'RootLayout' }, { name: 'PublicLayout' }, { name: 'GroupPage' }]);
		const island = m.document.querySelector('.island');
		assert(island && m.root.contains(island), 'the root layout sibling is still in the document');
		const h2 = m.document.querySelector('.ph');
		assert(h2 && m.root.contains(h2), 'the page body is still in the document');
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the child toggle reacted');
	} finally {
		m.restore();
	}
});

it('the same chain in the reversed order behaves identically (order independence)', () => {
	const source = `${ISLAND}
${TOGGLE}
component GroupPage { <h2 class="ph">page</h2> }
component PublicLayout(props: { children?: any }) {
  <div class="gl"><ChildToggle /><main class="slot">{props.children}</main></div>
}
component RootLayout(props: { children?: any }) {
  {props.children}
  <EffectIsland />
}
export default RootLayout;
`;
	const html = ssr(source, 'RootLayout', {
		children: ssr(source, 'PublicLayout', { children: ssr(source, 'GroupPage') }),
	});
	const m = mountHydrated(source, html);
	try {
		hydrateChain(m, [{ name: 'RootLayout' }, { name: 'PublicLayout' }, { name: 'GroupPage' }]);
		const island = m.document.querySelector('.island');
		assert(island && m.root.contains(island), 'the trailing static sibling is still in the document');
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the child toggle reacted');
	} finally {
		m.restore();
	}
});

console.log('\n=== hydrate: no residue, no cursor movement ===');

it('a component with no residue emits no cursor step and still claims correctly', () => {
	const source = `${TOGGLE}
component Page { <ChildToggle /> }
export default Page;
`;
	const m = mountHydrated(source, ssr(source, 'Page'));
	try {
		hydrateChain(m, [{ name: 'Page' }]);
		click(m, '.cb');
		assert((m.document.querySelector('.cn') as Element).textContent!.includes('CHILD-ON'), 'the claimed cell reacted');
	} finally {
		m.restore();
	}
});

console.log('\n=== hydrate: a conditional opened after hydration builds its static content ===');

it('opening a conditional with a pure-static panel renders the panel (fresh-parent residue fallback)', () => {
	// The reported crash: clicking a dropdown after hydration mounted a FRESH
	// panel (the walker is exhausted — SSR rendered the conditional closed), and
	// the pure-static header child retrieved `panel.__vsk_ssrEls[0]` unguarded.
	// A fresh parent has no residue list, so this threw "Cannot read properties
	// of undefined (reading '0')" and the panel never opened. The codegen now
	// falls back to building the subtree when the residue is absent.
	const source = `component Menu {
  const &[open, openCell] = track(false);
  <div class="mw">
    <button class="mb" onClick={() => { open = !open; }}>mb</button>
    if (open) {
      <div class="panel">
        <div class="head">MENU HEADER</div>
        <span class="item">Item one</span>
      </div>
    }
  </div>
}
export default Menu;
`;
	const m = mountHydrated(source, ssr(source, 'Menu'));
	try {
		hydrateChain(m, [{ name: 'Menu' }]);
		assert(m.document.querySelector('.panel') === null, 'SSR rendered the conditional closed');
		click(m, '.mb');
		const head = m.document.querySelector('.head');
		assert(head, 'the freshly-built panel kept its pure-static header');
		assert(head.textContent!.includes('MENU HEADER'), 'the header text survived the fresh build');
		assert(m.document.querySelector('.item'), 'the panel body rendered');
		click(m, '.mb');
		assert(m.document.querySelector('.panel') === null, 'closing the conditional removes the fresh panel');
	} finally {
		m.restore();
	}
});

for (const fn of queue) await fn();

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
	console.log('Failed: ' + failures.join(' | '));
	process.exit(1);
}
console.log('All tests passed!');