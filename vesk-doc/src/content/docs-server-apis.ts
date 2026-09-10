export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  blocks: Block[];
};

export const pages: DocPage[] = [
  {
    slug: "server-apis",
    title: "Server APIs",
    description:
      "Request context (useParams/useRequest/useBody), cookies(), headers(), locals(), VeskRequest / VeskResponse / ServerResponse, CORS, webhooks, hooks, validation, signed cookies and server events.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text: "Vesk exposes server-side APIs for reading the current request, building responses, wiring CORS and webhooks, and hooking the app lifecycle. Everything below lives in `@vesk/runtime/server` and is used in API routes (`app/api/**/route.ts`), middleware, server components and `app/_events.ts`.",
      },
      {
        kind: "note",
        tone: "info",
        text: "The request-context helpers — `useParams`, `useRequest`, `useBody`, `cookies()`, `headers()`, `locals()` — read from an ambient per-request store (`globalThis.__vesk_request`) that the dev server, the adapter and the API-route runner populate before your code runs. Only `useParams` is auto-imported inside component bodies; the other helpers and the response classes must be imported explicitly from `@vesk/runtime/server`.",
      },
      { kind: "h2", text: "Request context" },
      {
        kind: "p",
        text: "While a request is being handled, Vesk keeps a small context object in the ambient store. In API routes it is `{ headers, url, method, cookies, locals, _request, params }`; in SSR renders the adapter seeds a `VeskRequest.from(request, { params, locals })` instance. The helpers below read from whichever object is live.",
      },
      {
        kind: "list",
        items: [
          "`useParams(): Record<string, string>` — route parameters. For `/blog/42/hello` it returns `{ id: '42', slug: 'hello' }`. Auto-imported in component bodies.",
          "`useRequest(): RequestContext | null` — the live request context, or `null` outside a request. Carries `url`, `method`, `params`, `cookies`, `locals` and the underlying `_request`.",
          "`useBody(): Promise<unknown>` — the parsed request body: JSON for `content-type: application/json`, an object for `x-www-form-urlencoded`, otherwise text (with a JSON.parse fallback). Cached per request; returns `null` when there is no underlying request and throws if called outside a request context.",
          "`cookies(): CookieStore` — the current request's cookies.",
          "`headers(): Record<string, string | Function | undefined>` — the current request's normalized headers.",
          "`locals(): Record<string, unknown>` — per-request data shared between middleware, handlers and renders (empty object outside a request).",
        ],
      },
      { kind: "h2", text: "Reading params and headers in a component" },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/ParamsPage.vsk",
            code: `import { headers } from '@vesk/runtime/server';

component ParamsPage() {
  const params = useParams();
  const lang = headers().get('accept-language');
  <div class="p-4">
    <h1>Item {params.id}</h1>
    <p>Preferred language: {lang ?? 'none'}</p>
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/ParamsPage.vsk",
            code: `import { headers } from '@vesk/runtime/server';

component ParamsPage() {
  const params = useParams();
  const lang = headers().get('accept-language');
  return (
    <div class="p-4">
      <h1>Item {params.id}</h1>
      <p>Preferred language: {lang ?? 'none'}</p>
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "cookies()" },
      {
        kind: "p",
        text: "`cookies()` returns the current request's cookie jar. It is a Proxy over `Record<string, string>` that also exposes three helper methods — and any cookie can be read directly by property name (`jar.session`). On the client it falls back to `document.cookie`.",
      },
      {
        kind: "list",
        items: [
          "`get(name)` → `string | undefined`",
          "`getAll()` → `{ name, value }[]`",
          "`toString()` → `name=value; name=value`",
        ],
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/Dashboard.vsk",
            code: `import { cookies } from '@vesk/runtime/server';

component Dashboard() {
  const jar = cookies();
  const session = jar.get('session');
  <div>
    <h1>Dashboard</h1>
    {session ? <p>Signed in with session {session}</p> : <p>No session cookie</p>}
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/Dashboard.vsk",
            code: `import { cookies } from '@vesk/runtime/server';

component Dashboard() {
  const jar = cookies();
  const session = jar.get('session');
  const count = jar.getAll().length;
  return (
    <div>
      <h1>Dashboard</h1>
      <p>{count} cookie(s) present</p>
      {session ? <p>Signed in with session {session}</p> : <p>No session cookie</p>}
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "headers()" },
      {
        kind: "p",
        text: "`headers()` normalizes the request headers to lowercase names and supports both method and property access — `headers().get('accept')` and `headers()['accept']` are equivalent. Values from multi-valued headers are joined with `', '`.",
      },
      {
        kind: "list",
        items: [
          "`get(name)` → `string | null` (case-insensitive)",
          "`has(name)` → `boolean` (case-insensitive)",
          "`entries()` → `MapIterator` of `[name, value]` pairs",
          "Direct reads: `headers().accept`, `headers()['accept-language']`, …",
        ],
      },
      { kind: "h2", text: "locals()" },
      {
        kind: "p",
        text: "`locals()` reads the per-request storage that middleware fills with `ctx.set(key, value)`. Values seeded in `onStart` via the server-wide context are also pre-seeded into every request's `locals()`, so boot-time setup is visible to middleware, handlers and renders alike.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        code: `import type { MiddlewareContext } from '@vesk/compiler';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
  ctx.set('user', { id: 1, name: 'Alice' });
  const startTime = Date.now();
  await next();
  console.log('took', Date.now() - startTime, 'ms');
}`,
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/ProfileBanner.vsk",
            code: `import { locals } from '@vesk/runtime/server';

component ProfileBanner() {
  const name = locals().name;
  <div>
    {name && <p>Welcome back, {name}</p>}
    {!name && <p>Welcome, guest</p>}
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/ProfileBanner.vsk",
            code: `import { locals } from '@vesk/runtime/server';

component ProfileBanner() {
  const name = locals().name;
  return (
    <div>
      {name && <p>Welcome back, {name}</p>}
      {!name && <p>Welcome, guest</p>}
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "useRequest() and useBody()" },
      {
        kind: "p",
        text: "`useRequest()` hands you the raw context; `useBody()` parses the body by `content-type` — `application/json` → object, `x-www-form-urlencoded` → object, anything else → text. Both are for server-side code (components, API routes, actions); `useBody` is cached per request.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/components/RequestInfo.vsk",
            code: `import { useRequest } from '@vesk/runtime/server';

component RequestInfo() {
  const req = useRequest();
  const url = req?.url;
  <div>
    {url && <p>Requested: {url}</p>}
    {!url && <p>Rendered without a live request</p>}
  </div>
}`,
          },
          {
            label: "expression mode",
            filename: "app/components/RequestInfo.vsk",
            code: `import { useRequest } from '@vesk/runtime/server';

component RequestInfo() {
  const req = useRequest();
  const url = req?.url;
  return (
    <div>
      {url && <p>Requested: {url}</p>}
      {!url && <p>Rendered without a live request</p>}
    </div>
  );
}`,
          },
        ],
      },
      { kind: "h2", text: "Full API route handler" },
      {
        kind: "p",
        text: "API routes are TypeScript files under `app/api` exporting handlers named after HTTP methods. `useParams`, `useBody`, `useRequest`, `cookies()`, `headers()` and `locals()` all work inside them, next to the `VeskResponse` fluent builder.",
      },
      {
        kind: "code",
        filename: "app/api/posts/[id]/comments/route.ts",
        code: `import {
  VeskResponse,
  cookies,
  headers,
  locals,
  useBody,
  useParams,
  useRequest,
} from '@vesk/runtime/server';

export interface Comment {
  author: string;
  text: string;
}

export async function POST() {
  const params = useParams();
  const jar = cookies();
  const accept = headers().get('accept');
  const userId = locals().userId;
  const body = (await useBody()) as Comment;
  const req = useRequest();

  return VeskResponse.json(
    {
      ok: true,
      postId: params.id,
      text: body.text,
      userId: userId ?? null,
      session: jar.get('session') ?? null,
      accept,
      url: req?.url,
    },
    { status: 201 },
  ).setCookie('draft-saved', '1', { maxAge: 86400 });
}`,
      },
      { kind: "h2", text: "Building responses" },
      {
        kind: "p",
        text: "Two response classes ship in `@vesk/runtime/server`: `ServerResponse` covers the routing primitives (redirect, rewrite, next), and `VeskResponse` extends it with a fluent builder for JSON, HTML, cookies, caching and security headers. Both extend the standard `Response`.",
      },
      {
        kind: "code",
        filename: "app/api/flow/route.ts",
        code: `import { ServerResponse } from '@vesk/runtime/server';

export async function GET() {
  return ServerResponse.redirect('/login', 307);
}

export async function POST() {
  // Keep the request going, but render another route
  return ServerResponse.rewrite('/api/internal');
}

export async function PUT() {
  // No match here — fall through to the next handler
  return ServerResponse.next();
}`,
      },
      {
        kind: "list",
        items: [
          "`ServerResponse.json(body, init?)` — JSON body + `Content-Type: application/json`.",
          "`ServerResponse.redirect(url, status = 307)` — `Location` header.",
          "`ServerResponse.rewrite(url)` — sets `x-vesk-rewrite`; the runtime re-dispatches the request.",
          "`ServerResponse.next()` — sets `x-vesk-next`; falls through to the next matching handler.",
        ],
      },
      { kind: "h2", text: "VeskResponse (fluent)" },
      {
        kind: "p",
        text: "`VeskResponse` is a Proxy over a `ServerResponse` subclass, so it can be called with or without `new`. Every chainable method returns the same instance. Static constructors: `json`, `redirect`, `rewrite`, `next`, `html` and `stream`. The returned instance also has `text()` / `json()` for reading the body and a `status` getter that reflects `setStatus`. `build()` (also `text()` and `json()`) flushes queued security headers and cookies into real header values.",
      },
      {
        kind: "code",
        filename: "app/api/hello/route.ts",
        code: `import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  return VeskResponse.json({ message: 'Hello from Vesk!' })
    .setStatus(201)
    .setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 })
    .setCsp("default-src 'self'")
    .cors({ origin: 'https://example.com', methods: 'GET,POST' });
}

export async function POST(req: VeskRequest) {
  const body = await req.json();
  return VeskResponse.json({ received: body, ok: true }, { status: 201 })
    .setCookie('posted', 'true');
}`,
      },
      {
        kind: "table",
        head: ["Member", "Effect"],
        rows: [
          ["`static json(body, init?)`", "JSON response with `Content-Type: application/json`."],
          ["`static redirect(url, status = 307)`", "Response with a `Location` header."],
          ["`static rewrite(url)`", "Sets `x-vesk-rewrite` for internal re-dispatch."],
          ["`static next()`", "Sets `x-vesk-next` to fall through to the next handler."],
          ["`static html(html, init?)`", "Response with `Content-Type: text/html; charset=utf-8`."],
          ["`static stream(readable, init?)`", "Chunked response over a `ReadableStream` body (SSE, file streams)."],
          ["`setStatus(code)`", "Final status; the `status` getter returns it even if the initial `ResponseInit` differs."],
          ["`setCookie(name, value, opts?)`", "Queues a `Set-Cookie` header. `HttpOnly` and `Secure` are on by default, `SameSite=Lax`, `Path=/`. Options: `httpOnly`, `secure`, `sameSite` (`'Lax' | 'Strict' | 'None'`), `maxAge`, `path`, `domain`."],
          ["`clearCookie(name, opts?)`", "Queues an expiring (`Max-Age=0`) cookie. Options: `path`, `domain`."],
          ["`setCsp(policy | false)`", "Sets `Content-Security-Policy` with a raw CSP string; `false` removes it."],
          ["`setSecurityHeader(name, value | false)`", "Sets an arbitrary security header; `false` removes it."],
          ["`cache(ttlSeconds)`", "`Cache-Control: public, max-age=<ttl>, s-maxage=<ttl>`."],
          ["`noCache()`", "`no-store, no-cache, must-revalidate, proxy-revalidate` + `Pragma: no-cache` + `Expires: 0`."],
          ["`cors(opts?)`", "Sets `Access-Control-*` headers: `origin`, `methods`, `headers`, `credentials` (credentials default true)."],
          ["`build()`", "Flushes security headers and queued cookies into the response headers and returns the instance."],
          ["`text()` / `json()`", "Flush security headers, then read the body as text / JSON."],
          ["`status` (getter)", "The `setStatus` status if set, otherwise the underlying `Response.status`."],
        ],
      },
      { kind: "h2", text: "VeskRequest" },
      {
        kind: "p",
        text: "`VeskRequest` extends `ServerRequest` (which extends the standard `Request` and adds `cookies`, `params` and `locals` stores). It adds request metadata accessors plus security setters. Construct it directly, or wrap an inbound platform `Request` with `VeskRequest.from()` to seed `params`/`locals` for renders.",
      },
      {
        kind: "table",
        head: ["Member", "What it exposes"],
        rows: [
          ["`url`, `method`, `headers()`", "Inherited from `Request`."],
          ["`query`", "`Record<string, string>` of parsed search params (cached)."],
          ["`parsedUrl`", "Cached `URL` instance."],
          ["`host`", "Host header honoring `x-forwarded-host` when trust proxy is enabled; falls back to the parsed URL host."],
          ["`hostname`", "Host without the port."],
          ["`origin`", "`protocol://host` — base for resolving relative URLs."],
          ["`protocol`", "`http`/`https`, honoring `x-forwarded-proto` when trust proxy is enabled."],
          ["`ip`", "First `x-forwarded-for` entry / `x-real-ip` when trust proxy is enabled, else `'unknown'`."],
          ["`body`", "Lazy `Promise<unknown>` — parsed JSON, form data, or text (JSON.parse fallback)."],
          ["`cookies`", "`CookieStore` with `get`, `getAll`, `toString` and direct reads."],
          ["`params` / `locals`", "Settable `Record<string, string>` / `Record<string, unknown>` stores."],
          ["`set(key, value)` / `get(key)`", "Locals map accessors so `VeskRequest` doubles as the middleware context."],
          ["`resolveUrl(url)`", "Resolves a possibly-relative URL against `origin`. Used by SSR fetches so `/api/...` works during render."],
          ["`static from(request, { params?, locals? })`", "Wraps a platform `Request` (same method + headers, cookies parsed) with seeded params/locals."],
          ["`setCsp(policy | false)`", "Records a CSP override applied to the response via `applyRequestSecurity`."],
          ["`setCsrf(enable)`", "Records the CSRF flag override."],
          ["`setRateLimit({ windowMs?, max? } | false)`", "Records a rate-limit override."],
          ["`setSecurityHeader(name, value | false)`", "Records a custom header override."],
          ["`setTrustProxy(enable | string)`", "Enables trusting `x-forwarded-*` headers for `ip`, `protocol` and `host`."],
          ["`getSecurityOverrides()`", "Returns the recorded `_security` overrides object."],
        ],
      },
      {
        kind: "code",
        filename: "app/api/request/route.ts",
        code: `import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  return VeskResponse.json({
    url: req.url,
    method: req.method,
    pathname: req.parsedUrl.pathname,
    query: req.query,
    host: req.host,
    hostname: req.hostname,
    origin: req.origin,
    protocol: req.protocol,
    ip: req.ip,
    absolute: req.resolveUrl('/api/self'),
  });
}`,
      },
      { kind: "h2", text: "Security helpers" },
      {
        kind: "p",
        text: "`withValidation(request, schema, { jsonOnly? })` parses the body (JSON, form data, or text) and runs `schema.safeParse(data)`. On failure it returns a `ServerResponse.json` 400 with `{ error, issues: [{ path, message }] }`; on success it returns `result.data`. `applyRequestSecurity(request, response)` pushes CSP / custom-header overrides recorded on a `VeskRequest` onto the response.",
      },
      {
        kind: "code",
        filename: "app/api/signup/route.ts",
        code: `import { withValidation } from '@vesk/runtime/server';

const schema = {
  safeParse: (data: unknown) => {
    const d = data as { email?: string };
    return d.email?.includes('@')
      ? { success: true as const, data: d }
      : { success: false as const, error: { issues: [{ path: ['email'], message: 'Invalid email' }] } };
  },
};

export async function POST(request: Request) {
  const result = await withValidation(request, schema);
  if (result instanceof Response) return result;
  return Response.json({ ok: true, email: (result as { email?: string }).email });
}`,
      },
      {
        kind: "code",
        filename: "app/api/secure/route.ts",
        code: `import { applyRequestSecurity, VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  req.setCsp("default-src 'self'");
  req.setSecurityHeader('X-Custom', 'yes');
  const res = VeskResponse.json({ ok: true });
  applyRequestSecurity(req, res);
  return res;
}

// Wrapping a platform Request with seeded params/locals
export async function wrap(platformRequest: Request, db: unknown) {
  const vreq = VeskRequest.from(platformRequest, {
    params: { id: '42' },
    locals: { db },
  });
  vreq.setTrustProxy(true);
  vreq.setCsrf(true);
  vreq.setRateLimit({ windowMs: 60_000, max: 100 });
  return vreq.getSecurityOverrides();
}`,
      },
      { kind: "h2", text: "Signed cookies" },
      {
        kind: "p",
        text: "Vesk signs cookies with HMAC-SHA256 (Web Crypto) using a per-host secret, producing `value.base64url-signature` over the `name=value` payload. Tampered cookies unsign to `null`. All four helpers are async; `signCookie`/`setSignedCookie`/`readSignedCookie`/`unsignCookie` require the compiler package to be present, which the built runtime bundles.",
      },
      {
        kind: "list",
        items: [
          "`signCookie(name, value, host?)` → `Promise<string>` — signed `value.signature`.",
          "`unsignCookie(name, signedValue, host?)` → `Promise<string | null>` — the value, or `null` when the signature is invalid.",
          "`setSignedCookie(name, value, options?, host?)` → `Promise<string>` — a ready-to-use `Set-Cookie` string (signed value + `HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age`, `Domain`).",
          "`readSignedCookie(name, cookieString, host?)` → `Promise<string | null>` — parses a `Cookie`/`Set-Cookie` string and unsigns one entry.",
        ],
      },
      {
        kind: "code",
        filename: "app/api/session/route.ts",
        code: `import {
  readSignedCookie,
  setSignedCookie,
  signCookie,
  unsignCookie,
} from '@vesk/runtime/server';

export async function GET() {
  const signed = await signCookie('session', 'user-42', 'example.com');
  const value = await unsignCookie('session', signed, 'example.com');
  return Response.json({ signed, value });
}

export async function POST(request: Request) {
  const cookie = await setSignedCookie('token', 'abc', { httpOnly: true, maxAge: 3600 }, 'example.com');
  const token = await readSignedCookie('token', request.headers.get('cookie') ?? '', 'example.com');
  return Response.json({ cookie, token });
}`,
      },
      { kind: "h2", text: "CORS" },
      {
        kind: "p",
        text: "`cors(options)` returns a middleware function you can call from an `OPTIONS` handler and use to decorate normal responses: an `OPTIONS` request gets a `204` with the `Access-Control-*` headers; any other request sets those headers as `_pending` so `applyCors(response)` can stamp them onto the final response.",
      },
      {
        kind: "list",
        items: [
          "`origin` — default `'*'`.",
          "`methods` — default `'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS'`.",
          "`allowedHeaders` — default `'Content-Type, Authorization'`.",
          "`credentials` — default `true` (adds `Access-Control-Allow-Credentials: true`).",
          "`maxAge` — default `86400`.",
          "`exposeHeaders` — optional `string[]`.",
        ],
      },
      {
        kind: "code",
        filename: "app/api/cors/route.ts",
        code: `import { cors, VeskResponse } from '@vesk/runtime/server';

const api = cors({
  origin: 'https://app.example.com',
  methods: 'GET,POST,PUT,DELETE,OPTIONS',
  credentials: true,
});

export async function OPTIONS(request: Request) {
  return api(request);
}

export async function GET(request: Request) {
  const res = VeskResponse.json({ ok: true });
  return api.applyCors(res);
}`,
      },
      { kind: "h2", text: "Webhooks" },
      {
        kind: "p",
        text: "`webhook({ secret, handler, headerName?, signaturePrefix? })` returns a request handler that verifies a SHA-256 HMAC signature before running your `handler(event, request)`. The signature is compared in constant time (length then char-by-char). A missing or invalid signature responds `401` with `{ error }`. Requires Web Crypto, and `handler` must return a `Response`.",
      },
      {
        kind: "list",
        items: [
          "`secret` — required; used as the HMAC key.",
          "`handler(event, request)` — `event` is the parsed JSON body (raw body text when it isn't JSON).",
          "`headerName` — default `'x-webhook-signature'`.",
          "`signaturePrefix` — default `'sha256='`.",
        ],
      },
      {
        kind: "code",
        filename: "app/api/hooks/route.ts",
        code: `import { webhook } from '@vesk/runtime/server';

export const POST = webhook({
  secret: process.env.WEBHOOK_SECRET!,
  headerName: 'x-webhook-signature',
  signaturePrefix: 'sha256=',
  handler(event, request) {
    return Response.json({ received: event });
  },
});`,
      },
      { kind: "h2", text: "Hooks (defineHook / removeHook / runHooks)" },
      {
        kind: "p",
        text: "`defineHook(name, fn)` registers a hook in a process-wide registry; `removeHook(name, fn)` unregisters it; `runHooks(name, ...args)` runs the registered hooks serially and short-circuits with the first `Response` a hook returns (otherwise `undefined`). The API-route runner already invokes live `beforeRequest` / `afterRequest` / `onError` hooks — the primitives are also useful for your own middleware-style logic.",
      },
      {
        kind: "code",
        filename: "app/lib/hooks.ts",
        code: `import { defineHook, removeHook, runHooks } from '@vesk/runtime/server';

interface HookCtx {
  params: Record<string, string>;
  locals: Record<string, unknown>;
}

export function protect(roles: string[]) {
  const fn = async (_request: Request, ctx: HookCtx) => {
    const user = ctx.locals.user as { role?: string } | undefined;
    if (!user || !roles.includes(user.role ?? '')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  };
  defineHook('beforeRequest', fn);
  return () => removeHook('beforeRequest', fn);
}

// Register once at boot
const dispose = protect(['admin']);

// runHooks short-circuits: the first hook that returns a Response wins
export async function GET() {
  const blocked = await runHooks('beforeRequest', new Request('/api/secure'), {
    params: {},
    locals: { user: { id: 1, role: 'viewer' } },
  });
  if (blocked) return blocked;
  dispose();
  return Response.json({ ok: true });
}`,
      },
      { kind: "h2", text: "Server events (app/_events.ts)" },
      {
        kind: "p",
        text: "`app/_events.ts` (or `.js`) is the private convention file for lifecycle handlers. The `_` prefix means it is never routed. Values `set()` in `onStart` land in the server-wide context (`serverLocals()` / `getServerContext`) and are pre-seeded into every request's `locals()`.",
      },
      {
        kind: "list",
        items: [
          "`onStart(ctx)` — once at server boot (lazily once per isolate on serverless/edge targets).",
          "`onRequest(ctx)` — every app request, with a request-scoped context.",
          "`onStop(ctx)` — graceful shutdown on Node servers (also dev HMR reload).",
        ],
      },
      {
        kind: "code",
        filename: "app/_events.ts",
        code: `import type { ServerEventContext } from '@vesk/types';

declare function createDb(): Promise<{ close(): Promise<void> }>;

export async function onStart(ctx: ServerEventContext) {
  await ctx.set('db', await createDb());
  ctx.set('bootedAt', Date.now());
}

export async function onRequest(ctx: ServerEventContext) {
  const hits = (ctx.get('hits') as number) || 0;
  ctx.set('hits', hits + 1);
}

export async function onStop(ctx: ServerEventContext) {
  const db = ctx.get('db') as { close(): Promise<void> } | undefined;
  await db?.close();
}`,
      },
      {
        kind: "p",
        text: "`ctx.set`/`ctx.get` mirror the explicit server-wide context functions from `@vesk/runtime/server`:",
      },
      {
        kind: "list",
        items: [
          "`serverLocals(): Record<string, unknown>` — the process/isolate-wide store shared across every request.",
          "`getServerContext(key)` — read one value (`undefined` when unset).",
          "`setServerContext(key, value)` — write one value, visible to every subsequent request.",
          "`clearServerContext()` — wipe the entire store.",
        ],
      },
      {
        kind: "table",
        head: ["Field", "Type", "Meaning"],
        rows: [
          ["`server`", "`unknown`", "The running Node `http.Server`; `null` on serverless/edge targets and at build time."],
          ["`port`", "`number`", "The port the server listens on (`0` when no persistent server exists)."],
          ["`host`", "`string`", "The host address the server binds."],
          ["`request`", "`Request`", "The current `Request` (present in `onRequest`)."],
          ["`params`", "`Record<string, string>`", "Current route params."],
          ["`url`", "`URL`", "Parsed request URL."],
          ["`locals`", "`Record<string, unknown>`", "Per-request locals."],
          ["`cookies`", "`Record<string, string>`", "The request's cookies."],
          ["`serverLocals`", "`Record<string, unknown>`", "The process-wide store shared across every request."],
          ["`set(key, value)`", "method", "Writes to `serverLocals` (visible after the current request)."],
          ["`get(key)`", "method", "Reads from `serverLocals`."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "`useBody()` throws when called outside a request context, and `useRequest()` returns `null` there. `getServerContext(key)` returns `undefined` for unset keys. The signed-cookie helpers throw if `@vesk/compiler` isn't available. The webhook handler you pass must return a `Response`.",
      },
    ],
  },
];

// Convenience alias matching the existing docs.ts export name
export const docPages = pages;