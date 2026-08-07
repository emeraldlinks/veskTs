# AGENTS.md — @vesk/runtime module rules

> Module-specific agent rules for working in `/root/vesk/packages/runtime`.
> These **add to** the repo-level `AGENTS.md` at `/root/vesk/AGENTS.md`
> (no-regex-in-compiler, statement-mode-first-class, tests-with-every-job) —
> read and follow both. The "no-regex in the compiler" rule applies to
> `packages/compiler/src`, NOT to runtime modules (e.g. `router-match.ts`
> legitimately builds route `RegExp`s).

## Hard rules

1. **Never import or emit `batch`.** The active runtime (`ripple-runtime.ts`,
   `ripple-blocks.ts`, and both index barrels) has no `batch` export. A
   deprecated, unused `track.ts` module does declare its own `batch`/`Cell`/
   `Effect`/`track`/`effect`/`derived` — treat it as dead code, never import
   it, and don't wire it into a barrel (it would introduce a second, conflicting
   reactivity API). For synchronous multi-write flushes use `flushSync(fn)`
   (alias of `flush_sync`). Do NOT add a `batch` export to the barrels.

2. **Respect the client/server entry split.** Two barrels exist and must stay
   in sync with what they expose:
   - `index-client.ts` — client bundle: hydrators, `bindings`, `reconcile`,
     full client ripple-runtime surface.
   - `index-server.ts` — server bundle: request APIs, ISR, resources; router
     `useParams` aliased as `routerParams`; NO hydrators/bindings/reconcile.
   - The package `exports` map has `"."` AND `"./client"` both resolving to
     `index-client.js`. Do not move server-only code into the client barrel,
     or client-only (DOM-dependent) code into the server barrel.

3. **Keep the client bundle tree-shakable.** Client-only logic that uses
   `document`/`window` must not be imported unconditionally into code paths
   that run on the server. Component helpers guard SSR with
   `typeof document === 'undefined'`. Do not add hard top-level DOM side
   effects to modules shared across entries (e.g. `hmr-client.ts` is an IIFE
   intentionally kept out of the barrels).

4. **Verify every reactivity/hydration change with the root hydration test.**
   After any change to `ripple-runtime.ts`, `ripple-blocks.ts`, `hydrate.ts`,
   `resource.ts`, or `router.ts` hydration paths, run the repo-level
   production hydration check:
   ```bash
   cd /root/vesk && node hydration-test.mjs
   ```
   Unit tests alone (`npx tsx src/<file>.test.ts`) are NOT sufficient for
   reactivity/hydration work. Rebuild `dist/` first.

5. **Never use regex for source-text/syntax analysis in compiler-adjacent
   code.** When adding text-processing helpers to runtime modules, follow the
   tokenizer style used in `md.ts` (character-loop tokenizer, no regex).
   (`router-match.ts`'s pattern `RegExp` is an allowed exception — it is
   runtime route matching, not compiler parsing.)

6. **Verify before documenting.** Every export/signature you add, document,
   or reference must exist in actual source. Mark anything you cannot verify
   `[UNVERIFIED]`. Keep `docs.md`, `llms.txt`, and this file accurate to the
   code.

## Commands

```bash
cd /root/vesk/packages/runtime
npx tsx src/track.test.ts      # single test file (fast, use while iterating)
npx tsx src/hydrate.test.ts
npx tsx src/resource.test.ts
npx tsx src/router.test.ts
npx tsx src/request.test.ts
npx tsx src/form.test.ts
npx tsx src/isr.test.ts
npm run typecheck              # tsc --noEmit
npm run build                  # tsc -p tsconfig.build.json -> dist/
# after editing shared source, also rebuild packages and run root hydration check:
cd /root/vesk && npx tsx packages/cli/src/build-packages.ts && node hydration-test.mjs
```
Do not run the full `scripts/test.js` while iterating; use targeted tests.
At completion, run `node hydration-test.mjs` from the repo root for any
reactivity/hydration change.

## File responsibility map

| File | Responsibility | Test |
|------|----------------|------|
| `ripple-runtime.ts` | signal engine, scheduler, scoped flush, teardown, prop proxies | `track.test.ts` |
| `ripple-blocks.ts` | block lifecycle constructors | `track.test.ts` |
| `ripple-constants.ts` | flags + symbols | — |
| `ripple-utils.ts` | shared helpers | — |
| `track.ts` | **legacy/unused** — own `Cell`/`Effect`/`track`/`effect`/`derived`/`batch`; NOT in barrels; do not use | — |
| `hydrate.ts` | SSR DOM claiming + strategies | `hydrate.test.ts` |
| `context.ts` | createContext/provider-consumer | via `track`/compiler |
| `router.ts` | router factories + nav | `router.test.ts` |
| `router-components.ts` | Link/NavLink/Outlet/hooks/guards | `router.test.ts` |
| `router-match.ts` | route tree matching | `router.test.ts` |
| `resource.ts` | resources, SSR handoff, cache | `resource.test.ts` |
| `request.ts` | server request/response, cookies, hooks, cors, security | `request.test.ts` |
| `isr.ts` | ISR caching + revalidation | `isr.test.ts` |
| `form.ts` | Form/Field + rules | `form.test.ts` |
| `action.ts` | server actions, validation | via `form.test.ts` |
| `md.ts` | tokenizer markdown renderer | `md.test.ts` |
| `seo.ts` | JSON-LD + schemas | `seo.test.ts` |
| `image.ts` | Image component | `image.test.ts` |
| `portal.ts` | Portal | (no dedicated file) |
| `reconcile.ts` | keyed reconcile | (no dedicated file) |
| `bindings.ts` | bindValue/Checked/Group | (no dedicated file) |
| `experiment.ts` | A/B/n | `experiment.test.ts` |
| `suspense.ts` | **no exports** (compiler-phase feature) | — |
| `hmr-client.ts` | dev HMR IIFE (not public API) | — |
| `index-client.ts` | client barrel | — |
| `index-server.ts` | server barrel | — |

## Do / Don't

**Do**
- Do add tests for every change, exercising both expression-mode and
  statement-mode component bodies where component behavior is affected.
- Do write snake_case internal helpers with camelCase/snake public aliases
  per existing convention (`flush_sync`→`flushSync`, `peek_tracked`→`peek`).
- Do use `flushSync` for synchronous flushes and `untrack`/`peek` to avoid
  subscription.
- Do guard SSR/CSR branches with `typeof document === 'undefined'` (helpers)
  or `!!globalThis.__vsk_ssr` (resource module) — pick one per module.
- Do register cleanup with `on_destroy` and respect teardown semantics
  (`teardown`/`old_values`).
- Do keep SSR-resource handoff globals (`__vsk_ssr_data`,
  `__vsk_ssr_promises`, `resolveSsrResources`) consistent on both sides.
- Do mark any change in the public API in `docs.md`, `llms.txt`, and this
  file.

**Don't**
- Don't import `batch` — it does not exist in the active runtime (only in the
  deprecated, unused `track.ts`; treat that as dead code).
- Don't put server-only APIs (request/ISR) into `index-client.ts`, or
  client-only APIs (hydrate/bindings/reconcile) into `index-server.ts`.
- Don't rely on immediate synchronous updates after `set()` — the default
  scheduler is microtask-batched; use `flushSync`.
- Don't mutate tracked state inside `derived`/`track(() => …)` evaluation
  (`set` throws).
- Don't document exports you haven't verified in source; mark unknowns
  `[UNVERIFIED]`.
- Don't claim suspense works: `suspense.ts` has no implementation yet — use
  the `if (loading)` + `createResource` pattern.
- Don't ship reactivity/hydration changes without running
  `node hydration-test.mjs` at the repo root.

