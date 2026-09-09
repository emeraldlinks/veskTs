import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { buildHmrEvalSnippet } from './client-bundle';
import { resolveComponentName, randomToken } from '@vesk/compiler/src/server-codegen';
import { resolveErrorFile } from '@vesk/adapter/src/ssr-function';
import { resolveCssUrls, hasBuiltGlobalCss } from '@vesk/adapter/src/css';
import { isAllowedWsUpgrade } from '@vesk/adapter/src/paths';
import { parseCompilerError, buildCodeframe, type Codeframe } from '@vesk/adapter/src/error-codeframe';
import { suggestFor } from '@vesk/adapter/src/error-tips';
import type { RouteNode, AncestorLayout } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Canonical HMR error payload emitted on `'error'` broadcasts and exposed via
 * `getHmrState()` (served at `/__vesk/hmr/state`). This is the wire contract
 * between the HMR server and the client's `HmrErrorPayload` renderer.
 */
export interface HmrErrorPayload {
  file: string;
  filePath?: string;
  line: number | null;
  column: number | null;
  message: string;
  codeframe?: Codeframe;
  tips?: string[];
  suggestions?: string[];
  nextSteps?: string[];
  stack?: string;
}

/**
 * The last enriched error payload broadcast over HMR, plus the last successful
 * compile duration (ms). Cleared invariants:
 *   - `lastError` set ONLY on `'error'` broadcasts; cleared on every
 *     `'update'`/`'reload'` broadcast and on HMR watch start.
 *   - `lastCompileMs` set from `'update'`/`'reload'` `time`; cleared on error.
 */
let lastError: HmrErrorPayload | null = null;
let lastCompileMs: number | null = null;
let lastComponentCount: number | null = null;

export function getHmrState(): {
  status: 'up' | 'closed';
  lastCompileMs: number | null;
  error: HmrErrorPayload | null;
  hasError: boolean;
  componentCount?: number;
} {
  return {
    status: 'up',
    lastCompileMs,
    error: lastError,
    hasError: lastError !== null,
    ...(lastComponentCount !== null ? { componentCount: lastComponentCount } : {}),
  };
}

export interface BuildErrorPayloadOptions {
  /** Absolute app dir, used to resolve `filename` to disk for the codeframe. */
  appDir?: string;
  /** Extra fields merged into the returned payload (last writer wins). */
  extra?: Record<string, unknown>;
}

/**
 * Build the canonical HMR error payload from an arbitrary thrown value. Handles
 * Error instances, plain strings, and objects exposing `.loc`/`.position`
 * (acorn / VeskError shapes). When a line is recoverable it best-effort reads
 * the source file from disk to attach a ±context codeframe; otherwise line/
 * column are null and no codeframe is included (the client handles that case).
 */
export function buildErrorPayload(
  error: unknown,
  filename: string,
  opts: BuildErrorPayloadOptions = {},
): HmrErrorPayload {
  const file = typeof filename === 'string' && filename ? filename : 'unknown';
  const parsed = parseCompilerError(error, file);

  const fallbackMessage =
    error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : (() => { try { return String(error); } catch { return 'Unknown error'; } })();

  const message = parsed && parsed.message ? parsed.message : fallbackMessage;
  const line = parsed ? parsed.line : null;
  const column = parsed ? parsed.column : null;
  const stack = parsed && typeof parsed.stack === 'string' && parsed.stack
    ? parsed.stack
    : error instanceof Error && error.stack
      ? error.stack
      : undefined;

  let codeframe: Codeframe | undefined;
  if (line !== null && line >= 1 && typeof opts.appDir === 'string') {
    let src: string | undefined;
    try {
      const absPath = resolve(opts.appDir, file);
      if (existsSync(absPath)) src = readFileSync(absPath, 'utf-8');
    } catch {
      src = undefined;
    }
    if (typeof src === 'string' && src.length > 0) {
      const cf = buildCodeframe(src, line, column ?? 1);
      if (cf) {
        cf.file = file;
        codeframe = cf;
      }
    }
  }

  const tipsData = suggestFor(message);

  const filePath = typeof opts.appDir === 'string'
    ? resolve(opts.appDir, file)
    : undefined;

  // The file header already shows the location; strip the redundant
  // " in <file>" suffix compilers append to messages (e.g. acorn's
  // "Unexpected token in /abs/app/page.vsk").
  const cleanMessage =
    filePath && message.endsWith(` in ${filePath}`)
      ? message.slice(0, -` in ${filePath}`.length).trim()
      : message.endsWith(` in ${file}`)
        ? message.slice(0, -` in ${file}`.length).trim()
        : message;

  const payload: HmrErrorPayload = {
    file,
    line,
    column,
    message: cleanMessage,
  };
  if (filePath) payload.filePath = filePath;
  if (codeframe) payload.codeframe = codeframe;
  if (tipsData.tips && tipsData.tips.length) payload.tips = tipsData.tips;
  if (tipsData.suggestions && tipsData.suggestions.length) payload.suggestions = tipsData.suggestions;
  if (tipsData.nextSteps && tipsData.nextSteps.length) payload.nextSteps = tipsData.nextSteps;
  if (stack) payload.stack = stack;
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      (payload as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return payload;
}

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
  options?: { ancestorLayouts?: AncestorLayout[]; headExtra?: string },
): void {
  const ancestorLayouts = options?.ancestorLayouts || [];
  const headExtra = options?.headExtra || null;
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');
  const cssUrls = resolveCssUrls({
    enabled: hasBuiltGlobalCss(outDir),
  });
  const cssOption = cssUrls.length > 0 ? `, cssUrls: ${JSON.stringify(cssUrls)}` : '';
  const headExtraOption = headExtra ? `, headExtra: ${JSON.stringify(headExtra)}` : '';
  const bakedOptions = cssOption + headExtraOption;
  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);
  const pageSrc = readFileSync(pagePath, 'utf-8');
  const pageComp = extractCompName(pageSrc) || 'Page';

  const layoutStack = [
    ...ancestorLayouts.map((a) => ({ sourceDir: a.sourceDir, layoutCompName: a.layoutCompName })),
    ...(routeNode.layout ? [{ sourceDir: routeNode.sourceDir, layoutCompName: routeNode.layout }] : []),
  ];

  const layoutDecls: { src: string; comp: string; path: string; compiled: string }[] = [];
  for (const entry of layoutStack) {
    const entryPath = resolve(appDir, entry.sourceDir, 'layout.vsk');
    const entrySrc = readFileSync(entryPath, 'utf-8');
    const entryComp = extractCompName(entrySrc) || 'Layout';
    const escaped = escapeSource(entrySrc);
    layoutDecls.push({
      src: `\`${escaped}\``,
      comp: JSON.stringify(entryComp),
      path: JSON.stringify(entryPath),
      compiled: `(() => { try { setVskHydrate(true); return compileFile(\`${escaped}\`, { sourcePath: ${JSON.stringify(entryPath)} }); } catch { return null; } finally { setVskHydrate(false); } })()`,
    });
  }

  const errorPath = resolveErrorFile(routeNode.sourceDir, appDir);
  const errorSrc = errorPath ? readFileSync(errorPath, 'utf-8') : null;
  const errorComp = errorPath ? (extractCompName(errorSrc as string) || 'Error') : null;
  const errorVars = errorPath
    ? `const _errorSrc = \`${escapeSource(errorSrc as string)}\`;\nconst _errorComp = ${JSON.stringify(errorComp)};\nconst _errorPath = ${JSON.stringify(errorPath)};\nconst _errorCompiled = (() => { try { setVskHydrate(true); return compileFile(_errorSrc, { sourcePath: _errorPath }); } catch { return null; } finally { setVskHydrate(false); } })();\n`
    : 'const _errorSrc = null;\nconst _errorComp = null;\nconst _errorPath = null;\nconst _errorCompiled = null;\n';

  const clientScriptOption = ', clientScriptUrl: "/_vesk/static/client.js"';
  const dataScriptOption = ', externalDataScript: storeDataScriptGlobal';

  let src = '';
  if (layoutDecls.length > 0) {
    src = `const _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _pageComp = ${JSON.stringify(pageComp)};\n`;
    src += `const _pagePath = ${JSON.stringify(pagePath)};\n`;
    src += `const _pageCompiled = (() => { try { setVskHydrate(true); return compileFile(_pageSrc, { sourcePath: _pagePath }); } catch { return null; } finally { setVskHydrate(false); } })();\n`;
    src += `const _layoutSrcList = [\n${layoutDecls.map((d) => '  ' + d.src + ',').join('\n')}\n];\n`;
    src += `const _layoutCompList = [${layoutDecls.map((d) => d.comp).join(', ')}];\n`;
    src += `const _layoutPathList = [${layoutDecls.map((d) => d.path).join(', ')}];\n`;
    src += `const _layoutCompiledList = [\n${layoutDecls.map((d) => '  ' + d.compiled + ',').join('\n')}\n];\n`;
    src += errorVars;
  } else {
    src = `const _src = \`${escapeSource(pageSrc)}\`;\nconst _comp = ${JSON.stringify(pageComp)};\n`;
    src += `const _srcPath = ${JSON.stringify(pagePath)};\n`;
    src += `const _srcCompiled = (() => { try { setVskHydrate(true); return compileFile(_src, { sourcePath: _srcPath }); } catch { return null; } finally { setVskHydrate(false); } })();\n`;
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
    compRegEntries.push(`  registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n    const _src = \`${escapedSrc}\`;\n    const _comp = ${JSON.stringify(compName)};\n    const _compiled = (() => { try { setVskHydrate(true); return compileFile(_src, { sourcePath: ${JSON.stringify(compPath)} }); } catch { return null; } finally { setVskHydrate(false); } })();\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true, cached: _compiled, sourcePath: ${JSON.stringify(compPath)} });\n    return result.body;\n  })`);
  }
  if (compRegEntries.length > 0) {
    registryCode = `const __componentRegistry = new Map();\n{\n${compRegEntries.join('\n')}\n}\n`;
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  let renderCode: string;
  if (layoutDecls.length > 0) {
    renderCode = [
      '  let page;',
      '  let caughtError = null;',
      '  try {',
      '    page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled, sourcePath: _pagePath });',
      '  } catch (err) {',
      "    if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;",
      '    caughtError = err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    page = { body: await __renderErrorBody({ params, statusCode: 500, error: message, stack, url: url.href }), head: '' };",
      '  }',
      "  let _body = (caughtError ? '<!--vesk-ssr-error:' + (caughtError && typeof caughtError === 'object' && 'message' in caughtError ? encodeURIComponent(String(caughtError.message)) : '') + '-->' : '') + page.body;",
      "  let _head = page.head || '';",
      "  for (let _i = _layoutSrcList.length - 1; _i > 0; _i--) {",
      "    const _inner = await renderPage(_layoutSrcList[_i], _layoutCompList[_i], { params, children: _body }, __componentRegistry, { hydrate: true, cached: _layoutCompiledList[_i], sourcePath: _layoutPathList[_i] });",
      '    _body = _inner.body;',
      "    if (_inner.head) _head = _inner.head + _head;",
      '  }',
      "  const html = await renderFullPage(_layoutSrcList[0], _layoutCompList[0], { params, children: _body }, __componentRegistry, { hydrate: true, cached: _layoutCompiledList[0]" + bakedOptions + clientScriptOption + dataScriptOption + ', pageHead: _head, sourcePath: _layoutPathList[0] });',
      "  return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: caughtError ? 500 : 200 });",
    ].join('\n');
  } else {
    renderCode = [
      '  let stream;',
      '  try {',
      '    stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true, cached: _srcCompiled' + bakedOptions + clientScriptOption + dataScriptOption + ", sourcePath: _srcPath });",
      '  } catch (err) {',
      '    if (err && (err.name === \'NotFoundError\' || err.name === \'Redirect\')) throw err;',
      '    if (!_errorSrc) throw err;',
      "    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);",
      "    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';",
      "    const html = await renderFullPage(_errorSrc, _errorComp, { params, statusCode: 500, error: message, stack, url: url.href }, __componentRegistry, { hydrate: true, cached: _errorCompiled" + bakedOptions + clientScriptOption + dataScriptOption + ', sourcePath: _errorPath });',
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
    '    const result = await renderPage(_errorSrc, _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled, sourcePath: _errorPath });',
    '    return result.body;',
    '  } catch {',
    "    return '<h1>500 \\u2014 Internal Server Error</h1>';",
    '  }',
    '}',
  ].join('\n');

  const funcCode = [
    "import { renderFullPage, renderPageStream, renderPage, compileFile, setVskHydrate, storeDataScriptGlobal } from '../runtime.js';",
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
): {
  broadcast: (type: string, data?: Record<string, unknown>) => void;
  handleFileChange: (filename: string | null, doFullBuild: () => Promise<void>, routeTree: RouteNode[]) => Promise<void>;
  getHmrState: () => ReturnType<typeof getHmrState>;
} {
  // Per-session nonce gating the client-side HMR eval hook (see
  // appendHmrGlobals in client-bundle.ts). Broadcast with every update.
  const hmrNonce = randomToken(16);
  (globalThis as Record<string, unknown>).__vesk_hmr_nonce = hmrNonce;

  // HMR watch start — clear any stale error state so a fresh session starts
  // clean (the client also pulls live state via /__vesk/hmr/state).
  lastError = null;
  lastCompileMs = null;
  lastComponentCount = null;

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<import('ws').WebSocket>();

  // Origin-checked upgrade: cross-site pages always attach an Origin header
  // to WebSocket handshakes, so a mismatch means a CSWS attempt — destroy it.
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/_vesk/hmr' || !isAllowedWsUpgrade(req.headers as Record<string, unknown>)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: import('ws').WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  function broadcast(type: string, data?: Record<string, unknown> | HmrErrorPayload): void {
    // Keep live state in lockstep with what clients receive. `lastError` is set
    // ONLY on 'error' broadcasts and cleared on any successful update/reload;
    // `lastCompileMs` tracks the most recent successful compile duration.
    const d = (data ?? {}) as Record<string, unknown>;
    if (type === 'error') {
      lastError = (d && typeof d.message === 'string') ? (d as unknown as HmrErrorPayload) : null;
      lastCompileMs = null;
    } else if (type === 'update' || type === 'reload') {
      lastError = null;
      if (typeof d.time === 'number') lastCompileMs = d.time;
      if (type === 'update' && d && typeof d.components === 'object' && d.components !== null) {
        lastComponentCount = Object.keys(d.components as Record<string, unknown>).length;
      }
    }
    const msg = JSON.stringify({ type, nonce: hmrNonce, ...data });
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
          for (const { name } of assignments) {
            components[name] = true;
          }
          // Send the whole file scope (not per-component slices): a sliced
          // assignment closes over file top-level bindings (const navItems,
          // helpers, …) that the eval context does not have, so the
          // re-rendered component throws ReferenceError and the swap fails
          // silently (no reload, stale DOM, zero page errors).
          const snippet = buildHmrEvalSnippet(code);
          if (snippet.trim()) {
            broadcast('update', {
              components,
              fnSources: { _raw: snippet },
              time: Date.now() - start,
            });
          }
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
        const payload = buildErrorPayload(e, filename, { appDir });
        broadcast('error', payload);
        console.error(`vesk hmr: error — ${payload.message}`);
      }
      return;
    }

    if (filename.includes('/api/') && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('reload', { reason: `API: ${filename}`, time: Date.now() - start });
      } catch (e) {
        broadcast('error', buildErrorPayload(e, filename, { appDir }));
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
        broadcast('error', buildErrorPayload(e, filename, { appDir }));
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
        broadcast('error', buildErrorPayload(e, filename, { appDir }));
      }
      return;
    }

    const start = Date.now();
    try {
      await doFullBuild();
      broadcast('reload', { reason: `${filename} changed`, time: Date.now() - start });
    } catch (e) {
      broadcast('error', buildErrorPayload(e, filename, { appDir }));
    }
  }

  return { broadcast, handleFileChange, getHmrState };
}
