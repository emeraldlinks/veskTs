# Data Fetching

Vesk provides `useFetch` for SSR-aware data fetching, `createResource`
for reactive async data, and `useFetch.stream` for progressive loading.

## useFetch

Auto-imported in components. SSR-fetched on the server, client-reused
after hydration.

```vsk
component PostList() {
  const posts = useFetch('/api/posts');

  if (posts.loading) return <p>Loading...</p>;
  if (posts.error) return <p>Error: {posts.error.message}</p>;

  return (
    <ul>
      for (const post of posts.data) {
        <li>{post.title}</li>
      }
    </ul>
  );
}
```

### Resource interface

`useFetch` returns a `Resource<T>` which implements `PromiseLike<T>`:

| Property | Type | Description |
|----------|------|-------------|
| `loading` | `boolean` | `true` while the fetch is in progress |
| `error` | `unknown` | The error if the fetch failed, otherwise `undefined` |
| `data` | `T \| undefined` | The response data |
| `refresh()` | `() => void` | Re-fetch from the URL |
| `abort()` | `() => void` | Abort the in-flight request |

### Options

```ts
useFetch('/api/users', {
  key: 'users',           // cache key for deduplication
  staleTime: 30000,       // ms before data is considered stale
  keepPreviousData: true, // retain old data during refetch
  retry: 2,               // retry count on failure
  retryDelay: 1000,       // ms between retries
  timeout: 10000,         // abort after this many ms
  enabled: true,          // set to false to skip fetching
  dedupe: true,           // dedupe identical requests in-flight
  into: myCell,           // write result into a tracked cell
  headers: { ... },       // custom headers
});
```

### Static methods

```ts
useFetch.json<T>('/api/data', options);      // JSON response
useFetch.text('/api/raw', options);           // text response
useFetch.arrayBuffer('/api/binary', options); // ArrayBuffer response
```

### Streaming

```vsk
component StreamDocs() {
  let &[content] = track('');
  useFetch.stream('/api/docs/long', { into: content });

  return <Md content={content} />;
}
```

Streams text chunks into a tracked cell as they arrive. Progressive
rendering — content appears incrementally.

## createResource

For async data that isn't a simple URL fetch:

```vsk
component UserProfile(props: { userId: string }) {
  const user = createResource(
    async () => {
      const res = await fetch(`/api/users/${props.userId}`);
      return res.json();
    },
    { key: `user-${props.userId}` }
  );

  if (user.loading) return <Skeleton />;
  return <p>{user.data.name}</p>;
}
```

The fetcher re-runs when any tracked dependency read inside it changes.

## SSR data handoff

For data fetched in server code that needs to reach the client:

```ts
import { setSsrData, clearSsrData } from '@vesk/runtime';

// Server-only: store data for client hydration
setSsrData('user', { name: 'Alice' });
```

On the client, `useFetch` with a matching key reads the SSR handoff
data instead of re-fetching.

## Error classes

| Class | Properties | When thrown |
|-------|------------|-------------|
| `HttpError` | `status`, `statusText` | Non-2xx response |
| `TimeoutError` | `timeout` (ms) | Request exceeded timeout |

## Verified against

- `packages/runtime/src/resource.ts` — `useFetch`, `createResource`,
  `useFetch.stream`, `HttpError`, `TimeoutError`
- `packages/runtime/src/index-client.ts` — resource exports
- `packages/runtime/src/index-server.ts` — `setSsrData`, `clearSsrData`,
  `resolveSsrResources`


## Island data must not hold the document

SSR waits for every resource a render starts, so a page can never be sent
before its slowest fetch. For data that belongs to a `client` island that is
usually the wrong trade: the island's server output is a placeholder the client
fills on hydration anyway, so the wait delays every other byte on the page to
buy a request the client was going to make.

```ts
component Widget client {
  // fetched during SSR, but the DOCUMENT does not wait for it
  const feed = useFetch('/api/feed', { ssr: 'defer' })
  return <ul>{feed.value.items.map((i) => <li>{i.title}</li>)}</ul>
}
```

What `'defer'` does:

- starts the fetch (so a shared, warm value can still be reused), and keeps it
  out of the settle barrier — the document flushes without it;
- leaves the data out of the SSR handoff when it loses the race, which is
  correct: the consumer is an island that fetches on hydration;
- never leaves an unhandled rejection behind.

The cost is one extra client-side request for that island. The saving is the
whole page's time-to-first-byte. Use the default (`'wait'`) for anything the
server should render — and `async component` + `await useFetch` when the data
is part of the page's critical path, which is better than any fallback: no
placeholder, no patch, no flash.
