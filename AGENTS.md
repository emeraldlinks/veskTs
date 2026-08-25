# AGENTS.md — Vesk compiler conventions

> Instructions for AI agents working in this repo. Read at session start.

## Hard rules

- **NEVER use regex in the compiler or codegen.** All source-text manipulation and
  syntax analysis must go through the tokenizer/AST parser (`acorn` + `acorn-ts-plugin`
  + `vesk-plugin.ts`). If a regex exists in `packages/compiler/src`, replace it with an
  AST-based equivalent. (The only exception: compile-time-inert tooling like error
  message matching in tests.)
- **haul is parked.** The native Go engine was unplugged from the framework; its
  source lives on the `haul-parked` branch. Do not reference, build, or ship it from
  main. If a change would require reviving it (e.g. touching `VESK_SIDECAR`), stop and
  reconsider — the pure-TS pipeline plus esbuild-wasm fallback covers all platforms.
- **All public framework types live in `@vesk/types`.** Add new shared types to
  `packages/types/src/index.ts`; `@vesk/compiler/src/types` and `@vesk/adapter/src/types`
  re-export them for compatibility. Never redeclare a shape locally.
- Every source edit under `packages/compiler/src` must be followed by
  `npx tsx packages/cli/src/build-packages.ts` — tests and probes resolve the
  package's `dist/` via the exports map.
- Run compiler tests individually: `npx tsx packages/compiler/src/<file>.test.ts`.
- `scripts/test.js` builds then runs the full suite. Do not run it while iterating.
- Follow the existing style: statement-mode component bodies keep user code raw,
  transformations happen on the IR with AST visitors.
- **Statement mode is first-class and must be covered at all times.** Component
  bodies support expression mode (`return <jsx>`) and statement mode (bare JSX,
  `if`/`for`/`while`/`switch`/`try`, guard-clause early returns). Every feature
  or fix touching component bodies — and every test suite exercising them —
  must work in **both** modes, never expression mode alone. Adding tests for a
  body-level feature in expression mode without a statement-mode counterpart is
  incomplete.
- TrackDecl syntax is `const &[count] = track(0)` / `const &[count, rawCell] = track(0)`.
- Islands (`client` / `#client` keyword) render on both server and client;
  `{#client}` blocks are SSR-stripped but kept in the client bundle; `{#server}`
  is the inverse.
- `effect()` and friends (`derived`, `untrack`, `peek`, `tick`, `flushSync`,
  `on_destroy`, `createContext`) are auto-imported from `@vesk/runtime` when used
  inside components. `batch` does NOT exist in the runtime — never import it.
- Event handler attributes (`on*`) are excluded from SSR HTML entirely.
- **Every job must be completed with tests.** Never call a feature/fix done without
  adding tests that rigorously exercise it — including the production-hydration
  path via `hydration-test.mjs` (run: `node hydration-test.mjs`). Unit tests alone
  are not sufficient for reactivity/hydration work.
- `.vsk` is a superset of TypeScript: every TS construct must parse, survive
  codegen, and pass through `vskToTsx` for `tsc`.

## Commands

```bash
npx tsx packages/cli/src/build-packages.ts   # rebuild packages after compiler edits (required)
npx tsx packages/compiler/src/<file>.test.ts # run one compiler test file
npm run typecheck                            # tsc --noEmit for types + compiler + runtime + adapter
node scripts/test.js                         # full suite: builds all packages first — not for iteration
npm test                                     # unit suite + dev E2E (tests/dev-test.mjs)
node hydration-test.mjs                      # production hydration path; needs test-app dev server
                                             # on :3000 and CHROMIUM_PATH env (defaults to a Termux path;
                                             # set to your chrome/chromium binary)
```

## Layout

- Monorepo workspaces under `packages/`: types, adapter, cli, compiler,
  create-vesk, plugin-tailwind, prettier-plugin, runtime, lsp.
- Nested AGENTS.md files add module rules: `scripts/AGENTS.md` (ports, release
  order, sentinel formats) and `packages/runtime/AGENTS.md` (barrel split,
  no-batch rule). They extend this file — read both when touching those areas.
- `hydration-test.mjs`, `production-hydration-test.mjs` etc. at repo root are
  puppeteer-core probes against a running server; `joe/test/` holds the Joe app's
  hydration/event/HMR tests.
- TODO.md is the living task tracker — read at session start, update after work.

## Current focus (see TODO.md)

Full TypeScript support in `.vsk` (tsc-in-.vsk), `generateVskDts` correctness,
`vesk typecheck`, hydrate-mode loop claiming, async page 500.
