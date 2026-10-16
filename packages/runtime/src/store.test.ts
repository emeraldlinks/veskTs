/**
 * Vesk Runtime Tests — createStore (@vesk/runtime/store)
 *
 * Run with: npx tsx packages/runtime/src/store.test.ts
 */
import { root, effect } from '@vesk/runtime/src/ripple-blocks';
import { flush_sync } from '@vesk/runtime/src/ripple-runtime';
import { createStore } from '@vesk/runtime/store';
import {
	installPersistedStoreServerHooks,
	persistedStoreCookieName,
	getPersistedStoreKeys,
	resetPersistedStoreKeys,
} from '@vesk/runtime/store-persistence';

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
	return {
		toBe(expected: unknown) {
			if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
		},
		toBeTruthy() {
			if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
		},
		toBeFalsy() {
			if (value) throw new Error(`Expected falsy, got ${JSON.stringify(value)}`);
		},
		toBeArray() {
			if (!Array.isArray(value)) throw new Error(`Expected an array, got ${JSON.stringify(value)}`);
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
	};
}

describe('createStore — basic state', () => {
	it('get returns the initial state', () => {
		const store = createStore({ count: 0, name: 'ada' });
		expect(store.get().count).toBe(0);
		expect(store.get().name).toBe('ada');
	});

	it('update merges a partial patch', () => {
		const store = createStore({ count: 0, name: 'ada' });
		store.update({ count: 1 });
		expect(store.get().count).toBe(1);
		expect(store.get().name).toBe('ada');
	});

	it('update accepts a callback over the previous state', () => {
		const store = createStore({ count: 1 });
		store.update((prev) => ({ count: prev.count + 4 }));
		expect(store.get().count).toBe(5);
	});

	it('set replaces the whole state', () => {
		const store = createStore({ count: 0, name: 'ada' });
		store.set({ count: 9, name: 'grace' });
		expect(store.get()).toEqual({ count: 9, name: 'grace' });
	});

	it('delete removes keys', () => {
		const store = createStore<{ a?: number; b?: number }>({ a: 1, b: 2 });
		store.delete('a');
		expect(store.get()).toEqual({ b: 2 });
	});

	it('reset restores the initial state', () => {
		const store = createStore({ count: 0 });
		store.update({ count: 7 });
		store.reset();
		expect(store.get().count).toBe(0);
	});
});

describe('createStore — reactivity (active ripple engine)', () => {
	it('a tracked read inside an effect re-runs on update', () => {
		const store = createStore({ count: 0 });
		const seen: number[] = [];
		root(() => {
			effect(() => {
				seen.push(store.get().count);
			});
		});
		flush_sync();
		store.update({ count: 1 });
		flush_sync();
		store.update({ count: 2 });
		flush_sync();
		expect(seen).toEqual([0, 1, 2]);
	});

	it('set triggers the effect too', () => {
		const store = createStore({ count: 0 });
		let last = -1;
		root(() => {
			effect(() => {
				last = store.get().count;
			});
		});
		flush_sync();
		store.set({ count: 42 });
		flush_sync();
		expect(last).toBe(42);
	});

	it('an effect reading get() re-runs on any state change (whole-cell subscription)', () => {
		const store = createStore({ a: 0, b: 0 });
		let runs = 0;
		root(() => {
			effect(() => {
				store.get().a;
				runs++;
			});
		});
		flush_sync();
		expect(runs).toBe(1);
		store.update({ b: 1 });
		flush_sync();
		expect(runs).toBe(2);
		store.update({ a: 1 });
		flush_sync();
		expect(runs).toBe(3);
	});

	it('derive.subscribe only notifies when the selected slice changes', () => {
		const store = createStore({ a: 0, b: 0 });
		const seen: number[] = [];
		store.derive((s) => s.a).subscribe((v) => seen.push(v));
		store.update({ b: 1 });
		store.update({ a: 1 });
		expect(seen).toEqual([0, 1]);
	});
});

describe('createStore — subscribers, watchers, derived', () => {
	it('subscribe fires immediately and on every change', () => {
		const store = createStore({ count: 0 });
		const seen: number[] = [];
		const unsub = store.subscribe((s) => seen.push(s.count));
		expect(seen).toEqual([0]);
		store.update({ count: 1 });
		store.update({ count: 2 });
		expect(seen).toEqual([0, 1, 2]);
		unsub();
		store.update({ count: 3 });
		expect(seen).toEqual([0, 1, 2]);
	});

	it('subscribe with a selector receives just the slice', () => {
		const store = createStore({ count: 0, name: 'a' });
		const seen: number[] = [];
		store.subscribe((v) => seen.push(v), (s) => s.count);
		store.update({ name: 'b' });
		store.update({ count: 5 });
		expect(seen).toEqual([0, 5]);
	});

	it('watch reports the previous and next value', () => {
		const store = createStore({ count: 0 });
		const pairs: Array<[number, number]> = [];
		store.watch((s) => s.count, (n, o) => pairs.push([o, n]));
		store.update({ count: 1 });
		store.update({ count: 2 });
		expect(pairs).toEqual([
			[0, 1],
			[1, 2],
		]);
	});

	it('derive reacts to a selected part', () => {
		const store = createStore({ theme: 'dark', count: 0 });
		const seen: string[] = [];
		const derived = store.derive((s) => s.theme);
		derived.subscribe((v) => seen.push(v));
		store.update({ count: 1 });
		store.update({ theme: 'light' });
		expect(seen).toEqual(['dark', 'light']);
	});
});

describe('createStore — batch', () => {
	it('defers subscribers until the batch completes', () => {
		const store = createStore({ a: 0, b: 0 });
		const seen: Array<{ a: number; b: number }> = [];
		store.subscribe((s) => seen.push({ a: s.a, b: s.b }));
		store.batch(() => {
			store.update({ a: 1 });
			store.update({ b: 2 });
		});
		expect(seen).toEqual([
			{ a: 0, b: 0 },
			{ a: 1, b: 2 },
		]);
	});

	it('a batched update still re-runs an effect, once', () => {
		const store = createStore({ a: 0, b: 0 });
		let runs = 0;
		root(() => {
			effect(() => {
				store.get().a;
				store.get().b;
				runs++;
			});
		});
		flush_sync();
		expect(runs).toBe(1);
		store.batch(() => {
			store.update({ a: 1 });
			store.update((s) => ({ b: s.b + 1 }));
		});
		flush_sync();
		expect(runs).toBe(2);
	});
});

describe('createStore — middleware and persistence guard', () => {
	it('middleware fires with the action name and current state', () => {
		const store = createStore({ count: 0 });
		const actions: string[] = [];
		store.use((_s, action) => actions.push(action ?? '?'));
		store.update({ count: 1 });
		store.update({ count: 2 }, 'increment');
		expect(actions).toEqual(['update', 'increment']);
	});

	it('persist is a no-op without a browser window', () => {
		const store = createStore({ count: 0 }, { persist: true, storageKey: 'k' });
		store.update({ count: 3 });
		expect(store.get().count).toBe(3);
	});
});

describe('createStore — SSR persistence', () => {
	const priorWindow = (globalThis as Record<string, unknown>).window;
	const priorDocument = (globalThis as Record<string, unknown>).document;
	const priorLocalStorage = (globalThis as Record<string, unknown>).localStorage;

	function withClientGlobals(fn: () => void): void {
		const backing = new Map<string, string>();
		(globalThis as Record<string, unknown>).window = globalThis;
		(globalThis as Record<string, unknown>).document = { cookie: '' };
		(globalThis as Record<string, unknown>).localStorage = {
			getItem: (k: string) => backing.get(k) ?? null,
			setItem: (k: string, v: string) => void backing.set(k, v),
			removeItem: (k: string) => void backing.delete(k),
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

	it('server: reads through the installed hook and registers its key', () => {
		installPersistedStoreServerHooks({ read: (key) => (key === 'ui' ? JSON.stringify({ count: 5 }) : null) });
		resetPersistedStoreKeys();
		const store = createStore({ count: 0 }, { persist: true, storageKey: 'ui' });
		expect(store.get().count).toBe(5);
		expect(getPersistedStoreKeys()).toEqual(['ui']);
		installPersistedStoreServerHooks({});
		resetPersistedStoreKeys();
	});

	it('client: pre-painted __VESK_STORE_INIT__ wins over the seed', () => {
		withClientGlobals(() => {
			(globalThis as Record<string, unknown>).__VESK_STORE_INIT__ = { ui: JSON.stringify({ count: 5 }) };
			const store = createStore({ count: 0 }, { persist: true, storageKey: 'ui' });
			expect(store.get().count).toBe(5);
		});
	});

	it('client: falls back to localStorage when no pre-paint payload exists', () => {
		withClientGlobals(() => {
			(globalThis as Record<string, unknown>).localStorage = {
				getItem: () => JSON.stringify({ count: 9 }),
				setItem: () => {},
				removeItem: () => {},
			} as unknown as Storage;
			const store = createStore({ count: 0 }, { persist: true, storageKey: 'ui' });
			expect(store.get().count).toBe(9);
		});
	});

	it('writes mirror to localStorage and the cookie; clear strips both', () => {
		withClientGlobals(() => {
			const doc = (globalThis as Record<string, unknown>).document as { cookie: string };
			const store = createStore({ count: 0 }, { persist: true, storageKey: 'ui' });
			store.update({ count: 3 });
			expect(doc.cookie).toContain(persistedStoreCookieName('ui') + '=');
			expect(doc.cookie).toContain(encodeURIComponent(JSON.stringify({ count: 3 })));
			expect(
				((globalThis as Record<string, unknown>).localStorage as Storage & {
					getItem: (k: string) => string | null;
				}).getItem('ui')
			).toBe(JSON.stringify({ count: 3 }));
			store.clear();
			const cookie = doc.cookie;
			// The mock document is last-write-wins (a real browser drops the
			// cookie on max-age=0); assert clear() wrote the expiring mirror and
			// dropped the localStorage record.
			expect(cookie.includes(persistedStoreCookieName('ui') + '=')).toBeTruthy();
			expect(cookie.includes('max-age=0')).toBeTruthy();
			expect(
				((globalThis as Record<string, unknown>).localStorage as Storage).getItem('ui')
			).toBeFalsy();
		});
	});

	it('non-persisted stores never register keys', () => {
		installPersistedStoreServerHooks({});
		resetPersistedStoreKeys();
		createStore({ count: 0 });
		expect(getPersistedStoreKeys()).toEqual([]);
	});
});

describe('createStore — array state', () => {
	// `{ ...state }` turns an array into `{"0": …}`, so an array store came back
	// corrupted from get() before any mutation happened at all.

	it('get() returns an array, not an object with numeric keys', () => {
		const store = createStore<number[]>([1, 2, 3]);
		expect(Array.isArray(store.get())).toBeTruthy();
		expect(store.get()).toEqual([1, 2, 3]);
	});

	it('an empty array seed stays an empty array', () => {
		const store = createStore<number[]>([]);
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([]);
	});

	it('set() keeps the value an array', () => {
		const store = createStore<number[]>([1]);
		store.set([1, 2, 3]);
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([1, 2, 3]);
	});

	it('array length and indexes survive a read', () => {
		const store = createStore<{ id: number }[]>([{ id: 1 }, { id: 2 }]);
		expect(store.get().length).toBe(2);
		expect(store.get()[1].id).toBe(2);
	});

	it('reset() and clear() restore an array, not an object', () => {
		const store = createStore<number[]>([1, 2, 3]);
		store.set([9]);
		store.reset();
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([1, 2, 3]);
		store.set([8]);
		store.clear();
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([1, 2, 3]);
	});

	it('rehydrate() keeps the state an array', () => {
		const store = createStore<number[]>([1]);
		store.rehydrate([4, 5] as unknown as Partial<number[]>);
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([4, 5]);
	});

	it('subscribers receive an array after a change', () => {
		const store = createStore<number[]>([1]);
		const seen: unknown[] = [];
		store.subscribe((s) => seen.push(s));
		store.set([1, 2]);
		flush_sync(() => {});
		const last = seen[seen.length - 1];
		expect(Array.isArray(last)).toBeTruthy();
		expect(last).toEqual([1, 2]);
	});

	it('update() merges onto an array without degrading to an object', () => {
		const store = createStore<number[]>([1, 2, 3]);
		store.update({ 0: 9 } as unknown as Partial<number[]>);
		expect(store.get()).toBeArray();
		expect(store.get()).toEqual([9, 2, 3]);
	});

	it('update() with a callback still returns an array', () => {
		const store = createStore<number[]>([1, 2]);
		store.update(prev => ({ length: prev.length + 1 } as Partial<number[]>));
		expect(store.get()).toBeArray();
		expect(store.get().length).toBe(3);
	});

	it('object stores are unaffected by the array handling', () => {
		const store = createStore<{ a: number; b: number }>({ a: 1, b: 2 });
		expect(store.get()).toEqual({ a: 1, b: 2 });
		store.update({ a: 5 });
		expect(store.get()).toEqual({ a: 5, b: 2 });
		expect(Array.isArray(store.get())).toBeFalsy();
	});
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
