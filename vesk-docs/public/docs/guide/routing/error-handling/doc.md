# Error Handling

Things go wrong — an API times out, data has an unexpected shape. Vesk
keeps those failures small and recoverable: a broken page shows your
error UI instead of a white screen, the rest of the app keeps working,
and one file (`error.vsk`) controls exactly what users see.

Errors are contained by design: a broken page errors only itself — the
layout chain, navigation and other islands keep working.

## `error.vsk`

Place an `error.vsk` in any route directory; it becomes the error boundary
for that subtree (the nearest one up the tree wins). It receives:

| Prop | Meaning |
| --- | --- |
| `error` | The thrown value — or a pre-stringified message on some paths; treat as `unknown` and coerce with `String(…)` |
| `retry()` | Re-navigates the current path (replace) |
| `params` | Matched route params |
| `statusCode` | HTTP status — defaults 500 |
| `stack` | Error stack (dev) |
| `url` | Requested pathname |
| `offline` | `true` + `networkState` when the failure was connectivity-related |

`error` may arrive as a thrown value or already serialized to a string
depending on the path — render it defensively. A real, working
`app/error.vsk`:

```vsk
interface ErrorProps {
	statusCode: number
	error: string
	stack: string
	url: string
}

export component ErrorPage(props: ErrorProps) {
	<h1 class="text-4xl font-bold text-red-600">Error {props.statusCode}</h1>
	<p class="text-lg">{props.error}</p>
	<pre>{props.stack}</pre>
	<button onClick={() => props.retry()}>Try again</button>
}
```

Behavior:

- **SSR**: a render throw renders `error.vsk`'s body inside the page slot;
  the layout chain survives; response status becomes 500; partial page
  output never leaks.
- **Client**: the broken route's region shows the error UI while the rest
  of the app (footer, other islands, SPA navigation) keeps functioning —
  navigating away and back works.
- Details (stacks, messages) render only outside production; prod returns
  generic text.

## Thrown control flow

```ts
/** Throw inside pages/actions/API handlers → nearest not-found.vsk or 404. */
function notFound(): never;

/** Throw → HTTP redirect (302 default / 308 permanent). */
function redirect(url: string): never;
function permanentRedirect(url: string): never;

class NotFoundError extends Error {}
class Redirect extends Error { url: string; status: number }
```

```vsk
component Post(props: { params: { slug: string } }) {
	const post = getPost(props.params.slug);
	if (!post) notFound();
	<h1>{post.title}</h1>
}
```

On the client file-router, a thrown `Redirect` performs a replace-
navigation to its URL; `NotFoundError` renders the nearest
[not-found.vsk](../file-based/doc.md#boundaries).

## Local try/catch

Wrap any region with plain JavaScript — statement mode makes it a live
error region; the catch variable is usable inside:

```vsk
try {
	<RiskyWidget />
}
catch (e) {
	<p>Widget failed: {String(e?.message ?? e)}</p>
}
```

## Offline failures

Connectivity failures during SPA navigation never hit `not-found.vsk` or a
raw TypeError — see [Offline & Network](../offline-network/doc.md)
for the boundary precedence (`offline.vsk` → `network.vsk` → router
option → `error.vsk` with `offline: true`).

## 404s

Unmatched URLs render the nearest `not-found.vsk` (`props: { params,
url }`), falling back to a built-in page. The production server uses it
for its final 404 response too.
