import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { resolveComponentName, precompileFile } from '@vesk/compiler/src/server-codegen';
import { resolveCssUrls, hasBuiltGlobalCss } from '@vesk/adapter/src/css';
import type { RouteNode, AncestorLayout, SsrFunctionOptions } from '@vesk/adapter/src/types';

// Finds the nearest error.vsk walking up from the route's own directory to the
// app root, mirroring the router's findErrorComponent chain semantics.
export function resolveErrorFile(sourceDir: string, appDir: string): string | null {
  const rel = relative(appDir, sourceDir).split('/').filter(Boolean);
  for (let depth = rel.length; depth >= 0; depth--) {
    const dir = depth === 0 ? appDir : join(appDir, ...rel.slice(0, depth));
    const p = join(dir, 'error.vsk');
    if (existsSync(p)) return p;
  }
  return null;
}

function routeName(segments: string[]): string {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

function extractCompName(src: string): string | null {
  return resolveComponentName(src);
}

/**
 * Precompiles a `.vsk` file at BUILD time into a `PrecompileFilePlan` and
 * returns it as a JSON object literal. True AOT: no source is embedded, no
 * compile happens in the deployed function — `hydratePrecompile` rebuilds the
 * render result at module load from this JSON alone.
 */
function precompilePlan(entryPath: string): string {
  const src = readFileSync(entryPath, 'utf-8');
  return JSON.stringify(precompileFile(src, entryPath));
}

function hydrateInvoke(planExpr: string): string {
  return `(() => { try { return hydratePrecompile(${planExpr}); } catch { return null; } })()`;
}

function buildParamExtraction(node: RouteNode, urlParts: string[]): string[] {
  const parts: string[] = [];
  let partIdx = Math.max(0, urlParts.length - 1);
  function walk(n: RouteNode): void {
    if (n.fullPath === '/') {
      for (const child of (n.children || [])) walk(child);
      return;
    }
    if (n.isGroup) {
      for (const child of (n.children || [])) walk(child);
      return;
    }
    if (partIdx >= urlParts.length) return;
    if (n.isCatchAll) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'slug';
      parts.push(`${JSON.stringify(paramName)}: urlParts.slice(${partIdx}).join('/')`);
      partIdx = urlParts.length;
      return;
    }
    if (n.isDynamic) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'param';
      parts.push(`${JSON.stringify(paramName)}: urlParts[${partIdx}]`);
      partIdx++;
      for (const child of (n.children || [])) walk(child);
      return;
    }
    if (n.path === urlParts[partIdx]) {
      partIdx++;
      for (const child of (n.children || [])) walk(child);
    }
  }
  walk(node);
  return parts;
}

export function generateSsrFunction(
  routeNode: RouteNode,
  appDir: string,
  outDir: string,
  componentMap?: Map<string, string>,
  options?: SsrFunctionOptions,
): { funcPath: string; funcCode: string; name: string } {
  const ancestorLayouts = options?.ancestorLayouts || [];
  const middlewareCode = options?.middlewareCode || null;
  const headExtra = options?.headExtra || null;
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');

  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);

  const cssUrls = resolveCssUrls({
    enabled: hasBuiltGlobalCss(outDir),
  });
  const cssOption = cssUrls.length > 0 ? `, cssUrls: ${JSON.stringify(cssUrls)}` : '';
  // Static head snippet baked from the active onHead plugins — merged into
  // every rendered head at request time (page tags win via mergeHeadHtml).
  const headExtraOption = headExtra ? `, headExtra: ${JSON.stringify(headExtra)}` : '';
  const bakedOptions = cssOption + headExtraOption;

  const layoutStack = [
    ...ancestorLayouts.map((a) => ({ sourceDir: a.sourceDir, layoutCompName: a.layoutCompName })),
    ...(routeNode.layout ? [{ sourceDir: routeNode.sourceDir, layoutCompName: routeNode.layout }] : []),
  ];

  const layoutDecls: { comp: string; plan: string; compiled: string }[] = [];
  for (const entry of layoutStack) {
    const entryPath = resolve(appDir, entry.sourceDir, 'layout.vsk');
    const entrySrc = readFileSync(entryPath, 'utf-8');
    const entryComp = extractCompName(entrySrc) || 'Layout';
    const plan = precompilePlan(entryPath);
    layoutDecls.push({
      comp: JSON.stringify(entryComp),
      plan,
      compiled: hydrateInvoke(plan),
    });
  }

  const pagePlan = precompilePlan(pagePath);
  const pageComp = extractCompName(readFileSync(pagePath, 'utf-8')) || 'Page';

  const errorPath = resolveErrorFile(routeNode.sourceDir, appDir);
  const errorSrc = errorPath ? readFileSync(errorPath, 'utf-8') : null;
  const errorComp = errorPath ? (extractCompName(errorSrc as string) || 'Error') : null;
  const errorVars = errorPath
    ? `const _errorComp = ${JSON.stringify(errorComp)};\nconst _errorCompiled = ${hydrateInvoke(precompilePlan(errorPath))};\n`
    : 'const _errorComp = null;\nconst _errorCompiled = null;\n';

  let src = '';
  if (layoutDecls.length > 0) {
    src = `const _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += `const _pageCompiled = (() => { try { return hydratePrecompile(${pagePlan}); } catch { return null; } })();\n`;
    src += `const _layoutCompList = [${layoutDecls.map((d) => d.comp).join(', ')}];\n`;
    src += `const _layoutCompiledList = [\n${layoutDecls.map((d) => '  ' + d.compiled + ',').join('\n')}\n];\n`;
    src += errorVars;
  } else {
    src = `const _comp = ${JSON.stringify(pageComp)};\n`;
    src += `const _compiled = (() => { try { return hydratePrecompile(${pagePlan}); } catch { return null; } })();\n`;
    src += errorVars;
  }

  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  const paramsCode = `function __paramsFor(pathname) {\n  const urlParts = pathname.split('/').filter(Boolean);\n  return { ${paramExprs.join(', ')} };\n}\n`;

  const clientScriptOption = ', clientScriptUrl: "/_vesk/static/client.js"';
  const dataScriptOption = ', externalDataScript: storeDataScriptGlobal';

  let registryCode = '';
  const compRegEntries: string[] = [];
  const compMap = componentMap || new Map();
  for (const [compName, compPath] of compMap) {
    const plan = precompilePlan(compPath);
    compRegEntries.push(`  (() => {\n    const _compiled = (() => { try { return hydratePrecompile(${plan}); } catch { return null; } })();\n    registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n      const result = await renderPage('', ${JSON.stringify(compName)}, props, __registry, { hydrate: true, cached: _compiled });\n      return result.body;\n    });\n  })();`);
  }
  if (compRegEntries.length > 0) {
    registryCode = 'const __componentRegistry = new Map();\n{\n' + compRegEntries.join('\n') + '\n}\n';
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  let htmlFnCode: string;
  if (layoutDecls.length > 0) {
    htmlFnCode = [
      'async function __renderErrorBody(props) {',
      '  if (!_errorComp) throw props.error || new Error("Internal Server Error");',
      '  try {',
      '    const result = await renderPage(\'\', _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled });',
      '    return result.body;',
      '  } catch {',
      '    return \'<h1>500 \\u2014 Internal Server Error</h1>\';',
      '  }',
      '}',
      '',
      'async function __renderHtml(params, requestUrl) {',
      '  return withSsrStore(async () => {',
      '  let page;',
      '  let caughtError = null;',
      "  const __expose = process.env.NODE_ENV !== 'production';",
      '  try {',
      '    page = await renderPage(\'\', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled });',
      '  } catch (err) {',
      '    if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '    caughtError = err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    page = { body: await __renderErrorBody({ params, statusCode: 500, error: __expose ? message : 'Internal Server Error', stack: __expose ? stack : '', url: requestUrl || '' }), head: '' };",
      '  }',
      '  let _body = (caughtError ? \'<!--vesk-ssr-error:\' + (caughtError && typeof caughtError === \'object\' && \'message\' in caughtError ? encodeURIComponent(__expose ? String(caughtError.message) : \'Internal Server Error\') : \'\') + \'-->\' : \'\') + page.body;',
      '  let _head = page.head || \'\';',
      '  for (let _i = _layoutCompList.length - 1; _i > 0; _i--) {',
      "    const _inner = await renderPage('', _layoutCompList[_i], { params, children: _body }, __componentRegistry, { hydrate: true, cached: _layoutCompiledList[_i] });",
      '    _body = _inner.body;',
      '    if (_inner.head) _head = _inner.head + _head;',
      '  }',
      "  const html = await renderFullPage('', _layoutCompList[0], { params, children: _body }, __componentRegistry, { hydrate: true, cached: _layoutCompiledList[0]" + bakedOptions + clientScriptOption + dataScriptOption + ", pageHead: _head });",
      "  return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: caughtError ? 500 : 200 });",
      '  });',
      '}',
      '',
    ].join('\n');
  } else {
    htmlFnCode = [
      'async function __renderErrorFullPage(params, requestUrl, err) {',
      '  if (!_errorComp) throw err;',
      "  const __expose = process.env.NODE_ENV !== 'production';",
      "  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "  const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "  const props = { params, statusCode: 500, error: __expose ? message : 'Internal Server Error', stack: __expose ? stack : '', url: requestUrl || '' };",
      "  return renderFullPage('', _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled" + bakedOptions + clientScriptOption + dataScriptOption + " });",
      '}',
      '',
      'async function __renderHtml(params, requestUrl) {',
      '  return withSsrStore(async () => {',
      '  let stream;',
      '  try {',
      "    stream = renderPageStream('', _comp, { params }, __componentRegistry, { hydrate: true, cached: _compiled" + bakedOptions + clientScriptOption + dataScriptOption + ' });',
      '  } catch (err) {',
      '    if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '    const html = await __renderErrorFullPage(params, requestUrl, err);',
      "    return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 500 });",
      '  }',
      '  return new Response(new ReadableStream({',
      '    async start(controller) {',
      '      const enc = new TextEncoder();',
      '      try {',
      '        for await (const chunk of stream) {',
      '          controller.enqueue(enc.encode(chunk));',
      '        }',
      '      } catch (err) {',
      '        if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '        try {',
      '          const html = await __renderErrorFullPage(params, requestUrl, err);',
      '          controller.enqueue(enc.encode(html));',
      '        } catch {}',
      '      }',
      '      controller.close();',
      '    },',
      "  }), { headers: { 'Content-Type': 'text/html' }, status: 200 });",
      '  });',
      '}',
      '',
    ].join('\n');
  }

  let dataCode: string;
  const exposeErr = "process.env.NODE_ENV !== 'production'";
  if (layoutDecls.length > 0) {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      '    let dataPage;',
      '    try {',
      "      dataPage = await renderPage('', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled });",
      '    } catch (err) {',
      '      if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '      const message = err && typeof err === \'object\' && \'message\' in err ? String(err.message) : String(err);',
      `      return new Response(JSON.stringify({ error: ${exposeErr} ? message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });`,
      '    }',
      '    let _dataHead = dataPage.head || \'\';',
      '    for (let _i = _layoutCompList.length - 1; _i >= 0; _i--) {',
      "      const _dl = await renderPage('', _layoutCompList[_i], { params, children: '' }, __componentRegistry, { hydrate: true, cached: _layoutCompiledList[_i] });",
      '      _dataHead = (_dl.head || \'\') + _dataHead;',
      '    }',
      "    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: _dataHead }), {",
      "      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },",
      '    });',
      '  }',
      '  return __renderHtml(params, url.href);',
    ].join('\n');
  } else {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      '    let dataPage;',
      '    try {',
      "      dataPage = await renderPage('', _comp, { params }, __componentRegistry, { hydrate: true, cached: _compiled });",
      '    } catch (err) {',
      '      if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '      const message = err && typeof err === \'object\' && \'message\' in err ? String(err.message) : String(err);',
      `      return new Response(JSON.stringify({ error: ${exposeErr} ? message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });`,
      '    }',
      "    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: dataPage.head || '' }), {",
      "      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },",
      '    });',
      '  }',
      '  return __renderHtml(params, url.href);',
    ].join('\n');
  }

  const hasMiddleware = !!middlewareCode;

  let bodyCode: string;
  if (hasMiddleware) {
    const indentedRender = dataCode.split('\n').map(l => l ? `  ${l}` : '').join('\n');
    bodyCode = [
      '  // ── Middleware context ──',
      "  const __rootLocals = (globalThis.__vesk_request && globalThis.__vesk_request.locals) || {};",
      '  const __ctx = {',
      '    request,',
      '    params,',
      '    url,',
      "    locals: Object.assign({}, __rootLocals),",
      "    cookies: parseCookies(request.headers.get('cookie') || ''),",
      '    resolveUrl(u) { return new URL(u, request.url).href; },',
      '    set(key, value) { this.locals[key] = value; },',
      '    get(key) { return this.locals[key]; },',
      '  };',
      '  const __mwResult = await __executeMw(__ctx);',
      '  if (__mwResult.response) return __mwResult.response;',
      "  if (__mwResult.rewriteUrl) url.pathname = __mwResult.rewriteUrl;",
      '  const prev = globalThis.__vesk_request;',
      '  globalThis.__vesk_request = __ctx;',
      '  try {',
      indentedRender,
      '  } finally {',
      '    globalThis.__vesk_request = prev;',
      '  }',
    ].join('\n');
  } else {
    const indentedRender = dataCode.split('\n').map(l => l ? `  ${l}` : '').join('\n');
    bodyCode = [
      '  // Request context for SSR helpers (useParams/useRequest, relative useFetch resolution).',
      '  const prevReq = globalThis.__vesk_request;',
      '  globalThis.__vesk_request = VeskRequest.from(request, { params });',
      '  try {',
      indentedRender,
      '  } finally {',
      '    globalThis.__vesk_request = prevReq;',
      '  }',
    ].join('\n');
  }

  // Actions are registered while each plan hydrates (its actions-transformed
  // top-level code runs `defineAction` during `hydratePrecompile`), so the
  // request-time registration pass is a no-op.
  const registerActionsCode = [
    'async function __registerActions() {',
    '  if (__actionsRegistered) return;',
    '  __actionsRegistered = true;',
    '}',
    '',
  ].join('\n');

  const actionCode = [
    'export async function handleAction(request, id) {',
    '  // CSRF defense: cross-site browser POSTs always carry an Origin header.',
    '  try {',
    '    assertSameOrigin(request);',
    '  } catch (e) {',
    "    return new Response(JSON.stringify({ ok: false, error: 'Cross-origin request blocked' }), { status: (e && e.status) || 403, headers: { 'Content-Type': 'application/json' } });",
    '  }',
    '  await __registerActions();',
    '  const action = getAction(id);',
    '  if (!action) {',
    "    return new Response(JSON.stringify({ ok: false, error: 'Action not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
    '  }',
    '  let input = {};',
    "  const ct = request.headers.get('content-type') || '';",
    "  if (ct.includes('json')) {",
    '    input = await request.json().catch(() => ({}));',
    "  } else if (ct.includes('multipart/form-data') || ct.includes('x-www-form-urlencoded')) {",
    '    const fd = await request.formData().catch(() => null);',
    '    if (fd) input = Object.fromEntries(fd.entries());',
    '  } else {',
    "    const text = await request.text().catch(() => '');",
    '    if (text) { try { input = JSON.parse(text); } catch {} }',
    '  }',
    '  const issues = validateActionInput(action, input);',
    "  const referer = request.headers.get('referer') || '';",
    "  const isFetch = !(request.headers.get('accept') || '').includes('text/html');",
    '  const base = referer || request.url;',
    '  const pageUrl = new URL(base);',
    '  const params = __paramsFor(pageUrl.pathname);',
    '  if (issues.length > 0) {',
    '    if (isFetch) {',
    "      return new Response(JSON.stringify({ ok: false, issues }), { status: 200, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    '    const prevReq = globalThis.__vesk_request;',
    '    globalThis.__vesk_action_errors = issuesToFieldMap(issues);',
    '    try {',
    '      return await __renderHtml(params, pageUrl.href);',
    '    } finally {',
    '      globalThis.__vesk_action_errors = undefined;',
    '      globalThis.__vesk_request = prevReq;',
    '    }',
    '  }',
    '  const prevReq = globalThis.__vesk_request;',
    '  globalThis.__vesk_request = {',
    '    request,',
    '    params,',
    '    url: pageUrl,',
    '    locals: {},',
    "    cookies: parseCookies(request.headers.get('cookie') || ''),",
    '    resolveUrl(u) { return new URL(u, pageUrl.href).href; },',
    '  };',
    '  try {',
    '    const result = await action.execute(input, {',
    '      request,',
    '      params,',
    '      url: pageUrl.href,',
    '      headers: () => { const m = new Map(); for (const [k, v] of request.headers.entries()) m.set(k.toLowerCase(), String(v)); return m; },',
    "      cookies: () => parseCookies(request.headers.get('cookie') || ''),",
    "      locals: () => (globalThis.__vesk_request ? globalThis.__vesk_request.locals : {}),",
    "      redirect: (u, status) => new Response(null, { status: status || 303, headers: { Location: u } }),",
    '    });',
    '    if (isFetch) {',
    "      return new Response(JSON.stringify({ ok: true, data: result ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    "    const location = referer ? new URL(referer).pathname + new URL(referer).search : '/';",
    "    return new Response(null, { status: 303, headers: { Location: location } });",
    '  } catch (err) {',
    "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Action failed';",
    `    const safeMessage = ${exposeErr} ? message : 'Action failed';`,
    '    if (isFetch) {',
    "      return new Response(JSON.stringify({ ok: false, error: safeMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    "    return new Response(safeMessage, { status: 500, headers: { 'Content-Type': 'text/plain' } });",
    '  } finally {',
    '    globalThis.__vesk_request = prevReq;',
    '  }',
    '}',
    '',
  ].join('\n');

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage, hydratePrecompile, parseCookies, getAction, validateActionInput, issuesToFieldMap, storeDataScriptGlobal, withSsrStore, assertSameOrigin, VeskRequest } from '../runtime.js';",
    '',
    middlewareCode || '',
    registryCode,
    src,
    '',
    paramsCode,
    htmlFnCode,
    '',
    'export async function handle(request) {',
    '  const url = new URL(request.url);',
    '  const params = __paramsFor(url.pathname);',
    "  Object.defineProperty(request, 'query', {",
    '    get: () => Object.fromEntries(url.searchParams.entries()),',
    '    enumerable: true,',
    '  });',
    bodyCode,
    '}',
    '',
    'let __actionsRegistered = false;',
    '',
    registerActionsCode,
    actionCode,
  ].filter(Boolean).join('\n');

  return { funcPath, funcCode, name };
}