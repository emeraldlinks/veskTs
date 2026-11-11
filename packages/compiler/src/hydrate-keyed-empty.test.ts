/**
 * Keyed-map #empty hydration tests.
 *
 * The bug these pin: a KEYED `for` loop with an `#empty` fallback hydrating
 * while the client list is EMPTY crashed the whole hydrator —
 * `TypeError: Cannot read properties of null (reading 'insertBefore')`.
 *
 * Root cause: in hydration mode the keyed map's region anchors
 * (`<!--map-->` / `<!--map-end-->`) are created detached and only attached by
 * `reconcileHydrated` (called from the items branch). When the initial client
 * list is empty, the empty-fallback builder ran instead — reading
 * `anchor.parentNode` (null) and inserting into it. The crash aborted the
 * rest of the page hydrator, so no reactive effect registered and data that
 * arrived later never rendered: the frozen UI kept the server-rendered
 * empty state forever.
 *
 * These are end-to-end on purpose (real SSR markup, real hydrator, real
 * structural walker — see hydrate-residue.test.ts for the harness rationale).
 *
 * Run: npx tsx packages/compiler/src/hydrate-keyed-empty.test.ts
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

function hydrate(m: Mounted, props: Record<string, unknown>): void {
	const walker = createHydrateWalker(m.root);
	root(() => m.hydrators['Page']!(props, new Map(), walker));
	flushSync();
}

function click(m: Mounted, selector: string): void {
	const el = m.document.querySelector(selector) as unknown as Record<string, () => void> | null;
	assert(el, `no element for ${selector}`);
	assert(typeof el.__evh_click === 'function', `${selector} owns no click handler in the DOCUMENT (it would if the handler landed on a detached node)`);
	el.__evh_click();
	flushSync();
}

interface Item {
	id: number;
	text: string;
}
const ITEMS: Item[] = [
	{ id: 1, text: 'A' },
	{ id: 2, text: 'B' },
];

/** Statement-mode keyed list with load/clear buttons. */
const STMT_KEYED = `
component Page(props: { initial: Item[] }) {
	let &[items] = track(props.initial);
	<ul class="list">
		for (const it of items; key it.id) {
			<li class="row">{it.text}</li>
		}
		#empty {
			<li class="fallback">none yet</li>
		}
	</ul>
	<button class="load" onClick={() => { items = [{ id: 1, text: 'A' }, { id: 2, text: 'B' }]; }}>load</button>
	<button class="clear" onClick={() => { items = []; }}>clear</button>
}
export default Page;
`;

/** Expression-mode keyed list with load/clear buttons. */
const EXPR_KEYED = `
component Page(props: { initial: { id: number, text: string }[] }) {
	let &[items] = track(props.initial);
	return (
		<div>
			<ul class="list">
				for (const it of items; key it.id) {
					<li class="row">{it.text}</li>
				}
				#empty {
					<li class="fallback">none yet</li>
				}
			</ul>
			<button class="load" onClick={() => { items = [{ id: 1, text: 'A' }, { id: 2, text: 'B' }]; }}>load</button>
			<button class="clear" onClick={() => { items = []; }}>clear</button>
		</div>
	);
}
export default Page;
`;

/** Statement-mode NON-keyed list with load/clear buttons. */
const STMT_PLAIN = `
component Page(props: { initial: Item[] }) {
	let &[items] = track(props.initial);
	<ul class="list">
		for (const it of items) {
			<li class="row">{it.text}</li>
		}
		#empty {
			<li class="fallback">none yet</li>
		}
	</ul>
	<button class="load" onClick={() => { items = [{ id: 1, text: 'A' }, { id: 2, text: 'B' }]; }}>load</button>
	<button class="clear" onClick={() => { items = []; }}>clear</button>
}
export default Page;
`;

function rows(m: Mounted): string[] {
	return [...m.document.querySelectorAll('.row')].map((el) => (el as Element).textContent!.trim());
}

function fallbacks(m: Mounted): Element[] {
	return [...m.document.querySelectorAll('.fallback')];
}

console.log('\n=== hydrate: keyed #empty fallback must not crash on an initially-empty list ===');

it('[stmt][keyed] SSR fallback + empty client list hydrates without crashing and adopts the fallback', () => {
	const html = ssr(STMT_KEYED, 'Page', { initial: [] });
	assert(html.includes('none yet'), 'SSR must render the #empty fallback');
	const m = mountHydrated(STMT_KEYED, html);
	try {
		hydrate(m, { initial: [] });
		const fb = fallbacks(m);
		assert(fb.length === 1, `expected exactly one adopted fallback, found ${fb.length}`);
		assert(m.root.contains(fb[0]!), 'the fallback must stay in the document');
		assert(rows(m).length === 0, 'no rows should exist yet');
	} finally {
		m.restore();
	}
});

it('[stmt][keyed] populating after an empty hydration renders the items (no frozen UI)', () => {
	const m = mountHydrated(STMT_KEYED, ssr(STMT_KEYED, 'Page', { initial: [] }));
	try {
		hydrate(m, { initial: [] });
		click(m, '.load');
		assert(rows(m).join(',') === 'A,B', `expected rows A,B after load, got [${rows(m).join(',')}]`);
		assert(fallbacks(m).length === 0, 'the fallback must be gone once items render');
	} finally {
		m.restore();
	}
});

it('[expr][keyed] SSR fallback + empty client list: no crash, later data renders (expression mode)', () => {
	const html = ssr(EXPR_KEYED, 'Page', { initial: [] });
	assert(html.includes('none yet'), 'SSR must render the #empty fallback');
	const m = mountHydrated(EXPR_KEYED, html);
	try {
		hydrate(m, { initial: [] });
		assert(fallbacks(m).length === 1, `expected one fallback, found ${fallbacks(m).length}`);
		click(m, '.load');
		assert(rows(m).join(',') === 'A,B', `expected rows A,B after load, got [${rows(m).join(',')}]`);
		assert(fallbacks(m).length === 0, 'fallback must disappear once items render');
		click(m, '.clear');
		assert(rows(m).length === 0, 'rows must clear');
		assert(fallbacks(m).length === 1 && m.root.contains(fallbacks(m)[0]!), 'fallback must re-render after clearing');
	} finally {
		m.restore();
	}
});

it('[stmt][keyed] SSR items + empty client list: fresh fallback renders without crashing, ghosts do not duplicate', () => {
	const html = ssr(STMT_KEYED, 'Page', { initial: ITEMS });
	assert(html.includes('A') && html.includes('B'), 'SSR must render the items');
	const m = mountHydrated(STMT_KEYED, html);
	try {
		hydrate(m, { initial: [] });
		assert(fallbacks(m).length >= 1, 'the empty fallback must render');
		click(m, '.load');
		const r = rows(m);
		assert(r.join(',') === 'A,B', `expected rows A,B after load, got [${r.join(',')}]`);
		assert(m.root.querySelectorAll('.row').length === 2, `expected exactly 2 rows after load, found ${m.root.querySelectorAll('.row').length}`);
	} finally {
		m.restore();
	}
});

it('[stmt][keyed] items-to-empty transition after hydration re-renders the fallback', () => {
	const m = mountHydrated(STMT_KEYED, ssr(STMT_KEYED, 'Page', { initial: ITEMS }));
	try {
		hydrate(m, { initial: ITEMS });
		assert(rows(m).join(',') === 'A,B', 'items adopted at hydration');
		click(m, '.clear');
		assert(rows(m).length === 0, `rows must clear, got [${rows(m).join(',')}]`);
		assert(fallbacks(m).length === 1 && m.root.contains(fallbacks(m)[0]!), 'the fallback must re-render in the document after clearing');
	} finally {
		m.restore();
	}
});

it('[stmt][plain] non-keyed #empty: empty hydration adopts fallback, later items render, then fallback returns', () => {
	const m = mountHydrated(STMT_PLAIN, ssr(STMT_PLAIN, 'Page', { initial: [] }));
	try {
		hydrate(m, { initial: [] });
		assert(fallbacks(m).length === 1, 'fallback adopted at hydration');
		click(m, '.load');
		assert(rows(m).join(',') === 'A,B', `expected rows A,B after load, got [${rows(m).join(',')}]`);
		assert(fallbacks(m).length === 0, 'fallback must disappear while items render');
		click(m, '.clear');
		assert(rows(m).length === 0, 'rows must clear');
		assert(fallbacks(m).length === 1 && m.root.contains(fallbacks(m)[0]!), 'fallback must re-render in the document after clearing');
	} finally {
		m.restore();
	}
});

(async () => {
	for (const fn of queue) await fn();
	console.log(`\n${passed} passed, ${failed} failed`);
	if (failures.length) {
		console.log('failures:', failures.join(' | '));
		process.exit(1);
	}
})();
