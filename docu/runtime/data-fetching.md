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
