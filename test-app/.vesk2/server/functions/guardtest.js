import { renderFullPage, renderPageStream, renderPage, hydratePrecompile, parseCookies, getAction, validateActionInput, issuesToFieldMap, storeDataScriptGlobal, withSsrStore, assertSameOrigin, VeskRequest, installPersistedStoreServerHooks, persistedStoreCookieName, getPersistedStoreKeys, resetPersistedStoreKeys, buildStorePrePaintPayload, storeInitScriptGlobal, storeInitScriptTag } from '../runtime.js';
// ── Middleware chain (inline) ──

async function mw_0(ctx, next) {
ctx.set('user', { id: 1, name: 'Alice' });
	ctx.set('db', { query: () => 'db-result' });
	ctx.set('startTime', Date.now());
	console.log("user: ", ctx.get("user"));

	return next();
}

const __mwChain = [mw_0];

async function __executeMw(ctx) {
  let rewriteUrl = null;
  async function run(index) {
    if (index >= __mwChain.length) return null;
    const fn = __mwChain[index];
    let nc = false;
    let ncResult = null;
    async function next(rewrite) {
      if (nc) return null;
      nc = true;
      if (rewrite) rewriteUrl = rewrite;
      ncResult = await run(index + 1);
      return ncResult;
    }
    const result = await fn(ctx, next);
    if (result instanceof Response) return result;
    if (ncResult instanceof Response) return ncResult;
    if (!nc) return run(index + 1);
    return null;
  }
  const response = await run(0);
  return { response, rewriteUrl };
}

const __componentRegistry = new Map();
{
  (() => {
let _compiled_0Cache = null;
async function _compiled_0() {
  if (_compiled_0Cache) return _compiled_0Cache;
  try {
    const res = await fetch("/_vesk/ssr-plans/plan-comp-0.json");
    const plan = await res.json();
    _compiled_0Cache = hydratePrecompile(plan);
  } catch { _compiled_0Cache = null; }
  return _compiled_0Cache;
}
    __componentRegistry.set("SharedCounter", async (props, __registry, __vesk) => {
      const result = await renderPage('', "SharedCounter", props, __registry, { hydrate: true, cached: await _compiled_0() });
      return result.body;
    });
  })();
}

const _pageComp = "GuardTest";
let _pageCompiledCache = null;
async function _pageCompiled() {
  if (_pageCompiledCache) return _pageCompiledCache;
  try {
    const res = await fetch("/_vesk/ssr-plans/plan-page-guardtest.json");
    const plan = await res.json();
    _pageCompiledCache = hydratePrecompile(plan);
  } catch { _pageCompiledCache = null; }
  return _pageCompiledCache;
}
const _layoutCompList = ["Layout"];
const _layoutCompiledList = [
  let _layoutCompiled_0Cache = null;
async function _layoutCompiled_0() {
  if (_layoutCompiled_0Cache) return _layoutCompiled_0Cache;
  try {
    const res = await fetch("/_vesk/ssr-plans/plan-layout-0.json");
    const plan = await res.json();
    _layoutCompiled_0Cache = hydratePrecompile(plan);
  } catch { _layoutCompiled_0Cache = null; }
  return _layoutCompiled_0Cache;
},
];
const _errorComp = "ErrorPage";
let _errorCompiledCache = null;
async function _errorCompiled() {
  if (_errorCompiledCache) return _errorCompiledCache;
  try {
    const res = await fetch("/_vesk/ssr-plans/plan-error-guardtest.json");
    const plan = await res.json();
    _errorCompiledCache = hydratePrecompile(plan);
  } catch { _errorCompiledCache = null; }
  return _errorCompiledCache;
}
const _notFoundComp = "NotFound404";
let _notFoundCompiledCache = null;
async function _notFoundCompiled() {
  if (_notFoundCompiledCache) return _notFoundCompiledCache;
  try {
    const res = await fetch("/_vesk/ssr-plans/plan-notfound-guardtest.json");
    const plan = await res.json();
    _notFoundCompiledCache = hydratePrecompile(plan);
  } catch { _notFoundCompiledCache = null; }
  return _notFoundCompiledCache;
}

function __paramsFor(pathname) {
  const urlParts = pathname.split('/').filter(Boolean);
  return {  };
}

async function __renderErrorBody(props) {
  if (!_errorComp) throw props.error || new Error("Internal Server Error");
  try {
    const result = await renderPage('', _errorComp, props, __componentRegistry, { hydrate: true, cached: await _errorCompiled() });
    return result.body;
  } catch {
    return "<div data-vesk-default-error-fragment=\"500\" style=\"display:flex;align-items:center;justify-content:center;min-height:60vh;padding:32px\"><div style=\"display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace\"><div style=\"display:flex;align-items:center\"><span style=\"font-size:24px;font-weight:500;line-height:49px;padding-right:23px;margin-right:20px;border-right:1px solid currentColor;opacity:.85\">500</span><span style=\"font-size:14px;line-height:49px;opacity:.7\">Internal Server Error</span></div></div></div>";
  }
}

async function __renderNotFoundBody(props) {
  if (!_notFoundComp) return null;
  try {
    const result = await renderPage('', _notFoundComp, props, __componentRegistry, { hydrate: true, cached: await _notFoundCompiled() });
    return result.body;
  } catch {
    return null;
  }
}

async function __wrapLayouts(params, body, head) {
  let _b = body;
  let _h = head || "";
  for (let _i = _layoutCompList.length - 1; _i > 0; _i--) {
    const _inner = await renderPage('', _layoutCompList[_i], { params, children: _b }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[_i]() });
    _b = _inner.body;
    if (_inner.head) _h = _inner.head + _h;
  }
  return renderFullPage('', _layoutCompList[0], { params, children: _b }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[0](), cssUrls: ["/_vesk/static/global.css"], clientScriptUrl: "/_vesk/static/client.bd41d5876b.js", clientScriptIntegrity: "sha384-rihD07Z83jiULPceJk5xd3dVBnYq65Fip5Cp9Tnw9hnremZoe3mxiMcKiuEyKnSv", externalDataScript: storeDataScriptGlobal, pageHead: _h });
}

async function __renderHtml(params, requestUrl) {
  return withSsrStore(async () => {
  resetPersistedStoreKeys();
  let page;
  let caughtError = null;
  let notFound = false;
  const __expose = process.env.NODE_ENV !== 'production';
  try {
    page = await renderPage('', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: await _pageCompiled() });
  } catch (err) {
    if (err && err.name === 'Redirect') throw err;
    if (err && err.name === 'NotFoundError') {
      const nfBody = await __renderNotFoundBody({ params, url: requestUrl || '' });
      if (nfBody !== null) {
        notFound = true;
        page = { body: nfBody, head: '' };
      } else {
        throw err;
      }
    } else {
      caughtError = err;
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
      const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';
      page = { body: await __renderErrorBody({ params, statusCode: 500, error: __expose ? message : 'Internal Server Error', stack: __expose ? stack : '', url: requestUrl || '' }), head: '' };
    }
  }
  let _body = (caughtError ? '<!--vesk-ssr-error:' + (caughtError && typeof caughtError === 'object' && 'message' in caughtError ? encodeURIComponent(__expose ? String(caughtError.message) : 'Internal Server Error') : '') + '-->' : '') + page.body;
  const html = await __wrapLayouts(params, _body, page.head || '');
  return new Response(__injectStoreInit(html), { headers: { 'Content-Type': 'text/html' }, status: notFound ? 404 : (caughtError ? 500 : 200) });
  });
}

// ── Persisted-store SSR continuity (createStore / createPathStore persist) ──
// Reads a persisted store's cookie value through the adapter request context.
// Client writes mirror URL-encoded; decode on the way back (best effort).
function __persistRead(key) {
  const cookieName = persistedStoreCookieName(key);
  const req = globalThis.__vesk_request;
  if (!req) return null;
  const c = req.cookies || {};
  const v = typeof c.get === 'function' ? c.get(cookieName) : c[cookieName];
  if (v == null) return null;
  try { return decodeURIComponent(String(v)); } catch { return String(v); }
}

// Drain this request's registered persisted keys into a served pre-paint
// script (/store-init.js?t=...) then forget them. `token` selects the
// render's bucket for callers outside the ALS scope (the no-layout stream
// path captures its token at the renderPageStream call site); the layout
// path runs this inside the scope and relies on the ambient token.
function __storeInitTag(token) {
  const keys = getPersistedStoreKeys(token);
  if (keys.length === 0) { resetPersistedStoreKeys(token); return ''; }
  const values = {};
  for (let __i = 0; __i < keys.length; __i++) values[keys[__i]] = __persistRead(keys[__i]);
  resetPersistedStoreKeys(token);
  const payload = buildStorePrePaintPayload(values);
  const url = storeInitScriptGlobal(payload);
  return url ? storeInitScriptTag(url) : '';
}

// Inject the blocking store-init <script src> into a full HTML string
// (before </head>; append if the document has no head).
function __injectStoreInit(html) {
  const tag = __storeInitTag();
  if (tag === '') return html;
  const idx = html.lastIndexOf('</head>');
  if (idx === -1) return html + tag;
  return html.slice(0, idx) + tag + html.slice(idx);
}

installPersistedStoreServerHooks({ read: __persistRead });

export async function handle(request) {
  const url = new URL(request.url);
  const params = __paramsFor(url.pathname);
  Object.defineProperty(request, 'query', {
    get: () => Object.fromEntries(url.searchParams.entries()),
    enumerable: true,
  });
  // ── Middleware context ──
  const __rootLocals = (globalThis.__vesk_request && globalThis.__vesk_request.locals) || {};
  const __ctx = {
    request,
    params,
    url,
    locals: Object.assign({}, __rootLocals),
    cookies: parseCookies(request.headers.get('cookie') || ''),
    resolveUrl(u) { return new URL(u, request.url).href; },
    set(key, value) { this.locals[key] = value; },
    get(key) { return this.locals[key]; },
  };
  const __mwResult = await __executeMw(__ctx);
  if (__mwResult.response) return __mwResult.response;
  if (__mwResult.rewriteUrl) url.pathname = __mwResult.rewriteUrl;
  const prev = globalThis.__vesk_request;
  globalThis.__vesk_request = __ctx;
  try {
    if (request.headers.get('x-vesk-data') === '1') {
    return withSsrStore(async () => {
        try {
          let dataPage;
          try {
            dataPage = await renderPage('', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: await _pageCompiled() });
          } catch (err) {
            if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;
            const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
            return new Response(JSON.stringify({ error: process.env.NODE_ENV !== 'production' ? message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });
          }
          let _dataHead = dataPage.head || '';
          for (let _i = _layoutCompList.length - 1; _i >= 0; _i--) {
            const _dl = await renderPage('', _layoutCompList[_i], { params, children: '' }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[_i]() });
            _dataHead = (_dl.head || '') + _dataHead;
          }
          return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: _dataHead }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },
          });
        } finally {
          const __dnToken = globalThis.__vsk_ssr_token;
          delete globalThis.__vsk_ssr;
          if (__dnToken) delete globalThis[`__vsk_ssr_data_${__dnToken}`];
          delete globalThis.__vsk_ssr_data;
          resetPersistedStoreKeys();
        }
    });
    }
    return __renderHtml(params, url.href);
  } finally {
    globalThis.__vesk_request = prev;
  }
}
let __actionsRegistered = false;
async function __registerActions() {
  if (__actionsRegistered) return;
  __actionsRegistered = true;
}

async function __vesk_handleAction(request, id) {
  // CSRF defense: cross-site browser POSTs always carry an Origin header.
  try {
    assertSameOrigin(request);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Cross-origin request blocked' }), { status: (e && e.status) || 403, headers: { 'Content-Type': 'application/json' } });
  }
  await __registerActions();
  const action = getAction(id);
  if (!action) {
    return new Response(JSON.stringify({ ok: false, error: 'Action not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  let input = {};
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('json')) {
    input = await request.json().catch(() => ({}));
  } else if (ct.includes('multipart/form-data') || ct.includes('x-www-form-urlencoded')) {
    const fd = await request.formData().catch(() => null);
    if (fd) input = Object.fromEntries(fd.entries());
  } else {
    const text = await request.text().catch(() => '');
    if (text) { try { input = JSON.parse(text); } catch {} }
  }
  const issues = validateActionInput(action, input);
  const referer = request.headers.get('referer') || '';
  const isFetch = !(request.headers.get('accept') || '').includes('text/html');
  const base = referer || request.url;
  const pageUrl = new URL(base);
  const params = __paramsFor(pageUrl.pathname);
  if (issues.length > 0) {
    if (isFetch) {
      return new Response(JSON.stringify({ ok: false, issues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const prevReq = globalThis.__vesk_request;
    globalThis.__vesk_action_errors = issuesToFieldMap(issues);
    try {
      return await __renderHtml(params, pageUrl.href);
    } finally {
      globalThis.__vesk_action_errors = undefined;
      globalThis.__vesk_request = prevReq;
    }
  }
  const prevReq = globalThis.__vesk_request;
  globalThis.__vesk_request = {
    request,
    params,
    url: pageUrl,
    locals: {},
    cookies: parseCookies(request.headers.get('cookie') || ''),
    resolveUrl(u) { return new URL(u, pageUrl.href).href; },
  };
  try {
    const result = await action.execute(input, {
      request,
      params,
      url: pageUrl.href,
      headers: () => { const m = new Map(); for (const [k, v] of request.headers.entries()) m.set(k.toLowerCase(), String(v)); return m; },
      cookies: () => parseCookies(request.headers.get('cookie') || ''),
      locals: () => (globalThis.__vesk_request ? globalThis.__vesk_request.locals : {}),
      redirect: (u, status) => new Response(null, { status: status || 303, headers: { Location: u } }),
    });
    if (isFetch) {
      return new Response(JSON.stringify({ ok: true, data: result ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const location = referer ? new URL(referer).pathname + new URL(referer).search : '/';
    return new Response(null, { status: 303, headers: { Location: location } });
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Action failed';
    const safeMessage = process.env.NODE_ENV !== 'production' ? message : 'Action failed';
    if (isFetch) {
      return new Response(JSON.stringify({ ok: false, error: safeMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(safeMessage, { status: 500, headers: { 'Content-Type': 'text/plain' } });
  } finally {
    globalThis.__vesk_request = prevReq;
  }
}

export { __vesk_handleAction as handleAction };
