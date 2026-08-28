// Vesk Middleware — onion model (ctx, next)
// ctx = { request, params, url, locals, cookies, set, get }
//   ctx.set('user', val) → ctx.locals.user
//   ctx.user             → ctx.locals.user
// next() — passes to next middleware or page render
// next('/rewrite') — rewrites URL in place
// Short-circuit: return Response without calling next()
// Types come from @vesk/types (import type { MiddlewareContext }).

export async function middleware(ctx, next) {
	ctx.set('startTime', Date.now());
	return next();
}
