import { renderFullPage, renderPageStream, renderPage, compileFile, parseCookies, getAction, validateActionInput, issuesToFieldMap } from '../runtime.js';
// ── Middleware chain (inline) ──

async function mw_0(ctx, next) {
ctx.set('user', { id: 1, name: 'Alice' });
  ctx.set('db', { query: () => 'db-result' });
  ctx.set('startTime', Date.now());
  return next();
}

async function mw_1(ctx, next) {
ctx.set('blogMiddleware', 'active');
  ctx.set('blogViewCount', (ctx.get('blogViewCount') || 0) + 1);
  return next();
}

const __mwChain = [mw_0, mw_1];

async function __executeMw(ctx) {
  let rewriteUrl = null;
  async function run(index) {
    if (index >= __mwChain.length) return null;
    const fn = __mwChain[index];
    let nc = false;
    async function next(rewrite) {
      if (nc) return null;
      nc = true;
      if (rewrite) rewriteUrl = rewrite;
      return run(index + 1);
    }
    const result = await fn(ctx, next);
    if (result instanceof Response) return result;
    if (!nc) return run(index + 1);
    return null;
  }
  const response = await run(0);
  return { response, rewriteUrl };
}

const __componentRegistry = new Map();

const _pageSrc = `import { Link } from '@vesk/runtime';

component Blog {
	<h1 class="text-3xl font-bold mb-4">Blog</h1>
	<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">
		<h2 class="text-lg font-semibold mb-1">
			<Link href="/blog/hello-world" class="text-gray-900 no-underline hover:text-blue-600">Hello World</Link>
		</h2>
		<p class="text-gray-400 text-sm">First post powered by Vesk</p>
	</div>
	<div class="bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100">
		<h2 class="text-lg font-semibold mb-1">
			<Link href="/blog/ssr-in-vesk" class="text-gray-900 no-underline hover:text-blue-600">SSR in Vesk</Link>
		</h2>
		<p class="text-gray-400 text-sm">How server-side rendering works</p>
	</div>
}
`;
const _pageComp = "Blog";
const _layoutSrc = `import { NavLink } from '@vesk/runtime';

component Layout(props) {
	<nav class="flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white">
		<NavLink href="/" class="text-gray-500 hover:text-black font-medium no-underline">Home</NavLink>
		<NavLink href="/about" class="text-gray-500 hover:text-black font-medium no-underline">About</NavLink>
		<NavLink href="/blog" class="text-gray-500 hover:text-black font-medium no-underline">Blog</NavLink>
		<NavLink href="/posts" class="text-gray-500 hover:text-black font-medium no-underline">Posts</NavLink>
		<NavLink href="/statements" class="text-gray-500 hover:text-black font-medium no-underline">Statements</NavLink>
		<NavLink href="/async" class="text-gray-500 hover:text-black font-medium no-underline">Async</NavLink>
		<NavLink href="/map" class="text-gray-500 hover:text-black font-medium no-underline">Map</NavLink>
		<NavLink href="/empty" class="text-gray-500 hover:text-black font-medium no-underline">Empty</NavLink>
	</nav>
	<style> 
	.nav {
		margin-left: 20px;
		display: flex;
		gap: 10px;
	}
	</style>
	<main class="max-w-3xl mx-auto my-8 px-4">{props.children}</main>
	<footer class="text-center py-8 text-gray-400 text-sm">
		<p>Powered by Vesk</p>
	</footer>
}
`;
const _layoutComp = "Layout";

function __paramsFor(pathname) {
  const urlParts = pathname.split('/').filter(Boolean);
  return {  };
}

async function __renderHtml(params) {
  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });
  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true, clientScriptUrl: "/_vesk/static/client.js", pageHead: page.head });
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export async function handle(request) {
  const url = new URL(request.url);
  const params = __paramsFor(url.pathname);
  // ── Middleware context ──
  const __ctx = {
    request,
    params,
    url,
    locals: {},
    cookies: parseCookies(request.headers.get('cookie') || ''),
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
      const dataPage = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });
      const dataLayout = await renderPage(_layoutSrc, _layoutComp, { params, children: '' }, __componentRegistry, { hydrate: true });
      return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: (dataLayout.head || '') + (dataPage.head || '') }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return __renderHtml(params);
  } finally {
    globalThis.__vesk_request = prev;
  }
}
let __actionsRegistered = false;
async function __registerActions() {
  if (__actionsRegistered) return;
  __actionsRegistered = true;
  compileFile(_layoutSrc);
  compileFile(_pageSrc);
}

export async function handleAction(request, id) {
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
      return await __renderHtml(params);
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
    if (isFetch) {
      return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(message, { status: 500, headers: { 'Content-Type': 'text/plain' } });
  } finally {
    globalThis.__vesk_request = prevReq;
  }
}
