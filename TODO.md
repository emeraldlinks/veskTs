# Vesk — TODO

> Living task tracker. Read at start of every session. Update after every unit of work.

**Current phase:** 4 (Framework features — context, error boundaries, suspense, routing)

**Total tests:** 386 passing (69 parser + 69 server + 104 client + 41 integration + 22 runtime + 14 CLI + 8 SSG + 14 compiler router + 11 runtime router + 17 E2E router demo + 17 fixtures)

**Note:** 90 tests added: 14 compiler router, 11 runtime router, 17 E2E router demo, plus routing fixture with 17 scans/matches/renders + 17 fixture files + 17 CLI output

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
- [ ] **Dev server / HMR** — `vesk dev` with file watching, hot reload
- [ ] **Production demo** — real `.vsk` app served with SSR + hydrate
- [ ] **npm packaging** — publish `@vesk/compiler` and `@vesk/runtime`
- [ ] **Suspense / async resources** — async data loading with fallback states
- [ ] **Transitions / animations** — built-in transition directives on element mount/unmount
- [ ] **Portals / Teleport** — render DOM nodes to a different parent
- [ ] **Form actions** — progressive enhancement form handling (like SvelteKit/Solid)
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

- [ ] `vesk dev` — dev server with HMR
- [ ] `vesk build` — production build
- [ ] `packages/adapters/vite` — vite-plugin-vesk
- [ ] Write `/docu/cli/commands.md`

---

## Phase 6 — Docs + Examples

- [ ] `/docu/language/component.md`
- [ ] `/docu/language/statement-mode.md`
- [ ] `/docu/language/expression-mode.md`
- [ ] `/docu/language/reactivity.md`
- [ ] `/docu/compiler/pipeline-overview.md`
- [ ] `/docu/runtime/hydration.md`
- [ ] Worked examples for every grammar construct
