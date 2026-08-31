# Vesk — TODO

> Living task tracker. Read at start of every session. Update after every unit of work.

**Current phase:** pure-TS pipeline (haul parked)

**Completed this session:** vesk-web landing restyle (Hero, GuidedTour, Modules, Footer social row, v0.2.9 pill, page order) rendered via `<Md>`; SSR async-detection bug fixed (`componentUsesFetch` no longer raw-matches `useFetch(`/`useFetch.` inside string/template literals — now walks the ESTree via `estreeCallsFetch`). 4 regression tests added to `server-codegen.test.ts` (server-codegen 128 / integration 124 / client 175 green). Root cause of stale site runtime: `vesk-web/node_modules/@vesk/*` are real copies (not symlinks) installed 08:48 — synced `packages/*/dist` into them, rebuilt site, verified SSR: `[object Promise]` gone, GuidedTour/Modules/hero/footer all render.

**Earlier session:** `useFetch.stream` (progressive chunks into a cell, URL-provider refresh), `Md` streaming content + runtime public-path loading (`/public*/*.md`, literal fallback when missing), server-side streaming passthrough (`deliverResponse`) through dev + prod servers, `VeskResponse.stream`/`VeskRequest.resolveUrl` wiring, `__vesk_ssr_base_url` typo fix, md read hook in both CLI dev-server and adapter servers. Tests: `resource.test.ts` 36, `md.test.ts` 124, `request.test.ts` 91, typecheck clean, dev-server verified end-to-end (chunked API route, SSR path hook render, static/live/streamed blocks).

**Total tests:** compiler ~850 (api-routes 16 + cli 14 + components-scan 6 + config 17 + errors inline + head-merge 14 + scan 39 + server-utils 115 + ssg 11 + track-codegen 14 + vsk-imports 15 + vsk-tsx 26* + parser 95 + server-codegen 106 + integration 119 + client-codegen 161 + ir-generator 9 + router 22 + middleware 11 + ts-support 25 + props-type 8* + typecheck 16), runtime ~400 across suites, hydration 121 (*pre-existing dts-drift failures on main)
**Joe test app (joe/test/):** 56 tests (26 hydration + 8 event hydration + 22 HMR)

---

## Phase 0 — Project Scaffolding ✅
- [x] Repo structure, dependencies, base parser PoC
- [x] IR format decided (`/docs/decisions/001-ir-format.md`)
- [x] Analysis docs: parser, runtime, pipeline, reusable-vs-discard

---

## Phase 1 — Parser ✅
- [x] `component` keyword, `let &[name] = track(...)`, `let &[name, rawCell] = track(...)`
- [x] Expression mode (`return <jsx>`) + Statement mode (bare JSX, if/for/while/switch/try)
- [x] Guard clause early returns, expression containers `{expr}` at body level
- [x] TypeScript annotations (forked `@sveltejs/acorn-typescript`)
- [x] `export component`, `export default component`
- [x] `client` keyword (islands), `{#server}` / `{#client}` blocks
- [x] `<style>` block parsing, JSX fragments, spread attributes
- [x] 69 parser tests passing

---

## Phase 2 — Server Codegen ✅
- [x] All IR node classes → HTML rendering with escaping
- [x] Dynamic expressions, conditionals, `.map()`, loops (all kinds), switch, try/catch
- [x] Child component resolution via `__registry`
- [x] TrackDecl — SSR evaluates initializer, skips reactivity
- [x] ServerBlock/ClientBlock — selective rendering
- [x] HeadBlock — compile-time SEO metadata collection into `<head>` with dedup
- [x] Hydration markers (`data-vsk="N"`), event handler stripping
- [x] Cross-file imports via `__registry` Map
- [x] `render()`, `renderPage()`, `renderPageStream()` (streaming SSR)
- [x] `ssg()` — Static Site Generation with `getStaticProps`, zero-JS pages
- [x] Fix: guard clause detection skips `if (cond) throw` (was silently dropping throw statements)
- [x] 69 server codegen tests passing

---

## Phase 3 — Client Codegen + Reactivity ✅
- [x] `track()`, `effect()`, `batch()`, `derived()` runtime — 22 tests
- [x] DOM creation via `document.createElement`, `createTextNode`, DocumentFragment
- [x] Dynamic text/attribute bindings → `effect(() => node.data = String(cell.get()))`
- [x] Tracked variable auto-rewriting — `count` → `cell.get()` (no `.get()` in user code)
- [x] `&[name, rawCell]` two-element destructuring — auto-unwrap name + raw Cell
- [x] `ref={fn}` callback — `(fn)($el)` after element creation, stripped from SSR
- [x] AOT event binding: delegation (bubbling) + direct `addEventListener` (non-bubbling)
- [x] `OpaqueDynamicRegion` (conditionals) + `MapRegion` (lists) with effect lifecycle
- [x] `ComponentCall` → child returns DOM node, parent appends
- [x] Hydration path: `nextElement()`, `subWalker()`, zero-JS for static trees
- [x] RuntimeStatement — AST-based tracked variable transformation (no regex)
- [x] Client-side `<head>` management (title, meta, script, link, style, base) with dedup
- [x] Time-sliced hydration (`hydrateViewport`, `hydrateIdle`)
- [x] Islands architecture (`client` keyword forces JS)
- [x] Sub-component static extraction (hydrate skips static child subtrees)
- [x] ESM client router (`createRouter`)
- [x] Children/Slots — `{props.children}` / `<slot/>` with pre-rendered HTML (SSR) / DOM fragment (client)
- [x] `bindValue`/`bindChecked`/`bindGroup` — auto-imported, tree-shaken when unused
- [x] `try/catch` on client — catches render errors, catch param (`e`) available in catch body effects
- [x] 98 client codegen + 41 integration tests passing

---

## Phase 4 — Framework Features

### Next up (priority order)
- [x] **Context (Ripple-style)** — `Context` class with `.get()`/`.set()`, component tree walking, auto-cleanup via `try/finally`. 34-line runtime + 2-line compiler wrapper per component.
- [x] **Property-specific codegen** — `<input value={x}>` → `el.value = x` instead of `setAttribute`. Applies to input/textarea/select/option/progress value/checked/selected/indeterminate.
- [x] **Keyed .map() reconciliation** — `reconcile()` runtime helper diffs keys, creates/removes/reorders DOM, per-item comment markers. 6 tests.
- [x] **SSR top-level code + context propagation** — `IRRoot.topLevelCode`, `evalTopLevelCode`, `__vesk` passed to children, `setActiveComponent`/`getActiveComponent` with fallback.
- [x] **`renderFullPage()`** — full HTML5 document wrapper for `renderPage()`.
- [x] **JSX comment stripping** — `// comment` lines in JSX filtered.
- [x] **File-based routing (App Router)** — `app/` directory scanner, route tree builder, URL matcher with dynamic params/catch-all/groups.
- [x] **Router runtime** — `createRouter` (manual), `createFileRouter` (file-based), `Link`, `NavLink`, `Outlet`, `useNavigate`, `useParams`, `usePathname`, `useSearchParams`. Layout chain rendering with `{props.children}`.
- [x] **CLI `--router` flag** — scans `app/` directory, compiles all `.vsk` files, generates unified output with route tree and router bootstrap.
- [x] **SSR route matching** — `matchUrl()` in compiler router matches URL path against route tree, extracts params. Full E2E demo with 5 routes (root, about, blog layout, blog/[slug]).
- [x] **Dev server / HMR** — `vesk dev` with file watching, incremental HMR, WebSocket broadcast, floating dev menu, surgical component-update (eval + applyPageUpdate for page/component, full navigate for layout)
- [x] **HMR latency pass (2026-08)** — content-only `.vsk` edits now hot-swap in ~90–150ms end-to-end (was ~700–800ms): incremental compile cache in `generateClientBundle` (`options.cache`, mtime+size keyed; `only` + `returnEditedSources` targeted mode stat-checks just the edited file), one parse/IR per edit via compiler `compileClientBoth` (comp+hyd+name share a single acorn pass; AST cloned per mode because stripTsTypes mutates), 12ms watcher debounce, Tailwind rescan parallelized with the JS build and `css-update` suppressed when output unchanged, keep-alive + `setNoDelay` on the haul↔sidecar RPC, diff-based `dev_rebuild` payload (patched chunks only). Follow-up: make `stripTsTypes` non-mutating to drop the per-edit clone.
- [x] **Production demo** — `vesk build` + `vesk start` serving SSR with hydration, global CSS, static files, dynamic routes, API routes, 404
- [x] **CSS pipeline** — global.css detection, build copy to static/, `<link>` tag in SSR HTML, dev server CSS watching + rebuild
- [x] **npm packaging** — publish `@vesk/compiler` and `@vesk/runtime` (tarballs via `npm pack` + `create-vesk` scaffolder + local `file:` installs)
- [ ] **Suspense / async resources** — async data loading with fallback states (needs compiler-level `SuspenseBlock` IR node; `if (loading)` + OpaqueDynamicRegion works today)
- [ ] **Transitions / animations** — built-in transition directives on element mount/unmount
- [x] **Portal** — `Portal` runtime component moves DOM nodes to `props.target`. Requires `{#client}` blocks for SSR-free content. 56 tests passing.
- [x] **Form actions** — progressive enhancement form handling (server actions via `defineAction` + `Form`, client validation, `vsk-success`/`vsk-error` round-trips; hydration-test Test 15)
- [x] **Offline navigation UX** — network failures during SPA nav (data fetch or chunk load) now render a dedicated offline experience instead of the app's 404 page or a raw `TypeError`. Router option `offline` accepts a component (`{ url, params, retry }`) or HTML string; built-in default panel has Retry + auto-recovery via the browser `online` event. Active connectivity probe (`looksOffline`) classifies failures where `navigator.onLine` is unreliable. 3 router tests + browser e2e probe.
- [x] **Connectivity boundaries: `offline.vsk` / `network.vsk`** — route-directory conventions (like `error.vsk`/`loading.vsk`) compiled into route chunks. `offline.vsk` = dedicated offline UI; `network.vsk` = state-aware UI receiving `{ url, params, retry, online, effectiveType, downlink, rtt, saveData }` (Network Information API, degrades to nulls). Precedence on offline nav failure: offline.vsk → network.vsk → router option → nearest error.vsk (receives `offline: true` + `networkState`) → built-in panel. Displayed boundaries re-render live via `watchNetwork()`; `getNetworkState()` exported from the client barrel. Tests at all three layers (scan/bundle/router precedence).
- [x] **Statement-mode if/else-if chains inside element children** — `if (cond) {…} else if … else {…}` among JSX children now compiles to nested OpaqueDynamicRegions (previously silently emitted as raw text + escaped JSX). ir-generator `processJSXChildren` + `extractIfHeader`; integration test covers SSR output and client compile.
- [x] **JSX in dynamic expressions prints via esrap tsx** — component calls inside tracked dynamic expressions (`<Md/>` in a region branch) hit esrap's TS printer which cannot print JSXElement; transformTracked now selects `esrap/languages/tsx` when the AST contains JSX. Regression test in client-codegen.test.ts.
- [x] **Md hydration of hidden branches** — `<Md>` hydrate path returned an empty fragment when the walker handed it a FRESH element (dynamic branch with no SSR markup), so client-side branch swaps rendered nothing; now returns the built element for placement.
- [ ] **Runtime: nested else-if swap on hydrated client** — flipping through chained regions whose alternate branches had no SSR markup mounts additively instead of replacing (visible as duplicated/appended content). Parallel guarded `if` regions work; needs OpaqueDynamicRegion hydrate-swap rework.
- [x] **Reactive <Md> content cells** — the compiler passes tracked reads as cells for exact-match props; Md now unwraps them and, on the client, subscribes via effect() so `content={live}` re-renders markdown per keystroke (verified in browser: headings/task lists/highlighted code update live). Raw-preview fallback removed from the demo.
- [x] **Headless component primitives** — `Show`/`For`/`Switch`/`Match` in `packages/runtime/src/headless.ts` (9 tests), exported from both barrels, SSR + client

### Considering (need research)
- [ ] **Resumability (Qwik-style)** — lazy event handlers, no hydration
- [ ] **Server state management (TanStack Query pattern)** — cache, refetch, stale-while-revalidate
- [ ] **Server actions** — form submissions without JS
- [ ] **Incremental Static Regeneration (ISR)**
- [ ] **createStore (deep reactive proxy)** — Solid-style deep reactive objects
- [ ] **Hooks composability** — reusable reactive logic via composable functions

---

## Phase 5 — CLI + Dev Tooling

- [x] `vesk dev` — dev server with HMR
- [x] `vesk build` — production build (output to .vesk/)
- [x] `vesk start` — production server (serve from .vesk/ with SSR/static/API/404)
- [x] `vesk init` creates `src/global.css` (Tailwind entrypoint) — `vesk init` in `packages/cli/src/index.ts` creates `src/global.css` with `@import 'tailwindcss'` if missing
- [x] `packages/adapters/vite` — vite-plugin-vesk — `packages/adapters/vite/src/index.ts` (vskToTsx transform, resolveId for .vsk, HMR via full-reload)
- [x] Write `/docu/cli/commands.md` — already comprehensive (vesk + haul tables, config loading, dev behaviors)

---

## Current Session Work

### Focus: Dev floating panel → tabbed/resizable/themed devtool
- [x] **Floating dev bar → full devtool** — `packages/runtime/src/hmr-client.ts` panel rewritten from a fixed websocket-status bubble into a tabbed panel: Overview / Errors / Plugins / Log / Settings, each tab acting as its own scrollable page inside the shared shell (`DEV_TABS`, `renderTabBar`, per-tab renderer map + default fallback, per-pane `overflow-y:auto` + `__v_tab` pane animation).
- [x] **Websocket status text removed** — no more "WS: connected true/false" line/dot; status dot now `idle`/`compiling`/`error` only. Adapter-asserted substrings (`__vesk_dev`, `WebSocket`, nonce, `__vesk_router`) preserved; tests re-verified (`packages/adapter/src/hmr.test.ts` 39/39, `dev-server.test.ts` 46/46).
- [x] **Resizable + expandable** — `__kp_handle` pointer-drag resize (clamped to viewport, snap-to-full-width, min 320x200), `[+]/[-]` maximize (`.maxed` clears inline w/h, restores on un-max), `.resizing` disables transitions during drag, live `WxH` readout in the head; width/height/opacity/transform eased transitions + entrance/pane/overlay/pulse keyframes.
- [x] **Dark/light/system themes** — whole devtool CSS moved to `--vk-*` custom properties on `#__vesk_dev`/`#__vesk_overlay`; `prefers-color-scheme` default, explicit light/dark override, `data-theme` attribute, live OS-theme change listener in system mode, themed overlay + error overlay.
- [x] **Side selection + settings tab** — panel docks left or right bottom (default right) via `data-pos`; `>` SETTINGS tab offers THEME (system/light/dark) and PANEL POSITION (left/right) option buttons with active states, delegated clicks, no hardcoded anchors on the app page.
- [x] **Full devtool state persisted in localStorage** — `DEV_STATE_KEY` = `veskDevPrefs` blob via `DevtoolState` (`theme`, `pos`, `activeTab`, `open`, `w`, `h`, `maxed`); `loadDevtoolState`/`saveDevtoolState` (clamp-up sizes, validate tab/theme/pos); recovery: prefers-color-scheme, garbage-`JSON`-safe. Restored on boot (open panel, active tab, size, maximize). Persist hooks: setTab, togglePanel, resize-end, max toggle, theme/pos change.
- [x] **Object-map tab rendering** — `renderPanel` uses a `Record<tab, () => string>` renderer map with a default fallback for unknown tabs instead of an if/else chain.
- [x] Tests: `packages/runtime/src/hmr-client.test.ts` 130/130 (tab bar incl. settings, settings panel markup/actives, `DevtoolState` round-trip + corruption/min-clamp/unknown-tab fallbacks, source-substring guards for tab/max/handle/pane/resizing/motion/data-pos/prefers-color-scheme/saveDevtoolState).
- [x] **Plugin UX + devtool polish (2026-08-30)** — plugin-detection bug fixed in `packages/adapter/src/plugins.ts` `resolvePackage` (walk-up guard no longer gated on `cur.startsWith(appDir)`, so exports-mapped packages in the project-root `node_modules` report `installed:true`; live-verified `@vesk/plugin-tailwind` → `installed:true, active:true`). Install button gets a progress/loading state (`pluginInstalling`: disables the in-flight button, `installing...` + "please wait"; guards double-install). npm search results now open a pre-install plugin detail (`data-search-pkg-open` + row click → `renderSearchPluginDetail`: name/version/description/author/date/keywords/install), so a plugin is inspectable before installing. All native scrollbars removed across the devtools root while panes stay scrollable; rail sidebar is fixed-left with a `gap:8px` from tab content. **Round 2 (same day):** (1) **scroll fixed** — `#__kp_content` is now a bounded flex column (`min-height:0`), so tall panes (plugin lists etc.) actually scroll instead of being clipped. (2) **real two-column sidebar** — rail mode switches `#__vesk_dev` to CSS grid (`"head head" / "tabs body"`): tabs left (52px → 104px on hover ≈ 90%/80% content), content right; Settings labels are now **top**/**sidebar**. (3) **installed status in search** — search rows + npm detail show an `installed` badge and disable install for already-installed packages. (4) **search retry / "won't search again" fixed** — `fetchRegistryJson` was caching failed registry responses for 5 min; only successes are cached now + fetch timeout raised to 6000ms. Runtime `hmr-client.test.ts` 206/206, adapter `plugins.test.ts` 101/101.
- Next: drive the full production hydration path (`node tests/hydration-test.mjs`) once a test app is running, then continue plugin metadata/introspection + B3 diagnostics UI (see `plans/devtools.md`).

### Focus: middleware chain fixes (dev + prod parity)
- [x] **Middleware edits never took effect (stale ESM cache)** — `loadMiddleware` used a bare `await import(sourcePath)`; Node caches the module forever, so adding `console.log` to `app/middleware.ts` while the server ran silently kept executing the old module. Now every load cache-busts via a `?t=` query param (packages/compiler/src/middleware.ts).
- [x] **`await next()` without `return` discarded the rendered response** — the compiler chain synthesized an empty 204 whenever a middleware returned non-Response, throwing away onLast's rendered page. Chain now captures next()'s response and propagates it; same fix applied to the adapter's generated runners (`compileMiddleware`, `compileMiddlewareCode`) and the haul sidecar RPC codegen so dev/prod/haul behave identically.
- [x] **Middleware Responses were swallowed on API routes** — dev servers passed `onLast: async () => new Response(null)`, so even a legit `return new Response(401)` from middleware was ignored and the API handler still ran. Both dev-server.ts and haul's handleDevApi now honor middleware responses, propagate rewrites, and pass locals into `executeApiRoute`.
- [x] **Middleware locals now visible during SSR render** — `executeMiddlewareChain` sets `globalThis.__vesk_request` to the middleware ctx for the duration of the chain/onLast render, so pages calling `locals()` see what middleware set (previously only API routes received locals). `onLast` receives `(rewriteUrl, ctx)` (types updated).
- [x] Tests: new `packages/compiler/src/middleware.test.ts` (11 tests: collection order, TS loading, stale-cache reload, return/await-next semantics, short-circuit, redirect, rewrite, empty chain).

### Focus: LSP — Volar revival + self-contained packaging (36/36 smoke)
- [x] **Volar LSP revived, heuristic modules deleted** — packages/lsp restored from 718f7a0; smoke suite `node packages/lsp/tests/lsp-smoke.mjs` 36/36. Root causes fixed: (1) language-id mismatch — VS Code grammar sends `vsk`, plugin only accepted `vesk` → no virtual code ever created (`isVeskLanguage` accepts both); (2) plugins receive the **virtual** TSX document (`volar-embedded-content://…`), so knowledge scans must run on `sourceScript.snapshot` while answers stay in virtual coords (hover.ts); (3) `VeskVirtualCode.languageId = 'typescriptreact'` (was `'vesk'`) so volar-service-typescript's `isTsDocument()` gates pass — fixed null `documentSymbol`; (4) hover wrapper merges real TS hovers (contents may be MarkupContent, array, or string) with vesk overlays: reactive-binding markers, HTML element docs, event-handler docs, inferred component props; (5) `stripDocumentFormatting` also strips `documentOnTypeFormattingProvider` (client-side autoclose).
- [x] **Fully bundled server** — `scripts/build-lsp.js` (`external: []`) inlines typescript + @volar/* + volar-service-typescript; `stripShebang()` fixes rollup hoisting bin.ts's shebang mid-file; `ensureModuleFilename()` injects `const __filename = fileURLToPath(import.meta.url)` for TS's node-system probe. `typescriptService.ts` converted from runtime `require('volar-service-typescript')` to static imports — the monkey-patch of `getUserPreferences` stays live because all consumers call through the shared CJS exports object inside one bundle.
- [x] **Self-contained vsix (0.2.0)** — client bundled with esbuild (`vscode-languageclient` inlined, only `vscode` external); runtime deps removed from extension package.json (moved to devDeps). **0.1.2/0.1.3 vsixes were silently broken**: packaged without node_modules but dist/extension.js still required vscode-languageclient at runtime (would crash on activation). Standalone extraction test verified: unzip outside repo, spawn lsp-server/index.mjs from /tmp cwd → init/hover/symbols all work.

### Focus: haul — native engine + CLI replacement (PARKED on `haul-parked` branch)
> Haul was unplugged from main: esbuild-wasm fallback + the compiler's own TS
> stripper cover the old-device cases it existed for, and it added a whole
> second engine to maintain. Restore with `git checkout haul-parked`.
- [x] **Unplugged from main** — packages/haul + haul-* platform binaries live only on `haul-parked`; CLI bin shim, sidecar bundling, release publishing, CI job and create-vesk scaffolding all removed. test-app defaults to the pure-TS `vesk` CLI.
- [ ] **(was Phase 0)** Make `esbuild` + `sharp` optionalDependencies; wire esbuild-wasm fallback; verify `npm install` never SIGILLs
- [ ] **(was Phase 1)** Native `haul` Go binary (build/dev/start/seo/typecheck); embed esbuild-Go tree-shaker + minifier; native TS stripper; Node sidecar for `.vsk` transforms + typecheck only
- [ ] **(was Phase 2)** Persistent `.vesk-cache/`, parallel module graph, lazy dev compilation, shared-chunk code-splitting
- [ ] **(was Phase 3)** Security hardening: import allowlists, hashed assets + SRI, eval-free scanner (`haul audit`), dev-server hardening, secret redaction
- [ ] **(was Phase 4)** Native `.vsk` parser/IR port (drop sidecar); optional vesk-owned tree-shaker/minifier behind differential gate

### Focus: markdown (Md) — anchors, links, HTML audit
- [x] **Link titles corrupted the href** — `[docs](url "Title")` glued the title into the URL. Now parsed (`splitLinkTitle`, whitespace-before-quote required so `?q="1"` stays in the destination) and emitted as a proper escaped `title="…"` on `<a>` and `<img>`.
- [x] **Intraword underscores wrongly emphasized** — `some_var_with_underscores` produced `<em>var</em>`. CommonMark flanking rules implemented for `_` (openers/closers must not touch alphanumerics); asterisks keep allowing intraword.
- [x] **Angle autolinks added** — `<https://…>`, `<mailto:…>`, `<user@host.tld>` render as links when `autolink` is on (Md default); non-URLs stay escaped; hrefs still pass sanitizeUrl. Legacy `renderMarkdown()` without options keeps byte-compatible output.
- [x] Tests: md.test.ts 80 → 96 (titles incl. escapes/parens/images, angle autolinks + safety, underscore flanking, URL-with-quote regression).
- [x] **Reference links/images** (`[text][ref]`, collapsed `[text][]`, shortcut `[text]`) — definitions (`[label]: dest "title"`, incl. `<angle>` dests) collected outside fences and stripped from output; failed inline links never re-interpreted as shortcuts; labels case-insensitive.
- [x] **Setext headings** (`Title\n===` → h1, `---` → h2); standalone `---` still a thematic break.
- [x] **Entity decoding** in prose — ~45 common named entities + decimal/hex numeric refs, decoded then re-escaped (so `&lt;` still renders visible `<`); code spans/blocks untouched.
- [ ] **Raw HTML policy decision** — everything HTML-ish is escaped by design (XSS-safe; documented in md.ts header). If passthrough is wanted, needs an allowlist sanitizer (a/img/br/strong/em/code/blockquote?) with URL sanitization — deliberate feature, not a bug fix.

### Focus: pure-TS pipeline everywhere + @vesk/types
- [x] **haul unplugged, verified E2E on the pure-TS path** — `vesk dev` (middleware log fires, locals reach API routes), `vesk build` (full output incl. SEO/manifest) and `vesk start` (page 200 + JSON API + SSR h1) all green from `dist/cli.js`; compiler suites green (middleware 11, router 22, integration 119, parser 95, server-codegen 106, client-codegen 161, config 17, scan 39); typecheck incl. @vesk/types green.
- [x] **esbuild decoupled from sync paths** — all four `transformSync` call sites (adapter api-function, client-bundle stripTypes, adapter dev-server HMR, cli dev-server HMR) now use the compiler's dependency-free acorn-based `stripCodeTypes`; `esbuild-fallback.ts` reduced to async `build()` only, with SIGILL-triggered permanent wasm fallback. `esbuild-wasm` is now a declared optionalDependency of the CLI so the fallback is real.
- [x] **`Component` type + typed layout children** — canonical `Component` (renderable content: string|number|boolean|null|undefined|nested arrays) and `LayoutProps { children?: Component }` added to @vesk/types; test-app `app/layout.vsk` and the create-vesk scaffold layout both import it (verified: no conflict with typecheck's injected ambient declarations). create-vesk templates also updated: tsconfig drops deprecated `baseUrl` (paths resolve config-relative since TS 4.1), API route templates split `import type { VeskRequest } from '@vesk/types'` from the runtime value import.
- [x] **@vesk/types created** — single source of truth for every public framework type (config/plugin/security/middleware/route nodes/build options/manifest/request-response shapes). Compiler + adapter `types.ts` are re-export shims; drifted duplicates (`VeskPlugin`, `VeskSecurity`, `RouteNode` differed between compiler and adapter) unified. Wired into workspaces, build-packages (built first — leaf), tsconfig paths, release publish order, test-app tarball pin + refresh-testapp-deps TARGETS.
- [ ] **Route remaining user-facing type imports through @vesk/types** — test-app/joe app files still `import type { MiddlewareContext } from '@vesk/compiler'` / request types from runtime (works via back-compat re-exports, but new code should use '@vesk/types').

### Focus: async components + error isolation + hydration error reporting
- [x] **Async component breaks hydration silently** — fixed. Async-child propagation in client codegen (`async` parent scope + `await`, resolved fragment appended) + SSR awaits async children; `/async` full-page-reload hydration verified (data persists, markers claimed, zero errors) via hydration-test 12/13 + browser probes.
- [x] **A broken component cascades to other components/pages** — fixed. SSR: generated route code catches the page render error (`__renderHtml` try/catch, `NotFoundError`/`Redirect` re-thrown), renders `error.vsk` body in the page slot, layout chain survives, status 500, partial page output never leaks. Client: hydration-test Test 17 (17a full-load client-throw / 17b server-throw / 17c SPA-nav) proves the broken page errors itself only — nav + footer survive, zero uncaught page errors, and navigation to/from the broken route keeps working. Root cause of the "corrupts unrelated render" symptom was the shared `globalThis.__vsk_ssr_data` cross-request store (fixed via per-request AsyncLocalStorage `ssr-store.ts`); per-page SSR data isolation now covered by `server-codegen.test.ts` (sequential + concurrent `Promise.all` renders never mix `useFetch` data, and pages without `useFetch` emit no data script).
- [ ] **Unhelpful hydration failure reporting** — when SSR renders correctly but client hydration fails, the user gets no message or a cryptic one. Need: clear error surfaced on the client (component path, expected node vs found, which step failed), plus a dev-server/console channel, and make it easy to reproduce.
- [ ] **SSR vs client-only operations (`window`, `document`, timers, listeners)** — audit how SSR handles client-only code in components. Today: top-level `window` access in a component body would crash SSR (or be silently guarded?). Document/enforce the intended path (`effect()` bodies, `{#client}` blocks, `import.meta.env.SSR`, or a runtime `browser` guard) and add tests.
- [ ] **Statement-mode semicolon tolerance + collision safety** — parser now accepts a bare expression statement followed by a newline + JSX (no semicolon) via the `#jsxStartsStatement` token flag; codegen `semicolonizeStatement()` appends `;` only when the statement doesn't already end with `;`/`}`. TODO: verify no double-semicolon and no comment-swallow edge cases (statement ending in `// comment`), and that user-added semicolons are never duplicated.

### Abuse-testing program (A1–A8)
> Deliberately break things as both a clueless newbie and a "clever" power user, in every feature, in every mode (expression + statement), on SSR + client + hydrate + navigation. For every failure that is OUR bug (not the user's), fix it + add a regression test. For genuinely-user-error cases, make sure the error message tells them what they did wrong. Run these against the live dev server AND the hydration harness.
- [ ] **A1 parser abuse** — whitespace everywhere: tabs, blank lines, CRLF line endings, no trailing newline, `export  default  component` (extra spaces), `async\ncomponent` (newline between), comments between statements, JSX after every statement kind without semicolons, huge indentation, BOM.
- [ ] **A2 type abuse** — wrong prop types, missing props, extra props, `null`/`undefined` passed in, unions/`any`, generics misuse (`<number[]>` in wrong spot), `as` casts to wrong type, spread props overriding explicit props, prop named `class`/`style`/`children`/`key`/`ref`.
- [ ] **A3 expression abuse** — string concat with numbers, template literals with nested quotes, escaped quotes, nested ternaries, optional chaining on `null`, `??` vs `||`, `in`/`instanceof`, chained comparisons, negative numbers, `0` vs `''` falsiness, division by zero, `NaN`.
- [ ] **A4 JSX/attr abuse** — spread order vs explicit attributes, empty string attrs, boolean attrs (`disabled`, `checked`), numeric attrs, `className` vs `class`, SVG elements, void elements (`<br>`, `<img>`), unclosed tags, wrong-case tags, `<style>` blocks, self-closing vs paired, fragments.
- [ ] **A5 reactivity abuse** — `track()` in wrong scope, mutating a tracked var during render, `set()` inside an effect loop (infinite), double-track same name, tracking without rendering, derived chains, `untrack` misuse, track of objects (reference vs deep), keyed maps with duplicate/NaN keys.
- [ ] **A6 async/error abuse** — async child from sync parent, async parent from sync child, rejected promises, never-resolving promises, throwing during SSR render, throwing during client hydrate, error in one route vs navigation to another, error inside a loop/map item, error inside try/catch, async in statement mode.
- [ ] **A7 lifecycle/layout abuse** — broken page vs layout (who survives), multiple nested layouts, nested `<Outlet>`, navigation to broken route then back to good one, HMR after breaking a file, 404 page with broken sibling.
- [ ] **A8 runtime/DOM abuse** — `window`/`document`/`localStorage`/`navigator` in component body (SSR!), timers + listeners without cleanup, direct DOM manipulation alongside vesk nodes, side effects in top-level code, `import.meta.env` usage, `document.getElementById` in effects, server-side globals in client bundles.

### Reactivity in components
- [x] **`effect()` in components** — auto-imported (`@vesk/runtime`) in server + client scopes; expressions rewritten with `set()/get()` on both sides; works in statement and expression mode. 3 integration tests.
- [x] **`derived`/`untrack`/`peek`/`tick`/`flushSync`/`on_destroy`/`createContext` auto-import** — server scope via `autoImportable` scan (RuntimeStatement + loadFn + staticProps).
- [x] **Phantom `batch` import removed** — `batch` doesn't exist in the runtime; no auto-import, no client import emission.

### Client islands
- [x] **`component Name() #client {}` syntax** — `#client` keyword accepted before and after params (`tt.privateId`).
- [x] **`{#client}` / `{#server}` / `{#empty}` blocks** — parsed as block tags; server skips `{#client}` content, client skips `{#server}`.
- [x] Islands render on both server and client (per design); `{#client}` content is SSR-stripped, present in client bundle.

### Loops + switch on client (statements page fix)
- [x] **`WhileLoop` / `ForLoop` / `SwitchBlock` client emission** — anchor comments + render function + flip-effect re-render (`destroy_block` + `__cleanup`), wired into `emitNode`.
- [x] **Switch SSR fall-through fixed** — `break;` emitted per case (server + client); old test updated to matching-case-only semantics.
- [x] **Hydrate-mode region claiming** — all region emitters (`OpaqueDynamicRegion` if/else, `while`/`do-while`, classic `for`, `switch`, non-keyed `map`, `try/catch`) now run their hydrate render fns **during body execution** (claim order == SSR order) instead of deferring to effect-flush; anchors are held detached until render, then placed **in place** via `__place(start, end, claimedNodes, parent)` (places in existing parent, or falls back to fragment); re-render effects carry `let __first = true; if (__first) { __first = false; return; }` guard so reactivation never re-places. Zero leftover markers, zero JS errors — `/statements` hydrates in place on prod, all 121 hydration tests green. 8 new/updated regression tests.
- [x] **Hydrate map body-exec arg-order bug** — `renderItem(item, arr, __cl)` passed the collect array in the `__r` slot → `TypeError: Cannot read properties of null (reading 'insertBefore')` in Layout. Now `renderItem(item, arr, null, __cl)`; `renderItem` does `if (__cl) __cl.push(v); else __p.insertBefore(v, __r);`.
- [x] **`__place` per-chunk redeclaration fixed** — every compiled file emitted `function __place(...)`; concatenated chunks threw `Identifier '__place' has already been declared`. Adapter `stripRuntimeImport` now strips per-chunk copies, defines one canonical `placeFn` (next to `cleanupFn`), appends it in both codeSplit and mono bundle paths, and exposes `globalThis.__place` for dynamic chunk use.
- [x] **`const __cl` collision fixed** — multiple top-level maps in one component body emitted `const __cl = [];` in the same scope → `Identifier '__cl' has already been declared` (broke `/map`, `/async` SPA nav). `emitMap` hydrate body-exec now allocates a **unique collect array per region** via `ctx.n()` (`const $n13 = []; … __place($n3, $n4, $n13, $root)`); render-fn-scoped `__cl` in other emitters is unaffected.
- [x] **Static text bindings are snapshots, not effects** — `effect()` blocks only run at microtask flush, so effects reading loop-local plain vars rendered final values (`i=3i=3i=3`, `while 555`). New `isReactiveExpression()` walks the expression AST (same visitor shape as `transformTracked`; `props` refs and tracked virtual ids are reactive) and `emitDynamicBinding` emits `document.createTextNode(String(expr))` for non-reactive text (snapshot at creation) — reactive text still gets `effect()`. Fixes per-iteration loop text in all modes.

### SSR correctness
- [x] **Event handlers excluded from SSR HTML** — `on*` dynamic attributes no longer evaluated server-side (was executing mutations / crashing); skipped like static handlers.
- [x] **Dynamic attribute placeholder bug** — `class={x}` etc. never rendered server-side (replace never matched); placeholders now appended to openTag.
- [x] **Async page 500** — fixed. Root cause was cross-request SSR data via `globalThis.__vsk_ssr_data`; replaced with per-request `AsyncLocalStorage` store (`ssr-store.ts` + runtime `SsrDataSink`, no globalThis). `/async` returns 200 with data that persists through hydration (prod + dev).
- [x] **SSR ignores non-runtime module value imports (fixes vesk-docs `/guide` 500: `ReferenceError: GUIDE is not defined`)** — the SSR scope (`__vesk`) only ever contained runtime exports (`@vesk/runtime`/`@vesk/reactivity`) and top-level decls, so `.vsk` files importing values from plain `.ts`/`.tsx`/`.js`/`.json` modules (e.g. `import { GUIDE } from '../lib/guide.ts'`) got those names into the client bundle but never into server component bodies. New `packages/compiler/src/module-imports.ts` — a synchronous, self-contained SSR module loader: resolves relative/absolute/bare specifiers with extension probing (incl. `index`/`package.json.main`), strips TS, rewrites ESM `import`/`export` to a CJS `new Function` body (AST-driven via esrap — named/default/namespace/`export from`/`export *`/`export * as ns`/`re-export`, no regexes), recursive `require` for nested relative imports, mtime-keyed cache so dev edits reload without restart, native-`createRequire` fallback. Wired into `server-render.ts` `compileFileInternal` (module values merged into `__vesk` **before** `evalTopLevelCode`, and sub-`.vsk` scopes hoisted into the parent so registry-composed components can destructure their own imports + top-level helpers) and `renderPageStream`; `server-jsgen.ts` `buildComponentMap` adds `localValueImportNames` to both the `importedNames` set (so local functions used as `<Tag/>` call directly, matching client) and the `__vesk` scope decl. `@vesk/*` targets stay runtime-scope, `.vsk` targets stay registry-resolved, `.css`/`.md` carry no value; unresolvable modules warn + skip. 17 tests in `module-imports.test.ts` (extraction, resolution, ESM→CJS forms, JSON, end-to-end SSR in expression + statement modes, aliased/default/namespace/type-only/mixed, extensionless, nested imports, composed sub-`.vsk`, runtime coexistence). Also fixed stale `../../_lib/guide` → `../../lib/guide` import in vesk-docs `app/guide/[...path]/page.vsk`. Verified: `/guide` and `/guide/getting-started` 200 on a scratch dev server; full typecheck + all compiler suites green.

- [x] **SSR module loader hardening (P0/P1/P2)** — `module-imports.ts` gains: **native resolution first** for bare specifiers (`createRequire.resolve` — `exports` maps, conditions, `node:` builtins) with the `node_modules` walk-up fallback; **Node builtin support** (`loadBuiltin` + `\0builtin:` marker, `BUILTIN_CACHE`); **transitive-closure invalidation** (`depStack` evaluation frames + `deps` mtime snapshot — editing a leaf reloads every ancestor); **live export bindings** (`Object.defineProperty(exports, k, { get })` — post-import mutable exports are observed); **strict mode** prepended to ESM-rewritten bodies; **fail-loud guards** — `import.meta` and top-level `await` THROW a specific error instead of silently yielding `undefined`; **circular-import tolerance** (`EVALUATING` in-flight map → partial exports, no infinite recursion); `realpathSync`-normalized cache keys + LRU cap (`MAX_CACHE_ENTRIES`) for symlinked `node_modules`; runtime-eval failures warn then fall back to native `require()`. **Side-effect imports** (`import './x'`) survive `stripTypeImport` (zero specifiers ≠ type-only) and are executed server-side — `applyLocalModuleImports` now runs every resolvable import, merging values only for bound names. **Shadowing parity** — auto-import defers to a locally imported name: `ir-generator` skips runtime auto-imports for any name the file binds itself; `client-codegen` drops shadows from the injected `@vesk/runtime` import (server + client agree, no duplicate `effect`). **CI fix** — `node:module` added to the adapter `empty-node-builtins` esbuild stub (`platform-handler.ts`; fixes ci-report 33181526859 bundle failure); stub also exports `createRequire`/`realpathSync`/`isAbsolute`. Tests: module-imports 17 → 26 (node: builtins, exports-map fixture, live bindings, import.meta throw, TLA non-silent, cycles, transitive invalidation, side-effect execution incl. end-to-end render), vsk-imports +2, integration +1 (shadowing, both generators). Suites green: server-codegen 124, client-codegen 175, ts-support 25, track-codegen 14, vsk-tsx 26, vsk-imports 16, parser 95, ir-generator 9, integration 124, adapter tree-shake 17; `npm run typecheck` clean.

- [x] **CI: green + de-complicated** — root-cause fix for the persistent CI breakage (ci-report 33181526859 onward, all 3 jobs red): `bundleRuntime`'s esbuild externalized `node:fs`/`node:path`/`node:async_hooks` but not `node:module` (compiler's SSR chain now pulls in `module-imports` → `createRequire`), so `vesk build` failed `Could not resolve "node:module"` in the Test (code-split), Production (leakage) and Platform (smoke vercel) jobs. `node:module`/`module` added to the server-runtime `external` list (real builtins — the prod server needs createRequire at runtime; the edge path already stubs it via platform-handler f7a0050). Verified locally (`vesk build` plain + `--platform vercel` both clean) and in CI. **Workflow simplified**: `test`+`prod`+`deploy-targets`+`release` (4 jobs, triple duplicate bootstrap) → `verify` (single pipeline: typecheck → `npm test` → dev hydration/crawl → leakage (builds prod) → prod hydration/crawl, reusing leakage's `.vesk`, logs only on failure) + `platforms` (smokes + edge/deno hydration cert) + `release`. First consolidated run: both jobs green.

### Full TypeScript support in .vsk (tsc-in-.vsk)
- [x] **Runtime TS-stripping for emitted JS** — new `strip-ts.ts`: removes annotations, `as`/`satisfies`/`!`/`<T>expr`/generic-call wrappers, type arguments, and drops type-only statements (interfaces/type aliases/enums/declare) from both server and client bundles; raw text preserved when no TS syntax present (`hasTsSyntax` fast path). Top-level `evalTopLevelCode` regex fallbacks removed (AST-only). **Fix: TS-wrapper stripping is now recursive** (`context.visit(node.expression)` for TSAsExpression/TSSatisfiesExpression/TSNonNullExpression/TSTypeAssertion/TSInstantiationExpression) — nested `as unknown as`, `as const as`, `!`+`satisfies` chains strip fully.
- [x] **Tokenizer: JSX-vs-generic + JSX-after-statement** — `vesk-plugin.ts` `readToken` forces `jsxTagStart` when `<`+letter/`/` follows a non-expression-ending token OR starts a new statement (line break), so `helper<string>('x')` stays generic while `[3, 4]\n<p>{x}</p>` parses as JSX (ASI). **Fix: statement-mode `as`/`satisfies` + newline + bare JSX** — acorn-typescript leaves `inType` set after a trailing `as <Type>`, so `<` was eaten as generic type args (`string<p>`). `readToken` now also emits `jsxTagStart` directly (`finishToken(tstt.jsxTagStart)`) when in a type context AND a new statement begins on a new line.
- [x] **Type-only imports** — `import type { X }` and inline `import { type A }` from `.ts`/`.vsk` are dropped from IR imports and both bundles (via `isTypeOnlyImport`/`stripTypeImport` in `vsk-imports.ts`, using esrap `print`), never resolved as `.vsk` component imports by `collectVskImportPaths`, but kept intact by `vskToTsx` for tsc. 15 vsk-imports tests.
- [x] **Server codegen: dynamic attributes rendered exactly once** — `class={x}` / `` class={`bg-${x}`} `` rendered once in both modes (was duplicated `class="" class="bg-red"` when a static attr preceded the dynamic one); dynamic attrs skipped in the static loop via `dynAttrTargets`.
- [x] **Every TS operation works in .vsk** — interfaces, type aliases, casts (`as` chains), assertions (`!`, `satisfies`), generics, union/intersection/mapped/conditional types, utility types, keyof typeof, template literal types, enums, optional chaining, destructuring, statement-mode casts — all tested (25 ts-support tests). **Fixed tokenizer helpers (2026-08):** `looksLikeGenericArrowAt` / `looksLikeTypeAssertionAt` in `vesk-plugin.ts` avoid forcing JSX for `<T,>(...)` and `<Type> expr`; angle-bracket `<T>expr` remains same-as-TSX limitation — use `as` (`expr as T`) in .vsk
- [x] **Runtime `const`/`let`/`var` declaration statements as element children (fixes vesk-docs `/statements` SSR 500)** — declaration statements (incl. ASI/no-semicolon) nested in JSX children (e.g. `const total = items.length * 2` inside `<div class="claims-row">`) were parsed as literal JSX text, crashing SSR with `ReferenceError: total is not defined`. `vesk-plugin.ts` `#scansChildStatement` now recognizes them by a top-level `=` of assignment plus a top-level `;` (or depth-0 newline for ASI), scanning quotes/strings/templates and paren/bracket/brace depth — no regex. Hardened against false positives: bail out to text when a closing JSX tag `</` is seen before terminator, so prose like `<p>const value = 5 apples</p>` / `<p>let x = y</p>` stays text. Covers `>`/`<` comparisons, object/array/destructure/arrow/ternary/multi-line-template/regex initializers, `var`/`let`, multi-line parens. 25-case SSR+client stress probe all green; server-codegen +117, client-codegen +169 (bothModes), parser 95, integration 123. Verified end-to-end: vesk-docs `/statements` now HTTP 200 rendering `length * 2 = 6`.
- [x] **`tsc` typechecks .vsk files** — via `vskToTsx` transform + generated `.d.ts` (`generateVskDts`); `vesk typecheck` CLI command (in-memory `ts.LanguageServiceHost` — no tsx on disk, like `vue-tsc`/Volar). CLI command added to `packages/cli/src/index.ts` (`vesk typecheck [--no-strict]`, exit 1 on errors); whole test-app typechecks clean. Fixed `vskToTsx` track-decl rewrite emitting `const let` (declarator start missed the `const` keyword) + doubled `;;` terminators; extended typecheck `AMBIENT` with the auto-importable runtime surface (`useFetch`, router hooks, `Link`/`NavLink`/`Outlet`, `Form`/`Field`/validators, SEO schemas, action helpers, `redirect`/`notFound`/`NotFoundError`).
- [x] `vskToTsx` — statement mode header transform (`component → function` + `()` synthesis), track decl rewrite (`&[a, b]` → typed aliases), style blocks stripped, `client` keyword stripped.
- [x] `generateVskDts` — typed/untyped props aliases (`AppProps = any`), collision inlining, destructured params from annotations, imports/type decls preserved. 22 tests.
- [x] `propsType` on ComponentIR — wired in `ir.ts`/`ir-generator.ts`/`vsk-tsx.ts`; added `props-type.test.ts` (8 tests: single/destructured/multi/optional/empty, IR + dts, statement vs expression)
- [x] TS support test suite — `ts-support.test.ts` (25 tests: parse/SSR/client/imports/casts/types in both modes).

### Tree-shaken client runtime (0.1.5)
- [x] **Tree-shaken runtime bundle** — `buildTreeShakenRuntime(runtimeDir, usedNames)` (`packages/adapter/src/client-bundle.ts`): temp entry `export { … } from './index-client.js'`, esbuild IIFE (`globalName: __veskRuntime`, treeShaking, minify, es2022), then `const { … } = __veskRuntime;` + explicit `export { … };`. Replaces regex file concatenation (fixed identifier-collision source). Falls back to legacy `buildRuntimeCode` on missing names/esbuild error.
- [x] **ESM explicit-export bug (critical)** — top-level `const` bindings are NOT module exports in Chrome/Node; the IIFE alone yielded 0 exports in the browser. Fixed by appending the explicit `export { … };` line. Verified via Chrome 149 puppeteer probe: 110/110 names resolve.
- [x] `runtimeExportNames(runtimeDir)` — parses `export { … } from` lines of `dist/index-client.js` (112 names); dev server uses the full set (one runtime serves all pages, 59606B), production uses per-app used names.
- [x] `matchRoute` + `ensureChunk` exported from `@vesk/runtime/src/router` + `index-client`; legacy concat strips `export { … } from '…'` lines.
- [x] **Production sizes** — minimal app `static/client.js` = 37596B (under 38KB; tree-shake drops reconcile/form/resource/image modules), 14-page feature-heavy test-app = 48168B (code-split page chunks keep pages small).
- [x] **Tree-shake test suite** — `packages/adapter/src/tree-shake.test.ts` (17 asserts: IIFE, explicit exports, unused modules dropped, ESM importability, full-set exports, legacy fallback).
- [x] Version 0.1.5 (cli/runtime/compiler/adapter) + tarballs refreshed in `test-app/tarballs/`; clean reinstall verified. `npm run dev` chain works.

### Focus: security hardening — framework package audit (2026-08-25)
> Audit of compiler/runtime/adapter/cli. All 12 findings fixed + tested (2026-08-26). Browser-probe suites (code-split/hydration.test) still need CHROMIUM_PATH in this env.

- [x] **[HIGH] XSS: hydration props serialized raw into inline `<script>`** — new `safeJsonForScript()` escapes `<`→`\u003c` + U+2028/2029; applied to `__vesk_props`/`__vsk_ssr_data` scripts in `ssg()`, `buildDataScripts()`, prod `ssr-data.js`, and the CLI dev twin token store. Regression tests both modes (`ssg.test.ts` 11 tests incl `[expr]`/`[stmt]` breakout cases).
- [x] **[HIGH] CSRF enforced nowhere** — new `assertSameOrigin()` (compiler server-utils): unsafe methods require Origin/Referer authority == Host (non-browser clients without Origin allowed; one-sided port tolerated, never a different hostname). Wired into generated `handleAction` (`ssr-function.ts`), CLI dev action handler, and `executeApiRoute` (opt-out per-route via `config.csrf=false`). E2E verified against a real build: cross-origin POST → 403, same-origin passes.
- [x] **[MED] Weak CSRF/crypto primitives** — `csrfHmac` is now pure-JS HMAC-SHA256 (sync, works Node+browser; matches RFC 4231 test vector); secrets/tokens via `randomToken()` (WebCrypto CSPRNG): csrf secrets, cookie secrets, ssr-data store tokens (runtime-bundle + cli dev store).
- [x] **[MED] HMR eval gadget + no WS origin check** — `globalThis.__vesk_hmr_eval` is nonce-gated (server generates per-session nonce → broadcast with every `update`; gadget throws on mismatch); WS upgrades origin-checked via `isAllowedWsUpgrade()` in both adapter HMR server and CLI dev server (loopback aliases localhost/127.0.0.1/[::1] equivalent). hmr e2e: same-origin connects, cross-site Origin destroyed.
- [x] **[MED] Servers bind all interfaces by default** — all three servers default to 127.0.0.1; `--host` / `DevServerOptions.host` / `ProdServerOptions.host` opt-in to expose (`@vesk/types` updated).
- [x] **[MED] Unbounded request bodies + error leakage** — `DEFAULT_MAX_BODY_BYTES` (1 MiB, configurable via options.maxBodyBytes) enforced in buildWebRequest, adapter dev/prod makeWebRequest, CLI action+API paths (413 responses). Error details (message/stack/action errors/ssr-error comment/x-vesk-data JSON/API 500s) gated on NODE_ENV: prod returns generic text; `vesk start` sets NODE_ENV=production. Verified live: `/srvthrow` leaks in dev, generic in prod.
- [x] **[MED] Rate-limit IP spoofing** — exported `getClientIp`/`getClientProtocol` ignore proxy headers unless trustProxy; rate limiter takes `trustProxy` option; runtime `VeskRequest.ip/.protocol` honor proxy headers only after `setTrustProxy(true)` (protocol falls back to URL scheme).
- [x] **[LOW-MED] Path containment uses `startsWith(dir)` without separator** — single helper `resolveWithin(base, rel)` (resolve + sep-prefix, rejects base itself) used by prod public/static serving, adapter dev static/public/build-public, CLI public serving, and SSG prerender writes (getStaticPaths paths can no longer write outside prerendered/). Unit tests in `adapter/src/paths.test.ts`.
- [x] **[LOW-MED] Broken config fails open** — prod config load failure now logs loudly ("falling back to secure defaults") instead of silently proceeding; secure header defaults still apply.
- [x] **[LOW] `raw()` bypasses autoEscape silently; Form/Field label unescaped** — SSR `<label>` text escaped in runtime Form (`form.ts`), overlay tips escaped like siblings in hmr-client; regression test in form.test.ts. (autoEscape warning deferred — raw is documented API.)
- [x] **[LOW] CORS `Allow-Credentials` defaults on whenever CORS enabled** — credentials now opt-in (`cors.credentials === true`) and never combined with wildcard origin. Tests added.
- [x] **[POLICY] Regex remains in packages/compiler/src** — all replaced with char-scan equivalents: escapeHtml ×2 (+ quoteAttr/safeJsonForScript), redactLog scanner (token prefixes/Bearer/Basic/PEM/key=value, two-pass, preserves `sk_live_***` shape), cookie sig trim, CORS scheme strip, generated `__escape`, CSP meta attr, router/api path normalization (`collapseSlashes`, manual `/api` prefix strip), error line/column extraction (`findKeywordNumber`). `grep -rnE` over compiler src shows zero regex literals outside comments/strings.

### Focus: streaming + runtime markdown-file loading (2026-08-29)

- [x] **`useFetch.stream`** — `streamText()` + `useFetch.stream(urlOrFn, { into, onChunk, ... })`; URL-provider form re-read per fetch (stale-`url` bug fixed: provider called once with the initial value, so switching a route re-used the old URL); `key` defaults to string URL; `.into` cell gets progressive chunks. New `VeskResponse.stream(readable, init?)` static.
- [x] **`resolveFetchUrl` prefers `ctx.resolveUrl`** then string `ctx.url` then `__vesk_ssr_base_url`; `VeskRequest.from(request, { params })` auto-set on the non-middleware SSR path (`ssr-function.ts`), `resolveUrl` added to middleware ctx and action-path ctx (`platform-handler.ts`).
- [x] **Server-side streaming passthrough** — `deliverResponse(res, response)` (getReader loop → `res.write(Buffer.from(value))`, text fallback) in `dev-server.ts` + `prod-server.ts`; `/api` handlers stream in both servers (verified `Transfer-Encoding: chunked`); dev action stays buffered (HMR `<script>` injection); prod action streams.
- [x] **`Md` runtime public-path loading** — `readServerMdPath` via `globalThis.__vsk_md_read_file` hook; `installMdReadHook(publicDirs)` wired into BOTH `packages/adapter/src/dev-server.ts` (devDir + static/public) and `packages/cli/src/dev-server.ts` (client `vesk dev` uses the CLI bundle, so the adapter call is invisible without this); rejects `//`, `?`, `#`, `\`, only `.md`/`.markdown` inside public dirs; not-found → literal path render. Missing-file literal + ssr-data stash covered by tests.
- [x] **`__vsk_ssr_base_url` typo fixed** — src read `__vsk_ssr_base_url` (missing 'e') while setters and dist used `__vesk_ssr_base_url`; two SSR-fetch tests failed until fixed. Tests resolve `@vesk/runtime/src/*` through the exports map (`"./src/*": "./dist/*.js"`), so `npx tsx packages/cli/src/build-packages.ts` must run after src edits.
- [x] **Tests** — `resource.test.ts` 36 (stream progressive totals, URL-provider refresh, SSR hook + base-url), `md.test.ts` 124 (SSR non-public literal, hook render + ssr-data stash, missing-file literal, client path literal→upgrade after fetch, reactive cell re-render via `root`/`flush_sync` + mockDocument), `request.test.ts` 91; typecheck clean. Dev-server verified end-to-end through `vesk-web` (http://localhost:3000): chunked API route, SSR path hook render (block 1 = `Welcome to Vesk`), static/live/streamed blocks all render.
- [x] **`vesk-web` scratch app** — `app/api/docs/[...path]/route.ts` streaming text route, `app/page.vsk` four-Md demo (streamed docs select, runtime pubPath select, static compile-time inline, live tracked cell), `public/notes.md`.

### Focus: configurable Md raw-HTML policy (2026-08-26)
> Users are free to render raw HTML in Markdown; the framework warns instead of blocking. All surfaces green.

- [x] **Config** — `vesk.config.ts` gains `md: { html: 'escape' | 'allow' | 'allowlist', allowTags?: string[] }` (`MdConfig`/`MdHtmlMode` in @vesk/types). `defineConfig` normalizes (lowercases tags) and throws on unknown modes. Default stays `'escape'`.
- [x] **Renderer** — `renderMarkdown`/`renderMarkdownEx` honor the policy: `'allow'` passes raw HTML verbatim; `'allowlist'` renders only allowed tags, drops `on*` handlers and sanitizes `href`/`src` via sanitizeUrl; disallowed tags stay escaped as visible text. Char-scanned tag parser handles comments, quoted attrs with `>` inside, self-closing + closing tags.
- [x] **Global wiring** — `configureMd()` applied from CLI build+dev and `vesk start` (prod-server) so SSR/SSG/hydration all follow vesk.config; per-instance `<Md html allowTags>` props override. `MD_DEFAULT_ALLOW_TAGS` is inline-formatting-only (no script/iframe/img/div by default).
- [x] **Warnings everywhere** — per-render `[vesk-md]` console warning (deduped per tag); `drainMdHtmlWarnings()` summary printed once at end of `vesk build`; **LSP**: new `mdHtml.ts` plugin emits `vesk-md-html` diagnostics for raw HTML inside .vsk markdown template literals and .md files (message adapts when config enables passthrough) and hovering `<Md` or a tag shows the effective policy.
- [x] **Tests/docs** — md.test.ts 120 (+11: three policy modes, attr filtering, configureMd precedence, drain, unsafe-default-tags guard), config.test.ts 21 (+4), lsp-smoke 42 (+3: diagnostic + escaping message + `<Md` hover). Full suite 46 files / 1508 / 0 failed; hydration-test 284/284. llms.txt updated (runtime API + notes, compiler config).

### Focus: @vesk/runtime/router + server subpaths, router.isLoading, no-anchor-interception (2026-08-26)
- [x] **Navigation policy: the router never intercepts anchors** — removed createRouter's global document click listener (the only one). SPA navigation happens exclusively via `<Link>`/`<NavLink>`/`navigate()`; plain `<a href>` (incl. markdown-rendered links) does native browser navigation; hash/mailto/tel untouched. Negative tests assert NO document click listeners for both routers.
- [x] **`useRouter().isLoading`** — facade and both router instances expose reactive `isLoading` backed by the shared LoadingIndicator cell (driven by loadingStart/loadingFinish during navigations).
- [x] **Canonical subpath exports (no new packages, per rule)** — `@vesk/runtime/router` = full routing surface (createRouter/createFileRouter, Outlet, Link, NavLink, useNavigate/useParams/usePathname/useSearchParams/useRouter, matchRoute, ensureChunk, redirect/notFound helpers) + LoadingIndicator family incl. `getLoadingState()`; `@vesk/runtime/server` = request/response primitives, cookies, headers/locals, cors, hooks, ISR, actions. Runtime barrels keep back-compat re-exports for compiler auto-import + client bootstrap.
- [x] **Compiler: runtime specifier normalization** — `.vsk` imports of `@vesk/runtime/<subpath>` normalize to bare `@vesk/runtime` at IR level (char-scan, no regex), so client chunks never leak raw ESM imports (fixed code-split/hydration E2E breakage: "Cannot use import statement outside a module").
- [x] **Migrations** — test-app (.vsk) + create-vesk templates import routing from `@vesk/runtime/router`; api routes from `@vesk/runtime/server`. Tests: router.test 52 (+2 isLoading/barrel).
- [x] **useRouter() Tier 1-3 surface** — facade exposes `progress` (0–100 number), `error` (boolean), `pathname` (string), `params` (Record), `search` (string), `setSearch()`, `route` (snapshot), `go()`, `canGoBack` (boolean). `beforeEach` guards on both createRouter and createFileRouter (sync fast path for sync guard functions, async via `.then()` chain when guards are async). View transitions (`viewTransitions: true` option) wrap DOM swap in `document.startViewTransition` when available. `scrollToHash()` called after every render for anchor restoration. Tests: facade getters, guard block/redirect, go/canGoBack, progress/error toggle, route snapshot. navigate() stays synchronous for sync guards (backward-compatible with all existing callers).

#### Focus: user-facing documentation tree (docs/guide/)
- [x] **`docs/guide/` — 40 feature pages + index** (one `doc.md` per module, website-ready): getting-started, cli, dev-server, configuration; language (components, body-modes overview + dedicated expression-mode/statement-mode pages, typescript, styles, client-boundary, head-metadata); reactivity; routing ×7 (file-based, router-api, Link/NavLink/hooks JSDoc, loading-states, error-handling, offline-network, loading-indicator); ssr-hydration, data-fetching, isr, ssg; forms-actions, bindings; built-ins ×5 (headless, portal, markdown, image, experiment); api-routes, request-response, cookies, middleware, seo; security, deployment; plugins, tooling ×2. Every public API as extractable JSDoc.
- [x] **Maintainers docs relocated** — `git mv docs/{analysis,decisions,haul.md} → docs/maintainers/` + index.md (internal-only rules and analyses out of the user docs root).
- [x] **Full-guide friendliness pass (all 42 files mapped & fixed)** — every `docs/guide/**/doc.md` now opens with a user-facing introduction (what it is / why you'd care) before any API or code: cli, configuration, components, typescript, styles, head-metadata, reactivity, router-api, components-and-hooks, error-handling, data-fetching, headless (concept explainer), experiment, image, api-routes, request-response, cookies, middleware, seo, deployment, plugins, lsp-editors, prettier-tailwind. Pages already friendly from earlier passes (getting-started, index, body-modes trio, bindings, isr, forms-actions, security, ssg, ssr-hydration, file-based routing, loading states/indicator, offline-network, portal, markdown, dev-server) confirmed. 0 broken links; all verified examples untouched.
- [x] **Example verification harnesses (audit round 2) — 90 green assertions total**: (a) `/tmp` compile smoke 44/44 — every `.vsk` snippet through parse→IR→SSR→client; (b) round-2 additions 7/7 (top-level defineAction Form, string-action Form, getting-started page, real error.vsk/not-found.vsk shapes, `{#client}`-gated ConnectionBadge, useFetch reactive reads); (c) runtime behavior 39/39 — VeskResponse chain/cookies/signCookie/webhook 401/cors preflight/withValidation 400/isr stale+tags/componentIsr/network shape/loading-indicator force+throttle+hideDelay/headless pure/md utils+policies/Experiment determinism/ArticleSchema/bindValue guard/matchRoute params.
- [x] **Audit fixes folded into docs**: defineAction must be module **top-level** (compiler rewrites; execute stripped client-side) — forms page corrected to match test-app; network APIs are client-barrel-only → island examples gate behind `{#client}` (server barrel lacks getNetworkState/watchNetwork); error.vsk props aligned with real app file (`error` may arrive stringified); ISR page exports documented as adapter-build-scanned (adapter/src/index.ts regex-scan → manifest → platform-handler caching); `loadingClear()` wording fixed (clears timers only); markdown warnings clarified as passthrough-only; components guide expanded (events, refs/DOM, composition, async children) with verified snippets.

## Session status
- Compiler test files run individually via `npx tsx packages/compiler/src/<file>.test.ts` (rebuild first: `npx tsx packages/cli/src/build-packages.ts`).
- Security-hardening pass (2026-08-26) complete: 12 audit findings fixed across compiler/adapter/cli/runtime/types. **Full suite green (latest: Md policy pass — 46 files / 1508 / 0 failed; prior security pass: 45 files / 1469 / 0 — incl. browser E2E: code-split 12, hmr 24, hydration 28, production-hydration 52, edge 29) · tests/hydration-test.mjs 284/284 · crawl.mjs 35/35 · typecheck clean.** Browser probes ran with `CHROMIUM_PATH=/tmp/opencode/chrome/linux-152.0.7977.64/chrome-linux64/chrome` (Chrome-for-Testing installed via `npx @puppeteer/browsers`; needs libatk/libnss3/etc via apt). Live-server verification of security fixes: cross-origin action POST → 403, same-origin allowed; prod NODE_ENV gates error details (`/srvthrow` leaks in dev, generic in prod). Fixed along the way: missing `maxBodyBytes` binding in CLI dev server (caught by live run), stale dts expectations in vsk-tsx/props-type (`children?: Component`), stale `/md` assertions in tests/hydration-test.mjs (fixture redesign; 5 pre-existing failures on main → now assert task-list/blockquote/code/table/strong/autolink).
- Active work: LSP Volar revival complete (36/36 smoke, vsix 0.2.0 standalone-verified). Hydrate-mode region claiming is complete and green. Remaining: version bump (0.1.12/0.1.9/0.1.10/0.1.9) + tarball rotation + commit/push still pending.
- Hard rule (AGENTS.md): **never use regex in the compiler/codegen** — all source manipulation through tokenizer/AST parser. Compiler src is now regex-free (2026-08-26 sweep); keep it that way with `grep -rnE '/…/' packages/compiler/src` spot checks.
- Hard rule (AGENTS.md): **every job completes with tests**, including the production-hydration path via `tests/hydration-test.mjs` (`node tests/hydration-test.mjs`). Rigorous use of the features/fixes made.
- Hard rule (AGENTS.md): **statement mode is first-class** — every body-level feature/fix and every test suite exercising component bodies must cover both expression and statement mode.

---

## Before Phase 6 — remaining gaps

Phase 6 is docs + examples; the items below should be closed first (blockers / in-progress milestones).

### Blockers (bugs)
- [x] **Async page 500** — fixed. Root cause was cross-request SSR data via `globalThis.__vsk_ssr_data`; replaced with per-request `AsyncLocalStorage` store (`ssr-store.ts` + runtime `SsrDataSink`, no globalThis). `/async` returns 200 with data that persists through hydration (prod + dev).
- [x] **Hydrate-mode loop claiming** — fixed. Region render fns claim SSR content during body execution and place it in place via `__place`; markers 0, zero JS errors on `/statements` and all routes (121 hydration tests green). See "Loops + switch on client" section.

### In-progress milestone: tsc-in-.vsk
- [x] `tsc` typechecks `.vsk` via `vskToTsx` + `generateVskDts`; `vesk typecheck` CLI command.
- [x] `propsType` on ComponentIR — wired + `props-type.test.ts` 8 tests
- [x] Angle-bracket assertions `<T>expr` + generic arrows `<T,>` — helpers added, documented as TSX-same limitation (use `as`)

### Phase 5 open items
- [x] `vesk init` creates `src/global.css` (Tailwind entrypoint)
- [x] `packages/adapters/vite` — vite-plugin-vesk
- [x] Write `/docu/cli/commands.md`

### Phase 4 open items (optional before Phase 6)
- [x] npm packaging (`@vesk/compiler`, `@vesk/runtime`)
- [ ] Suspense / async resources (compiler-level `SuspenseBlock` IR node)
- [ ] Transitions / animations
- [x] Form actions (progressive enhancement)
- [x] Headless component primitives (Show/For/Switch/Match)

---

## haul

> Native Go engine + CLI replacement. See `/docs/haul.md` for full proposal.

  ### Phase 0 — esbuild/sharp → optionalDeps + fallback
- [x] Make `esbuild` and `sharp` optionalDependencies in `packages/cli` + `packages/adapter` (already `optionalDependencies` in adapter; moved `esbuild`/`sharp` from `dependencies` to `optionalDependencies` in `cli/package.json`)
- [x] Wire esbuild-wasm fallback path with friendly warning when native binary unavailable (`packages/adapter/src/esbuild-fallback.ts` already `build()`/`transformSync()` with SIGILL catch → `esbuild-wasm`)
- [x] Verify `npm install` never hard-fails on unsupported CPU (SIGILL devices) — `sharp` import try/catch in `image-pipeline.ts` falls back to copy-only

### Phase 1 — haul binary (native CLI + bundler core)
- [ ] Go static binary implementing `haul build`/`dev`/`start`/`seo`/`typecheck`
- [ ] Embed esbuild-Go tree-shaker + minifier (conservative `GOAMD64=v1` / `GOARM=7`)
- [ ] Native TS stripper (Go) for routes, API, HMR content
- [ ] Node sidecar (`vesk-compiler`) for `.vsk` IR transforms + `typecheck` only; long-lived, batched JSON-RPC
- [ ] Remove all 6 JS esbuild call sites from `packages/adapter/src/` (client-bundle, runtime bundle, api-function, dev-server, hmr, edge-entry)
- [ ] Differential fuzz harness: tree-shake/minify output parity vs current esbuild
- [ ] All 739 compiler tests + 257 runtime tests + 121 hydration tests green on `haul`

### Phase 2 — Persistent cache + lazy dev
- [ ] Content-addressed `.vesk-cache/` shared across dev/build/CI
- [ ] Parallel module graph (goroutine pool over parse/resolve/transform)
- [ ] Lazy dev compilation (first-request route/module only)
- [ ] Shared-chunk code-splitting with deterministic hashed filenames

### Phase 3 — Security hardening
- [ ] Import allowlists (no absolute paths, no `node:` in client bundles)
- [ ] Hashed assets + SRI manifest emitted to `static/`
- [ ] Eval-free output scanner + `haul audit` command
- [ ] Dev-server hardening (path-traversal-proof, no dir listing, CSP headers)
- [ ] Secret redaction in native logger

### Phase 4 — Native `.vsk` parser/IR (drop sidecar)
- [ ] Port `.vsk` parser + IR transforms to Go
- [ ] Optional vesk-owned tree-shaker/minifier behind differential gate
- [ ] Full suite green with sidecar off

---

## Phase 6 — Docs + Examples

- [ ] `/docu/language/component.md`
- [ ] `/docu/language/statement-mode.md`
- [ ] `/docu/language/expression-mode.md`
- [ ] `/docu/language/reactivity.md`
- [ ] `/docu/compiler/pipeline-overview.md`
- [ ] `/docu/runtime/hydration.md`
- [ ] Worked examples for every grammar construct
