import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  if (ctx.url.pathname === '/api/mw-scope/source') {
    return next('/api/mw-scope/target');
  }
  return next();
}
