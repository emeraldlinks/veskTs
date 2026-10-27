import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { resolveComponentName, precompileFile } from '@vesk/compiler/src/server-codegen';
import { resolveCssUrls, hasBuiltGlobalCss } from '@vesk/adapter/src/css';
import { renderDefaultErrorFragment } from '@vesk/adapter/src/default-pages';
import type { RouteNode, AncestorLayout, SsrFunctionOptions } from '@vesk/adapter/src/types';

/**
 * The nearest `<file>` walking up from a route's own directory to the app root.
 *
 * This is the server-side twin of the client router's `findErrorComponent` /
 * `findNotFoundComponent`, which walk the matched chain deepest-first. Same rule,
 * same reason: an `error.vsk` (or `not-found.vsk`) inside `app/admin/` is the
 * boundary for `/admin/*` and nothing else — the root file is the fallback, not
 * the implementation.
 */
export function resolveBoundaryFile(sourceDir: string, appDir: string, file: string): string | null {
  const rel = relative(appDir, sourceDir).split('/').filter(Boolean);
  for (let depth = rel.length; depth >= 0; depth--) {
    const dir = depth === 0 ? appDir : join(appDir, ...rel.slice(0, depth));
    const p = join(dir, file);
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolveErrorFile(sourceDir: string, appDir: string): string | null {
  return resolveBoundaryFile(sourceDir, appDir, 'error.vsk');
}

export function resolveNotFoundFile(sourceDir: string, appDir: string): string | null {
  return resolveBoundaryFile(sourceDir, appDir, 'not-found.vsk');
}

/**
 * The nearest `<file>` for a REQUESTED URL, used by the server when no SSR
 * function ran (an unmatched path) or when one gave up.
 *
 * The walk is over URL segments, so a dynamic segment cannot be mapped back to a
 * directory — `/users/42/edit` stops at `/users`. Static paths, which is what a
 * `not-found.vsk` is written for, resolve exactly.
 */
export function resolveBoundaryFileForUrl(pathname: string, appDir: string, file: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  for (let depth = segments.length; depth >= 0; depth--) {
    const dir = join(appDir, ...segments.slice(0, depth));
    const p = join(dir, file);
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

/** Shared persisted-store SSR helper block emitted into every generated SSR
 *  function (prod via ssr-function.ts, dev via hmr.ts — keep the two callers
 *  in sync by calling this). Emit it AFTER the function declarations so the
 *  module-level `installPersistedStoreServerHooks` call runs on import. */
export function persistedStoreSsrCode(): string {
  return [
    '// ── Persisted-store SSR continuity (createStore / createPathStore persist) ──',
    '// Reads a persisted store\'s cookie value through the adapter request context.',
    '// Client writes mirror URL-encoded; decode on the way back (best effort).',
    'function __persistRead(key) {',
    '  const cookieName = persistedStoreCookieName(key);',
    '  const req = globalThis.__vesk_request;',
    '  if (!req) return null;',
    '  const c = req.cookies || {};',
    '  const v = typeof c.get === \'function\' ? c.get(cookieName) : c[cookieName];',
    '  if (v == null) return null;',
    '  try { return decodeURIComponent(String(v)); } catch { return String(v); }',
    '}',
    '',
    '// Drain this request\'s registered persisted keys into a served pre-paint',
    '// script (/store-init.js?t=...) then forget them. `token` selects the',
    '// render\'s bucket for callers outside the ALS scope (the no-layout stream',
    '// path captures its token at the renderPageStream call site); the layout',
    '// path runs this inside the scope and relies on the ambient token.',
    'function __storeInitTag(token) {',
    '  const keys = getPersistedStoreKeys(token);',
    '  if (keys.length === 0) { resetPersistedStoreKeys(token); return \'\'; }',
    '  const values = {};',
    '  for (let __i = 0; __i < keys.length; __i++) values[keys[__i]] = __persistRead(keys[__i]);',
    '  resetPersistedStoreKeys(token);',
    '  const payload = buildStorePrePaintPayload(values);',
    '  const url = storeInitScriptGlobal(payload);',
    '  return url ? storeInitScriptTag(url) : \'\';',
    '}',
    '',
    '// Inject the blocking store-init <script src> into a full HTML string',
    '// (before </head>; append if the document has no head).',
    'function __injectStoreInit(html) {',
    '  const tag = __storeInitTag();',
    '  if (tag === \'\') return html;',
    '  const idx = html.lastIndexOf(\'</head>\');',
    '  if (idx === -1) return html + tag;',
    '  return html.slice(0, idx) + tag + html.slice(idx);',
    '}',
    '',
    'installPersistedStoreServerHooks({ read: __persistRead });',
    '',
  ].join('\n');
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

  // Precompiled plans are written to static files and fetched at render time
  // instead of being embedded inline. Embedding every page/layout/error plan as
  // inline JSON makes each SSR function module large enough to OOM on memory-
  // constrained build containers (e.g. Vercel's 2048 MB serverless limit).
  const plansDir = resolve(outDir, 'static', 'ssr-plans');
  mkdirSync(plansDir, { recursive: true });

  function writePlan(planKey: string, planJSON: string): string {
    const fileName = `plan-${planKey}.mjs`;
    writeFileSync(resolve(plansDir, fileName), `export const plan = ${planJSON};\n`, 'utf-8');
    return `/_vesk/static/ssr-plans/${fileName}`;
  }

  /** Generates a lazy getter that imports a precompiled plan module and compiles
   *  it with hydratePrecompile on first use, caching the result. Import failures
   *  degrade to null (renderPage falls back to compiling from source).
   *  The IIFE form is a single expression so it can be placed anywhere — inside
   *  array literals, object literals, or at module scope — without syntax errors.
   */
  function planGetterCode(varName: string, planUrl: string): string {
    return `const ${varName} = (() => {
  let cache = null;
  return async () => {
    if (cache) return cache;
    try {
      const mod = await import(${JSON.stringify(planUrl)});
      cache = hydratePrecompile(mod.plan);
    } catch { cache = null; }
    return cache;
  };
})();`;
  }

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

  const layoutDecls: { comp: string; planUrl: string }[] = [];
  for (let li = 0; li < layoutStack.length; li++) {
    const entry = layoutStack[li];
    const entryPath = resolve(appDir, entry.sourceDir, 'layout.vsk');
    const entrySrc = readFileSync(entryPath, 'utf-8');
    const entryComp = extractCompName(entrySrc) || 'Layout';
    const plan = precompilePlan(entryPath);
    layoutDecls.push({
      comp: JSON.stringify(entryComp),
      planUrl: writePlan('layout-' + name + '-' + li, plan),
    });
  }

  const pagePlan = precompilePlan(pagePath);
  const pageComp = extractCompName(readFileSync(pagePath, 'utf-8')) || 'Page';

  const errorPath = resolveErrorFile(routeNode.sourceDir, appDir);
  const errorSrc = errorPath ? readFileSync(errorPath, 'utf-8') : null;
  const errorComp = errorPath ? (extractCompName(errorSrc as string) || 'Error') : null;
  const errorVars = errorPath
    ? `const _errorComp = ${JSON.stringify(errorComp)};\n${planGetterCode('_errorCompiled', writePlan('error-' + name, precompilePlan(errorPath)))}\n`
    : 'const _errorComp = null;\nasync function _errorCompiled() { return null; }\n';

  // Not-found used to have no server-side resolution at all: a NotFoundError was
  // re-thrown out of the function and the prod server answered with the ROOT
  // not-found.vsk. A nested `app/admin/not-found.vsk` therefore did nothing on a
  // hard load, while the client router — which walks the matched chain
  // deepest-first — honoured it on SPA navigation. Same URL, two different
  // pages depending on how you arrived.
  const notFoundPath = resolveNotFoundFile(routeNode.sourceDir, appDir);
  const notFoundSrc = notFoundPath ? readFileSync(notFoundPath, 'utf-8') : null;
  const notFoundComp = notFoundPath ? (extractCompName(notFoundSrc as string) || 'NotFound') : null;
  const notFoundVars = notFoundPath
    ? `const _notFoundComp = ${JSON.stringify(notFoundComp)};\n${planGetterCode('_notFoundCompiled', writePlan('notfound-' + name, precompilePlan(notFoundPath)))}\n`
    : 'const _notFoundComp = null;\nasync function _notFoundCompiled() { return null; }\n';

  const pagePlanUrl = writePlan('page-' + name, pagePlan);
  let src = '';
  if (layoutDecls.length > 0) {
    const pageGetter = planGetterCode('_pageCompiled', pagePlanUrl);
    const layoutGetters = layoutDecls.map((d, i) =>
      planGetterCode('_layoutCompiled_' + i, d.planUrl),
    );
    src = `const _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += pageGetter + '\n';
    src += layoutGetters.join('\n') + '\n';
    src += `const _layoutCompList = [${layoutDecls.map((d) => d.comp).join(', ')}];\n`;
    src += `const _layoutCompiledList = [${layoutDecls.map((_, i) => '_layoutCompiled_' + i).join(', ')}];\n`;
    src += errorVars + notFoundVars;
  } else {
    src = `const _comp = ${JSON.stringify(pageComp)};\n`;
    src += planGetterCode('_compiled', pagePlanUrl) + '\n';
    src += errorVars + notFoundVars;
  }

  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  const paramsCode = `function __paramsFor(pathname) {\n  const urlParts = pathname.split('/').filter(Boolean);\n  return { ${paramExprs.join(', ')} };\n}\n`;

  // Content-hashed in production (the build computes it before generating the
  // functions), the stable name in dev.
  const clientScriptOption =
    `, clientScriptUrl: ${JSON.stringify(options?.clientScriptUrl || '/_vesk/static/client.js')}` +
    (options?.clientScriptIntegrity ? `, clientScriptIntegrity: ${JSON.stringify(options.clientScriptIntegrity)}` : '');
  const dataScriptOption = ', externalDataScript: storeDataScriptGlobal';

  let registryCode = '';
  const compRegEntries: string[] = [];
  const compMap = componentMap || new Map();
  let compCounter = 0;
  for (const [compName, compPath] of compMap) {
    const plan = precompilePlan(compPath);
    const compPlanUrl = writePlan('comp-' + name + '-' + compCounter, plan);
    const compGetter = '_compiled_' + compCounter;
    compCounter++;
    compRegEntries.push(`  (() => {\n${planGetterCode(compGetter, compPlanUrl)}\n    __componentRegistry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n      const result = await renderPage('', ${JSON.stringify(compName)}, props, __registry, { hydrate: true, cached: await ${compGetter}() });\n      return result.body;\n    });\n  })();`);
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
      '    const result = await renderPage(\'\', _errorComp, props, __componentRegistry, { hydrate: true, cached: await _errorCompiled() });',
      '    return result.body;',
      '  } catch {',
      `    return ${JSON.stringify(renderDefaultErrorFragment())};`,
      '  }',
      '}',
      '',
      // Returns null rather than throwing when there is no boundary, so the
      // caller can re-throw the original NotFoundError and let the server answer
      // — a page with no not-found.vsk anywhere must still get a 404.
      'async function __renderNotFoundBody(props) {',
      '  if (!_notFoundComp) return null;',
      '  try {',
      '    const result = await renderPage(\'\', _notFoundComp, props, __componentRegistry, { hydrate: true, cached: await _notFoundCompiled() });',
      '    return result.body;',
      '  } catch {',
      '    return null;',
      '  }',
      '}',
      '',
      // The layout wrap, shared by the page / error / not-found paths. Extracted
      // because three call sites that each re-implemented it is three chances to
      // forget the head merge.
      'async function __wrapLayouts(params, body, head) {',
      '  let _b = body;',
      '  let _h = head || "";',
      '  for (let _i = _layoutCompList.length - 1; _i > 0; _i--) {',
      "    const _inner = await renderPage('', _layoutCompList[_i], { params, children: _b }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[_i]() });",
      '    _b = _inner.body;',
      '    if (_inner.head) _h = _inner.head + _h;',
      '  }',
      "  return renderFullPage('', _layoutCompList[0], { params, children: _b }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[0]()" + bakedOptions + clientScriptOption + dataScriptOption + ", pageHead: _h });",
      '}',
      '',
      'async function __renderHtml(params, requestUrl) {',
      '  return withSsrStore(async () => {',
      '  resetPersistedStoreKeys();',
      '  let page;',
      '  let caughtError = null;',
      '  let notFound = false;',
      "  const __expose = process.env.NODE_ENV !== 'production';",
      '  try {',
      '    page = await renderPage(\'\', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: await _pageCompiled() });',
      '  } catch (err) {',
      "    if (err && err.name === 'Redirect') throw err;",
      "    if (err && err.name === 'NotFoundError') {",
      // The boundary is chosen per-route at build time (resolveNotFoundFile walks
      // this route's own directory up to the app root), so a nested
      // app/admin/not-found.vsk answers /admin/* and the root one answers the
      // rest — matching the client router's deepest-first chain walk.
      '      const nfBody = await __renderNotFoundBody({ params, url: requestUrl || \'\' });',
      '      if (nfBody !== null) {',
      '        notFound = true;',
      '        page = { body: nfBody, head: \'\' };',
      '      } else {',
      '        throw err;',
      '      }',
      '    } else {',
      '      caughtError = err;',
      "      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "      const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "      page = { body: await __renderErrorBody({ params, statusCode: 500, error: __expose ? message : 'Internal Server Error', stack: __expose ? stack : '', url: requestUrl || '' }), head: '' };",
      '    }',
      '  }',
      "  let _body = (caughtError ? '<!--vesk-ssr-error:' + (caughtError && typeof caughtError === 'object' && 'message' in caughtError ? encodeURIComponent(__expose ? String(caughtError.message) : 'Internal Server Error') : '') + '-->' : '') + page.body;",
      '  const html = await __wrapLayouts(params, _body, page.head || \'\');',
      "  return new Response(__injectStoreInit(html), { headers: { 'Content-Type': 'text/html' }, status: notFound ? 404 : (caughtError ? 500 : 200) });",
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
      "  return renderFullPage('', _errorComp, props, __componentRegistry, { hydrate: true, cached: await _errorCompiled()" + bakedOptions + clientScriptOption + dataScriptOption + " });",
      '}',
      '',
      'async function __renderHtml(params, requestUrl) {',
      '  return withSsrStore(async () => {',
      '  let stream;',
      // The streamed no-layout page emits its <head> before the component body
      // renders, so its persisted stores don't exist yet when the head is
      // flushed — the pre-paint tag therefore goes into the final chunk, right
      // before </body> (still a blocking, pre-paint script). Capture the render
      // token now (renderPageStream adopts this exact ambient store) so the
      // registry drain in the consumer's start() can hit the right bucket even
      // though it runs outside the ALS scope.
      "  const __streamToken = globalThis.__vsk_ssr_token || '';",
      '  try {',
      "    stream = renderPageStream('', _comp, { params }, __componentRegistry, { hydrate: true, cached: await _compiled()" + bakedOptions + clientScriptOption + dataScriptOption + ' });',
      '  } catch (err) {',
      '    if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '    const html = await __renderErrorFullPage(params, requestUrl, err);',
      "    return new Response(__injectStoreInit(html), { headers: { 'Content-Type': 'text/html' }, status: 500 });",
      '  }',
      '  return new Response(new ReadableStream({',
      '    async start(controller) {',
      '      const enc = new TextEncoder();',
      "      let __tail = null;",
      '      resetPersistedStoreKeys(__streamToken);',
      '      try {',
      '        for await (const chunk of stream) {',
      '          if (__tail !== null) controller.enqueue(enc.encode(__tail));',
      '          __tail = chunk;',
      '        }',
      '        if (__tail !== null) {',
      '          const __tag = __storeInitTag(__streamToken);',
      '          if (__tag !== \'\') {',
      '            const __bi = __tail.lastIndexOf(\'</body>\');',
      '            __tail = __bi === -1 ? __tail + __tag : __tail.slice(0, __bi) + __tag + __tail.slice(__bi);',
      '          }',
      '          controller.enqueue(enc.encode(__tail));',
      '        } else {',
      '          // Empty stream (no chunks) — nothing to attach the tag to; just',
      '          // clear the registry so a later render can\'t inherit these keys.',
      '          resetPersistedStoreKeys(__streamToken);',
      '        }',
      '      } catch (err) {',
      '        if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '        try {',
      '          const html = await __renderErrorFullPage(params, requestUrl, err);',
      '          controller.enqueue(enc.encode(__injectStoreInit(html)));',
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

  // Persisted-store SSR continuity (createStore / createPathStore persist).
  // The adapter-installed read hook pulls each store's cookie value through the
  // request context; the tag the generated pages emit points at an origin-served
  // /store-init.js?t=<token> file (CSP-safe, never inlined — see
  // buildStorePrePaintPayload) so the client can pre-paint the user's value.
  const persistCode = persistedStoreSsrCode();

  let dataCode: string;
  const exposeErr = "process.env.NODE_ENV !== 'production'";
  // SPA data-nav renders page + layouts through renderPage and never runs
  // renderFullPage/renderPageStream, whose finally blocks own the per-request
  // token/slot cleanup in the full-page path. Clear the handoff globals here so
  // the next full-page render can't reuse the stale token and serialize the
  // previous nav's SSR data into its page (ssr-data leak).
  const dataNavCleanup = [
    '    } finally {',
    '      const __dnToken = globalThis.__vsk_ssr_token;',
    '      delete globalThis.__vsk_ssr;',
    '      if (__dnToken) delete globalThis[`__vsk_ssr_data_${__dnToken}`];',
    // NOT `delete globalThis.__vsk_ssr_token`: that global is a
    // configurable AsyncLocalStorage accessor (ssr-store.ts), so `delete`
    // removes the property definition and the process silently reverts to a
    // process-global token — the cross-request data-slot race, for good. The
    // token dies with the withSsrStore scope wrapped around this block instead.
'      delete globalThis.__vsk_ssr_data;',
      // SPA data-nav only runs renderPage, so the persisted-store registration
      // bucket would otherwise keep this request's keys forever.
      '      resetPersistedStoreKeys();',
      '    }',
  ];
  // The data-nav branch never runs renderFullPage/renderPageStream, so it needs
  // its own request scope — otherwise its renderPage mints a token that is
  // still live when the full-page render starts and the two share a data slot.
  const dataNavWrap = (body: string[]) => [
    '  return withSsrStore(async () => {',
    ...body.map((l) => (l ? '  ' + l : l)),
    '  });',
  ];
  if (layoutDecls.length > 0) {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      ...dataNavWrap([
      '    try {',
      '      let dataPage;',
      '      try {',
      "        dataPage = await renderPage('', _pageComp, { params }, __componentRegistry, { hydrate: true, cached: await _pageCompiled() });",
      '      } catch (err) {',
      "        if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;",
      '        const message = err && typeof err === \'object\' && \'message\' in err ? String(err.message) : String(err);',
      `        return new Response(JSON.stringify({ error: ${exposeErr} ? message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });`,
      '      }',
      '      let _dataHead = dataPage.head || \'\';',
      '      for (let _i = _layoutCompList.length - 1; _i >= 0; _i--) {',
      "        const _dl = await renderPage('', _layoutCompList[_i], { params, children: '' }, __componentRegistry, { hydrate: true, cached: await _layoutCompiledList[_i]() });",
      '        _dataHead = (_dl.head || \'\') + _dataHead;',
      '      }',
      "      return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: _dataHead }), {",
      "        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },",
      '      });',
      ...dataNavCleanup,
      ]),
      '  }',
      '  return __renderHtml(params, url.href);',
    ].join('\n');
  } else {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      ...dataNavWrap([
      '    try {',
      '      let dataPage;',
      '      try {',
      "        dataPage = await renderPage('', _comp, { params }, __componentRegistry, { hydrate: true, cached: await _compiled() });",
      '      } catch (err) {',
      "        if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;",
      '        const message = err && typeof err === \'object\' && \'message\' in err ? String(err.message) : String(err);',
      `        return new Response(JSON.stringify({ error: ${exposeErr} ? message : 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });`,
      '      }',
      "      return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: dataPage.head || '' }), {",
      "        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },",
      '      });',
      ...dataNavCleanup,
      ]),
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
    // Underscored internal name (see api-function.ts): page source is inlined
    // into this module and may declare/import `handleAction` itself.
    'async function __vesk_handleAction(request, id) {',
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
    'export { __vesk_handleAction as handleAction };',
    '',
  ].join('\n');

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage, hydratePrecompile, parseCookies, getAction, validateActionInput, issuesToFieldMap, storeDataScriptGlobal, withSsrStore, assertSameOrigin, VeskRequest, installPersistedStoreServerHooks, persistedStoreCookieName, getPersistedStoreKeys, resetPersistedStoreKeys, buildStorePrePaintPayload, storeInitScriptGlobal, storeInitScriptTag } from '../runtime.js';",
    '',
    middlewareCode || '',
    registryCode,
    src,
    '',
    paramsCode,
    htmlFnCode,
    '',
    persistCode,
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