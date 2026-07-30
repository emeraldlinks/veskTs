import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RouteNode, AncestorLayout, SsrFunctionOptions } from './types';

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
  const m = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
  return m ? m[1] : null;
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
  let paramsCode: string;
  if (paramExprs.length > 0) {
    paramsCode = `const params = { ${paramExprs.join(', ')} };\n`;
  } else {
    paramsCode = 'const params = {};\n';
  }

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

  let renderCode: string;
  if (hasLayout) {
    renderCode = [
      '  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });',
      '  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + ', pageHead: page.head });',
      '  return new Response(html, {',
      "    headers: { 'Content-Type': 'text/html' },",
      '  });',
    ].join('\n');
  } else if (hasAncestorLayout) {
    renderCode = [
      '  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });',
      '  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + ', pageHead: page.head });',
      '  return new Response(html, {',
      "    headers: { 'Content-Type': 'text/html' },",
      '  });',
    ].join('\n');
  } else {
    renderCode = [
      "  const stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true" + cssOption + clientScriptOption + " });",
      '  return new Response(new ReadableStream({',
      '    async start(controller) {',
      '      const enc = new TextEncoder();',
      '      for await (const chunk of stream) {',
      '        controller.enqueue(enc.encode(chunk));',
      '      }',
      '      controller.close();',
      '    },',
      '  }), {',
      "    headers: { 'Content-Type': 'text/html' },",
      '  });',
    ].join('\n');
  }

  const hasMiddleware = !!middlewareCode;

  let bodyCode: string;
  if (hasMiddleware) {
    const indentedRender = renderCode.split('\n').map(l => l ? `  ${l}` : '').join('\n');
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
    bodyCode = renderCode;
  }

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage } from '../runtime.js';",
    hasMiddleware ? "import { parseCookies } from '../runtime.js';" : '',
    '',
    middlewareCode || '',
    registryCode,
    src,
    '',
    'export async function handle(request) {',
    '  const url = new URL(request.url);',
    "  const urlParts = url.pathname.split('/').filter(Boolean);",
    `  ${paramsCode}`,
    bodyCode,
    '}',
    '',
  ].filter(Boolean).join('\n');

  return { funcPath, funcCode, name };
}
