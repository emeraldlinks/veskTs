# @vesk/runtime — Documentation

> Source root: `/root/vesk/packages/runtime/src`
> Package: `@vesk/runtime` (version `0.1.6`), ESM + TypeScript.
> This document is code-grounded — every export and signature was verified by
> reading the actual source. Anything not verifiable is explicitly marked
> `[UNVERIFIED]`.

---

## 1. Purpose / Overview

`@vesk/runtime` is the reactive, signals-based runtime that executes compiled
Vesk code. It provides:

- **Reactives** — the fine-grained signal system (`track` / `get` / `set` /
  `derived` / `untrack` / `peek`) and the reaction machinery that schedules
  re-runs.
- **Blocks** — the unit of reactive DOM/render work (`block`, `effect`,
  `render`, `root`, `branch`, `pre_effect`), with a bidirectional linked list
  tree used for scoped flushing, pausing, and teardown.
- **Hydration** — claiming SSR-issued DOM by scanning `<!--vsk-->` marker
  comments, with several strategies (full, viewport, idle, interaction).
- **Server APIs** — resource handoff, ISR caching, the request abstraction
  (`ServerRequest`/`VeskRequest`/`ServerResponse`/`VeskResponse`), cookies,
  headers, hooks, validation, webhooks, signed cookies, and CORS.
- **Client APIs** — form bindings, reconcile, reactive DOM helpers.
- **Component libraries** — Router (`createRouter` / `createFileRouter`),
  resources (`createResource` / `useFetch`), SEO schema, `Image`, `Md`,
  `Portal`, `Experiment`, `Form` / `Field`, and server actions.

### Dual entry points

The package exposes **two** entry points:

| Subpath                | Resolves to            | Exports |
|------------------------|------------------------|---------|
| `@vesk/runtime` (`.`)  | `dist/index-client.js` | Client bundle (incl. hydrators, bindings, reconcile) |
| `@vesk/runtime/client` | `dist/index-client.js` | same as `.` |
| `@vesk/runtime/server` | `dist/index-server.js` | Server bundle (incl. request + ISR + resources) |

See `package.json` → `exports`. Because `"."` and `"./client"` are identical,
a bare `import '@vesk/runtime'` in SSR code will pull in client-only modules
(hydrators, bindings, reconcile) — use `@vesk/runtime/server` on the server
(see "Common mistakes").

---

## 2. Module layout (file-by-file)

All under `packages/runtime/src/`:

| File | One-line responsibility |
|------|-------------------------|
| `index-client.ts` | Client barrel: re-exports runtime + blocks + hydrate + router + bindings + context + resource + portal + reconcile + seo + image + experiment + form + md + action. |
| `index-server.ts` | Server barrel: re-exports runtime + blocks + context + resource + portal + router (+ `useParams as routerParams`) + request + isr + seo + image + experiment + form + md + action. |
| `ripple-runtime.ts` | Core signal engine: tracked cells, derived values, dependency tracking, scheduler (microtask/sync), scoped flush, teardown, block tree utilities, prop proxies. |
| `ripple-blocks.ts` | Block constructors and lifecycle: `block`, `effect`, `pre_effect`, `render`, `root`, `branch`, `create_try_block`, `pause`/`resume`, `destroy_block`. |
| `ripple-constants.ts` | Bit-flag constants for block/tracked flags and symbols (`ROOT_BLOCK`, `DERIVED`, `UNINITIALIZED`, `NAMESPACE_URI`, suspense symbols …). |
| `ripple-utils.ts` | Tiny helpers (`is_ripple_object`, `define_property`, array/keys shims). |
| `track.ts` | **[Legacy / unused, not in any barrel]** — a separate, older reactivity module with its own `Cell`, `Effect`, `track`, `effect`, `derived`, and a **`batch`** function. It is compiled into `dist/` but is not re-exported and is not imported by the runtime, compiler, or CLI. **Do not import it.** The active runtime is `ripple-runtime.ts` + `ripple-blocks.ts`. |
| `hydrate.ts` | SSR DOM claiming via `<!--vsk-->` markers; walker; full/viewport/idle/interaction strategies; `reactiveProps`. |
| `context.ts` | `createContext` / `Context<T>` provider-consumer with active-component lookup. |
| `router.ts` | Router factory (`createRouter`, `createFileRouter`), route-data fetching, chunk loading, navigation. |
| `router-components.ts` | `Outlet`, `Link`, `NavLink`, router hooks (`useNavigate`/`useParams`/`usePathname`/`useSearchParams`/`useRouter`), `Redirect`/`notFound`, head/scroll handling. |
| `router-match.ts` | Route tree matching: `matchRoute`, `flattenLayoutChain`, `compileRoutePattern`, `buildTreeFromMap`. |
| `resource.ts` | `createResource` / `useFetch` (`.json`/`.text`/`.arrayBuffer`), SSR data handoff, client cache, dedupe, retry/timeout/abort. |
| `request.ts` | Server HTTP abstraction: `ServerRequest`, `VeskRequest`, `ServerResponse`, `VeskResponse`, `cookies`/`headers`/`locals`, `withValidation`, `cors`, hooks, webhooks, signed cookies. |
| `isr.ts` | Incremental Static Regeneration: `isr`, `pageIsr`, `componentIsr`, `revalidatePath`/`revalidateTag`, cache clearing. |
| `form.ts` | `Form` / `Field` components + validation rules (`required`, `email`, `minLength`, `maxLength`, `pattern`, `custom`). |
| `action.ts` | Server actions: `defineAction`, registry lookup, input validation, form-action detection. |
| `md.ts` | Tokenizer-based (no-regex) Markdown → HTML for `<Md>`: GFM tables, task lists, syntax-highlighted code (ts/js/json/css/html/py/go/rust/sql/bash/diff) with lang badge + copy button + optional line numbers, heading anchors, autolinks, hard breaks, safe URL schemes; `renderMarkdown(md, opts?)`, `highlightCode`, `sanitizeUrl`, `MD_BASE_CSS`. |
| `seo.ts` | `JsonLd` + schema helpers (`ArticleSchema`, `ProductSchema`, `FAQPageSchema`, `BreadcrumbListSchema`, `OrganizationSchema`, `LocalBusinessSchema`, `VideoSchema`). |
| `image.ts` | `Image` component (srcset/widths, responsive, placeholder). |
| `portal.ts` | `Portal` component (render into another target). |
| `reconcile.ts` | Keyed list reconciliation between two anchors. |
| `bindings.ts` | Client form bindings: `bindValue`, `bindChecked`, `bindGroup`. |
| `experiment.ts` | A/B/n `Experiment` component (weighted, sticky via cookie). |
| `suspense.ts` | **[No exports]** — placeholder comments only. Suspense needs compiler-level boundary support; use the `if (loading)` + `createResource` pattern. |
| `hmr-client.ts` | Dev HMR WebSocket client (IIFE, no module exports; injected by tooling). |

---

## 3. Core concepts

### 3.1 Signals (reactives)

A **tracked cell** holds a value; a **derived** (computed) is a lazy function
of tracked values. Both are "ripple objects" (they carry a `f: number` flags
field — see `is_ripple_object` in `ripple-utils.ts`).

- `track(v)` — create a cell (or wrap an existing ripple object).
- `derived(fn)` — create a lazy computed.
- `get(t)` — read a value *and register a dependency* while inside a reactive
  context; throws if the read resolves to a pending/rejected suspense value.
- `set(t, v)` — write a cell (no-ops when the value is unchanged) and
  `schedule_update` on its owning block for a later flush.
- `untrack(fn)` — run `fn` without registering dependencies.
- `peek(t)` (alias of `peek_tracked`) — read `.__v` directly without
  dependency registration (does not throw on suspense).
- `flushSync(fn?)` (alias of `flush_sync`) — run `fn` with the scheduler in
  **sync mode** so all queued updates flush immediately.

The scheduler is microtask-based by default (`FLUSH_MICROTASK`), batching
updates; `flush_sync` switches to `FLUSH_SYNC`.

### 3.2 Effects and blocks

An **effect** re-runs whenever its tracked dependencies change. Vesk's
internal term is a **block** — a node in a doubly-linked tree. The compiler
(not user code) emits most blocks; user-facing helpers are auto-imported
when used inside components (`effect`, `derived`, `untrack`, `peek`, `tick`,
`flushSync`, `on_destroy`, `createContext`). `batch` does **not** exist in the
active runtime — never import it (see mistakes). *(A deprecated, unused
`track.ts` module declares its own `batch`; it is not part of the API.)*

- `effect(fn)` — create a reactive effect block.
- `user_effect(fn)` — like `effect` but defers to the component-creation
  queue when the component is not yet mounted (`!component.m`), returning
  `void` in that case.
- `pre_effect(fn)` — an effect that runs before render/update effects in the
  flush (see `flush_updates`: `pre_effects` run first, then `other_blocks`,
  then `effects`).
- `on_destroy(fn)` — register a cleanup callback on the current scope's
  block (`block.tc`).
- `tick()` — `await` a `requestAnimationFrame`.
- `root(fn)` — create a root block with a fresh component context.

### 3.3 Scoped flushing

`schedule_update` marks a block AND all its ancestors with `UPDATE_SOURCE` /
`CONTAINS_UPDATE` and walks up to the root; `flush_updates` then walks the
root block's tree. When `scope_root` is set (the nearest `UPDATE_SOURCE`),
only on-path blocks run — this is **scoped flushing**. If a dependency is
registered that doesn't belong to the current subtree, `disable_scoped_flush`
is set to `true`, falling back to full-root flushing (correctness over
granularity).

### 3.4 Hydration

SSR emits `<!--vsk-->` marker comments; `hydrate` re-runs the component
function with a `HydrateWalker` that, on each `nextElement(tag?)`, advances
to the next marker's `nextElementSibling`, removes text-only whitespace, and
**returns the existing DOM node** so the reactive machinery claims it instead
of recreating it. Strategies:

- `hydrate(container, fn, props?)` — hydrate everything synchronously.
- `hydrateViewport(container, fn, props?, rootMargin?)` — hydrate in-viewport
  first, hold the rest (`<!--vsk-hold-->`), and hydrate off-screen via
  `IntersectionObserver`.
- `hydrateIdle(...)` — hydrate in chunks via `requestIdleCallback`.
- `hydrateOnInteraction(...)` — hydrate on first matching event; returns
  `{ cancel, hydrateNow }`.

`needsHydration(container)` / `hydrationCount(container)` inspect whether
markers remain. `reactiveProps(props)` returns a Proxy that unwraps ripple
objects to their values on property access.

### 3.5 Router

- `createRouter(routes, options)` builds a client router rendering into
  `#root` (or `options.container`). `options.hydrate` ∈ `'full' |
  'viewport' | 'idle' | 'interaction'`; `options.prefetch` defaults true.
- `createFileRouter(routeTree, options)` adds `_hydrateStrategy`, optional
  middleware, and a custom `render`.
- **Offline navigation**: when an SPA navigation fails due to loss of
  connectivity (data fetch or chunk load), the router renders an offline
  experience instead of the not-found page. Customize via
  `options.offline`: a component `(props, registry, walker) => Node | string`
  receiving `{ url, params, retry }`, or a raw HTML string. When omitted, a
  built-in panel with a Retry button is shown; the router listens for the
  browser `online` event and re-navigates automatically to recover.
- **Connectivity boundaries**: route directories may export `offline.vsk`
  (dedicated offline UI, shown while offline) and `network.vsk`
  (state-aware UI). Both compile into the route's client chunk. Props:
  `{ url, params, retry, online, effectiveType, downlink, rtt, saveData }`.
  Precedence: `offline.vsk` → `network.vsk` → router `offline` option →
  nearest `error.vsk` (which receives `offline: true` +
  `networkState`) → built-in default panel. Displayed boundaries re-render
  live on connectivity changes.
- **`getNetworkState()` / `watchNetwork(cb)`**: snapshot of
  `{ online, effectiveType, downlink, rtt, saveData }` (Network Information
  API fields degrade to nulls/`'unknown'` where unsupported) plus a
  subscription returning an unsubscribe function.
- Bridge primitives: `Link`, `NavLink`, `Outlet`, `useNavigate`,
  `useParams`, `usePathname`, `useSearchParams`, `useRouter`.
- Guards: `Redirect`, `redirect(url, status?)`, `permanentRedirect(url)`,
  `NotFoundError`, `notFound()` (thrown during loads causes a 404 response).
- `defineRoute(path, config)` / `buildRouteTree(defs)` build route trees;
  `matchRoute(tree, pathname)` returns `{ matchChain, params }`.
- `ensureChunk(url)` loads a JS chunk (for code-split pages).


### 3.6 Resources

`createResource(fn, key?, into?, options?)` and `useFetch(urlOrFn, options?)`
return a `Resource<T>` (a thenable with `loading`, `error`, `data`,
`refresh()`, `abort()`). On the **server** fetches are deduped by key, tagged
into `__vsk_ssr_promises`, and resolved into `__vsk_ssr_data` via
`setSsrData`; `resolveSsrResources()` is awaited after render to collect the
handoff object. On the **client** the injected SSR data settles the resource
immediately without refetching.

Options in `UseFetchOptions<T>`: `key`, `into` (a tracked cell to write
into), `staleTime` (client cache TTL), `keepPreviousData`, `retry`,
`retryDelay` (GET retries with exponential backoff), `timeout`, `enabled`,
`dedupe`, plus any `RequestInit` (except `body`, which is `unknown`).

### 3.7 Server actions

`defineAction(config)` / `defineAction(id, config)` registers an
`{ input, execute }` action and returns `{ id, url: '/_vesk/action/<id>', input, execute }`.
`getAction(id)` reads the registry; `validateActionInput(def, input)` runs the
input schema; `issuesToFieldMap(issues)` maps field issues to a
`Record<field, message>`; `isFormAction(v)` detects action objects.
Forms posted to a server action are validated on the server and re-rendered
with field errors in `<Field>`.

### 3.8 Forms

`Form` / `Field` render SSR HTML with `novalidate` forms and error slots
(`[data-vsk-field]` / `[data-vsk-error]`), then bind client submits
(`vsk-submitting`, `vsk-success`, `vsk-error`, `vsk-loading` custom events).
Validation rules: `required`, `email`, `minLength`, `maxLength`, `pattern`,
`custom` — each returns `{ validate, message }`.

### 3.9 ISR

`isr(key, fetcher, { tags, revalidate })`, `pageIsr(path, renderFn, opts)`
(caches HTML + headers), and `componentIsr(key, renderFn, opts)` (caches a
component snippet). `revalidate <= 0` disables caching. Stale entries are
served while revalidating in the background. `revalidatePath` /
`revalidateTag` / `clearIsrCache` / `revalidateComponent` invalidate the
in-memory caches. `isrConfigToRevalidate(config)` extracts the TTL from a
number or `{ revalidate }` config.

### 3.10 SEO

`JsonLd({ schema | children, key? })` renders a `<script type="application/ld+json">`
tag (server string or client head append). Schema helpers return plain schema
objects: `ArticleSchema`, `ProductSchema`, `FAQPageSchema`,
`BreadcrumbListSchema`, `OrganizationSchema`, `LocalBusinessSchema`,
`VideoSchema`.


---

## 4. Usage patterns (from the source)

### Reactives / effects

```ts
import { track, get, set, derived, untrack, peek, flushSync, on_destroy } from '@vesk/runtime';

const count = track(0);
const doubled = derived(() => get(count) * 2);

set(count, 1);
console.log(get(count), get(doubled)); // 1 2

flushSync(() => set(count, 2));
console.log(peek(count)); // 2 (no dependency tracked)

untrack(() => console.log(get(count))); // read without subscribing
on_destroy(() => console.log('cleanup'));
```

Inside `.vsk` components the compiler auto-imports these, and `track(0)` maps
to the `const &[count] = track(0)` TrackDecl syntax (`&[count, rawCell]` for
the raw cell too).

### Resource (SSR handoff)

```ts
import { createResource, resolveSsrResources } from '@vesk/runtime/server';

// inside a component:
const &[post] = createResource(() => fetch(`/api/posts/${slug}`).then(r => r.json()));

// server bootstrap, after rendering:
const ssrData = await resolveSsrResources(); // { [key]: data, ... }
```

The client receives `ssrData` (injected as `__vsk_ssr_data`) and
`createResource` settles instantly from it.

### Router

```ts
import { createRouter, Link, usePathname, useParams } from '@vesk/runtime';

const router = createRouter({
  '/':          () => import('./pages/home'),
  '/blog/:slug': () => import('./pages/post'),
}, { hydrate: 'viewport', prefetch: true });

router.start();
```

### Form + action

```ts
import { Form, Field, required, email } from '@vesk/runtime';
import { defineAction } from '@vesk/runtime/server';

// action defined server-side
const action = defineAction({ input: { email: [required(), email()] }, execute: async (input, ctx) => { /* ... */ } });

// component
function Contact() {
  return (
    <Form action={action}>
      <Field name="email" rules={[required(), email()]} />
      <button type="submit">Send</button>
    </Form>
  );
}
```

### Server response / cookies

```ts
import { ServerResponse, cookies, withValidation } from '@vesk/runtime/server';

async function handle(request: Request) {
  if (request.method === 'POST') {
    const parsed = await withValidation(request, schema);
    if (parsed instanceof Response) return parsed; // 400 validation error
    return ServerResponse.json({ ok: true });
  }
  return cookies().get('session') ? ServerResponse.redirect('/app') : new ServerResponse('public');
}
```

---

## 5. Public API by area

> Full signatures are in `llms.txt`. This section groups the *public* exports
> as re-exported by `index-client.ts` / `index-server.ts`.

### Reactives & lifecycle — both entries
`track`, `get`, `set`, `untrack`, `peek` (`peek_tracked`), `derived`,
`flushSync` (`flush_sync`), `tick`, `on_destroy`, `active_block`,
`set_active_block`, `set_active_component`, `create_component_ctx`,
`push_component`, `pop_component`, `with_block`, `with_scope`, `scope`,
`safe_scope`.

*Client-only extras:* `schedule_update`, `queue_microtask`,
`is_mutating_allowed`, `tracking`, `teardown`, `run_block`, `run_teardown`,
`set_tracking`, `set_active_reaction`, `is_block_dirty`,
`destroy_non_branch_children`, `disable_scoped_flush`.

### Blocks — both entries
`effect`, `user_effect`, `block`, `branch`, `root`, `render`, `pre_effect`,
`destroy_block`, `destroy_block_children`, `pause_block`, `resume_block`,
`is_destroyed`, `unlink_block`, `create_try_block`,
`boundary_fn_running_block`.

### Hydration — client only
`hydrate`, `hydrateViewport`, `hydrateIdle`, `hydrateOnInteraction`,
`needsHydration`, `hydrationCount`, `createHydrateWalker`,
`collectVskMarkers`, `reactiveProps`.

### Router — both entries
`createRouter`, `createFileRouter`, `Outlet`, `Link`, `NavLink`,
`useNavigate`, `usePathname`, `useSearchParams`, `useRouter`,
`buildRouteTree`, `defineRoute`, `Redirect`, `redirect`, `permanentRedirect`,
`notFound`, `NotFoundError`, `ensureChunk`, `matchRoute`, `useParams`
(**client** = router params; **server** exports it aliased as `routerParams`).

### Context — both entries
`createContext`, `Context`, `getActiveComponent`, `setActiveComponent`.

### Resources — both entries
`createResource`, `setSsrData`, `clearSsrData`, `resolveSsrResources`,
`useFetch` (+ `.json` / `.text` / `.arrayBuffer`).

### Server-only (index-server.ts)
Request: `cookies`, `headers`, `locals`, `ServerRequest`, `ServerResponse`,
`VeskRequest`, `VeskResponse`, `withValidation`, `useBody`, `useParams`
(request), `useRequest`, `cors`, `defineHook`, `removeHook`, `runHooks`,
`webhook`, `signCookie`, `unsignCookie`, `setSignedCookie`,
`readSignedCookie`, `applyRequestSecurity`.
ISR: `isr`, `revalidatePath`, `revalidateTag`, `clearIsrCache`, `pageIsr`,
`componentIsr`, `revalidateComponent`, `isrConfigToRevalidate`.

### Client-only bindings / reconcile
`bindValue`, `bindChecked`, `bindGroup` (bindings), `reconcile` (reconcile).

### Components & helpers — both entries
`Portal`, `JsonLd` + 7 schema helpers, `Image`, `Experiment`, `Form`,
`Field`, `required`, `email`, `minLength`, `maxLength`, `pattern`, `custom`,
`Md`, `defineAction`, `getAction`, `clearActions`, `validateActionInput`,
`issuesToFieldMap`, `isFormAction`.



---

## 6. Common mistakes + fixes

| Mistake | Fix |
|---------|-----|
| `import { batch } from '@vesk/runtime'` | **`batch` does not exist in the active runtime.** The barrels (`index-client` / `index-server`) and the active reactivity modules (`ripple-runtime`, `ripple-blocks`) export no `batch` — the repo rule is to never import/emit it. Wrap work in `flushSync(() => { … })` to flush synchronously. *(Caveat: there is a legacy, deprecated `track.ts` module that declares its own `batch`, but it is not part of the public API, is not wired into any barrel, and must not be used.)* |
| Importing `'@vesk/runtime'` (the `.` entry) in server code | It resolves to the **client** bundle. Use `@vesk/runtime/server` for request/ISR APIs. Use `@vesk/runtime` (or `/client`) for hydration in the browser. |
| Treating the returned `track(0)` value as the scalar | In `.vsk` the compiler destructures via `const &[count] = track(0)` — `count` is the reactive handle, and `&[count, rawCell]` also gives the raw cell. The handle must go through `get()`/`set()`. |
| Reading a value with `track(...)` directly | Use `get(cell)` to subscribe or `peek(cell)` to read without subscribing. |
| Expecting event handler attributes (`on*`) in SSR HTML | Event handlers are **excluded from SSR output entirely**. They exist only after hydration/on the client. |
| Assuming updates flush synchronously after `set()` | The default scheduler is **microtask-batched**. Use `flushSync(fn)` for immediate synchronous work. |
| Mutating state inside a `derived`/`track(() => …)` | `set` throws: *"Assignments or updates to tracked values are not allowed during computed 'track(() => …)' evaluation"* (`is_mutating_allowed` is false during derived evaluation). |
| Writing to a cell while `teardown` is running | Writes are latched through `old_values`; don't rely on them being visible. |
| Importing cross-module internals by path in user code | Prefer the barrel exports; internal paths (`@vesk/runtime/src/*`) are valid but not part of the public API contract. |
| Using `useParams` on the server and expecting router params | On the server `useParams` (from `request.ts`) is the *request* params; router params are exported as `routerParams`. |
| Assuming suspense works out of the box | `suspense.ts` exports nothing; coordinated Suspense boundaries require compiler support. Use `if (loading)` + `createResource`. |
| Calling `effect()` outside an active context | `user_effect` throws *"effect() must be called within an active context…"* when `active_block === null`. |
| SSR output for `Portal`/`Md`/`Image`/`JsonLd` | These return HTML strings on the server (guarded by `typeof document === 'undefined'`) and claim DOM on hydration. |
| Mutating a reactive during derived get | `get`/`set` proxies run with `is_mutating_allowed = false`; guard against writes from custom getters. |

---

## 7. How to run the tests

All tests are self-contained scripts (custom `describe`/`it`/`expect`
harness, no external test runner) run with `tsx` from the **package root**:

```bash
cd /root/vesk/packages/runtime
npx tsx src/track.test.ts      # reactivity (14)
npx tsx src/hydrate.test.ts    # hydration (13)
npx tsx src/router.test.ts     # router matching/nav (32)
npx tsx src/resource.test.ts   # resources (27)
npx tsx src/request.test.ts    # request/server (90)
npx tsx src/form.test.ts       # forms (34)
npx tsx src/isr.test.ts        # ISR (14)
npx tsx src/seo.test.ts        # SEO (14)
npx tsx src/image.test.ts      # Image (12)
npx tsx src/md.test.ts         # Markdown renderer (35)
npx tsx src/experiment.test.ts # Experiment (10)
```

Test files present: `track`, `hydrate`, `router`, `resource`, `request`,
`form`, `isr`, `seo`, `image`, `md`, `experiment` (11 files, ~295 cases).
Action APIs are exercised through `form.test.ts`; there is no standalone
`action.test.ts` [verified by filename inventory].

Type-check the package:

```bash
cd /root/vesk/packages/runtime && npx tsc --noEmit   # npm run typecheck
```

Build (`tsc -p tsconfig.build.json`, outputs `dist/`):

```bash
cd /root/vesk/packages/runtime && npm run build
```

> Note: internal `@vesk/runtime/src/*` imports resolve through the package's
> own `exports` map (`./src/*` → `dist/*.js`), so keep `dist/` fresh with
> `npm run build` (or `npx tsx packages/cli/src/build-packages.ts` at repo
> root) before running dependent code/tests.
