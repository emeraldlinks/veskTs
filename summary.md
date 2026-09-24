# Vesk — handoff (Sep 24 2026, markerless-hydration session — commit to continue from a PC)

> Last commit on `main`: `d985571` (Sep 22 23:43 Z, feat(css+imports)…).
> Everything below this line is UNCOMMITTED working-tree work, packaged in the
> accompanying commit `…` (see `git log -1`). Dev server on this box: `:3000`
> serving the freshly-built CI tarballs.

## Overall objective

Land the **markerless hydration architecture** (`hydration-prop.md` →
`docs/hydration-markerless.md`, Phase 2 design done, Phase 3 implementation
mostly done) all the way to a green `tests/hydration-test.mjs` **467/467**, with
zero runtime/decodeTrace regressions, then clean up probes + doc-write.

Phase tracker is `TODO.md` (P3.1–P3.8 done, incl. skipK threading, region
first-claim budgets, cross-boundary `injectSkipK` value-thread, tier-2 keyed
identity via `claimByKey`/`reconcileHydrated`, zero-marker SSR invariant).

## What's WORKING (this uncommitted work, verified)

- **`tests/hydration-test.mjs` = 464/467** (was 461 before this session). The two
  fixes below made `/empty` (set of 3) and `/blocknav` (TEST 20, 411/423) green.
- **Fix A — region fence anchoring via the right walker.** `client-codegen.ts`
  `emitHydrateFenceAnchoring` now anchors `insertBeforeNextClaim(...)` using
  `${ctx.walker}` (the claimed-container subWalker when a region body sits inside
  a claimed node) instead of hardcoded `__hydrate`. Root-level regions keep
  `ctx.walker === '__hydrate'` → emission unchanged. The bug: a region inside a
  claimed parent anchored its `try`/`if` fences to the *root* walker, so content
  was caught in the scopeToRegion of the wrong boundary.
- **Fix B — containerless keyed top-level maps lost their static residue.**
  `client-codegen.ts` `emitMap` hydKeyed branch now threads `skipK`:
  `reconcileHydrated(..., ${parent}, ${skipK});`. `packages/runtime/src/reconcile.ts`
  `reconcileHydrated` gained `skipK = 0`; calls `scopeToRegion` only when
  `parent && parent.nodeType === 1 && layout.root !== parent` (containerless
  keyed regions claim from the live walker cursor + skipK); passes
  `skipK: i === 0 ? skipK : 0` — residue only on the FIRST `claimByKey`.
  `ClaimByKeyOptions.skipK` already existed (structural `claimByKey` →
  `advancePastSkippable(this.idx + k)`); marker-mode `claimByKey` ignores `skipK`
  (safe), marker engine has no `scopeToRegion` (safe).
- **Test counts:** runtime `hydrate.test.ts` **98/98** (+1 containerless-keyed
  regression). Compiler `client-codegen.test.ts` **319/319** (+2: subWalker fence
  anchoring; skipK threading regex). `npm run typecheck` clean. (Unit suites are
  run against `dist/` — rebuild first: runtime `npx tsc -p
  packages/runtime/tsconfig.build.json`, compiler `npx tsx
  packages/cli/src/build-packages.ts`.)
- **SSR of `/` is clean** (Count: 10 ×1, Insufficient ×1, Boom ×1) — the
  duplication below is purely a post-hydration defect.
- **`.vsk` zero-marker invariant** (from earlier phase): markerless SSR carries
  zero `vsk` substrings / `<!--` comments / `data-*` attrs; user attrs survive.

## What's NOT working

1. **Test-22 remaining 3 assertions (the only suite failures):**
   - `/map SSR keys 10/20/30 each present exactly once (got 0,0,0)`
   - `Add keeps SSR keys on adopted chips (10,20,30)`
   - `Reverse keeps adopted nodes (data-vsk-key survives reorder)`
   These assert the OLD `data-vsk-key` marker contract. Under rug/markerless
   max the keys are compile-time-only (never on the DOM), so the assertions are
   stale. **Decision pending**: update the three to the markerless positional/
   `data-vsk-claimed` contract (recommended), or relax the `server-jsgen.ts:274`
   `data-vsk-key` markerless gate.
2. **NEW — home page `/` duplicates the `Appxx` try/catch subtree after client
   hydration** (NOT covered by the suite; found post-refresh). One `<p class="error">`
   inside the card between `<!--try-->…<!--try-end-->` (fresh, unclaimed) plus a
   **stray second one appended as the card's LAST child, AFTER `try-end`** (fresh,
   unclaimed). `claimed:false` on both → the SSR original was claimed then removed
   by `__cleanup`, and TWO fresh renders produced TWO error `<p>`s; one landed
   before `try-end`, the other after it. Crash-free (0 pageerrors); pure DOM
   duplication. Not covered by any passing test today.

## ACTIVELY WORKING ON — Appxx duplication (root cause evidence so far)

Chunk: `/_vesk/static/page-index.js` (NOT `page-home.js` — that 404s).
`__hydrators["Throw"]` (line ~223 area) THROWS *before* any claim, so the try
branch claims nothing; the Appxx hydrator (~554-632) then claims `p(Count)` and
the error `p` positionally from the card subWalker, and a sync
`effect(() => { destroy; __cleanup(tryStart, tryEnd); try{…Throw…}catch{create
fresh p.error; insertBefore try-end} })` re-runs the region on first flush.

TRACE: `__cleanup` removes the originally-claimed SSR error `<p>`; catch re-adds
a fresh one before `try-end`. That still predicts ONE error `<p>` — the second
(after `try-end`, last card child) is unexplained. Suspects (second `p.error`):
- `insertBeforeNextClaim` (structural walker `hydrate.ts:1241`) appending the
  fence END marker at the wrong slot when exhausted, so `__place` branch-3
  (`start.parentNode === null` → `$root.appendChild`) fires with `$root` = card.
- Or region re-render caching an anchor to a comment that `__cleanup` moved.

KEY QUESTION before coding: is this a **new regression** from Fix A/Fix B (the
fence anchor now resolves to the CARD subWalker, so both fences + `__place` +
`__cleanup` all operate inside the card — consistent with what we see) or
**pre-existing** (Throw's pre-claim throw already made the region effect create
two renders)? Neither fix touches Appxx's own emission (its hydrator param is
already literally named `__hydrate`), and the card is claimed+`subWalker`ed, so
Fix A/B *should* be inert here — but the refresh also changed the tarball build,
so it may be new vs. the old served bundle. **Decisive check: revert to the old
tarball build (`0.2.33-ci…`) is impractical; instead wrap `globalThis.__place` /
`insertBeforeNextClaim` in `page.evaluateOnNewDocument` and log fence node
parents + ancestry at insert time to see the stray's origin.**

## Next step (upon resuming)

1. Trace the stray: monkey-patch `__place`, `__cleanup`, and
   `StructuralWalker.prototype.insertBeforeNextClaim` via `evaluateOnNewDocument`
   (they're assigned/invoked after client.js defines them — use a setter trap on
   `globalThis.__place`; walkers are page-local so log via patch earlier or reason
   from the `__place start.parentNode===null` branch). Determine which insert
   puts a `p.error` AFTER `try-end`.
2. Fix at the correct layer (likely `__place`/fence-anchor accounting OR the
   region effect's first-run cleanup ordering in Appxx). Verify with
   `node /root/vesk/dupfind.mjs` → exactly one `Insufficient` `<p>`, one
   `Count: 10`, zero strays after hydration; SSR stays clean.
3. Only if the duplication turns out to be a Fix A/B regression: reassess the
   fence-anchoring choice.
4. Run `tests/hydration-test.mjs` → 467/467 after also resolving the 3 Test-22
   assertions (recommended: rewrite to markerless positional contract).
5. Cleanup + docs: delete probe scripts (`probe-*.mts/.mjs`, `homecheck.mjs`,
   `homechunk.mjs`, `domexplore.mjs`, `dupfind.mjs`, `recon-test.mjs`),
   remove `[hyd-dbg]` instrumentation if any re-added, update `TODO.md` +
   `docs/hydration-markerless.md`, mark phase statuses.

## Repo / env facts (this box = codespace, not the termux device)

- Remote: `origin` → `github.com/emeraldlinks/veskTs`, branch `main`.
- Dev server `:3000` is UP (HTTP 200) serving test-app pinned to fresh
  `0.2.35-ci.1790229817019` tarballs; vesk-doc re-pinned to
  `0.2.35-ci.1790190050890` (old `0.2.33-ci…` tarball set deleted → new set
  staged in git; test-app tarballs are gitignored). Refresh tool:
  `node scripts/refresh-testapp-deps.mjs <app>` (log: `/tmp/opencode/refresh3.log`).
- Chromium: `/data/data/com.termux/files/usr/bin/chromium-browser` +
  `--no-sandbox --disable-dev-shm-usage`. Suite runner:
  `cd /root/vesk && node tests/hydration-test.mjs`.
- Tooling quirks: source test files import `dist/` via exports map — rebuild
  dist before running unit suites (see commands above). Backgrounded
  `setsid … & disown` blocks the shell tool until its timeout but the job
  SURVIVES — launch, then verify with a separate short command. ad-hoc scripts
  needing `puppeteer-core` must live inside `/root/vesk` (module resolution).
- Suite result file (last full run): `/tmp/opencode/hyd-final.txt`
  (464 passed / 3 failed / 467 total; failures are lines 458/467/473).

## Relevant files

- `packages/compiler/src/client-codegen.ts` — `emitHydrateFenceAnchoring`
  (`${ctx.walker}`), `emitMap` hydKeyed reconcile `…, ${parent}, ${skipK});`.
- `packages/runtime/src/reconcile.ts` — `reconcileHydrated` (`skipK = 0`, scope
  only when `layout.root !== parent`, skipK on first `claimByKey`).
- `packages/runtime/src/hydrate.ts` — `StructuralWalker` :1008, `claimAt` :1049,
  `claimByKey` :1200-1231 (`options.skipK` → `advancePastSkippable`), 
  `insertBeforeNextClaim` :987 (walkers) / :1241, `scopeToRegion` :1186,
  `captureSsrElementChildren` :266, `__cleanup` :1053 / `__place` :1013.
- `packages/compiler/src/server-jsgen.ts:274` — `data-vsk-key` markerless gate
  (Test-22 contract site).
- `packages/compiler/src/client-codegen.test.ts` (+2) / `packages/runtime/src/hydrate.test.ts` (+1) — new regression tests.
- `tests/hydration-test.mjs` — `/empty`:241, TEST 20 blocknav ~1497-1530, TEST 22
  ~1692-1835 (`data-vsk-key` lines 458/467/473), TEST 1 home.
- `/tmp/opencode/page-index.js` — fetched home chunk (Appxx hydrator ~554-632).
- `test-app/app/page.vsk` — home page with `Appx`/`Appxx`/`Throw` (the duplication fixture).
- `docs/hydration-markerless.md` (design contract), `hydration-prop.md` (task).
- Local probes (throwaway): `probe-*.mts/.mjs`, `homecheck.mjs`, `homechunk.mjs`,
  `domexplore.mjs`, `dupfind.mjs` (the dup finder used this session).

## Commands

```bash
npx tsx packages/cli/src/build-packages.ts          # rebuild compiler dist (required after src edits)
npx tsc -p packages/runtime/tsconfig.build.json     # rebuild runtime dist
npx tsx packages/runtime/src/hydrate.test.ts        # runtime suite 98/98
npx tsx packages/compiler/src/client-codegen.test.ts# compiler suite 319/319
node tests/hydration-test.mjs                      # E2E hydration (needs :3000 + chromium) 467 total
node scripts/refresh-testapp-deps.mjs <app>         # re-pin app deps to fresh CI tarballs
npm run typecheck                                   # tsc --noEmit
```