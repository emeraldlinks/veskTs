# @vesk/plugin-multipart

Streaming `multipart/form-data` for Vesk route handlers: real `File` values,
limits enforced as bytes arrive, and no whole-body buffering.

```bash
npm install @vesk/plugin-multipart
```

## Why not `request.formData()`

It works, and it returns a real `File`. What it does not do is **bound** the
upload. `request.formData()` reads the whole body before you see any of it, so
by the time your handler can check a file's size or type, the bytes are already
in memory. The only limit in the path is the server's global body cap — 1 MiB by
default — which is the *total*, not the per-file size, and which nothing in
your handler can influence.

The one thing that does silently destroy uploads is the spread:

```ts
const fd = await request.formData();
const fields = { ...fd };        // {} — FormData has no own enumerable props
const entries = Object.fromEntries(fd.entries());  // this one IS fine
```

Use `fd.get(name)` or `Object.fromEntries(fd.entries())`. This plugin exists for
the limits, not for the value type.

## Usage

```ts
import { parseUploadOrError } from '@vesk/plugin-multipart';

export async function POST(request) {
  const upload = await parseUploadOrError(request, {
    maxFileSize: 8 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg'],
  });

  // A rejection is already a Response with the right status.
  if (upload instanceof Response) return upload;

  const avatar = upload.files[0];
  if (!avatar) return Response.json({ error: 'no file' }, { status: 400 });

  const file = avatar.value;              // a real File
  await storage.put(file.name, await file.arrayBuffer());

  return Response.json({ ok: true, size: file.size, type: file.type });
}
```

A rejection is a protocol-level outcome — every call site has to answer with it
— so `parseUploadOrError` is the function to reach for by default. Use
`parseMultipartRequest` when you want the `MultipartError` and will handle it
yourself.

## Options

| Option | Default | Rejection |
|---|---|---|
| `maxFileSize` | 10 MiB | 413 when a single file part exceeds it |
| `maxTotalSize` | 100 MiB | 413 across all parts |
| `maxFiles` | 20 | 413 on the 21st file part |
| `maxFields` | 100 | 413 on the 101st non-file field |
| `allowedMimeTypes` | — (any) | 415 on a type outside the list; `type/*` wildcards work |
| `allowedExtensions` | — (any) | 415 on an extension outside the list, with or without the dot |

`allowedExtensions` is checked **as well as** the MIME list, not instead of it,
so a `.php` upload cannot be waved through by a permissive content type.

## What you get back

```ts
interface ParsedMultipart {
  parts: MultipartPart[];   // everything, in wire order
  files: MultipartPart[];   // parts that carried a filename
  fields: MultipartPart[];  // the rest
  totalSize: number;        // sum of part bodies
}

interface MultipartPart {
  name: string;             // the form field name
  filename?: string;
  contentType?: string;     // lowercased
  headers: Record<string, string>;
  value: string | File;     // text parts decode to a string, files stay File
  size: number;
  isFile: boolean;
}
```

A text part is a `string` and a file part is a `File` — check `isFile` or use
`files` / `fields` rather than guessing from `value`'s type.

Repeated field names collapse if you flatten them, so use `toRecord`:

```ts
import { toRecord } from '@vesk/plugin-multipart';

const fields = toRecord(upload);
// { title: 'Holiday', tags: ['a', 'b'] }
```

## Errors

Every rejection throws `MultipartError` with a `status` and a `code`:

| `status` | When |
|---|---|
| `400` | malformed body, missing boundary, no body |
| `413` | any size or count limit passed |
| `415` | disallowed MIME type or extension |

```ts
import { MultipartError } from '@vesk/plugin-multipart';

try {
  await parseMultipartRequest(request);
} catch (e) {
  if (e instanceof MultipartError) return Response.json(
    { error: e.message, code: e.code }, { status: e.status });
  throw e;
}
```

## Parsing every upload up front

Off by default — a handler that never parses pays nothing. Opt in with the
plugin and read the result from the request:

```ts
// vesk.config.ts
import { multipart } from '@vesk/plugin-multipart';
import tailwind from '@vesk/plugin-tailwind';

export default {
  plugins: [multipart({ maxFileSize: 32 * 1024 * 1024, autoParse: true })],
};
```

```ts
// app/api/upload/route.ts
export async function POST(request) {
  // No configuration needed here — the plugin's limits already ran, and this
  // call returns that same parse. A request body can only be read once, so
  // asking for it twice must not throw.
  const upload = await parseUploadOrError(request);
  if (upload instanceof Response) return upload;
  return Response.json({ files: upload.files.length });
}
```

A rejection short-circuits the request with the same status codes as above, so a
limit configured here is enforced before any handler runs.

`multipartResult(request)` returns that parse directly, or `null`, for the one
place you cannot fail — an error page, say:

```ts
import { multipartResult } from '@vesk/plugin-multipart';

const upload = multipartResult(request);   // ParsedMultipart | null, never throws
```

The result is held on a private `Symbol`, not a property name: nothing is added
to what `Object.keys(request)` reports, and nothing can collide with your own
fields.

## Requirements

- **The body must be a stream.** `vesk dev` and `vesk start` both provide
  `request.body` as a real `ReadableStream`
  (`packages/adapter/src/web-request.ts`). A host that constructs a `Request`
  with a null body — including a hand-rolled `new Request(url, { body: null })`
  — will make every call fail with `NO_BODY`.
- **Server-side only.** This parses an inbound request; it has nothing to do in
  a browser. If a client bundle reaches it, the build now refuses it and says
  why.
- **Node 18+**, for `File`, `Blob` and web streams.

## API

```ts
parseMultipartRequest(request, options?): Promise<ParsedMultipart>   // throws MultipartError
parseUploadOrError(request, options?): Promise<ParsedMultipart | Response>
parseMultipart(stream, boundary, options?): Promise<ParsedMultipart>  // raw stream + boundary
boundaryFromContentType(contentType): string | null
multipartResult(request): ParsedMultipart | null                     // never throws
toRecord(parsed): Record<string, string | File | Array<string | File>>
multipart(options?): VeskPlugin
MiB
```

All of the above are exported from the package root; `parseMultipart`,
`parseMultipartRequest`, `boundaryFromContentType`, `toRecord` and
`MultipartError` are also available from `@vesk/plugin-multipart/parser`.

There is deliberately **no** bare `parseUpload`. Earlier versions of this
README showed one, and it did not exist.