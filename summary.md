# SSR request-scope handoff — status

## Original bug

Concurrent requests to a page using `useFetch` lost their SSR data handoff. The
document rendered without `<script src="/ssr-data.js">`, so the client had
nothing to hydrate from and the page came up empty after load.

Reproduced on `test-app/app/async/page.vsk` (`/async`, which fetches
`/api/posts` during SSR): **1/24 concurrent responses carried the data script
before the fix.**

## Three independent causes, all fixed

### 1. Dev codegen never opened a request scope

`packages/adapter/src/hmr.ts` generated SSR functions that called
`renderFullPage` / `renderPageStream` directly. The production generator
(`packages/adapter/src/ssr-function.ts`) wrapped them in `withSsrStore`, but the
dev generator did not. Without a scope there is no ALS store and no
`__vsk_ssr_token`, so nothing was ever attributed to a request.

`hmr.ts` now imports `withSsrStore` and wraps buffered and streaming rendering
exactly as `ssr-function.ts` does. The two generators must stay in sync — that
divergence is what made the bug invisible in prod-only testing.

### 2. A scope did not own a liveness claim for its lifetime

A request runs `renderPage` (page) → `renderPage` (each nested layout) →
`renderFullPage` (document). Each stage claimed the render token on entry and
released it on exit, so the token was briefly unowned *between* stages. Once
more than ~40 renders were in flight, `pruneSsrDataSlots` saw the unowned
token's slot as abandoned and deleted data the document render still had to
serialize.

`withSsrStore` now claims the store's token on entry and releases it when the
scope settles, so the token is reap-exempt for the whole request. Claims are
refcounted (`liveSlots` is a `Map<string, number>`, not a `Set`) so nested
renders balance instead of clobbering the scope's claim. `renderFullPage`,
`renderPage` and `render` keep their own balanced claims on top.

`resetSsrToken` claims the replacement token, since the previous one is no
longer the current context for anything.

### 3. `renderPageStream` merged from a different token

The stream created its own store even when a scope was already open, so the
tail merge read a slot nothing had written to. It now uses `adoptSsrStore()` —
the ambient store when a scope is open — and runs every `gen.next()` through
`withSsrStoreOf`, so the chunks, the promise tracker and the merge all share one
token.

### 4. Deduped fetches were attributed only to the winning request

`getInflight()` (`globalThis.__vsk_fetch_inflight`) is a process-global dedupe
map. When request B deduped onto request A's in-flight fetch, A's callback
called `setSsrData(key, data, A_token)` and B's slot was never written. B's
component still received the data via `attachSettle`, so the page *looked* fine
in the HTML but B's document had nothing to serialize. The dedupe path now also
attributes the shared result to the deduping render's token.

**This one is not yet verified** — see Open work below.

## Incidental fix

`packages/cli/src/dev-server.ts` had a stray `}` in `renderSSRStream` that broke
the CLI build. The root `npm run typecheck` did not include
`packages/cli/tsconfig.json`, so it shipped unnoticed. Added.

## Verification

- `npx tsx packages/cli/src/build-packages.ts` — clean.
- `tsc --noEmit` for `packages/compiler` and `packages/runtime` — clean.
- Prod concurrency gate (24 simultaneous `/async` requests against
  `test-app/.vesk/e2e`): **PASS 24/24**, was 1/24.
- `packages/compiler/src/ssr-token-scope.test.ts` — 12/12 (written earlier in
  this work; not re-run since causes 2–4 landed).
- `packages/adapter/src/ssr-function.test.ts` — 30/30 (same caveat).

## Open work — do not consider this done

1. **48+ concurrent requests still fail ~6/48.** The signature is stable
   (`distribution=1x42 0x6`, every failure a 4708-byte page missing only the
   `ssr-data.js` script tag, page body otherwise complete). Cause 4 above was
   written on the theory that global inflight dedupe was the cause; it is
   **confirmed to not be the whole story** — the gate still fails identically
   after rebuilding. Next step: the diagnosis that is still needed is whether
   the 6 failures correlate with deduping requests at all, or with something in
   `resolveSsrResources` / the re-render passes. The `render-trace` line in
   `server-render.ts` (gated on `VESK_SSR_TRACE`) shows
   `keys=∅ slot=∅ sink=∅` for exactly the failing renders — the data is absent
   from *both* the slot and the sink at merge time, so the loss happens before
   `renderFullPage`, not in the merge.
2. **Dev path unverified end-to-end.** The direct generated-function probe
   passes (200 + `ssr-data.js?t=…`), but no live `curl` against `vesk dev` has
   been measured. See the measurement hazard below.
3. **Test-app deps are stale.** `node scripts/refresh-testapp-deps.mjs` must be
   re-run before any test-app or HTTP test — it was last run before causes 2–4
   landed. This is a hard user requirement.
4. **Regression tests not yet written** for causes 2, 3 and 4. Per
   `packages/runtime/AGENTS.md` rule 4, this needs
   `node tests/hydration-test.mjs` at the repo root, not just unit tests.
5. `packages/runtime/src/resource.ts` change (cause 4) is unproven and should be
   reverted if the follow-up investigation shows it was not the cause.

## Measurement hazard — read before trusting any HTTP result

Do not background a dev/prod server with `&` from the agent shell. The tool
kills the process group on timeout, taking the server with it, and a dead port
returns an *empty* body rather than an error. Several rounds of "0/24" and
"no data script" results in this session were measured against a killed server
and were pure noise.

Two things that do work:
- One self-contained script that starts the server, measures, and `process.exit`s
  — see `.probe/prod-gate.mjs` (written against `dist`, because `tsx` plus the
  TS path aliases is too slow to keep inside the tool timeout).
- `.probe/build-e2e.mjs` rebuilds `test-app/.vesk/e2e` from current source.
  **The gate is reading a stale bundle unless you run this first** — the prod
  server loads the compiler/runtime out of that directory, not out of
  `packages/*/dist`. Two rounds of "still failing" were this mistake.

## Files changed

| File | Change |
|------|--------|
| `packages/adapter/src/hmr.ts` | Wrap generated request rendering in `withSsrStore` (cause 1) |
| `packages/adapter/src/ssr-function.ts` | Data-nav request scoping + cleanup; keeps token accessor |
| `packages/compiler/src/ssr-store.ts` | Refcounted `liveSlots`, scope-level claim in `withSsrStore`, `adoptSsrStore` (causes 2, 3) |
| `packages/compiler/src/server-render.ts` | Balanced slot claims per stage, `isSsrSlotLive` reaper guard, stream token unification (causes 2, 3) |
| `packages/runtime/src/resource.ts` | Attribute deduped fetch results to the deduping render's token (cause 4, unproven) |
| `packages/cli/src/dev-server.ts` | Stray brace removal; buffered/streamed dev SSR paths |
| `package.json` | Root `typecheck` now includes `packages/cli/tsconfig.json` |
| `packages/compiler/src/ssr-token-scope.test.ts` | New — 12 request-scoping/concurrency tests |
| `test-app/package.json`, `test-app/package-lock.json` | Refreshed dep pins (stale, see Open work 3) |

`.probe/` is scratch and must not be committed. `vesk-doc/` churn is unrelated
and pre-existing — do not stage it.
