/**
 * Server-side rendering function generation for Vesk.
 * Generates the SSR entry function for each page/layout, wrapping the
 * compiler's renderPage/renderPageStream APIs with the correct source code.
 * @module ssr-function
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function escapeSource(src) {
  return src
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function routeName(segments) {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

function extractCompName(src) {
  const m = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
  return m ? m[1] : null;
}

function buildParamExtraction(node, urlParts) {
  const parts = [];
  // Start at the depth of this node within the full path.
  // urlParts includes all ancestor segments; the node's own path is the last segment.
  let partIdx = Math.max(0, urlParts.length - 1);
  function walk(n) {
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

export function generateSsrFunction(routeNode, appDir, outDir, componentMap = new Map(), options = {}) {
  const ancestorLayouts = options.ancestorLayouts || [];
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');
  const layoutPath = resolve(appDir, routeNode.sourceDir, 'layout.vsk');

  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);

  // Build CSS URLs — only include _tailwind.css if it has actual content
  const tailwindPath = resolve(outDir, 'static', '_tailwind.css');
  const globalCssPath = resolve(appDir, '..', 'src', 'global.css');
  const altCssPath = resolve(appDir, '..', 'src', 'app.css');
  const hasGlobalCss = existsSync(globalCssPath) || existsSync(altCssPath);
  const hasTailwind = existsSync(tailwindPath) && readFileSync(tailwindPath, 'utf-8').trim().length > 0;
  const cssUrls = [];
  if (hasTailwind) cssUrls.push('/_vesk/static/_tailwind.css');
  if (hasGlobalCss) cssUrls.push('/_vesk/static/global.css');
  const cssOption = cssUrls.length > 0 ? `, cssUrls: ${JSON.stringify(cssUrls)}` : '';

  const hasLayout = routeNode.layout;
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
    // Use the outermost ancestor layout for the HTML shell
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

  // Build param extraction
  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  let paramsCode = '';
  if (paramExprs.length > 0) {
    paramsCode = `const params = { ${paramExprs.join(', ')} };\n`;
  } else {
    paramsCode = 'const params = {};\n';
  }

  const clientScriptOption = ', clientScriptUrl: "/_vesk/static/client.js"';

  // Build registry import for external components
  let registryCode = '';
  const compRegEntries = [];
  for (const [compName, compPath] of componentMap) {
    const src = readFileSync(compPath, 'utf-8');
    const escapedSrc = escapeSource(src);
    compRegEntries.push(`  registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n    const _src = \`${escapedSrc}\`;\n    const _comp = ${JSON.stringify(compName)};\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true });\n    return result.body;\n  })`);
  }
  if (compRegEntries.length > 0) {
    registryCode = `const __componentRegistry = new Map();\n{\n${compRegEntries.join('\n')}\n}\n`;
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  let renderCode;
  if (hasLayout) {
    renderCode = [
      `  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });`,
      `  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true${cssOption}${clientScriptOption}, pageHead: page.head });`,
      `  return new Response(html, {`,
      `    headers: { 'Content-Type': 'text/html' },`,
      `  });`,
    ].join('\n');
  } else if (hasAncestorLayout) {
    const outerLayout = ancestorLayouts[0];
    renderCode = [
      `  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });`,
      `  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true${cssOption}${clientScriptOption}, pageHead: page.head });`,
      `  return new Response(html, {`,
      `    headers: { 'Content-Type': 'text/html' },`,
      `  });`,
    ].join('\n');
  } else {
    renderCode = [
      `  const stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true${cssOption}${clientScriptOption} });`,
      `  return new Response(new ReadableStream({`,
      `    async start(controller) {`,
      `      const enc = new TextEncoder();`,
      `      for await (const chunk of stream) {`,
      `        controller.enqueue(enc.encode(chunk));`,
      `      }`,
      `      controller.close();`,
      `    },`,
      `  }), {`,
      `    headers: { 'Content-Type': 'text/html' },`,
      `  });`,
    ].join('\n');
  }

  const funcCode = [
    `import { renderFullPage, renderPageStream, renderPage } from '../runtime.js';`,
    ``,
    registryCode,
    src,
    ``,
    `export async function handle(request) {`,
    `  const url = new URL(request.url);`,
    `  const urlParts = url.pathname.split('/').filter(Boolean);`,
    `  ${paramsCode}`,
    renderCode,
    `}`,
    ``,
  ].join('\n');

  return { funcPath, funcCode, name };
}
