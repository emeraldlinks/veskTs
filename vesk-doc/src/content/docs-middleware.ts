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
    slug: "middleware",
    title: "Middleware",
    description:
      "fn(ctx, next) middleware, MiddlewareContext helpers, typed next() responses, cookies and headers, aborting, request binding, rewriting, and the dev/prod/edge execution model.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Middleware runs before a page renders or an API handler executes and is shared by every request that maps to the directory it lives in. Drop a `middleware.ts` file into any route directory: `app/middleware.ts` runs for the whole app, `app/blog/middleware.ts` additionally runs for `/blog` paths and anything under them, including API routes below that directory. Directories execute parent-first in an onion/chain model.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const start = Date.now();

  const response = await next();

  if (response) {
    response.headers.set('server-timing', 'app;dur=' + (Date.now() - start));
  }

  return response;
}`,
      },
      {
        kind: "p",
        text:
          "The file is plain TypeScript and is loaded as a module, so imports work normally. The loader accepts the middleware as the named export `middleware` or as a `default` export. Middleware must live in a TypeScript file — a `middleware.vsk` is skipped with a structure warning.",
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The context and response helpers below are additive. Existing middleware written with only `ctx.request`, `ctx.url`, `ctx.locals`, `ctx.cookies`, `ctx.set`, `ctx.get` and a plain `Response` continues to work unchanged and is fully supported.",
      },
      { kind: "h2", text: "Execution model" },
      {
        kind: "list",
        items: [
          "**Order** — root middleware runs first, then each matching route-directory middleware, then the page render or API handler. The response travels back through the chain in reverse order, so post-`next()` code is the place to add headers, cookies or logging.",
          "**Pages and API routes** — the same chain applies to SSR pages and `app/api/**/route.ts` handlers. `ctx.params` contains the matched dynamic params in both cases.",
          "**Dev** — the compiler executor runs the chain and hands the final render to the route.",
          "**Node production** — per-route SSR/API functions embed the chain; the production server also has the root `server/middleware.js` executor.",
          "**Serverless and edge** — platform builds inline the same executor into the SSR/API functions, so pass-through response mutation behaves the same on Cloudflare, Vercel, Netlify, Deno and AWS.",
          "**Scope** — static files and prerendered output are served before middleware. Middleware applies to requests that reach the server/API/SSR pipeline.",
        ],
      },
      { kind: "h2", text: "MiddlewareContext" },
      {
        kind: "p",
        text:
          "The signature is `fn(ctx, next)`: one context object plus the chain continuation. The context includes the request, route data, request-scoped locals and helpers for building or mutating responses.",
      },
      {
        kind: "table",
        head: ["Member", "Description"],
        rows: [
          ["`request`", "The incoming `Request` (a `VeskRequest` in parts of the dev/prod pipeline) — method, headers, URL and body."],
          ["`params`", "Route parameters for the matched path, as `Record<string, string>`."],
          ["`url`", "The parsed `URL` of the request. Updated to the rewrite target when `next(rewrite)` is called."],
          ["`locals`", "The shared per-request store — seeded from server events and visible to later middleware, pages, API handlers and `locals()`."],
          ["`cookies`", "Request cookies parsed as `Record<string, string | undefined>`."],
          ["`set(key, value)`", "Writes a value into `locals`. Key and value types come from `VeskLocals` or from `MiddlewareContext<L>`."],
          ["`get(key)`", "Reads a value from `locals` with the same key-aware typing."],
          ["`ctx[key]`", "The runtime proxy falls back to `locals`, but undeclared TypeScript index properties are `unknown`; prefer `ctx.get('key')` in typed code."],
          ["`cookie(name)`", "Reads one request cookie. Equivalent to `ctx.cookies[name]`, with `undefined` for a missing cookie."],
          ["`getHeader(name)`", "Reads one request header. Names are case-insensitive."],
          ["`header(name, value)`", "Queues a header on the final response. The header is applied after downstream middleware and the route have returned, so every response path gets it."],
          ["`status(code)`", "Builds an empty response with that status code."],
          ["`json(body, init?)`", "Builds a JSON response and sets `Content-Type: application/json` unless `init.headers` overrides it."],
          ["`text(body, init?)`", "Builds a text/body response. Set `Content-Type` in `init.headers` when the consumer needs one."],
          ["`html(body, init?)`", "Builds an HTML response with `Content-Type: text/html; charset=utf-8`."],
          ["`redirect(url, status?)`", "Builds a redirect response with `Location`; the status defaults to `302`."],
          ["`shouldBindQuery(schema?)`", "Parses the query string and returns `{ data, error }`. An optional schema with `safeParse` validates the data."],
          ["`bindQuery(schema?)`", "Like `shouldBindQuery`, but throws the validation/parse error instead of returning it."],
          ["`shouldBindJSON(schema?)`", "Reads a clone of the request body as JSON and returns `{ data, error }`. An optional schema with `safeParse` validates it."],
          ["`bindJSON(schema?)`", "Like `shouldBindJSON`, but throws the validation/parse error instead of returning it."],
          ["`errors`", "Array of collected `{ error }` records. Framework-caught middleware errors and `ctx.error(err)` calls land here."],
          ["`error(err)`", "Records an error in `ctx.errors` without throwing it, then returns the error."],
          ["`abort()`", "Marks the chain aborted and prevents further `next()` calls. It does not create a response by itself."],
          ["`isAborted()`", "Returns whether the chain has been marked aborted."],
          ["`abortWithStatus(code)`", "Marks the chain aborted and builds an empty response with that status."],
          ["`abortWithStatusJSON(code, body)`", "Marks the chain aborted and builds a JSON error response."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The helper properties are optional in the public `MiddlewareContext` type for compatibility, but the dev, Node-production and platform executors install all of them at runtime. In strict projects, guard them with `typeof ctx.json === 'function'` or use a non-null assertion (`ctx.json!(...)`); the examples below use the assertion form. Prefer `abortWithStatus` / `abortWithStatusJSON` when you need a deterministic short-circuit; a bare `ctx.abort()` only flips the flag.",
      },
      { kind: "h2", text: "Global typed locals" },
      {
        kind: "p",
        text:
          "Vesk applications can declare their request/server locals once by augmenting `VeskLocals` from `@vesk/types`. The default `MiddlewareContext`, `ServerEventContext`, and `locals()` then use those key/value types everywhere. Unaugmented projects keep arbitrary keys as `unknown`, preserving existing behavior.",
      },
      {
        kind: "code",
        filename: "app/types.d.ts",
        language: "ts",
        code: `import type { User } from './types';

declare module '@vesk/types' {
  interface VeskLocals {
    user: User | null;
    requestId: string;
  }
}`,
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  ctx.set('requestId', crypto.randomUUID());
  ctx.set('user', { id: '1', name: 'Ada' });

  const user = ctx.get('user');
  // user: User | null

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "The generic is compile-time only; it does not validate runtime values. For an isolated module, use `MiddlewareContext<MyLocals>` or the per-call form `ctx.set<MyLocals>('user', value)`. A later `ctx.get('user')` is typed from the globally augmented `VeskLocals`, not from the previous call's type argument. `createLocals<T>()` is a separate standalone store, not the ambient request locals object.",
      },
      { kind: "h2", text: "ServerEventContext" },
      {
        kind: "p",
        text:
          "`app/_events.ts` lifecycle handlers receive a `ServerEventContext`. It has the same typed locals/set/get surface, plus optional `server`, `port`, and `host` fields on persistent Node servers. Values set during `onStart` are server/isolate-wide and are pre-seeded into subsequent request locals.",
      },
      {
        kind: "code",
        filename: "app/_events.ts",
        language: "ts",
        code: `import type { ServerEventContext } from '@vesk/types';

export async function onStart(ctx: ServerEventContext) {
  ctx.set('requestId', 'server-boot-id');
}

export async function onRequest(ctx: ServerEventContext) {
  const requestId = ctx.get('requestId');
}`,
      },
      { kind: "h2", text: "next(), responses and rewriting" },
      {
        kind: "p",
        text:
          "`next()` continues the chain into the following middleware (and finally the page render or API handler). It resolves to a `VeskResponse | null`. `VeskResponse` is a `Response` subclass with cookie, security and header helpers, so `const res = await next(); res?.setCookie(...)` works without converting the response first.",
      },
      {
        kind: "p",
        text:
          "The framework preserves the downstream response even when middleware does `await next()` without returning it. Returning the response is still the clearest form, and is required when you want to return a different response or mutate it after the call.",
      },
      {
        kind: "list",
        items: [
          "Call `next()` once. A second call returns `null`.",
          "Returning a `Response` without calling `next()` short-circuits the chain. The route never runs.",
          "If middleware neither calls `next()` nor returns a response, the chain continues to the next middleware/route. Use an explicit `return ctx.status(...)`, `return ctx.json(...)`, or `return ctx.abortWithStatus(...)` to stop.",
          "`next(rewrite)` rewrites the request URL internally and re-matches it. API requests can target another API route or fall through to a page; page requests can target another page or an API route. Route-local middleware on the target does not run twice — the source chain keeps ownership of the onion and post-processes the target response. The browser keeps the original URL. Return `next(target)` (or its downstream response) for the rewrite to take effect; use a redirect when the address bar should change too.",
        ],
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export default async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  if (ctx.url.hostname === 'www.example.com') {
    const canonical = 'https://example.com' + ctx.url.pathname + ctx.url.search;
    return next(canonical);
  }

  return next();
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "If you only want to show a different page while keeping the URL, use `next('/canonical-path')`. If the browser address should change, return `ctx.redirect('/canonical-path')` or throw `redirect('/canonical-path')` from `@vesk/runtime/server`.",
      },
      { kind: "h2", text: "Reading the request" },
      {
        kind: "p",
        text:
          "`ctx.request` is a standard `Request`, so `method`, `headers`, `url`, `signal` and body reading behave normally. `ctx.cookies` and `ctx.cookie(name)` are convenience accessors over the `Cookie` header. Query params are on `ctx.url.searchParams` or through the binding helpers below.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const session = ctx.cookie!('session');
  const authorization = ctx.getHeader!('authorization');
  const id = ctx.url.searchParams.get('id');

  if (!session && !authorization) {
    return ctx.abortWithStatusJSON!(401, { error: 'Unauthorized' });
  }

  ctx.set('requestId', id || crypto.randomUUID());

  return next();
}`,
      },
      { kind: "h2", text: "Building and short-circuiting responses" },
      {
        kind: "p",
        text:
          "The response helpers are the concise way to end the chain without touching the page/API handler. They return a response; return that value from the middleware to short-circuit.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  if (ctx.url.pathname === '/health') {
    return ctx.json!({ ok: true });
  }

  if (ctx.url.pathname === '/maintenance') {
    return ctx.status!(503);
  }

  if (ctx.url.pathname === '/old-docs') {
    return ctx.redirect!('/docs', 308);
  }

  return next();
}`,
      },
      {
        kind: "table",
        head: ["Helper", "What it returns"],
        rows: [
          ["`ctx.status(204)`", "An empty response with status `204`."],
          ["`ctx.json(value, init?)`", "A JSON response with `Content-Type: application/json`."],
          ["`ctx.text(value, init?)`", "A response with the string body; add `Content-Type` through `init.headers`."],
          ["`ctx.html(value, init?)`", "An HTML response with `Content-Type: text/html; charset=utf-8`."],
          ["`ctx.redirect(url, status?)`", "A redirect response with `Location`; status defaults to `302`."],
          ["`ctx.abortWithStatus(code)`", "An empty response; also marks the chain aborted."],
          ["`ctx.abortWithStatusJSON(code, body)`", "A JSON response; also marks the chain aborted."],
        ],
      },
      { kind: "h2", text: "Mutating the downstream response" },
      {
        kind: "p",
        text:
          "The common onion pattern is still `const res = await next()` followed by mutations. `next()` is typed as `Promise<VeskResponse | null>` and the runtime normalizes plain `Response` objects into a `VeskResponse`, so cookie helpers are available on both SSR pages and API responses.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const res = await next();

  if (res) {
    res.setCookie('visited', '1', { path: '/', httpOnly: false, secure: false });
    res.setCookie('theme', 'dark', { path: '/', maxAge: 60 * 60 * 24 * 365 });
    res.clearCookie('legacy_session', { path: '/' });
    res.headers.set('x-request-id', crypto.randomUUID());
    res.headers.set('cache-control', 'private, max-age=0');
  }

  return res;
}`,
      },
      {
        kind: "list",
        items: [
          "`setCookie(name, value, opts?)` queues a cookie. Defaults are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Pass `httpOnly: false` / `secure: false` when a local HTTP client must read or accept it.",
          "`clearCookie(name?, opts?)` queues an expired cookie (`Max-Age=0`). With no name it clears every cookie this `VeskResponse` queued.",
          "`setStatus(code)` mutates the response status; `statusCode` reads the effective status.",
          "`getHeader(name)` reads a header and `headers.set/get` work as normal.",
          "`redirect(url, status = 302)` mutates the response status and `Location` while preserving its body, cookies and security headers. The static `VeskResponse.redirect(url, 307)` keeps its 307 default.",
          "`setCsp(policy | false)`, `setSecurityHeader(name, value | false)`, `cache(seconds)`, `noCache()` and `cors(opts?)` queue security/cache/CORS headers.",
          "`build()` flushes queued cookies and security headers into `Headers`. The middleware executor calls it automatically on the final response.",
        ],
      },
      {
        kind: "p",
        text:
          "Do not rebuild a response manually if you need to keep queued cookies — `new Response(res.body, { headers: new Headers(res.headers) })` loses the `VeskResponse` cookie queue. Return the response you got from `next()`, mutate it in place, or upgrade a standard `Response` with `toVeskResponse()` before calling cookie helpers.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';
import { toVeskResponse } from '@vesk/runtime/server';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const res = toVeskResponse(await next());

  if (res) {
    res.setCookie('session_seen', '1', { path: '/', httpOnly: false, secure: false });
    res.build();
  }

  return res;
}`,
      },
      { kind: "h2", text: "Queued headers with ctx.header()" },
      {
        kind: "p",
        text:
          "`ctx.header(name, value)` queues a header on the final response. Unlike `res.headers.set`, it does not require a downstream response to exist yet, and it still applies when the middleware short-circuits with `ctx.json()` or `ctx.status()`.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  ctx.header!('x-request-id', crypto.randomUUID());
  ctx.header!('x-content-type-options', 'nosniff');
  ctx.header!('referrer-policy', 'strict-origin-when-cross-origin');

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "Header names are case-insensitive and are stored lowercase. Calling `ctx.header()` again with the same name replaces the queued value. For response-specific headers and cookie helpers, mutate the `VeskResponse` returned by `next()`.",
      },
      { kind: "h2", text: "Cookies" },
      {
        kind: "p",
        text:
          "Use `setCookie` and `clearCookie` on the response. They queue values and flush on `build()`, so multiple cookies are preserved instead of overwriting one another. `ctx.header('Set-Cookie', ...)` is not recommended for multiple cookies because a single `Headers` value cannot represent several `Set-Cookie` lines reliably.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const res = await next();

  if (res) {
    res.setCookie('session', 'abc123', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60,
    });

    // Clear a cookie with the same path/domain it was written with.
    res.clearCookie('legacy_session', { path: '/' });
  }

  return res;
}`,
      },
      { kind: "h2", text: "Abort and error handling" },
      {
        kind: "p",
        text:
          "`abortWithStatus` and `abortWithStatusJSON` both mark the chain aborted and provide the response the executor should return. Use them for auth failures, rate limits, validation failures and other early exits.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const token = ctx.cookie!('session');

  if (!token) {
    return ctx.abortWithStatusJSON!(401, { error: 'Unauthorized' });
  }

  if (ctx.isAborted!()) {
    return ctx.abortWithStatus!(400);
  }

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "`ctx.error(err)` records an error without throwing it and returns the error value. `ctx.errors` contains both these records and errors caught by the middleware executor, which makes it useful for reporting or for deciding whether to return a generic error response.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  try {
    return await next();
  } catch (err) {
    ctx.error!(err);
    return ctx.abortWithStatusJSON!(500, { error: 'Internal Server Error' });
  }
}`,
      },
      {
        kind: "list",
        items: [
          "Throwing a `Redirect` error produced by `redirect()` from `@vesk/runtime/server` is converted to a redirect response.",
          "Returning `Response.redirect('/login', 302)` is normalized too, including relative URLs.",
          "A `TypeError` thrown by middleware becomes a `500` instead of crashing a serverless/edge invocation.",
          "For API routes, an unhandled middleware error follows the route's error handling; `abortWithStatusJSON` is the portable way to return a structured API error.",
        ],
      },
      { kind: "h2", text: "Binding query and JSON data" },
      {
        kind: "p",
        text:
          "`shouldBindQuery` reads `ctx.url.searchParams` and `shouldBindJSON` reads a clone of the request body. Both accept an optional schema with a `safeParse(data)` method (for example Zod) and return `{ data, error }`. The `bind*` variants throw on a parse or validation failure.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

const Query = {
  safeParse(value: unknown) {
    const input = value as Record<string, string>;
    if (!input.id) return { success: false, error: new Error('id is required') };
    return { success: true, data: { id: Number(input.id) } };
  },
};

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const query = ctx.shouldBindQuery!(Query);

  if (query.error) {
    return ctx.abortWithStatusJSON!(400, { error: 'Invalid query' });
  }

  const body = await ctx.shouldBindJSON!<{ name?: string }>();

  if (body.error) {
    return ctx.abortWithStatusJSON!(400, { error: 'Invalid JSON body' });
  }

  return next();
}`,
      },
      {
        kind: "note",
        tone: "info",
        text:
          "`shouldBindJSON` clones the request before reading it, so the downstream handler can still read the body. Invalid JSON, an empty body and schema failures all come back as `{ error }`; use `bindJSON` when a throw is more convenient.",
      },
      { kind: "h2", text: "Examples" },
      {
        kind: "p",
        text: "**Auth:** read the session cookie, store the user in locals, and abort guests before the page or API handler runs.",
      },
      {
        kind: "code",
        filename: "app/dashboard/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const token = ctx.cookie!('session');

  if (!token) {
    return ctx.abortWithStatusJSON!(401, { error: 'Unauthorized' });
  }

  ctx.set('user', { name: 'Ada', role: 'admin' });

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "The page reads that user back through `locals()` from `@vesk/runtime/server`, keeping the pipeline server-side only — it renders once during SSR and never runs on the client, so the account data never crosses the wire.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/dashboard/page.vsk",
            code: `import { locals } from '@vesk/runtime/server';

component UserBanner() {
  const user = locals<{ user?: { name: string } }>().user;

  <p>Signed in as {user?.name}</p>
}

export default component Page() {
  <section>
    <UserBanner />
    <h1>Dashboard</h1>
  </section>
}`,
          },
          {
            label: "expression mode",
            filename: "app/dashboard/page.vsk",
            code: `import { locals } from '@vesk/runtime/server';

component UserBanner() {
  const user = locals<{ user?: { name: string } }>().user;

  return <p>Signed in as {user?.name}</p>;
}

export default component Page() {
  return (
    <section>
      <UserBanner />
      <h1>Dashboard</h1>
    </section>
  );
}`,
          },
        ],
      },
      {
        kind: "p",
        text:
          "**Pass-through cookies and headers:** mutate the real SSR/API response after `next()`. This works in dev, Node production and platform/serverless builds because the route executes inside the onion.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  const res = await next();

  if (res && ctx.url.pathname.startsWith('/account')) {
    res.setCookie('account_visited', '1', { path: '/', httpOnly: false, secure: false });
    res.headers.set('x-account-scope', 'private');
    res.headers.set('cache-control', 'private, no-store');
  }

  return res;
}`,
      },
      {
        kind: "p",
        text:
          "**API routes** use the same middleware chain. A middleware at `app/api/middleware.ts` runs for every API handler below it, and root middleware runs for everything. `ctx.params` carries the matched API params, and `ctx.json`/`abortWithStatusJSON` produce API-shaped responses.",
      },
      {
        kind: "code",
        filename: "app/api/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  if (ctx.request.method === 'OPTIONS') {
    return ctx.status!(204);
  }

  const res = await next();

  if (res) {
    res.headers.set('x-api-version', '1');
  }

  return res;
}`,
      },
      {
        kind: "p",
        text:
          "**CORS:** set the standard headers on preflight and on the downstream response. `res.cors({...})` is the concise response helper. The standalone `cors()` helper from `@vesk/runtime/server` also exists, but `applyCors()` returns a plain `Response`; call `res.build()` first if you have queued cookies.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  if (ctx.request.method === 'OPTIONS') {
    ctx.header!('access-control-allow-origin', 'https://app.example.com');
    ctx.header!('access-control-allow-methods', 'GET, POST, OPTIONS');
    ctx.header!('access-control-allow-headers', 'Content-Type, Authorization');
    ctx.header!('access-control-allow-credentials', 'true');
    return ctx.status!(204);
  }

  const res = await next();

  if (res) {
    res.cors({
      origin: 'https://app.example.com',
      methods: 'GET, POST, OPTIONS',
      headers: 'Content-Type, Authorization',
      credentials: true,
    });
  }

  return res;
}`,
      },
      { kind: "h2", text: "Edge and serverless notes" },
      {
        kind: "p",
        text:
          "Middleware is inlined into the generated SSR/API functions for platform builds. Keep it portable: use the Web-standard `Request`, `Response`, `Headers`, `URL`, `crypto` and `AbortSignal` APIs. Avoid Node-only modules such as `fs`, `path` and `http` in middleware that runs on edge targets.",
      },
      {
        kind: "list",
        items: [
          "The same `ctx` helpers are installed by the inline executor on every target, so `ctx.json`, `ctx.abortWithStatusJSON`, `ctx.header` and `res.setCookie` do not depend on the dev server.",
          "The middleware executor catches `TypeError` and returns a `500` response, preventing an uncaught throw from surfacing as `FUNCTION_INVOCATION_FAILED` on serverless platforms.",
          "Read request-scoped values from `ctx.request`, `ctx.url`, `ctx.params`, `ctx.cookies` and `ctx.locals` — these are populated by the platform entry point.",
          "Response streams and large bodies should follow the normal platform body limits; the API wrapper enforces the configured body cap before the handler runs.",
        ],
      },
      { kind: "h2", text: "Related request helpers" },
      {
        kind: "p",
        text:
          "When a route or SSR pipeline exposes a `VeskRequest`, the same binding operations are also available as methods: `req.cookie(name)`, `req.shouldBindQuery(schema)`, `req.bindQuery(schema)`, `req.shouldBindJSON(schema)` and `req.bindJSON(schema)`. `VeskResponse` exposes `statusCode`, `getHeader(name)`, `setCookie`, `clearCookie` and `build` for response introspection and finalization.",
      },
    ],
  },
];
