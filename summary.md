# Vesk Session Summary — 2026-09-10

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

## What happened so far

### Completed & committed (all pushed to `origin/main`)
- `a9c8f18` — 22 docs.ts page tab-conversions (statement+expression), CodeShowcase ssr.html tab, 7 llms.txt version bumps, `app/docs/page.vsk` CLI reference. **typecheck+build green.**
- `1816984` — runtime `llms.txt` stale `^0.1.0` → `^0.2.16`.
- `4d70ec6` — **deleted `vesk-web`** (105 files) from the monorepo.

### Verified facts (do NOT re-derive)
- All `@vesk/*` packages = `0.2.16`; CLI binary = `@vesk/vesk-cli`.
- `vesk-doc` typecheck/build: `cd vesk-doc && npm run typecheck` (`tsc --noEmit`) / `npm run build` (`vesk build`).
- **vesk-web's guides are WRONG** (confirmed): they use Svelte-style `{#if}`/`{/if}` blocks that **do not compile** in Vesk. They were restored to `/tmp/vesk-web-ref` for inspection, then **removed** per user instruction ("if wrong then remove it"). **Document from source, not from vesk-web.**

### Current state
- docs.ts inventory (36 pages) at `vesk-doc/src/content/docs.ts` (2448 lines, `Block`/`DocPage`/`docGroups` exported at top, pages inline as `docPages`).
- Thin/wrong pages needing depth (user's list + my audit):
  - `data-fetching` — useFetch/createResource shallow, missing mutate/stream/dedupe/SSR-handoff detail.
  - `middleware` — **WRONG API**: real middleware is `fn(ctx, next)` with `next(rewrite?)`; `MiddlewareContext` has NO `ctx.next()/setHeader/redirect/rewrite`. Source: `packages/compiler/src/middleware.ts`, `packages/types/src/index.ts:55-64`.
  - `server-apis` — `VeskRequest`/`VeskResponse` barely documented (VeskResponse chain, VeskRequest members missing).
  - `routing` — shallow; missing router API (`createRouter`/`createFileRouter`/`defineRoute`/`buildRouteTree`/`matchRoute`), route groups, layouts, Outlet, guards, prefetch, loading/error/offline pages.
  - `isr`, `api-routes`, `forms`, `config`, `plugin-api`, `cli` — decent but can be deepened.
  - `native` — **partly fabricated**: claims `@vesk/native-compiler` (v0.1.x, `compileVskResult → {kt,errors,notes,libraryIds}`) — the REAL packages live in **separate repo `/root/vesk-native`** and are NOT in the monorepo. Must be rewritten from real source.
- `vesk-native` CLI (real, VERIFIED from `/root/vesk-native/packages/cli-native/src/index.ts`):
  `init | build | bundle <android|ios> | verify [bundle] | setup | update-tools | add <spec> | install | update [spec] | remove <spec> | dev [--port N] [--desktop] [--web]` (dev default port 5173).

## The planned 8 parallel subagent workstreams (NEXT ACTION)

Each agent: (a) reads the REAL source, (b) probes EVERY `.vsk` snippet with
`npx tsx /tmp/vsk-probe.mjs '<source>' <name>` (helper: `<root>/tmp` version imports
`compileFile` from `/root/vesk/packages/compiler/src/server-render.js`), (c) writes full page content
as new `.ts` page modules, (d) statement-mode + expression-mode `tabs` for full components (statement first).

| # | Workstream | Pages (slug) | Ground truth source |
|---|---|---|---|
| 1 | Data fetching | `data-fetching`, `network` | `packages/runtime/src/resource.ts` (useFetch opts: key/into/body/staleTime/keepPreviousData/retry/retryDelay/timeout/enabled/dedupe; useFetch.text/json/arrayBuffer/stream; mutate; createResource; HttpError/TimeoutError; setSsrData/clearSsrData/setSsrSink/resolveSsrResources) |
| 2 | Middleware | `middleware` | `packages/compiler/src/middleware.ts`, `packages/types/src/index.ts:55-64`, `MiddlewareContext = {request,params,url,locals,cookies,set,get}` + index-sig (unknown keys = locals) |
| 3 | Routing + router API | `routing` | `packages/runtime/src/router.ts` (createRouter/createFileRouter/defineRoute/buildRouteTree), `router-match.ts` (matchRoute/RouteNode/RouteMatch), `router-components.ts` (Link/NavLink/Redirect/Outlet/redirect/permanentRedirect/notFound), routes/groups/catch-all/layouts |
| 4 | Server APIs | `server-apis` | `packages/runtime/src/request.ts`: defineHook/removeHook/runHooks, useParams/useRequest/useBody, cors, webhook, cookies(), locals(), headers(), ServerRequest/ServerResponse, VeskRequest (class) / VeskResponse (Proxy, MVP chain), applyRequestSecurity, withValidation, sign/unsign/setSigned/readSignedCookie |
| 5 | Contexts/events/plugins | `config`, `plugin-api` | `packages/runtime/src/context.ts` (createContext/Context/getActiveComponent/setActiveComponent), `server-events.ts` (serverLocals/getServerContext/setServerContext/clearServerContext), `_events.ts` (onStart/onRequest/onStop → `ServerEventContext` types/src/index.ts:98-127), `VeskPlugin`/`definePlugin`/`provides` in types + config.ts |
| 6 | API routes + ISR + forms | `api-routes`, `isr`, `forms` | `packages/compiler/src/api-routes.ts`, `packages/runtime/src/isr.ts` (pageIsr/componentIsr/isr/revalidatePath/revalidateTag/clearIsrCache/revalidateComponent/isrConfigToRevalidate), `packages/runtime/src/form.ts` (Form/Field required/email/minLength/maxLength/pattern/custom), `action.ts` (defineAction/validateActionInput/issuesToFieldMap) |
| 7 | vesk CLI + config | `cli` | `packages/cli/src/index.ts` (dev/build/start/typecheck/seo/init + flags), config loading + preset(security) — READ FIRST: dev/build behaviors + X-Vesk-Data + HMR |
| 8 | vesk-native FULL | `native` (+ maybe `native-navigation`, `native-device-apis`) | **SEPARATE REPO** `/root/vesk-native`: `compiler-native/src/kotlin-codegen.ts` (compileVsk/compileVskResult → CompileResult `{kt,errors,notes,libraryIds,vskTargets,jsTsTargets,npmTargets}`), `compiler-native/src/browser-api.ts` (browser fns/consts), `navigation-native/src/index.ts` (RouteConfig/RouterState/createRouter), `cli-native/src/commands.ts` (initApp/buildApp/devApp/bundleApp/verifyBundle/parseLibraryArgs/addLibrary/installAllLibraries/updateLibraries/removeLibrary/verifyApp), `cli-native/src/vsklib.ts` (LIBRARY_REGISTRY, LIBRARY_PERMISSION_RULES, libs), `usage.ts` (API_PERMISSIONS, collectDeviceApiUsage/collectBrowserApiUsage/collectRuntimeUsage), ADRs in `docs/adr/` (0001,0002,0007,0009-0018...) |

## Integration plan (after agents deliver page modules)
1. Convert pages to attributable modules OR splice returned content back into `docs.ts` per slug
   (keep `Block`/`DocPage` union + `docGroups` + `docPages` export intact).
2. `cd vesk-doc && npx tsc --noEmit && npm run build` until green.
3. Probe-verify every `.vsk` block in the final output (compileFile harness).
4. Optionally sanity-render via dev server (`npx vesk dev` on :3000).
5. Commit + push.

## Command cheat-sheet (resume on PC)
```bash
cd /root/vesk            # monorepo WSL box
npx tsx /tmp/vsk-probe.mjs '<vsk-source>' name   # compile-verify any snippet
cd vesk-doc && npm run typecheck && npm run build
cd /root/vesk-native     # SEPARATE native repo (real vesk-native source)
```

## Repos
- `/root/vesk` — monorepo: types, adapter, cli, compiler, create-vesk, plugin-tailwind,
  prettier-plugin, runtime, lsp. **This is where docs.ts lives.**
- `/root/vesk-native` — **separate** native repo: compiler-native, cli-native, create-native,
  native, navigation-native (+ 24 ADRs in `docs/adr/`, README device-API catalog).

## Refs (existing content in docs that is now WRONG and must change)
- `native` page line ~2193: fabricated `@vesk/native-compiler` claims → rewrite from `/root/vesk-native`.
- `middleware` page line ~1546: `ctx.next()`/`setHeader` onion API → rewrite to `fn(ctx, next)` real API.