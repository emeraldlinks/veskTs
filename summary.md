# Vesk Session Summary — 2026-09-11 (PC handoff: serverless SSR 500 + AOT principle)

> Working summary so this can be resumed from another machine. Current state is `main`
> @ `d17f362`, all packages `0.2.22`. **The serverless SSR 500 / AOT bug is now fixed**: build-time precompilation is implemented, SSR functions emit precompiled plans only, no runtime `compileFile` / sourcePath dependency.

## THE PRINCIPLE (user directive — treat as law)

> **"Move every task as far as possible / stretchable to the compiler."**
> The runtime must NOT compile, transform, or resolve. Compile ahead of time (AOT) at build.
> Any design that re-parses/re-generates source at request time is wrong.

## The serverless SSR 500 bug — FIXED

### Symptom — previously
- Live site `vesk-doc.vercel.app`: `/about`, `/statements`, `/api/hello` → **200**;
  `/` and `/docs` → **500** (`FUNCTION_INVOCATION_FAILED` era is over; now it's a real
  frame-rendered Vesk error page); `/posts` had a transient `000` (re-check).
- Error body: `<!--vesk-ssr-error:Internal%20Server%20Error-->` + "error · 500";
  `<pre>` stack is **empty** (details hidden in prod).
- Client shows the same via `makeSsrError`/`hydrateInitial` in `runtime`'s `client.js`.

### Resolution
Build-time AOT precompilation is now used for all SSR functions. `packages/compiler/src/precompile.ts` + `precompile-runtime.ts` compile `.vsk` → `PrecompileFilePlan` at build time. `packages/adapter/src/ssr-function.ts` emits only `hydratePrecompile(plan)` at runtime, no raw source, no `sourcePath`, no `compileFile`. Serverless functions no longer depend on build-machine paths.

### Root cause (verified against source + bundle)
`vesk build` emits per-route SSR functions (`server/functions/<route>.js`) that embed the
**raw `.vsk` page source** plus a top-level IIFE that **recompiles at function-load time**:

```js
const _pagePath = "/vercel/path0/vesk-doc/app/docs/page.vsk";           // BUILD-MACHINE ABSOLUTE PATH
const _pageCompiled = (() => { try { setVskHydrate(true);
  return compileFile(_pageSrc, { sourcePath: _pagePath });              // RE-COMPILES AT REQUEST TIME
} catch { return null; } finally { setVskHydrate(false); } })();
```

- `renderPage(source, comp, props, registry, { cached: _pageCompiled, sourcePath })` is
  called per render (package `@vesk/compiler` → `server-codegen`).
- `compileFile` needs **disk**: `inlineMdImportsFrom(source, sourcePath)` +
  `collectVskImportPaths` + `readFileSync` of every relative import
  (`packages/compiler/src/server-render.ts:42-73`).
- Local `/vercel/path0/...` → the bundle has **34 baked absolute paths** (grep
  `/root/vesk/vesk-doc` in `vesk-doc/.vercel/output/functions/__index.func/index.js`
  locally) pointing at anything that doesn't exist in the serverless sandbox.
- Result: `_pageCompiled = null` for pages with relative content imports → SSR throws →
  generic 500. Pages with **no relative imports** (`/about`, `/statements`) compile fine → 200.
- The same bundle renders **all routes 200 locally** (incl. isolated dir, Node 22 & 26)
  only because this machine still has `/root/vesk/vesk-doc` on disk.

### Why it's compile-at-runtime (the flaw)
`compileFile` returns `{ ir, componentMap, __vesk }` where `componentMap` is a
`Map<string, Function>` of **closures over `evalTopLevelCode`'d scope** — not serializable.
So there was no build-time SSR artifact, and the emit punted compilation to function load.
**This is exactly what must be fixed: emit only precompiled code, never raw source.
The runtime/SSR path must contain zero parse/compile work.**

### Fix implemented
**True AOT is now implemented.**
- `packages/compiler/src/precompile.ts` / `precompile-runtime.ts` provide `precompileFile` and `hydratePrecompile`.
- `packages/adapter/src/ssr-function.ts` now precompiles page/layout/error/component at build time via `precompilePlan` and emits `hydratePrecompile(plan)` at runtime. No raw `.vsk` source, no `sourcePath`, no `compileFile` at request time.
- `tests/production-hydration-test.mjs` updated to pass app plugins to `build()` so Tailwind is active and SSR is pure AOT.
- Platform smoke `vercel` passes 10/10; production hydration probe passes 52/52.

## What's already fixed + deployed (all confirmed on npm)
| Version | Commit | Fix | Deploy outcome |
|---|---|---|---|
| 0.2.20 | `0ed8329`-era | strip-ts type-only import elision | vesk-doc deploy failed `ENOTDIR` (symlink) |
| 0.2.21 | `f34d9e9` | `.vercel/output` emitted as **real dir** (`cpSync`, not symlink) | deploy `6kMfS5cRvNdh2wR8DaU7QtnRwqQf` Ready but 500 `FUNCTION_INVOCATION_FAILED` everywhere |
| 0.2.22 | `87e2c7c` | **`{"type":"module"}` package.json** emitted in `.func` dir (ESM handler was loaded as CJS) | deploy `1ajH5uGD4kKfnxSSvt2VzZS3gYWo` Ready; `/about /statements /api/hello` 200; `/ /docs` still 500 (root cause above) |
| **AOT** | in progress | `packages/compiler/src/precompile.ts` + `precompile-runtime.ts`, `packages/adapter/src/ssr-function.ts` emit `hydratePrecompile(plan)` only; no runtime `compileFile` / `sourcePath` | platform smoke 10/10, production hydration 52/52 |

Registry: `@vesk/*` + `lucide-vesk` all `0.2.22` (npm view is cache-stale — use
`curl -s "https://registry.npmjs.org/<pkg>/latest?z=$RANDOM"`).
`scripts/platform-smoke.mjs vercel` → 10/10 passed.

## Repo / git state (as of handoff)
- Branch `main`, HEAD `d17f362 docs: bump vesk-doc to vesk 0.2.22 (ESM type:module marker)`.
  Parents: `69bec83 release: v0.2.22 [skip ci]`  ← `87e2c7c` (the fix).
- All workspace packages pinned `0.2.22`: types, adapter, cli, compiler, create-vesk,
  plugin-pwa, plugin-tailwind, prettier-plugin, runtime, lsp.
- `vesk-doc/package.json`: `@vesk/{adapter,compiler,plugin-tailwind,runtime,types,vesk-cli}` + `lucide-vesk` all `0.2.22`.
- **DO NOT COMMIT working-tree junk** (must not be staged):
  - `M .gitignore`, `M test-app/package.json`, `M test-app/package-lock.json`, `M test-app/vesk.config.ts`
  - `D test-app/tarballs/vesk-0.2.16-ci.*.tgz` etc. (7 deleted tgz)
  - `?? probe-*.mjs` (many root-level probe scripts; `probe-vesk-doc.mjs`,
    `probe-vesk-doc-browse.mjs` used for the bundle repros)
  - `vesk-doc/.vercel/output/`, `vesk-doc/tarballs/*.tgz` are generated/local — exclude.

## Release / deploy machinery (memorize)
- `npx tsx packages/cli/src/build-packages.ts` — rebuild package `dist/` after ANY
  `packages/compiler` or `packages/adapter` source edit (tests resolve dist via exports map).
  `npx tsx packages/cli/build.ts` — rebuild the CLI bundle (`packages/cli/dist/cli.js`,
  embeds adapter+compiler). Verify with `grep -c` of a known marker.
- Release: push to main with **"publish" in the commit message** → GH run → publish job
  `needs: [verify, platforms]` → auto **patch** bump → npm publish → `release: vX.Y.Z [skip ci]`
  commit + tag. ~6 min verify + ~2 min publish. Keep `--run-id`/URL for logs.
- Vercel: project `vesk-docs`, user `emeraldlinks`, team `emeraldlinks-projects`.
  `vercel ls`, `vercel inspect <deployID> --logs` work; `vercel logs` / events API are
  plan-gated ("Deployment not found") — don't waste time on runtime logs.
- Dev/test local: `node tests/hydration-test.mjs` (needs test-app dev server :3000 +
  `CHROMIUM_PATH`), `npx tsx scripts/platform-smoke.mjs vercel`, run compiler tests
  individually: `npx tsx packages/compiler/src/<file>.test.ts`.

## vesk-doc bump flow (repeatable)
```bash
git stash push -m junk -- test-app .gitignore          # protect junk
git fetch origin && git rebase origin/main             # pulls release:vX.Y.Z [skip ci] + tag
git stash pop
sed -i 's/"0\.2\.22"/"0.2.23"/g' vesk-doc/package.json  # 7 pins
git add vesk-doc/package.json && git commit -m "docs: bump vesk-doc to vesk 0.2.23 (...)"
git push                                              # message MUST NOT contain "publish"
```
Then watch `gh api repos/emeraldlinks/veskTs/commits/<sha>/status` → Vercel build/deploy
→ curl all routes expecting 200.

## Next steps (in order)
1. Commit the AOT implementation and run the full release flow.
   - `npx tsx packages/cli/src/build-packages.ts`
   - `npm run test` / `node scripts/test.js` with `CHROMIUM_PATH` set.
   - `npx tsx scripts/platform-smoke.mjs vercel` — 10/10.
2. Commit with "publish" → release bump → verify registry.
3. Bump `vesk-doc` to the new version (flow above), push, verify `/` `/docs` `/about`
    `/statements` `/posts` `/api/hello` all 200 live on Vercel.
4. Clean up scratch probe files (`probe-*.mjs`) and untracked `public/` once no longer needed.
5. Update this summary to reflect release version and live verification.

## Old summary
Previous `summary.md` (docs deep-dive, 8 workstreams, commit `e5f2623`) is superseded;
the docs work is complete and pushed. The vesk-web-era "guides" are WRONG — never trust them;
document from source only.