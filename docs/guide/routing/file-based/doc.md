# File-Based Routing

Vesk scans your `app/` directory (configurable via `appDir`) and builds a
route tree automatically — pages, layouts, boundaries, middleware.

## Conventions

Each directory may contain these exact filenames:

| File | Role |
| --- | --- |
| `page.vsk` | The route's page component |
| `layout.vsk` | Wraps everything beneath this directory |
| `loading.vsk` | Instant placeholder during SPA navigation — see [Loading States](../loading-states/doc.md) |
| `error.vsk` | Error boundary for this subtree — see [Error Handling](../error-handling/doc.md) |
| `not-found.vsk` | 404 UI for unmatched URLs in this subtree |
| `offline.vsk` | Dedicated offline UI when navigation fails offline — see [Offline & Network](../offline-network/doc.md) |
| `network.vsk` | State-aware connectivity UI |
| `middleware.ts` | Onion middleware applied to this subtree |

A directory becomes a route only if it has a `page.vsk`, a `layout.vsk`,
or children. Directories starting with `_` (e.g. `_components/`,
`_lib/`) are skipped by the scanner entirely — use them for shared
non-route files next to your routes.

## Segment syntax

| Directory | URL | Notes |
| --- | --- | --- |
| `about/` | `/about` | static segment |
| `[slug]/` | `/:slug` | dynamic segment; value decoded into params |
| `[...path]/` | `/:path` | catch-all; matches all remaining segments, joined with `/` |
| `(group)/` | *(nothing)* | route group: layout/nesting without affecting the URL |
| `_private/` | — | skipped entirely by the scanner |

Examples:

```
app/
├── page.vsk                  → /
├── about/page.vsk            → /about
├── blog/page.vsk             → /blog
├── blog/[slug]/page.vsk      → /blog/:slug        (params.slug)
├── docs/[...path]/page.vsk   → /docs/*            (params.path = "a/b/c")
├── (marketing)/page.vsk      → /  (with group layout)
└── api/hello/route.ts        → /api/hello
```

## Layouts

Layouts attach to their own directory node and nest outermost-to-innermost.
Each receives `{ children, params }`; render `{props.children}` where the
next layout or page should appear:

```vsk
// app/blog/layout.vsk
component BlogLayout(props) {
	<section class="blog">
		<aside>…blog nav…</aside>
		<main>{props.children}</main>
	</section>
}
```

Group layouts participate without consuming URL parts — wrap several top
level pages under different chrome:

```
app/
├── (marketing)/layout.vsk     // wraps / and /pricing
├── (marketing)/page.vsk       → /
├── (marketing)/pricing/page.vsk → /pricing
└── (app)/layout.vsk           // wraps /dashboard
└── (app)/dashboard/page.vsk   → /dashboard
```

## Props received by each file

| File | Props |
| --- | --- |
| `page.vsk` | `{ params, …data }` — decoded route params plus server-fetched data spread at top level |
| `layout.vsk` | `{ children, params }` |
| `loading.vsk` | `{ params }` |
| `error.vsk` | `{ error, retry, params, statusCode, stack, url }` (`statusCode` defaults 500) |
| `not-found.vsk` | `{ params, url }` |
| `offline.vsk` / `network.vsk` | `{ url, params, retry, online, effectiveType, downlink, rtt, saveData }` |

Search params are not props — use `useSearchParams()` or
`useRouter().search`.

```vsk
// app/blog/[slug]/page.vsk
component Post(props: { params: { slug: string } }) {
	<h1>{props.params.slug}</h1>
}
```

```vsk
// app/error.vsk
component ErrorBoundary(props) {
	<h1>{props.statusCode ?? 500}</h1>
	<p>{String(props.error?.message ?? props.error)}</p>
	<button onClick={() => props.retry()}>Try again</button>
}
```

## Matching semantics

- The SSR matcher backtracks: if a dynamic sibling fails deeper recursion,
  a later static sibling can still match.
- On the client the first structural match wins — sibling order matters;
  put more specific routes first.
- Catch-all always matches whatever remains.
- Params are URI-decoded before being passed as props.

## Middleware

A `middleware.ts` in any directory applies to that subtree; files chain
root → leaf. See [Middleware](../../middleware/doc.md).

## API routes

`app/api/**/route.ts` files become JSON endpoints — see
[API Routes](../../api-routes/doc.md).

## Route manifest

The build emits imports plus a nested route-tree literal per route
(`{ path, isGroup, isDynamic, isCatchAll, page, layout, loading, error,
notFound, offline, network, children, chunk }`) consumed by the client
file-router and the production server.
