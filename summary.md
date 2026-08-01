# VeskTS Development Summary - 2026-08-01

## Overview
Implemented a complete, production-ready `useFetch` system for Vesk with SWR-style caching, request deduplication, retries, timeouts, and tracked cell integration. Added demo API endpoint and page showcasing all features.

---

## Core Runtime Changes

### 1. New Teardown Callback API (`packages/runtime/src/ripple-runtime.ts`)
- Added `Block.tc: (() => void)[]` field for teardown callbacks
- Modified `run_teardown()` to execute callbacks after main teardown function
- Added `on_destroy(fn: () => void)` exported from both `index-client.ts` and `index-server.ts`
- Enables registering cleanup logic (like aborting fetches) that runs on component unmount

### 2. Complete `resource.ts` Rewrite (`packages/runtime/src/resource.ts`)

#### Type Definitions
```typescript
export interface UseFetchOptions<T> extends Omit<RequestInit, 'body'> {
  key?: string;
  into?: Tracked;
  body?: unknown;           // plain objects auto-JSON-stringified
  staleTime?: number;       // cache freshness in ms
  keepPreviousData?: boolean; // show stale data during revalidation
  retry?: number;           // retries (GET only, default 0)
  retryDelay?: number;      // base delay for exponential backoff (default 1000ms)
  timeout?: number;         // request timeout in ms
  enabled?: boolean;        // skip fetch when false
  dedupe?: boolean;         // deduplicate in-flight requests (default true)
}
```

#### Features Implemented

**Fetch/Axios-like Options**
- Full `RequestInit` compatibility: `method`, `headers`, `credentials`, `cache`, `mode`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`, `signal`
- Plain object `body` auto-stringified with `Content-Type: application/json`
- FormData, URLSearchParams, Blob, ArrayBuffer pass through unchanged

**Request Deduplication**
- In-flight requests shared by `key` (defaults to URL)
- Per-render token scoping on SSR (`__vsk_ssr_promises_${token}`)
- Cross-component dedup within same render
- `dedupe: false` opt-out per request

**Caching (SWR-style)**
- In-memory client cache: `__vsk_fetch_cache` Map
- `staleTime` — serve cached data without fetch while fresh
- `keepPreviousData: true` — keep old data on screen during revalidation
- `mutate(key, data?)` — update cache and all live consumers, or revalidate

**Retry with Exponential Backoff**
- Only retries GET requests (or methods not explicitly set)
- Never retries 4xx errors (client errors)
- Retries on network failure or 5xx server errors
- Configurable base delay: `retryDelay * 2^attempt`

**Timeout**
- Race-based timeout (works even with custom fn fetchers)
- Combines with user-provided `signal` via `AbortSignal.any` + manual fallback
- Returns `TimeoutError` on timeout

**Abort & Lifecycle**
- `refresh()` — force revalidation (bypasses stale cache, aborts in-flight)
- `abort()` — cancel current request
- `enabled: false` — skip fetch entirely
- `on_destroy` + `is_destroyed` guard — abort on unmount, no writes to dead cells
- Abort-on-replace: new request for same key aborts previous

**SSR Integration**
- Token-scoped promises: `__vsk_ssr_promises_${token}`
- Token-scoped data: `__vsk_ssr_data` per render
- `resolveSsrResources()` awaits all promises, returns serialized data
- `globalThis.__vsk_ssr_data = {...}` script injection (not `const` — visible on `globalThis` in browser)

**Error Handling**
- `HttpError` with `.status` property for non-2xx responses
- `TimeoutError` for timeouts
- 4xx never retried
- Abort errors silently ignored (don't set error state)

**Static Helpers**
```typescript
useFetch.text(url, options?)   // .text() parse
useFetch.json(url, options?)   // .json() parse (default)
useFetch.arrayBuffer(url, options?) // .arrayBuffer() parse
// All use fn-form internally for custom parsing
```

---

## Compiler Changes

### 1. Tracked Cell For-In Loops (`packages/compiler/src/server-jsgen.ts`)
- `for (const x in trackedCell)` compiles to `for (const x of get(trackedCell))`
- Automatic detection via `trackedExprRefs()`
- Works in all server emit functions: `staticNodeToJS`, `dynamicBindingToJS`, `opaqueRegionToJS`, `mapRegionToJS`, `whileLoopToJS`, `switchBlockToJS`, `tryCatchToJS`, `forLoopToJS`, `componentCallToJS`

### 2. Tracked Cell Declaration (`TrackDecl`)
- Creates real tracked cells in `__vsk_ssr_cells` Map with per-render token keys
- Init evaluation wrapped in try/catch falling back to `track(void 0)` (handles TDZ: `let &[Header] = track(Header)`)
- `get/set/track` auto-added to component scope when any component has `TrackDecl`

### 3. SSR Re-render Loop (`generateFunctionBody`)
- Up to 3 passes for async components (`ssrAwait: true`)
- Pass 1: render loading state, collect promises
- Pass 2+: await `Promise.allSettled`, re-render with data
- Returns `''` if still pending after 3 passes

### 4. Component Auto-detection (`packages/compiler/src/ir-generator.ts`)
- `componentUsesFetch(nodes)` scans IR for `useFetch(` calls
- Sets `ssrAwait: true` on `ComponentIR`
- Server codegen wraps async components in async IIFE

### 5. Tracked Transform Export (`packages/compiler/src/client-codegen.ts`)
- Exported `TrackedInfo`, `transformTracked`, `collectTrackedNames`
- `transformTracked` exempts `into:` property — passes cell identity, not `get(cell)`

---

## Demo Implementation

### API Endpoint: `test-app/app/api/posts/route.ts`
```typescript
// GET /api/posts?delay=500&fail=10&limit=3
// Returns array of 5 posts with: id, title, slug, excerpt, body, author, tags, date
// Supports delay (simulated latency), fail (random 503), limit
```

### Page: `test-app/app/posts/page.vsk`
Showcases full `useFetch` capability:
```typescript
let &[posts] = track<Post[]>([])
const postsResource = useFetch('/api/posts', {
  key: 'posts',
  into: posts,
  staleTime: 30000,
  keepPreviousData: true,
  retry: 2,
  retryDelay: 400,
  timeout: 8000,
})
// Renders with: loading states, error + retry, refresh button, for-in loop
```

### Layout Update: `test-app/app/layout.vsk`
Added "Posts" nav link

---

## Tests Added

### Runtime Tests: `packages/runtime/src/resource.test.ts` (21 tests)
1. **Fetch options**: method, headers, JSON body, credentials
2. **HTTP errors**: `HttpError` with status, no retry on 4xx
3. **Retry**: 3 attempts with backoff, success on 3rd
4. **Non-GET no retry**: POST with 500 doesn't retry
5. **Timeout**: hangs → `TimeoutError`
6. **Dedup**: 2 components same key = 1 fetch
7. **Dedup false**: separate requests
8. **StaleTime cache**: 2nd call within window = no fetch
9. **StaleTime expiry**: refetch after window
10. **keepPreviousData**: loading=true, data=old during refresh
11. **mutate(key, data)**: instant update all consumers
12. **mutate(key)**: revalidate all consumers
13. **refresh()**: bypasses stale cache
14. **enabled: false**: no fetch, loading=false
15. **Abort on destroy**: `destroy_block` → fetch aborted
16. **No abort on re-run**: `run_block` → no abort
17. **SSR pass loop**: token-scoped promises, `__vsk_ssr_data` written
18. **SSR dedup**: 2 components same key = 1 fetch
19. **createResource fn + into**: writes to tracked cell
20. **useFetch.text/json/arrayBuffer**: helpers work
21. **createResource with options**: full option passing

### Integration Tests (updated)
- 3 new tests in `integration.test.ts` for `into` + for-in SSR rendering
- Async test runner serialized to prevent global state conflicts
- `globalThis.fetch` save/restore instead of delete

---

## Test Results

### Before Changes
- 831 tests passing (27 files)

### After Changes
- **852 tests passing** (28 files, 21 new tests added)
- All typechecks clean: `npm run tsc` on compiler, runtime, adapter
- Build clean: `npm run build`
- E2E suites: code-split (12), hmr (20), hydration (28), prod-hydration (34), edge (23)

---

## Key Design Decisions

1. **Fetch-like API**: `UseFetchOptions` extends `Omit<RequestInit, 'body'>` + `body?: unknown` — familiar to all JS developers
2. **No `parse` option**: Default `.json()`, use `useFetch.text()` or fn-form for custom parsing
3. **Dedup by key**: URL is default key, custom key for different endpoints same data
4. **Token-scoped SSR**: No cross-request data leakage, safe for concurrent renders
5. **Abort on unmount via `on_destroy`**: No framework-specific hooks needed
6. **Retry GET only**: Safe default, non-idempotent methods never retried
7. **Race-based timeout**: Works with any fetcher (fn-form or string URL)

---

## Files Modified/Added

### Core Runtime
- `packages/runtime/src/ripple-runtime.ts` — `Block.tc`, `on_destroy`, `run_teardown`
- `packages/runtime/src/ripple-blocks.ts` — `Block.tc = null` in constructor
- `packages/runtime/src/index-client.ts` — export `on_destroy`
- `packages/runtime/src/index-server.ts` — export `on_destroy`
- `packages/runtime/src/resource.ts` — **complete rewrite** (504 lines)
- `packages/runtime/src/resource.test.ts` — **new** (21 tests)

### Compiler
- `packages/compiler/src/server-jsgen.ts` — tracked for-in, TrackDecl, SSR loop, async components
- `packages/compiler/src/ir-generator.ts` — `componentUsesFetch`, `ssrAwait`
- `packages/compiler/src/ir.ts` — `ComponentIR.ssrAwait`
- `packages/compiler/src/client-codegen.ts` — export `TrackedInfo`, `transformTracked`, `collectTrackedNames`; `into:` exemption
- `packages/compiler/src/integration.test.ts` — 3 new tests, async serialization

### Demo App
- `test-app/app/api/posts/route.ts` — **new** (posts API with delay/fail/limit)
- `test-app/app/posts/page.vsk` — **new** (full feature demo page)
- `test-app/app/layout.vsk` — added Posts nav link

### Cleanup
- Removed `chrome-headless-shell/` (187MB binary) from git history via `git filter-branch`
- Deleted all `.js`, `.js.map`, `.d.ts.map`, `.test.js` build artifacts
- Cleaned up `.gitignore`

---

## Migration Notes

### Breaking Changes
- `useFetch` no longer accepts `parse` option
  - **Before**: `useFetch(url, { parse: r => r.text() })`
  - **After**: `useFetch.text(url)` or `useFetch(() => fetch(url).then(r => r.text()))`
- `createResource` signature unchanged (backward compatible)

### New Capabilities
- All standard `fetch` options now supported
- SWR-style caching with `staleTime` + `keepPreviousData`
- Request deduplication out of the box
- Automatic retry with backoff
- Timeout that works with custom fetchers
- `into` tracked cell + for-in loops render inline
- `mutate()` for cache invalidation
- `refresh()` / `abort()` on accessor

---

## Future Improvements (Not Implemented)

1. **Reactive keys**: `useFetch(() => url, { depends: [dep1, dep2] })` — auto-refetch on dep change
2. **Server-side shared cache**: Cross-request dedup cache (requires cache key normalization)
3. **Per-region re-render**: Only re-render affected `MapRegion` on data arrival
4. **Prefetch on hover**: For navigation optimization
5. **WebSocket/SSE support**: Real-time updates via same tracked cell pattern