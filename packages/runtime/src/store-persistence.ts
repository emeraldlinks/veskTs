/**
 * Shared SSR persistence plumbing for `@vesk/runtime/store` (`createStore`)
 * and `@vesk/runtime/path-store` (`createPathStore`). Both stores read and
 * write through the same hooks so the adapter and the blocking pre-paint
 * script serve every persisted store identically.
 *
 * How SSR continuity works:
 * - On the SERVER a persisted store reads its value through an
 *   adapter-installed hook (`installPersistedStoreServerHooks`), typically
 *   backed by a request cookie, and registers its `storageKey` so the adapter
 *   can emit a blocking pre-paint script right after the render.
 * - The pre-paint script is delivered as an ORIGIN-SERVED JavaScript file
 *   (like the `/ssr-data.js` hydration handoff), never inlined into the HTML:
 *   strict CSP without `unsafe-inline` must not block it. The adapter stashes
 *   the payload built by `buildStorePrePaintPayload` under a CSPRNG token and
 *   injects a `<script src="/store-init.js?t=<token>">` tag into `<head>`; the
 *   server serves that file once per token. It populates
 *   `window.__VESK_STORE_INIT__` before first paint from localStorage (with
 *   the server-rendered, cookie-read value as the first-visit fallback).
 * - On the CLIENT the store prefers `window.__VESK_STORE_INIT__[key]`, then
 *   falls back to localStorage. It mirrors every write to a same-site cookie so
 *   the NEXT server render can read the user's actual value back — no theme
 *   flash, no default-content first paint, SEO-correct.
 *
 * Registration is bucketed per request token (`globalThis.__vsk_ssr_token`,
 * the compiler's AsyncLocalStorage accessor) so concurrent SSR renders never
 * mix each other's persisted keys. The adapter captures the render token at
 * its `renderPageStream` call site and passes it to the registry drain, so
 * even a streamed body pumped after the scope settled reports into the right
 * bucket. Renders that genuinely run outside any scope use the default bucket.
 *
 * SSR-safe: nothing here touches `document`/`localStorage` at module scope,
 * and every browser access is guarded + wrapped in try/catch. No `batch`.
 */
export type PersistedStoreRead = (storageKey: string) => string | null | undefined;

export type PersistedStoreHooks = {
  read?: PersistedStoreRead;
};

let serverReadHook: PersistedStoreRead | null = null;

/**
 * Install server-side persistence hooks (called by the adapter). `read`
 * returns the persisted raw JSON string (typically from a request cookie) or
 * null. The hook is a module-level singleton that reads request-scoped state
 * itself (e.g. `globalThis.__vesk_request`), so installing it once per module
 * load is safe under concurrent requests.
 */
export function installPersistedStoreServerHooks(hooks: PersistedStoreHooks): void {
  serverReadHook = typeof hooks.read === 'function' ? hooks.read : null;
}

/** The request token scoping persisted-key registrations, or '' outside a render. */
function currentSsrToken(): string {
  const g = globalThis as { __vsk_ssr_token?: unknown };
  return typeof g.__vsk_ssr_token === 'string' ? (g.__vsk_ssr_token as string) : '';
}

/** The cookie name a persisted store is mirrored to, for SSR continuity. */
export function persistedStoreCookieName(storageKey: string): string {
  return 'vsk_store_' + encodeURIComponent(storageKey);
}

const pendingKeys = new Map<string, Set<string>>();

function bucketFor(token: string): Set<string> {
  const set = pendingKeys.get(token);
  if (set) return set;
  const fresh = new Set<string>();
  pendingKeys.set(token, fresh);
  return fresh;
}

/**
 * The storage keys of persisted stores constructed in this SSR render.
 * `token` overrides the ambient request token for callers that drain the
 * registry outside the render scope (the no-layout streaming path captures
 * the render token at its `renderPageStream` call site and passes it here).
 */
export function getPersistedStoreKeys(token?: string): string[] {
  const set = pendingKeys.get(token ?? currentSsrToken());
  return set ? Array.from(set) : [];
}

/** Clear the constructed-key registry (called per SSR render by the adapter). */
export function resetPersistedStoreKeys(token?: string): void {
  pendingKeys.delete(token ?? currentSsrToken());
}

/**
 * Read a persisted store's raw JSON for the current environment:
 * - server: register the key (so the adapter emits the pre-paint script) and
 *   ask the installed read hook,
 * - client: consume `window.__VESK_STORE_INIT__[key]` if present (then write
 *   it back to localStorage so a later client pickup still works), else read
 *   localStorage.
 */
export function readPersistedStorage(storageKey: string): string | null {
  if (!storageKey) return null;
  if (typeof window === 'undefined') {
    bucketFor(currentSsrToken()).add(storageKey);
    return serverReadHook ? (serverReadHook(storageKey) ?? null) : null;
  }
  const init = (globalThis as { __VESK_STORE_INIT__?: Record<string, string> }).__VESK_STORE_INIT__;
  if (init && init[storageKey] !== undefined) {
    const raw = init[storageKey];
    delete init[storageKey];
    try {
      localStorage.setItem(storageKey, raw);
    } catch {
      /* storage blocked — the in-memory value still applies */
    }
    return raw;
  }
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/**
 * Persist a store's raw JSON on the client: localStorage plus a same-site
 * cookie mirror (best effort, small stores) so the next server render sees it.
 */
export function writePersistedStorage(storageKey: string, raw: string): void {
  if (!storageKey) return;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(storageKey, raw);
    } catch {
      /* storage blocked — the cookie mirror still applies */
    }
  }
  if (typeof document !== 'undefined') {
    try {
      document.cookie =
        persistedStoreCookieName(storageKey) +
        '=' +
        encodeURIComponent(raw) +
        '; path=/; max-age=31536000; SameSite=Lax';
    } catch {
      /* cookie blocked — client still persists via localStorage */
    }
  }
}

/** Remove a persisted store's localStorage record and expire its cookie mirror. */
export function clearPersistedStorage(storageKey: string): void {
  if (!storageKey) return;
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined') {
    try {
      document.cookie = persistedStoreCookieName(storageKey) + '=; path=/; max-age=0';
    } catch {
      /* ignore */
    }
  }
}

/**
 * Plain JS that copies each persisted store's localStorage value into
 * `window.__VESK_STORE_INIT__` before first paint. `serverValues` maps
 * storageKey → the value the server rendered with (cookie read), used as a
 * fallback so the very first client visit does not flash defaults.
 *
 * This is served as an origin-hosted script file (`/store-init.js?t=<token>`),
 * never inlined into the HTML, so strict CSP without `unsafe-inline` cannot
 * block it. Because the file has no HTML context, JSON.stringify output can be
 * embedded directly (JSON is a valid JS literal) — no escaping needed. Safe
 * for `</script>`-style content precisely because it never sits inside a
 * script element.
 */
export function buildStorePrePaintPayload(serverValues: Record<string, string | null>): string {
  return (
    'globalThis.__VESK_STORE_INIT__=(function(){' +
    'var S=' +
    JSON.stringify(serverValues) +
    ';' +
    'var E={};' +
    'for(var k in S){var v=null;try{v=localStorage.getItem(k);}catch(e){}' +
    'if(v===null)v=S[k];if(v!=null)E[k]=v;}' +
    'return E;' +
    '})();\n'
  );
}

/** The `<script src>` reference for one store-init payload token. */
export function storeInitScriptTag(token: string): string {
  return '<script src="/store-init.js?t=' + token + '" data-vesk-store-init></script>';
}