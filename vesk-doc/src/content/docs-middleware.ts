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
      "fn(ctx, next) middleware, the MiddlewareContext, next(rewrite), building responses, and examples for logging, auth, CORS and rewriting.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "Middleware runs before a page renders and is shared by every request that maps to the directory it lives in. Drop a `middleware.ts` file into any route directory: `app/middleware.ts` runs for the whole app, `app/blog/middleware.ts` additionally runs for `/blog` paths and anything under them. Directories are executed parent-first in an onion/chain model.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext } from '@vesk/types';

export async function middleware(
  ctx: MiddlewareContext,
  next: (rewrite?: string) => Promise<Response>,
) {
  const start = Date.now();

  const response = await next();

  console.log(
    \`\${ctx.request.method} \${ctx.url.pathname} -> \${response.status} (\${Date.now() - start}ms)\`,
  );

  return response;
}`,
      },
      {
        kind: "p",
        text:
          "The file is plain TypeScript and is loaded as a module, so imports work normally. The loader accepts the middleware as the named export `middleware` or as a `default` export. Middleware must live in a TypeScript file — a `middleware.vsk` is skipped with a structure warning.",
      },
      { kind: "h2", text: "MiddlewareContext" },
      {
        kind: "p",
        text: "The middleware signature is `fn(ctx, next)` — a single context object plus the chain continuation. There is no response object on the context; short-circuiting and headers are done by returning a `Response` (see below).",
      },
      {
        kind: "table",
        head: ["Member", "Description"],
        rows: [
          ["`request`", "The incoming `Request` (a `VeskRequest` in the dev/prod pipeline) — method, headers, URL, body."],
          ["`params`", "Route parameters for the matched path, as `Record<string, string>`."],
          ["`url`", "The parsed `URL` of the request. Updated to the rewrite target when `next(rewrite)` is called."],
          ["`locals`", "The shared per-request store — seeded from server events and visible to later middleware and the page."],
          ["`cookies`", "Request cookies parsed as `Record<string, string>`."],
          ["`set(key, value)`", "Writes a value into `locals`."],
          ["`get(key)`", "Reads a value from `locals`."],
          ["`[key: string]`", "Any other property access proxies straight to `locals`, so `ctx.user = ...` and `ctx.user` work directly."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "The context has no `next()`, `setHeader()`, `redirect()` or `rewrite()` methods. `next` is the second parameter of the middleware function; headers, redirects and rewrites are expressed through returned `Response` objects (see next section).",
      },
      { kind: "h2", text: "next(), responses and rewriting" },
      {
        kind: "p",
        text:
          "`next()` continues the chain into the following middleware (and finally the page render). It returns a `Promise<Response>`, so you can `await next()` and post-process the rendered response, or `const response = await next()` and return it yourself. HTTP headers are plain `Headers` on that response; to add to them you construct a new `Response` from it or use the fluent `VeskResponse` builders from `@vesk/runtime`.",
      },
      {
        kind: "p",
        text:
          "`next(rewrite)` continues the chain but rewrites the request URL internally: the recorded `rewriteUrl` is passed to the renderer and `ctx.url` becomes the rewrite target — the client keeps the original URL while the page for the rewrite renders. This is useful for canonical hosts, locale prefixes or fallbacks.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext } from '@vesk/types';

export default async function middleware(
  ctx: MiddlewareContext,
  next: (rewrite?: string) => Promise<Response>,
) {
  if (ctx.url.hostname === 'www.example.com') {
    const canonical = 'https://example.com' + ctx.url.pathname + ctx.url.search;
    return next(canonical);
  }

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "Returning a `Response` — instead of calling `next()` — short-circuits the chain: whatever you return is the final response. Returning `next()` (or `await next()`) passes the rest of the chain through. Creating a response is done with the standard `Response` API or the `VeskResponse` helpers from `@vesk/runtime`.",
      },
      { kind: "h2", text: "Response headers, cookies and redirects" },
      {
        kind: "p",
        text:
          "There is no `ctx.setHeader()`. To set headers or cookies on the final page response, wrap the response you get from `await next()` into a new `Response`, or build answers with `VeskResponse.json().setSecurityHeader(...).setCookie(...)` and return them.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<Response>) {
  const response = await next();

  const headers = new Headers(response.headers);
  headers.set(
    'X-Request-Id',
    ctx.request.headers.get('x-request-id') || Math.random().toString(36).slice(2),
  );
  headers.append('Set-Cookie', 'visited=1; Path=/; HttpOnly');

  return new Response(response.body, { status: response.status, headers });
}`,
      },
      {
        kind: "p",
        text:
          "To redirect, throw `redirect(url, status)` — still from `@vesk/runtime` — which raises a `Redirect` error the runner turns into a `Location` response. `Response.redirect(url, status)` and `VeskResponse.redirect(url)` are drop-in alternatives.",
      },
      { kind: "h2", text: "Examples" },
      {
        kind: "p",
        text: "Auth: read the session from `ctx.cookies`, store the user in `ctx.locals`, and `redirect()` guests to the login page (this throws, so nothing below it runs).",
      },
      {
        kind: "code",
        filename: "app/dashboard/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext } from '@vesk/types';
import { redirect } from '@vesk/runtime';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<Response>) {
  const token = ctx.cookies.session;

  if (!token) {
    redirect('/login'); // throws -> 302 Location: /login
  }

  ctx.set('user', { name: 'Ada', role: 'admin' });

  return next();
}`,
      },
      {
        kind: "p",
        text:
          "The page reads that user back through `locals()` from `@vesk/runtime`, keeping the pipeline server-side only — it renders once during SSR and never runs on the client, so the account data never crosses the wire.",
      },
      {
        kind: "tabs",
        tabs: [
          {
            label: "statement mode",
            filename: "app/dashboard/page.vsk",
            code: `import { locals } from '@vesk/runtime';

component UserBanner() {
  const user = locals().user;

  <p>Signed in as {user.name}</p>
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
            code: `import { locals } from '@vesk/runtime';

component UserBanner() {
  const user = locals().user;

  return <p>Signed in as {user.name}</p>;
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
          "CORS: the `cors()` helper from `@vesk/runtime` returns a small middleware that answers `OPTIONS` preflights with a 204 and exposes `applyCors(response)` to stamp the CORS headers onto the rendered response.",
      },
      {
        kind: "code",
        filename: "app/middleware.ts",
        language: "ts",
        code: `import type { MiddlewareContext } from '@vesk/types';
import { cors } from '@vesk/runtime';

const handle = cors({
  origin: 'https://app.example.com',
  methods: 'GET, POST, OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
  credentials: true,
});

export async function middleware(ctx: MiddlewareContext, next: () => Promise<Response>) {
  const preflight = handle(ctx.request);
  if (preflight instanceof Response) {
    return preflight;
  }

  const response = await next();
  return handle.applyCors(response);
}`,
      },
    ],
  },
];