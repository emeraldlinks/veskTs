import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { resolveComponentName } from '@vesk/compiler/src/server-codegen';
import { resolveErrorFile } from '@vesk/adapter/src/ssr-function';
import type { RouteNode, AncestorLayout } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRouteForSource(routeTree: RouteNode[], sourceDir: string): RouteNode | null {
  for (const node of routeTree) {
    if (node.sourceDir === sourceDir) return node;
    if (node.children) {
      const found = findRouteForSource(node.children, sourceDir);
      if (found) return found;
    }
  }
  return null;
}

function collectAncestorLayouts(routeTree: RouteNode[], sourceDir: string, chain: AncestorLayout[] = []): AncestorLayout[] | null {
  for (const node of routeTree) {
    if (node.sourceDir === sourceDir) return chain;
    if (node.children) {
      const nextChain = node.layout
        ? [...chain, { sourceDir: node.sourceDir, layoutCompName: node.layout }]
        : chain;
      const found = collectAncestorLayouts(node.children, sourceDir, nextChain);
      if (found) return found;
    }
  }
  return null;
}

interface ComponentAssignment {
  name: string;
  raw: string;
}

function extractComponentAssignments(code: string): ComponentAssignment[] {
  const assignments: ComponentAssignment[] = [];
  const startRegex = /__components\["(\w+)"\]\s*=\s*/;
  const lines = code.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(startRegex);
    if (m) {
      const name = m[1];
      const startIdx = i;
      let braceDepth = 0;
      for (let j = 0; j < lines[i].length; j++) {
        if (lines[i][j] === '{') braceDepth++;
        if (lines[i][j] === '}') braceDepth--;
      }
      i++;
      while (i < lines.length && braceDepth > 0) {
        for (let j = 0; j < lines[i].length; j++) {
          if (lines[i][j] === '{') braceDepth++;
          if (lines[i][j] === '}') braceDepth--;
        }
        i++;
      }
      const fullAssignment = lines.slice(startIdx, i).join('\n');
      assignments.push({ name, raw: fullAssignment });
    } else {
      i++;
    }
  }
  return assignments;
}

function extractSourceDir(filename: string): string | null {
  if (filename === 'page.vsk') return '';
  if (filename.endsWith('/page.vsk')) return filename.slice(0, -'/page.vsk'.length);
  if (filename === 'layout.vsk') return '';
  if (filename.endsWith('/layout.vsk')) return filename.slice(0, -'/layout.vsk'.length);
  return null;
}

function escapeSource(src: string): string {
  return src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function extractCompName(src: string): string | null {
  return resolveComponentName(src);
}

function routeName(segments: string[]): string {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

function buildParamExtraction(node: RouteNode, urlParts: string[]): string[] {
  const parts: string[] = [];
  let partIdx = Math.max(0, urlParts.length - 1);
  function walk(n: RouteNode): void {
    if (n.fullPath === '/') { for (const child of (n.children || [])) walk(child); return; }
    if (n.isGroup) { for (const child of (n.children || [])) walk(child); return; }
    if (partIdx >= urlParts.length) return;
    if (n.isCatchAll) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'slug';
      parts.push(`${JSON.stringify(paramName)}: urlParts.slice(${partIdx}).join('/')`);
      partIdx = urlParts.length; return;
    }
    if (n.isDynamic) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'param';
      parts.push(`${JSON.stringify(paramName)}: urlParts[${partIdx}]`);
      partIdx++;
      for (const child of (n.children || [])) walk(child); return;
    }
    if (n.path === urlParts[partIdx]) { partIdx++; for (const child of (n.children || [])) walk(child); }
  }
  walk(node);
  return parts;
}

function regenerateSsrFunction(
  routeNode: RouteNode,
  appDir: string,
  outDir: string,
  componentMap?: Map<string, string>,
  options?: { ancestorLayouts?: AncestorLayout[] },
): void {
  const ancestorLayouts = options?.ancestorLayouts || [];
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');
  const layoutPath = resolve(appDir, routeNode.sourceDir, 'layout.vsk');
  const tailwindPath = resolve(outDir, 'static', '_tailwind.css');
  const globalCssPath = resolve(appDir, '..', 'src', 'global.css');
  const altCssPath = resolve(appDir, '..', 'src', 'app.css');
  const hasGlobalCss = existsSync(globalCssPath) || existsSync(altCssPath);
  const hasTailwind = existsSync(tailwindPath) && readFileSync(tailwindPath, 'utf-8').trim().length > 0;
  const cssUrls: string[] = [];
  if (hasTailwind) cssUrls.push('/_vesk/static/_tailwind.css');
  if (hasGlobalCss) cssUrls.push('/_vesk/static/global.css');
  const cssOption = cssUrls.length > 0 ? `, cssUrls: ${JSON.stringify(cssUrls)}` : '';
  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);
  const hasLayout = !!routeNode.layout;
  const hasAncestorLayout = ancestorLayouts.length > 0;
  const pageSrc = readFileSync(pagePath, 'utf-8');
  const pageComp = extractCompName(pageSrc) || 'Page';

  const errorPath = resolveErrorFile(routeNode.sourceDir, appDir);
  const errorSrc = errorPath ? readFileSync(errorPath, 'utf-8') : null;
  const errorComp = errorPath ? (extractCompName(errorSrc as string) || 'Error') : null;
  const errorVars = errorPath
    ? `const _errorSrc = \`${escapeSource(errorSrc as string)}\`;\nconst _errorComp = ${JSON.stringify(errorComp)};\nconst _errorPath = ${JSON.stringify(errorPath)};\n`
    : 'const _errorSrc = null;\nconst _errorComp = null;\nconst _errorPath = null;\n';

  const clientScriptOption = ', clientScriptUrl: "/_vesk/static/client.js"';
  const dataScriptOption = ', externalDataScript: storeDataScriptGlobal';

  let src = '';
  if (hasLayout) {
    const layoutSrc = readFileSync(layoutPath, 'utf-8');
    const layoutComp = extractCompName(layoutSrc) || 'Layout';
    src = `const _layoutSrc = \`${escapeSource(layoutSrc)}\`;\nconst _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _layoutComp = ${JSON.stringify(layoutComp)};\nconst _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += `const _layoutPath = ${JSON.stringify(layoutPath)};\nconst _pagePath = ${JSON.stringify(pagePath)};\n`;
    src += errorVars;
  } else if (hasAncestorLayout) {
    const outerLayout = ancestorLayouts[0];
    const outerLayoutPath = resolve(appDir, outerLayout.sourceDir, 'layout.vsk');
    const outerLayoutSrc = readFileSync(outerLayoutPath, 'utf-8');
    const outerLayoutComp = extractCompName(outerLayoutSrc) || 'Layout';
    src = `const _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += `const _layoutSrc = \`${escapeSource(outerLayoutSrc)}\`;\n`;
    src += `const _layoutComp = ${JSON.stringify(outerLayoutComp)};\n`;
    src += `const _layoutPath = ${JSON.stringify(outerLayoutPath)};\nconst _pagePath = ${JSON.stringify(pagePath)};\n`;
    src += errorVars;
  } else {
    src = `const _src = \`${escapeSource(pageSrc)}\`;\nconst _comp = ${JSON.stringify(pageComp)};\n`;
    src += `const _srcPath = ${JSON.stringify(pagePath)};\n`;
    src += errorVars;
  }

  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  const paramsCode = paramExprs.length > 0 ? `const params = { ${paramExprs.join(', ')} };\n` : 'const params = {};\n';

  let registryCode = '';
  const compRegEntries: string[] = [];
  const compMap = componentMap || new Map();
  for (const [compName, compPath] of compMap) {
    const compSrc = readFileSync(compPath, 'utf-8');
    const escapedSrc = escapeSource(compSrc);
    compRegEntries.push(`  registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n    const _src = \`${escapedSrc}\`;\n    const _comp = ${JSON.stringify(compName)};\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true, sourcePath: ${JSON.stringify(compPath)} });\n    return result.body;\n  })`);
  }
  if (compRegEntries.length > 0) {
    registryCode = `const __componentRegistry = new Map();\n{\n${compRegEntries.join('\n')}\n}\n`;
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  let renderCode: string;
  if (hasLayout) {
    renderCode = [
      '  let page;',
      '  let caughtError = null;',
      '  try {',
      '    page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, sourcePath: _pagePath });',
      '  } catch (err) {',
      "    if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;",
      '    caughtError = err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    page = { body: await __renderErrorBody({ params, statusCode: 500, error: message, stack, url: url.href }), head: '' };",
      '  }',
      '  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: (caughtError ? \'<!--vesk-ssr-error-->\' : \'\') + page.body }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + dataScriptOption + ', pageHead: page.head, sourcePath: _layoutPath });',
      "  return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: caughtError ? 500 : 200 });",
    ].join('\n');
  } else if (hasAncestorLayout) {
    renderCode = [
      '  let page;',
      '  let caughtError = null;',
      '  try {',
      '    page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, sourcePath: _pagePath });',
      '  } catch (err) {',
      "    if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;",
      '    caughtError = err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    page = { body: await __renderErrorBody({ params, statusCode: 500, error: message, stack, url: url.href }), head: '' };",
      '  }',
      '  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: (caughtError ? \'<!--vesk-ssr-error-->\' : \'\') + page.body }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + dataScriptOption + ', pageHead: page.head, sourcePath: _layoutPath });',
      "  return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: caughtError ? 500 : 200 });",
    ].join('\n');
  } else {
    renderCode = [
      '  let stream;',
      '  try {',
      '    stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true' + cssOption + clientScriptOption + dataScriptOption + ", sourcePath: _srcPath });",
      '  } catch (err) {',
      '    if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '    if (!_errorSrc) throw err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    const html = await renderFullPage(_errorSrc, _errorComp, { params, statusCode: 500, error: message, stack, url: url.href }, __componentRegistry, { hydrate: true" + cssOption + clientScriptOption + dataScriptOption + ', sourcePath: _errorPath });',
      "    return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 500 });",
      '  }',
      '  return new Response(new ReadableStream({',
      '    async start(controller) {',
      '      const enc = new TextEncoder();',
      '      for await (const chunk of stream) {',
      '        controller.enqueue(enc.encode(chunk));',
      '      }',
      '      controller.close();',
      '    },',
      "  }), { headers: { 'Content-Type': 'text/html' } });",
    ].join('\n');
  }

  const errorBodyFnCode = [
    'async function __renderErrorBody(props) {',
    '  if (!_errorSrc) throw props.error || new Error("Internal Server Error");',
    '  try {',
    '    const result = await renderPage(_errorSrc, _errorComp, props, __componentRegistry, { hydrate: true, sourcePath: _errorPath });',
    '    return result.body;',
    '  } catch {',
    "    return '<h1>500 \\u2014 Internal Server Error</h1>';",
    '  }',
    '}',
  ].join('\n');

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage, storeDataScriptGlobal } from '../runtime.js';",
    '', registryCode, src, '',
    errorBodyFnCode,
    '',
    'export async function handle(request) {',
    '  const url = new URL(request.url);',
    "  const urlParts = url.pathname.split('/').filter(Boolean);",
    `  ${paramsCode}`,
    renderCode,
    '}',
  ].join('\n');
  writeFileSync(funcPath, funcCode, 'utf-8');
}

export function createHmrServer(
  httpServer: Server,
  appDir: string,
  devDir: string,
  componentMap?: Map<string, string>,
): { broadcast: (type: string, data?: Record<string, unknown>) => void; handleFileChange: (filename: string | null, doFullBuild: () => Promise<void>, routeTree: RouteNode[]) => Promise<void> } {
  const wss = new WebSocketServer({ server: httpServer, path: '/_vesk/hmr' });
  const clients = new Set<import('ws').WebSocket>();

  wss.on('connection', (ws: import('ws').WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  function broadcast(type: string, data?: Record<string, unknown>): void {
    const msg = JSON.stringify({ type, ...data });
    for (const ws of clients) {
      try { ws.send(msg); } catch { clients.delete(ws); }
    }
  }

  async function handleFileChange(filename: string | null, doFullBuild: () => Promise<void>, routeTree: RouteNode[]): Promise<void> {
    if (!filename) return;

    broadcast('compiling');

    if (filename.endsWith('.vsk')) {
      const sourceDir = extractSourceDir(filename);
      const fullPath = resolve(appDir, filename);
      if (!existsSync(fullPath)) return;

      try {
        const start = Date.now();
        const src = readFileSync(fullPath, 'utf-8');
        const code = compileClient(src, null, { forceClient: true });
        const assignments = extractComponentAssignments(code);

        if (assignments.length > 0) {
          const components: Record<string, boolean> = {};
          const fnSources: Record<string, string> = {};
          for (const { name, raw } of assignments) {
            components[name] = true;
            fnSources[name] = raw;
          }
          broadcast('update', {
            components,
            fnSources,
            time: Date.now() - start,
          });
        }

        if (sourceDir !== null) {
          const routeNode = findRouteForSource(routeTree, sourceDir);
          if (routeNode) {
            const ancestorLayouts = collectAncestorLayouts(routeTree, sourceDir);
            regenerateSsrFunction(routeNode, appDir, devDir, componentMap, { ancestorLayouts: ancestorLayouts || [] });
          }
        }

        console.error(`vesk hmr: ${assignments.map(a => a.name).join(', ')} (${Date.now() - start}ms)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        broadcast('error', { message, file: filename });
        console.error(`vesk hmr: error — ${message}`);
      }
      return;
    }

    if (filename.includes('/api/') && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('reload', { reason: `API: ${filename}`, time: Date.now() - start });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        broadcast('error', { message, file: filename });
      }
      return;
    }

    if (filename === 'middleware.ts' || filename.endsWith('/middleware.ts')) {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('reload', { reason: `Middleware: ${filename}`, time: Date.now() - start });
        console.error(`vesk hmr: middleware ${filename} rebuilt (${Date.now() - start}ms)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        broadcast('error', { message, file: filename });
      }
      return;
    }

    if (filename === 'vesk.config.ts' || filename === 'vesk.config.js' ||
        filename === 'tsconfig.json' || filename === 'package.json') {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('reload', { reason: `Config: ${filename}`, time: Date.now() - start });
        console.error(`vesk hmr: ${filename} rebuilt (${Date.now() - start}ms)`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        broadcast('error', { message, file: filename });
      }
      return;
    }

    const start = Date.now();
    try {
      await doFullBuild();
      broadcast('reload', { reason: `${filename} changed`, time: Date.now() - start });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      broadcast('error', { message, file: filename });
    }
  }

  return { broadcast, handleFileChange };
}
