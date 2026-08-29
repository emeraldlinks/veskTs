# @vesk/types

Shared type definitions for the Vesk framework. This package is the **single
source of truth** for every public framework type — config, plugins, security,
middleware context, request/response shapes, route nodes, build options,
resources (`Resource` / `UseFetchOptions` / `UseFetchStreamOptions`), markdown
(`MdProps` / `MarkdownOptions` / `MdHtmlWarning` / `MdHtmlMode` / `MdConfig`),
reactive cells (`Tracked`), SSR handoff (`SsrDataSink`), and streaming
(`VeskResponse.stream`).

It has zero runtime dependencies and ships compiled `.d.ts` + no-op `.js`.

```ts
import type {
  MiddlewareContext, VeskConfig, VeskRequest, VeskResponse,
  Resource, UseFetchOptions, Tracked, MdProps
} from '@vesk/types';
```

Framework packages (`@vesk/compiler`, `@vesk/adapter`, `@vesk/runtime` re-exports
via `src/types.ts`) re-export these types so existing deep imports keep working,
but new code should import from here.

## Resources — useFetch

Canonical shapes for `@vesk/runtime/src/resource.ts`:

```ts
interface Resource<T> extends PromiseLike<T> { loading: boolean; error: unknown; data: T | undefined; refresh(): void; abort(): void; into?: Tracked<T> }
interface UseFetchOptions<T> extends RequestInit { key?: string; into?: Tracked<T>; staleTime?: number; retry?: number; timeout?: number; enabled?: boolean; dedupe?: boolean }
interface UseFetchStreamOptions extends Omit<UseFetchOptions<string>, 'body'> { into?: Tracked<string>; onChunk?: (chunk: string, total: string) => void }
```

`useFetch.stream(urlOrFn, { into, onChunk, key })` streams `ReadableStream` text
chunk-by-chunk into `into` (`urlOrFn` may be `() => string` re-evaluated per fetch).

## Markdown — Md

```ts
interface MdProps {
  content?: string | Tracked<string> | Resource<string>; // or "/game.md" — public file
  css?: boolean | string; lineNumbers?: boolean; copy?: boolean;
  html?: MdHtmlMode; allowTags?: string[];
}
```

`content` accepts: literal string, `const &[live] = track('')` cell, `useFetch.stream`
cell, or absolute public path `"/welcome.md"` / `"/game.md"` / `"/docs/guide.md"`
(needs `.md` / `.markdown` + leading `/`; `//`/`?`/`#`/`\` rejected).

## Streaming response

```ts
namespace VeskResponse { function stream(readable: ReadableStream, init?: ResponseInit): VeskResponse }
```

Chunked `Transfer-Encoding: chunked` via `deliverResponse` (`getReader()` loop) on
dev/prod servers; `readable as unknown as BodyInit`.
