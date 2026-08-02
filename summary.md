# VeskTS Development Summary - 2026-08-02

## Overview
This session added three demo pages exercising every supported JS statement in the compiler (if/else, ternary, switch, for, for-in, for-of, while, do-while, try/catch+throw, labeled blocks, runtime statements, async `load()`, inline `.map()`), curled each page one at a time, and fixed four real compiler/dev-server bugs uncovered along the way. Ended with `hydration-test.mjs` at 60/60 passing.

---

## New Demo Pages (`test-app/app`)

### `/statements` — `app/statements/page.vsk`
Exercises statement-mode compilation of every supported construct with visible SSR output:
- `if / else` blocks, ternary expressions
- `switch` with JSX cases + `break`
- `for` loop with counter, `for-of` over array values, `for-in` over object keys
- `while` and `do-while` loops (shared counter carries across)
- `try / catch / throw` (`throw new Error('Boom!')` caught and rendered)
- labeled block (`summary: { ... }`)
- runtime statements (`const total = items.length * 2`, counter mutation)

### `/async` — `app/async/page.vsk`
- `export async function load()` — fetches `/api/posts` during SSR using `globalThis.__vesk_ssr_base_url` (set per-request by the dev server), returns `{ props: { posts } }`
- `for-of` over `props.posts` renders post cards

### `/map` — `app/map/page.vsk`
- Inline `.map()` in JSX: single-param, index-param `(u, i)`, keyed maps (`key={n}`), chained `filter().map()`

### Layout
- `test-app/app/layout.vsk` — added Statements/Async/Map `NavLink`s

---

## Bug Fixes

### 1. `renderPage` ignored `load()` (`packages/compiler/src/server-render.ts`)
- Dev server calls `renderPage` directly (not `renderFullPage`); `renderPage` never ran `loadFn`, so `/async` 500'd with `props.posts is not iterable`.
- Refactored `renderPage` into a `doRender(ssrProps)` closure; when `ir.loadFn` exists it awaits `callLoadFunction`, merges `result.props` (or the result itself) into props, then renders. Sync path preserved for pages without `loadFn`.

### 2. `.map((item, index) => ...)` index param dropped
- `MapRegion` IR gained `indexVariable: string | null` (`packages/compiler/src/ir.ts`).
- `ir-generator.ts` extracts `arrowFn.params[1]?.name` at both map-call sites.
- Server (`server-jsgen.ts` `mapRegionToJS`): emits `let __i = 0; for (const item of arr) { const i = __i; ...; __i++; }`.
- Client (`client-codegen.ts` `emitMap`): `renderItem` gains `__i` param; non-keyed loops pass a counter; keyed path passes index through.
- Runtime (`packages/runtime/src/reconcile.ts`): `createItem(item, index, effs)` — index threaded through initial render and reconcile re-renders.

### 3. Home page rendered the wrong component (`packages/compiler/src/server-utils.ts`)
- `resolveComponentName` preferred the first **exported** component; home page's `export component Appx`/`Appxx` beat `component Home`, so `/` showed `Appx`'s body.
- New precedence: `defaultExport` → **first component** → exported component (matches all page conventions: home/about/blog use first, posts uses `export default`).

### 4. Client bundle duplicate `export default` broke hydration
- `compileClient` emits `export default __components["Posts"]` for default-export pages; `generateClientBundle` (adapter `client-bundle.ts`) only stripped `export const|let|var ...` lines, so a single `/_vesk/client.js` module ended up with **two** `export default` statements → browser error `Identifier '.default' has already been declared` killed hydration (no count updates, markers never claimed).
- Fixed by stripping `export default __components[...]` in both the code-split `compileFile` and mono `compileFileMono` paths (new `stripExports` helper), plus the dev-server HMR compile path.

---

## Verification

- All 8 pages HTTP 200 with correct content: `/`, `/about`, `/blog`, `/blog/hello-world`, `/posts`, `/statements`, `/async`, `/map`
- `hydration-test.mjs`: **60/60 passed** (was failing on JS error on load, reactivity, error boundaries, markers claimed)
- Compiler unit suites: client-codegen **104**, server-codegen **69**, integration **77** — all green
- `tsc --noEmit` clean on compiler, runtime, adapter, cli

---

## Previous Session: useFetch System (2026-08-01)

### Core Runtime Changes

#### `packages/runtime/src/ripple-runtime.ts`
- `Block.tc: (() => void)[]` teardown callbacks; `on_destroy(fn)` exported from `index-client.ts`/`index-server.ts`

#### `packages/runtime/src/resource.ts` — complete rewrite
- Full `RequestInit` compatibility, JSON body auto-stringify
- Request dedup by key, per-render token scoping on SSR
- SWR-style cache: `staleTime`, `keepPreviousData`, `mutate(key, data?)`
- Retry with exponential backoff (GET only, never 4xx)
- Race-based `timeout`, `HttpError`/`TimeoutError`, abort on unmount via `on_destroy`
- SSR: `resolveSsrResources()`, `globalThis.__vsk_ssr_data` injection
- Helpers: `useFetch.text/json/arrayBuffer`, fn-form for custom fetchers

#### Compiler
- Tracked for-in loops (`for (const x in trackedCell)` → `get(...)`), `TrackDecl` with per-render token keys, 3-pass SSR re-render loop for async components, `ssrAwait` auto-detection

#### Demo
- `test-app/app/api/posts/route.ts` (`?delay=&fail=&limit=`), `test-app/app/posts/page.vsk` full feature demo, Posts nav link

#### Tests
- `resource.test.ts` (21 tests); integration tests +3; total **852 passing** (28 files)

---

## Files Changed This Session

### Compiler
- `packages/compiler/src/server-render.ts` — `renderPage` runs `loadFn`
- `packages/compiler/src/server-utils.ts` — `resolveComponentName` precedence
- `packages/compiler/src/ir.ts` — `MapRegion.indexVariable`
- `packages/compiler/src/ir-generator.ts` — extract map index param
- `packages/compiler/src/server-jsgen.ts` — index-aware `mapRegionToJS`
- `packages/compiler/src/client-codegen.ts` — index-aware `emitMap`

### Runtime
- `packages/runtime/src/reconcile.ts` — `createItem(item, index, effs)`

### Adapter / CLI
- `packages/adapter/src/client-bundle.ts` — strip `export default` from bundle (both paths)
- `packages/cli/src/dev-server.ts` — strip `export default` in HMR compile; HMR client injection

### Demo App
- `test-app/app/statements/page.vsk` — **new**
- `test-app/app/async/page.vsk` — **new**
- `test-app/app/map/page.vsk` — **new**
- `test-app/app/layout.vsk` — new nav links

---

## Future Improvements (Not Implemented)

1. **`.vsk` as a first-class TS toolchain citizen**: make `tsc` typecheck `.vsk` and `tsx` execute `.vsk` "just as `.tsx`" — e.g., a `.vsk → .tsx` transpile step (or `foo.vsk.d.ts` + `allowArbitraryExtensions`) for tsc, and a Node module-loader hook (chained via `node --import`) or esbuild plugin for tsx
2. **Reactive keys**: `useFetch(() => url, { depends: [dep1, dep2] })`
3. **Server-side shared cache**: cross-request dedup
4. **Per-region re-render** of `MapRegion` on data arrival
5. **Prefetch on hover**, WebSocket/SSE support
