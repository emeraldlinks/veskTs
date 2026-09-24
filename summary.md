# Vesk — handoff (Sep 24 2026, markerless-hydration session)

> Head of `main` carries the markerless hydration architecture
> (`docs/hydration-markerless.md`, Phase 2+3 done: skipK threading, region
> first-claim budgets, cross-boundary `injectSkipK` value-thread, tier-2 keyed
> identity via `claimByKey`/`reconcileHydrated`, zero-marker SSR invariant).
> This session fixed the / duplication bug, threaded the region-budget offset
> through root-level fence anchoring, synced the adapter `placeFn`, and rewrote
> the stale Test-22 `data-vsk-key` assertions. **`tests/hydration-test.mjs` is
> green 466/466** and all unit suites + typecheck are clean.

## What was broken → what this session fixed

### Bug 1 — Appxx try/catch duplication on `/` (error `<p>` ×2)
`emitComponentCall` in `client-codegen.ts` zeroed the region `budget`
(`regionBudget = 0`) **before** the self-claiming child call. A throwing child
(`<Throws fail={true}/>`) consumed the `takeSkipK()` deposit but never claimed
an SSR slot, so the enclosing catch branch resumed its claim with skipK 0 and
adopted the WRONG sibling slot → the SSR `Count` + `Insufficient!` `<p>` nodes
were left unclaimed (orphaned) next to freshly-rendered duplicates.

**Fix:** the `= 0` budget reset moved to AFTER the child's `try { … } finally {
childFrame-- }` — spent only once the call actually returns (see
`client-codegen.ts` ~1023-1041).

### Bug 2 — root-level fences anchored at the raw cursor, not `idx + budget`
Root-level regions sit at SSR slot `idx + budget` because the static residue
(`h2`/`p`/`style` in the card) is never claimed. `insertBeforeCursor` anchored
fences at `els[this.idx]`, warping them around the residue so `__place`
relocated claimed content.

**Fix (compiler):** `emitHydrateFenceAnchoring(ctx, anchor, endAnchor,
rootLevel, offsetExpr?)` now emits `insertBeforeNextClaim(anchor, budget)`; all
6 root-level call sites (try/catch, opaque ×2, while, for, switch) pass
`budget || undefined`.
**Fix (runtime/`hydrate.ts`):** `insertBeforeNextClaim(node, offset?)` +
`insertBeforeCursor(node, offset?)` gain an optional offset that targets
`els[advancePastSkippable(this.idx + (offset||0))]` (MarkerWalker accepts and
ignores `_offset`). The marker/legacy path is unchanged (default 0).

### Adapter `placeFn` drift (caught during verification)
`packages/adapter/src/client-bundle.ts` re-injected its own `__place` skeleton
that was missing the "Client-surplus nodes … move them into the region"
loop the compiler's `__place` has (`client-codegen.ts:2177-2182`). The served
bundle used the adapter copy (defined last, so it won), silently dropping that
branch. **Synced** the adapter version word-for-word with the compiler's.

### Test-22 stale assertions (3 protocol regressions)
`tests/hydration-test.mjs` asserted the OLD `data-vsk-key` marker contract.
Under markerless, keys are compile-time-only and never land on the DOM — the
adoption stamp is `data-vsk-claimed`, which the suite already reads. Rewrote
22a (SSR chips carry unique *values*, no `data-vsk-key` on the wire), 22c Add
(chips adopted in place via `data-vsk-claimed`), 22c Reverse (3 claimed chips
survive the reorder; no `data-vsk-key` check). One redundant assert was
collapsed, hence 466 not 467.

## Verification (all green, this session)

- `tests/hydration-test.mjs` = **466 passed / 0 failed / 466 total** (needs the
  dev server on :3000 + `CHROMIUM_PATH` override; see Commands).
- `/` card DOM (post-hydration, direct browser probe): exactly one `Count: 10`,
  one `Error: Boom!`, one `Error: Insufficient! 10`, all 6 SSR slots claimed,
  fences anchored *after* the static residue —
  `[h2, p, style, {try} Boom {try-end}, Count p, {try} Insufficient {try-end}]`.
- Served `/_vesk/client.js` now carries the synced Client-surplus `__place`.
- Compiler `client-codegen.test.ts` = **321/321** (+2 this session).
- Runtime `hydrate.test.ts` = **100/100** (+2 this session).
- Adapter `tree-shake.test.ts` = **19/19**; adapter `code-split.test.ts` =
  **16/16** (needs `CHROMIUM_PATH`).
- `npm run typecheck` clean (types + compiler + runtime + adapter + plugin-pwa).

## New tests this session

- `packages/compiler/src/client-codegen.test.ts` (~2588+):
  - `[markerless hyd] throwing compiled child leaves the region budget intact
    for the catch` — the `= 0` reset sits AFTER `childFrame--`.
  - `[markerless hyd] root-level try/catch fences thread the region budget as
    the SSR-slot offset` — `insertBeforeNextClaim(` carries a `, $n` arg.
- `packages/runtime/src/hydrate.test.ts` (~638+):
  - `insertBeforeCursor with a budget offset anchors after the residue, not at
    the cursor`.
  - `insertBeforeNextClaim offset past a skippable lands after it (budget math
    matches claimAt)`.
- Pre-existing fence tests (hydrate.test.ts 833-848/1202-1252/1842-1843) keep
  the optional default offset=0 → untouched/valid.

## Repo / env facts (this box = codespace, not a termux device)

- Remote: `origin` → `github.com/emeraldlinks/veskTs`, branch `main`.
- Dev server :3000 UP serving test-app pinned to fresh
  `0.2.36-ci.1790239179959` tarballs (test-app tarball set regenerated by the
  refresh tool). Refresh tool: `node scripts/refresh-testapp-deps.mjs <app>`.
- Chromium: `/tmp/opencode/chrome-headless-shell-linux64/chrome-headless-shell`
  (chrome-for-testing **154.0.8037.57**, headless-shell). Suite runner:
  `node tests/hydration-test.mjs` with `CHROMIUM_PATH` exporting that path.
- Tooling quirks: source test files import `dist/` via the exports map — run
  `npx tsx packages/cli/src/build-packages.ts` after compiler/runtime src edits
  before unit suites. Backgrounded `setsid … & disown` blocks the shell tool
  until its timeout but the job SURVIVES — launch, then verify with a separate
  short command. Ad-hoc scripts needing `puppeteer-core` must live inside the
  repo root (module resolution).
- git status pending commit: Fix 1 + Fix 2 (compiler + runtime + tests), the
  adapter `placeFn` sync, the Test-22 rewrites, and test-app package pins.

## Relevant files

- `packages/compiler/src/client-codegen.ts` — Fix 1 (`emitComponentCall`
  ~1023-1041), Fix 2 (`emitHydrateFenceAnchoring` ~1089-1103 + 6 call sites at
  1170/1269/1357/1457/1528/1692 passing `budget || undefined`; `regionBudgetVar`/
  `markerlessSkipExpr` 1106-1150; `$root = __hydrate.root` ~2017).
- `packages/runtime/src/hydrate.ts` — interface `insertBeforeNextClaim(offset?)`
  ~99-107; MarkerWalker impl ~992 (ignores offset); StructuralWalker
  `insertBeforeCursor` ~1090 + `insertBeforeNextClaim` delegate ~1252-1253.
- `packages/adapter/src/client-bundle.ts` — `placeFn` ~1143 synced to the
  compiler `__place` (Client-surplus loop added).
- `tests/hydration-test.mjs` — Test-22 rewrites (22a ~1731, 22c ~1762/1782);
  TEST 22 block ~1688-1835; TEST 1 home.
- `packages/compiler/src/client-codegen.test.ts` / `packages/runtime/src/
  hydrate.test.ts` — new regression tests (see above).
- `test-app/app/page.vsk` — Appx/Appxx/Throws/Throw sources (74-75, 84-113)
  grounding the / duplication fixture.
- `docs/hydration-markerless.md` (design contract), `hydration-prop.md` (task),
  `TODO.md` (phase tracker — update after this work).
- Local probes (throwaway, being cleaned up): `dupfind.mjs`, `domexplore.mjs`,
  `hdump.mjs`, `traceplace.mjs`.

## Commands

```bash
npx tsx packages/cli/src/build-packages.ts          # rebuild packages dist (required after src edits)
npx tsx packages/compiler/src/client-codegen.test.ts# compiler suite 321/321
npx tsx packages/runtime/src/hydrate.test.ts        # runtime suite 100/100
CHROMIUM_PATH=/tmp/opencode/chrome-headless-shell-linux64/chrome-headless-shell \
  node tests/hydration-test.mjs                     # E2E hydration 466/466 (needs :3000)
node scripts/refresh-testapp-deps.mjs <app>         # re-pin app deps to fresh CI tarballs
npm run typecheck                                   # tsc --noEmit
```