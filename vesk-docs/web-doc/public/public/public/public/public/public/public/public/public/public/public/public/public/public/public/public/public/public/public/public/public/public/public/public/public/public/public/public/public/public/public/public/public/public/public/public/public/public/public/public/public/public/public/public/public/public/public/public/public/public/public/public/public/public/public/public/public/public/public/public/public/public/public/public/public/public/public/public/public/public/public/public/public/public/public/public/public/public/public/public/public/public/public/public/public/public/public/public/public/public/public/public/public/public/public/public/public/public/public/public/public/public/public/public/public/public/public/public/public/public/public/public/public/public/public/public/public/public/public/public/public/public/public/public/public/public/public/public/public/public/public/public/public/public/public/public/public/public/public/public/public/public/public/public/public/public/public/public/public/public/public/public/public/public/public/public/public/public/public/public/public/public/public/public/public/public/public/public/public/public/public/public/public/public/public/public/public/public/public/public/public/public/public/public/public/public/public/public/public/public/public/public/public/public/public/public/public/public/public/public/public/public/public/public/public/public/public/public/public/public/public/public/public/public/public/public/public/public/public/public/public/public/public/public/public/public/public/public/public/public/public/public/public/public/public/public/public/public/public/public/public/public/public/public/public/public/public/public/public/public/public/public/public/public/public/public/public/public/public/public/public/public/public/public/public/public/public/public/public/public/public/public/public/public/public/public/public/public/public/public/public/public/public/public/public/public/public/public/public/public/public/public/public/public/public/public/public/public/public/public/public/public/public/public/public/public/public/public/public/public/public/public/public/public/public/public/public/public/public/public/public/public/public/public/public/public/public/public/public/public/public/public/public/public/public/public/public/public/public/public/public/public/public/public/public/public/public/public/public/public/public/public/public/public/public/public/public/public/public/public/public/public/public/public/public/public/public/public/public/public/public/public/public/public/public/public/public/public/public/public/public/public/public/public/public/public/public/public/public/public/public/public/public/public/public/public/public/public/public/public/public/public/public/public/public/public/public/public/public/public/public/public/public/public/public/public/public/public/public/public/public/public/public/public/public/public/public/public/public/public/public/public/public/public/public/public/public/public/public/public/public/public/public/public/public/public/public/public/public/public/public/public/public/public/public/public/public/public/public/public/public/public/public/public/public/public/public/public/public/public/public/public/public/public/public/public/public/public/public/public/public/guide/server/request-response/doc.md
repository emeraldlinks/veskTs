# Request & Response

When you write an API route or action, two questions come up constantly:
*what did the client send?* and *how do I answer?* Vesk wraps the web
standard `Request`/`Response` with conveniences for both — parsed query
strings, typed cookies, chainable response builders — without inventing a
foreign API. Everything here imports from `@vesk/runtime/server`:

```ts
import {
	VeskRequest, VeskResponse, ServerRequest, ServerResponse,
	useRequest, useBody, useParams, headers, locals, cookies,
	withValidation, cors, webhook, applyRequestSecurity,
} from '@vesk/runtime/server';
```

## Ambient accessors

During any request (API route, action, SSR) these work without arguments
— the ambient request context is set for the call's duration:

```ts
/** Full ambient context or null outside a request. */
function useRequest(): RequestContext | null;

/** Route params for the current match (never throws). */
function useParams(): Record<string, string>;

/** Parsed body by content-type: JSON → object; urlencoded → record;
 *  else raw text. Memoized; parse failure → null. Throws outside a request. */
function useBody(): Promise<unknown>;

/** Case-insensitive header proxy: .get(name), .has(name), .entries(),
 *  plus direct property access. */
function headers(): Record<string, string | Function | undefined>;

/** Middleware-set values for this request. */
function locals(): Record<string, unknown>;

/** Cookie store — server reads the Cookie header; in the browser falls
 *  back to document.cookie. See the Cookies page. */
function cookies(): CookieStore;
```

## VeskRequest

Extends `Request` with framework conveniences:

```ts
class VeskRequest extends Request {
	parsedUrl: URL;                    // cached URL
	query: Record<string, string>;     // flattened searchParams
	ip: string;                        // 'unknown' unless trustProxy enabled,
	                                   // then x-forwarded-for/x-real-ip/cf-connecting-ip
	protocol: string;                  // URL scheme; x-forwarded-proto when trusted
	hostname: string;                  // Host header sans port ('localhost' default)
	body: Promise<unknown>;            // lazy parse: json | formData | text(+JSON try)
	setTrustProxy(enable: boolean | string): void;
	setCsp(policy: string | false): void;
	setRateLimit(opts: { windowMs?: number; max?: number } | false): void;
	setCsrf(enable: boolean): void;
	setSecurityHeader(name: string, value: string | false): void;
}
```

Bodies are capped at `maxBodyBytes` (default **1 MiB**) — oversized
requests get **413** before handlers run.

## VeskResponse

Both a class and a callable; chainable builders:

```ts
// factories
VeskResponse.json(body, init?)        // application/json
VeskResponse.html(html, init?)        // text/html; charset=utf-8
VeskResponse.redirect(url, status=307)
VeskResponse.rewrite(url)             // internal rewrite via x-vesk-rewrite
VeskResponse.next()                   // fall through (x-vesk-next)

// instance chain (each returns this)
res.setStatus(201)
   .setCookie('sid', v, { maxAge: 3600 })   // see Cookies page
   .setCsp("default-src 'self'")            // false removes the header
   .setSecurityHeader(name, value | false)
   .cache(60)                               // public,max-age=60,s-maxage=60
   .noCache()                               // no-store + Pragma + Expires:0
   .cors({ origin, methods, headers, credentials })
   .clearCookie('sid')
   .build();                                // flush security headers + Set-Cookie
```

Cookie defaults are safe-by-default: `HttpOnly` and `Secure` **on**
unless explicitly `false`, `SameSite=Lax`, `Path=/`.

`await res.text()` / `await res.json()` flush pending headers first.

Returned non-`Response` values from API routes are JSON-serialized
automatically; always call `.build()` if you mutated security/cookies on
a manually constructed response inside custom servers.

## Validation

```ts
/**
 * Parse + validate against anything exposing safeParse() (e.g. zod).
 * jsonOnly restricts to application/json.
 * Failure → ready-to-return 400 Response:
 *   { error: 'Validation failed', issues: [{ path, message }] }
 * Returns parsed data on success.
 */
async function withValidation(
	request: Request,
	schema: { safeParse(data: unknown): { success: boolean;
		error?: { issues: Array<{ path: (string|number)[]; message: string }> } } },
	opts?: { jsonOnly?: boolean },
): Promise<unknown | Response>;
```

```ts
export async function POST(req: VeskRequest) {
	const data = await withValidation(req, LoginSchema);
	if (data instanceof Response) return data;
	return VeskResponse.json({ ok: true, data });
}
```

## CORS

```ts
const c = cors({
	origin: 'https://app.example.com',   // default '*'
	methods: 'GET, POST',                // default full verb list
	allowedHeaders: 'Content-Type, Authorization',
	credentials: true,                   // default true
	maxAge: 86400,
});

export async function GET(req: Request) {
	const pre = c(req);                  // OPTIONS → 204 preflight Response
	if (pre) return pre;
	return c.applyCors(VeskResponse.json({ ok: true })); // clone + headers
}
```

Config-level CORS (`security.cors`) is applied automatically by the
production server — use the helper only in custom servers.

## Webhooks

HMAC-SHA256 verified endpoints:

```ts
const stripeHook = webhook({
	secret: process.env.STRIPE_SECRET!,
	handler: (event, req) => fulfill(event),
	// headerName?: default 'x-webhook-signature'
	// signaturePrefix?: default 'sha256=' (stripped if present)
});

export const POST = stripeHook;   // invalid signature → 401 JSON
```

## Hooks & signed cookies

```ts
/** Register/remove named lifecycle hooks; first Response short-circuits. */
function defineHook(name: 'beforeRequest' | 'afterRequest' | 'onError', fn: Function): void;
function removeHook(name: string, fn: Function): void;
function runHooks(name: string, ...args: unknown[]): Promise<Response | undefined>;

/** HMAC-signed cookie helpers (see Cookies page). */
function signCookie(name: string, value: string, host?: string): Promise<string>;
function unsignCookie(name: string, signed: string, host?: string): Promise<string | null>;
function setSignedCookie(name: string, value: string, options: Record<string, unknown>, host?: string): Promise<string>;
function readSignedCookie(name: string, cookieString: string, host?: string): Promise<string | null>;

/** Copy request security overrides (CSP etc.) onto a response and flush. */
function applyRequestSecurity(request: VeskRequest, response: VeskResponse): void;
```

## ServerRequest / ServerResponse

Lower-level base classes (`VeskRequest` extends `ServerRequest` extends
`Request`; `ServerResponse` adds static `json/redirect/rewrite/next`) for
custom servers that don't need the full builder chain.
