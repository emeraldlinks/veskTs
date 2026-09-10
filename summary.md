# Vesk Session Summary — 2026-09-10 (PC handoff, docs deep-dive COMPLETE)

> Working summary so this work can be resumed from another machine (PC). Everything below is
> verified against actual source; **never trust the deleted vesk-web guides.**

## The ask (verbatim intent)
1. Make `vesk-doc` well depth-documented (real docs, not stubs).
2. **No errors** — every `.vsk` snippet must compile; every claimed API must exist in source.
3. **Don't skip vesk-native** — document everything in it (routing, libraries, CLI, device APIs, everything).
4. Spawn **8 parallel subagents** to handle all tasks at once.
5. Recover deleted `vesk-web` doc/guide **only if verifiably accurate** — otherwise remove it.
6. **Don't assume anything, don't skip anything** in the docs.
7. Document **`vesk` CLI** AND **`vesk-native` CLI** in the docs.
8. Write summary to `summary.md` (overwrite), commit, push — so work continues on another PC.

## STATUS: ALL EIGHT WORKSTREAMS COMPLETE, COMMITTED, PUSHED

- `d029693` — **8-agent docs deep-dive merged** (9 files, +3951 lines): depth-documented
  `data-fetching`, `network`, `middleware`, `routing`, `server-apis`, `api-routes`, `isr`,
  `forms`, `config`, `plugin-api`, `cli`, `native`. typecheck + build green. All 115 site
  `.vsk` blocks compile (statement + expression modes) via compileFile probe.
- `fef4364` — session summary + 8-agent plan.
- `4d70ec6` — deleted `vesk-web` (105 files) — its guides were wrong.
- `1816984` — runtime llms.txt `^0.1.0` → `^0.2.16`.
- `a9c8f18` — 22 docs.ts page tab-conversions, CodeShowcase ssr.html tab, 7 llms.txt bumps, CLI reference.

### What each workstream fixed (wrong/fabricated API → real)
| Page | Old claim (WRONG) | Real (from source) |
|---|---|---|
| `middleware` | `ctx.next()/setHeader/redirect/rewrite` methods | `fn(ctx, next)`, `next(rewrite?)`; short-circuit by returning a `Response`; `MiddlewareContext = {request,params,url,locals,cookies,set,get}` (no response obj) |
| `native` | fabricated `@vesk/native-compiler` 2-arg `compileVsk` | REAL packages `@vesk/native`, `@vesk/native-compiler`, `@vesk/native-cli`, `navigation-native` (v0.1.10); `compileVsk(source, filename, options)`; `CompileResult {kt, errors, notes, libraryIds, vskTargets, jsTsTargets, npmTargets}`; CLI, API_PERMISSIONS, device APIs from `/tmp/vesk-native` |
| `routing` | `<Redirect to="/login" />` JSX component | `Redirect` is an `Error` subclass (`throw redirect(url, status)`); layouts via `props.children`; added createRouter/createFileRouter/defineRoute/buildRouteTree/matchRoute, guards, prefetch, catch-all, loading/error/not-found/offline pages |
| `data-fetching` | `createResource(fn, { key })` | `createResource(fn, key?, into?, options?)`; `mutate(key, data?)` only from `@vesk/runtime/src/resource` (not barrel); HttpError/TimeoutError same path |
| `server-apis` | `setCsp({ defaultSrc })}` object; "all auto-imported" | `setCsp("default-src 'self'")` string; only `useParams` auto-imported — rest from `@vesk/runtime/server` |
| `config` | `preset('strict')/preset('minimal')` | `preset('production') / preset('development')` only |
| `plugin-api` | `import { tailwindcss } from '@vesk/plugin-tailwind'` | default export `import tailwindcss from ...` |
| `cli` | HMR `{type:'reload'|'hmr', path}` | real messages `compiling/update/reload/error/css-update` + `nonce`; watches app/ + src/; verified platform list `node|vercel|netlify|cloudflare|deno|aws|edge|coxmos`; typecheck/init behaviors |
| `api-routes` | sync `{ params: {id} }` destructure | params arrive as a Promise: `const { id } = await ctx.params` |
| `isr` | thin | added componentIsr/isrConfigToRevalidate, `export const revalidate`/`isrTags`, `${comp:key}` tag indexing |
| `forms` | — | Form/Field onSubmit/onError/onSuccess real signatures |

## Verified facts (do NOT re-derive)
- All `@vesk/*` packages = `0.2.16`; CLI binary = `@vesk/vesk-cli`.
- `vesk-doc` typecheck/build: `cd vesk-doc && npm run typecheck` (`tsc --noEmit`) / `npm run build` (`vesk build`).
  **NOTE: `vesk build` re-packs `vesk-doc/tarballs/*.tgz` to a fresh CI timestamp and updates
  package.json/package-lock.json `file:` refs — restore those before committing non-doc work:
  `git checkout -- vesk-doc/package.json vesk-doc/package-lock.json vesk-doc/tarballs/` and
  delete the new-`*-<ts>.tgz` files.**
- vesk-web's guides are WRONG (Svelte-style `{#if}` that doesn't compile in Vesk). Document from source.
- `Redirect`/`permanentRedirect`/`notFound` are `Error` subclasses/throw-functions, never JSX components.
- Runtime barrel split: client & server barrels export `createResource/setSsrData/clearSsrData/resolveSsrResources/useFetch`; `mutate/HttpError/TimeoutError` are NOT in barrels — import from `@vesk/runtime/src/resource` (same as the runtime's own tests).

## Current docs architecture
- `vesk-doc/src/content/docs.ts` defines `Block`/`DocPage`/`docGroups`/`docPages` (inline pages).
- The 8 deep-dive modules live in `vesk-doc/src/content/docs-*.ts`, each exporting `pages` —
  `docs.ts` imports them and MERGES into `docPages` by slug (replace in place or append).
- Pages still shallow but "decent" (not reworked): `seo`, `bindings`, `reconcile`,
  `reactive-core`, `built-in-components`, `headless`, `errors`, `pipeline`, `ir-format`,
  `static-codegen`, `client-reachability`, `hydration`, `deployment`, `lsp`, `prettier`,
  `markdown`, `styles`, `gotchas` (not-in-the-grammar). They already compile (115/115 site-wide probe).

## Repos
- `/workspaces/veskTs` (PC) / `/root/vesk` (WSL) — monorepo: types, adapter, cli, compiler,
  create-vesk, plugin-tailwind, prettier-plugin, runtime, lsp. **Docs live here.**
- `/tmp/vesk-native` (PC clone) / `/root/vesk-native` (WSL) — separate native repo:
  compiler-native, cli-native, create-native, native, navigation-native (+ 24 ADRs).

## Command cheat-sheet (resume on PC)
```bash
cd /workspaces/veskTs
npx tsx /tmp/vsk-probe.mjs '<vsk-source>' name   # compile-verify inline
npx tsx /tmp/vsk-probe.mjs @/tmp/file.vsk name   # compile-verify a file
npx tsx /tmp/verify-vsk.mjs                      # probe ALL .vsk blocks in docs.ts (must be 115/0)
cd vesk-doc && npm run typecheck && npm run build
```