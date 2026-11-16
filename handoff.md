# Gin-like middleware/req/res handoff

## Objective
Implement additive Gin-like req/res/middleware features in Vesk (excluding router groups) with **no existing API/signature changes** so current codebases/apps keep working, and verify/test properly in `test-app`.

**Hard constraint:** no changes to existing exports, function/method names, parameter lists/types/requiredness, return shapes/types, or runtime semantics; new behavior must be additive/opt-in and backward-compatible.

## Changes made (additive)

### Types (`packages/types`)
- `packages/types/src/index.ts`, `packages/types/src/index.d.ts`
  - Added `MiddlewareError`.
  - Extended `MiddlewareContext` with optional members: `errors?`, `error?`, `abort?`, `isAborted?`, `abortWithStatus?`, `abortWithStatusJSON?`, `cookie?`, `status?`, `json?`, `text?`, `html?`, `redirect?`, `header?`, `getHeader?`, `shouldBindJSON?`, `bindJSON?`, `shouldBindQuery?`, `bindQuery?`.
  - Extended `VeskRequest` with optional helpers: `cookie?`, `shouldBindQuery?`, `bindQuery?`, `shouldBindJSON?`, `bindJSON?`.
  - Extended `VeskResponse` with optional introspection: `statusCode?`, `getHeader?`.
  - Existing signatures/required members unchanged.

### Runtime (`packages/runtime`)
- `packages/runtime/src/request.ts`: added `VeskRequest.cookie`, `shouldBindQuery/bindQuery`, `shouldBindJSON/bindJSON`; `VeskResponse.statusCode/getHeader`; `toVeskResponse` export helper (normalizes/clones to VeskResponse, preserves cookie/sec/final-status metadata when present).
- `packages/runtime/src/index-server.ts`: exports `toVeskResponse`.

### Middleware chain behavior
- `packages/compiler/src/middleware.ts` (dev/runtime chain executor): added `__mwCloneResponse`, ctx `errors/error/abort/isAborted/abortWithStatus/abortWithStatusJSON`, response normalization, abort-aware `next`/chain handling, and preserved existing control-flow/redirect/TypeError semantics.
- `packages/adapter/src/middleware.ts`: mirrored abort/error/response-normalization in generated chains for both `compileMiddleware` (`server/middleware.js`) and `compileMiddlewareCode` (inline `__executeMw`) to keep build/prod parity with compiler behavior.

### Tests
- `packages/compiler/src/middleware.test.ts`: added additive tests for abort short-circuit (`abortWithStatusJSON`) and error collection; restructured test registration so all tests run under the harness (15 total).

### `test-app` (local verification target)
- Deps relinked to local packages (`file:../packages/*`), `npm install` run earlier.
- Middlewares typed/updated (`app/middleware.ts`, `app/admin/middleware.ts`, `app/blog/middleware.ts`).
- Added `/mw-cookie` probe: `app/mw-cookie/page.vsk`, `app/api/mw-cookie/route.ts`; root middleware attempts pass-through cookie/header mutation on `/mw-cookie`.

## Build state
- `npm run build` completed successfully (exit 0) with current sources; package dists/CLI bundle updated (notably `packages/cli/dist/cli.js`, `packages/compiler/dist/middleware.js`, `packages/adapter/dist/middleware.js`, `packages/runtime/dist/request.js`, `packages/runtime/dist/index-server.js`).
- `test-app` rebuilt: `node ../packages/cli/dist/cli.js build` succeeded (`dist/` generated, `mw -> server/middleware.js (1 middlewares)`).

## Verification (confirmed)
- Targeted tests passed:
  - `npx tsx packages/compiler/src/middleware.test.ts` → **17/17** (includes pass-through cookie/header mutation and additive ctx helper tests)
  - `npx tsx packages/adapter/src/middleware.test.ts` → **5/5**
  - `npx tsx packages/adapter/src/api-function.test.ts` → 3/3
  - `npx tsx packages/adapter/src/api-function-middleware.test.ts` → **1/1** (generated API function runs the route inside the onion and applies pass-through cookie/header mutation; route imports colliding runtime names to prove aliases)
  - `npx tsx packages/adapter/src/ssr-function.test.ts` → 42/42
  - `npx tsx packages/adapter/src/platform-handler.test.ts` → 14/14
  - `npx tsx packages/adapter/src/platform-deploy.test.ts` → 4/4
  - `npx tsx packages/adapter/src/dev-api.test.ts` → 37/37
- `npm run typecheck` → clean (testing, types, compiler, runtime, adapter, cli, plugin-pwa).
- `node scripts/refresh-testapp-deps.mjs` repacked CI tarballs + reinstalled `test-app`; `npm run build` in `test-app` succeeded.
- Prod smoke (`vesk start -p 3014`, rebuilt `test-app/dist`):
  - `GET /mw-cookie` → `200`, `set-cookie: mw_seen=1; ...`, `x-mw: ok`, body contains `id="mw"`.
  - `GET /api/mw-cookie` → `200`, `set-cookie: mw_seen=1; ...`, `x-mw: ok`, JSON `{"ok":true}`.
- Dev smoke (`vesk dev -p 3015`):
  - `GET /mw-cookie` → `200`, same `set-cookie` + `x-mw: ok`, body contains `id="mw"`.
  - `GET /api/mw-cookie` → `200`, same `set-cookie` + `x-mw: ok`, `{"ok":true}`.
- Edge/serverless smoke: `vesk build --platform cloudflare`, imported `.vesk/cloudflare/_worker.js`, then `default.fetch(new Request('http://localhost/api/mw-cookie'))` → `200`, `x-mw: ok`, `mw_seen=1`, `{"ok":true}`; `/mw-cookie` SSR → `200`, `x-mw: ok`, `mw_seen=1`, `id="mw"`.
- Direct generated-function check: `handle(new Request('http://localhost/mw-cookie'))` → `200`, cookies/header present, body rendered.

## Fixes in this pass
- `packages/adapter/src/middleware.ts`: inline executor now wraps `onLast()` with `__mwCloneResponse`, so pass-through middleware receives a `VeskResponse` with `setCookie`/`clearCookie` instead of a plain `Response`.
- `packages/adapter/src/index.ts`: `walkApi` now collects the route middleware chain, compiles it inline, and passes `middlewareCode` to `generateApiFunction`; logs `[mw]` for API routes.
- `packages/adapter/src/api-function.ts`: route runs inside the middleware onion via `__runRoute` + `__executeMw(__ctx, __runRoute)`. Runtime imports are aliased (`__veskParseCookies`, `__veskAssertSameOrigin`, `__veskRunHooks`, `__veskMaxBodyBytes`, `__veskVeskResponse`) so a route importing the same names from `@vesk/runtime/server` cannot collide. Removed the unused duplicate `parseCookies as __parseCookies` import.
- `packages/adapter/src/ssr-function.ts`: same onion wiring; `__runRoute` supplies `url = __ctx.url`.
- `packages/adapter/src/runtime-bundle.ts`: `server/runtime.js` now exports `toVeskResponse`.
- `packages/compiler/src/middleware.ts`: removed duplicate `getSetCookie()` merge (headers were already copied), added additive ctx helpers + pending-header application.
- `packages/cli/src/dev-server.ts`: sets `globalThis.VeskResponse` for compiler middleware helpers; API requests now run `executeApiRoute` inside middleware `onLast`, so dev matches prod pass-through behavior.

## Known gaps
- Root middleware is executed both inline (SSR/API function) and in `prod-server.ts`/edge handler (pre-existing double execution; logs `user:` twice). It is idempotent for the current fixture but should be consolidated.
- No dedicated tests for runtime request bind/shouldBind/cookie/statusCode/getHeader/toVeskResponse yet.
- Full suite (`scripts/test.js`, `npm test`, hydration probes) not run in this pass.

## Suggested next steps
1. Consolidate root middleware execution so it runs once per request while keeping route-level chains inline (prod-server, edge handler, SSR/API functions).
2. Add dedicated runtime tests for the new `VeskRequest`/`VeskResponse` helpers and `toVeskResponse`.
3. Run `node tests/hydration-test.mjs` with a running dev server + `CHROMIUM_PATH`, then the broader suite if time allows.
4. Update `test-app/llms.txt` route table if not already including `/mw-cookie`.

## Relevant files
- `packages/compiler/src/middleware.ts`, `packages/adapter/src/middleware.ts`, `packages/adapter/src/index.ts`, `packages/adapter/src/api-function.ts`, `packages/adapter/src/ssr-function.ts`, `packages/adapter/src/runtime-bundle.ts`, `packages/cli/src/dev-server.ts`, `packages/adapter/src/prod-server.ts`, `packages/adapter/src/platform-handler.ts`
- `packages/runtime/src/request.ts`, `packages/runtime/src/index-server.ts`
- `packages/types/src/index.ts`, `packages/types/src/index.d.ts`
- Tests: `packages/compiler/src/middleware.test.ts`, `packages/adapter/src/middleware.test.ts`, `packages/adapter/src/api-function.test.ts`, `packages/adapter/src/api-function-middleware.test.ts`, `packages/adapter/src/platform-handler.test.ts`, `packages/runtime/src/request.test.ts`, `packages/compiler/src/integration.test.ts`
- `test-app/` (esp. `app/middleware.ts`, `app/mw-cookie/page.vsk`, `app/api/mw-cookie/route.ts`, `app/components/primitives.vsk` pre-existing errors)
- Build: `packages/cli/src/build-packages.ts`, root `npm run build`
