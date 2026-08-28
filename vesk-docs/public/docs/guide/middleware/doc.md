# Middleware

Some code should run before — or around — every request in a part of your
app: authentication checks, logging, adding timing headers, injecting the
current user. Middleware is that layer. Each middleware wraps the next
like an onion: your code runs, calls `next()` to let the rest of the app
proceed, then gets a chance to inspect or modify the result.

Place a `middleware.ts` in any route directory and it applies to that
subtree; files chain root → leaf. `app/middleware.ts` applies globally.

## Basic middleware

```ts
// app/middleware.ts
import type { MiddlewareContext } from '@vesk/compiler';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
	ctx.set('startTime', Date.now());
	const res = await next();          // run inner chain + render
	console.log('took', Date.now() - ctx.get('startTime'), 'ms');
	return res;                        // propagate the rendered response
}
```

Rules:

- **Always `return await next()`** (or its response) — dropping the return
  discards the rendered response.
- Return a `Response` to short-circuit: `return new Response('nope', { status: 401 })`
  never reaches the page.
- `next('/new-path')` rewrites the URL for the rest of the chain.
- Locals set via `ctx.set()` are visible during SSR (pages calling
  `locals()`) and inside API routes.

```ts
interface MiddlewareContext {
	request: Request;
	params: Record<string, string>;
	url: URL;
	locals: Record<string, unknown>;
	cookies: Record<string, string>;
	set(key: string, value: unknown): void;   // writes ctx.locals
	get(key: string): unknown;
	[key: string]: unknown;                   // ctx.user === ctx.locals.user
}
```

## Reading locals in pages/APIs

```ts
// app/api/me/route.ts
import { locals } from '@vesk/runtime/server';

export async function GET() {
	const user = locals().user;   // set by middleware
	return Response.json({ user });
}
```

## Redirects & rewrites

```ts
export async function middleware(ctx, next) {
	if (!ctx.cookies.get('session')) {
		return Response.redirect(new URL('/login', ctx.url), 302);
	}
	if (ctx.url.pathname.startsWith('/old')) {
		const res = await next('/new');   // internal rewrite
		res.headers.set('x-rewritten', '1');
		return res;
	}
	return next();
}
```

## Client-router middleware

`createFileRouter` accepts middleware functions running on SPA
navigations:

```ts
createFileRouter(tree, {
	middleware: [
		async (ctx, next) => {
			if (ctx.url.startsWith('/admin') && !authed()) {
				return router.navigate('/login', { replace: true });
			}
			await next();
		},
	],
});
```

Client ctx: `{ url, params, router, locals }`. Throwing
`redirect(url)`/`notFound()` works here too — they become replace-
navigation / not-found UI.

## Dev parity

Middleware edits hot-reload — every load cache-busts the module so changes
take effect without restarting. Middleware responses are honored on API
routes in dev exactly as in production (a 401 from middleware really stops
the handler).
