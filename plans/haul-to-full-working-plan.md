# Haul to Full Working State — Plan

## Goal
Get `haul dev` and `haul start` fully functional so hydration tests pass with zero failures.

## Current State (Baseline)
- `haul build` ✅: generates client bundle, SSR functions, API functions, middleware, CSS, config
- `haul start` ❌: serves static + HTML, SSR/API/action execution stubbed (sidecar not yet used)
- `haul dev` ❌: starts sidecar only, no rebuild on change, no HMR

## Key Contracts from Hydration Test (from hydration-test.mjs)

| Test | Requirement |
|---|---|
| Test 1 (Initial load) | HMR overlay `#__vesk_dev` with "Vesk" text and `.__v_dot` with `connected`/`loading` class on every page |
| Test 8 (Tailwind CSS) | `_tailwind.css` >1000 bytes, includes `@layer theme`, `text-4xl`, `font-bold`; `global.css` stripped of Tailwind content; both `<link>`s in HTML |
| Test 10 (Hydration strategies) | `/_vesk/runtime.js` exports `hydrateViewport`, `hydrateIdle`, `hydrateOnInteraction`, `collectVskMarkers`, `createHydrateWalker`, `hydrateInitial` |
| Test 9 (Streaming) | `Transfer-Encoding: chunked` on responses |
| Test 11 (Server renderPageStream) | `<head>` before `<body>`, `<body>` before `<div id="root">`, `<div id="root">` before content |
| Test 12 (Fresh server data) | Zero X-Vesk-Data requests on initial load; exactly 1 for `/async` and `/posts` |
| Test 13 | Fresh data on repeated SPA nav — 3 requests total for /async across 3 visits |
| Test 16 (API routes) | GET /api/hello → 201 + session cookie; POST echo → 201; GET /api/echo/:msg → dynamic param; POST /api/posts with query params; /api/posts?fail=100 → 503 + error body |
| Test 15 (Server actions) | Form submits to `/_vesk/action/<id>`, `vsk-success` fires on valid submit, `vsk-error` fires on server rejection with field errors |
| Test 18 (SSR data integrity) | `/async` and `/posts` have exactly 1 ssr-data.js ref; all others have 0; no data script leak to non-data routes |

## Implementation Plan

### Phase 1: Extend Sidecar Server (`packages/haul/internal/sidecar/server.ts`)

Add JSON-RPC methods:

1. **`ssr.render`** — Load SSR function module, execute `handle(request)`, return `{ status, headers, body, dataScript? }`. This is the main SSR execution path.
2. **`api.handle`** — Load API function module, execute `handle(request)`, return `{ status, headers, body }`.
3. **`action.handle`** — Load action function module, execute `handleAction(request, id)`, return `{ status, body }`.
4. **`css.compile`** — Load `vesk.config.ts`, call `plugin.onCSS()` with CSS content, return processed CSS (real Tailwind + stripped).
5. **`ssr.getDataScript(token)`** — Return stored data script content for the given token (from in-memory store), then delete token.
6. **`middleware.execute`** — Load middleware module, create context, call `execute(ctx)`, return `{ response?, rewriteUrl? }`.

Key design decisions:
- Sidecar process remains long-lived; cache modules by file hash to avoid re-importing
- SSR execution: `import()` the function file (same pattern as adapter's prod-server.ts), then call `mod.handle(request)`
- For CSS: load `vesk.config.ts` via `_require`, call `plugin.onCSS(css, sourcePath)`, return processed CSS
- SSR data store: in-memory map `globalThis.__vsk_ssr_data_store` (same as adapter)

### Phase 2: Update `haul start` Command (`packages/haul/internal/cli/start.go`)

Wire the sidecar to handle all routes:

- `GET /` → match SSR route, call `sidecar.ssr.render()` → inject HMR overlay into HTML, set chunked encoding
- `GET /ssr-data.js?t=token` → call `sidecar.ssr.getDataScript(token)`
- `POST /_vesk/api/*` → match API route, call `sidecar.api.handle()`
- `POST /_vesk/action` → match action, call `sidecar.action.handle()`
- `GET /_vesk/static/*` → serve files (unchanged)
- `GET /_vesk/runtime.js` → serve client.js (unchanged, but add type="module" to HTML)
- `GET /` fallback: serve HTML with HMR overlay if no SSR route matches

### Phase 3: Update `haul dev` Command (`packages/haul/internal/cli/dev.go`)

Implement full rebuild-on-change workflow:

- Watch `app/` directory for `.vsk` file changes
- On change, rebuild only affected SSR/API functions and re-bundle client
- Cache rebuild results by file hash (persistent across dev sessions)
- Serve HMR overlay via WebSocket (`/_vesk/hmr`) — sends `{ updatedComponents: [...] }` messages
- On rebuild, push component updates to all connected clients via WebSocket

### Phase 4: Fix CSS Processing (`packages/haul/internal/cli/build.go`)

- Load `vesk.config.ts` via sidecar (transpile to get plugins)
- Call `plugin.onCSS()` to process both `_tailwind.css` and `global.css`
- For `_tailwind.css`: return full plugin result (real Tailwind CSS, no stripping)
- For `global.css`: strip `@import 'tailwindcss'` and `@layer*` directives, keep only user CSS
- Ensure `_tailwind.css` has >1000 bytes (contains utilities)

### Phase 5: Verify Runtime Exports (`packages/haul/internal/bundle/clientbundle.go`)

- Ensure `client.js` is an ES module with explicit `export { ... }` at the tail (matching adapter)
- Verify `hydrateViewport`, `hydrateIdle`, `hydrateOnInteraction`, `collectVskMarkers`, `createHydrateWalker`, `hydrateInitial` are all exported
- Ensure `storeDataScriptGlobal`, `validateActionInput`, `issuesToFieldMap`, `withSsrStore` are also exported
- If missing, add to the client bundle exports list

### Phase 6: Run Tests

```bash
cd /root/vesk/test-app
/tmp/haul start &
sleep 2
node /root/vesk/hydration-test.mjs
# Verify: all 0 failures
```

## Open Questions

1. Does the sidecar already have a `ssr.render` method or do I need to add it? — Need to verify current sidecar server.ts. The adapter calls `mod.handle(request)` directly — the sidecar does the same. I need to add the `ssr.render` method to the sidecar that orchestrates the import + execution.

2. How does the adapter handle middleware execution for API routes? — The adapter runs middleware BEFORE API calls in prod-server.ts. I need to replicate this in the sidecar: call middleware module, then the API function.

3. What is the exact format for the action handler response? — The adapter shows `{ ok: boolean, ... }` but also `handleAction` in prod-server.ts uses a different signature (handles `webRequest`). I need to verify the exact expected shape.

4. How does the HMR overlay work? — The adapter's dev-server.ts shows HMR overlay rendered by a script that watches for changes. I need to add a similar mechanism.

## Validation

- Run `node hydration-test.mjs` and verify 0 failures
- Run `npx tsx packages/compiler/src/...` for compiler tests
- Run `npx tsx packages/adapter/src/...` for adapter tests
- Run `scripts/test.js` for full suite parity

## Risk

- Sidecar process stability: if sidecar crashes, start command needs graceful restart
- Memory leaks: SSR data store tokens not cleaned up over long dev sessions
- File watching: fsnotify may not be available in all environments