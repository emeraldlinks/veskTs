import type { MiddlewareContext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
  ctx.set('blogMiddleware', 'active');
  ctx.set('blogViewCount', (Number(ctx.get('blogViewCount')) || 0) + 1);
  return next();
}
