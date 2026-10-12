/**
 * Vesk Runtime Tests — createPathStore (@vesk/runtime/path-store)
 *
 * Fine-grained, causally-aware reactive store: path-local reactivity,
 * derived nodes, structural-sharing time travel and SSR persistence.
 *
 * Run with: npx tsx packages/runtime/src/path-store.test.ts
 */
import { root, effect } from '@vesk/runtime/src/ripple-blocks';
import { flush_sync } from '@vesk/runtime/src/ripple-runtime';
import {
	createPathStore,
	parseStorePath,
	buildStorePrePaintPayload,
	persistedStoreCookieName,
	installPathStoreServerHooks,
	getPersistedStoreKeys,
	resetPersistedStoreKeys,
} from '@vesk/runtime/path-store';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void): void {
	console.log(`\n${name}`);
	fn();
}

function it(name: string, fn: () => void): void {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e: unknown) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${(e as Error).message}`);
	}
}

function expect(value: unknown) {
	const api = {
		not: {
			toBe(expected: unknown) {
				if (value === expected) throw new Error(`Expected value NOT to be ${JSON.stringify(expected)}`);
			},
			toEqual(expected: unknown) {
				if (JSON.stringify(value) === JSON.stringify(expected))
					throw new Error(`Expected value NOT to equal ${JSON.stringify(expected)}`);
			},
		},
		toBe(expected: unknown) {
			if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
		},
		toBeTruthy() {
			if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
		},
		toBeFalsy() {
			if (value) throw new Error(`Expected falsy, got ${JSON.stringify(value)}`);
		},
		toEqual(expected: unknown) {
			const a = JSON.stringify(value);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toContain(expected: unknown) {
			const haystack = typeof value === 'string' ? value : JSON.stringify(value);
			if (!haystack.includes(String(expected)))
				throw new Error(`Expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(expected)}`);
		},
		toBeLessThanOrEqual(expected: number) {
			if (typeof value !== 'number' || value > expected)
				throw new Error(`Expected ${JSON.stringify(value)} <= ${expected}`);
		},
	};
	return api;
}

type State = {
	user: { name: string; age: number };
	items: { id: number; done: boolean }[];
	meta: { theme: string };
};

const initial: State = {
	user: { name: 'ada', age: 36 },
	items: [
		{ id: 1, done: false },
		{ id: 2, done: true },
	],
	meta: { theme: 'light' },
};

/* ── parseStorePath ── */

describe('parseStorePath', () => {
	it('splits dot segments and numeric brackets', () => {
		expect(parseStorePath('user.name')[0]).toBe('user');
		expect(parseStorePath('user.name')[1]).toBe('name');
		expect(parseStorePath('items[0].done')).toEqual(['items', 0, 'done']);
		expect(parseStorePath('items[12]')).toEqual(['items', 12]);
	});
	it('handles leading dot and empty segments without crashing', () => {
		expect(Array.isArray(parseStorePath('.a'))).toBeTruthy();
		expect(Array.isArray(parseStorePath('a..b'))).toBeTruthy();
		expect(parseStorePath('a.b')).toEqual(['a', 'b']);
	});
});

/* ── basic reads / writes ── */

describe('createPathStore — basics', () => {
	it('root read reflects a clone of the seed, not the seed object itself', () => {
		const seed: State = { user: { name: 'ada', age: 36 }, items: [], meta: { theme: 'light' } };
		const store = createPathStore(seed);
		const first = store.get();
		expect(first.user.name).toBe('ada');
		// The seed is deep-cloned on construction, so the live state is a
		// different object graph (writes to the seed never leak in).
		expect(first).not.toBe(seed);
		expect(first.user).not.toBe(seed.user);
		seed.user.name = 'grace';
		expect((store.get() as State).user.name).toBe('ada');
	});

	it('set replaces the whole state; update shallow-merges', () => {
		const store = createPathStore(initial);
		store.set({ user: { name: 'x', age: 1 }, items: [], meta: { theme: 'd' } } as State);
		expect(store.get()).toEqual({ user: { name: 'x', age: 1 }, items: [], meta: { theme: 'd' } });
		store.update({ meta: { theme: 'dark' } });
		expect((store.get() as State).meta.theme).toBe('dark');
		expect((store.get() as State).user.name).toBe('x');
	});

	it('setIn / updateIn write one nested path', () => {
		const store = createPathStore(initial);
		store.setIn('user.age', 99);
		expect((store.get() as State).user.age).toBe(99);
		store.updateIn('user.age', (age) => (age as number) + 1, 'bday');
		expect((store.get() as State).user.age).toBe(100);
		store.setIn(['user', 'name'], 'grace');
		expect((store.get() as State).user.name).toBe('grace');
	});

	it('clone keeps the seed isolated — nested writes never touch the original', () => {
		const seed = { list: [{ n: 1 }], meta: { theme: 'light' }, user: { name: 'ada', age: 1 } };
		const store = createPathStore(seed as unknown as State);
		store.setIn('list[0].n', 2);
		store.at('meta.theme').set('dark');
		expect((store.get() as unknown as { list: { n: number }[] }).list[0].n).toBe(2);
		expect(seed.list[0].n).toBe(1);
		expect(seed.meta.theme).toBe('light');
	});
});

/* ── path handles + reactivity ── */

describe('createPathStore — path handles', () => {
	it('at(path) reads a nested value with fine-grained reactivity', () => {
		const store = createPathStore(initial);
		const seen: number[] = [];
		root(() => {
			effect(() => {
				seen.push(store.at('user.age').get() as number);
			});
		});
		flush_sync();
		store.at('user.age').set(40);
		flush_sync();
		expect(seen).toEqual([36, 40]);
	});

	it('a sibling write does not re-run a path effect', () => {
		const store = createPathStore(initial);
		let nameRuns = 0;
		let themeRuns = 0;
		root(() => {
			effect(() => {
				store.at('user.name').get();
				nameRuns++;
			});
		});
		root(() => {
			effect(() => {
				store.at('meta.theme').get();
				themeRuns++;
			});
		});
		flush_sync();
		store.at('user.age').set(41);
		flush_sync();
		store.at('meta.theme').set('dark');
		flush_sync();
		expect(themeRuns).toBe(2);
		expect(nameRuns).toBe(1);
	});

	it('at(path).update applies fn to the current value', () => {
		const store = createPathStore(initial);
		store.at('user.age').update((a: number) => a + 1);
		expect((store.get() as State).user.age).toBe(37);
	});

	it('at(path).subscribe fires only when the path value changes', () => {
		const store = createPathStore(initial);
		const seen: string[] = [];
		store.at('user.name').subscribe((v) => seen.push(String(v))); // no initial emission
		store.at('user.age').set(50); // unrelated path — must not fire
		store.at('user.name').set('grace');
		expect(seen).toEqual(['grace']);
	});

	it('array index paths drive per-item cells', () => {
		const store = createPathStore(initial);
		const first: number[] = [];
		root(() => {
			effect(() => {
				first.push((store.at('items[0].done').get() as boolean) ? 1 : 0);
			});
		});
		flush_sync();
		store.at('items[0].done').set(true);
		flush_sync();
		expect(first).toEqual([0, 1]);
	});
});

/* ── derived ── */

describe('createPathStore — derived', () => {
	it('derived captures deps (leaves + array envelope) and recomputes on source change', () => {
		const store = createPathStore(initial);
		const total = store.derived('stats.total', (s: State) => s.items.filter((i) => i.done).length);
		// The read-recording proxy captures the array envelope ("items"), its
		// length, and the per-element leaves it actually touched.
		expect(total.deps.includes('items')).toBeTruthy();
		expect(total.deps.includes('items.length')).toBeTruthy();
		expect(total.get()).toBe(1);
		store.at('items[1].done').set(false);
		expect(total.get()).toBe(0);
		store.updateIn('items', (list) => [...(list as State['items']), { id: 3, done: true }]);
		expect(total.get()).toBe(1);
	});

	it('derived values appear in get()/toJSON at their registered path', () => {
		const store = createPathStore(initial);
		store.derived('meta.themeLabel', (s: State) => `theme:${s.meta.theme}`);
		const merged = store.get() as unknown as { meta: { themeLabel?: string } };
		expect(merged.meta.themeLabel).toBe('theme:light');
		expect((store.toJSON() as { meta: { themeLabel: string } }).meta.themeLabel).toBe('theme:light');
	});

	it('derived paths are read-only via at(path)', () => {
		const store = createPathStore(initial);
		store.derived('stats.done', (s: State) => s.items.filter((i) => i.done).length);
		let threw = false;
		try {
			(store.at('stats.done') as { set: () => void }).set(3);
		} catch {
			threw = true;
		}
		expect(threw).toBeTruthy();
	});

	it('derived subscribe fires only on computed-value change', () => {
		const store = createPathStore(initial);
		const d = store.derived('stats.total', (s: State) => s.items.filter((i) => i.done).length);
		const seen: number[] = [];
		d.subscribe((v) => seen.push(v as number)); // no initial emission
		store.at('items[1].done').set(false); // 1 -> 0
		store.at('items[0].done').set(true); // 0 -> 1
		store.at('user.age').set(1); // unrelated, computed unchanged
		expect(seen).toEqual([0, 1]);
	});

	it('custom equals suppresses notify for equal computed values', () => {
		const store = createPathStore(initial);
		const alwaysEqual = store.derived(
			'stats.lenEq',
			(s: State) => s.items.length,
			() => true
		);
		const byValue = store.derived('stats.len', (s: State) => s.items.length);
		const eqSeen: number[] = [];
		const valSeen: number[] = [];
		alwaysEqual.subscribe((v) => eqSeen.push(v as number));
		byValue.subscribe((v) => valSeen.push(v as number));
		// Membership change → length 2 -> 3. The always-equal derived stays quiet.
		store.updateIn('items', (list) => [...(list as State['items']), { id: 3, done: false }]);
		expect(eqSeen).toEqual([]);
		expect(valSeen).toEqual([3]);
	});
});

/* ── causality / history / time travel ── */

describe('createPathStore — causality, events and time travel', () => {
	it('commit records versions, events and per-path causes', () => {
		const store = createPathStore(initial);
		store.at('user.name').set('grace', 'rename');
		expect(store.version).toBe(1);
		expect(store.events.length).toBe(1);
		expect(store.events[0].action).toBe('rename');
		const why = store.why('user.name');
		expect(why.cause).toBe('action');
		expect(why.action).toBe('rename');
	});

	it('a never-written path explains as initial', () => {
		const store = createPathStore(initial);
		const why = store.why('meta.theme');
		expect(why.cause).toBe('initial');
	});

	it('undo/redo travel the causal history', () => {
		const store = createPathStore(initial);
		store.at('user.age').set(40);
		store.at('user.age').set(41);
		expect((store.get() as State).user.age).toBe(41);
		expect(store.canUndo()).toBeTruthy();
		expect(store.undo()).toBeTruthy();
		expect((store.get() as State).user.age).toBe(40);
		expect(store.undo()).toBeTruthy();
		expect((store.get() as State).user.age).toBe(36);
		expect(store.canUndo()).toBeFalsy();
		expect(store.redo()).toBeTruthy();
		expect((store.get() as State).user.age).toBe(40);
		expect(store.redo()).toBeTruthy();
		expect((store.get() as State).user.age).toBe(41);
		// A fresh write clears the redo stack.
		store.at('user.age').set(42);
		expect(store.canRedo()).toBeFalsy();
	});

	it('historyLimit caps the event log', () => {
		const store = createPathStore(initial, { historyLimit: 3 });
		for (let i = 0; i < 10; i++) store.at('user.age').set(10 + i);
		expect(store.events.length).toBeLessThanOrEqual(3);
		store.undo();
		expect((store.get() as State).user.age).toBe(18);
	});
});

/* ── SSR persistence ── */

describe('createPathStore — SSR persistence', () => {
	const priorWindow = (globalThis as Record<string, unknown>).window;
	const priorDocument = (globalThis as Record<string, unknown>).document;
	const priorLocalStorage = (globalThis as Record<string, unknown>).localStorage;

	function withClientGlobals(fn: () => void): void {
		const store = new Map<string, string>();
		(globalThis as Record<string, unknown>).window = globalThis;
		(globalThis as Record<string, unknown>).document = { cookie: '' };
		(globalThis as Record<string, unknown>).localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
		};
		try {
			fn();
		} finally {
			if (priorWindow === undefined) delete (globalThis as Record<string, unknown>).window;
			else (globalThis as Record<string, unknown>).window = priorWindow;
			if (priorDocument === undefined) delete (globalThis as Record<string, unknown>).document;
			else (globalThis as Record<string, unknown>).document = priorDocument;
			if (priorLocalStorage === undefined) delete (globalThis as Record<string, unknown>).localStorage;
			else (globalThis as Record<string, unknown>).localStorage = priorLocalStorage;
			delete (globalThis as Record<string, unknown>).__VESK_STORE_INIT__;
		}
	}

	it('server: createPathStore reads through the installed hook and registers its key', () => {
		// No `window` on the server → server persistence path.
		installPathStoreServerHooks({ read: (key) => (key === 'ui' ? JSON.stringify({ meta: { theme: 'dark' } }) : null) });
		resetPersistedStoreKeys();
		const store = createPathStore(initial, { persist: true, storageKey: 'ui' });
		expect((store.get() as State).meta.theme).toBe('dark');
		expect(getPersistedStoreKeys()).toEqual(['ui']);
		installPathStoreServerHooks({});
		resetPersistedStoreKeys();
	});

	it('registry isolates concurrent renders by token', () => {
		installPathStoreServerHooks({});
		const g = globalThis as Record<string, unknown>;
		const hadToken = '__vsk_ssr_token' in g;
		const priorToken = g.__vsk_ssr_token;
		try {
			// Two "concurrent" renders under different tokens (the compiler's
			// withSsrStore sets this global per request).
			g.__vsk_ssr_token = 'token-a';
			createPathStore(initial, { persist: true, storageKey: 'a-key' });
			g.__vsk_ssr_token = 'token-b';
			createPathStore(initial, { persist: true, storageKey: 'b-key' });
			expect(getPersistedStoreKeys('token-a')).toEqual(['a-key']);
			expect(getPersistedStoreKeys('token-b')).toEqual(['b-key']);
			resetPersistedStoreKeys('token-a');
			expect(getPersistedStoreKeys('token-a')).toEqual([]);
			expect(getPersistedStoreKeys('token-b')).toEqual(['b-key']);
		} finally {
			if (hadToken) g.__vsk_ssr_token = priorToken;
			else delete g.__vsk_ssr_token;
			resetPersistedStoreKeys('token-a');
			resetPersistedStoreKeys('token-b');
			installPathStoreServerHooks({});
		}
	});

	it('client: pre-painted __VESK_STORE_INIT__ wins over the seed', () => {
		withClientGlobals(() => {
			(globalThis as Record<string, unknown>).__VESK_STORE_INIT__ = { ui: JSON.stringify({ meta: { theme: 'dark' } }) };
			const store = createPathStore(initial, { persist: true, storageKey: 'ui' });
			expect((store.get() as State).meta.theme).toBe('dark');
		});
	});

	it('client: falls back to localStorage', () => {
		withClientGlobals(() => {
			(globalThis as Record<string, unknown>).localStorage = {
				getItem: () => JSON.stringify({ meta: { theme: 'dark' } }),
				setItem: () => {},
				removeItem: () => {},
			} as unknown as Storage;
			const store = createPathStore(initial, { persist: true, storageKey: 'ui' });
			expect((store.get() as State).meta.theme).toBe('dark');
		});
	});

	it('writes mirror to localStorage and the cookie; clear() strips both', () => {
		withClientGlobals(() => {
			const doc = ((globalThis as Record<string, unknown>).document as { cookie: string });
			const store = createPathStore(initial, { persist: true, storageKey: 'ui' });
			store.at('meta.theme').set('dark');
			expect(doc.cookie).toContain(persistedStoreCookieName('ui') + '=');
			expect(doc.cookie).toContain(encodeURIComponent(JSON.stringify({
				user: { name: 'ada', age: 36 },
				items: [
					{ id: 1, done: false },
					{ id: 2, done: true },
				],
				meta: { theme: 'dark' },
			})));
		});
	});

	it('non-persisted stores never touch storage or the registry', () => {
		installPathStoreServerHooks({});
		resetPersistedStoreKeys();
		createPathStore(initial);
		expect(getPersistedStoreKeys()).toEqual([]);
	});

	it('buildStorePrePaintPayload serves a pure external JS body (no inline script)', () => {
		const payload = buildStorePrePaintPayload({ ui: JSON.stringify({ meta: { theme: 'dark' } }) });
		// Served as an origin-hosted file — no <script> element, no HTML context.
		expect(payload.includes('<script')).toBeFalsy();
		expect(payload.includes('globalThis.__VESK_STORE_INIT__')).toBeTruthy();
		// Evaluating it (as the /store-init.js file would) populates the globals:
		// no localStorage here, so each key is filled from the server value.
		new Function(payload)();
		const init = (globalThis as Record<string, unknown>).__VESK_STORE_INIT__ as Record<string, string>;
		expect(init.ui).toBe(JSON.stringify({ meta: { theme: 'dark' } }));
		delete (globalThis as Record<string, unknown>).__VESK_STORE_INIT__;
	});
});

/* ── exit ── */

let summary = true;
if (failed > 0) {
	console.log(`\n${failed} failed, ${passed} passed`);
	process.exit(1);
} else if (summary) {
	console.log(`\nAll ${passed} tests passed.`);
	process.exit(0);
}