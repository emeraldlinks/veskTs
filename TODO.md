# Vesk — TODO

> Living task tracker. Read at start of every session. Update after every unit of work.

**Current phase:** 1 (parser: expression mode) — IN PROGRESS. Phase 1a (parser) complete. Phase 1b (codegen) pending.

---

## Phase 0 — Project Scaffolding ✅

### Step 0.1 — Fork Source ✅
- [x] Clone Ripple repo to `/home/joe/vesk/ripple-fork-source/`
- [x] Checkout `ripple@0.3.13` tag (commit `cdc71485`)
- [x] Verify commit is immediately preceding `228f1bb3`
- [x] Confirm MIT license at this commit
- [x] Record findings in `/docs/decisions/000-fork-source.md`

### Step 0.2 — Deep Codebase Analysis ✅
- [x] `/docs/analysis/parser.md` — parser architecture, Acorn + plugins, what's reusable
- [x] `/docs/analysis/reactivity-runtime.md` — track(), &[], dependency tracking, scheduling
- [x] `/docs/analysis/compiler-pipeline.md` — parse → analyze → transform, no IR
- [x] `/docs/analysis/reusable-vs-discard.md` — explicit keep/discard/defer list

### Step 0.3 — Scaffolding ✅
- [x] Repo structure: `packages/compiler`, `packages/runtime`, `packages/cli`, `examples/`
- [x] Base TS/JSX parser dependency wired (acorn + @sveltejs/acorn-typescript)
- [x] Parser proof-of-concept passes 8/8 tests (plain TSX parsing)
- [x] IR format decided and recorded in `/docs/decisions/001-ir-format.md`

### Step 0.4 — Persistent TODO ✅
- [x] This `/TODO.md` file created

---

## Phase 1 — Parser: Expression Mode Only

### Step 1a — Parser Plugin ✅
- [x] `vesk-plugin.js` — Acorn plugin with component, &[], unreserved checks
- [x] `component` keyword parsing (top-level declarations)
- [x] Expression-mode component bodies (`return (<jsx>)`)
- [x] `let &[name] = track(...)` parsing and binding resolution
- [x] `.vsk` file extension support (convention, no parser logic needed)
- [x] Guard-clause early returns (`if (x) return <Y />` before main tree)
- [x] Hard error: `component` cannot be used as regular identifier
- [x] Parse example §2.4 into AST correctly
- [x] 47/47 parser tests passing (node --experimental-vm-modules)
- [x] Phase 0 regression: all 8 base tests still passing

### Known Limitations (Phase 1a)
- Generic type params (`component List<T>(...)`) are ambiguous with JSX — use inline type annotations instead
- `async component` not supported yet (Phase 7)
- `client component` not supported yet (Phase 7)
- `export component` not supported yet

### Step 1b — Docs ✅
- [x] Write `/docu/language/component.md` (partial — expression mode only)
- [x] Write `/docu/language/expression-mode.md`

### Step 1c — Remaining (deferred to Phase 2)
- [ ] IR generation for expression-mode components
- [ ] Server codegen: IR → HTML string

---

## Phase 2 — Server Codegen for Expression Mode

- [ ] IR generation for expression-mode components
- [ ] Server codegen: IR → HTML string
- [ ] Standard Node server target (§3.6)
- [ ] Prove: `.vsk` file in expression mode produces correct server-rendered HTML
- [ ] Write `/docu/compiler/pipeline-overview.md` (partial)
- [ ] Write `/docu/runtime/deployment-targets.md` (partial)

---

## Phase 3 — Client Codegen + Reactivity, Expression Mode

- [ ] `track()` runtime implementation (§4.1)
- [ ] Client codegen: creates real DOM, wires reactive bindings
- [ ] `.map()` keyed reconciliation (opaque dynamic region path)
- [ ] Write `/docu/language/reactivity.md`

---

## Phase 4 — Statement Mode Parsing

- [ ] Bare JSX-as-statement parsing (the hardest parser problem)
- [ ] Real `if` inside JSX children
- [ ] Real `for` inside JSX children (with `key` expression)
- [ ] Hard error enforcement: no bare statements inside `return <jsx>` tree
- [ ] Parse example §2.3 into AST correctly
- [ ] Write `/docu/language/statement-mode.md`

---

## Phase 5 — Future A Static Codegen

- [ ] IR: conditional regions (both branches known)
- [ ] IR: list regions (element template + key expression)
- [ ] Codegen: direct DOM patch instructions (no diffing)
- [ ] Benchmarks: statement-mode for vs expression-mode .map()
- [ ] Write `/docu/compiler/static-codegen.md`

---

## Phase 6 — Hydration

- [ ] Server HTML + metadata for client hydration
- [ ] Client hydration path (walk existing DOM, attach bindings)
- [ ] Decide and document track()-on-hydration question (serialize-and-adopt default)
- [ ] Write `/docu/runtime/hydration.md`

---

## Phase 7 — `client` Boundary, Async Components

- [ ] `client` modifier parsing
- [ ] Reachability analysis from `client`-marked components
- [ ] Two codegen paths: server-only vs client
- [ ] `async` modifier parsing + hard-error enforcement
- [ ] Four async×client combinations (§2.9 table)
- [ ] `async client` mount-time-fetch path
- [ ] Write `/docu/language/client-boundary.md`
- [ ] Update `/docu/language/component.md` with async modifier
- [ ] Write `/docu/compiler/client-reachability.md`

---

## Phase 8 — `defer` / Streaming

- [ ] `defer { ... }` block parsing
- [ ] Streaming codegen: placeholder + async task + inline swap script
- [ ] Test with slow await in defer block
- [ ] Write `/docu/language/defer.md`

---

## Phase 9 — Styles

- [ ] `<style>` block parsing
- [ ] Component-level scoping (hash + scope class)
- [ ] Write `/docu/language/styles.md`

---

## Phase 10 — CLI + Dev Server

- [ ] `vesk dev` — dev server with fast rebuilds
- [ ] `vesk build` — production build
- [ ] Target standard Node server environment
- [ ] `packages/adapters/vite` — vite-plugin-vesk (after native CLI works)
- [ ] Write `/docu/cli/commands.md`
- [ ] Write `/docu/cli/vite-adapter.md`

---

## Phase 11 — Docs + Examples

- [ ] Worked examples for every grammar construct in §2
- [ ] Performance tradeoff doc (statement vs expression mode)
- [ ] `/docu/language/not-in-the-grammar.md`
- [ ] `/docu/README.md` — entry point, table of contents
- [ ] Final consistency pass across all `/docu/` files

---

## Blocked — Needs User Input

*None currently.*
