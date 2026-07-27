export async function middleware(ctx, next) {
  ctx.set('blogMiddleware', 'active');
  ctx.set('blogViewCount', (ctx.get('blogViewCount') || 0) + 1);
  return next();
}
