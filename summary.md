# Vesk — Session Summary (2026-09-09)

## Goal
Make SSR page responses <100ms in dev and prod regardless of page size (user directive),
then diagnose/fix `#routing` (hash-mode) Link + NavLink.

## What was FIXED

### 1. Lazy barrel loading in SSR module loader — DONE, big win
- **File:** `packages/compiler/src/module-imports.ts`
- **Problem:** vesk's `loadSsrModule`/`evaluateModuleFile` eagerly evaluated the full
  transitive closure of re-export barrels. `import { Menu, X } from 'lucide-vesk'`
  loaded/compiled all 4,782 lucide icons (~66s cold module load on this box).
- **Fix (implemented + rebuilt):** in `loadSsrModule`, parse source once
  (`readSsrSource`); if `isPureReexportBarrel(body)` build a lazy spec
  (`buildBarrelSpec`) and return `createLazyBarrelExports(...)` — a Proxy with
  `get`/`has`/`ownKeys`/`getOwnPropertyDescriptor` traps that resolve a named export
  only when requested. `export *` re-exported lazily, `export * as ns` returns the
  submodule's exports object, `export *` never re-exports default. Barrels cache with
  empty deps (no 4,782-file stat walk). Per-statement esrap `print()` replaced with
  direct `Literal.value` read (`quotedSourceValue`, fallback `printNode` +
  `stripOuterQuotes`).
- **Measured (tsx on this box):** cold `applyLocalModuleImports` 1705.6ms; warm
  recompile **27.5ms**; steady request **~23-30ms**; vesk-doc end-to-end real SSR
  function module load **66s → 4.1s**, `handle()` #1 115ms, #2 29ms.
- Verified: `import { Menu, X, Boxes, Cpu }` all resolve; unrequested names undefined;
  `'Menu' in scope` true; `Object.keys(scope)` = exactly the requested names.

### 2. Parser regression: bare `<>` fragment after a semicolon-less statement — DONE
- **File:** `packages/compiler/src/vesk-plugin.ts`
- **Problem:** `const &[open] = track(false)\n  <>\n...` failed to parse
  (`Unexpected token`). Also any semicolon-less declarator + bare fragment
  (`const x = 1` then `<>`), and a void call + fragment. After `;`-terminated,
  after `return`, or as first statement the fragment parsed — inconsistency.
- **Root cause:** acorn tokenizes `<`/`>` via `readToken_lt_gt`
  (getTokenFromCode case 60/62), bypassing the plugin's `readToken`. Statement-mode
  forcing happened only when `exprAllowed` was true (first statement, after `;`,
  after `return`) or for `<div`/`</` (the plugin's `readToken` gate excludes `>`).
  After a semicolon-less declaration `exprAllowed` is false → `<>` became a
  relational pair → parse error.
- **Fix:** in `readToken`, `fragmentStart = !inType && next === 62 && startsNewStatement`
  (newline before `<`), then `forceJsx()`. No expression can end in `<>`, so a line
  break alone disambiguates. Hoisted `prev`/`canEndExpr` to avoid duplicate consts.
- **Verified:** 10-case matrix passes including full `DocsHeader.vsk`; added 3
  regression tests to `packages/compiler/src/parser.test.ts` (track→fragment,
  plain const→fragment, expression stmt→fragment) — **98 passed, 0 failed**.
  Also reran `expression-mode` (16✓), `render-plugins` (16✓), `vsk-codegen` (15✓),
  `ir-generator` (9✓), `server-codegen` (145✓), `cli` (14✓).

### IMPORTANT gotcha discovered (not yet fixed)
- **`packages/cli/dist/cli.js` is a BUNDLED snapshot** (built by `packages/cli/build.ts`,
  NOT `build-packages.ts`). It embeds its own compiler+adapter. After changing compiler
  src, `npx tsx packages/cli/src/build-packages.ts` is NOT enough for the CLI/dev
  server — the CLI bundle must be rebuilt with `cd packages/cli && npx tsx build.ts`.
  I ran this at the very end; **verify it completed and that vesk-doc build/serve now
  pass** (see "Where left off").
  - The user's `vesk-doc` uses **tarballs** (`node_modules/.bin/vesk` → tarball cli.js);
    monorepo cli dist was byte-identical to the old tarball. Fresh bundle needed for
    either path.

## Measured SSR performance (already-good parts)
- Steady-state dev-server requests on a fresh boot: **~10-52ms** (measured on :4040/:4050).
- First request on a fresh dev server was fast because the dev server's `doBuild`
  (adapter build/compile + prerender) imports the SSR function at startup.
- **Remaining >100ms case = COLD module load at boot:** ~4s (lucide lazy barrel
  parse ~466ms + first-use icon closures ~1.3s + docs.ts eval ~1.2s + codegen).
  Options not yet pursued: persistent on-disk compiled-module cache keyed by content
  hash (skip parse at cold boot), tokenizer-only barrel scan.

## Where left off (next steps on PC)
1. **Confirm the CLI bundle rebuild worked:** vesk-doc build was FAILING with the old
   bundled parser (`Unexpected token` in `DocsHeader.vsk` at the `<>`); my `parse()`
   probe passes, confirming the parser fix is good but the bundle was stale. After
   `npx tsx packages/cli/build.ts`, re-run:
   `cd /root/vesk/vesk-doc && rm -rf .vesk && node /root/vesk/packages/cli/dist/cli.js build`
   → expect "vesk build: done" with no errors.
   Then boot a detached dev server and curl cold/warm:
   `setsid nohup node /root/vesk/packages/cli/dist/cli.js dev --port 4060 > /tmp/opencode/vesk-4060.log 2>&1 < /dev/null &`
2. **Add lazy-barrel tests** to `packages/compiler/src/module-imports.test.ts`
   (fixture-based; run `npx tsx packages/compiler/src/module-imports.test.ts`): aliased/
   direct/star/namespace re-exports, minimal submodule eval (side-effect counters),
   mtime invalidation (submodule vs barrel), warm re-load ~0ms.
3. If cold start must be <100ms, implement persistent compiled-module cache (content-
   hash keyed; skip parse at boot) or tokenizer barrel scan; re-measure.
4. Then **`#routing` hash-mode Link/NavLink fix** — the pending user task:
   - `packages/runtime/src/router.ts` :1109 hash handling, :1211 scheme checks
   - `packages/runtime/src/router-components.ts`
   - deliver with `router.test.ts` tests + hydration checks.
5. Full verification when done: `cd /root/vesk && npx tsx packages/cli/src/build-packages.ts`
   then unit tests + `node tests/hydration-test.mjs` (needs test-app dev server on :3000
   + CHROMIUM_PATH) + `npm run typecheck`.
6. Cleanup leftover probe scripts: `probe-*.mjs` in repo root (untracked), and note
   `/tmp/opencode/vesk-plugin.bak.ts` is the pre-fragment-fix plugin backup.

## Environment notes / gotchas
- Slow filesystem; stale/ghost servers on :3000/:3001 unreliable.
- Tool-timeout SIGTERMs kill background dev servers → use `setsid`+`disown` to detach.
- `pkill -f "cli.js dev"` matches its own invoking shell — kills it. Use `ss -ltnp` +
  exact PIDs instead.
- `packages/cli/dist/index.js` does NOT exist; the entry is `packages/cli/dist/cli.js`.
- Compiler `parser.ts`/`ir-generator.ts` import plugins via `@vesk/compiler/src/...`
  (exports map → `dist/`), so probes must run against REBUILT dist to reflect src edits.