// Process/isolate-wide server context — shared across every request.
//
// `onStart` handlers (from `app/_events.ts` or plugin `onStart` hooks) call
// `setServerContext(key, value)` here; the store is then pre-seeded into every
// request's middleware `locals`, so `locals()` in SSR renders, API routes and
// middleware all see what boot setup produced. On serverless/edge targets the
// store lives for the lifetime of the isolate (typically one cold request).
interface ServerContextStore {
	[k: string]: unknown;
}

function getStore(): ServerContextStore {
	const g = globalThis as Record<string, unknown>;
	if (!g.__vesk_server_ctx || typeof g.__vesk_server_ctx !== 'object') {
		g.__vesk_server_ctx = {};
	}
	return g.__vesk_server_ctx as ServerContextStore;
}

/** The server-wide context object shared across every request in this process. */
export function server_locals(): Record<string, unknown> {
	return getStore();
}

/** Read one server-wide context value (undefined when unset). */
export function get_server_context(key: string): unknown {
	return getStore()[key];
}

/** Write one server-wide context value, visible to every subsequent request. */
export function set_server_context(key: string, value: unknown): void {
	getStore()[key] = value;
}

/** Wipe the entire server-wide context. */
export function clear_server_context(): void {
	const store = getStore();
	for (const key of Object.keys(store)) delete store[key];
}

export const serverLocals = server_locals;
export const getServerContext = get_server_context;
export const setServerContext = set_server_context;
export const clearServerContext = clear_server_context;