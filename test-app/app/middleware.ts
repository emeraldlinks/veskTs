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
  const eventSession = ctx.get('eventSession');
  if (eventSession) ctx.header('x-event-session-seen', String(eventSession));
  const eventSessionDirect = ctx.get('eventSessionDirect');
  if (eventSessionDirect) ctx.header('x-event-session-direct', String(eventSessionDirect));
  ctx.header('x-header-map', ctx.headers instanceof Map ? '1' : '0');
  ctx.header('x-header-size', String(ctx.headers.size));
  const probeHeader = ctx.headers.get('x-probe');
  if (probeHeader) ctx.header('x-header-probe', probeHeader);
  const eventHeader = ctx.get('eventHeader');
  if (eventHeader) ctx.header('x-event-header-seen', String(eventHeader));
  ctx.header('x-event-header-map', ctx.get('eventHeaderIsMap') ? '1' : '0');

  if (ctx.url.pathname === '/api/previous-route' && ctx.url.searchParams.get('set') === '1') {
    ctx.previousRoute = '/set-by-middleware';
  }

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
