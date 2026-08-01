import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
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
  let routeSrc = readFileSync(routeFilePath, 'utf-8');

  routeSrc = routeSrc
    .replace(/from\s+['"]@vesk\/runtime['"]\s*;?/g, "from '../runtime.js';")
    .replace(/from\s+['"]@vesk\/runtime\/(\w+)['"]\s*;?/g, () => {
      return "from '../runtime.js';";
    });

  if (routeFilePath.endsWith('.ts')) {
    try {
      const result = transformSync(routeSrc, { loader: 'ts' });
      routeSrc = result.code;
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

  const handlerMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    .filter(m => routeSrc.includes(`async function ${m}(`) || routeSrc.includes(`async function ${m} (`) || routeSrc.includes(`export async function ${m}`))
    .map(m => `${m}`).join(', ');

  let handleBody: string;
  if (middlewareCode) {
    handleBody = [
      "  const url = new URL(request.url);",
      "  const urlParts = url.pathname.replace(/^\\/api\\/?/, '/').split('/').filter(Boolean);",
      "  const method = request.method || 'GET';",
      `${paramsCode}`,
      '  // ── Middleware context ──',
      '  const __ctx = {',
      '    request,',
      '    params,',
      '    url,',
      '    locals: {},',
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
      '  try {',
      `    const handler = { ${handlerMethods} }[method];`,
      '    if (!handler) {',
      "      return new Response(JSON.stringify({ error: 'Method not allowed' }), {",
      '        status: 405,',
      "        headers: { 'Content-Type': 'application/json' },",
      '      });',
      '    }',
      '    const response = await handler(request, { params: Promise.resolve(params) });',
      '    if (response instanceof Response) {',
      "      if (typeof response.build === 'function') response.build();",
      '      return response;',
      '    }',
      '    return new Response(JSON.stringify(response), {',
      '      status: 200,',
      "      headers: { 'Content-Type': 'application/json' },",
      '    });',
      '  } catch (e) {',
      '    const err = /** @type {Error & Record<string, unknown>} */(e);',
      "    if (err.name === 'Redirect') {",
      '      return new Response(null, { status: Number(err.status) || 302, headers: { Location: String(err.url || "") } });',
      '    }',
      "    if (err.name === 'NotFoundError') {",
      "      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
      '    }',
      '    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { \'Content-Type\': \'application/json\' } });',
      '  } finally {',
      '    globalThis.__vesk_request = prev;',
      '  }',
    ].join('\n');
  } else {
    handleBody = [
      "  const url = new URL(request.url);",
      "  const urlParts = url.pathname.replace(/^\\/api\\/?/, '/').split('/').filter(Boolean);",
      "  const method = request.method || 'GET';",
      `${paramsCode}`,
      '  const ctx = {',
      "    headers: Object.fromEntries(request.headers.entries()),",
      '    url: request.url,',
      '    method,',
      "    cookies: parseCookies(request.headers.get('cookie') || ''),",
      '    locals: {},',
      '  };',
      "  Object.defineProperty(request, 'locals', {",
      '    get: () => ctx.locals,',
      '    enumerable: true,',
      '  });',
      '  const prev = globalThis.__vesk_request;',
      '  globalThis.__vesk_request = ctx;',
      '  try {',
      `    const handler = { ${handlerMethods} }[method];`,
      '    if (!handler) {',
      "      return new Response(JSON.stringify({ error: 'Method not allowed' }), {",
      '        status: 405,',
      "        headers: { 'Content-Type': 'application/json' },",
      '      });',
      '    }',
      '    const response = await handler(request, { params: Promise.resolve(params) });',
      '    if (response instanceof Response) {',
      "      if (typeof response.build === 'function') response.build();",
      '      return response;',
      '    }',
      '    return new Response(JSON.stringify(response), {',
      '      status: 200,',
      "      headers: { 'Content-Type': 'application/json' },",
      '    });',
      '  } catch (e) {',
      '    const err = /** @type {Error & Record<string, unknown>} */(e);',
      "    if (err.name === 'Redirect') {",
      '      return new Response(null, { status: Number(err.status) || 302, headers: { Location: String(err.url || "") } });',
      '    }',
      "    if (err.name === 'NotFoundError') {",
      "      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
      '    }',
      '    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { \'Content-Type\': \'application/json\' } });',
      '  } finally {',
      '    globalThis.__vesk_request = prev;',
      '  }',
    ].join('\n');
  }

  const funcCode = [
    '// Auto-generated by @vesk/adapter',
    '',
    routeSrc.trim(),
    '',
    '// ── Request handler wrapper ──',
    "import { parseCookies } from '../runtime.js';",
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
