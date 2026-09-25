# Data Fetching

Fetching data in a server-rendered app has hidden traps: requests run
twice (once on the server, again in the browser), loading states flash on
every visit, and slow endpoints block the whole page. `useFetch` handles
all of it — data loads on the server, travels with the HTML, hydrates
instantly, and exposes simple reactive `loading` / `error` / `data` state.
It's auto-imported inside components; `createResource` is the underlying
primitive for non-URL sources.

## useFetch

```vsk
component Posts() {
	const &[posts, postsCell] = track<Post[]>([])

	useFetch('/api/posts', {
		key: 'posts',
		into: postsCell,
		staleTime: 30_000,
	})

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

```ts
/**
 * Fetch a URL or run an async fn, with SSR dedupe + hydration handoff.
 * Returns a reactive Resource. On the server the result serializes into
 * the page payload and hydrates instantly on the client without refetch.
 *
 * Options:
 *  key             cache/dedupe/SSR key. Default: the URL.
 *  into            Tracked cell to write the payload into.
 *  body            objects auto-JSON.stringify + Content-Type: application/json
 *                  (FormData/URLSearchParams/Blob/ArrayBuffer/strings pass raw)
 *  staleTime       ms — fresh-window client cache (client only)
 *  keepPreviousData keep old data while revalidating instead of clearing
 *  retry           extra attempts (default 0). GET only; never retries 4xx
 *  retryDelay      ms (default 1000); client uses exponential backoff
 *  timeout         ms — aborts + rejects TimeoutError (0 = off)
 *  enabled         false skips fetching entirely
 *  dedupe          share in-flight promise per key (default true)
 */
function useFetch<T>(urlOrFn: string | (() => Promise<T>), options?: UseFetchOptions<T>): Resource<T>;

/** Typed variants, keyed by url unless overridden: */
useFetch.text<T>(url: string, options?): Resource<T>;
useFetch.json<T>(url: string, options?): Resource<T>;
useFetch.arrayBuffer<T>(url: string, options?): Resource<T>;
```

### Resource

```ts
interface Resource<T> /* also PromiseLike<T> */ {
	readonly loading: boolean;     // reactive
	readonly error: unknown;       // HttpError | TimeoutError | thrown value
	readonly data: T | undefined;  // reactive
	refresh(): void;               // abort in-flight, bypass cache, refetch
	abort(): void;                 // client-only; no-op on server
	then/catch/finally             // await settlement; rejects with error
}

class HttpError extends Error { status: number }   // non-2xx responses
class TimeoutError extends Error {}
```

### Mutations & shared state

```ts
import { mutate } from '@vesk/runtime/src/resource';

mutate('posts', newList);  // write cache + push into every live resource for 'posts'
mutate('posts');           // invalidate + refetch every live resource for 'posts'
```

Multiple components using the same `key` share one cache entry and all
update together on refresh/mutate. Resources deregister + abort their
controllers via `on_destroy`.

### Error handling

```vsk
component Profile() {
	const res = useFetch('/api/me')
	{#if res.error instanceof HttpError && res.error.status === 404}
		<p>Not found</p>
	{:else if res.error}
		<button onClick={() => res.refresh()}>Retry</button>
	{/if}
}
```

## createResource

Lower-level: any async function, not just URLs.

```ts
/**
 * Create a resource from an async fn. Optional key enables dedupe/cache/
 * SSR handoff; optional tracked cell receives data via `into`.
 */
function createResource<T>(
	fn: () => Promise<T>,
	key?: string,
	into?: Tracked,
	options?: UseFetchOptions<T>,
): Resource<T>;
```

```vsk
const res = createResource(() => db.posts.list(), 'posts')
```

## SSR behavior

- Server detection: requests dedupe per key; results record into the
  per-request SSR store; promises are awaited before the response flushes
  (`resolveSsrResources()`).
- The serialized payload ships as a data script (JSON escaped for script
  contexts); hydration reads it and settles instantly without refetching.
- Failed SSR fetches memoize per render token — codegen re-render passes
  settle from the recorded error instead of hammering a failing endpoint;
  explicit `refresh()` bypasses the memo.
- Relative URLs resolve against the current request URL.
