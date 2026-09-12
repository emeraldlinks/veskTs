# Vesk — Session Summary & Handoff

> Handoff written 2026-09-12. Current HEAD: `90e959d nested layout`. This tree has been
> committed (~`packages/`, fixtures, Summary.md). Next session starts HERE and must run the
> commands in **Step 0** before debugging.

---

## 1. Where we are

The **docs hydration bug** (`http://localhost:4000/docs/:slug` body teleported to `#root` on
full reload) was root-caused and mostly fixed. **Fix A + Fix B shipped and verified live.**
One last-mile hydration defect remains (article-content claims still miss part of the page);
its precise mechanism is pinned down (see §3) but the final root cause is not yet closed.

The :4000 dev server is running on this machine with the **fixed** runtime baked in.
Server pid is whatever `ps aux | rg "cli.js dev"` says (started detached with
`setsid nohup node node_modules/@vesk/vesk-cli/dist/cli.js dev -p 4000 &` from `/root/vesk/vesk-doc`).
If it dies: **a packages/dist rebuild is NOT enough** — the dev server copies the runtime into
`vesk-doc/node_modules/@vesk/runtime` at boot and does not watch `packages/`. Restart it.

---

## 2. What's working (verified)

### Root cause of the original bug (CONFIRMED via MITM probe)
- SSR emitted every `Link`/`NavLink` anchor as a **raw `<a>` string with NO `<!--vsk-->` marker**
  (`packages/runtime/src/router-components.ts` server branch returned `` `<a ...>${childStr}</a>` ``).
- Client hydrate ran `hydrate.nextElement('a')` → tag mismatch → old `nextElement` **hunted**
  while eating markers (`adoptElement` = `marker.remove()` + `stampClaimed`) → cascade →
  walker starvation → article claims missed → `__place(..., $root)` branch-3 teleported fresh
  nodes to `#root`. Probe showed `eat want=a got=SPAN idx=0/1` ×2 per sidebar item, 12 misses,
  `articleLen=213, h1=null`.

### The fixes (both in the working tree, committed)
- **Fix A** — `packages/runtime/src/router-components.ts`: Link SSR now returns
  `` `<!--vsk--><a ${attrs}>${childStr}</a>` ``. Only Link/NavLink anchors get a marker;
  static `<a>` and `md.ts` prose anchors stay unmarked/unclaimed.
- **Fix B** — `packages/runtime/src/hydrate.ts` `nextElement`: on the first tag mismatch it now
  consumes **exactly one marker** (`tm.state='claimed'; break;`) and returns a fresh element —
  no more hunting/eating through the rest of the walker. Local divergences stay local.

### Tests & tooling (all green)
- `npx tsx packages/runtime/src/hydrate.test.ts` → **28/28** (2 new: stop-at-first-mismatch
  no-cascade; claim a marked anchor inside a boundary subWalker = Link SSR shape).
- `npx tsx packages/runtime/src/router.test.ts` → **76/76** (1 new: "Link SSR emits a claim
  marker before the anchor"; uses a `delete globalThis.document` trick to hit the SSR branch).
- `npm run typecheck` clean.
- `npx tsx packages/cli/src/build-packages.ts` → dist rebuilt; `dist/hydrate.js` +
  `dist/router-components.js` contain the fixes, no `[probe]` strings.

### Live behavior on :4000 (browser-verified)
- SSR HTML now has `<!--vsk-->` before `<a href=...>` (multi-line — don't grep with single-line regex).
- Client runtime served at `/_vesk/runtime.js` has Fix B (comments strip, so grep for the CODE,
  e.g. `adopted === null` + `break`, not comment text).
- Hydration outcome improved: `articleLen` 213 → **1884**, 25 anchors inside `main>…>article`,
  header logo/anchor links claim cleanly (`data-vsk-claimed`). The article element itself IS
  claimed and preserved (`data-vsk-claimed` true).
- Also verified earlier (prior sessions, still true): Footer crash fix live; adapter unit
  suites green (standalone-chunk 7/7, client-bundle-scope 21/21, tree-shake 19/19, seo-audit
  11/11, hmr 39/39); code-split test 9 known-unrun.

---

## 3. What's NOT working yet — the one remaining hydration defect

**Symptom (live, reproducible):** after hydration on `/docs/components` —
- `document.querySelector("main h1")` → **null**
- `#root` gains **6 stray nodes**: `P,H2,UL,H2,P,DIV`
- **33** `[vesk-hydrate] hydration claim missed … (N markers consumed)` console warnings
- `articleLen=1884` (mostly client-rendered), `main>` single stamped child `DIV*`.

**Decisive probe evidence** (`.probe-claims.mjs` patches the served runtime; print `[p]` logs):
- Page-content claims begin at **idx=231** and, from the very first claim, every marker target
  reports **`sibling=null`** — i.e. the marker comments exist but their element siblings are
  **already gone from the DOM** when the page-content claims run. This is NOT a count/misalign
  drift; **the SSR element nodes for all article content markers ≥231 are detached before the
  page hydrator claims them.**
- Claim stream then degrades to `MISMATCH?idx231 / MISS?idx232 / MISS a idx0 (fresh island) /
  MISMATCH span / MISS span / MISMATCH h1 / MISS h1 / …` + a long run of `idx=0` fresh
  `{#client}` island walkers (footer etc. — those misses are normal/islands).
- `articleHasClaimedAttr=true`, so the SSR `<article>` was NOT replaced wholesale; its *children*'
  SSR elements were removed (or moved) before being claimed.
- `hasMarker=true` → orphaned comment markers remain in the DOM (they get counted by
  `assertFullyHydrated`/canaries).

**Most probable mechanism (unproven):** the docs **layout/mount path detaches SSR content
between the header-claim and the page-claim**. Candidate sites to instrument first:
1. `packages/runtime/src/hydrate.ts` `__place` / `__ensureHooks` and any `container.replaceChildren`
   in the layout mount (a claimed region being rebuilt fresh destroys the markers+SSR elements
   of the un-claimed sibling article content).
2. `DocsLayout` region-claim bookkeeping: check that the layout's `subWalker`/`nextElement`
   bookkeeping doesn't advance the shared parent idx past the article markers *without* the
   sidebar's subWalker actually owning them (a `this.idx += subMarkers.length` slice that counted
   markers outside the claimed subtree).
3. The eyebrow row added **extra** markers this fix introduced (`M div` content-wrapper + `M a`)
   inside the top `<p>` — verify the DocsPage eyebrow code claims exactly those, in order, so it
   can't shift the following claims (would show up as alignment error, but here even the *first*
   page claim is already null → mechanism is (1)/(2), not (3)).

**Fastest decisive check to run next session** (one puppeteer run, no patching):
intercept just `/_vesk/runtime.js` and `console.log` inside `__place(anchored, container)` and
inside the `replaceChildren`/`removeChild` call sites when `container` is the article or its
ancestors, and log `document.querySelectorAll('main *')` length right after the sidebar claims
finish (before page claims). The FIRST `remove`/`replace` between header-claim and article-claim
is the culprit.

---

## 4. Next steps (ordered)

1. **Step 0 — env reset on a fresh machine:** `npm run typecheck` &&
   `npx tsx packages/cli/src/build-packages.ts`, then restart the vesk-doc dev server
   (it does NOT watch `packages/dist`), open `/docs/components`, expect the §3 symptoms to
   reproduce.
2. **Close §3:** instrument `__place`/mount `replaceChildren` per the decisive check above;
   fix the layout/mount so the SSR article subtree survives until the page claims it.
3. **AGENTS.md hard requirement (still pending for this fix):** run
   `node tests/hydration-test.mjs` (needs ports 3002/3099 free) after the hydration change is
   finally complete. Unit tests are not sufficient.
4. Clean up scratch (uncommitted, intentionally NOT in this commit):
   `probe-*.mjs`, `.probe-*` (incl. `.probe-mitm.mjs`, `.probe-claims.mjs`), `_diag6.mjs`,
   `.linkdbg.mjs`, `.ci-pack/`, `doc-ref/`, `.vercel/`, `vercel-err.txt`, tarballs.
5. Update TODO.md.

### Carry-over workstreams (unchanged)
- **Three `/compiler` bugs:**
  - 21 leftover unclaimed `<!--vsk-->` markers in rendered output (likely static vs dynamic
    `subtreeNeedsJS`/`staticNodeToJS` attrs-vs-children mismatch on `isStaticIR`).
  - SPA client-side nav truncation (route-switch rendering drops content).
  - Stale back-nav (history/back restores stale page state).
- **Lobby SEO audit** (`test-app/app/lobby/`, llms.txt, route-audit scripts) — Vercel/SEO findings.

---

## 5. Environment & relevant files (handoff notes)

- Browser probing: puppeteer-core + chromium at
  `/data/data/com.termux/files/usr/bin/chromium-browser`, args
  `--no-sandbox --disable-gpu --js-flags=--max-old-space-size=512`. This is a Termux/Android box.
- `:4000` dev server: `/root/vesk/vesk-doc`, cmd `node node_modules/@vesk/vesk-cli/dist/cli.js dev -p 4000`.
  To kill: `kill <pid>` (NOT `fuser`/`pkill` — they hung). Re-launch detached with `setsid nohup … &`.
- Ports for E2E: 3002 (test-app), 3099 (hydration-test servers).
- Key source: `packages/runtime/src/{hydrate.ts, router-components.ts, reconcile.ts, router.ts,
  index-client.ts}`; `packages/compiler/src/{server-jsgen.ts, client-codegen.ts, ir-generator.ts}`;
  `packages/adapter/src/*` (AOT/dev-server/hmr — uncommitted-before-this-session work is included
  in this commit); `scripts/AGENTS.md` (ports/release rules); `tests/hydration-test.mjs`.
- vesk-doc app fixtures (committed): `Nav.vsk`, `docs/DocsHeader.vsk`, `docs/layout.vsk`,
  `layout.vsk`, `page.vsk` — these were mid-debug edits; relevant to §3.
- Probe scripts `.probe-claims.mjs` (claim logging; initialize `globalThis.__cl = globalThis.__cl || []`
  BEFORE the entry-push, a guard-only init silently logs nothing) and `.probe-mitm.mjs` (runtime
  text-patch via request interception) are the two useful reusable ones — currently uncommitted
  scratch; recreate if deleted.

## 6. Commit note
This commit intentionally EXCLUDES scratch probe files, `.env.local`, `.vercel/`, `doc-ref/`,
`vercel-err.txt`, and tarballs. Tracked CI tarballs that were deleted on disk stayed deleted
(staged). New (untracked) ci-*.tgz tarballs were left untracked.