/**
 * Vesk Runtime Tests — SSR persistence plumbing (@vesk/runtime/store-persistence)
 *
 * Shared by createStore and createPathStore: cookie mirror, key registry,
 * server read hooks and the origin-served external pre-paint payload.
 *
 * Run with: npx tsx packages/runtime/src/store-persistence.test.ts
 */
import {
	installPersistedStoreServerHooks,
	persistedStoreCookieName,
	getPersistedStoreKeys,
	resetPersistedStoreKeys,
	readPersistedStorage,
	writePersistedStorage,
	clearPersistedStorage,
	buildStorePrePaintPayload,
	storeInitScriptTag,
} from '@vesk/runtime/src/store-persistence';

let passed = 0;
let failed = 0;

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
		toEqual(expected: unknown) {
			const a = JSON.stringify(value);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toContain(expected: unknown) {
			const haystack = String(value);
			if (!haystack.includes(String(expected)))
				throw new Error(`Expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(expected)}`);
		},
	};
}

const g = globalThis as Record<string, unknown>;

function saveGlobals(): void {
	g.__saved_window = g.window;
	g.__saved_document = g.document;
	g.__saved_localStorage = g.localStorage;
}

function restoreGlobals(): void {
	if (g.__saved_window === undefined) delete g.window;
	else g.window = g.__saved_window;
	if (g.__saved_document === undefined) delete g.document;
	else g.document = g.__saved_document;
	if (g.__saved_localStorage === undefined) delete g.localStorage;
	else g.localStorage = g.__saved_localStorage;
	delete g.__saved_window;
	delete g.__saved_document;
	delete g.__saved_localStorage;
	delete g.__VESK_STORE_INIT__;
	delete g.__vsk_ssr_token;
}

function fakeClient(): { backing: Map<string, string>; doc: { cookie: string } } {
	const backing = new Map<string, string>();
	const doc = { cookie: '' };
	g.window = g;
	g.document = doc;
	g.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, v),
		removeItem: (k: string) => void backing.delete(k),
	} as unknown as Storage;
	return { backing, doc };
}

console.log('\npresent-state helpers');

it('installPersistedStoreServerHooks accepts a read hook and installs nothing when read is absent', () => {
	installPersistedStoreServerHooks({ read: () => null });
	installPersistedStoreServerHooks({});
	// both simply succeed; the hook is individually exercised below
	installPersistedStoreServerHooks({});
});

it('persistedStoreCookieName prefixes and encodes the storage key', () => {
	expect(persistedStoreCookieName('appStore')).toBe('vsk_store_appStore');
	expect(persistedStoreCookieName('a b:c')).toBe('vsk_store_a%20b%3Ac');
});

console.log("\nregistry (server-side key tracking)");

it('readPersistedStorage on the server registers the key and asks the hook', () => {
	installPersistedStoreServerHooks({ read: (key) => (key === 'ui' ? '{"a":1}' : null) });
	resetPersistedStoreKeys();
	expect(readPersistedStorage('ui')).toBe('{"a":1}');
	expect(readPersistedStorage('other')).toBe(null);
	expect(getPersistedStoreKeys()).toEqual(['ui', 'other']);
	installPersistedStoreServerHooks({});
	resetPersistedStoreKeys();
});

it('empty storageKey never registers or reads', () => {
	installPersistedStoreServerHooks({ read: () => 'x' });
	resetPersistedStoreKeys();
	expect(readPersistedStorage('')).toBe(null);
	expect(getPersistedStoreKeys()).toEqual([]);
	installPersistedStoreServerHooks({});
});

it('token bucket is isolated and explicit-token drains work', () => {
	installPersistedStoreServerHooks({});
	g.__vsk_ssr_token = 'render-1';
	expect(readPersistedStorage('k1')).toBe(null);
	g.__vsk_ssr_token = 'render-2';
	expect(readPersistedStorage('k2')).toBe(null);
	delete g.__vsk_ssr_token;
	expect(getPersistedStoreKeys('render-1')).toEqual(['k1']);
	expect(getPersistedStoreKeys('render-2')).toEqual(['k2']);
	expect(getPersistedStoreKeys()).toEqual([]);
	resetPersistedStoreKeys('render-1');
	expect(getPersistedStoreKeys('render-1')).toEqual([]);
	expect(getPersistedStoreKeys('render-2')).toEqual(['k2']);
	resetPersistedStoreKeys('render-2');
});

console.log('\nclient read/write/clear');

it('client read consumes __VESK_STORE_INIT__ and persists it to localStorage', () => {
	saveGlobals();
	try {
		const { backing } = fakeClient();
		g.__VESK_STORE_INIT__ = { ui: '{"n":5}' };
		expect(readPersistedStorage('ui')).toBe('{"n":5}');
		expect(backing.get('ui')).toBe('{"n":5}');
	} finally {
		restoreGlobals();
	}
});

it('client read falls back to localStorage when no pre-paint payload', () => {
	saveGlobals();
	try {
		const { backing } = fakeClient();
		backing.set('ui', '{"n":9}');
		expect(readPersistedStorage('ui')).toBe('{"n":9}');
	} finally {
		restoreGlobals();
	}
});

it('client read returns null when localStorage throws', () => {
	saveGlobals();
	try {
		fakeClient();
		g.localStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {},
			removeItem: () => {},
		} as unknown as Storage;
		expect(readPersistedStorage('ui')).toBe(null);
	} finally {
		restoreGlobals();
	}
});

it('client write mirrors to localStorage and the cookie; clear strips both', () => {
	saveGlobals();
	try {
		const { backing, doc } = fakeClient();
		writePersistedStorage('ui', '{"n":5}');
		expect(backing.get('ui')).toBe('{"n":5}');
		expect(doc.cookie).toContain(persistedStoreCookieName('ui') + '=' + encodeURIComponent('{"n":5}'));
		expect(doc.cookie).toContain('max-age=31536000');
		clearPersistedStorage('ui');
		expect(backing.get('ui')).toBe(undefined);
		expect(doc.cookie).toContain(persistedStoreCookieName('ui') + '=;');
		expect(doc.cookie).toContain('max-age=0');
	} finally {
		restoreGlobals();
	}
});

it('write/clear are no-ops for an empty storageKey', () => {
	saveGlobals();
	try {
		const { doc } = fakeClient();
		writePersistedStorage('', 'x');
		expect(doc.cookie).toBe('');
		clearPersistedStorage('');
		expect(doc.cookie).toBe('');
	} finally {
		restoreGlobals();
	}
});

console.log('\npre-paint payload (external, CSP-safe)');

it('buildStorePrePaintPayload emits a pure JS body — no inline script element', () => {
	const payload = buildStorePrePaintPayload({ ui: '{"theme":"dark"}' });
	expect(payload.indexOf('<script')).toBe(-1);
	expect(payload.indexOf('globalThis.__VESK_STORE_INIT__=')).toBe(0);
});

it('payload prefers localStorage and falls back to the server value per key', () => {
	saveGlobals();
	try {
		const { backing } = fakeClient();
		backing.set('local', '"client"');
		const payload = buildStorePrePaintPayload({
			local: '"server"',
			missing: '"server"',
		});
		new Function(payload)();
		const init = g.__VESK_STORE_INIT__ as Record<string, string>;
		expect(init.local).toBe('"client"');
		expect(init.missing).toBe('"server"');
	} finally {
		restoreGlobals();
	}
});

it('payload tolerates values containing script-closing text (safe outside HTML)', () => {
	const evil = '</script><script>alert(1)</script>';
	const payload = buildStorePrePaintPayload({ k: JSON.stringify(evil) });
	saveGlobals();
	try {
		fakeClient();
		new Function(payload)();
		const init = g.__VESK_STORE_INIT__ as Record<string, string>;
		expect(init.k).toBe(JSON.stringify(evil));
	} finally {
		restoreGlobals();
	}
});

it('storeInitScriptTag references the origin-served endpoint only', () => {
	expect(storeInitScriptTag('xyz')).toBe('<script src="/store-init.js?t=xyz" data-vesk-store-init></script>');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);