import { AsyncLocalStorage } from 'node:async_hooks';
// Import the type from its defining module (not the barrel): on a fresh
// checkout the compiler typechecks BEFORE @vesk/runtime's dist exists, and
// resolving types through the barrel then fails.
import { setSsrSink } from '@vesk/runtime/src/index-server';
import type { SsrDataSink } from '@vesk/runtime/src/resource';

const TOKEN_KEY = '__vsk_ssr_token';

export interface SsrStore {
  /** Per-request token. Keyed data slots hang off this, so it must be unique
   *  per concurrent render — a shared token lets a finishing render delete a
   *  stranger's data slot. */
  token?: string;
  /** Handoff data for the current request. */
  data: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<SsrStore>();

/**
 * Tokens whose `__vsk_ssr_data_<token>` slot a live render still owns, with a
 * refcount. A request runs `renderPage` (page) -> `renderPage` (each nested
 * layout) -> `renderFullPage` (document) inside ONE store, and each of those
 * claims the slot on entry and releases it on exit. A plain Set would let the
 * first inner release revoke the claim the document render still depends on,
 * so the reaper could reap a live request's handoff. Counts balance instead.
 */
const liveSlots = new Map<string, number>();

function newSsrToken(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * A store that is not yet attached to a scope. Callers that drive several
 * scopes (streaming renders) own it and hand it to `withSsrStoreOf` so the
 * token and sink survive across the boundary.
 */
export function createSsrStore(): SsrStore {
  return { token: newSsrToken(), data: {} };
}

/**
 * The store for the current request: the ambient one when a scope is already
 * open, otherwise a fresh caller-owned one. Callers that outlive a single
 * `withSsrStore` (streaming renders drive chunks from the consumer, long after
 * the scope's promise resolved) use this so their work still lands on the
 * request's token instead of minting a second one.
 */
export function adoptSsrStore(): SsrStore {
  return storage.getStore() ?? createSsrStore();
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === 'function';
}

/**
 * Run `fn` in a request scope, reusing the ambient store when one is open.
 *
 * The scope owns a claim on its token for its whole lifetime, which is what
 * keeps a request's data slot reap-exempt between its stages. A request runs
 * `renderPage` (page) -> `renderPage` (each nested layout) -> `renderFullPage`
 * (document), and each of those claims and releases the slot on entry/exit.
 * Without the scope-level claim the token is briefly unowned between stages, so
 * with more than ~40 renders in flight a concurrent reaper sees the slot as
 * abandoned and deletes the data the document render still has to serialize.
 */
export function withSsrStore<T>(fn: () => T): T {
  const existing = storage.getStore();
  if (existing) return fn();
  const store = createSsrStore();
  keepSsrSlot(store.token);
  let result: T;
  try {
    result = storage.run(store, fn);
  } catch (err) {
    dropSsrSlot(store.token);
    throw err;
  }
  // A streaming render hands back a Response while its body is still pending;
  // releasing on promise settlement is exactly right for both cases, because a
  // render that outlives the scope claims the token itself (renderPageStream).
  if (isThenable(result)) {
    return result.then(
      (value) => { dropSsrSlot(store.token); return value; },
      (err) => { dropSsrSlot(store.token); throw err; }
    ) as T;
  }
  dropSsrSlot(store.token);
  return result;
}

/**
 * Run `fn` in a scope backed by a caller-owned store, so the token and the sink
 * survive across `yield`s. Streaming renders need this: each `next()` is driven
 * by the consumer, not by the generator, so a per-`next()` `withSsrStore` would
 * mint a new token every chunk and every data slot written by an earlier chunk
 * would be orphaned.
 */
export function withSsrStoreOf<T>(store: SsrStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** The current request's token, or undefined outside a render scope. */
export function currentSsrToken(): string | undefined {
  return storage.getStore()?.token;
}

/**
 * Mint a fresh token for the current scope. Used by the dev servers' data-nav
 * path, which renders several routes within one request and must not let an
 * earlier route's slot settle into a later one.
 */
export function resetSsrToken(): string {
  const store = storage.getStore();
  const token = newSsrToken();
  if (store) {
    if (store.token) liveSlots.delete(store.token);
    store.token = token;
  }
  // The caller owns the request from here, so hold the claim for the whole
  // scope: nested page/layout renders each add and remove their own count, and
  // this one keeps the slot reap-exempt until the caller is done with it.
  liveSlots.set(token, 1);
  return token;
}

/** Claim a token's data slot so the reaper never deletes it mid-render. */
export function keepSsrSlot(token: string | undefined): void {
  if (!token) return;
  liveSlots.set(token, (liveSlots.get(token) ?? 0) + 1);
}

/** Release one claim on a token's data slot. */
export function dropSsrSlot(token: string | undefined): void {
  if (!token) return;
  const count = liveSlots.get(token);
  if (count === undefined) return;
  if (count <= 1) liveSlots.delete(token);
  else liveSlots.set(token, count - 1);
}

/**
 * True while a render still owns this token's slot. Slots are keyed by
 * per-request tokens, so a cap-based reaper that ignores ownership deletes a
 * *concurrent* request's handoff and the second page ships with no ssr-data
 * script — the original bug, just triggered by load instead of interleaving.
 */
export function isSsrSlotLive(token: string): boolean {
  return liveSlots.has(token);
}

export const ssrSink: SsrDataSink = {
  set: (key, value) => {
    const store = storage.getStore();
    if (store) store.data[key] = value;
  },
  get: (key) => {
    const store = storage.getStore();
    return store ? store.data[key] : undefined;
  },
  snapshot: () => ({ ...(storage.getStore()?.data ?? {}) }),
  clear: () => {
    const store = storage.getStore();
    if (store) {
      for (const key of Object.keys(store.data)) delete store.data[key];
    }
  },
};

setSsrSink(ssrSink);

// The generated server code reads `globalThis.__vsk_ssr_token` synchronously
// at the top of every component render, and the runtime's promise tracker and
// data writers read it the same way. Back that global with the ALS store so
// those readers become request-scoped instead of process-global. Before this,
// two concurrent renders adopted the same token and whichever finished first
// deleted the other's data slot, so the second page shipped with an empty
// handoff and the client refetched what SSR already had.
//
// Outside a render scope the accessor reads/writes nothing, which is what
// keeps a stray write from leaking into the next request. Bundles that never
// load this module keep the plain global and the previous behaviour.
//
// NEVER `delete globalThis.__vsk_ssr_token`. This is a configurable accessor,
// so `delete` removes the property definition outright — it does not route
// through the setter — and the process silently falls back to a
// process-global token, reintroducing the race for every later request. Clear
// a token by assigning through `globalThis` inside a scope, or with
// `resetSsrToken`.
Object.defineProperty(globalThis, TOKEN_KEY, {
  configurable: true,
  get() {
    return storage.getStore()?.token;
  },
  set(value: string | undefined) {
    const store = storage.getStore();
    if (store) store.token = value;
  },
});
