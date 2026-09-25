---
name: nuxt-to-vesk
description: >-
  Convert a Nuxt 4 (or Nuxt 3) application to Vesk (.vsk) with absolute
  precision and zero hallucinations. Use when a task involves migrating
  porting translating or rewriting Nuxt/Vue code — .vue single-file
  components and <script setup> (ref/reactive/computed/watch/lifecycle),
  template directives (v-if/v-for/v-model/v-bind/v-on/:prop/@event),
  Nuxt page/layout/composable conventions (app.vue, pages/, layouts/,
  error.vue, app.config.ts, definePageMeta, defineNuxtRouteMiddleware,
  defineNuxtPlugin), auto-imported composables (useState, useFetch,
  useAsyncData, useLazyFetch, useLazyAsyncData, useCookie, useRoute,
  useRouter, useHead, useSeoMeta, useError, navigateTo), Nitro server code
  (server/api/**, server/routes/**, server/middleware, defineEventHandler,
  getQuery, readBody), or NuxtLink/NuxtPage/NuxtLayout/ClientOnly — into
  the Vesk compiler-first framework. Never invents Vesk APIs; every mapped
  construct has a documented Vesk equivalent in the official Vesk skill:
  read skills/vesk/SKILL.md first for the canonical Vesk API reference.
  Prefers statement mode. Validate every conversion with `npx vesk typecheck`
  and the production hydration suite before declaring done.
---

# Nuxt → Vesk Conversion Skill

This skill turns Nuxt 4 / Nuxt 3 / plain Vue SFC code into correct, idiomatic
Vesk code. It is built on the **canonical Vesk API reference** — always load
the `vesk` skill first and treat every mapping below as a *decision rule*, not
a substitute for reading `skills/vesk/SKILL.md`.

Nuxt 4 layout referenced here: `app/` srcDir with `app.vue`, `pages/`,
`layouts/`, `components/`, `composables/`, `utils/`, `plugins/`,
`middleware/`, `app.config.ts`, `error.vue`, plus root-level `server/`
(Nitro), `public/`, and `nuxt.config.ts`. Nuxt 3 (no `app/` wrapper) maps
identically — just prefix `app/` paths below with nothing (Nuxt 3 keeps its
files at the root).

## Ground rules (read first, they prevent almost every hallucination)

1. **Vesk has no `<template>`, no directives, and no `<script setup>`.** A
   `.vsk` component is a plain TypeScript function body that emits real DOM.
   Every Vue template directive (`v-if`, `v-for`, `v-model`, `v-bind`, `v-on`)
   becomes a plain control-flow statement or native attribute/event. Do not
   emit `defineComponent`, `defineProps`, `defineEmits`, `defineExpose`,
   hooks (`useState`), or any `import from 'vue'` — there is no Vue runtime to
   host them.
2. **Know both body modes.** Expression mode (`return <jsx>`) maps 1:1 from a
   small pure component with a single root. Statement mode (bare JSX next to
   `if`/`for`/`switch`/`try`, guard-clause early returns) is Vesk's native,
   preferred style. **Convert every page, layout, and interactive component to
   statement mode; only tiny presentational components may stay in expression
   mode.** Never produce a conversion that uses one mode where both are
   exercised by the feature (see AGENTS.md: statement mode is first-class).
3. **Vue refs have no `.value` in Vesk.** `const count = ref(0)` becomes
   `let &[count] = track(0)`; you read `count`, write `count++` or
   `countCell.set(1)`. `computed` → `derived`, `watch`/`watchEffect` →
   `effect`, `nextTick` → `tick()`. Template text interpolation
   `{{ count }}` becomes `{count}`.
4. **Auto-imported identifiers are free.** The compiler (`ir-generator.ts`
   `autoImportable`) injects `import { … } from '@vesk/runtime'` for any of
   these when used as a call target or JSX tag inside a component body:
   `effect`, `derived`, `untrack`, `peek`, `tick`, `flushSync`, `on_destroy`,
   `createContext`, `useFetch`, `createResource`, `useRouter`, `useParams`,
   `usePathname`, `useSearchParams`, `useNavigate`, `defineAction`, `Form`/
   `Field`, validators (`required`, `email`, `minLength`, `maxLength`,
   `pattern`, `custom`), `Link`, `NavLink`, `Outlet`, `Redirect`, `redirect`,
`permanentRedirect`, `notFound`, `NotFoundError`, `Image`, `JsonLd`, SEO
    schema helpers (`ArticleSchema`…`VideoSchema`), `Portal`, `Experiment`,
    `LoadingIndicator`, `useLoadingIndicator`, `getAction`,
    `validateActionInput`, `issuesToFieldMap`, `isFormAction`, `Show`, `For`,
    `Switch`, `Match`. **Not auto-imported** — you must `import { … } from
    '@vesk/runtime'` explicitly (every `.vsk` example here includes the import
    it needs): `track`, `get`, `set`, `Md`,
    `bindValue`/`bindChecked`/`bindGroup`, `pre_effect`. Router extras come
    from `@vesk/runtime/router`; server-only helpers (`VeskRequest`,
    `VeskResponse`, `cookies()`, `headers()`, `locals()`, `useBody`,
    `withValidation`) from `@vesk/runtime/server`. `<Head>` is special-cased
    by the compiler, not an import.
5. **Never emit `batch`.** It does not exist in the runtime. For a synchronous
   multi-cell write use `flushSync(fn)`.
6. **No `<slot/>`, no `defineProps`.** Default slot content flows through
   `{props.children}`; named slots become explicit props; scoped slots (slots
   that receive data, e.g. `<template #header="{ item }">`) become render
   props — pass the data down and let the parent compose the child with
   regular props instead.
7. **Route params are not on a reactive `$route`.** Nuxt pages get params via
   `useRoute().params`; Vesk pages receive them as `props.params` (a page
   component's first, required prop). Query strings via `useSearchParams()`
   (returns `[URLSearchParams, setter]`), not `useRoute().query`.
8. **Client-only code has a home.** `window`/`document`/`localStorage`
   references go inside a `client` island, an `effect()` body (client-only),
   or a `{#client}` block — never at the top level of a server-rendered body.
   This replaces Nuxt's `ClientOnly`/`<ClientOnly>` and `.client.vue`
   suffixes.
9. **Everything you emit must exist in the reference.** If you are unsure an
   API exists, stop and read `skills/vesk/SKILL.md` or the source in the repo
   instead of guessing. When the source Nuxt app uses an obscure Vue plugin,
   map to the closest canonical Vesk primitive and say so explicitly in the
   conversion notes — do not invent a Vesk shim.
10. **Validation is part of the job, not an afterthought.** After a conversion
    run `npx vesk typecheck`; for any reactivity/hydration work also run the
    production hydration suite. Fix what they surface. A "done" conversion is
    one that typechecks and hydrates in both body modes where applicable.

## Conversion workflow

Follow this exact order. It detects collisions early and prevents rework.

### Step 0 — Reconnaissance (never skip)

1. **Inventory** every `.vue`, `.ts`, `.js`, and `server/` file and classify:
   - SFC component (stateful / stateless / presentational / `.client.vue` /
     `.server.vue`)
   - Page (`pages/`), layout (`layouts/`), App root (`app.vue`),
     `error.vue`, `app.config.ts`
   - Composable (`composables/`), util (`utils/`), plugin (`plugins/`)
   - Route middleware (`middleware/`), Nitro server route (`server/api/`,
     `server/routes/`), `server/middleware/`, `server/plugins/`,
     `server/utils/`
2. **Map routing.** Nuxt file routing maps 1:1 onto Vesk's `app/` directory:
   every `index.vue` → `page.vsk`, dynamic `[id].vue` → `[id]/page.vsk`,
   catch-all `[...slug].vue` → `[...path]/page.vsk`, route group
   `(group)/` → `(group)/`, nested page + `<NuxtPage/>` → nested directory
   layouts. Note every layout name and every `definePageMeta` hook.
3. **Map data fetching.** Classify each source into one of Vesk's channels:
   (a) async page component awaiting `useFetch`, (b) `useFetch` with `key` +
   `into` for client cells, (c) `useAsyncData`/`useLazyFetch` → `useFetch`
   /`createResource`, (d) `useState` shared state → module-scope `track`
   cells, (e) $fetch in event handlers → native `fetch` or `defineAction`.
4. **Map server code.** Nitro `server/api/foo.ts` → `app/api/foo/route.ts`
   with `export async function GET(req: VeskRequest)`; `server/api/foo.get.ts`
   suffix methods → the matching `VeskRequest.method` branch or separate
   exported `GET`/`POST`/… handlers; `server/middleware/` → Vesk
   `middleware.ts` (onion — **always `return await next()`**).
5. **Produce a conversion manifest** — a table of source file → target file →
   key transformations — and show it before writing any code. This makes
   every mapping auditable and reduces drift.

### Step 1 — Scaffold

```sh
npx create-vesk@latest app-name
cd app-name
npm install
```

Then lay out `app/` to mirror the Nuxt app. If the Nuxt project uses Nuxt 4's
`app/` srcDir, copy it in and move files 1:1 (see Step 3).

### Step 2 — Convert shared (non-UI) code first

Modules with no SFC template — `utils/`, `types`/`models`, data-access layers,
`server/utils/`, `shared/`, Pinia/Zustand stores, pure `composables/` — convert
before pages. This makes components mechanical.

| Nuxt / Vue | Vesk | Notes |
| --- | --- | --- |
| `export const useThing = () => …` top-level composable | module-scope functions + `track` cells or plain TS module | Nuxt auto-imports top-level `composables/`; Vesk modules are imported explicitly (or via `@vesk/runtime` where resident). No hooks rules. |
| Pinia store (`defineStore`) | module-scope `track` cells + `derived` + exported action functions | e.g. `export const &[count, countCell] = track(0)` at module scope; import the cells where needed. Prefer explicit data flow over global stores. |
| `useAuth()` returning `{ user, login, logout }` | module-scope cells + functions; or `createContext` when truly per-request | Browser-API-only composables (e.g. `useLocalStorage`) become `effect`-wrapped cells or a `client` island. |
| `server/utils/` helpers | plain TS functions on the server side | Nitro `defineUse`/auto-imports don't exist; import explicitly. |
| `shared/` types between client and server | local `types.ts` or `@vesk/types` | `.vsk` is a TS superset; type-only imports pass through fine. |

### Step 3 — Convert SFC templates to the body modes

Decompose each `.vue` `<template>` by structure. The parser accepts bare JSX
statements, `if`/`for`/`while`/`switch`/`try` with bare-JSX bodies, guard
clauses, and `for … } empty {` for the zero-items case. Note: **Vesk's
conditional block is a plain `if` statement — `{#if}` is not part of the
grammar** (only `{#server}`/`{#client}` are special blocks). Do not emit
`{#if …}{/if}`. Example of the Vue `{{ }}` → `{}` mapping and directives:

```html
<script setup>
const count = ref(0);
const show = ref(true);
const items = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
const onSubmit = () => { /* … */ };
</script>

<template>
  <p>{{ count }}</p>
  <p v-if="show">shown</p>
  <ul>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
  <input v-model="name" />
  <button :disabled="count > 10" @click.prevent="onSubmit">Go</button>
</template>
```

```vsk
import { bindValue, track } from '@vesk/runtime'

component Widget() {
	let &[count] = track(0)
	const &[show] = track(true)
	let &[name, nameCell] = track('')
	const items = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
	const onSubmit = () => { /* … */ }
	<p>{count}</p>
	if (show) {
		<p>shown</p>
	}
	<ul>
		for (const item of items; key item.id) {
			<li>{item.name}</li>
		}
	</ul>
	<input bindValue={nameCell} />
	<button disabled={count > 10} onClick={onSubmit}>Go</button>
}
```

(The `bindValue` prop takes the *cell*, never the unwrapped value.)

Here is the full directive conversion table:

| Vue template construct | Vesk |
| --- | --- |
| `{{ expr }}` text interpolation | `{expr}` export container |
| `v-if` / `v-else-if` / `v-else` | `if (c1) {…}` `else if (c2) {…}` `else {…}` |
| `v-show` | `if` (no `display: none` attr-flicking in Vesk) — or keep the element and toggle a `class` |
| `v-for="item in items"` + `:key` | `for (const item of items; key item.id) {…} empty {…}` — the `empty` block is Vesk's `v-for` empty-state |
| `v-model="x"` | `bindValue={xCell}` on inputs; `bindChecked={xCell}` on checkboxes/radios; `bindGroup` for groups |
| `v-bind:prop` / `:prop` | `prop={value}` (plain JSX props) |
| `v-bind="obj"` spread | `{...obj}` JSX spread |
| `v-on:click` / `@click` | `onClick={handler}` — event-handler attrs are excluded from SSR HTML entirely |
| `.prevent` / `.stop` modifiers | explicit `e.preventDefault()` / `e.stopPropagation()` in the handler |
| class: `:class="{ active: on, 'is-off': !on }"` | `class={[(on && 'active'), (!on && 'is-off')].filter(Boolean).join(' ') || undefined}` — or a small `cls()` helper; never `className` |
| `style="{ color: c }"` | `style={{ color: c }}` (JSX object) |
| `<slot/>` default | `{props.children}` |
| `<slot name="header" />` | an explicit prop, e.g. `{props.header}`; parent passes `header={<X/>}` |
| scoped slot `<template #header="{ item }">` | render prop: give the child a `renderHeader` prop or pass the composed component as a JSX value |
| `<template>` block / fragment | `<>…</>` |
| attribute `:key` (non-`v-for`) | ignore — Vesk keys list items inside `for` only |
| `v-html="html"` | trusted-HTML warts are a security smell — server-sanitize, or use `{html}` only when it is already-safe markup; flag it |

### Step 4 — `<script setup>` reactivity and lifecycle

| Vue API | Vesk |
| --- | --- |
| `ref(x)` / `const x = ref(0)` | `let &[x] = track(0)` (module scope for shared store), or local inside component |
| `reactive({ a })` | object stored in one `track` cell, e.g. `let &[state] = track({ a: 1 })`; read `state.a`, write `stateCell.set({ ...state, a: 2 })` |
| `shallowRef` / `shallowReactive` | `track` cells don't deep-proxy — shallow semantics are the default |
| `computed(() => …)` | `let &[derived] = derived(() => …)` |
| `watch(fn, cb)` | `effect(() => { if (fn()) cb() })` — note effect re-runs the whole body on any tracked dep change; for coarse watches that is usually enough. Use `untrack`/`peek` to exclude reads |
| `watch(fn, cb, { immediate })` | `effect(fn+cb)` runs once immediately by default |
| `watchEffect(fn)` | `effect(() => fn())` |
| `onMounted(fn)` | `effect(() => fn())` — effect bodies run client-side once (no tracked deps → static body) |
| `onUnmounted(fn)` | `effect(() => { …; return () => fn() })` cleanup return, or `on_destroy(fn)` |
| `nextTick(fn)` | `tick().then(fn)` / `await tick()` |
| `provide` / `inject` | `createContext` (default value) — from `@vesk/runtime` |
| `defineModel` | a `track` cell plus `bindValue={cell}` sharing |
| `defineProps({…})` | plain TS parameter: `component Foo(props: { title: string })` |
| `defineEmits` | props that are callbacks: `onSave: (v) => void`; parent passes `onSave={(v) => …}` |
| `useSlots()` | `props.children` / explicit props (see ground rule 6) |
| `onXxx` from `@vueuse` (e.g. `onClickOutside`) | implement from `effect` + DOM events inside a `client` island, or map to a canonical `Portal`/`Experiment` where relevant |
| `H().mount('#app')` / root mount | n/a — framework owns mounting via `app/page.vsk` |
| `defineExpose` / template refs | ref prop: `const &[_, elCell] = track<HtmlElement\|null>(null)` + `<div ref={(el) => elCell.set(el)} />` |
| `onServerPrefetch` | async page component — top-level `await useFetch` |

### Step 5 — Nuxt auto-imported composables and macros

In Nuxt these are free in every file. In Vesk the resident ones are free in
component bodies; the rest import explicitly. Convert:

| Nuxt | Vesk | Notes |
| --- | --- | --- |
| `useState('key', () => init)` | module-scope `let &[state] = track(init)` and import it | shared state travels in the server payload; `into` where a fetch writes it |
| `useFetch(url, opts)` | `useFetch(url, { … })` (same name, auto-imported) | see Step 9 for the full option/return mapping |
| `useAsyncData(key, () => $fetch(url))` | `useFetch(url, { key })` or `createResource(fn, init)` | `await` at top level of an async page component for SSR payload behavior |
| `useLazyFetch` / `useLazyAsyncData` | `useFetch` with `into` + read `loading` separately; or gate `{loading && …}` — non-blocking | `status: 'pending'` → `loading`; `status: 'error'` → `error` |
| `$fetch(url)` (ofetch) | native `fetch(url)`; inside a component prefer `useFetch` | `$fetch` `query:` auto-encoding → URLSearchParams; baseURL → full URL |
| `useCookie('name')` | `cookies()` (CookieStore → `get`/`getAll`, from `@vesk/runtime/server`) or `VeskResponse.setCookie`; client reads via effects | server-set cookie → `VeskResponse.setCookie(name, value, opts)` (httpOnly+secure default) |
| `useRoute()` `.params` | page `props.params` | destructure: `const { slug } = props.params` |
| `useRoute()` `.query` | `const [params] = useSearchParams()` | read `.get('q')` |
| `useRouter()` `.push/.replace/.back` | `useRouter()` → `{ push, replace, back }` (auto-imported) | takes string hrefs |
| `navigateTo(url, { replace })` | `useNavigate()(url, { replace })` or `redirect(url, 307)` on the server | server redirect must go through `VeskResponse.redirect`/`redirect()` |
| `useHead` / `useServerSeoMeta` | `<Head>…</Head>` in the root layout or page body | `<Head>` understands `<title>`, `<meta>`, `<link>`, `<script>`, `<style>`, `<html>`/`<body>` attrs |
| `useSeoMeta({ title: html, ogTitle: … })` | `JsonLd` + `meta` tags inside `<Head>` — plus SEO schema helpers from the runtime | no Vue reactive head extension |
| `useError()` | the nearest `error.vsk` receives `{ error, retry, params, statusCode, stack, url }`; a page that needs to fail calls `throw new NotFoundError()` | see Step 10 |
| `showError({ statusCode, message })` / `createError` | throw `NotFoundError`/`Error` — the status flows to `error.vsk` | Nitro `createError` → `HttpError` (has `status`) or `NotFoundError` |
| `clearError()` | n/a — clear by re-render / navigate away | |
| `useAppConfig()` | module-scope `track` cells in any TS module, or `createContext` — there is no `app.config` analog | flag it in the manifest |
| `useRuntimeConfig()` | `process.env` on the server (config/scripts); prefixes decide what ever reaches the client | never leak secrets to the client bundle |
| `useNuxtApp()` / `useRequestEvent()` | `useRequest()`/`useBody()`/`cookies()`/`locals()`/`withValidation()` from `@vesk/runtime/server`; client IP via `req.ip` (needs `trustProxy`) | request-context helpers, not ambient globals |
| `useHydration()` | n/a — hydration is automatic per page | |
| `useLoadingIndicator()` | `LoadingIndicator` component (run-scoped progress) | `<LoadingIndicator/>` wraps triggers; not a global bar |
| `refreshNuxtData(key)` / `clearNuxtData(key)` | `mutate(key, value)` from `@vesk/runtime/src/resource` for cache control | |
| `usePreviewMode()` | flag as "not covered" unless the app genuinely needs it | |
| `useRequestFetch()` | n/a — `useFetch` has no per-request cookie forwarding beyond ambient server fetch | |
| `definePageMeta({ … })` | per-key mapping — see Step 8 | |
| `defineNuxtRouteMiddleware(name)` | [`router.beforeEach` guard in client] or `middleware.ts` for the server side | see Step 11 |
| `defineNuxtPlugin(nuxtApp => …)` | `_events.ts` (`onStart`, `onStop`) in the route directory | see Step 12 |
| `defineNuxtConfig` | `vesk.config.ts` `defineConfig` | see Step 13 |
| `useRoute().name` / `params` in middleware | guards receive params via closure; server middleware via `ctx.request.params` | |

### Step 6 — Pages and routing

Nuxt `app/pages/` maps 1:1 to Vesk route directories. A Vesk page is a file
named `page.vsk` whose default export is the page component; it receives
`props.params` with the dynamic segments.

| Nuxt file | Vesk file | Notes |
| --- | --- | --- |
| `app.vue` (root) | `app/layout.vsk` (root layout) | shell: `<Head>`, nav, `{props.children}`. Nuxt's `<NuxtLayout><NuxtPage/></NuxtLayout>` disappears — Vesk nests layouts by directory. |
| `app/pages/index.vue` | `app/page.vsk` | route `/` |
| `app/pages/about.vue` | `app/about/page.vsk` | |
| `app/pages/docs/[slug].vue` | `app/docs/[slug]/page.vsk` | `const { slug } = props.params` |
| `app/pages/[...slug].vue` | `app/[...path]/page.vsk` | `props.params.path` is the catch-all value |
| `app/pages/posts/[[id]].vue` (optional segment) | **flagged**: Vesk has no optional single segment — split into `app/posts/[id]/page.vsk` + `app/posts/page.vsk`, or route both via `app/posts/[...path]/page.vsk` | decision, flag in manifest |
| `app/pages/(marketing)/home.vue` (route group) | `app/(marketing)/home/page.vsk` | group contributes nothing to the URL |
| `app/pages/parent.vue` + `app/pages/parent/child.vue` (`<NuxtPage/>`) | `app/parent/page.vsk` + `app/parent/child.lsk` → actually: nested routes become a nested directory — `app/parent/page.vsk` renders shell, `app/parent/` child via its own directory and layout | if the source uses `<NuxtPage/>` for a param-driven child, use `[child]/page.vsk` under a layout directory |
| `app/pages/foo.client.vue` | `app/foo/page.vsk` whose client-only parts live in a `client` island component or `{#client}` blocks | there are no per-file page suffixes — the island-in-page pattern replaces them |
| `app/pages/foo.server.vue` | `app/foo/page.vsk` (server-rendered by default; per-component `client` islands carve the interactive parts) | |
| `app/…/foo.vue` component with `<ClientOnly>` inside | wrap the client part in a `client` island component or `{#client}` block |

Route groups still carry their own `layout.vsk` (see Step 7). For a catalog of
Vesk route specials — `loading.vsk`, `error.vsk`, `not-found.vsk`,
`offline.vsk`, `network.vsk`, `middleware.ts`, `_events.ts` — read the
canonical skill's routing/SSR sections; only the page file itself (`page.vsk`)
exists for every Nuxt page.

### Step 7 — Layouts and `app.vue`

Nuxt has a single `layouts/default.vue` (or named layouts chosen by
`definePageMeta({ layout })`) wrapped by `app.vue`. Vesk has **per-directory
`layout.vsk`** and the root `app/layout.vsk`. The hierarchy is: the page's own
directory layout, then each ancestor directory's layout, then the root
`app/layout.vsk`.

| Nuxt | Vesk |
| --- | --- |
| `app.vue` (head, fonts, shell) | `app/layout.vsk` — `<Head>` lives here or in the page |
| `layouts/default.vue` | `app/layout.vsk` (root shell) |
| `layouts/plain.vue`, chosen via `definePageMeta({ layout: 'plain' })` | put the page under a directory named `plain` and give **that directory** a `layout.vsk`, or restructure with route groups; `layout: false` → the page has no directory layout |
| nested `<NuxtLayout name="…">` in a parent page | the parent directory gets its own `layout.vsk` wrapping `{props.children}` |
| `definePageMeta({ layout: 'custom' })` inside a page directory | give the *directory's* `layout.vsk` the custom shell; you don't choose by name — placement decides |
| named `default` written twice (app.vue + layouts/default.vue) collapse | single root `app/layout.vsk` |

Common pattern — Nuxt:

```html
<!-- app.vue -->
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
```

```html
<!-- layouts/default.vue -->
<template>
  <div class="shell">
    <header><Nav /></header>
    <main><slot /></main>
    <footer>…</footer>
  </div>
</template>
```

Vesk:

```vsk
// app/layout.vsk
import type { Component } from '@vesk/types'
import { Nav } from './components/Nav.vsk'

interface LayoutProps { children?: Component }

async component Layout(props: LayoutProps) {
	<Head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>My Nuxt app → Vesk</title>
	</Head>
	<div class="shell">
		<header><Nav /></header>
		<main>{props.children}</main>
		<footer>…</footer>
	</div>
}
```

### Step 8 — `definePageMeta`

Nuxt's compile-time page metadata has no direct Vesk macro. Each key maps:

| `definePageMeta({ … })` | Vesk equivalent |
| --- | --- |
| `layout: 'name'` / `layout: false` | directory placement — see Step 7 |
| `middleware: ['auth']` | client guard: `router.beforeEach((to, from) => { … return bool/string })` at app bootstrap (`_events.ts` or module) OR the page's own guard-clause `if` when it is page-local; server-side: `app/middleware.ts` |
| `validate: (route) => bool` | guard in the page body — `if (!valid(props.params)) { throw new NotFoundError() }`; global variants go in `router.beforeEach` |
| `redirect: '/path'` | `if (cond) return redirect('/path')` / `redirect()`, or `router.beforeEach` returning the target when global |
| `name` / `path` (named routes) | n/a — file-based routing is authoritative; flag if the app relies on `navigateTo({ name })` |
| `key` / `keepalive` (stateful pages) | flag "not supported" — Vesk cells are per-component and survive route change naturally via module cells if needed |
| `scrollToTop` | `effect(() => { window.scrollTo(0, 0) })` in the page — no config knob |
| `viewTransition` | decorate `useNavigate`/router — flag |
| custom fields (`title: '…'`) | usually become `<Head>` content on the page |
| `middleware` order | `router.beforeEach` array order — the guard returns the first blocking result |

### Step 9 — Data fetching

The Nuxt trio `useFetch` / `useAsyncData` / `useLazyFetch` collapses to Vesk
`useFetch` (name collides happily — semantically close). Nuxt's return
`{ data, pending, status, error, refresh, execute, clear }` (
`data`/`status` are refs) maps to Vesk's reactive resource
`{ loading, error, data, refresh(), abort() }` where `data` is a plain value,
not a ref.

| Nuxt | Vesk |
| --- | --- |
| `const { data, pending } = await useFetch('/api/x')` | `let &[data] = track(null)` + `const r = useFetch('/api/x', { into: data, … })`; `pending` → `r.loading` |
| `useFetch(url, { query: { q } })` | `useFetch(url + '?' + new URLSearchParams({ q }).toString())` or `useFetch(url, { body })` — Vesk dedupes by `key` |
| `useFetch(url, { watch: [() => page.value] })` | read `page` inside the component and call `r.refresh()` from an `effect` on it — or `useFetch` with the param in the URL and a directory-level cache |
| `useFetch(url, { getCachedData })` / `{ dedupe: 'cancel' }` | `dedupe: true` (default) + `staleTime` — per canonical skill |
| `useAsyncData('posts', () => $fetch('/api/posts', { … }))` | `useFetch('/api/posts', { key: 'posts', into: postsCell })` |
| custom `useFetch` wrapper (`createUseFetch`) | a local `function useTypedFetch(url, opts) { return useFetch(url, opts) }` — same pattern |
| `await useFetch` at top level of `setup` | `async component Page(props) { const r = await useFetch(url, { into: cell }); … }` |
| `{ data: d, execute }` manual trigger | `{ data: d, refresh }` — same idea; `abort()` extra |
| `refreshNuxtData('posts')` after a mutation | `mutate('posts', fresh)` from `@vesk/runtime/src/resource` — or `useFetch` + key + `staleTime: 0` |
| optimistic lists + `useFetch` `{ dedupe }` | `keepPreviousData: true` keeps prior `data` while refreshing |

The error path: Nuxt `status: 'error'`/`error.value` → Vesk `r.error` and
`if (r.error) { retry UI / throw }`. Use `catch` on the PromiseLike resource for
logging.

### Step 10 — Errors, `error.vue`, and `validate`

| Nuxt | Vesk |
| --- | --- |
| `error.vue` (global error page) | `app/error.vsk` (root) — the runtime renders nearest `error.vsk` in the directory tree |
| `throw createError({ statusCode: 404 })` | `throw new NotFoundError()` (`@vesk/runtime/router`) |
| `createError({ statusCode, message, fatal })` | `throw new NotFoundError()` for 404, otherwise throw `Error`/`HttpError` (has `status`); the nearest `error.vsk` receives `{ error, retry, params, statusCode, stack, url }` |
| `showError({ … })` | throw (client event handlers: call `redirect`/navigate, or render the error state inline) |
| `clearError()` | leave the error page by navigating; a retry button re-renders |
| `validate: (route) => false` in `definePageMeta` | early return `if (!valid(props.params)) return notFound()` or `throw new NotFoundError()` |
| `error` thrown inside `useAsyncData` | `r.error` on the resource — render inline or `throw` from the page |
| `useError()` in `error.vue` | the `error.vsk` renders from the props `statusCode` / `error.message` — no hook |

Per-route errors were historically `error/` folders in some scaffolds — Vesk
uses per-directory `error.vsk`, which is the same nesting convention.

### Step 11 — Middleware

Nuxt runs **client route middleware** (`app/middleware/*.ts` +
`definePageMeta({ middleware })`) and **Nitro server middleware**
(`server/middleware/*.ts`, runs on every request). Two different beasts — map
to two different Vesk concepts.

| Nuxt | Vesk |
| --- | --- |
| `defineNuxtRouteMiddleware((to) => …)` in `app/middleware/` | client-side guard registered at app bootstrap: `router.beforeEach((to, from) => { … })` — return `true`/a path/`false` |
| `definePageMeta({ middleware: ['auth'] })` per page | apply the guard in `beforeEach` by route matcher, or keep it page-local as a guard-clause `if (…) { return redirect('/login') }` |
| Nitro `server/middleware/*.ts` | `app/middleware.ts` (server onion) — `export async function middleware(ctx, next) { …; return await next() }` |
| Nitro middleware mutating `event.context` | set `locals` / fields on the request context between `next()` calls |
| `setResponseHeader`/auth header in Nitro middleware | `VeskResponse` `setSecurityHeader`/`setCookie` on the way back down the onion |
| per-page auth for API (Nitro route with `getUserFromSession`) | the `/api` route handler does the same check directly from `req.headers` before responding |

**Never** forget the onion rule: server middleware must `return await next()`
or the response is swallowed.

### Step 12 — Nitro server code

Nitro event handlers are tiny functions inside `server/api/` / `server/routes/`
auto-generated from file layout. Vesk API routes are `app/api/**/route.ts`
exporting named HTTP method handlers (`GET`, `POST`, …) taking `VeskRequest`
and returning `VeskResponse`.

| Nitro | Vesk |
| --- | --- |
| `server/api/hello.ts` → `defineEventHandler((event) => 'hi')` | `app/api/hello/route.ts` → `export async function GET(req: VeskRequest) { return VeskResponse.body('hi') }` |
| `server/api/posts.get.ts` (method suffix) | `export async function GET(…)` in `app/api/posts/route.ts` |
| `server/api/posts.post.ts` + POST body | `export async function POST(req: VeskRequest) { const body = await req.json() }` |
| `getRouterParam(event, 'id')` | route params are runtime data — in API routes read from `ctx.params` (a `Promise`) or `props.params` on pages |
| `getQuery(event)` | `req.query` (flattened searchParams) or `req.parsedUrl.searchParams` |
| `readBody(event)` | `await req.body` / `await req.json()` (lazy parse; objects auto-typed by what you sent) |
| `getCookie(event, 'name')` / `setCookie` | `cookies().get('name')` (from `@vesk/runtime/server`); `VeskResponse.setCookie(name, value, opts)` for outbound |
| `sendRedirect(event, url, code=302)` | `VeskResponse.redirect(url, status=307)` or `return redirect(url)` |
| `setResponseStatus(event, 201)` | `VeskResponse.setStatus(201)` / `.json(…, { status })` |
| `createError({ statusCode, statusMessage, cause })` | `HttpError` (has `status`) / `new NotFoundError()` / throw an `Error` — 500 default |
| `event.context` / `definePlugin` | `locals()` / `ctx.set(key, value)` + explicit argument passing |
| `server/routes/sitemap.xml.ts` (non-API routes) | no exact equivalent — serve via `app/api/sitemap.xml/route.ts` and note the URL prefix, or an `[route].ts` fallback; flag it |
| Nitro `prerender: { crawl }` / routeRules prerender | `vesk.config.ts` SSG/`revalidate`/`revalidatePath`/`revalidateTag` |
| Nitro auto-imports (`$fetch`, `getHeader`) | import explicitly — no Nitro-honored auto-import in Vesk server modules |
| `useRequestEvent()` in a composable | server `req`/`res` locals/params threading |

`server/plugins/` Nitro lifecycle (`defineNitroPlugin(nitro => …)`) maps to
`_events.ts` in the relevant route directory: `onStart`/`onStop` hooks. App-side
Vue plugins (`defineNuxtPlugin`) that do cross-cutting work become
behaviors in `_events.ts` or explicit imports; plugins that only register
globals are unnecessary in Vesk.

### Step 13 — Config, head, env, public assets

| Nuxt | Vesk |
| --- | --- |
| `nuxt.config.ts` → `export default defineNuxtConfig({ … })` | `vesk.config.ts` → `export default defineConfig({ … })` — real keys: `appDir`, `outDir`, `publicDir`, `ssg`, `plugins`, `security`, `routeDataCache`, `md` |
| `css: ['~/assets/main.css']` (global CSS) | global CSS via the tailwind plugin `entry` (`plugins: [tailwindcss({ entry })])`, per-component `<style>` blocks, or a `<Head>` `<link rel=stylesheet>` — `VeskConfig` has no `css` array; flag it |
| `app.head` (title/meta/links in config) | `<Head>` in `app/layout.vsk` |
| `runtimeConfig.public.apiBase` | `process.env` at build time on the server; prefix public values and only ship what the client truly needs | never leak secrets to the client bundle |
| `routeRules` / `defineRouteRules` (SSR/SSG/ISR/SWR) | `ssg: {}` config (+ pages exporting `getStaticProps`/`getStaticPaths`), per-page `revalidate` seconds, `revalidatePath`/`revalidateTag` for ISR — read the canonical skill's SSG/ISR sections |
| `nitro.static` / prerender crawling | `ssg: {}` in `vesk.config.ts` — pages exporting `getStaticPaths`/`getStaticProps` are prerendered |
| `devtools`, `modules: ['@nuxt/…']` | drop — no analogue; flag every used Nuxt module explicitly |
| `app.config.ts` | module-scope `track` cells in a shared TS module (or `createContext`) — no `app.config` analog; flag |
| `public/` (static assets) | `public/` — same |
| `.env` | `.env` is read by your tooling (config/scripts); there is no built-in env loader — flag |
| `import.meta.env` / `process.env` | `process.env` on the server; `import.meta.env` as your build exposes |
| SEO: `sitemap`, `robots`, `og` | `JsonLd` + `<Head>` in layout — plus the runtime's SEO helpers |

### Step 14 — Nuxt/Vue built-ins and components

| Nuxt/Vue component | Vesk |
| --- | --- |
| `<NuxtLink to="/x">` | `<Link href="/x">` from `@vesk/runtime/router` (declare `import { Link } from '@vesk/runtime/router'`) |
| `<NuxtPage/>` | n/a — directory nesting replaces it; `{props.children}` in a layout renders the child route |
| `<NuxtLayout name="…"/>` | per-directory `layout.vsk` |
| `<ClientOnly>` `#fallback` | `client` island component or `{#client}` block — server renders the fallback, client hydrates the branch |
| `<NuxtErrorBoundary>` | nearest `error.vsk` in the directory tree (per-route boundaries) |
| `<NuxtImg>` / `<NuxtPicture>` | `<Image>` (Vesk's optimized provider) — same props shape |
| `<Head>`/`<Title>`/`<Meta>` from `@unhead/vue` | `<Head>` block; `<title>`/`<meta>`/`<link>` inside it |
| `<Html>`/`<Body>` attributes | `<Head><html lang=… /><body class=… /></Head>` |
| `<Transition>` / `<TransitionGroup>` | effect-driven class toggling or no-op; flag (no Vue transition runtime) |
| `<Teleport to="body">` | `Portal` from the runtime |
| `<KeepAlive>` | flag unless genuinely needed |
| `<Suspense>` boundaries | async page/components are awaited; `Suspense` is unnecessary |
| `<component :is="v">` | explicit conditional render `if (v === 'a') { <A/> } else { <B/> }` |

## Recipes

Each recipe is a deterministic, copy-pastable refactor. When in doubt about an
API, re-read the canonical Vesk skill.

### Recipe A — landing page (`app/pages/index.vue` → `app/page.vsk`)

```html
<script setup>
const count = ref(0)
</script>

<template>
  <main>
    <h1>Hello, Nuxt</h1>
    <p>Count: {{ count }}</p>
    <button @click="count++">increment</button>
  </main>
</template>
```

```vsk
// app/page.vsk
import { track } from '@vesk/runtime'

export default component Home() {
	let &[count] = track(0)
	<main>
		<h1>Hello, Nuxt</h1>
		<p>Count: {count}</p>
		<button onClick={() => count++}>increment</button>
	</main>
}
```

### Recipe B — dynamic blog page (`pages/posts/[id].vue` → `app/posts/[id]/page.vsk`)

```html
<script setup>
const route = useRoute()
const { data: post, pending, error } = await useFetch(`/api/posts/${route.params.id}`, {
  key: `post-${route.params.id}`,
})
</script>

<template>
  <article v-if="!pending">
    <h1>{{ post.title }}</h1>
    <p>{{ post.body }}</p>
  </article>
  <p v-else>Loading…</p>
</template>
```

```vsk
// app/posts/[id]/page.vsk
import { track } from '@vesk/runtime'

export default component Post(props: { params: { id: string } }) {
	let &[post] = track<Post | null>(null)
	const res = useFetch(`/api/posts/${props.params.id}`, { key: `post-${props.params.id}`, into: post })
	if (res.loading) {
		<p>Loading…</p>
	}
	if (res.error) {
		<p>Failed to load. <button onClick={() => res.refresh()}>Retry</button></p>
	}
	if (post) {
		<article>
			<h1>{post.title}</h1>
			<p>{post.body}</p>
		</article>
	}
}
```

Note the `key` includes the param so distinct posts don't share a cache slot.

### Recipe C — computed + watch (`computed`/`watch` → `derived`/`effect`)

```ts
const search = ref('')
const results = computed(() => items.value.filter(i => i.name.includes(search.value)))
watch(results, r => { if (r.length === 0) trackEvent('empty-search') }, { deep: true })
```

```vsk
import { derived, effect, track } from '@vesk/runtime'

let &[search] = track('')
const &[results] = derived(() => items.filter((i) => i.name.includes(search)))
effect(() => {
	if (results.length === 0) trackEvent('empty-search')
})
```

### Recipe D — form with `v-model` → `bindValue` + `defineAction`

```html
<script setup>
const name = ref('')
const email = ref('')
async function onSubmit() {
  await $fetch('/api/users', { method: 'POST', body: { name, email } })
  navigateTo('/users')
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <input v-model="name" placeholder="Name" />
    <input v-model="email" type="email" placeholder="Email" />
    <button type="submit">Save</button>
  </form>
</template>
```

```vsk
import { bindValue, track } from '@vesk/runtime'

component UserForm() {
	let &[name, nameCell] = track('')
	let &[email, emailCell] = track('')
	async function onSubmit() {
		await fetch('/api/users', { method: 'POST', body: JSON.stringify({ name, email }) })
		useNavigate()('/users')
	}
	<form onSubmit={onSubmit}>
		<input bindValue={nameCell} placeholder="Name" />
		<input bindValue={emailCell} type="email" placeholder="Email" />
		<button type="submit">Save</button>
	</form>
}
```

Prefer Vesk's `<Form>` + validators + `defineAction` for real forms
(see Recipe D in the React skill / canonical skill forms section) — this
recipe only swaps the plumbing. Bind takes the `…Cell`, never the unwrapped
binding.

### Recipe E — `app.vue` + `layouts/default.vue` → root layout

Covered verbatim in Step 7. Keep `<Head>` in the shell, `{props.children}`
where `<slot/>` was.

### Recipe F — Nitro API route → `app/api/**/route.ts`

```ts
// server/api/posts.get.ts
export default defineEventHandler((event) => {
  const q = getQuery(event)
  return { posts: db.posts.filter(p => p.author === q.author) }
})
```

```ts
// app/api/posts/route.ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server'

export async function GET(req: VeskRequest) {
	const author = req.query.author
	return VeskResponse.json({ posts: db.posts.filter((p) => p.author === author) })
}
```

### Recipe G — auth route middleware

```ts
// app/middleware/auth.ts
export default defineNuxtRouteMiddleware((to) => {
  const user = useAuth()
  if (!user.value && to.path !== '/login') return navigateTo('/login')
})
```

```vsk
// client bootstrap (app/_events.ts onStart, or a module you import once)
router.beforeEach((to, from) => {
	const user = currentUser()
	if (!user && to.path !== '/login') {
		useNavigate()('/login', { replace: true })
		return false
	}
	return true
})
```

Server-side equivalent (authed page shells) goes in `app/middleware.ts`:

```ts
import type { MiddlewareContext } from '@vesk/compiler'

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
	if (!ctx.cookies.get('session')) {
		return Response.redirect(new URL('/login', ctx.url), 302)
	}
	return await next()
}
```

### Recipe H — SEO head

```ts
useSeoMeta({
  title: 'About',
  description: 'About this site',
  ogTitle: 'About',
  ogDescription: 'About this site',
})
```

```vsk
<Head>
	<title>About</title>
	<meta name="description" content="About this site" />
	<meta property="og:title" content="About" />
	<meta property="og:description" content="About this site" />
</Head>
```

Structured data uses `JsonLd`; per-page head is fine in the page body — the
root layout's `<Head>` merges.

### Recipe I — `useState` shared store → module cells

```ts
// composables/useCounter.ts
export const useCounter = () => useState<number>('counter', () => 1)
```

```vsk
// app/lib/store.ts — any TS module; there is no app.config.vsk analog
import { track } from '@vesk/runtime'

export const &[counter, counterCell] = track(1)
export function increment() { counterCell.set(counter + 1) }
```

Import `counter`/`increment` where used. For app-wide settings, `createContext`
is the per-tree default-value variant.

### Recipe J — client-only widget

```html
<ClientOnly>
  <ChartsWidget />
  <template #fallback><p>Chart loading…</p></template>
</ClientOnly>
```

```vsk
client component ChartsWidget() {
	// window/d3 etc. safe here — rendered on both sides, hydrated as an island
}
```

Vesk has no `isClient` runtime helper. Client-only behavior lives in `client`
island components or `{#client}` blocks — keep the placeholder in the server
render and mount the heavy widget inside `{#client}`:

```vsk
<p>Chart loading…</p>
{#client}
	<ChartsWidget />
{/client}
```

## High-confidence decision table (when you can't read the reference)

When a conversion question has no exact row (rare), apply these principled
substitutions and flag them in the manifest as "decision":

| Question | Default decision |
| --- | --- |
| Nuxt app with `app/` srcDir (v4) | mirror `app/` → `app/`; pages move 1:1 with `page.vsk` naming |
| Nuxt 3 project (files at root) | same mapping, root-level `pages/` → `app/pages/` (i.e. `app/page.vsk`) |
| `useAsyncData` with a payload-only purpose | `useFetch` with a `key`; keep `await` for SSR payload |
| `$fetch` with `query:` options | `URLSearchParams` appended to the URL; keep `key` stable so dedupe works |
| Vue <Transition>/<TransitionGroup> | class-toggle via `effect` or drop; flag |
| `<Teleport>` | `Portal` |
| Pinia with `setup` stores, computed getters | `track` cells + `derived`; action functions exported |
| `@vueuse` utilities | hand-rolled `effect` + native APIs where trivial; flag otherwise |
| i18n/intl, date libs, zustand-adjacent | keep the TS library — Vesk is a TS superset, plain libs still work |
| `server/api` using `defineEventHandler` inline | `GET(req: VeskRequest)` + `VeskResponse` — always |
| `server/middleware` and `app/middleware` | `app/middleware.ts` (onion) vs `router.beforeEach` (client) respectively |
| `nuxt.config` `routeRules.swr` | `revalidate` / SSG config in `vesk.config.ts` |
| `error.vue` + catch-all | `app/error.vsk` + per-dir `error.vsk` |
| `app.config.ts` reactive global | module-scope `track` cells |
| `useState` cross-component | module `track` cells |
| Nuxt module ecosystem (nuxt/image, nuxt/fonts, dotenv, sitemap) | drop the wrapper, keep the underlying lib or `<Image>`/`<Head>`; list dropped modules in the manifest |
| `<NuxtLink>` everywhere | `<Link href>` from `@vesk/runtime/router`; active styling via `NavLink` |
| `<Suspense>` | unnecessary — async components awaited by the framework |
| `defineNuxtPlugin` providing `$api` | return an object from a module function; `createContext` if trees are needed |
| `onBeforeRouteLeave` / `onBeforeRouteUpdate` | `router.beforeEach` with path-match or leave guards; in-component variant via effect on `usePathname()` |
| `useLazyFetch` with `server: false` | `useFetch` in `{#client}` or a `client` island so SSR skips it |

## Anti-patterns (each one is a hallucination the skill exists to prevent)

1. **Emitting `<template>`/`<script setup>` or `import from 'vue'`** in `.vsk`
   output — no Vue runtime.
2. **Emitting `v-if`/`v-for`/`v-model`/`v-bind`/`v-on`/`:prop`/`@event`**
   anywhere — those directives don't parse; convert to statement-mode control
   flow and native props/events.
3. **Keeping `.value` on refs** — cells are raw bindings; `count.value` is
   fiction in Vesk.
4. **Emitting `{#if …}{/if}`** — Vesk's conditional is a plain
   `if (…){…}` statement; `{#if}` is **not** in the grammar (only
   `{#server}`/`{#client}` are special blocks).
5. **`useState` inside a component body** treated as per-invocation state —
   module cells are singletons; scope them deliberately.
6. **`definePageMeta`/`defineNuxtRouteMiddleware`/`defineNuxtPlugin` macros**
   in output — they're compile-time Nuxt concepts; use the mapped Vesk
   equivalents.
7. **`batch`** — doesn't exist; `flushSync`.
8. **`className`** — always `class`.
9. **`useFetch` treated as a promise-only** fetch, ignoring
   `loading`/`error`/`into`/`key` — SSR/hydration data rides the data script;
   read the resource reactively.
10. **`window`/`document` at top level of a server-rendered body** — islands
    or `effect`/`{#client}`.
11. **Controlled-input `value` + `onChange` without `bindValue`/cell write** —
    dead on SSR hydration.
12. **`bindValue(binding)` instead of `bindValue(cell)`** — throws; pass the
    `…Cell`.
13. **`bindValue` on a `derived`** — derived cells are read-only; write into a
    `track` cell pair.
14. **Middleware that forgets `return await next()`** — response swallowed.
15. **`getQuery`/`readBody`/`defineEventHandler` in Vesk server files** — use
    `req.query` / `req.parsedUrl.searchParams`, `await req.json()` (or
    `await req.body`), and the named-method handlers of `app/api/**/route.ts`.
16. **`useRoute().params` routed through a hook** — page components take
    `props.params`; that's the only channel (plus `useParams()` inside router
    context).
17. **Expression-only conversions of pages/layouts** — statement mode is
    first-class; interactive/paginated pages convert to statement mode.
18. **Claiming Nuxt modules survive with a "compatible" name** — every module
    must be dropped and explicitly flagged, with the closest canonical Vesk
    analog noted.

## Final gate

Before reporting a conversion complete:

- [ ] Manifest for source → target mapping shown and reviewed
- [ ] `npx vesk typecheck` passes
- [ ] Converted pages render + hydrate in dev (and production hydration suite
      where reactivity/hydration is involved)
- [ ] Banned-token grep clean (`from 'vue'`, `defineComponent`, `v-if`,
      `v-for`, `v-model`, `.value`, `definePageMeta`, `defineNuxt*`,
      `defineEventHandler`, `batch`, `getQuery`, `readBody`, `className`)
- [ ] No top-level browser-API access in server-rendered bodies
- [ ] Statement mode used for pages, layouts, interactive components
- [ ] Every `definePageMeta` key explicitly mapped (layout, middleware,
      validate, redirect, key/keepalive, scrollToTop) — none silently dropped
- [ ] Every Nuxt module and `@vueuse`/Vue plugin usage flagged in the manifest
- [ ] Server-side concepts (API routes, middleware onion, actions, head,
      SSG/ISR, cookies) map to documented Vesk APIs — not invented ones

When in doubt, the canonical `vesk` skill wins; if it doesn't cover a case,
read the source or say "not covered — flagged" rather than invent.