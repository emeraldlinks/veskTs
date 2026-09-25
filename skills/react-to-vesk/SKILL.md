---
name: react-to-vesk
description: >-
  Convert any React, Next.js, or TanStack application to Vesk (.vsk) with
  absolute precision and zero hallucinations. Use when a task involves
  migrating porting translating or rewriting React code (JSX/TSX components,
  useState/useEffect/useMemo/useRef/useContext, React Router, TanStack Router
  or Query, Redux, Zustand, react-hook-form, styled-components, CSS modules)
  or Next.js apps (app router pages/layouts/error/loading, pages router,
  getServerSideProps/getStaticProps/SSR/ISR, API routes via
  VeskRequest/VeskResponse, middleware, server actions) into the Vesk
  compiler-first framework. Also use when converting a
  .tsx/.jsx file to a .vsk file by hand. Never invents React APIs in Vesk
  output; every mapped construct has a documented Vesk equivalent in the
  official Vesk skill: read skills/vesk/SKILL.md first for the canonical Vesk
  API reference. Prefers statement mode. Validate every conversion with `vesk
  typecheck` and the production hydration suite before declaring done.
---

# React → Vesk Conversion Skill

This skill turns React/Next.js/TanStack code into correct, idiomatic Vesk
code. It is built on the **canonical Vesk API reference** — always load the
`vesk` skill first and treat every mapping below as a *decision rule*, not a
substitute for reading `skills/vesk/SKILL.md`.

## Ground rules (read first, they prevent almost every hallucination)

1. **Vesk has no hooks and no VDOM.** `component` is a keyword; state is
   `track()` cells; effects auto-track dependencies; the compiler emits DOM
   updates per cell. Do not emit `useState`/`useEffect`/`useMemo`/
   `useCallback`/`useContext`/`useRef` — there is no React runtime to host
   them.
2. **Know both body modes.** Expression mode (`return <jsx>`) maps 1:1 from a
   React component's `return`. Statement mode (bare JSX next to `if`/`for`/
   `switch`/`try`, guard-clause early returns) is Vesk's native, preferred
   style for pages. **Convert interactive/paginated components to statement
   mode; only pure presentational components may stay in expression mode.**
   Never produce a conversion that uses one mode where both are exercised by
   the feature (see AGENTS.md: statement mode is first-class and must be
   covered).
3. **Auto-imported identifiers are free.** Inside a component body you can use
   `effect`, `derived`, `untrack`, `peek`, `tick`, `flushSync`, `on_destroy`,
   `createContext`, `useFetch`, `createResource`, `useRouter`, `useParams`,
   `usePathname`, `useSearchParams`, `useNavigate`, `defineAction`,
   `Form`/`Field`, validators (`required`, `email`, `minLength`, `maxLength`,
   `pattern`, `custom`), `Link`, `NavLink`, `Outlet`, `Redirect`, `redirect`,
   `permanentRedirect`, `notFound`, `NotFoundError`, `Image`, `JsonLd`, SEO
   schema helpers, `Portal`, `Experiment`, `LoadingIndicator`. **Not
   auto-imported** (must `import { … } from '@vesk/runtime'`): `track`,
   `Show`/`For`/`Switch`/`Match`, `Md`, `bindValue`/`bindChecked`/`bindGroup`,
   `pre_effect`. Router extras come from `@vesk/runtime/router`; server-only
   helpers from `@vesk/runtime/server`.
4. **Never emit `batch`.** It does not exist. For a synchronous multi-cell
   write use `flushSync(fn)`.
5. **No `<slot/>`, no `React.Fragment` import** — children flow through
   `{props.children}`; fragments are `<>…</>`.
6. **Search params are not props.** Convert `useSearchParams()[0].get('q')`
   via `useSearchParams()` (returns `[URLSearchParams, setter]`); nav-based
   params stay in `props.params`.
7. **Everything you emit must exist in the reference.** If you are unsure an
   API exists, stop and read `skills/vesk/SKILL.md` or the source in the repo
   instead of guessing. When the source React uses an obscure npm library,
   map to the closest canonical Vesk primitive and say so explicitly in the
   conversion notes — do not invent a Vesk shim.
8. **Validation is part of the job, not an afterthought.** After a conversion
   run `npx vesk typecheck`; for any reactivity/hydration work also run the
   production hydration suite. Fix what they surface. A "done" conversion is
   one that typechecks and hydrates in both body modes where applicable.

## Conversion workflow

Follow this exact order. It detects collisions early and prevents
rework.

### Step 0 — Reconnaissance (never skip)

1. **Inventory** every `.jsx`/`.tsx`/`.js`/`.ts` file and classify each:
   - React component (stateful / stateless / presentational)
   - Page / layout / loading / error / not-found
   - API route / server action / middleware / `getServerSideProps`
   - Router / route config / provider wiring / theme etc.
2. **Map routing**: Next.js `app/` and `pages/` directories map 1:1 onto
   Vesk's `app/` directory. Note every dynamic segment `[slug]`, catch-all
   `[...path]`, route group `(group)`, and layout. TanStack Router route
   configs become either Vesk file-based routes or a `createRouter`/`defineRoute`
   programmatic tree.
3. **Map data fetching**: classify each data source into one of Vesk's four
   channels — (a) async page component awaiting `useFetch`, (b) `useFetch`
   with `key` + `into` for client-side cells, (c) `getStaticProps`/SSG →
   `getStaticProps` (same name) or static module data, (d) `getStaticPaths`.
5. **Map server code**: Next API routes → `app/api/**/route.ts` with
   `VeskRequest`/`VeskResponse`; `'use server'` actions → `defineAction`;
   `middleware.ts` → Vesk middleware (onion model, **always `return await
   next()`**).
6. **Produce a conversion manifest** — a table of source file → target file →
   key transformations — and show it before writing any code. This makes
   every mapping auditable and reduces drift.

### Step 1 — Scaffold

```sh
npx create-vesk@latest app-name
cd app-name
npm install
```

Then lay out directories to mirror the source apps. If you are porting a
Next.js `app/` directory, copy it in and move files 1:1 (see Step 3).

### Step 2 — Convert shared (non-page) code first

Modules with no JSX — types, constants, `lib/`, data-access layers, hooks
that are pure logic — convert before pages. This makes components mechanical.

| React / TanStack | Vesk | Notes |
| --- | --- | --- |
| `export const useThing = () => …` custom hook (pure logic) | plain function | No hooks rules; call it from component body or module scope. Authored as TS/`.vsk` module function. |
| Custom hook reading events/window/document | declare `client` component, or keep the logic as an `effect` + `track` cells | Browser APIs must live under a client island or inside `effect()`/`{#client}` — never at top level of a server-rendered body. |
| Redux store / Zustand store | module-scope `track` cells + `derived` selectors | e.g. `const &[count, raw] = track(0)` at module scope, exported `increment()` functions. Prefer explicit data flow over a global store. |
| `react-query` / SWR provider | `useFetch` + shared `key` | Server dedupes per key; multiple components sharing a key share one cache entry and update together. |

A pure-logic hook that returns an object with functions converts to a plain
function returning the same object — call it once in each component body and
rely on `track` cells inside for reactivity.

### Step 3 — Convert JSX to the two body modes

Decompose each JSX component by its structure:

- **Single `return` with no conditionals/loops above it and no state**
  → expression mode, verbatim JSX, swap attribute names.
- **Anything with state, effects, conditionals, `.map()`, guards, or forms**
  → statement mode. Spread the JSX across the body as bare statements.

Attribute/fragment swaps (global, apply everywhere):

| React | Vesk |
| --- | --- |
| `className=` | `class=` |
| `htmlFor=` | `for=` |
| `onClick`/`onChange`/`onSubmit`/… | same camelCase `on*` (native event object passed) |
| `style={{ color: 'red' }}` inline object | inline style objects also work; keep `style` as-is |
| `<></>` | `<>…</>` (same) |
| `<Fragment>` | `<>…</>` |
| `&&` / ternary in return | statement-mode `if/else`; ternary is still valid inside `{…}` for text |
| `prop={condition}` | same |
| `<img …/>` | `<Image>` not required — plain `<img>` works; `<Image>` for responsive/processing |
| `href` on React Router links | `<Link href="…">` |

Event handlers must not do anything that relies on the handler string being
in SSR HTML — **`on*` handlers are excluded from SSR HTML entirely** and only
attach during hydration. Side-effecting top-level module code in a page is
server-rendered, so move `document`/`window` access into effects/`{#client}`.

### Step 4 — Convert hooks (the mapping table)

Use this table during Step 2/3. Each row is validated against
`skills/vesk/SKILL.md`.

#### State

| React | Vesk | Example |
| --- | --- | --- |
| `useState(0)` | `let &[count] = track(0)` | writes via `count = count + 1` or `count++`; reads `count` |
| `useState<T>` typed | `let &[x] = track<T>(init)` | `let &[posts] = track<Post[]>([])` |
| need the raw cell (event sink, `bindValue`, `peek`, `untrack`) | second binding: `let &[v, cell] = track(init)` | `const &[name, nameCell] = track('')` |
| setter with functional update `setC(c => c + 1)` | write the expression directly | `count = count + 1` |
| `useReducer` | compose `track` cells + `flushSync`; or a reducer function + cell | not a primitive — restructure |
| React `useState` object `{a: 1, b: 2}` | `let &[s] = track({a: 1, b: 2})` then `s = { ...s, a: 2 }` | cell value is whole immutable snapshot |
| `useState` initialization from props | same — `track(props.x)` | |

**Order of declaration matters**: `track()` calls must appear at the top of
the component body (both modes), before any conditional/loop regions that use
them; keep them in the same relative order as `useState` calls.

**Never** call `track()` inside a conditional, loop, or callback. The
compiler rewrites `&[x]` bindings structurally; putting declarations inside a
region is unsupported. If you must allocate per-item state, use
`const &[v, cell] = track(…)` *inside* a keyed `for` in statement mode (a
loop-scoped track is fine — it belongs to that item region).

#### Effects & derived

| React | Vesk | Example |
| --- | --- | --- |
| `useEffect(fn, deps)` | `effect(fn)` | no dependency array; dependencies auto-tracked by reads |
| `useEffect(fn, [count])` reading only `count` | `effect(() => { … count … })` | running only when tracked deps read inside change |
| `useEffect(..., [])` once | `effect(() => { … })` with no tracked deps read inside | deps auto-tracked → static body runs once |
| effect cleanup `return () => …` | `return () => …` or `on_destroy(() => …)` | same cleanup contract |
| `useLayoutEffect` | `pre_effect` (import explicitly) | runs before ordinary effects |
| `useMemo(() => x, [deps])` | `derived(() => x)` bound via `&[m]`; or plain `const` if not consumed reactively | `let &[doubled] = derived(() => count * 2)` |
| `useCallback(fn, deps)` | none | functions are cheap closures; no re-render optimization exists |
| `useId` | static `id` / manually generated | no auto id hook — keep SSR/client id stable |
| `useDeferredValue`, transitions, `useTransition` | `tick()` / `effect` + cells | no React transition primitive — restructure with `flushSync` + explicit state |
| reading a dep in `useMemo` you don't want to retrigger | wrap in `untrack(() => …)` | |

Derived cells are write-inhibited — writing to `derived()` throws.

**StrictMode double-invoke differences**: Vesk does not double-invoke
effects in dev. `effect(fn)` runs immediately. Do not port StrictMode-isms.

#### Refs & DOM

| React | Vesk | Example |
| --- | --- | --- |
| `useRef(domEl)` + `<div ref={el}>` | `ref={fn}` callback, or `const &[_, elCell] = track(null)` + `ref={(n) => elCell.set(n)}` | callback receives the element after creation, stripped from SSR |
| imperative handle (`useImperativeHandle` + `forwardRef`) | parent passes a `ref` cell or callback prop down | no forwardRef; pass the raw cell as a prop |
| mutable value ref (interval id, previous value) | `const &[_, raw] = track(init)` or a plain module/closure variable | read/write via `raw.get()`/`raw.set()`; never use it to render |
| `dangerouslySetInnerHTML` | `<Md>` (escaped by default) or `Html`-style raw attribute | never `dangerouslySetInnerHTML` — Vesk escapes dynamic text on SSR; go through `<Md>`/raw-html policy |
| `createPortal` | `<Portal target="…">` | auto-imported |
| `flushSync` from react-dom | `flushSync(fn)` auto-imported | same name, same purpose |

#### Context

| React | Vesk | Example |
| --- | --- | --- |
| `createContext(default)` + `useContext` | `createContext(default)` + `Theme.get()`/`Theme.set(x)` | provider = `.set()` at top of parent body; consumer = `.get()` anywhere below |
| `<Provider value={…}>` wrapper | `Theme.set(x)` (no wrapper element) | scopes to nearest active component subtree |
| context default | `createContext(default)` | `.get()` falls back to default if no ancestor set |

Context isn't a hook pair — it's a global object with `get`/`set`. Convert
`const t = useContext(Theme)` → `const t = Theme.get()`. When a component
should scope a value, call `.set()` at the top of its body (before any JSX).

#### Data fetching

| React/TanStack | Vesk | Example |
| --- | --- | --- |
| server component `async` + `fetch` | `async component` + `await useFetch(url)` | resolved during SSR; `PromiseLike` result readable after await |
| `useQuery` / SWR | `useFetch(url, { key, into, staleTime, retry, keepPreviousData, dedupe })` | auto-imported; server dedupes, hydrates, no refetch on load |
| `useMutation` | `defineAction` (server) + `useFetch`/fetch for custom | mutations belong server-side |
| `useQuery` with `enabled: false` | `enabled: false` | same option name |
| `useQueryClient.invalidateQueries` | `mutate(key)` (import from `@vesk/runtime/src/resource`) | invalidate + refetch every live resource with that key |
| per-cell updates (streaming/progress) | `useFetch.stream` with `into` + `onChunk` | progressive text into a tracked cell |
| `Promise`-based manual fetch in component | `useFetch` or a plain `await fetch` inside `async component` | prefer `useFetch` for cache+SSR |
| SSR data rehydration (SWR fallback / `dehydrate`) | automatic — server results serialize into a data script | no manual `dehydrate`/`HydrationBoundary` needed |
| `useInfiniteQuery` | manual `track` cells + pagination params + `mutate(key)` | not a first-class primitive — compose |
| tanstack-query retries | `retry` (extra attempts; GET only, never 4xx) | mirrors React Query shape |

`useFetch` result (`loading`/`error`/`data`) is also PromiseLike, and `refresh()`
forces a refetch. For a client-only fetch that writes into an existing cell,
pass the `into` option with a `&[arr, cell]` — the standard test-app pattern.

#### Client-only code & islands

| React | Vesk |
| --- | --- |
| `useEffect` + `window`/`document` | `effect` (runs in both modes) — or `client` island component + `effect` |
| component calling browser APIs unconditionally | annotate `client` after params: `component Clock() client { }` |
| a block/region with browser deps inline | wrap in `{#client}…{/client}` |

Rule: accessible browser APIs must be inside a `client` island or an
`effect`/`on_destroy`/`{#client}` block. If a converted component references
`window`/`localStorage`/`navigator` at top level, the conversion is wrong —
fix by making the component `client` or moving the access into an `effect`.

### Step 5 — Convert Next.js app-router features

Mirror the Next `app/` directory 1:1. Same names, `.vsk` extension.

| Next.js app/ | Vesk app/ |
| --- | --- |
| `layout.tsx` | `layout.vsk` (props `{ children, params }`) |
| `page.tsx` | `page.vsk` (props `{ params, …data }`; search params via `useSearchParams()`) |
| `error.tsx` (client component) | `error.vsk` (props `{ error, retry, params, statusCode, stack, url }`) |
| `not-found.tsx` | `not-found.vsk` (props `{ params, url }`) |
| `loading.tsx` | `loading.vsk` (props `{ params }`) |
| `route.ts` | `route.ts` under `app/api/**` |
| `middleware.ts` | `middleware.ts` (same path logic) |
| `page.tsx` + `generateStaticParams` | `page.vsk` + `getStaticPaths` (same concept) |
| `generateStaticParams` returning a Promise | `getStaticPaths` async — same |
| server `page.tsx` setting `export const revalidate` / `dynamic` | `export const revalidate` / ISR config on the page |
| SSR-only pages needing first-load data | `async component` awaited at SSR |

**Layout nesting** maps directly: `{props.children}` where React used
`{children}`. Nested layouts compose the same file tree. Route groups
`(marketing)/` keep their meaning (nesting without URL impact).

**Middleware conversion** requires preserving the onion chain. Return
`await next()` (or its response) when middleware needs to post-process or
return the downstream response. The framework also preserves the response when
middleware does `await next()` without returning it. A middleware that calls
neither `next()` nor returns a response short-circuits the chain. Keep the
same augmentation logic but restructure the tail. `ctx.set`/`ctx.get`/`ctx.locals`
map onto Next's request context.

**API routes**: Next `export async function GET(req: NextRequest)` →
Vesk `export async function GET(req: VeskRequest)`. Always import them
explicitly from the server barrel — they are **not** auto-imported:

```ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server'
// or type-only the request:  import type { VeskRequest } from '@vesk/types'

export async function GET(req: VeskRequest) {
	return VeskResponse.json(users)   // VeskResponse.json/html/redirect/rewrite/next/stream
}
```

`VeskRequest` extends `ServerRequest`; `VeskResponse` extends
`ServerResponse` (both available from `@vesk/runtime/server` too).
`VeskResponse` is fluent: `.setStatus(n).setCookie(n,v,o).setCsp(p).cache(s)
.noCache().cors(o)`. NextResponse.redirect(url) →
`VeskResponse.redirect(url)`. `cookies()`/`headers()` ambient helpers exist on
the request or via `@vesk/runtime/server`. Note `params` in Vesk API routes is
a **Promise** — `const { id } = await params`. Search params: `req.parsedUrl`
+ `req.query` (flattened), equivalent of `req.nextUrl.searchParams`.

**Server actions**: `'use server'` `async function` → `defineAction({ input:
{…}, execute })` at module top of the `.vsk` file; forms use `<Form
action={def}>` + `<Field>` + validators. The compiler rewrites actions per
bundle (server keeps `execute`, client gets a stub) — never ship `execute` to
the browser.

**SSG/ISR**: Next `revalidate`/`generateStaticParams` → Vesk `ssg: {}` config
+ `getStaticProps`/`getStaticPaths`, and page-level
`export const revalidate = 60` / `isrTags`. `unstable_revalidate…` → Vesk
`revalidatePath`/`revalidateTag` from `@vesk/runtime/server`.

### Step 6 — Convert TanStack Router / React Router

TanStack Router's explicit route config maps to Vesk either as file routes or
a programmatic router. Route tree/`createFileRoute`/`createRootRoute` →
`createFileRouter(tree, options)`; `createRouter({ routes })` with `defineRoute`
matches TanStack's `createRoute`. React Router's flat `createBrowserRouter`
also maps to `createRouter({ '/': …, '/blog/:slug': … })`.

| TanStack / React Router | Vesk |
| --- | --- |
| `<Link to="/a" className>` | `<Link href="/a" class="…">` (`@vesk/runtime/router`) |
| `useNavigate()` | `useNavigate()` — but call it and invoke: `const nav = useNavigate(); nav('/a')` |
| `useParams()` | `useParams()` |
| `useLocation()` | `usePathname()` |
| `useSearch()` / `useSearchParams()` | `useSearchParams()` → `[URLSearchParams, setter]` |
| `useRouter().navigate` | `useRouter().push('/a')` / `.back()` / `.replace()` |
| `<Outlet/>` | `<Outlet/>` |
| `<NavLink>` | `<NavLink href=… activeClass=…>` |
| route `loader` | async page SSR or `useFetch` — route-data fetched via `X-Vesk-Data` |
| configure redirects in route config | `Redirect` (status default 302) / `redirect(url)` / `permanentRedirect(url)` / `notFound()` (throwable) |
| beforeEnter guards | `router.beforeEach((to, from) => …)`; return `'/redir'` to redirect, `false` to block |
| `Navigate to=…` component | `Redirect` |
| search-params based filter state | `useSearchParams()` setter (replace-navs) |
| dynamic segments `<Route path="blog/:slug">` | `app/blog/[slug]/page.vsk` |

Prefetching and `routeDataCache` are opt-in config (`prefetch: true`,
`routeDataCache: ms`). View transitions: `viewTransitions: true`. Hydration
strategy: `hydrate: 'full' | 'viewport' | 'idle' | 'interaction'`.

### Step 7 — Convert forms & controlled inputs

| React | Vesk |
| --- | --- |
| controlled `value` + `onChange` | `bindValue` (ref callback; requires `&[v, cell]`) or `onInput` + direct cell write |
| React Hook Form + zod resolver | `Form` + `Field` + rules (`required`/`email`/`minLength`/`maxLength`/`pattern`/`custom`) |
| `onSubmit` preventDefault + fetch | `<Form action={…}>` + `defineAction` at module level |
| checkbox `checked` + `onChange` | `bindChecked` |
| radio/checkbox groups | `bindGroup` |
| uncontrolled forms (native) | keep — Vesk forms work without JS |

`bindValue`/`bindChecked`/`bindGroup` are not auto-imported — import them and
**always pass the raw cell**, not the unwrapped value:
`let &[name, nameCell] = track('')` then `<input ref={bindValue(nameCell)} />`.

Convert RHF's `register` + validators into `<Field name=… rules=…>` — Field
names must match input `name` attrs, and rules are `{ validate(v): boolean,
message }` descriptors. `defineAction`'s `input` accepts rule arrays
(`[required('…'), email('…')]`). `execute(input, ctx)` gets `{ request,
params, url, headers(), cookies(), locals(), redirect(url, status=303) }`.

### Step 8 — Convert styling

| React | Vesk |
| --- | --- |
| CSS modules (`styles.foo`) | scoped `<style>` element in the component + plain class names; no hashing needed |
| styled-components / emotion | `<style>` per component with `class=` selectors |
| Tailwind | keep — Tailwind v4 via `@vesk/plugin-tailwind` (`@import 'tailwindcss'` in `src/global.css`) |
| global `.css` | `src/global.css` (`vesk init` creates it) |
| `sx`/MUI | drop or inline `style={…}` / `<style>` blocks |

Warning: Tailwind does **not** scan dynamic class bindings
(`class={bool ? 'a' : 'b'}`). Keep a static occurrence of each class in
source or use the safelist.

### Step 9 — Verify (mandatory)

1. `npx vesk typecheck` — exit 0.
2. Exercise the converted routes in dev; confirm hydration and events fire.
3. For anything touching reactivity/hydration, run the production hydration
   suite (`node tests/hydration-test.mjs` from the repo's root with the dev
   server up). Unit tests alone are insufficient.
4. Grep the output for banned tokens, in order:
   - `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`,
     `useContext`, `useReducer`, `React.`, `import React`, `"react"` from
     npm, `styled`, `styled-components` —
5. Grep for `batch` — must be absent.
6. Confirm no top-level `window`/`document` outside `client` islands,
   effects, or `{#client}` blocks.
7. Confirm statement-mode coverage: every converted interactive page uses
   statement mode `if`/`for`/`switch` — not expression-only — since both
   modes are first-class in Vesk.

## Deterministic conversion recipes (copy-paste rules)

### Recipe A — stateful counter

```tsx
// source.tsx
export default function Counter({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  useEffect(() => document.title = `count: ${count}`, [count]);
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}
```

```vsk
// target: Counter.vsk (statement mode — interactive component)
export component Counter(props: { initial: number }) {
	let &[count] = track(props.initial)
	effect(() => { document.title = `count: ${count}` })
	<button onClick={() => count++}>{count}</button>
}
```

Note: `document.title` inside `effect` is safe (client-only execution);
top-level it would be wrong.

### Recipe B — list with loading

```tsx
// source.tsx
export default function Posts() {
  const { data, isLoading } = useQuery({ queryKey: ['posts'], queryFn: fetchPosts });
  if (isLoading) return <p>Loading…</p>;
  return (
    <ul>{data.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
  );
}
```

```vsk
// target: Posts.vsk (statement mode)
component Posts() {
	let &[posts, postsCell] = track<Post[]>([])
	useFetch('/api/posts', { key: 'posts', into: postsCell, staleTime: 30_000 })
	{#if loading}
		<p>Loading…</p>
	{/if}
	for (const p of posts; key p.id) {
		<li>{p.title}</li>
	}
}
```

`Loading…` comes from the `useFetch` `loading` state; in Vesk `useFetch`
itself exposes reactive `loading`. If you used `{#if loading}` make sure that
block is real — inside a component you can also write
`const { loading } = useFetch(…)`; the destructured `loading` binding is
tracked.

### Recipe C — controlled form

```tsx
// source.tsx
export default function Signup() {
  const [email, setEmail] = useState('');
  const onSubmit = (e) => { e.preventDefault(); fetch('/api/signup', { method: 'POST', body: JSON.stringify({ email }) }); };
  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Sign up</button>
    </form>
  );
}
```

```vsk
// target: Signup.vsk
import { Form, Field, required, email, defineAction } from '@vesk/runtime'

const signup = defineAction({
	input: {
		email: [required('Email is required'), email('Enter a valid email')],
	},
	execute: async (input) => {
		await createUser(String(input.email))
		return { ok: true }
	},
})

component Signup() {
	<Form action={signup}>
		<Field name="email" label="Email">
			<input name="email" type="email" />
		</Field>
		<button type="submit">Sign up</button>
	</Form>
}
```

### Recipe D — context

```tsx
// source.tsx
const ThemeCtx = createContext('light');
export function Pane() {
  const theme = useContext(ThemeCtx);
  return <div class={`pane-${theme}`}>…</div>;
}
export function App() {
  return <ThemeCtx.Provider value="dark"><Pane/></ThemeCtx.Provider>;
}
```

```vsk
// target: theme.vsk
import { createContext } from '@vesk/runtime'
const Theme = createContext('light')

component Pane() {
	const theme = Theme.get()
	<div class={`pane-${theme}`}>…</div>
}

component App() {
	Theme.set('dark')
	<Pane />
}
```

### Recipe E — dynamic route

```tsx
// app/blog/[slug]/page.tsx
export default async function Page({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  return <article><h1>{post.title}</h1><p>{post.body}</p></article>;
}
```

```vsk
// app/blog/[slug]/page.vsk
async component BlogPost(props: { params: { slug: string } }) {
	const post = await getPost(props.params.slug)
	<article>
		<h1>{post.title}</h1>
		<p>{post.body}</p>
	</article>
}
```

### Recipe F — TanStack Router route

```tsx
// routes.ts
export const routes = createRootRoute().addChildren([
  createRoute({ path: '/', component: Home }),
  createRoute({ path: 'blog', component: Blog }),
  createRoute({ path: 'blog/$slug', component: Post }),
]);
```

```vsk
// route tree via file routes:
// app/page.vsk, app/blog/page.vsk, app/blog/[slug]/page.vsk
// or programmatic:
import { createRouter, defineRoute } from '@vesk/runtime/router'
const router = createRouter({
	'/': Home,
	'/blog': Blog,
	'/blog/:slug': BlogPost,
}, { container: document.getElementById('root')! })
```

### Recipe G — Next API route to Vesk API route

```ts
// app/api/users/route.ts (Next)
export async function GET(req: NextRequest) {
  const users = await db.users();
  return NextResponse.json(users);
}
export async function POST(req) {
  return NextResponse.json({ created: true }, { status: 201 });
}
```

```ts
// app/api/users/route.ts (Vesk)
import { VeskRequest, VeskResponse } from '@vesk/runtime/server'
export async function GET(req: VeskRequest) {
	const users = await db.users()
	return VeskResponse.json(users)
}
export async function POST(req: VeskRequest) {
	return VeskResponse.json({ created: true }).setStatus(201)
}
```

### Recipe H — middleware

```ts
// Next middleware.ts
export async function middleware(req) {
  if (!req.cookies.get('session')) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}
```

```ts
// Vesk middleware.ts
export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
	if (!ctx.cookies.get('session')) {
		return Response.redirect(new URL('/login', ctx.url), 302)
	}
	return next()
}
```

### Recipe I — memoized derived

```tsx
const doubled = useMemo(() => count * 2, [count]);
const incCallback = useCallback(() => setCount(c => c + 1), []);
```

```vsk
let &[doubled] = derived(() => count * 2)
// no callback needed — inline the handler where used
<button onClick={() => count++}>+</button>
```

### Recipe J — refs to cells

```tsx
const inputEl = useRef<HTMLInputElement>(null);
useEffect(() => inputEl.current?.focus(), []);
```

```vsk
const &[_, inputCell] = track<HTMLInputElement | null>(null)
effect(() => { inputCell.get()?.focus() })
<input ref={(el) => inputCell.set(el)} />
```

## High-confidence decision table (when you can't read the reference)

When a conversion question has no exact row (rare), apply these principled
substitutions and flag them in the manifest as "decision":

| Question | Default decision |
| --- | --- |
| React + TS + Vite/Webpack, no framework | scaffold `create-vesk`; convert components to `.vsk`; wire router if multi-route |
| React component using an unstyled UI library (MUI/Tailwind UI/etc.) | keep markup + classnames, drop the lib; per-component `<style>` or Tailwind |
| Next pages router (`pages/foo.tsx`) | `app/foo/page.vsk`; `getServerSideProps` → async page component or `useFetch` |
| `getStaticProps` returning props | `getStaticProps` on the `.vsk` page; props spread into page props |
| `getStaticPaths` | same name — `getStaticPaths` |
| `next/image` | `<Image>` (Vesk's) |
| `next/head` / metadata | `<Head>` |
| Next API route (`route.ts` handlers) | `export async function GET(req: VeskRequest)` + `VeskResponse.json/…` from `@vesk/runtime/server` |
| `NextResponse.json/redirect/next` | `VeskResponse.json/redirect(url, 307)/next()` |
| `next/link` | `<Link href=…>` (`@vesk/runtime/router`) |
| `next/script` | `<Head>`-managed `<script>` or plain element |
| `next/dynamic` | unnecessary — code-splitting is automatic per route |
| `next/navigation` `useSearchParams` / `usePathname` / `useParams` | `useSearchParams()` / `usePathname()` / `useParams()` from the Vesk router (distinct import path) |
| React Router `Routes`/`Route` declarative nesting | Vesk file routes (preferred) |
| Redux Toolkit `createSlice` | module-scope `track` cells with exported action functions |
| Zustand `create<State>()` | module-scope cells + `derived` selectors |
| axios | native `fetch` (or `useFetch(url)` when inside a component) |
| `intl` / `react-i18next` | any TS library still works — keep it; Vesk is a TS superset |

## Anti-patterns (each one is a hallucination the skill exists to prevent)

1. **Emitting any React hook or `import React`** in `.vsk` output.
2. **Emitting `batch`** — it doesn't exist; use `flushSync`.
3. **Using `useEffect` with deps** or claiming "this would be
   `useEffect(fn, [x])`" anywhere in final output.
4. **`<slot/>`, `<Fragment>`, `React.Children`, `children.map` utilities**
   — only `{props.children}`.
5. **Putting `window`/`document`/`localStorage` at top level of a default
   (server-rendered) component body.**
6. **`className`** anywhere — always `class`.
7. **Controlled-input `value` + `onChange` pair without `bindValue` or an
   `into` cell write** — a plain `value={}` prop without a write channel is
   dead on SSR hydration.
8. **Passing the unwrapped value to `bindValue`** — `bindValue(name)` throws;
   pass `nameCell`.
9. **Middleware** — return `await next()` when post-processing the response;
   `await next()` without returning is supported, but calling neither `next()`
   nor returning a response short-circuits the chain.
10. **Assuming `useParams` in a server-only module** — the server re-exports
    it as `routerParams`; request-side `useParams()` exists too. Match the
    import point to the context.
11. **Porting `StrictMode` double-effects or `React.memo`** — neither concept
    survives; remove them.
12. **`<T>expr` assertions** — use `as`, and generic arrows need `<T,>`.
13. **Treating `useFetch` like a promise-only** fetch and ignoring
    `loading`/`error`/`into` — in SSR/hydration paths the data comes through
    the data script; read the result reactively.
14. **Expression-only conversions** of interactive pages — statement mode is
    first-class; interactive/paginated pages convert to statement mode.
15. **Inventing a Vesk route config API** — file routes and
    `createRouter`/`defineRoute` are the only two; anything more is fiction.

## Final gate

Before reporting a conversion complete:

- [ ] Manifest for source → target mapping shown and reviewed
- [ ] `npx vesk typecheck` passes
- [ ] Converted pages render + hydrate in dev (and production hydration suite
      where reactivity/hydration is involved)
- [ ] Banned-token grep clean (`use*`, `React.`, `import React`, `batch`)
- [ ] No top-level browser-API access in server-rendered bodies
- [ ] Statement mode used for interactive pages
- [ ] Every server-side concept (actions, API routes, middleware, SSG/ISR,
      head, routing) maps to a documented Vesk API — not an invented one

When in doubt, the canonical `vesk` skill wins; if it doesn't cover a case,
read the source or say "not covered — flagged" rather than invent.