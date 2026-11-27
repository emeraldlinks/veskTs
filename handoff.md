# Handoff: Robust TS transform for dev/SSR/API module loading

## Objective
- Fix reported Windows dev API route failure: `C:\Users\KERRY\Documents\myshopp\app\api\auth\login\route.ts` returns `{"error":"Failed to load route module","details":"Unexpected strict mode reserved word"}`.
- Replace brittle custom TS stripping in module/API loading paths with robust esbuild-based transform (native esbuild first, `esbuild-wasm` fallback), while keeping Vesk AST/specifier rewriting where required.

## Root Cause (confirmed)
- `packages/compiler/src/strip-ts.ts` leaves valid TS constructs unstripped; repro: `class X implements Y {}` -> `stripCodeTypes` keeps `implements`, Node ESM throws `SyntaxError: Unexpected strict mode reserved word`.
- Dev API route loading used stripped/raw TS parsing paths; real-app deps containing `implements`/param properties/enum/abstract/etc. can hit this.

## Changes Made (uncommitted)

### New TS transform service
- `packages/compiler/src/ts-transform.ts`: async `transformTsModule` and sync `transformTsModuleSync` via esbuild/esbuild-wasm fallback strategy; `loaderForPath`.
- `packages/compiler/src/ts-transform.test.ts`: covers implements/private types, generics/parameter properties, ESM import/export preservation.
- `packages/adapter/src/esbuild-fallback.ts`: added `transform()` alongside existing `build()`, native-first then wasm fallback.
- `packages/compiler/package.json`: added `esbuild`, optional `esbuild-wasm`.
- `packages/adapter/package.json`: added optional `esbuild-wasm`.

### API route/module preparation
- `packages/compiler/src/api-module-prepare.ts`: `prepareApiRouteGraph` now async; transforms TS via esbuild, parses transformed JS with `parseGeneratedJs`, rewrites local/alias specifiers to flat prepared `.mjs` files. Cache key includes ts-transform version marker.
- `packages/compiler/src/api-routes.ts`: awaits `prepareApiRouteGraph`; dev load/handler failures log stack with route context and return dev JSON with `route/message/details` where applicable.
- `packages/adapter/src/api-function.ts`, `packages/adapter/src/index.ts`: `generateApiFunction`/build flow awaited for async prep/generation.

### SSR/module import loading
- `packages/compiler/src/module-imports.ts`:
  - `readSsrSource` async; transforms `.ts/.tsx/.mts/.cts` with esbuild before parsing; parse/transform errors include file/line.
  - `loadSsrModule` async with in-flight dedupe; evaluates transformed JS AST.
  - Added `loadSsrModuleSync` for cached/builtin/JSON/JS and sync native esbuild TS transform (used by lazy barrels/property access).
  - `applyLocalModuleImports` async.
  - `collectModuleBundled`/`resolveBundledDeps`/`collectModuleBundle` async.
- `packages/compiler/src/server-render.ts`: `compileFile`, `compileFileInternal`, `render`, `renderPage` made async; `renderPageStream` awaits async compile/import paths as needed.
- `packages/compiler/src/precompile.ts`: `precompileFile`/internal async.
- `packages/adapter/src/ssr-function.ts`: `generateSsrFunction` async; awaits precompile.
- `packages/cli/src/dev-server.ts`: `cachedSsrCompile` async; dev render/cache call sites awaited.
- `packages/testing/src/index.ts`: `renderComponent`/`mount` async (typecheck-driven API update).

### Tests updated
- `packages/compiler/src/api-module-prepare.test.ts`: async + real-app TS syntax case (`implements`, param properties, enum, abstract).
- `packages/compiler/src/module-imports.test.ts`: updated for async API; all module-imports tests currently passing after fixes.
- `packages/compiler/src/precompile-cache.test.ts`, `packages/compiler/src/server-codegen.test.ts`: async precompile updates.
- `packages/adapter/src/api-function.test.ts`, `packages/adapter/src/api-function-middleware.test.ts`, `packages/adapter/src/ssr-function.test.ts`, `packages/adapter/src/plugin-head.test.ts`, `packages/adapter/src/asset-hash.test.ts`, `packages/adapter/src/server-only.test.ts`.
- `packages/cli/src/dev-ssr-cache.test.ts`, `packages/testing/src/harness.test.ts`.

## Validation Run
- `npx tsx packages/cli/src/build-packages.ts` — passes after iterative fixes.
- `npx tsx packages/compiler/src/ts-transform.test.ts` — `3 passed, 0 failed`.
- `npx tsx packages/compiler/src/api-module-prepare.test.ts` — `6 passed, 0 failed` (includes real-app TS syntax case).
- `npx tsx packages/compiler/src/module-imports.test.ts` — `55 passed, 0 failed` (latest run after async/sync fixes).
- `npx tsc --noEmit -p packages/compiler/tsconfig.json` — pass.
- `npx tsc --noEmit -p packages/adapter/tsconfig.json` — pass.
- `npx tsc --noEmit -p packages/cli/tsconfig.json` — pass.
- Full `npm run typecheck` was started but repeatedly timed out/stalled in this environment before completing; key packages above pass.

## Not Done / Risks
- **Reported Windows app not reverified end-to-end**. The exact user project/route was not run here. The identified `implements`/TS-syntax failure mode is covered by transform + API prep tests; need user/dev-server confirmation on their app.
- **Async API ripple not fully audited**. `compileFile`/`render`/`renderPage`/`loadSsrModule`/`applyLocalModuleImports`/`collectModuleBundle`/`precompileFile` became async or changed behavior; compile/typecheck caught many call sites, but there may be runtime callers in tests/scripts outside targeted paths.
- **Lazy barrel + sync TS loading**: `loadSsrModuleSync` now uses native `esbuild.transformSync` for TS. This fixes lazy barrel access; environments without native esbuild sync support will throw a clear error. `esbuild-wasm` has no sync transform.
- **AST-strip paths still exist** (`strip-ts.ts`, `client-codegen.transformTracked`, actions/router/ir/server-jsgen transforms) where AST mutation requires TS stripping/reparse. These were not fully migrated to esbuild+reparse; they are separate from the reported API/SSR module-load failure but still a robustness debt.
- **Dev/adapter/prod layout-chain streaming** still buffered for layout-chain routes (known TODO).
- **Hydration/prod hydration not rerun** in this session after these changes. Required by AGENTS for reactivity/hydration work: `node tests/hydration-test.mjs` (needs test-app dev server on :3000 and `CHROMIUM_PATH`).
- **TODO.md not updated**.

## Files Worth Inspecting First
- `packages/compiler/src/ts-transform.ts` - new transform service/sync+async behavior.
- `packages/compiler/src/module-imports.ts` - async load, sync cache path, barrel behavior, transform integration.
- `packages/compiler/src/api-module-prepare.ts` - async graph prep + specifier rewrite.
- `packages/compiler/src/api-routes.ts` - dev error payload/logging.
- `packages/compiler/src/server-render.ts` - async compile/render path.
- `packages/adapter/src/ssr-function.ts`, `packages/adapter/src/index.ts` - async build/precompile.
- `packages/cli/src/dev-server.ts` - cachedSsrCompile async.

## Suggested Next Steps
1. **Reproduce reported case** in a Windows-like fixture or ask user to retry after rebuild: create API route importing deps with `implements`, param properties, enum, abstract; verify dev server no longer returns `Unexpected strict mode reserved word`.
2. **Audit async ripple**: grep for old sync assumptions (`compileFile(`, `renderPage(`, `loadSsrModule(`, `applyLocalModuleImports(`, `collectModuleBundle(`) in tests/scripts/docs.
3. **Decide TS-strip strategy for AST-mutation paths**: where code must be parsed/mutated as AST, prefer transform TS->JS then parse JS, or harden stripper; avoid regex.
4. **Run full validation**: `npm run typecheck` to completion, relevant compiler/adapter tests, and `CHROMIUM_PATH="${CHROMIUM_PATH:-/data/data/com.termux/files/usr/bin/chromium-browser}" BASE=http://localhost:3017 node tests/hydration-test.mjs` (per prior TODO context; confirm port/setup).
5. **Update `TODO.md`** with root cause, fix, validation, remaining async/AST-strip/hydration debt.

## Useful Commands
```bash
npx tsx packages/cli/src/build-packages.ts
npx tsx packages/compiler/src/ts-transform.test.ts
npx tsx packages/compiler/src/api-module-prepare.test.ts
npx tsx packages/compiler/src/module-imports.test.ts
npx tsc --noEmit -p packages/compiler/tsconfig.json
npx tsc --noEmit -p packages/adapter/tsconfig.json
npx tsc --noEmit -p packages/cli/tsconfig.json
# hydration (needs running test-app dev server + chromium)
CHROMIUM_PATH="${CHROMIUM_PATH:-/data/data/com.termux/files/usr/bin/chromium-browser}" BASE=http://localhost:3017 node tests/hydration-test.mjs
```
