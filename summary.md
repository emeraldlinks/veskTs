# Handoff: app-driven bug hunt — 1 open bug, everything else fixed and pushed

> **Read this first.**
>
> The previous (resolved) handoff starts at line 294. `veskTs` is clean and green except for ONE bug at the
> bottom, which is diagnosed but **not** fixed. Sections 1–3 are done work (do
> not re-investigate). Section 4 is the open bug. Section 5 is the environment
> traps that cost the most time on this attempt — read it before you edit
> anything.

Everything below was reproduced against a real server and a real browser first.
`curl` is green for the open bug and `node scripts/test.js` is green; the failure
is only visible in a browser.

---

## 0. State at handoff

| | |
|---|---|
| branch / HEAD | `main` @ `1e0152625` (all fixes pushed to `origin`) |
| uncommitted | **0** — every experiment reverted |
| full suite | running at handoff; last clean run **106 files / 3793 assertions / 0 failed** |
| `academy` | separate repo, pushed to `cofoundr-academy` (force-pushed) |
| backup | the 29 commits / 483 files that force-push overwrote: `~/cofoundr-academy-backup/repo` (bare git dir) |
| test app | `academy` — dev `:3230`, prod `:3160` when running |

The prior handoff (SSR request scope + build duration, both resolved) follows
this one in the file.

---

## 1. Fixed and verified — do not redo

All browser-verified on `vesk dev` **and** `vesk start` unless noted.

### Compiler
- **Self-closing JSX is not self-closing HTML.** `<div class="dot" />` opened a
  div and swallowed every following sibling (9 sites in one app, including the
  login page's "or enter credentials" divider). Explicit end tag now; void
  elements and `<svg>`/`<math>` subtrees keep `/>`.
- **Dynamic attribute on a self-closed element** was appended *after* the tag,
  where the parser drops it — `style={{…}}` served with no `style` at all.
- **A bare `{props.children}` — the whole body of a layout — was silently
  dropped** by client codegen (`if (!parentVar) return null`). Nothing below the
  root layout hydrated. Proof: SSR emits zero `aria-current="page"` (NavLink sets
  it client-side only); after the fix the live DOM has it.
- **Route groups could not be the page** for `/`; the match fell through to the
  page-less root → chain with no page node → 404. Fixed in both matchers.
- **`matchRoute()` declared `pathname` on `RouteMatch` and never set it**, so
  `usePathname()` returned `/` everywhere → NavLink active state permanently
  dead.
- **Route groups were dropped from the client chain** when a child matched, so
  `app/(public)/layout.vsk` never applied client-side
  (`hyd-dbg` showed `layoutNames:["Layout_Index"]`).
- **Chain order:** dev SSR renders the page only for the LAST chain node, and
  the group was emitted last → `/about` served the **index** page
  (`dev /about` 46,961 b "PROFESSIONAL CERTIFICATION" vs prod 17,954 b). Group
  now precedes its child; both matchers agree on `root → group → page`.
- **Generic arrow functions couldn't be parsed** (`<T,>(x): T => x`). The
  vendored acorn-typescript branch is gated on an `options.jsx` flag `parse()`
  never sets, and the JSX tokenizer emits `jsxName`/`jsxTagEnd` instead of type
  tokens. Blank the type-param list in place before acorn runs; disambiguate
  structurally (`>` → params → optional return type → `=>`), **not**
  `>`-followed-by-`(`, which `<div>(hi)</div>` also matches.
- **Parameter annotation survived TS stripping only with a default value** (an
  `AssignmentPattern` keeps the annotation on `.left`). Also fixed
  `(a?: string = "x")`.
- **A parse failure in an imported module was silent** → raw source substituted
  → `Unexpected token ':'` blamed on an unrelated module. Now `V0901` located.
- **`@vesk/*` bypassed the module loader's tsconfig-alias path** and was parsed
  with the `.vsk` grammar; a module importing BOTH a `@vesk/*` package and a
  relative module lost every export. Now loaded natively.
- **A route file declaring several components with no default export** resolved
  via `components[0]` — so a helper declared above the layout silently became
  the layout (`_layoutCompList = ["RootLayout","ChildToggle"]`), the page body
  was discarded, and every route returned **200 with an empty body**. Resolution
  order is now *exactly* as before (default → first → exported); what was added
  is a build-time **warning** on ambiguity. **Do not change the order** — see §5.
- A component call in expression position (`{Terminal({size:14})}`,
  `{cond ? Terminal({…}) : null}`) is now a real `ComponentCall`; a
  component-valued tag (`const Icon = item.icon; <Icon/>`) resolves.

### Runtime
- **A multi-token `activeClass` threw `DOMException`** (verified in Chrome) and
  killed SPA routing for the whole page — `classList.add()` takes tokens, not a
  class string. Now split.

### Warnings added
- **Stale `const` reading a tracked value** freezes every binding that uses it
  (`const isSelected = a.id === b.id` → evaluated once; the effect re-runs but
  re-reads a stale value). Reported at build time. Deliberately silent for event
  handlers that read a cell, and for cell aliasing — the first cut warned on
  those and produced three noise warnings in one file.

### Build
- `vesk build --strict` now fails on an unresolvable chunk import instead of
  exiting 0 with dangling bindings.
- **lucide-vesk tree-shakes:** `@__PURE__` + `legalComments:'none'`. An
  icon-bearing chunk went 866,126 b / 1,594 icon modules → 18,220 b / 2.

---

## 2. The open bug — child components under a layout never re-render

### Symptom
A component with `track()` + a button, rendered inside a layout, **renders but
is inert**: click fires nothing, state never re-renders. Interactivity that
only exists after leaving and re-entering the route "works", because a route
change rebuilds it.

### Minimal repro (`tmp/o`, three files + a group layout)

```vsk
// app/eff.vsk
component EffectIsland() { effect(() => {}); <span class="hidden" /> }
export default EffectIsland;

// app/toggle.vsk
component ChildToggle {
  const &[c, cCell] = track(false);
  <div><span class="cn">{c ? 'CHILD-ON' : 'CHILD-OFF'}</span>
       <button class="cb" onClick={() => { c = !c; }}>cb</button></div>
}
export default ChildToggle;

// app/(public)/layout.vsk
import ChildToggle from '../toggle.vsk';
component PublicLayout(props: { children?: any }) {
  <div class="gl"><ChildToggle /><main class="slot">{props.children}</main></div>
}
export default PublicLayout;

// app/layout.vsk   <-- THE VARIABLE PART
import EffectIsland from './eff.vsk';
component RootLayout(props: { children?: any }) {
  <EffectIsland />        // sibling BEFORE the slot  => BROKEN
  {props.children}
}
```

Reverse the last two lines and it works. It is **order-dependent**:

| root layout | result |
|---|---|
| `<EffectIsland />` then `{props.children}` | ❌ inert |
| `{props.children}` then `<EffectIsland />` | ✅ works |

### Measured facts (do not re-derive these)
1. Both components **do** hydrate — `console.log` at the top of each body
   prints `ISLAND-RENDER | CHILD-RENDER`.
2. The click handler **never runs** — a `console.log` in `onClick` prints
   nothing. So it is **not** an orphaned effect and **not** a missing flush.
3. Live DOM: `.cb` exists, `typeof .cb.__evh_click === "undefined"`,
   exactly one `.cb`, and `islandInDom === false` (the sibling's own output is
   gone too).
4. **The emitted child hydrator DOES the right thing.** From the built chunk:
   ```js
   const $n032 = $n020.nextElement("button", 0);        // claims the SSR button
   $n032.__evh_click = () => set(cCell, !get(cCell));   // handler attached
   ```
   So the node that receives the handler **is not the node in the document**.

### Current best hypothesis
The child's subtree is hydrated correctly and then **replaced by a fresh copy of
the SSR markup after hydration**, which drops `__evh_click` and all reactive
wiring. Something re-inserts `#root`'s children after the page hydrates. This
also explains `islandInDom:false` — the same replacement wipes the sibling's
output, and the layout's `return __pendingChild || $mount` already discards
`$mount`.

**The one measurement that would settle it** — never obtained: log, in document
order, every node attached to or removed from `#root` *after* the child hydrates.
That names the code doing the replacement.

### Things already ruled out — do not retry these
- **Orphaned effect** — ruled out by fact 2 (no click log at all).
- **Block attachment** — `runInBlockWindow` (`runtime/src/router.ts:704`) keeps
  one active root block for the whole synchronous render; both effects land in
  it regardless of order.
- **Spent walker budget / positional claiming** — the change reached the bundle
  (verified in the emitted chunk) and the child was still inert.
- **`createLayoutSlot` for the bare slot** — a **no-op**: it returns the *same*
  walker when `findSlotRange` finds nothing (markerless mode), so it cannot fix
  a budget problem.
- **Emitting top-level slots before siblings** — also verified present in the
  emitted chunk; child still inert.

### Where to look
- `packages/compiler/src/client-codegen.ts` — the bare-slot branch
  (`if (!parentVar)`, emits `__pendingChild = props.children(__hydrate)` then
  `return __pendingChild || $mount`), and `maybeReplace`'s adoption branch
  (`if (__sr && __sr.parentNode) … replaceChild` — a claim **miss** silently
  drops the rendered node).
- `packages/runtime/src/hydrate.ts` — `StructuralWalker.claimAt` / `claimOnly` /
  `subWalker`, and `auditHydration`'s orphan sweep.
- `packages/runtime/src/router.ts:1208+` — `renderLayoutChain`, which passes the
  *same* walker down to each layout rather than creating a scoped one.

---

## 3. What is verified working in `academy`

- All routes 200, correct content, **no index flash** (confirmed correct page from
  the first paint at 16 ms with a `MutationObserver`).
- SPA nav `SAME_DOC`; hydration live (`aria-current="page"` present live, absent
  in SSR); icons render as real `<svg>`; no console errors.
- `/programs` selection moves (`Digital Marketing` → `Cybersecurity`) — the
  hoisted-`const` fix, applied and browser-verified.
- Only non-2xx request on either server is `404 favicon.ico`.

Verification scripts used live in `/tmp` (wiped between sessions) — recreate
them. The shape that matters: `puppeteer-core` from the repo's `node_modules`,
Chrome at
`$HOME/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`,
`--no-sandbox --disable-dev-shm-usage --disable-gpu`, `timeout: 120000`.

---

## 4. How to run things

```bash
npx tsx packages/cli/src/build-packages.ts      # REQUIRED after any packages/ edit
node scripts/test.js                             # full suite
npx tsx packages/compiler/src/<file>.test.ts     # one suite
npm run typecheck
```

Editing an app against the framework needs a repack — **skip this and you test
stale code** (see §5):

```bash
node scripts/refresh-testapp-deps.mjs academy   # repack + reinstall into the app
cd academy && npx vesk build
```

---

## 5. Environment traps that cost the most time — read before editing

1. **Stale builds are the single biggest hazard.** Four separate times a change
   was made, `build-packages` ran, the app was rebuilt — and the served bundle
   did **not** contain it. One time even `require.resolve('@vesk/compiler/src/…')`
   pointed at the updated `dist` while the emitted chunk was still old.
   **Always grep the emitted output** for a marker unique to your change
   (e.g. `grep -c 'createLayoutSlot' dist/static/client.*.js`) and check the
   hash the page actually loads:
   ```bash
   C=$(curl -s $URL/about | grep -o 'client\.[a-z0-9]*\.js' | head -1)
   curl -s "$URL/_vesk/static/$C" | grep -c '<your-marker>'
   ```
   Never trust "I rebuilt" — trust the artifact.

2. **Do not change `resolveComponentName`'s lookup order.** It is
   `default export → first component → any export`, and that order is load-bearing
   twice over: `test-app/app/page.vsk` holds module-level markup (implicit first
   component `Home`) alongside `Throws, Appx, Throw, Appxx`. Checking `exported`
   first swapped the page for `Appx`; preferring `last` swapped it for `Appxx`.
   Both cost real failures. The fix for ambiguous files is the **warning**, and
   `export default` in the app.

3. **A 200 response is not proof a page rendered.** The wrong-layout bug
   returned **200 with an empty body** and nothing in any log. Assert on rendered
   content (an `h1`, a non-zero `#root` length), not on status. One weak
   assertion here reported "ALL PASS" on an empty page.

4. **Chrome needs a long launch timeout** on this 2-vCPU box when the suite is
   also running — `timeout: 120000`, `protocolTimeout: 180000`. The 30 s default
   fails with `Timed out waiting for the WS endpoint`.

5. **The machine overheats.** This session ran the suite and several app servers
   concurrently; kill stragglers between runs
   (`pkill -f "vesk start"`, `pkill -f chrome-linux64`, `pkill -f scripts/test.js`)
   and avoid building while Chrome is driving pages.

6. **`node scripts/test.js` writes to `/tmp`, which gets wiped.** Write the log
   somewhere durable (`tmp/logs/suite.log`) or it disappears before you read it.

---

## 6. Suggested next steps for the open bug

1. Establish a **verified** edit→build→serve loop using the marker-grep above
   before changing behaviour. Four attempts were invalidated by stale builds.
2. Instrument the post-hydration replacement: log every `appendChild`/`remove`/
   `replaceChild` on `#root` and its children, in document order, after the
   child hydrates. That single trace names the culprit.
3. Only then change code. Given §5.1, prove the change is in the served bundle
   **and** re-run the minimal repro from §2 before touching `academy`.

Two claims in this session were wrong and were corrected in git history: a
"static sibling dropped next to a bare slot" gap (hydrate mode deliberately
skips static subtrees SSR already rendered) and an earlier "child state never
re-renders" bug that could not be reproduced in three layouts. Keep verifying
through the real pipeline before writing anything into a commit message.
# SSR request-scope handoff (resolved) + build duration (8x faster)

> Two work items from one session. The first is done and merged; the second is
> the `vesk build` duration work, profiled and fixed below.

## The bug that remained

Concurrent requests to a page using `useFetch` lost their SSR data handoff: the
document rendered without `<script src="/ssr-data.js?t=…">`, so the client had
nothing to hydrate from and the page came up empty (or silently refetched) after
load. Reproduced on `test-app/app/async/page.vsk` (`/async`, which fetches
`/api/posts` during SSR) against the production build.

Signature, and the reason it survived three earlier theories: **the page body
was always complete.** The multi-pass renderer reads the process-global data
store to re-render, so a lost slot produced a perfect-looking page with no
hydration payload. The size histogram was the tell — failures were 66 bytes
shorter (4774 → 4708) and nothing else differed.

## Root cause: two copies of the request-scope store in the server bundle

`packages/adapter/src/runtime-bundle.ts` built its entry with

```ts
'export { withSsrStore } from "@vesk/compiler/src/ssr-store";'
```

while `server-render` (pulled in from the absolute `dist/server-codegen.js`
path) imports the same module through its own specifier. Those two specifiers
resolved to **different files** — the bare one through the tsconfig path
mapping to `packages/compiler/src/ssr-store.ts`, the other to
`packages/compiler/dist/ssr-store.js` — and esbuild dutifully bundled both.

Two copies means two `AsyncLocalStorage`s, two `liveSlots` liveness maps, and a
second `Object.defineProperty(globalThis, '__vsk_ssr_token')` accessor shadowing
the first. The instrumented trace of a failing burst:

```
[ssrscope] enter existing=no   ← generated handler opens a scope (copy A)
[ssrscope] minted eh3
[ssrscope] enter existing=no   ← renderPage's own scope cannot see copy A
[ssrscope] minted ku4
[trace-stage] renderPage comp=AsyncPage store=3 tk=eh3   ← renders under A
...
[ssrprune] stale=47 total=48 live=1                        ← reaper (copy B) sees 1 live slot
[ssrprune] reaping 8 of 48 __vsk_ssr_data_g614…, __vsk_ssr_data_p4i1…, …
[render-trace] renderFullPage comp=Layout keys=∅ slot=∅ sink=∅   ← 8 documents ship no handoff
```

`stale=47 total=48 live=1` is the whole story: the reaper, running in copy B,
could not see a single claim made in copy A, so past its 40-slot cap it deleted
live slots — exactly 8 of them, and exactly the 8 documents that then shipped
without their data script.

### Fixes

1. **`runtime-bundle.ts` reaches the store through `server-codegen.js`**, which
   re-exports it, so the bundle contains one copy. One specifier, one file.
2. **`ssr-store.ts` pins its state to `globalThis`** (`__vsk_ssr_store_impl`):
   one `AsyncLocalStorage`, one liveness map, and only the copy that created
   the implementation installs the token accessor. A duplicate copy is now
   harmless rather than a data-loss bug — belt and braces for any other bundler
   path that duplicates a module.
3. **`__vsk_ssr_data_store` → `__vsk_ssr_payload_store`** (runtime-bundle writer
   + prod-server/dev-server/platform-handler readers). The CSP payload store
   matched the `__vsk_ssr_data_<token>` prefix the reaper sweeps, so the reaper
   could wipe every *pending* `/ssr-data.js` payload and turn a served page's
   hydration script into a 404. It was in the reaper's kill list on every run.

## Causes investigated and dismissed

- **Dev codegen never opened a request scope** (`hmr.ts`) — real, and fixed in
  the previous commit; the generated dev functions did not wrap their rendering
  in `withSsrStore`.
- **A scope did not own a liveness claim for its lifetime** — real, fixed
  (`liveSlots` is a refcounted `Map`, claimed for the whole scope).
- **`renderPageStream` merged from a different token** — real, fixed
  (`adoptSsrStore()` + `withSsrStoreOf` per `gen.next()`).
- **Deduped fetches attributed only to the winning request** — *not* the cause.
  With the module duplication fixed, the 48-request gate passes 48/48 both with
  and without the extra attribution, because `useResource`'s SSR cache-hit path
  already re-emits the shared result into the deduping render's token. The
  speculative change in `resource.ts` was **reverted** rather than shipped
  untested (see the file: the comment now explains why the dedupe path is fine).

## Incidental fixes (pre-existing, found on the way)

- `dev-server.ts` shipped a **debug `globalThis.fetch` wrapper** that it
  installed before every SSR render and never restored — one `new Error().stack`
  per fetch, forever, and a permanently wrapped `fetch` in the dev process. It
  also broke the dev handoff: `/async` in dev emitted no data script until it
  was removed.
- `dev-server.ts` `[nbsp-debug] DEV-SSR-ERROR` → a real `[vesk dev]` label.
- Dev API-route 500s returned `{ error }` while every other error path returns
  `{ ok: false, error }`.
- `scripts/test.js` gave the e2e servers 60 s to build the app twice; a slower
  box failed the whole suite before a single assertion. Now 300 s.
- `hmr-snippet.test.ts` asserted a hard `mean < 55 ms` budget taken from one
  fast machine. The same unchanged code measures 96 ms on a slow box, so the
  test was a coin flip on hardware. It now asserts the fast path is not slower
  than the two-pass chain it replaced (measured in the same process) plus a
  generous absolute ceiling.

## Verification

- `npx tsx packages/cli/src/build-packages.ts` — clean.
- `npm run typecheck` — clean (types, compiler, runtime, adapter, cli, pwa).
- Concurrency gate, 48 simultaneous `/async` requests, prod **and** dev:
  **48/48 with the handoff**, three consecutive runs (was 41–46/48).
- `node scripts/test.js` — **89 files, 3218 assertions, 0 failed** (exit 0),
  including the new `tests/ssr-handoff-concurrency-test.mjs`.
- `tests/vesk-doc-hydration-test.mjs` — **159/159 on dev and 159/159 on
  production** (moved from the repo root to `tests/`).
- `scripts/platform-smoke.mjs` vercel / netlify / cloudflare / deno / aws — all
  green; `scripts/platform-hydration.mjs edge` — 9/9.
- New tests: `packages/adapter/src/runtime-bundle.test.ts` (3 — one copy of the
  store, `withSsrStore` still exported, payload store out of the slot
  namespace; verified to fail against the old bundler entry), two new cases in
  `packages/compiler/src/ssr-token-scope.test.ts` (14 total — a simulated
  duplicate module copy shares the request scope, and a 48-request deduped
  burst on one resource key ships 48 handoffs), and
  `tests/ssr-handoff-concurrency-test.mjs` (8 — HTTP, prod + dev, wired into
  `scripts/test.js`).

## Measurement notes (this box)

- 2 vCPUs. Build timings swing wildly with load: the same test-app dev build
  measured 25 s idle and 83 s under load average 14. Do not read a slow local
  build as a regression; `scripts/test.js` now allows for it.
- Chromium had to be installed (`npx puppeteer browsers install chrome`);
  `CHROMIUM_PATH=$HOME/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome`.
- Do not background a server with `&` from the agent shell — the tool kills the
  process group on timeout and a dead port answers with an empty body, which
  reads as a test failure. Every measurement here ran from a self-contained
  script that starts its own server, measures, and exits.

## Files changed

| File | Change |
|------|--------|
| `packages/adapter/src/runtime-bundle.ts` | `withSsrStore` via `server-codegen.js` (one copy of the store); payload store renamed out of the slot namespace |
| `packages/compiler/src/ssr-store.ts` | Request-scope state pinned to `globalThis` so a duplicate module copy shares it |
| `packages/compiler/src/server-codegen.ts` | Re-exports the ssr-store surface |
| `packages/adapter/src/{prod-server,dev-server,platform-handler}.ts` | Read the renamed payload store |
| `packages/adapter/src/dev-server.ts` | Removed the leaked debug `fetch` wrapper; error label; API 500 shape |
| `packages/runtime/src/resource.ts` | Reverted the unproven dedupe attribution |
| `packages/adapter/src/hmr-snippet.test.ts` | Machine-relative perf budget |
| `scripts/test.js` | 300 s e2e startup budget; runs the new concurrency gate |
| `packages/adapter/src/runtime-bundle.test.ts` | New — bundle-shape regression tests |
| `packages/compiler/src/ssr-token-scope.test.ts` | +2 cases (duplicate copy, deduped burst) |
| `tests/ssr-handoff-concurrency-test.mjs` | New — HTTP concurrency gate |
| `tests/vesk-doc-hydration-test.mjs` | Moved from the repo root |
| `test-app/`, `vesk-doc/package.json` + lock | Refreshed CI tarball pins (0.2.44) |

`.probe/` is scratch and is not committed.
