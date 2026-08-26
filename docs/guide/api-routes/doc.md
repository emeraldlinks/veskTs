# API Routes

Most apps need a backend: form handlers, JSON APIs for `useFetch`,
webhooks. Vesk lets you write those right next to your pages — drop a
`route.ts` file into `app/api/`, export a function per HTTP method, and
it's deployed as an endpoint. No separate server project, no glue code.

Files under `app/api/**/route.ts` (or `route.js`) become JSON endpoints.

## Basic route

```ts
// app/api/hello/route.ts
import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
	return VeskResponse.json({ message: 'Hello from Vesk!' })
		.setCookie('session', 'abc123', { httpOnly: true, secure: true, maxAge: 3600 })
		.setStatus(201)
		.cors({ origin: 'https://app.example.com', methods: 'GET,POST' });
}

export async function POST(req: VeskRequest) {
	const body = await req.json();
	return VeskResponse.json({ received: body });
}
```

- Export one handler per HTTP verb: `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`, `HEAD`, `OPTIONS`.
- Unimplemented verbs → `405 { error }` + `Allow` header; `OPTIONS`
  auto-answers 204 with the implemented list.
- Returned non-`Response` values are JSON-serialized with 200.
- Thrown `redirect(url)` → HTTP redirect (`err.status || 302`);
  thrown `notFound()` → 404 JSON.

## Dynamic + catch-all segments

```ts
// app/api/echo/[msg]/route.ts
export async function GET(request, { params }) {
	const { msg } = await params;          // params is a Promise (Next-compatible)
	return Response.json({ echo: msg });
}
```

```ts
// app/api/files/[...path]/route.ts
export async function GET(request, { params }) {
	const { path } = await params;         // "a/b/c"
	return Response.json({ path });
}
```

Directory conventions match pages: `[param]` dynamic, `[...all]` catch-all,
`(group)` transparent, `_private` skipped. Matching strips a leading
`/api` prefix.

## Route config & hooks

Module-level exports tune behavior:

```ts
// opt out of same-origin CSRF assert on mutating verbs
export const config = { csrf: false, maxDuration: 10 };

export async function beforeRequest(req, ctx) { /* return a Response to short-circuit */ }
export async function afterRequest(res, ctx) { return res; }
```

- `config.csrf !== false` enforces the same-origin check on
  POST/PUT/PATCH/DELETE → cross-site browser calls get **403**.
- `config.maxDuration` (seconds) wraps execution in an AbortController.
- Global runtime hooks also run via `runHooks('beforeRequest' | 'onError' |
  'afterRequest')`.

## Request helpers

Auto-available inside handlers via ambient request context:

```ts
import {
	useParams, useBody, useRequest, cookies, headers, locals,
	withValidation,
} from '@vesk/runtime/server';

export async function POST() {
	const body = await useBody();            // parsed by content-type, memoized
	const c = cookies();                     // CookieStore: get/getAll/toString
	const h = headers();                     // case-insensitive get/has/entries
	const l = locals();                      // middleware-set values
	const p = useParams();                   // current route params
}
```

### VeskRequest extras

```ts
req.parsedUrl: URL;                        // cached URL
req.query: Record<string, string>;         // flattened searchParams
req.ip: string;                            // proxy headers honored only after setTrustProxy(true); else 'unknown'
req.protocol: string;                      // x-forwarded-proto when trustProxy enabled
req.hostname: string;                      // Host sans port
await req.body;                            // lazy parse: json | form | text(+JSON fallback)
req.setTrustProxy(true);
```

### VeskResponse builders

```ts
VeskResponse.json(body)                    // application/json
VeskResponse.html(html)                    // text/html; charset=utf-8
VeskResponse.redirect(url, status=307)
VeskResponse.rewrite(url)                  // internal rewrite (x-vesk-rewrite)
VeskResponse.next()                        // fall through

res.setStatus(code).build()
res.setCookie(name, value, { maxAge, httpOnly=true, secure=true,
                             sameSite='Lax', path='/', domain })
res.clearCookie(name)
res.setCsp(policy | false)
res.cache(ttlSeconds)                      // public + max-age + s-maxage
res.noCache()
res.cors({ origin, methods, headers, credentials })
```

Cookie defaults are safe-by-default: HttpOnly and Secure **on** unless
explicitly false, SameSite=Lax, Path=/.

### Validation

```ts
const data = await withValidation(req, schema, { jsonOnly: true });
// schema is anything with safeParse() (e.g. zod).
// failure → 400 { error:'Validation failed', issues:[{path,message}] }
```

## Body limits

Bodies over `maxBodyBytes` (default **1 MiB**, configurable in server
options) respond **413**. Error details are gated on NODE_ENV — production
returns generic messages.
