# @vesk/runtime

Vesk runtime — reactivity engine, block lifecycle, DOM operations, hydration, routing, server APIs, streaming resources and markdown.

## Install

```sh
npm install @vesk/runtime
```

## Usage

```js
// Client
import { track, effect, derived } from '@vesk/runtime';
import { Md } from '@vesk/runtime';
import { useFetch } from '@vesk/runtime';

// Server
import { VeskResponse, VeskRequest } from '@vesk/runtime/server';
```

## Reactivity — TrackDecl

```vsk
component Counter {
  const &[count] = track(0)
  <button onClick={() => count++}>{count}</button>
}
```

Outside `.vsk` (plain JS): `const count = track(0)` → `get(count)` / `set(count, 1)` / `peek(count)`. Inside `.vsk` with `&` the cell is auto-tracked — read/write `count` directly.

## Reactive collections

`TrackedArray`, `TrackedObject`, `TrackedMap` and `TrackedSet` are drop-in built-ins whose reads subscribe the surrounding reactive context and whose writes schedule it. On the client they are Proxy-backed; `@vesk/runtime/server` aliases the native constructors, so the same component code renders on both sides.

```vsk
import { TrackedArray, TrackedMap, TrackedObject, TrackedSet, snapshot } from '@vesk/runtime'

component Todos {
  const &[text] = track('')

  const items = new TrackedArray('write docs')
  const meta = new TrackedObject({ visits: 0 })
  const counts = new TrackedMap<string, number>([['open', 1]])
  const tags = new TrackedSet<string>(['new'])

  effect(() => {
    text = `${items.length} items / ${meta.visits} visits / ${counts.get('open')} open / ${tags.size} tags`
  })

  <button onClick={() => {
    items.push('ship it')
    meta.visits += 1
    counts.set('open', (counts.get('open') ?? 0) + 1)
    tags.add('done')
  }}>{text}</button>
}
```

Markup interpolations only re-render for TrackDecl cells, so write derived strings into a `track()` cell (as above) rather than reading a collection directly in JSX. Element/property-level subscriptions still let an `effect()` react to exactly the parts it reads.

`snapshot(value)` returns a shallow, detached plain copy read without subscribing (safe for logging / comparisons). `toJSON()` exists on `TrackedMap` / `TrackedSet`.

## useFetch

`useFetch` / `createResource` return a thenable `Resource<T>` (`loading`/`error`/`data`, `refresh()`/`abort()`, `into?`). SSR data is stashed in `__vsk_ssr_data` and `resolveSsrResources()`.

```ts
const posts = useFetch<Post[]>('/api/posts');
if (posts.loading) return <p>Loading…</p>;
```

Helpers: `.json(url)` / `.text(url)` / `.arrayBuffer(url)` / `.stream(urlOrFn, opts)`.

### useFetch.stream — progressive streaming

Streams `res.body` chunk-by-chunk into a tracked cell so `<Md>` re-renders as data arrives. `urlOrFn` may be a provider `() => string` re-evaluated on every fetch/`refresh()` (so a tracked `docPath` propagates without recreating the resource).

```vsk
component Docs {
  const &[docPath] = track('welcome')   // API param — no .md needed
  const &[doc] = track('')
  const res = useFetch.stream(() => '/api/docs/' + docPath, { into: doc, key: 'doc' })
  <select onchange={(e) => { docPath = (e.target as HTMLSelectElement).value; res.refresh() }}>
    <option value="welcome">Welcome</option>
  </select>
  <Md content={doc} css />
}
```

Plain JS (no `&`): `const docPath = track('welcome'); useFetch.stream(() => '/api/docs/' + get(docPath), { into: doc })`.

## Md

Tokenizer-based Markdown → HTML (GFM tables, task lists, highlighted code, heading anchors, autolinks). `content` is polymorphic:

- **String:** `<Md content="# Hello" />`
- **Tracked cell:** `const &[live] = track('# hi')` → `<Md content={live} css />` (live re-renders)
- **Streamed:** `const &[doc] = track('')` + `useFetch.stream(..., { into: doc })` → `<Md content={doc} />`
- **Public file path** (needs `.md` + leading `/`): `<Md content="/welcome.md" css />`, `"/game.md"`, `"/docs/guide.md"` under `public/`. Missing files render the path literally (never blank).

```vsk
component Page {
  const &[pubPath] = track('/game.md')
  <Md content={pubPath} css />
  <Md content="/welcome.md" css />
  <Md content="/missing.md" css /> // → renders "/missing.md" literally
}
```

```ts
// helper APIs
import { renderMarkdown, MD_BASE_CSS, sanitizeUrl } from '@vesk/runtime';
```

`VeskResponse.stream(readable)` creates a chunked `ReadableStream` response (`Transfer-Encoding: chunked`).

## License

MIT
