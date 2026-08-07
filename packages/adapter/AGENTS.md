# AGENTS.md — @vesk/adapter module rules

> Instructions for AI agents working in `packages/adapter`. Read before editing
> this package. Monorepo conventions: ESM (`"type": "module"`), TypeScript,
> builds to `dist/` via `tsc -p tsconfig.build.json`.

## Hard rules

- **Never break the exports map.** Consumers resolve `@vesk/adapter/src/*`
  through the package `exports` map (`"./src/*": "./dist/*.js"`) and via TS
  path aliases (`@vesk/adapter/src/*` → `./src/*`). Every source file under
  `src/` must produce a matching `dist/*.js` after build. Do NOT rename or
  remove a file that the CLI or other files import without updating every
  import site:
  - `packages/cli/src/index.ts` imports `build`, `startProdServer` (from
    `src/index`), `runSeoAudit` (from `src/seo-audit`).
  - `packages/cli/src/dev-server.ts` imports `generateClientBundle`,
    `buildTreeShakenRuntime`, `runtimeExportNames` (from
    `src/client-bundle`).
  - Adapter files import each other via `@vesk/adapter/src/<file>` (self
    referencing the package), so the dist must exist before tests/probes run.

- **Keep the client bundle ESM-importable and tree-shakable.** The tree-shaken
  client runtime is one closed esbuild IIFE (`globalName: '__veskRuntime'`)
  followed by explicit `export { ... };`. Top-level `const` bindings are NOT
  ESM exports — without that explicit export statement browsers resolve zero
  names. Do not replace it with naive concatenation as the default path; the
  legacy `buildRuntimeCode` concatenation exists only as a **fallback** and it
  leaks module scope. Preserve the IIFE + explicit re-export contract.

- **The legacy concat fallback strips export lines.** If you touch
  `buildRuntimeCode` (the fallback), remember it strips:
  - `import ... from './x'` / `@vesk/runtime/src/...` lines,
  - `export { ... } from '...'` lines,
  - leading `export ` keywords,
  and re-emits a single `export { <names> };` from `index-client.js` re-export
  names. Don't rely on it being semantically complete; it exists so a missing
  runtime name never totally breaks a build.

- **When you add a runtime import a page/component can use**, wire it through
  BOTH paths: the base list in `buildMainBundle` and `collectRuntimeImports`
  (which parses `import {...} from '@vesk/runtime'`). `@vesk/runtime`
  auto-imported names used in components must end up in `usedNames`, or the
  tree-shaken bundle will not export them.

- **Every generated function keeps `export async function handle(request)`.** The
  prod server (`loadFunction` → `mod.handle`), the dev server, and the platform
  handler (`import { handle as __ssr_... }`) all depend on exactly this export.
  Renaming/return-shape changes ripple across `ssr-function.ts`,
  `api-function.ts`, `prod-server.ts`, `dev-server.ts`, and
  `platform-handler.ts` simultaneously.

- **`server/runtime.js` is the one shared server runtime.** `bundleRuntime`
  produces it; SSR functions, API functions, and the prod/dev servers import
  `renderPage`/`renderFullPage`/`renderPageStream`/`parseCookies`/etc. from it.
  Any new server-side helper your generated code uses must be added to
  `bundleRuntime`'s entry re-exports.

- **Keep the two middleware compilers in sync.** `compileMiddleware` emits a
  stand-alone `server/middleware.js` exporting `execute(ctx)`; the inline
  `compileMiddlewareCode` emits `__mwChain` + `__executeMw`. Both share the
  same semantics (rewriteUrl, Response short-circuit, `next` guard). Changing
  one without the other breaks SSR vs. root behavior.

- **`emitPlatformOutput` returns `null` for `'node'`** — callers treat `null`
  as "no platform emit". Adding a platform means updating FOUR places: the
  `Platform` union (`platform.ts`), `VALID` + a `detectPlatform` env branch,
  and `shellFor` in `platform-deploy.ts` (else it throws `Unsupported
  platform`).

- **Static URL scheme must stay `/_vesk/static/*`.** `writePlatformStatic`,
  `writePrerenderedStatic`, and each `staticServe` source
  (`denoStaticSource`/`nodeStaticSource`/`inlineStaticSource`) all assume the
  `./static/` layout and the `_vesk/static/public` prerendered location. Keep
  them consistent with the SSR-emitted `<link>`/`<script>` URLs.

- **No regex in the compiler/codegen — but adapter text processing is fine.**
  The adapter does source-text stripping (e.g. `stripRuntimeImport`,
  `stripVskImports`, `stripExports`, `collectRuntimeImports`,
  `runtimeExportNames`, `evaluateExport`, CSS directive stripping). This is
  permitted tooling (not compiler syntax analysis). Prefer the compiler's
  AST/codegen APIs (`compileClient`, `resolveComponentName`,
  `collectVskImportPaths`) for anything structural over hand-rolled regex.


## Commands

```bash
# Build the monorepo packages (compiler + runtime) — REQUIRED before adapter
# tests/probes that need compiler/dist or runtime/dist
npx tsx packages/cli/src/build-packages.ts

# Adapter typecheck / build
npm run typecheck        # tsc --noEmit
npm run build            # tsc -p tsconfig.build.json  → dist/

# Adapter tests (plain scripts, exit 1 on failure)
npx tsx packages/adapter/src/seo-audit.test.ts
npx tsx packages/adapter/src/tree-shake.test.ts
npx tsx packages/adapter/src/hmr.test.ts
npx tsx packages/adapter/src/hydration.test.ts      # puppeteer-core e2e
npx tsx packages/adapter/src/code-split.test.ts     # puppeteer-core e2e
```

Do NOT run `scripts/test.js` while iterating — it builds then runs the whole
suite.

## File responsibility map

| File | Owns |
|------|------|
| `index.ts` | `build()` orchestration order, flag wiring, plugins, CSS/Tailwind, sitemap/robots, platform handoff. |
| `runtime-bundle.ts` | Server runtime bundle (`server/runtime.js`) + its export surface. |
| `ssr-function.ts` / `hmr.ts:regenerateSsrFunction` | SSR function source generation (must match!). |
| `api-function.ts` | API function generation. |
| `client-bundle.ts` | Client bundle, code-split chunks, tree-shaken runtime (IIFE + exports), legacy fallback. |
| `middleware.ts` | Both middleware chain compilers. |
| `static.ts` | Static copy, SSG, sitemap, robots. |
| `manifest.ts` | `config.json` schema. |
| `image-pipeline.ts` | sharp image variants; `ImageRef`/`ImageResult` types in types.ts. |
| `seo-audit.ts` | `SEO_CHECKS` + `runSeoAudit`. |
| `hmr.ts` | HMR WebSocket server + rebuild/message routing. |
| `dev-server.ts` | Dev http server, `doBuild`, static/runtime/action/API/SSR serving, HMR wiring. |
| `prod-server.ts` | Prod http server, config parse, security, rate limit, ISR, action/API/SSR serving. |
| `platform.ts` | `Platform` type + detection. |
| `platform-output.ts` | MIME, dir copy, static layout, `mimeFor`. |
| `platform-handler.ts` | Universal `handleRequest` source + esbuild bundling. |
| `platform-deploy.ts` | `emitPlatformOutput`, `shellFor` per-platform shells. |


## Do / don't

**Do**
- Verify any function/signature you reference against the actual source; never
  invent exports. Mark anything unverifiable `[UNVERIFIED]`.
- Rebuild `compiler`/`runtime` `dist/` before running adapter E2E tests.
- Add/update a test (including the production-hydration path) for any behavior
  change; the puppeteer tests are the ground truth for hydration/code-split/HMR.
- Keep `src/index.ts`'s `build()` and the CLI's `build(appDirPath, opts)` call
  in lockstep (the CLI sets `plugins`, `seo`, `strictSeo`, `codeSplit`,
  `platform`, `target`).
- Follow the existing style: generated code is raw strings assembled with
  template/array joins; generated error/guard code mirrors the existing patterns.

**Don't**
- Don't remove the explicit `export { ... };` tail of `buildTreeShakenRuntime`.
- Don't silently drop the legacy `buildRuntimeCode` fallback — the tree-shake
  test asserts it exists (`// --- ripple-constants.js ---` marker) as the
  missing-name fallback.
- Don't change `handle(request)` signatures across SSR/API without updating
  prod-server + dev-server + platform-handler + platform handler generation.
- Don't add a platform without touching `Platform` union + `detectPlatform` +
  `shellFor`.
- Don't edit `dist/` by hand — edit `src/` and rebuild.
- Don't assume `optimizeImages` runs once: the current `index.ts` invokes it
  twice; keep the change consistent (or fix both call sites intentionally).

