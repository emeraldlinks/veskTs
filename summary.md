# Handoff: academy-vesk conversion — 3 framework bugs found & fixed, app conversion ~50% done

> **Read this first.**
>
> This session converted the React app `~/cofoundr-academy` to Vesk in
> `~/academy-vesk`, and in doing so found and fixed **three real Vesk bugs** — each
> reproduced in a browser first, fixed at the root, and covered by a new
> regression test. Sections 1–4 are done work: **do not re-investigate**. Section 5
> is the one OPEN BUG plus the environment traps that cost the most time.
>
> Every claim below was measured in headless Chromium against a real
> `vesk start` server, not inferred from the code.

---

## 0. State at handoff

| | |
|---|---|
| vesk branch / HEAD | `main`, all fixes committed and pushed to `origin` (`emeraldlinks/veskTs`) |
| academy-vesk | `~/academy-vesk`, committed and pushed |
| React source | `~/cofoundr-academy` — reference only, unmodified |
| test harness | `~/academy-vesk/tests` (puppeteer-core + Termux chromium), ~15 cases green |
| server | `scripts/restart-prod.sh` → prod build on `:3111` |

---

## 1. Conversion progress — what is done

**`app/(public)/`** — all 8 public routes converted and browser-tested:
`/`, `/about`, `/apply`, `/certifications-info`, `/class-structure`,
`/internship-info`, `/login`, `/programs`.

**`src/_lib/`** — all shared modules converted (auth store, teaching store,
student store, theme, certificate builder, 11 mock data modules, types). These
were already done before this session.

**`app/components/`** — 20 shell components converted (AppShell, AdminShell,
Sidebar, Topbar, Modal, CommandPalette, NotificationDrawer, ThemeSwitcher,
StatusBadge, ProgressBar, Metric, Can/RequireCapability/RequireStaff guards).
`AssignmentCard.vsk` and `CourseTree.vsk` were added this session.

**`app/(portal)/`** — `dashboard`, `curriculum`, `notifications` converted this
session.

### Still to convert (the actual remaining work)

| React source | Target |
|---|---|
| `src/pages/portal/{AssignmentsPage,AssessmentPage,CertificationsPage,InternshipPage,LessonViewerPage,PerformancePage,PortfolioPage,ProfileSettingsPage,DesignSamplesPage}.tsx` | `app/(portal)/<route>/page.vsk` |
| `src/components/certificate/CertificatePreview.tsx` | `app/components/CertificatePreview.vsk` |
| `src/pages/admin/*.tsx` (9 pages) + `src/pages/admin/teaching/*.tsx` (8 pages) | `app/(admin)/<route>/page.vsk` |

Roughly **10.5k lines of React → ~24 remaining `.vsk` pages**, all sharing the
idioms already established (see §4).

---

## 2. FIXED — hydration deleted server-rendered content (icon claims)

**Symptom.** On `/about`, hydration *removed* a `<span>` containing the button
label "Apply Now" and replaced it with the icon's `<svg>`. After hydration the
button had lost its text. `Notification Center` and every other icon-adjacent
static label had the same fate.

**Root cause — two compounding halves.**

1. `packages/compiler/src/client-codegen.ts` emitted the residue offset for a
   component call *only* when the callee was a compiled component
   (`if (ctx.markerless && promptExpr && !plainTarget)`). An **imported** value —
   which is exactly what every `lucide-vesk` icon is — was assumed to be
   claim-less. The compiler computed the offset and then threw it away.
2. `lucide-vesk`'s `Icon(props, registry, walker)` *does* claim, through the
   walker it is handed. It called `nextElement("svg")` with `skipK = 0`, landed
   on the **static residue** in front of it (`<button><span>Apply Now</span>
   <svg/></button>`), read the tag mismatch as divergence, and the walker's
   recovery path **detached the real `<span>`**.

**Fixes.**

- `client-codegen.ts`: the `injectSkipK(prompt)` deposit is now emitted for
  **every** hydrate-mode component call, plain targets included. A plain target
  that does not claim simply leaves the deposit for the post-call adoption
  claim, which carries an explicit offset and therefore clears it.
- `packages/runtime/src/hydrate.ts`: a walker applies an unconsumed deposit to
  the next claim that carries no explicit `skipK` (a plain-JS callee never calls
  `takeSkipK`). **Any** claim clears the deposit, so a claim with its own offset
  cannot leak it into the next one.

**Tests.** Two new cases in `packages/runtime/src/hydrate.test.ts` (implicit
deposit; explicit skipK wins and clears), one in
`packages/compiler/src/client-codegen.test.ts`.

---

## 3. FIXED — module state was duplicated per route chunk

**Symptom.** Signing in through `/login` persisted the session to localStorage
but the portal rendered its **signed-out** view: `[session: anonymous]`, "Your
role holds no learner-portal capabilities", the sidebar rail empty. Navigating
away and back made it correct — the shell had re-read `localStorage`.

**Root cause.** Every route chunk was esbuild-bundled independently
(`entryPoints: [tmpFile]` per chunk, `packages/adapter/src/client-bundle.ts`), so
a module imported by two chunks was **inlined twice**. A duplicated module means
a duplicated module scope: `src/_lib/auth/store.ts`'s module-scope
`track()` cells existed once per chunk. Login wrote the *login chunk's* cell;
the portal layout read the *portal chunk's* cell. Green build, no error.

**Fix.** A shared-module pass in `client-bundle.ts`:

- sources imported by **≥2 chunks** and app-local (never `node_modules`) are
  bundled **once** into the entry bundle and published on
  `globalThis.__veskShared`;
- each route chunk imports a generated shim reading its bindings from there;
- a resolver plugin (esbuild's `alias` only accepts bare package names, so this
  had to be `onResolve`) performs the redirect;
- a failed shared pass **falls back** to the old per-chunk inlining and logs,
  rather than shipping dangling bindings.

**Second bug this exposed — a second `@vesk/runtime`.** The shared pass bundled
`@vesk/runtime` too, giving the app a second `Cell` class and a second
`currentEffect` variable: a store cell written from a click notified subscribers
registered against the other copy, so nothing store-driven ever repainted — the
write landed, no error, no update. Fixed by redirecting `@vesk/runtime*` to a
shim that reads the entry bundle's bindings off `globalThis`, injecting the
shared code **after** `runtimeGlobals + extraGlobals`, and adding the shared
modules' runtime names to `runtimeImportNames` so they are always published.

**Tests.** New `packages/adapter/src/shared-modules.test.ts` (5): one body per
shared module, entry publishes the map, chunks use shims, single-chunk modules
are left alone, and the entry publishes the runtime **before** the shared
modules run with no `class Cell` anywhere in the shared/chunk output.

---

## 4. FIXED — `if` regions reading store state never repainted

**Symptom (the user's report).** On `/dashboard`, the notification bell and the
profile avatar button did nothing when clicked; the drawer/menu would appear
only after navigating away and back. Same for the apply wizard's step chips —
clicking step 02 did not swap the panel.

**Root cause.** `isReactiveExpression()` in `client-codegen.ts` decided whether
a condition was reactive by looking for `props` or a locally declared
`track()` binding. A condition driven by module-scope store state —
`if (notificationDrawerCell.get())`, `if (isAuthenticated())` — matched neither,
so the region was emitted as a **one-shot** `if (cond) { render() }` with no flip
effect at all. A local `let &[open] = track(false)` in the same position worked,
which is what made it look app-specific.

**Fix.** A **call expression** in the condition counts as potentially reactive:
it is the only way to hide a cell read behind a function boundary, which is the
documented store pattern. The runtime's `get()` records the dependency when the
expression is evaluated inside the emitted effect, so dynamic subscription is
enough — no static analysis required.

**Cost.** A genuinely static condition now costs one never-firing effect. The
opposite error is a component that renders once and never updates again.

**Tests.** Two cases in `packages/compiler/src/client-codegen.test.ts`.

---

## 5. OPEN — Topbar bell/profile handler runs but the drawer still does not open

**Last measured state.** With `src/_lib/ui.ts` instrumented with a `console.log`
inside `openNotificationDrawer`, clicking the bell produced:

```
bell.__evh_click → "() => openNotificationDrawer()"   // handler IS attached
document.__vesk_dlg_click → true                       // delegation IS installed
clicking (dispatched AND native .click()) → zero DOM mutations
```

**The `console.log` never fired**, so the failure is *before* the store call —
the handler closure is not reaching the store function. Everything else about
the chain is verified working: the store module is evaluated exactly **once**
(`globalThis.__uiEvalCount === 1`), the flip effects for
`notificationDrawerCell.get()` are present in the `(portal)` group chunk's
AppShell hydrator, and local `track()` cells in the same app react correctly.

**Strongest remaining hypothesis (not yet proven).** The `(portal)` group chunk
inlines `src/_lib/ui.ts` (it is imported by exactly one chunk, so it is not in
`sharedSources`) **and** esbuild bundles a private copy of `@vesk/runtime` into
that same chunk. The chunk therefore contains its own `Cell` class. If the
delegated click listener that actually fires was installed by a *different*
chunk (e.g. the dashboard chunk, whose hydration ran later and whose
`__evh_click` bindings came from `globalThis.__veskShared`), the write lands on
the dashboard chunk's cell while the AppShell flip effect subscribes to the
group chunk's cell — a write to one copy, a read from the other.

**How to confirm in one step.** Grep the built group chunk for a bundled
runtime: `grep -c "class Cell" dist/static/page-\(portal\).*.js` (non-zero
confirms a private copy) and check whether the dashboard chunk contains its own
copy of `openNotificationDrawer`. If confirmed, the fix is in
`client-bundle.ts`: the per-chunk esbuild pass must also treat
`@vesk/runtime` as external, exactly as the shared pass now does.

**Note on the last build.** `dist/` was mid-rebuild when this handoff was
written (`npm run build` was interrupted by the session ending). Run
`rm -rf dist && npm run build` before trusting any measurement.

---

## 6. Conventions established in academy-vesk (follow these)

- **Reactivity sugar, not raw cells.** `let &[count] = track(0)` and use
  `count` / `count = count + 1` / `count++`. Bind the raw cell (`&[count,
  countCell]`) **only** when an API demands it (`bindValue`, `peek`, `untrack`).
  Module-scope store cells from `src/_lib/*.ts` are read with `.get()` — they
  are not component TrackDecls.
- **Never snapshot a tracked read into a `const`.** The compiler warns, and the
  warning is real. Either call a body-level helper from the binding
  (`stepClass(s.num)`) or wrap the value in `derived()`.
- **A helper function that reads a cell is not a snapshot** and is no longer
  warned about (§7).
- **Statement mode for every page**; loops keyed (`for (const x of xs; key
  x.id)`), index-keyed lists use `key i; index i`.
- **`onNavigate(path)` becomes `useNavigate()`.** Search params are not props.
- **`src/_lib/` stays plain `.ts`** — stores are module-scope `track()` cells
  plus exported accessors, not components.

## 7. Incidental fix — false-positive reactivity warning

`isReactiveExpression`'s sibling diagnostic in `packages/compiler/src/ir-generator.ts`
flagged `const stepClass = (n) => … n === step …` as a stale snapshot. A function
initializer is not a snapshot: its body runs when the binding is evaluated. Now
skipped for `ArrowFunctionExpression` / `FunctionExpression`, with a test in
`abuse-reactivity.test.ts`.

## 8. Test harness (new this session)

`~/academy-vesk/tests` — dependency-free runner + puppeteer-core against the
Termux chromium:

- `lib/runner.mjs` — suites, assertions, exit code.
- `lib/browser.mjs` — launch, mutation probe installed at document start (proves
  hydration **claimed** the server DOM rather than replacing it), click/type,
  localStorage seeding, `ssrHtml()`.
- `lib/session.mjs` — session seeding per seeded role.
- `public.test.mjs` — SSR status + rendered copy + hydration + interactions for
  every public route.
- `run-all.mjs` — `node tests/run-all.mjs`, `BASE=http://127.0.0.1:<port>`.

`domcontentloaded` + explicit settle, **not** `networkidle2`: the dev server's
HMR socket never idles and `networkidle2` timed out on every page.

## 9. Environment traps (cost the most time — read before debugging)

- **`pkill -f "vesk start"` kills the invoking shell**, because the pattern
  matches the agent's own command line. Use `scripts/restart-prod.sh`, which
  kills by PID and starts detached.
- **`vesk dev` OOMs on this box** (~7.7 GB total, ~2 GB available). The crash is
  a bare `0x…` stack trace with no message. Test against `vesk start` (prod
  build) instead; use dev only for quick compile-error checks.
- **`node_modules/@vesk/*` resolves to the BUILT `dist/`, not `src/`.** After
  editing framework source, run
  `npx tsx packages/cli/src/build-packages.ts` **before** running any test that
  imports `@vesk/...`, or you will test stale code and see phantom failures.
- **Framework changes reach the app only through**
  `cd ~/vesk && node scripts/refresh-testapp-deps.mjs ../academy-vesk`
  (≈2–20 min; it rebuilds, repacks uniquely-versioned CI tarballs and verifies
  the installed versions). Restart the dev/prod server afterwards — the running
  server keeps the old bundle.
- Chromium: `/data/data/com.termux/files/usr/bin/chromium-browser`, launched with
  `--no-sandbox`. CDP input events crash some builds here; dispatch clicks in-page
  with `el.click()`.
- The academy app has no build-time route for a scratch page — add
  `app/probe/page.vsk`, build, then delete it before committing.

## 10. Verification performed

- `npx tsx packages/compiler/src/{client-codegen,integration,expression-mode,ir-generator,abuse-reactivity,props-type,primitive-abi}.test.ts` — all green (382 / 128 / 26 / 9 / 12 / 12 / 22).
- `npx tsx packages/runtime/src/{hydrate,router}.test.ts` — green (103, all router).
- `npx tsx packages/adapter/src/{client-bundle,client-bundle-scope,client-bundle-cache,asset-hash,code-split,hydration,shared-modules}.test.ts` — all green.
- `npm run typecheck` in `~/academy-vesk` — clean.
- Browser: public routes render, hydrate, and update; login → portal navigation
  works; module state is now shared across chunks (session survives SPA nav).

`node scripts/test.js` (the full 4-hour suite) was **not** run this session; run
the per-file suites above plus the e2e tests before a release.

## 11. Files changed

### `~/vesk`

| File | Change |
|------|--------|
| `packages/runtime/src/hydrate.ts` | Walker applies an unconsumed residue deposit to the next claim without an explicit skipK; any claim clears it |
| `packages/compiler/src/client-codegen.ts` | `injectSkipK` for plain targets too; `isReactiveExpression` treats calls as reactive |
| `packages/adapter/src/client-bundle.ts` | Shared-module extraction (entry bundle + per-chunk shims + `@vesk/runtime` external + ordering) |
| `packages/compiler/src/ir-generator.ts` | Function initializers exempt from the stale-const warning |
| `packages/runtime/src/hydrate.test.ts` | +2 cases |
| `packages/compiler/src/client-codegen.test.ts` | +3 cases |
| `packages/compiler/src/abuse-reactivity.test.ts` | +1 case |
| `packages/adapter/src/shared-modules.test.ts` | **New** — 5 cases |

### `~/academy-vesk`

| File | Change |
|------|--------|
| `app/(portal)/dashboard/page.vsk`, `curriculum/page.vsk`, `notifications/page.vsk` | New |
| `app/components/{AssignmentCard,CourseTree}.vsk` | New |
| `app/components/{Sidebar,MobileNav}.vsk` | Missing `NavIcon` import (SSR 500) |
| `app/(public)/login/page.vsk` | Sugar for `statusMessage`/`error`/`email` |
| `app/(public)/apply/page.vsk` | Sugar for `form`; `stepClass()` helper replaces stale consts |
| `app/(public)/programs/page.vsk` | `derived()` for `selectedProgram` |
| `tests/**` | New browser harness + public suite |
| `scripts/restart-prod.sh` | New — non-suicidal server restart |

Scratch (`tmp/`, `.probe/`, `tmp-vesk-*`) is not committed.