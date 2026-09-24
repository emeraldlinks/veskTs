import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import type { ApiRouteNode, ApiFunctionOptions } from '@vesk/adapter/src/types';

function apiRouteName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.map(s => s.startsWith(':') ? s.slice(1) || 'param' : s).join('_') || 'index';
}

export function generateApiFunction(
  apiNode: ApiRouteNode,
  _apiDir: string,
  outDir: string,
  options?: ApiFunctionOptions,
): { funcPath: string; funcCode: string; name: string } {
  const middlewareCode = options?.middlewareCode || null;
  const name = apiRouteName(apiNode.fullPath);
  const funcPath = resolve(outDir, 'server', 'api', `${name}.js`);

  const routeFilePath = apiNode.filePath;
  if (!routeFilePath) throw new Error(`api route ${apiNode.fullPath} has no filePath`);
  let routeSrc = readFileSync(routeFilePath, 'utf-8');

  routeSrc = routeSrc
    .replace(/from\s+['"]@vesk\/runtime['"]\s*;?/g, "from '../runtime.js';")
    .replace(/from\s+['"]@vesk\/runtime\/(\w+)['"]\s*;?/g, () => {
      return "from '../runtime.js';";
    });

  if (routeFilePath.endsWith('.ts')) {
    try {
      routeSrc = stripCodeTypes(routeSrc);
    } catch {
      // fall back to original source if stripping fails
    }
  }

  const urlParts = apiNode.fullPath.split('/').filter(Boolean);
  const extracts: string[] = [];
  let partIdx = 0;
  for (const p of urlParts) {
    if (p.startsWith(':') && p.includes('...')) {
      extracts.push(`${JSON.stringify(p.slice(1))}: urlParts.slice(${partIdx}).join('/')`);
    } else if (p.startsWith(':')) {
      extracts.push(`${JSON.stringify(p.slice(1))}: urlParts[${partIdx}]`);
      partIdx++;
    } else {
      partIdx++;
    }
  }
  const paramsCode = extracts.length > 0
    ? `  const params = { ${extracts.join(', ')} };\n`
    : '  const params = {};\n';

  // Shared wrapper body. The route source is inlined into this module, so the
  // handlers are ordinary bindings here and `typeof` resolves them at call
  // time (function declarations hoist; const arrow handlers are initialized by
  // the time a request arrives). This replaces a textual pre-scan, which used
  // to miss `export const GET = …` / non-async functions and made the `Allow`
  // header wrong.
  const sharedBody: string[] = [
    "  const url = new URL(request.url);",
    "  const urlParts = url.pathname.replace(/^\\/api\\/?/, '/').split('/').filter(Boolean);",
    "  const method = request.method || 'GET';",
    `${paramsCode}`,
    "  Object.defineProperty(request, 'query', {",
    '    get: () => Object.fromEntries(url.searchParams.entries()),',
    '    enumerable: true,',
    '  });',
    "  const __rootLocals = (globalThis.__vesk_request && globalThis.__vesk_request.locals) || {};",
  ];

  const dispatchBody: string[] = [
    '  try {',
    "    const __mod = {",
    ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(
      (m) => `      ${m}: typeof ${m} === 'function' ? ${m} : undefined,`,
    ),
    '    };',
    "    const __allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter((m) => __mod[m]);",
    '    const handler = __mod[method];',
    '    if (!handler) {',
    "      if (method === 'OPTIONS') {",
    '        return new Response(null, { status: 204, headers: { Allow: __allowed.join(\', \') } });',
    '      }',
    "      return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), {",
    "        status: 405,",
    "        headers: { 'Content-Type': 'application/json', Allow: __allowed.join(', ') },",
    '      });',
    '    }',
    '    const __routeConfig = (typeof config !== \'undefined\' && config) || {};',
    '    // Default CSRF defense for mutating API calls: same-origin check unless',
    '    // the route opts out via `config.csrf = false`.',
    "    if (__routeConfig.csrf !== false && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {",
    '      try {',
    '        assertSameOrigin({',
    '          method,',
    '          headers: Object.fromEntries([...request.headers.entries()].map(([k, v]) => [k, Array.isArray(v) ? v.join(\', \') : v])),',
    '        });',
    '      } catch {',
    "        return new Response(JSON.stringify({ error: 'Cross-origin request blocked' }), {",
    "          status: 403, headers: { 'Content-Type': 'application/json' },",
    '        });',
    '      }',
    '    }',
    '    // Body cap. The handler receives the raw platform Request, so a route that',
    '    // calls `req.json()` directly would bypass a VeskRequest-level guard —',
    '    // enforce it here, before any handler runs, on every target (dev, node,',
    '    // serverless, edge).',
    "    const __declared = Number(request.headers.get('content-length') || '0');",
    '    if (Number.isFinite(__declared) && __declared > DEFAULT_MAX_BODY_BYTES) {',
    "      return new Response(JSON.stringify({ error: `Request body exceeds limit (${DEFAULT_MAX_BODY_BYTES} bytes)` }), {",
    "        status: 413, headers: { 'Content-Type': 'application/json' },",
    '      });',
    '    }',
    '    let __signal = request.signal;',
    '    let __timeout;',
    '    if (__routeConfig.maxDuration) {',
    '      const __controller = new AbortController();',
    '      __timeout = setTimeout(',
    '        () => __controller.abort(new Error(`Request timed out after ${__routeConfig.maxDuration}s`)),',
    '        Number(__routeConfig.maxDuration) * 1000',
    '      );',
    '      __signal = __controller.signal;',
    "      Object.defineProperty(request, 'signal', { value: __signal, writable: false });",
    '    }',
    '    // Route hooks may be a single function or an array of them.',
    '    const __before = typeof beforeRequest === \'undefined\' ? [] : (Array.isArray(beforeRequest) ? beforeRequest : [beforeRequest]);',
    '    for (const __hook of __before) {',
    '      const __hookResult = await __hook(request, { params: Promise.resolve(params), locals: ctx.locals });',
    '      if (__hookResult instanceof Response) return __hookResult;',
    '    }',
    "    let __global = await runHooks('beforeRequest', request, { params, locals: ctx.locals });",
    '    if (__global instanceof Response) return __global;',
    '    let __response;',
    '    try {',
    '      __response = await handler(request, { params: Promise.resolve(params) });',
    '    } catch (__e) {',
    "      const __handled = await runHooks('onError', __e, request);",
    '      if (__handled instanceof Response) return __handled;',
    '      throw __e;',
    '    } finally {',
    '      if (__timeout) clearTimeout(__timeout);',
    '    }',
    '    const __after = typeof afterRequest === \'undefined\' ? [] : (Array.isArray(afterRequest) ? afterRequest : [afterRequest]);',
    '    for (const __hook of __after) {',
    '      const __hookResult = await __hook(request, __response);',
    '      if (__hookResult instanceof Response) __response = __hookResult;',
    '    }',
    "    __global = await runHooks('afterRequest', request, __response);",
    '    if (__global instanceof Response) __response = __global;',
    '    if (__response && typeof __response.build === \'function\') __response.build();',
    '    if (__response instanceof Response) return __response;',
    '    return new Response(JSON.stringify(__response), {',
    '      status: 200,',
    "      headers: { 'Content-Type': 'application/json' },",
    '    });',
    '  } catch (e) {',
    '    const err = /** @type {Error & Record<string, unknown>} */(e);',
    "    if (err.name === 'Redirect') {",
    "      return new Response(null, { status: Number(err.status) || 302, headers: { Location: String(err.url || '/') } });",
    '    }',
    "    if (err.name === 'NotFoundError') {",
    "      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    '    if (err.name === \'PayloadTooLargeError\') {',
    "      return new Response(JSON.stringify({ error: 'Request body too large' }), { status: 413, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    "    return new Response(JSON.stringify({ error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });",
    '  } finally {',
    '    globalThis.__vesk_request = prev;',
    '  }',
  ];

  let handleBody: string;
  if (middlewareCode) {
    handleBody = [
      ...sharedBody,
      '  // ── Middleware context ──',
      '  const __ctx = {',
      '    request,',
      '    params,',
      '    url,',
      '    locals: Object.assign({}, __rootLocals),',
      "    cookies: parseCookies(request.headers.get('cookie') || ''),",
      '    set(key, value) { this.locals[key] = value; },',
      '    get(key) { return this.locals[key]; },',
      '  };',
      '  const __mwResult = await __executeMw(__ctx);',
      '  if (__mwResult.response) return __mwResult.response;',
      "  if (__mwResult.rewriteUrl) url.pathname = __mwResult.rewriteUrl;",
      '  const ctx = {',
      "    headers: Object.fromEntries(request.headers.entries()),",
      '    url: request.url,',
      '    method,',
      '    cookies: __ctx.cookies,',
      '    locals: __ctx.locals,',
      '  };',
      "  Object.defineProperty(request, 'locals', {",
      '    get: () => ctx.locals,',
      '    enumerable: true,',
      '  });',
      '  const prev = globalThis.__vesk_request;',
      '  globalThis.__vesk_request = ctx;',
      ...dispatchBody,
    ].join('\n');
  } else {
    handleBody = [
      ...sharedBody,
      '  const ctx = {',
      "    headers: Object.fromEntries(request.headers.entries()),",
      '    url: request.url,',
      '    method,',
      "    cookies: parseCookies(request.headers.get('cookie') || ''),",
      '    locals: Object.assign({}, __rootLocals),',
      '  };',
      "  Object.defineProperty(request, 'locals', {",
      '    get: () => ctx.locals,',
      '    enumerable: true,',
      '  });',
      '  const prev = globalThis.__vesk_request;',
      '  globalThis.__vesk_request = ctx;',
      ...dispatchBody,
    ].join('\n');
  }

  const funcCode = [
    '// Auto-generated by @vesk/adapter',
    '',
    routeSrc.trim(),
    '',
    '// ── Request handler wrapper ──',
    "import { parseCookies, assertSameOrigin, runHooks, DEFAULT_MAX_BODY_BYTES } from '../runtime.js';",
    middlewareCode ? "import { parseCookies as __parseCookies } from '../runtime.js';" : '',
    '',
    middlewareCode || '',
    'export async function handle(request) {',
    handleBody,
    '}',
    '',
  ].filter(Boolean).join('\n');

  return { funcPath, funcCode, name };
}
