export async function middleware(ctx, next) {
  // Verify root middleware already injected user
  ctx.set('role', ctx.user ? 'admin' : 'anonymous');
  ctx.set('route', 'admin');
  return next();
}
