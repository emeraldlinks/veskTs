import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveComponentName } from '@vesk/compiler/src/server-codegen';
import type { RouteNode, AncestorLayout, SsrFunctionOptions } from '@vesk/adapter/src/types';

function escapeSource(src: string): string {
  return src
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
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
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');
  const layoutPath = resolve(appDir, routeNode.sourceDir, 'layout.vsk');

  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);

  const tailwindPath = resolve(outDir, 'static', '_tailwind.css');
  const globalCssPath = resolve(appDir, '..', 'src', 'global.css');
  const altCssPath = resolve(appDir, '..', 'src', 'app.css');
  const hasGlobalCss = existsSync(globalCssPath) || existsSync(altCssPath);
  const hasTailwind = existsSync(tailwindPath) && readFileSync(tailwindPath, 'utf-8').trim().length > 0;
  const cssUrls: string[] = [];
  if (hasTailwind) cssUrls.push('/_vesk/static/_tailwind.css');
  if (hasGlobalCss) cssUrls.push('/_vesk/static/global.css');
  const cssOption = cssUrls.length > 0 ? `, cssUrls: ${JSON.stringify(cssUrls)}` : '';

  const hasLayout = !!routeNode.layout;
  const hasAncestorLayout = ancestorLayouts.length > 0;
  const pageSrc = readFileSync(pagePath, 'utf-8');
  const pageComp = extractCompName(pageSrc) || 'Page';

  let src = '';
  if (hasLayout) {
    const layoutSrc = readFileSync(layoutPath, 'utf-8');
    const layoutComp = extractCompName(layoutSrc) || 'Layout';
    src = `const _layoutSrc = \`${escapeSource(layoutSrc)}\`;\nconst _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _layoutComp = ${JSON.stringify(layoutComp)};\nconst _pageComp = ${JSON.stringify(pageComp)};\n`;
  } else if (hasAncestorLayout) {
    const outerLayout = ancestorLayouts[0];
    const outerLayoutPath = resolve(appDir, outerLayout.sourceDir, 'layout.vsk');
    const outerLayoutSrc = readFileSync(outerLayoutPath, 'utf-8');
    const outerLayoutComp = extractCompName(outerLayoutSrc) || 'Layout';
    src = `const _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += `const _layoutSrc = \`${escapeSource(outerLayoutSrc)}\`;\n`;
    src += `const _layoutComp = ${JSON.stringify(outerLayoutComp)};\n`;
  } else {
    src = `const _src = \`${escapeSource(pageSrc)}\`;\nconst _comp = ${JSON.stringify(pageComp)};\n`;
  }

  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  const paramsCode = `function __paramsFor(pathname) {\n  const urlParts = pathname.split('/').filter(Boolean);\n  return { ${paramExprs.join(', ')} };\n}\n`;

  const clientScriptOption = ', clientScriptUrl: "/_vesk/static/client.js"';

  let registryCode = '';
  const compRegEntries: string[] = [];
  const compMap = componentMap || new Map();
  for (const [compName, compPath] of compMap) {
    const compSrc = readFileSync(compPath, 'utf-8');
    const escapedSrc = escapeSource(compSrc);
    compRegEntries.push(`  registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n    const _src = \`${escapedSrc}\`;\n    const _comp = ${JSON.stringify(compName)};\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true });\n    return result.body;\n  })`);
  }
  if (compRegEntries.length > 0) {
    registryCode = `const __componentRegistry = new Map();\n{\n${compRegEntries.join('\n')}\n}\n`;
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  let htmlFnCode: string;
  if (hasLayout || hasAncestorLayout) {
    htmlFnCode = [
      'async function __renderHtml(params) {',
      '  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });',
      '  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + ', pageHead: page.head });',
      "  return new Response(html, { headers: { 'Content-Type': 'text/html' } });",
      '}',
      '',
    ].join('\n');
  } else {
    htmlFnCode = [
      'async function __renderHtml(params) {',
      '  const stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + ' });',
      '  return new Response(new ReadableStream({',
      '    async start(controller) {',
      '      const enc = new TextEncoder();',
      "      for await (const chunk of stream) { controller.enqueue(enc.encode(chunk)); }",
      '      controller.close();',
      '    },',
      "  }), { headers: { 'Content-Type': 'text/html' } });",
      '}',
      '',
    ].join('\n');
  }

  let dataCode: string;
  if (hasLayout || hasAncestorLayout) {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      '    const dataPage = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });',
      "    const dataLayout = await renderPage(_layoutSrc, _layoutComp, { params, children: '' }, __componentRegistry, { hydrate: true });",
      "    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: (dataLayout.head || '') + (dataPage.head || '') }), {",
      "      headers: { 'Content-Type': 'application/json' },",
      '    });',
      '  }',
      '  return __renderHtml(params);',
    ].join('\n');
  } else {
    dataCode = [
      "  if (request.headers.get('x-vesk-data') === '1') {",
      '    const dataPage = await renderPage(_src, _comp, { params }, __componentRegistry, { hydrate: true });',
      "    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: dataPage.head || '' }), {",
      "      headers: { 'Content-Type': 'application/json' },",
      '    });',
      '  }',
      '  return __renderHtml(params);',
    ].join('\n');
  }

  const hasMiddleware = !!middlewareCode;

  let bodyCode: string;
  if (hasMiddleware) {
    const indentedRender = dataCode.split('\n').map(l => l ? `  ${l}` : '').join('\n');
    bodyCode = [
      '  // ── Middleware context ──',
      '  const __ctx = {',
      '    request,',
      '    params,',
      '    url,',
      "    locals: {},",
      "    cookies: parseCookies(request.headers.get('cookie') || ''),",
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
    bodyCode = dataCode;
  }

  let registerActionsCode: string;
  if (hasLayout || hasAncestorLayout) {
    registerActionsCode = [
      'async function __registerActions() {',
      '  if (__actionsRegistered) return;',
      '  __actionsRegistered = true;',
      '  compileFile(_layoutSrc);',
      '  compileFile(_pageSrc);',
      '}',
      '',
    ].join('\n');
  } else {
    registerActionsCode = [
      'async function __registerActions() {',
      '  if (__actionsRegistered) return;',
      '  __actionsRegistered = true;',
      '  compileFile(_src);',
      '}',
      '',
    ].join('\n');
  }

  const actionCode = [
    'export async function handleAction(request, id) {',
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
    '      return await __renderHtml(params);',
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
    '    if (isFetch) {',
    "      return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });",
    '    }',
    "    return new Response(message, { status: 500, headers: { 'Content-Type': 'text/plain' } });",
    '  } finally {',
    '    globalThis.__vesk_request = prevReq;',
    '  }',
    '}',
    '',
  ].join('\n');

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage, compileFile, parseCookies, getAction, validateActionInput, issuesToFieldMap } from '../runtime.js';",
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
