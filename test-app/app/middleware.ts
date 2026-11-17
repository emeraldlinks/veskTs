import type { MiddlewareContext, MiddlewareNext } from '@vesk/types';

export async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  ctx.set('user', { id: 1, name: 'Alice' });
  ctx.set('db', { query: () => 'db-result' });
  ctx.set('startTime', Date.now());
  console.log("user: ", ctx.get("user"));

  const session = ctx.cookies?.get
    ? ctx.cookies.get('session')
    : ctx.cookie?.('session');
  if (session) ctx.header('x-session-seen', session);

  // rewrite fixtures: API -> API, API -> page, page -> page
  if (ctx.url.pathname === '/api/mw-rewrite') {
    return next(ctx.url.searchParams.get('to') || '/api/mw-rewrite-target');
  }
  if (ctx.url.pathname === '/mw-rewrite') {
    return next('/mw-rewrite-target');
  }
  if (ctx.url.pathname === '/mw-page-to-api') {
    return next('/api/mw-rewrite-target');
  }

  // typed pass-through cookie manipulation on downstream VeskResponse
  if (ctx.url.pathname === '/mw-cookie' || ctx.url.pathname === '/api/mw-cookie') {
    const res = await next();
    if (res) {
      res.setCookie('mw_seen', '1', { path: '/', httpOnly: false, secure: false });
      res.setCookie('mw_clear', 'x', { path: '/' });
      res.clearCookie('mw_clear', { path: '/' });
      res.headers.set('x-mw', 'ok');
    }
    return res;
  }

  return next();
}
