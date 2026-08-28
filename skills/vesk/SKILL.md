---
name: vesk
description: >-
  Build, extend, and debug applications with Vesk, a compiler-first framework
  for the post-VDOM web. Use when writing or editing components in .vsk files
  (component keyword, track() reactivity, statement/expression body modes,
  islands, styles, Head), when working with file-based routing (app/ pages,
  layouts, dynamic [param]/catch-all [...path] segments, route groups,
  loading/error/not-found/offline files), when fetching data (useFetch,
  createResource, mutate), when building forms and server actions
  (Form/Field/defineAction/validators), when writing API routes
  (app/api/**/route.ts, VeskRequest/VeskResponse, cookies, validation,
  webhooks, CORS), when configuring middleware, security, SSG, or ISR in
  vesk.config.ts, and when running Vesk CLI commands (dev/build/start/
  typecheck/seo/init). Prefers statement mode; never invents APIs not
  documented here. Use ONLY for Vesk/.vsk work, not generic web/react code.
---

# Vesk — Compiler-First Framework

Vesk is a full-stack framework that compiles `.vsk` (a TypeScript superset)
to HTML on the server, hydrates it in the browser, and keeps client bundles
tiny. **No virtual DOM**: the compiler emits per-cell DOM updates, and
static subtrees need no hydration runtime at all. Reactivity is fine-grained
via `track()` cells.

Everything below is grounded in Vesk's official documentation (`docs/guide/`).
Do not invent APIs, options, or behaviors not present here. When in doubt,
follow the documented surface exactly.

## Quick start

```sh
npx create-vesk@latest my-app
cd my-app
npm install
npm run dev          # http://localhost:3000
```

- `create-vesk` fails if the directory exists or the name is missing.
- Node.js **>= 20** required.

### The dev loop

- `app/` edits hot-reload over WebSocket (~90–150 ms), no full reload.
- `public/` is watched; CSS rebuilds automatically.
- API routes, middleware, server actions and SSR all run in dev.

## CLI (`@vesk/vesk-cli`)

```
vesk build [--platform <name>] [--seo] [--strict] [--skip-split]
vesk seo [--strict]
vesk typecheck [--no-strict]      # tsc-in-.vsk, strict by default
vesk start [-p 3000]              # production server; needs a build
vesk dev [-p 3000] [-H 127.0.0.1]
vesk init                         # create src/global.css if missing
```

- `dev`: loads `.env` then `.env.local`; serves SSR pages, `/api/*`, server
  actions (`/_vesk/action/:id`), client bundle (`/_vesk/client.js`), static
  assets, global CSS/Tailwind, hydration-data script. Honors prod security
  features in dev (body cap, headers, CORS, rate limit, trust proxy).
- `build`: outputs `.vesk/` (or `outDir`): `config.json` manifest,
  `server/runtime.js`, `server/middleware.js`,
  `server/functions/<name>.js` (one SSR function per page),
  `server/api/<name>.js`, `static/client.js` (+ per-route chunks),
  `static/global.css`, `static/_tailwind.css`, `static/public/`
  (public/ + sitemap.xml + robots.txt), `static/images/`, `prerendered/`.
  Platforms: `node` \| `vercel` \| `netlify` \| `cloudflare` \| `deno` \|
  `aws` \| `edge` \| `coxmos` (auto-detected from CI, else `node`).
  `--target edge` promotes node build to generic edge.
- `start`: request pipeline = static files → hydration-data → runtime →
  static assets → prerendered pages → middleware chain → server actions →
  API routes → SSR pages (with ISR) → custom 404. Sets `NODE_ENV=production`.
- Servers bind **127.0.0.1** by default; expose deliberately with `-H 0.0.0.0`.
- `PORT` (default 8000) is only for deno/coxmos bootstrap; node uses `-p`.

## Components

Declare with the `component` keyword. `component` is a **reserved keyword** —
using it as an identifier is a compile error.

```vsk
component Name(params) { }              // params optional
component Island(params) client { }     // island
export component Exported(params) { }
export default component App(params) { }
export async component Loader() { }     // async BEFORE component
export default async component App() { }
component List<T>(…) { … }              // generic type params supported
```

- `async` goes before `component`; `component X() async` is invalid.
- `client` island modifier goes after params (or right after `component`);
  composes with `export`/`async`.
- Props = first parameter, plain TypeScript. Destructure with defaults:
  `component Card({ title, body = '', featured }: { title: string; body?: string; featured?: boolean })`.
- `{props.children}` is the ONLY children channel — **no `<slot/>`**.
- Layouts receive `{ children, params }`.

### Attributes / events

- Dynamic values `class={expr}`: text is escaped on SSR.
- Boolean attributes render when truthy; **spread** `<button {...rest}>` works.
- Form element values (`value`, `checked`, `selected`, `indeterminate`) are
  **property bindings**, not attributes: they compile to `el.value = x`.
- `on*` event handlers are **excluded from SSR HTML entirely**; they attach
  during hydration. Bubbling events delegate; non-bubbling bind directly —
  both automatic. Handlers receive the native DOM event.
- `ref={fn}` invokes `fn(element)` on the client after creation; stripped
  from SSR. Also the attach point for binding helpers.

### Auto-imported identifiers (no import needed inside components)

`useFetch`, `createResource`, `useRouter`, `useParams`, `usePathname`,
`useSearchParams`, `useNavigate`, `defineAction`, `getAction`,
`validateActionInput`, `issuesToFieldMap`, `isFormAction`, `Form`, `Field`,
`required`, `email`, `minLength`, `maxLength`, `pattern`, `custom`, `Link`,
`NavLink`, `Outlet`, `Redirect`, `redirect`, `permanentRedirect`, `notFound`,
`NotFoundError`, `Image`, `Portal`, `Experiment`, `LoadingIndicator`,
`useLoadingIndicator`, `JsonLd`, all SEO schema helpers (`ArticleSchema`,
`ProductSchema`, `FAQPageSchema`, `BreadcrumbListSchema`,
`OrganizationSchema`, `LocalBusinessSchema`, `VideoSchema`), plus reactivity
core: `effect`, `derived`, `untrack`, `peek`, `tick`, `flushSync`,
`on_destroy`, `createContext`.

Everything else needs an explicit import from `@vesk/runtime` or
`@vesk/runtime/router` / `@vesk/runtime/server`. Notably **NOT** auto-imported:
`track`, `Show`/`For`/`Switch`/`Match`, `Md`, `bindValue`/`bindChecked`/
`bindGroup`.

## Body Modes (both first-class, identical output)

Pick per-component. If more than one conditional/loop → statement mode.

### Expression mode — "function returning UI" (React/Solid style)

```vsk
component Greeting(props: { name: string }) {
	return <div>Hello, {props.name}!</div>;
}
```

JSX allowed: after `return`; ternary branches; `.map()` callbacks; component
children. **Not** allowed: after `=` assignment, or inside object/array
literals (`{ el: <p/> }`). For config maps, store strings/data and branch, or
move markup into small child components. Two loose top-level elements need a
fragment `<>…</>`. Angle-bracket type assertion `<T>expr` is unavailable —
use `expr as T`; generic arrows need trailing comma `<T,>(x) => …`.

### Statement mode — "template with superpowers" (preferred for pages)

Bare JSX sits in the body next to real control flow — no `return`, no
wrapping. Each JSX line renders where it appears.

```vsk
component Profile(props: { user: User }) {
	const initials = props.user.name.split(' ').map((p) => p[0]).join('');
	<h1>{props.user.name}</h1>
	<p class="avatar">{initials}</p>
}
```

Statements the compiler understands:

| Statement | Becomes |
| --- | --- |
| Bare JSX / fragment | rendered markup, tracked for hydration |
| `{expr}` container | dynamic region (`.map()` → list region) |
| `if` / `else if` / `else` | conditional region |
| `for…of`, `for…in`, classic `for`, `while`, `do…while` | loop region |
| `switch` (+ break/default) | switch region |
| `try` / `catch` | error region; catch variable usable inside |
| `return (<jsx>)` | guard-clause early exit (see below) |
| `let &[x] = track(v)` | reactive state declaration |
| other declarations/calls | preserved as-is |

**Cannot** declare a `class` inside a component body.

Loops gain extra clauses and an empty state:

```vsk
for (const item of items; key item.id; index i) {
	<Row data={item} index={i} />
} empty {
	<p>Nothing here</p>
}
```

Guard clause (brace + parenthesize the return so parsing continues):

```vsk
component Page(props: { user: User | null }) {
	if (!props.user) {
		return (<a href="/login">Login</a>);
	}
	<h1>Welcome, {props.user.name}</h1>
}
```

Local error boundary (only the region is affected):

```vsk
try {
	<RiskyWidget />
}
catch (e) {
	<p>Widget failed: {String(e?.message ?? e)}</p>
}
```

## Reactivity

Tracked cells, created with `track()`. Reading subscribes (in body/effect);
writing schedules an update. No VDOM — the compiler emits per-cell DOM
updates.

```vsk
let &[count] = track(0)            // reactive binding; count auto-unwraps
const &[count] = track(0)          // const works too
let &[count, rawCell] = track(0)   // also bind the raw cell for APIs
```

### Core API (auto-imported; JSDoc is canonical)

- `track(initial)` — cell; `track(() => expr)` → derived; transform hooks
  via `track(v, get?, set?)`. Passing an existing tracked/derived returns it.
- `get(cell)` — read, subscribing inside effects/derived. Non-tracked pass
  through.
- `set(cell, v)` — write; no-op if `Object.is(next, prev)`; schedules one
  microtask flush.
- `derived(fn)` — lazy, memoized computed; re-runs only when dep clocks move.
  **Writing to tracked state during derived evaluation throws.**
- `effect(fn)` — run now + on dep change; return cleanup fn from `fn`.
- `pre_effect(fn)` — same, flushed before ordinary effects (advanced;
  **not auto-imported**).
- `untrack(fn)` — run without subscribing.
- `peek(cell)` — read without subscribing.
- `flushSync(fn?)` — flush pending, run fn synchronously, restore batching.
- `tick()` — Promise resolving on next animation frame (after paint).
- `on_destroy(fn)` — teardown for current block/component.

> **`batch` does NOT exist.** For synchronous multi-write flushing use
> `flushSync(fn)`. Never import `batch`.

### Scheduler semantics

- `set()` is **microtask-batched**: N writes in one turn → one flush. Reads
  right after `set()` see fresh cell values but stale DOM — use `flushSync`
  when you need immediate application.
- Flush order: `pre_effect`s → render blocks → `effect`s last.
- Effects created during initial setup are deferred until setup completes.
- Infinite loops guarded (~1001 rounds): *"Maximum update depth exceeded…"*.

### Deriveds chain

```vsk
let &[a] = track(1)
let &[b] = derived(() => a + 1)
let &[c] = derived(() => b + 1)
```

### untrack / peek

```vsk
component Notifier() {
	let &[count] = track(0)
	let &[loud] = track(false)
	effect(() => {
		const msg = untrack(() => loud ? "!!!" : "!")
		console.log(count + msg)   // re-runs ONLY when count changes
	})
	return <button onClick={() => peek(loud) ? count++ : loud = true}>go</button>
}
```

### Cleanup

```vsk
component Timer() client {
	let &[ms] = track(0)
	effect(() => {
		const id = setInterval(() => ms.set(Date.now()), 1000)
		return () => clearInterval(id)   // or on_destroy(() => clearInterval(id))
	})
	return <time>{new Date(ms).toISOString()}</time>
}
```

### Context

```vsk
import { createContext } from '@vesk/runtime';
const Theme = createContext('light');
// provider (in a component body):
Theme.set('dark');
// consumer (any descendant):
const theme = Theme.get();   // 'light' default if no ancestor set it
```

`createContext<T>(value): Context<T>`; `Context.get()` walks the parent chain
falling back to default; `set()` stores on nearest active component
(throws outside a component context).

## File-Based Routing

Vesk scans `app/` (configurable `appDir`) → route tree.

Exact filenames per directory: `page.vsk`, `layout.vsk`, `loading.vsk`,
`error.vsk`, `not-found.vsk`, `offline.vsk`, `network.vsk`, `middleware.ts`.
A directory becomes a route if it has a `page.vsk`, `layout.vsk`, or children.
Directories starting with `_` (e.g. `_components/`, `_lib/`) are skipped.

### Segment syntax

| Directory | URL | Notes |
| --- | --- | --- |
| `about/` | `/about` | static |
| `[slug]/` | `/:slug` | dynamic; decoded into params |
| `[...path]/` | `/:path` | catch-all; remaining segments joined with `/` |
| `(group)/` | *(nothing)* | route group: nesting without URL impact |
| `_private/` | — | skipped entirely |

Params are URI-decoded before passed as props.

### Props per file

- `page.vsk`: `{ params, …data }` — decoded params + server-fetched data
  spread at top level.
- `layout.vsk`: `{ children, params }`
- `loading.vsk`: `{ params }`
- `error.vsk`: `{ error, retry, params, statusCode, stack, url }` (500 default)
- `not-found.vsk`: `{ params, url }`
- `offline.vsk` / `network.vsk`: `{ url, params, retry, online, effectiveType, downlink, rtt, saveData }`

Search params are NOT props — use `useSearchParams()` or
`useRouter().search`.

### Matching semantics

- SSR matcher backtracks (a later static sibling can still match if a
  dynamic sibling fails deeper). On the client, first structural match wins —
  sibling order matters; put more specific routes first. Catch-all matches
  whatever remains.

### Layouts

```vsk
// app/blog/layout.vsk
component BlogLayout(props) {
	<section class="blog">
		<aside>…blog nav…</aside>
		<main>{props.children}</main>
	</section>
}
```

Group layouts wrap subsets without URL parts:
`(marketing)/layout.vsk` wraps `/` and `/pricing`, `(app)/layout.vsk` wraps
`/dashboard`, etc.

### Route manifest

Build emits per-route `{ path, isGroup, isDynamic, isCatchAll, page, layout,
loading, error, notFound, offline, network, children, chunk }`.

## Router API (`@vesk/runtime/router`)

`createRouter(routes, options)` (programmatic) and
`createFileRouter(tree, options)` (build route tree; adds chunk loading,
middleware, not-found handling).

```ts
const router = createFileRouter(tree, { container: document.getElementById('root')! });
router.start();
```

```ts
const router = createRouter({
	'/': () => import('./pages/Home'),
	'/blog/:slug': () => import('./pages/Post'),
}, { container: root });
router.start();
```

### RouterOptions

```ts
{
	container?: HTMLElement;       // default #root
	prefetch?: boolean;            // default true — hover-prefetch links
	viewTransitions?: boolean;     // default false (startViewTransition)
	hydrate?: 'full' | 'viewport' | 'idle' | 'interaction';  // default 'full'
	routeDataCache?: number;       // ms TTL; 0 = always refetch
	offline?: Function | string;
}
// FileRouterOptions adds: middleware?, render?
```

### Navigation pipeline

`navigate(path)` / `<Link>` clicks: `beforeEach` guards → save scroll →
loading indicator start (`loading.vsk` renders sync if present) → URL update
(+ tracked path/search) → optional view transition → render → hash scroll →
route data `fetch(path, { headers: { 'X-Vesk-Data': '1' } })` unless fresh →
loading finish. `navigate()` is sync when guards are sync, else a Promise.

**Navigation policy:** SPA navigation happens only via
`<Link>`/`<NavLink>`/`navigate()` and **opt-in** plain anchors bearing
`no-reload` or `data-no-reload`. Plain `<a href>` without the attribute always
does native navigation (incl. markdown-rendered links). The delegated click
listener respects modifier keys, non-left clicks, `target="_blank"`,
`download`, `rel="external"`, external origins, and `hash`/`mailto:`/`tel:`/
`javascript:` schemes.

### Guards

```ts
const unsub = router.beforeEach((to, from) => {
	if (!isAuthed() && to.startsWith('/admin')) return '/login'; // redirect
	if (hasUnsavedChanges()) return false;                        // block
	// return nothing → continue
});
unsub();
```

Async guards return Promises. Redirect loops capped at depth 5. Guards apply
to programmatic/Link navs only — browser back/forward cannot be blocked.

### Prefetch & view transitions

- Prefetch on by default: `start()` installs passive document `mouseenter`
  listener; hovering `a[href]` prefetches. Combine with `routeDataCache`.
- `viewTransitions: true` wraps each DOM swap in `startViewTransition`.

### Link / NavLink / Outlet / hooks

```vsk
import { Link, NavLink } from '@vesk/runtime/router';
<nav>
	<NavLink href="/" activeClass="active">Home</NavLink>
	<Link href="/about" class="cta">About</Link>
</nav>
```

- `Link`: SPA nav on plain left-clicks; passes through extra attrs; SSR
  renders normal `<a>`.
- `NavLink`: active when path equals `href` or (non-root) starts with it
  followed by end/`/`/`?`. `activeClass` default `'active'`; sets
  `aria-current="page"` unless `ariaCurrent: false`.
- `Outlet`: layout placeholder (display:contents div, `data-vesk-outlet`);
  comment node outside router context.
- `Redirect` (throw to redirect; status default 302), `redirect(url)`,
  `permanentRedirect(url)` (308), `NotFoundError` (throw → nearest
  not-found / 404), `notFound()`.

Hooks (all getters reactive): `useRouter()` (push/replace/back/forward/go/
refresh/prefetch/beforeEach/isLoading/progress/error/pathname/params/search/
setSearch/route/canGoBack), `useNavigate()`, `useParams()`, `usePathname()`,
`useSearchParams()` → `[URLSearchParams, setter]` (setter replace-navs).

> `@vesk/runtime/server` re-exports the router's `useParams` as `routerParams`
> to avoid clashing with the request-side `useParams`.

## SSR & Hydration

- `render()` → HTML string; dynamic text escaped; `on*` handlers excluded;
  `<style>` hoisted; `<Head>` merged with dedup; async components awaited.
- Streaming: `renderPageStream()` AsyncGenerator (prod server pipes chunks).
- Per-request SSR state isolated via `AsyncLocalStorage` — concurrent
  requests never mix data.
- **Hydration markers**: server emits `<!--vsk-->` before each non-static
  subtree. Fully static trees have zero markers → **no hydration runtime, no
  JS shipped**. Pages without interactivity ship no JS.
- Strategies (router `hydrate` option or direct fns):
  - `'full'` (default) — hydrate immediately.
  - `'viewport'` — in-viewport now, rest via IntersectionObserver (rootMargin
    500px default).
  - `'idle'` — chunked via requestIdleCallback (chunkSize 10, timeout 3000).
  - `'interaction'` — on first click/touchstart/focus/mouseenter.
- Islands: `client` components render both sides + always in client bundle;
  `{#client}` blocks are SSR-stripped but present client-side.
- Error isolation: a throwing page errors itself only; SSR renders nearest
  `error.vsk` with status 500 (partial output never leaks); on the client the
  broken route's region shows its error UI while nav/footer/islands keep
  working.
- Keyed lists diff keys (`reconcile`); classic `for`/`while`/`switch`/`try`
  get flip-effect re-render.

## Client Boundary & Islands

- A plain component renders on the server; handlers/state hydrate on client.
- **Island** — `client` keyword renders on BOTH sides, always in client
  bundle: `component Clock() client { … }`. Position: after params or right
  after `component`. Composes: `export default async component X() client`.

### `{#client}` / `{#server}` blocks (SSR-stripped / rendered, scoped)

| Block | Server SSR | Client bundle |
| --- | --- | --- |
| `{#server}…{/server}` | rendered | stripped |
| `{#client}…{/client}` | stripped (SSR emits nothing) | rendered |

Validation: server components (default) may use `{#server}` (using
`{#client}` is an **error**); `client` islands may use `{#client}` (using
`{#server}` is an **error**). Blocks accept full statement-mode bodies.

```vsk
component ThemeToggle() client {
	let &[dark] = track(false)
	effect(() => dark.set(document.documentElement.classList.contains('dark')))
	<button onClick={() => {
		document.documentElement.classList.toggle('dark')
		dark.set(!dark.get())
	}}>Toggle theme</button>
}
```

## Styles

Per-component CSS in a `<style>` element anywhere in the body (either mode).
An unclosed `<style>` is a parse error. The compiler extracts it, emits a
literal `<style>` in SSR output, and on the client creates a `<style>` keyed
by the component id appended to `document.head` (SPA navs bring styles).

```vsk
component Card(props: { title: string }) {
	<div class="card"><h2>{props.title}</h2></div>
	<style>.card { border: 1px solid #ccc; padding: 8px; }</style>
}
```

Global CSS: `src/global.css` (created by `vesk init`) → copied to build as
`static/global.css`, linked from SSR HTML, watched in dev.

### Tailwind v4

```ts
import tailwindcss from '@vesk/plugin-tailwind';
export default defineConfig({ plugins: [tailwindcss({ entry: 'src/global.css', appDir: 'app' })] });
```

```css
@import 'tailwindcss';
```

Dynamic class bindings (`class={expr}`) are **not scanned** — keep a static
occurrence of any conditionally-used class in source, or use Tailwind's
`safelist`.

## Head & Metadata

`<Head>` works in both modes, anywhere in the body. Dedup by tag identity:
later `<title>` replaces earlier, repeated `meta[name=…]` collapse, page tags
override layout defaults. Managed elements: `title`, `meta`, `link`, `style`,
`script`, `base`.

```vsk
component AboutPage() {
	<Head>
		<title>About — My App</title>
		<meta name="description" content="All about us" />
	</Head>
	<h1>About</h1>
}
```

During SPA navigation the router applies the target route's head via the
`X-Vesk-Data` phase; head-only payloads don't re-render the body.

## TypeScript in `.vsk`

Full TS support; compiler strips type-only syntax at build time (AST-based,
**no regex**). Everything: interfaces/aliases, typed props/destructuring,
generics on components, `let &[posts] = track<Post[]>([])`, casts/assertions/
non-null (`count as number`, `value satisfies Config`, `el!`), enums, mapped/
conditional/utility types, `keyof typeof`, template literals, optional
chaining.

- Type-only imports (`import type`, inline `{ type A }`) dropped from both
  bundles, never treated as component imports.
- Stripping removes annotations, `as`/`satisfies`/`!` (recursively), type
  args, and drops type-only statements (interfaces, aliases, enums,
  `declare`).

### Typechecking

```sh
npx vesk typecheck        # tsc-in-.vsk, strict by default; exit 1 on errors
npx vesk typecheck --no-strict
```

`vskToTsx`: `component` → functions, TrackDecls → typed aliases, `<style>`
and island modifier stripped; `generateVskDts` preserves props/types/imports;
check runs in memory (like vue-tsc/Volar). Diagnostics print as
`file(line,col): TSCODE: message`.

tsconfig essentials: `"jsx":"preserve"`, `"jsxImportSource":"@vesk/compiler"`,
`strict:true`, `noEmit:true`, moduleResolution `bundler`.

## Data Fetching

`useFetch` (auto-imported) — data loads on server, travels with HTML,
hydrates instantly, exposes reactive `loading`/`error`/`data`. `createResource`
is the underlying primitive for non-URL sources.

```vsk
component Posts() {
	const &[posts, postsCell] = track<Post[]>([])
	useFetch('/api/posts', { key: 'posts', into: postsCell, staleTime: 30_000 })
	{#if loading}
		<p>Loading…</p>
	{/if}
	for (const p of posts; key p.id) {
		<article>{p.title}</article>
	} empty {
		<p>No posts.</p>
	}
}
```

### Options

`key` (default URL), `into` (cell), `body` (objects auto-JSON.stringify +
Content-Type, FormData/URLSearchParams/Blob/ArrayBuffer/strings pass raw),
`staleTime`, `keepPreviousData`, `retry` (extra attempts, default 0; GET only,
never retries 4xx), `retryDelay`, `timeout` (0 = off), `enabled: false`,
`dedupe` (default true). Typed variants: `useFetch.text/json/arrayBuffer`.

### Resource

`{ loading, error, data, refresh(), abort(), then/catch/finally }`; also
PromiseLike. `HttpError` (has `status`), `TimeoutError`.

### Mutations & shared state

```ts
import { mutate } from '@vesk/runtime/src/resource';
mutate('posts', newList);  // write cache + push into every live resource
mutate('posts');           // invalidate + refetch every live resource
```

Multiple components sharing a `key` share one cache entry and update
together. Resources deregister + abort via `on_destroy`.

### SSR behavior

Server dedupes per key; results record into per-request SSR store; promises
awaited before response flushes (`resolveSsrResources()`). Payload serializes
as a JSON-escaped data script; hydration reads it without refetching. Failed
SSR fetches memoize per render token; explicit `refresh()` bypasses. Relative
URLs resolve against the current request URL.

## Forms & Server Actions

Progressive-enhancement: work without JS (native POST + server-rendered
validation errors), upgrade to JSON fetch when hydrated.

- Actions defined at **module top level** of the `.vsk` file. Compiler
  rewrites per bundle: server keeps `execute`; client gets a stub
  `{ id, url }` (execute never ships to browser).

```vsk
import { Form, Field, required, email, minLength, defineAction } from '@vesk/runtime'

const signup = defineAction({
	input: {
		name: required('Name is required'),
		email: [required('Email is required'), email('Enter a valid email')],
		password: minLength(6, 'Password must be at least 6 characters'),
	},
	execute: async (input) => { await createUser(input); return { ok: true }; },
})

component Signup() {
	<Form action={signup} onSuccess={() => console.log('done')}>
		<Field name="name" label="Name"><input name="name" /></Field>
		<Field name="email" label="Email"><input name="email" type="email" /></Field>
		<button type="submit">Sign up</button>
	</Form>
}
```

- `Form`: `action` = URL string (FormData POST) OR a `defineAction()` result/
  stub (JSON POST). Submit priority: `onSubmit` > object action > string URL.
  Events on the form element: `vsk-loading`, `vsk-success`, `vsk-error`.
  While submitting: `vsk-submitting` class + submit button disabled.
  `onSubmit(data, form)`, `onError(err)`, `onSuccess(res)`.
- `Field`: `name` (required), `label`, `rules?`, `errorClass?`; SSR marks
  `data-vsk-field="{name}"`; client writes first failing rule message into
  `data-vsk-error`. No-JS post-back failure re-renders referer with
  `__vesk_action_errors`.

### Validators (`{ validate(v): boolean, message }`)

`required(msg?)`, `email(msg?)`, `minLength(n, msg?)`, `maxLength(n, msg?)`,
`pattern(re, msg?)`, `custom(fn, msg?)`. All except `required`/`custom` pass
on empty values (optional fields).

### defineAction

- `defineAction(id, { input?, execute })` (explicit id) or
  `defineAction({ input?, execute })` (id from source hash). Returns
  `{ id, url: '/_vesk/action/<id>', input, execute }`. `execute(input, ctx)`
  runs ONLY on server. Endpoint `POST /_vesk/action/:id`.
- `getAction(id)`, `clearActions()`, `isFormAction(action)`,
  `validateActionInput(def, input)` → `[{ field, message }]`,
  `issuesToFieldMap(issues)`.
- `ActionContext`: `{ request, params, url, headers(), cookies(), locals(), redirect(url, status=303) }`.

### Round-trip

| Client | Server response |
| --- | --- |
| JS fetch (object action) | `200 { ok,data }` or `200 { ok:false, issues }` |
| No-JS native POST | failure re-renders referer with errors; success 303-redirects back |
| Cross-site browser submit | **403** (same-origin CSRF) |
| Unknown action id | **404** |

Body parsing: JSON, multipart/form-data, urlencoded, text→JSON; capped
(default 1 MiB → 413).

Plain forms: `<Form action="/api/contact">` POSTs raw FormData to the URL —
pair with an API route calling `req.formData()`.

## Two-Way Bindings

`bindValue`, `bindChecked`, `bindGroup` — **ref-style callbacks**, attach via
`ref={…}`. **Import explicitly** (not auto-imported). Always destructure the
raw cell (`&[v, cell]`) and pass the cell itself — passing a plain value
throws "not a tracked object" TypeError.

```vsk
import { bindValue, bindChecked, bindGroup } from '@vesk/runtime';

component NameField() {
	let &[name, nameCell] = track("")
	<input ref={bindValue(nameCell)} />
	<p>Hello, {name}</p>
}

component Toggle() {
	let &[dark, darkCell] = track(false)
	<input type="checkbox" ref={bindChecked(darkCell)} />
}
```

- `bindValue`: `input` event (or `change` on select; multi-select → array of
  checked option values); number/range coerce `'' → null`, else numeric;
  skips redundant state→DOM writes (avoids cursor fights).
- `bindChecked`: checkbox boolean, `change` event.
- `bindGroup`: radio (selected string) + checkbox group (array membership).

## API Routes (`app/api/**/route.ts` or `.js`)

```ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
	return VeskResponse.json({ message: 'Hello!' })
		.setCookie('session', 'abc', { httpOnly: true, secure: true, maxAge: 3600 })
		.setStatus(201)
		.cors({ origin: 'https://app.example.com', methods: 'GET,POST' });
}

export async function POST(req) {
	const body = await req.json();
	return VeskResponse.json({ received: body });
}
```

- Verbs: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
  Unimplemented → `405 { error }` + `Allow`; `OPTIONS` auto-answers 204.
- Non-`Response` returns JSON-serialized with 200. Thrown `redirect(url)` →
  HTTP redirect (status || 302); `notFound()` → 404 JSON.
- Dynamic/catch-all segments match pages; `params` is a Promise
  (Next-compatible): `const { msg } = await params`.

### Route config & hooks

```ts
export const config = { csrf: false, maxDuration: 10 };   // opt out CSRF; AbortController timeout
export async function beforeRequest(req, ctx) { /* return Response to short-circuit */ }
export async function afterRequest(res, ctx) { return res; }
```

- `config.csrf !== false` enforces same-origin check on mutating verbs →
  cross-site browser calls get **403**.
- `maxDuration` (seconds) wraps execution in AbortController.
- Global hooks via `runHooks('beforeRequest' | 'onError' | 'afterRequest')`.

### Ambient request helpers (`@vesk/runtime/server`)

`useParams()`, `useBody()`, `useRequest()`, `cookies()`, `headers()`,
`locals()`, `withValidation(req, schema, opts?)`.

### VeskRequest extras

`parsedUrl`, `query` (flattened searchParams), `ip` ('unknown' unless
trustProxy), `protocol`, `hostname`, `await req.body` (lazy parse),
`setTrustProxy(true)`.

### VeskResponse builders

`VeskResponse.json/html/redirect(url, status=307)/rewrite(url)/next()`.
Chain: `.setStatus(n).setCookie(name,val,opts).clearCookie(name).setCsp(policy|false)
.setSecurityHeader(name,val|false).cache(ttlSeconds).noCache()
.cors({origin,methods,headers,credentials}).build()`.
`await res.text()/json()` flush pending headers. Cookie defaults are
safe-by-default: **httpOnly + secure ON** unless explicit `false`,
`sameSite='Lax'`, `path='/'`.

### Validation (zod-compatible safeParse)

```ts
const data = await withValidation(req, LoginSchema);
if (data instanceof Response) return data;
return VeskResponse.json({ ok: true, data });
```

Failure → 400 `{ error:'Validation failed', issues:[{path,message}] }`.

### CORS / webhooks

```ts
const c = cors({ origin: 'https://app.example.com' });
export async function GET(req) {
	const pre = c(req);                 // OPTIONS → 204 preflight
	if (pre) return pre;
	return c.applyCors(VeskResponse.json({ ok: true }));
}

const stripeHook = webhook({ secret: process.env.STRIPE_SECRET!, handler: (event) => fulfill(event) });
export const POST = stripeHook;        // invalid sig → 401
```

- Config-level `security.cors` applies automatically in prod server; helper
  only for custom servers. `cors.credentials` opt-in, never with wildcard origin.

### Signed cookies

`signCookie(name, value, host?)` → "value.signature" (HMAC-SHA256);
`unsignCookie(name, signed, host?)` → original or null;
`setSignedCookie` / `readSignedCookie`. Sites to a deployment host optionally.

## Middleware (onion model)

`app/middleware.ts` applies globally; a `middleware.ts` in any route dir
applies to that subtree; files chain root → leaf.

```ts
import type { MiddlewareContext } from '@vesk/compiler';
export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
	ctx.set('startTime', Date.now());
	const res = await next();
	console.log('took', Date.now() - ctx.get('startTime'), 'ms');
	return res;
}
```

Rules:
- **Always `return await next()`** (or its response) — dropping it discards
  the rendered response.
- Return a `Response` to short-circuit (never reaches page).
- `next('/new-path')` rewrites the URL for the rest of the chain.
- Locals set via `ctx.set()` visible during SSR (`locals()`) and API routes.

### MiddlewareContext

`{ request, params, url, locals, cookies, set(key,v), get(key), [key]: any }`
(`ctx.user === ctx.locals.user`).

### Redirects / rewrites / client middleware

```ts
export async function middleware(ctx, next) {
	if (!ctx.cookies.get('session')) {
		return Response.redirect(new URL('/login', ctx.url), 302);
	}
	if (ctx.url.pathname.startsWith('/old')) {
		const res = await next('/new');       // internal rewrite
		res.headers.set('x-rewritten', '1');
		return res;
	}
	return next();
}
```

`createFileRouter(tree, { middleware: [async (ctx, next) => …] })` — client
ctx `{ url, params, router, locals }`; throwing `redirect()`/`notFound()` →
replace-nav / not-found UI.

Middleware edits hot-reload in dev. Middleware responses honored on API
routes in dev exactly as production.

## Cookies

- Read: `cookies()` (CookieStore → `get/getAll/toString`). Server reads
  `Cookie` header via ambient context; browser falls back to `document.cookie`.
  Middleware: `ctx.cookies.get('sid')`.
- Write: `VeskResponse.setCookie(name, value, opts)` — defaults httpOnly+secure
  ON, sameSite Lax, path `/`. `.clearCookie(name)` → maxAge 0.
- Signed: HMAC-SHA256 helpers above.

## Configuration (`vesk.config.ts` / `.js`)

Everything optional, validated at CLI start. Every key + default:

```ts
import { defineConfig, preset } from '@vesk/compiler';
import tailwindcss from '@vesk/plugin-tailwind';

export default defineConfig({
	appDir: './app',            // default './app'
	outDir: '.vesk',            // default '.vesk' (resolved relative to appDir parent)
	publicDir: './public',      // default './public'

	security: preset('production', { trustProxy: true }),  // see below
	// security: false                                    // everything off

	plugins: [ tailwindcss({ entry: 'src/global.css', appDir: 'app' }) ],

	ssg: {},                    // prerender pages exporting getStaticPaths/Props

	routeDataCache: 0,          // ms SPA route-data TTL; 0 = always refetch

	md: { html: 'escape' },     // 'escape' | 'allow' | 'allowlist'
});
```

### VeskSecurity (defaults = strict preset)

`autoEscape:true`, `csrf:true`, `xFrameOptions:'DENY'`,
`contentSecurityPolicy` (self-only + style-src 'unsafe-inline' for component
styles), `hsts:'max-age=31536000; includeSubDomains'`,
`referrerPolicy:'strict-origin-when-cross-origin'`, `cors`, `trustProxy`,
`rateLimit:{windowMs:60000,max:100}`, `redactLogs:true`.

Presets: `preset('production')` (='strict'; everything above),
`preset('development')` (strict minus CSP, HMR-friendly),
`preset('minimal')` (autoEscape only; SAMEORIGIN; no CSRF/HSTS/CSP), or
`security: false`. Compose: `preset('production', { trustProxy: true })`.

Normalization: unknown preset names throw; `md.html` ∈
escape|allow|allowlist; plugins must have name + ≥1 hook (`onCSS`,
`onFileWatch`, `onTransformJS`, `onBuildStart`, `onBuildEnd`, `onRequest`) or
a non-empty `provides` record. A broken prod config **fails closed** (secure
defaults + loud warning). Config load order: `.env` → `.env.local` →
`vesk.config.js` (preferred over `.ts`, transpiled, `@vesk/compiler` globals
injected) → `defineConfig()` → `validateConfig()`.

API: `defineConfig`, `preset(name, overrides)`, `definePlugin`, `validateConfig`,
`MD_DEFAULT_ALLOW_TAGS`.

## Security (on by default)

- **CSRF**: mutating requests (POST/PUT/PATCH/DELETE) from browsers need
  `Origin`/`Referer` authority equal to request `Host`; cross-site browser
  submissions → 403. Applies to server actions + API routes (opt out per-route
  with `export const config = { csrf: false }`).
- **Rate limiting**: keyed by client IP (proxy headers honored only when
  trustProxy); 429 + Retry-After. Applied automatically by `vesk start`.
- **Body limit**: `maxBodyBytes` default 1 MiB → 413.
- **Error exposure**: detailed errors render only outside production
  (`vesk start` sets `NODE_ENV=production`).
- **Serialization safety**: inline data scripts through `safeJsonForScript()`
  (escapes `<` and U+2028/2029, blocking `</script>` breakout).
- HMR WebSocket origin-checked against loopback; HMR eval hook nonce-gated.
- Static/prerendered paths resolved through a containment helper.

## SSG

```ts
export default defineConfig({ ssg: {} });
```

- `getStaticProps` (sync or async) on `page.vsk`: returned `props` spread into
  page props + serialize into the page data script.
- `getStaticPaths` (for dynamic routes): `paths: [{ params: { slug } }]` — one
  HTML per path. Paths are containment-checked (can't write outside
  `prerendered/`).
- Output under `prerendered/` (`index.html`, `about.html`, `blog/hello.html`).
  Prerendered pages ship **no client JS** when fully static. XML sitemap
  prioritizes them (0.80/weekly).
- Unlisted dynamic paths fall through to SSR. Pair with ISR.

## ISR (stale-while-revalidate)

- `revalidate` in **seconds**; `revalidate <= 0` (default) disables caching.
- Fresh hit → cached, `stale:false`. Expired → stale value returned
  immediately + background refresh; failed refresh keeps stale entry.
- Page-level:

```vsk
// in any page.vsk
export const revalidate = 60
export const isrTags = ['posts']
```

- Direct `@vesk/runtime/server` API: `isr(key, fetcher, {tags,revalidate})` →
  `{data, stale}`; `pageIsr(path, renderFn, opts)`; `componentIsr(key, renderFn,
  opts)` (tag index `comp:<key>`); `revalidatePath(path)` (prefix-inclusive;
  trailing slashes collapse); `revalidateTag(tag)`; `revalidateComponent(key)`;
  `clearIsrCache()`; `isrConfigToRevalidate(config)`.

## Built-In Headless Primitives (`Show`/`For`/`Switch`/`Match`)

**Import explicitly** (not auto-imported). **Call as expressions** inside
`{…}` — a bare statement call compiles but renders nothing. Object-literal
props can't contain literal JSX — pass strings/numbers/nested arrays or
precomputed values.

```vsk
import { Show, For, Switch, Match } from '@vesk/runtime';

<div>{Show({ when: user, children: 'Signed in', fallback: 'Guest' })}</div>
<ul>{For({ each: tags, children: (t, i) => <li>{t}</li>, fallback: 'untagged' })}</ul>
```

- `Show({ when, children, fallback })`
- `For({ each, children: (item, index) => …, fallback })`
- `Switch({ children, fallback })` + `Match({ when, children })`

> Prefer native statement-mode `if`/`for` (live reactive regions); these
> primitives are for JSX expressions and shared render helpers.

## Other Built-Ins (auto-imported)

- `<Portal target>` — teleport DOM nodes to another target.
- `<Md>` — markdown component; GFM tool; configurable raw-HTML policy via
  `vesk.config.ts` `md.html` (`escape`/`allow`/`allowlist` with default
  allowTags list); `<Image>` responsive images + sharp pipeline;
  `<Experiment>` A/B testing.
- Consider importing `Md`/`Image`/`Portal`/`Experiment` explicitly if not on
  the auto-import list (check the Components auto-import section above).

## Conventions & Pitfalls (checklist)

- **Statement mode is first-class & preferred for pages.** Cover both modes;
  don't write only expression-mode.
- **Never import `batch`** — use `flushSync`.
- **TrackDecl syntax** is `let &[x] = track(0)`; bind the raw cell as the
  second name when passing to `bindValue`/`untrack`/`peek`/isr `into`.
- **`on*` handlers never appear in SSR HTML.** Don't rely on them server-side.
- **Form values are property bindings**, not attributes.
- **No `<slot/>`** — only `{props.children}`.
- **Search params are not props** — use `useSearchParams()`/`useRouter().search`.
- **Middleware must `return await next()`** or the response is discarded.
- **Islands capture browser-only APIs** (`window`/`document`) inside
  `client` components or effects/`{#client}` blocks — never at top level of a
  server-rendered body.
- **API route `params` is a Promise** — `await params`.
- **Angle-bracket `<T>expr` assertions don't work** — use `as`. Generic arrows
  need `<T,>`.
- **Tailwind doesn't scan dynamic class bindings** — keep classes static.
- **Island/`#server`/`#client` validation** is enforced by the compiler —
  server components can't use `{#client}`, islands can't use `{#server}`.
- After editing `packages/compiler/src`, run
  `npx tsx packages/cli/src/build-packages.ts` before probing.
