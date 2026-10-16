/**
 * Per-request security overrides.
 *
 * `VeskRequest.setCsp()`, `.setSecurityHeader()`, `.setRateLimit()` and
 * `.setCsrf()` accumulate overrides while a handler runs, and the servers have
 * to apply them to the outgoing response. That channel did not exist: the
 * setters wrote to a field on the request and nothing ever read it, so every
 * one of those methods was a silent no-op in dev AND prod.
 *
 * The runtime and the adapter servers do not import each other (the runtime is
 * injected into generated code as a string), so the channel is registered on
 * `globalThis` instead of imported. State lives in an AsyncLocalStorage, so two
 * concurrent requests cannot see each other's overrides — a plain module-level
 * slot would let a slow request bleed its CSP into an unrelated one.
 *
 * This module must never touch `document`/`window`: it is pulled in by both
 * the server and the client barrel.
 */

type Overrides = Record<string, unknown>;

interface AsyncLocalStorageLike<T> {
	getStore(): T | undefined;
	run<R>(store: T, fn: () => R): R;
}

const g = globalThis as Record<string, unknown>;

// Node's AsyncLocalStorage, when there is one. Absent in the browser and in
// bundlers that stub it, where the fallback below keeps everything working
// (single-request-at-a-time).
function resolveAls(): AsyncLocalStorageLike<Overrides> | null {
	try {
		const proc = g.process as { getBuiltinModule?: (id: string) => unknown } | undefined;
		const mod = proc?.getBuiltinModule?.('async_hooks');
		const ctor = (mod as { AsyncLocalStorage?: new () => AsyncLocalStorageLike<Overrides> })?.AsyncLocalStorage;
		return ctor ? new ctor() : null;
	} catch {
		return null;
	}
}

const als: AsyncLocalStorageLike<Overrides> | null = resolveAls();
// Fallback store for environments without AsyncLocalStorage (browser bundles,
// edge isolates). Correct for sequential requests, which is all it has to be.
let fallbackStore: Overrides | null = null;

function current(): Overrides | null {
	if (als) return als.getStore() ?? null;
	return fallbackStore;
}

/** Run `fn` with a fresh override bag; nested calls get their own bag. */
export function runWithSecurityOverrides<T>(fn: () => T): T {
	const bag: Overrides = {};
	if (als) return als.run(bag, fn);
	const prev = fallbackStore;
	fallbackStore = bag;
	try {
		return fn();
	} finally {
		fallbackStore = prev;
	}
}

/** Record one override. No-op outside a `runWithSecurityOverrides` scope. */
export function setSecurityOverride(key: string, value: unknown): void {
	const bag = current();
	if (bag) bag[key] = value;
}

/** The overrides recorded so far, or null when nothing has been set. */
export function getSecurityOverrides(): Overrides | null {
	const bag = current();
	if (!bag) return null;
	return Object.keys(bag).length > 0 ? bag : null;
}

// Bridge for the servers, which cannot import this module. Registered at
// module load so `globalThis.__vesk_security.run(fn)` is always available in a
// process that has the runtime loaded.
const bridge = {
	run: runWithSecurityOverrides,
	get: getSecurityOverrides,
	set: setSecurityOverride,
};
const existing = (g.__vesk_security as Record<string, unknown> | undefined) || {};
g.__vesk_security = { ...existing, ...bridge };