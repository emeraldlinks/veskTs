type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "data-fetching",
    title: "Data Fetching",
    description:
      "useFetch and its static variants, createResource, mutate, HttpError / TimeoutError, and SSR data handoff.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Vesk's data layer is built on reactive resources. A resource represents an async value derived from a fetcher: it exposes live `loading`, `error` and `data` state, dedupes in-flight requests by key, retries failed GETs with exponential backoff, honours a client cache via `staleTime`, and hands payloads fetched on the server to the client so hydration never re-fetches.",
      },
      { kind: "h2", text: "The Resource object" },
      {
        kind: "p",
        text:
          "`useFetch` and `createResource` both return a `Resource<T>`. It is a `PromiseLike<T>` (`await resource` resolves to `data` and rejects with `resource.error`), and its state fields are reactive — the compiler can branch on them in `if (res.loading)` / `if (res.error)` guards inside component bodies.",
      },
      {
        kind: "table",
        head: ["Member", "Behavior"],
        rows: [
          ["loading", "`true` while the fetcher (or a `refresh()`) is in flight."],
          ["error", "`null` on success; an `HttpError`, `TimeoutError`, abort, or any value thrown by the fetcher."],
          ["data", "Last successfully fetched payload, or `undefined` before the first success."],
          ["refresh()", "Re-runs the fetcher for every handle sharing the same `key`, aborting the in-flight request first."],
          ["abort()", "Aborts the in-flight request (client only; no-op on the server)."],
          ["then / catch / finally", "`await resource` resolves to `data` and rejects with `error`."],
        ],
      },
      { kind: "h2", text: "useFetch" },
      {
        kind: "p",
        text:
          "`useFetch<T>(urlOrFn, options?)` fetches a URL and parses the response as JSON. It is auto-imported inside components. With a string URL, the URL itself becomes the `key`; with a function fetcher, pass an explicit `key` so dedupe, cache and SSR handoff can identify it. On the server the request is run before the HTML is emitted and the payload is stashed for the client; on the client the payload is reused instead of re-fetching.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/PostList.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component PostList() {
  const posts = useFetch<Post[]>('/api/posts', {
    key: 'posts',
    staleTime: 60_000,
    keepPreviousData: true,
  });

  if (posts.loading) return <p>Loading...</p>;
  if (posts.error) return <p>{(posts.error as Error).message}</p>;

  <ul>
    for (const post of posts.data) {
      <li>{post.title}</li>
    }
  </ul>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/PostList.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component PostList() {
  const posts = useFetch<Post[]>('/api/posts', {
    key: 'posts',
    staleTime: 60_000,
    keepPreviousData: true,
  });

  if (posts.loading) return <p>Loading...</p>;
  if (posts.error) return <p>{(posts.error as Error).message}</p>;

  return (
    <ul>
      {posts.data.map((post) => <li>{post.title}</li>)}
    </ul>
  );
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "`staleTime` only affects the client cache: after a successful fetch the payload is kept in `globalThis.__vsk_fetch_cache` and reused without a network request while `Date.now() - fetchedAt < staleTime`. It never affects server rendering.",
      },
      { kind: "h2", text: "Options" },
      {
        kind: "p",
        text:
          "`UseFetchOptions<T>` extends `RequestInit` (minus `body`) with Vesk-specific controls. The same options object is accepted by `createResource`.",
      },
      {
        kind: "table",
        head: ["Option", "Type", "Default", "Behavior"],
        rows: [
          ["key", "string", "the URL string (or fetcher source)", "Identity for dedupe, client cache and SSR handoff; all handles sharing a key refresh together."],
          ["into", "Tracked<T>", "—", "Target tracked cell; the payload is written into it via `set()`, so `await` is unnecessary and the cell re-renders."],
          ["body", "unknown", "—", "Objects/arrays are `JSON.stringify`'d with `Content-Type: application/json`; string, FormData, URLSearchParams, Blob and ArrayBuffer pass through."],
          ["method", "string", "GET", "HTTP method — retries only ever apply to GET."],
          ["headers", "HeadersInit", "—", "Passed through to fetch; a plain object, array, or `Headers`."],
          ["staleTime", "number", "0", "Client cache TTL in ms; while `Date.now() - fetchedAt < staleTime` the cached payload is reused. `0` always fetches."],
          ["keepPreviousData", "boolean", "false", "Keep the previous `data` visible while a refresh is in flight instead of resetting to `undefined`."],
          ["retry", "number", "0", "Retry count for failed GETs. Errors with HTTP status 400–499 are never retried."],
          ["retryDelay", "number", "1000", "Base delay in ms; the client uses exponential backoff (`delay * 2^attempt`), the server a constant delay."],
          ["timeout", "number", "0", "Abort the request and fail with a `TimeoutError` after this many ms. `0` disables it."],
          ["enabled", "boolean", "true", "When `false` the resource starts idle (`loading: false`) and issues no fetch until `refresh()`."],
          ["dedupe", "boolean", "true", "Multiple resources created with the same key share one in-flight request."],
        ],
      },
      {
        kind: "p",
        text:
          "Any remaining `RequestInit` fields pass straight through: `credentials`, `cache`, `mode`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive` and `signal`.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/OptionalPosts.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component OptionalPosts() {
  const posts = useFetch<Post[]>('/api/posts', {
    key: 'posts',
    retry: 2,
    retryDelay: 500,
    timeout: 10_000,
    dedupe: true,
    enabled: true,
    headers: { Authorization: \`Bearer \${token}\` },
  });

  if (posts.loading) return <p>Loading...</p>;

  <ul>
    for (const post of posts.data) {
      <li>{post.title}</li>
    }
  </ul>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/OptionalPosts.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component OptionalPosts() {
  const posts = useFetch<Post[]>('/api/posts', {
    key: 'posts',
    retry: 2,
    retryDelay: 500,
    timeout: 10_000,
    dedupe: true,
    enabled: true,
    headers: { Authorization: \`Bearer \${token}\` },
  });

  if (posts.loading) return <p>Loading...</p>;

  return (
    <ul>
      {posts.data.map((post) => <li>{post.title}</li>)}
    </ul>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "Static helpers" },
      {
        kind: "list",
        items: [
          "`useFetch.json<T>(url, options?)` — explicit JSON reader (same as plain `useFetch`).",
          "`useFetch.text(url, options?)` — reads the body as a string (`Resource<string>`).",
          "`useFetch.arrayBuffer(url, options?)` — reads the body as an `ArrayBuffer`.",
        ],
      },
      {
        kind: "p",
        text:
          "Each static helper accepts the same `UseFetchOptions` and returns a `Resource`. They default their `key` to the URL, like plain `useFetch`.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Account.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Me {
  name: string;
  email: string;
}

component Account() {
  const me = useFetch.json<Me>('/api/me', { key: 'me', staleTime: 30_000 });

  if (me.loading) return <p>Loading...</p>;
  if (me.error) return <p>{(me.error as Error).message}</p>;

  <div>
    <p>{me.data.name}</p>
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Account.vsk",
            code: `import { useFetch } from '@vesk/runtime';

interface Me {
  name: string;
  email: string;
}

component Account() {
  const me = useFetch.json<Me>('/api/me', { key: 'me', staleTime: 30_000 });

  if (me.loading) return <p>Loading...</p>;
  if (me.error) return <p>{(me.error as Error).message}</p>;

  return (
    <div>
      <p>{me.data.name}</p>
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "useFetch.stream" },
      {
        kind: "p",
        text:
          "`useFetch.stream(urlOrFn, options?)` consumes a response body chunk by chunk and writes the running total into a tracked cell via `into`, so anything subscribed to that cell re-renders as data arrives. An optional `onChunk(chunk, total)` callback fires after each chunk. `urlOrFn` may be a provider function `() => string` that is re-evaluated on every fetch (including `refresh()`), so switching a tracked path propagates without recreating the resource. The URL must reference an API route that returns `text/plain` or streams plain text.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/DocReader.vsk",
            code: `import { useFetch } from '@vesk/runtime';

component DocReader(props: { id: string }) {
  const &[doc, docCell] = track('');
  const stream = useFetch.stream(() => \`/api/docs/\${props.id}\`, {
    key: \`doc-\${props.id}\`,
    into: docCell,
    onChunk: (chunk, total) => console.log(\`+\${chunk.length} chars (\${total.length} total)\`),
  });

  if (stream.loading && !doc) return <p>Loading...</p>;

  <article>{doc}</article>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/DocReader.vsk",
            code: `import { useFetch } from '@vesk/runtime';

component DocReader(props: { id: string }) {
  const &[doc, docCell] = track('');
  const stream = useFetch.stream(() => \`/api/docs/\${props.id}\`, {
    key: \`doc-\${props.id}\`,
    into: docCell,
    onChunk: (chunk, total) => console.log(\`+\${chunk.length} chars (\${total.length} total)\`),
  });

  if (stream.loading && !doc) return <p>Loading...</p>;

  return <article>{doc}</article>;
}`,
          },
        ],
      },
      { kind: "h2", text: "createResource" },
      {
        kind: "p",
        text:
          "`createResource<T>(fn, key?, into?, options?)` wraps an arbitrary async function as a resource — use it when the data comes from something other than a fetch (a computation, a socket, an SDK call) or when you want to control HTTP handling yourself (unlike `useFetch` it does not check `res.ok`, so a 404 is fetched data unless your fetcher throws). `key` is also derived from `options.key` or the fetcher source when omitted.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/UserProfile.vsk",
            code: `interface User {
  name: string;
}

component UserProfile(props: { userId: string }) {
  const user = createResource(
    async () => {
      const res = await fetch(\`/api/users/\${props.userId}\`);
      return res.json();
    },
    \`user-\${props.userId}\`,
  );

  if (user.loading) return <Skeleton />;
  if (user.error) return <p>{(user.error as Error).message}</p>;

  <p>{user.data.name}</p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/UserProfile.vsk",
            code: `interface User {
  name: string;
}

component UserProfile(props: { userId: string }) {
  const user = createResource(
    async () => {
      const res = await fetch(\`/api/users/\${props.userId}\`);
      return res.json();
    },
    \`user-\${props.userId}\`,
  );

  if (user.loading) return <Skeleton />;
  if (user.error) return <p>{(user.error as Error).message}</p>;

  return <p>{user.data.name}</p>;
}`,
          },
        ],
      },
      {
        kind: "p",
        text:
          "The third argument is `into` (a raw tracked cell), and the fourth is the full `UseFetchOptions`. With `into`, the payload lands in the cell and the component renders from the cell directly:",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Settings.vsk",
            code: `interface Preferences {
  theme: string;
}

component Settings() {
  const &[prefs, prefsCell] = track<Preferences | undefined>(undefined);
  createResource(
    async () => {
      const res = await fetch('/api/prefs');
      return res.json();
    },
    'prefs',
    prefsCell,
    { staleTime: 60_000 },
  );

  <p>{prefs ? prefs.theme : 'Loading...'}</p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Settings.vsk",
            code: `interface Preferences {
  theme: string;
}

component Settings() {
  const &[prefs, prefsCell] = track<Preferences | undefined>(undefined);
  createResource(
    async () => {
      const res = await fetch('/api/prefs');
      return res.json();
    },
    'prefs',
    prefsCell,
    { staleTime: 60_000 },
  );

  return <p>{prefs ? prefs.theme : 'Loading...'}</p>;
}`,
          },
        ],
      },
      { kind: "h2", text: "mutate" },
      {
        kind: "p",
        text:
          "`mutate(key, data?)` updates the client-side cache and every live resource registered under `key` (client only — it is a no-op on the server). With `data`, it writes the cache and settles all handles to `{ loading: false, error: null, data }` without a network request — a classic optimistic update. Without `data`, it revalidates: the in-flight request is aborted and every handle re-runs its fetcher.",
      },
      {
        kind: "code",
        filename: "app/lib/posts.ts",
        code: `import { mutate } from '@vesk/runtime/src/resource';

// optimistic write — no refetch
mutate('posts', { id: 999, title: 'Local preview' });

// revalidate — refetch every live handle for the key
mutate('posts');`,
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/CreatePost.vsk",
            code: `import { mutate } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component CreatePost() {
  const posts = useFetch<Post[]>('/api/posts', { key: 'posts' });
  const &[draft] = track({ title: '' });

  const save = async () => {
    await fetch('/api/posts', { method: 'POST', body: JSON.stringify(draft) });
    mutate('posts');
  };

  <div>
    <input value={draft.title} />
    <button onclick={save}>Save</button>
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/CreatePost.vsk",
            code: `import { mutate } from '@vesk/runtime';

interface Post {
  id: number;
  title: string;
}

component CreatePost() {
  const posts = useFetch<Post[]>('/api/posts', { key: 'posts' });
  const &[draft] = track({ title: '' });

  const save = async () => {
    await fetch('/api/posts', { method: 'POST', body: JSON.stringify(draft) });
    mutate('posts');
  };

  return (
    <div>
      <input value={draft.title} />
      <button onclick={save}>Save</button>
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "Error handling" },
      {
        kind: "p",
        text:
          "A failed fetch never throws synchronously — the error lands on `resource.error` and `await resource` rejects with it. `useFetch` throws an `HttpError` whenever `res.ok` is false; a `timeout` rejects with a `TimeoutError` and aborts the underlying request at the same time. An `abort()` or destroyed block surfaces an abort error.",
      },
      {
        kind: "table",
        head: ["Type", "Shape", "When"],
        rows: [
          ["HttpError", "`status`, `statusCode`, message `HTTP {status}: {statusText}` (e.g. `HTTP 404: Not Found`)", "Any non-ok response from `useFetch`."],
          ["TimeoutError", "message `Request timed out after {ms}ms`", "The `timeout` timer elapses before the request settles."],
          ["AbortError", "`DOMException` or `Error` named `AbortError`", "`abort()` is called, or the owning component is destroyed mid-flight."],
        ],
      },
      {
        kind: "p",
        text:
          "`HttpError`, `TimeoutError` and `mutate` live in `@vesk/runtime/src/resource` — import them from the module subpath.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/PostList.vsk",
            code: `import { HttpError, TimeoutError } from '@vesk/runtime/src/resource';

interface Post {
  id: number;
  title: string;
}

component PostList() {
  const posts = useFetch<Post[]>('/api/posts', { timeout: 5_000, retry: 2 });

  if (posts.loading) return <p>Loading...</p>;
  if (posts.error) {
    if (posts.error instanceof HttpError) return <p>HTTP {posts.error.status}</p>;
    if (posts.error instanceof TimeoutError) return <p>Timed out</p>;
    return <p>{(posts.error as Error).message}</p>;
  }

  <ul>
    for (const post of posts.data) {
      <li>{post.title}</li>
    }
  </ul>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/PostList.vsk",
            code: `import { HttpError, TimeoutError } from '@vesk/runtime/src/resource';

interface Post {
  id: number;
  title: string;
}

component PostList() {
  const posts = useFetch<Post[]>('/api/posts', { timeout: 5_000, retry: 2 });

  if (posts.loading) return <p>Loading...</p>;
  if (posts.error) {
    if (posts.error instanceof HttpError) return <p>HTTP {posts.error.status}</p>;
    if (posts.error instanceof TimeoutError) return <p>Timed out</p>;
    return <p>{(posts.error as Error).message}</p>;
  }

  return (
    <ul>
      {posts.data.map((post) => <li>{post.title}</li>)}
    </ul>
  );
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Retries only apply to GET requests, and an `HttpError` with status 400–499 is never retried. On the client the retry delay is exponential (`retryDelay * 2^attempt`); on the server it is a constant `retryDelay`.",
      },
      { kind: "h2", text: "SSR data handoff" },
      {
        kind: "p",
        text:
          "Every resource keyed the same on both sides is handed off automatically: the server runs the request, stashes the payload with `setSsrData(key, value)` into `globalThis.__vsk_ssr_data`, and serializes it into the HTML; on the client `getSsrData(key)` settles the resource instantly, so hydration does not re-fetch. Failed SSR requests are memoized per render token so the server's re-render passes settle from the recorded error instead of re-firing a request that always fails (e.g. a 401).",
      },
      {
        kind: "p",
        text:
          "For data fetched outside a resource (e.g. a top-level loader) you can use the same handoff APIs directly. They are exported from `@vesk/runtime`; `setSsrSink` additionally requires the server entry (`@vesk/runtime/server`).",
      },
      {
        kind: "code",
        filename: "app/lib/handoff.ts",
        code: `import { setSsrData, clearSsrData, resolveSsrResources } from '@vesk/runtime';

export async function loadPageData() {
  const user = await fetchUser();
  setSsrData('user', user);

  const posts = await fetchPosts();
  setSsrData('posts', posts);

  // snapshot { user, posts } after awaiting in-flight resource requests too
  const serialized = await resolveSsrResources();
  clearSsrData();
  return serialized;
}`,
      },
      {
        kind: "list",
        items: [
          "`setSsrData(key, value)` — stash a value for client hydration.",
          "`getSsrData(key)` — read a stashed value (client reuse during hydration).",
          "`clearSsrData()` — wipe the handoff store.",
          "`resolveSsrResources()` — await all pending SSR resource requests and return the flat `{ [key]: value }` snapshot.",
          "`setSsrSink(sink)` — install a custom `SsrDataSink` (`set`/`get`/`snapshot`/`clear`); the compiler's SSR store installs one per request so data never leaks across renders.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "`setSsrSink` and the `SsrDataSink` interface are server-only: `@vesk/runtime/server` exports them, the default client entry does not.",
      },
    ],
  },
  {
    slug: "network",
    title: "Network State",
    description:
      "Reactive browser network state: getNetworkState with online, effectiveType, downlink, rtt, saveData, plus watchNetwork subscriptions.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Vesk tracks browser connectivity through the Network Information API and `navigator.onLine`. It is designed for connectivity-aware boundaries and the router's offline fallback UI, and it degrades gracefully where the API is missing (Safari/Firefox): the extra fields become `null` / `'unknown'` and consumers fall back to the `online` flag alone.",
      },
      { kind: "h2", text: "getNetworkState" },
      {
        kind: "p",
        text:
          "`getNetworkState()` returns a snapshot of the current connectivity as a plain `NetworkState` object. It is a read, not a subscription — combine it with `watchNetwork` to react to changes.",
      },
      {
        kind: "table",
        head: ["Field", "Type", "Meaning"],
        rows: [
          ["online", "boolean", "`navigator.onLine` — whether the browser believes it has connectivity."],
          ["effectiveType", "'slow-2g' | '2g' | '3g' | '4g' | 'unknown'", "Estimated connection quality; `'unknown'` when the Network Information API is unavailable."],
          ["downlink", "number | null", "Estimated downlink in Mbps, or `null` when unsupported."],
          ["rtt", "number | null", "Estimated round-trip time in ms, or `null` when unsupported."],
          ["saveData", "boolean", "Whether the user's data-saver mode is active."],
        ],
      },
      {
        kind: "code",
        filename: "app/lib/net.ts",
        language: "ts",
        code: `import { getNetworkState } from '@vesk/runtime';

const state = getNetworkState();
console.log(state.online);        // true | false
console.log(state.effectiveType); // '4g' | '3g' | '2g' | 'slow-2g' | 'unknown'
console.log(state.downlink);      // Mbps | null
console.log(state.rtt);           // ms | null
console.log(state.saveData);      // boolean`,
      },
      { kind: "h2", text: "watchNetwork" },
      {
        kind: "p",
        text:
          "`watchNetwork(cb)` subscribes to connectivity changes — online/offline flips plus `connection.change` events where the Network Information API is supported — and calls `cb(state)` with a fresh `NetworkState` on every change. It returns an unsubscribe function, and it is a no-op-safe no-op on the server (no `window` access is attempted). It is not auto-imported, so pull it from `@vesk/runtime`.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/NetworkStatus.vsk",
            code: `import { watchNetwork } from '@vesk/runtime';

component NetworkStatus() {
  let &[online] = track(navigator.onLine ?? true);

  watchNetwork((state) => {
    online = state.online;
  });

  <p class={online ? 'text-green-600' : 'text-red-600'}>
    {online ? 'Online' : 'Offline'}
  </p>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/NetworkStatus.vsk",
            code: `import { watchNetwork } from '@vesk/runtime';

component NetworkStatus() {
  let &[online] = track(navigator.onLine ?? true);

  watchNetwork((state) => {
    online = state.online;
  });

  return (
    <p class={online ? 'text-green-600' : 'text-red-600'}>
      {online ? 'Online' : 'Offline'}
    </p>
  );
}`,
          },
        ],
      },
      {
        kind: "p",
        text:
          "For a richer badge that reacts to the full state object, keep a tracked cell of the whole `NetworkState` and write it from the subscription:",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/ConnectionBadge.vsk",
            code: `import { getNetworkState, watchNetwork } from '@vesk/runtime';

component ConnectionBadge() {
  const &[state, stateCell] = track(getNetworkState());

  watchNetwork((next) => {
    state = next;
  });

  <span>
    {state.online ? 'online' : 'offline'} · {state.effectiveType}
    {state.saveData ? ' · data saver' : ''}
  </span>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/ConnectionBadge.vsk",
            code: `import { getNetworkState, watchNetwork } from '@vesk/runtime';

component ConnectionBadge() {
  const &[state, stateCell] = track(getNetworkState());

  watchNetwork((next) => {
    state = next;
  });

  return (
    <span>
      {state.online ? 'online' : 'offline'} · {state.effectiveType}
      {state.saveData ? ' · data saver' : ''}
    </span>
  );
}`,
          },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "On browsers without the Network Information API, `effectiveType` stays `'unknown'` and `downlink` / `rtt` are `null` — never assume those fields are present. Only `online` is universally available.",
      },
    ],
  },
];