# Vesk — TODO

> Living task tracker. Read at start of every session. Update after every unit of work.

**Current phase:** haul

**Total tests:** compiler 739 (api-routes 13 + cli 14 + components-scan 6 + config 14 + head-merge 14 + scan 31 + server-utils 90 + ssg 8 + track-codegen 8 + vsk-imports 15 + vsk-tsx 24 + parser 79 + server-codegen 99 + integration 111 + client-codegen 160 + ir-generator 9 + router 19 + ts-support 25), runtime 257 (10 files), hydration 121
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
- [x] **Production demo** — `vesk build` + `vesk start` serving SSR with hydration, global CSS, static files, dynamic routes, API routes, 404
- [x] **CSS pipeline** — global.css detection, build copy to static/, `<link>` tag in SSR HTML, dev server CSS watching + rebuild
- [x] **npm packaging** — publish `@vesk/compiler` and `@vesk/runtime` (tarballs via `npm pack` + `create-vesk` scaffolder + local `file:` installs)
- [ ] **Suspense / async resources** — async data loading with fallback states (needs compiler-level `SuspenseBlock` IR node; `if (loading)` + OpaqueDynamicRegion works today)
- [ ] **Transitions / animations** — built-in transition directives on element mount/unmount
- [x] **Portal** — `Portal` runtime component moves DOM nodes to `props.target`. Requires `{#client}` blocks for SSR-free content. 56 tests passing.
- [x] **Form actions** — progressive enhancement form handling (server actions via `defineAction` + `Form`, client validation, `vsk-success`/`vsk-error` round-trips; hydration-test Test 15)
- [ ] **Headless component primitives** — Show, For, Switch/Match as components

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
- [ ] `vesk init` creates `src/global.css` (Tailwind entrypoint)
- [ ] `packages/adapters/vite` — vite-plugin-vesk
- [ ] Write `/docu/cli/commands.md`

---

## Current Session Work

### Focus: haul — native engine + CLI replacement
- [ ] **Phase 0** — Make `esbuild` + `sharp` optionalDependencies; wire esbuild-wasm fallback; verify `npm install` never SIGILLs
- [ ] **Phase 1** — Native `haul` Go binary (build/dev/start/seo/typecheck); embed esbuild-Go tree-shaker + minifier (`GOAMD64=v1`, `GOARM=7`); native TS stripper; Node sidecar for `.vsk` transforms + typecheck only; remove all 6 JS esbuild call sites; differential fuzz gate vs current esbuild output
- [ ] **Phase 2** — Persistent `.vesk-cache/`, parallel module graph, lazy dev compilation, shared-chunk code-splitting
- [ ] **Phase 3** — Security hardening: import allowlists, hashed assets + SRI, eval-free scanner (`haul audit`), dev-server hardening, secret redaction
- [ ] **Phase 4** — Native `.vsk` parser/IR port (drop sidecar); optional vesk-owned tree-shaker/minifier behind differential gate

### Focus: async components + error isolation + hydration error reporting
- [x] **Async component breaks hydration silently** — fixed. Async-child propagation in client codegen (`async` parent scope + `await`, resolved fragment appended) + SSR awaits async children; `/async` full-page-reload hydration verified (data persists, markers claimed, zero errors) via hydration-test 12/13 + browser probes.
- [ ] **A broken component cascades to other components/pages** — e.g. a broken `posts` component also breaks layouts; and a broken component on one page should NOT break navigation to other routes. Need per-page/route error isolation (broken page errors itself only; layout/router continues). Also investigate *why* one component error currently corrupts unrelated render (shared scope? single hydration pass aborting everything?).
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

### Full TypeScript support in .vsk (tsc-in-.vsk)
- [x] **Runtime TS-stripping for emitted JS** — new `strip-ts.ts`: removes annotations, `as`/`satisfies`/`!`/`<T>expr`/generic-call wrappers, type arguments, and drops type-only statements (interfaces/type aliases/enums/declare) from both server and client bundles; raw text preserved when no TS syntax present (`hasTsSyntax` fast path). Top-level `evalTopLevelCode` regex fallbacks removed (AST-only). **Fix: TS-wrapper stripping is now recursive** (`context.visit(node.expression)` for TSAsExpression/TSSatisfiesExpression/TSNonNullExpression/TSTypeAssertion/TSInstantiationExpression) — nested `as unknown as`, `as const as`, `!`+`satisfies` chains strip fully.
- [x] **Tokenizer: JSX-vs-generic + JSX-after-statement** — `vesk-plugin.ts` `readToken` forces `jsxTagStart` when `<`+letter/`/` follows a non-expression-ending token OR starts a new statement (line break), so `helper<string>('x')` stays generic while `[3, 4]\n<p>{x}</p>` parses as JSX (ASI). **Fix: statement-mode `as`/`satisfies` + newline + bare JSX** — acorn-typescript leaves `inType` set after a trailing `as <Type>`, so `<` was eaten as generic type args (`string<p>`). `readToken` now also emits `jsxTagStart` directly (`finishToken(tstt.jsxTagStart)`) when in a type context AND a new statement begins on a new line.
- [x] **Type-only imports** — `import type { X }` and inline `import { type A }` from `.ts`/`.vsk` are dropped from IR imports and both bundles (via `isTypeOnlyImport`/`stripTypeImport` in `vsk-imports.ts`, using esrap `print`), never resolved as `.vsk` component imports by `collectVskImportPaths`, but kept intact by `vskToTsx` for tsc. 15 vsk-imports tests.
- [x] **Server codegen: dynamic attributes rendered exactly once** — `class={x}` / `` class={`bg-${x}`} `` rendered once in both modes (was duplicated `class="" class="bg-red"` when a static attr preceded the dynamic one); dynamic attrs skipped in the static loop via `dynAttrTargets`.
- [ ] **Every TS operation works in .vsk** — interfaces, type aliases, casts (`as` chains), assertions (`!`, `satisfies`), generics, union/intersection/mapped/conditional types, utility types, keyof typeof, template literal types, enums, optional chaining, destructuring, statement-mode casts — all tested (25 ts-support tests). **Known tokenizer limits (same as TSX, JSX-before-generic ambiguity):** angle-bracket assertions `<number>expr` and generic arrows `<T,>` fail to parse.
- [x] **`tsc` typechecks .vsk files** — via `vskToTsx` transform + generated `.d.ts` (`generateVskDts`); `vesk typecheck` CLI command (in-memory `ts.LanguageServiceHost` — no tsx on disk, like `vue-tsc`/Volar). CLI command added to `packages/cli/src/index.ts` (`vesk typecheck [--no-strict]`, exit 1 on errors); whole test-app typechecks clean. Fixed `vskToTsx` track-decl rewrite emitting `const let` (declarator start missed the `const` keyword) + doubled `;;` terminators; extended typecheck `AMBIENT` with the auto-importable runtime surface (`useFetch`, router hooks, `Link`/`NavLink`/`Outlet`, `Form`/`Field`/validators, SEO schemas, action helpers, `redirect`/`notFound`/`NotFoundError`).
- [x] `vskToTsx` — statement mode header transform (`component → function` + `()` synthesis), track decl rewrite (`&[a, b]` → typed aliases), style blocks stripped, `client` keyword stripped.
- [x] `generateVskDts` — typed/untyped props aliases (`AppProps = any`), collision inlining, destructured params from annotations, imports/type decls preserved. 22 tests.
- [ ] `propsType` on ComponentIR — wire through + tests.
- [x] TS support test suite — `ts-support.test.ts` (25 tests: parse/SSR/client/imports/casts/types in both modes).

### Tree-shaken client runtime (0.1.5)
- [x] **Tree-shaken runtime bundle** — `buildTreeShakenRuntime(runtimeDir, usedNames)` (`packages/adapter/src/client-bundle.ts`): temp entry `export { … } from './index-client.js'`, esbuild IIFE (`globalName: __veskRuntime`, treeShaking, minify, es2022), then `const { … } = __veskRuntime;` + explicit `export { … };`. Replaces regex file concatenation (fixed identifier-collision source). Falls back to legacy `buildRuntimeCode` on missing names/esbuild error.
- [x] **ESM explicit-export bug (critical)** — top-level `const` bindings are NOT module exports in Chrome/Node; the IIFE alone yielded 0 exports in the browser. Fixed by appending the explicit `export { … };` line. Verified via Chrome 149 puppeteer probe: 110/110 names resolve.
- [x] `runtimeExportNames(runtimeDir)` — parses `export { … } from` lines of `dist/index-client.js` (112 names); dev server uses the full set (one runtime serves all pages, 59606B), production uses per-app used names.
- [x] `matchRoute` + `ensureChunk` exported from `@vesk/runtime/src/router` + `index-client`; legacy concat strips `export { … } from '…'` lines.
- [x] **Production sizes** — minimal app `static/client.js` = 37596B (under 38KB; tree-shake drops reconcile/form/resource/image modules), 14-page feature-heavy test-app = 48168B (code-split page chunks keep pages small).
- [x] **Tree-shake test suite** — `packages/adapter/src/tree-shake.test.ts` (17 asserts: IIFE, explicit exports, unused modules dropped, ESM importability, full-set exports, legacy fallback).
- [x] Version 0.1.5 (cli/runtime/compiler/adapter) + tarballs refreshed in `test-app/tarballs/`; clean reinstall verified. `npm run dev` chain works.

### Session status
- Compiler test files run individually via `npx tsx packages/compiler/src/<file>.test.ts` (rebuild first: `npx tsx packages/cli/src/build-packages.ts`).
- 18 compiler test files: all passing individually. Compiler 739, runtime 257, hydration 121. Server codegen: 99 passed. Client codegen: 160 passed. Integration: 111 passed. ts-support: 25 passed. vsk-imports: 15 passed. vsk-tsx: 24 passed. track-codegen: 8 passed. typecheck: 6 passed. Hydration suite (`node hydration-test.mjs`): 121 passed. Crawl (`node crawl.mjs`): 18 routes passed.
- Active work: hydrate-mode region claiming is complete and green. Remaining from the `__place`/`__cl` dedup fixes: version bump (0.1.12/0.1.9/0.1.10/0.1.9) + tarball rotation + commit/push still pending.
- Hard rule (AGENTS.md): **never use regex in the compiler/codegen** — all source manipulation through tokenizer/AST parser. Replace remaining regexes in `packages/compiler/src` (e.g. `vsk-tsx.ts` TRACK_RE/header transforms) with AST-based equivalents.
- Hard rule (AGENTS.md): **every job completes with tests**, including the production-hydration path via `hydration-test.mjs` (`node hydration-test.mjs`). Rigorous use of the features/fixes made.
- Hard rule (AGENTS.md): **statement mode is first-class** — every body-level feature/fix and every test suite exercising component bodies must cover both expression and statement mode.

---

## Before Phase 6 — remaining gaps

Phase 6 is docs + examples; the items below should be closed first (blockers / in-progress milestones).

### Blockers (bugs)
- [x] **Async page 500** — fixed. Root cause was cross-request SSR data via `globalThis.__vsk_ssr_data`; replaced with per-request `AsyncLocalStorage` store (`ssr-store.ts` + runtime `SsrDataSink`, no globalThis). `/async` returns 200 with data that persists through hydration (prod + dev).
- [x] **Hydrate-mode loop claiming** — fixed. Region render fns claim SSR content during body execution and place it in place via `__place`; markers 0, zero JS errors on `/statements` and all routes (121 hydration tests green). See "Loops + switch on client" section.

### In-progress milestone: tsc-in-.vsk
- [x] `tsc` typechecks `.vsk` via `vskToTsx` + `generateVskDts`; `vesk typecheck` CLI command.
- [ ] `propsType` on ComponentIR — wire through + tests (already wired in `ir.ts`/`ir-generator.ts`/`vsk-tsx.ts`; remaining: dedicated `propsType` tests).
- [ ] Angle-bracket assertions `<T>expr` + generic arrows `<T,>` (JSX/tokenizer ambiguity, likely needs doc'd limitation + `vskToTsx`-side handling).

### Phase 5 open items
- [ ] `vesk init` creates `src/global.css` (Tailwind entrypoint)
- [ ] `packages/adapters/vite` — vite-plugin-vesk
- [ ] Write `/docu/cli/commands.md`

### Phase 4 open items (optional before Phase 6)
- [x] npm packaging (`@vesk/compiler`, `@vesk/runtime`)
- [ ] Suspense / async resources (compiler-level `SuspenseBlock` IR node)
- [ ] Transitions / animations
- [x] Form actions (progressive enhancement)
- [ ] Headless component primitives (Show/For/Switch/Match)

---

## haul

> Native Go engine + CLI replacement. See `/docs/haul.md` for full proposal.

### Phase 0 — esbuild/sharp → optionalDeps + fallback
- [ ] Make `esbuild` and `sharp` optionalDependencies in root `package.json`
- [ ] Wire esbuild-wasm fallback path with friendly warning when native binary unavailable
- [ ] Verify `npm install` never hard-fails on unsupported CPU (SIGILL devices)

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
