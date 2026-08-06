import type { MiddlewareContext } from '@vesk/compiler';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
  // Verify root middleware already injected user
  ctx.set('role', ctx.user ? 'admin' : 'anonymous');
  ctx.set('route', 'admin');
  return next();
}
