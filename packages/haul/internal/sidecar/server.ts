import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMiddlewareParts } from '@vesk/compiler/src/router';
import { createRequire } from 'node:module';
import { bundleClientRuntimeIife, bundleServerRuntime } from './mini-bundler';
import { postprocessClientCode, rewriteRuntimeImportSources } from './client-postprocess';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const require = createRequire(import.meta.url);

function resolveInstalledPackage(spec: string): string {
  try {
    return dirname(require.resolve(`${spec}/package.json`));
  } catch {
    return '';
  }
}

function findCompilerSrc(): string {
  const candidates = [
    resolveInstalledPackage('@vesk/compiler'),
    resolve(process.cwd(), 'node_modules', '@vesk/compiler'),
    resolve(__dirname, '..', '..', 'node_modules', '@vesk/compiler'),
    '/root/vesk/packages/compiler/dist',
    resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'compiler', 'dist'),
    resolve(__dirname, '..', '..', '..', 'packages', 'compiler', 'dist'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'index.js')) || existsSync(join(dir, 'index.ts'))) return dir;
    }
  }
  throw new Error('@vesk/compiler/dist not found');
}

const compilerDir = findCompilerSrc();

function findRuntimeSrc(): string {
  const candidates = [
    resolveInstalledPackage('@vesk/runtime'),
    resolve(process.cwd(), 'node_modules', '@vesk/runtime'),
    resolve(__dirname, '..', '..', 'node_modules', '@vesk/runtime'),
    '/root/vesk/packages/runtime/dist',
    resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'runtime', 'dist'),
    resolve(__dirname, '..', '..', '..', 'packages', 'runtime', 'dist'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'index-client.js')) || existsSync(join(dir, 'index-client.ts'))) return dir;
    }
  }
  throw new Error('@vesk/runtime/dist not found');
}

const runtimeDir = findRuntimeSrc();

function loadCompilerModule(name: string): any {
  const tsPath = resolve(compilerDir, name.replace(/\.js$/, '.ts'));
  const jsPath = resolve(compilerDir, name);
  const path = existsSync(tsPath) ? tsPath : jsPath;
  return import(path);
}

let compileClient: any;
let compileServer: any;
let generateVskDts: any;
let vskToTsx: any;
let typecheckProject: any;
let scanRoutes: any;
let scanApiRoutes: any;
let collectMiddlewareChain: any;

const reTailwindDirective = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/;

function cssBlockEnd(css: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c) i++;
      i++;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

function extractTailwindDirectives(css: string): { directives: string; userCSS: string } {
  const tailwindChunks: string[] = [];
  const userChunks: string[] = [];
  let pos = 0;

  while (pos < css.length) {
    const lineStart = pos;
    const nl = css.indexOf('\n', pos);
    const lineEnd = nl === -1 ? css.length : nl + 1;
    const line = css.slice(lineStart, lineEnd);
    const trimmed = line.trim();

    const isImport = trimmed.startsWith('@import') && trimmed.includes('tailwindcss');
    const isSource = trimmed.startsWith('@source ');
    const isBlockStart = reTailwindDirective.test(trimmed);

    if (isImport || isSource) {
      tailwindChunks.push(line);
      pos = lineEnd;
      continue;
    }
    if (isBlockStart) {
      const end = cssBlockEnd(css, lineStart);
      tailwindChunks.push(css.slice(lineStart, end));
      pos = end;
      continue;
    }

    userChunks.push(line);
    pos = lineEnd;
  }

  return {
    directives: tailwindChunks.join('').trim(),
    userCSS: userChunks.join('').trim(),
  };
}

async function ensureModules() {
  if (compileClient) return;
  const clientCodegen = await loadCompilerModule('client-codegen.js');
  const serverCodegen = await loadCompilerModule('server-codegen.js');
  const vskTsx = await loadCompilerModule('vsk-tsx.js');
  const typecheck = await loadCompilerModule('typecheck.js');
  const router = await loadCompilerModule('router.js');
  const middleware = await loadCompilerModule('middleware.js');
  const apiRoutes = await loadCompilerModule('api-routes.js');
  compileClient = clientCodegen.compileClient;
  compileServer = serverCodegen.compileServer;
  generateVskDts = vskTsx.generateVskDts;
  vskToTsx = vskTsx.vskToTsx;
  typecheckProject = typecheck.typecheckProject;
  scanRoutes = router.scanRoutes;
  scanApiRoutes = apiRoutes.scanApiRoutes;
  collectMiddlewareChain = middleware.collectMiddlewareChain;
}

async function processCssWithPlugins(css: string, filePath: string, projectDir?: string): Promise<string> {
  const baseDir = projectDir || process.cwd();
  const veskConfigPath = resolve(baseDir, 'vesk.config.ts');
  const veskConfigTsxPath = resolve(baseDir, 'vesk.config.tsx');

  let plugins: Array<{ onCSS?: (content: string, filePath: string) => string | Promise<string | null> }> = [];

  if (existsSync(veskConfigPath) || existsSync(veskConfigTsxPath)) {
    const configPath = existsSync(veskConfigTsxPath) ? veskConfigTsxPath : veskConfigPath;
    try {
      const config = await import(configPath);
      const configObj = config.default || config;
      plugins = configObj?.plugins || [];
    } catch (e) {
      console.error('on_css: failed to load vesk.config:', e);
    }
  }

  let result = css;
  for (const plugin of plugins) {
    if (typeof plugin.onCSS === 'function') {
      try {
        const processed = await plugin.onCSS(result, filePath);
        if (processed !== null && typeof processed === 'string') {
          result = processed;
        }
      } catch (e) {
        console.error('on_css error:', e);
      }
    }
  }

  return result;
}

function ok(result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: 0, result };
}

function errorStatusCode(e: unknown): number {
  const s = (e as { statusCode?: unknown } | null)?.statusCode ?? (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s >= 100 && s < 600 ? s : 500;
}

function err(id: number | string, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code: 1, message } };
}

function serveStatic(req: any, res: any, filePath: string, contentType: string) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const data = readFileSync(filePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
}

// ────────────────────────────────────────────────────────────────────────────
// Dev server state + RPC (mirrors packages/cli/src/dev-server.ts)
// ────────────────────────────────────────────────────────────────────────────

interface DevRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyB64?: string;
  clientIp?: string;
  port?: number;
}

interface DevResponse {
  status: number;
  headers: [string, string][];
  bodyB64: string;
}

type SsrDataPayload = { props?: Record<string, unknown>; ssrData?: Record<string, unknown> };

let devMods: any = null;
let devState: any = null;

async function loadDevModules(): Promise<any> {
  if (devMods) return devMods;
  const [sc, ar, mw, cg, ru, store, util, cb, act, cfg, rt] = await Promise.all([
    import('@vesk/compiler/src/server-codegen'),
    import('@vesk/compiler/src/api-routes'),
    import('@vesk/compiler/src/middleware'),
    import('@vesk/compiler/src/client-codegen'),
    import('@vesk/compiler/src/router'),
    import('@vesk/compiler/src/ssr-store'),
    import('@vesk/compiler/src/server-utils'),
    import('@vesk/adapter/src/client-bundle'),
    import('@vesk/runtime/src/action'),
    import('@vesk/compiler/src/config'),
    import('@vesk/runtime/src/index-server'),
  ]);
  devMods = {
    ...sc, ...ar, ...mw, ...cg, ...ru, ...store, ...util, ...cb, ...act, ...cfg,
    runtimeServer: rt,
  };
  return devMods;
}

function resolveRuntimeDir(projectDir: string): string | null {
  const pkgDir = resolve(projectDir, 'node_modules', '@vesk/runtime');
  if (existsSync(join(pkgDir, 'ripple-runtime.js'))) return pkgDir;
  const distDir = join(pkgDir, 'dist');
  if (existsSync(join(distDir, 'ripple-runtime.js'))) return distDir;
  if (existsSync(join(runtimeDir, 'ripple-runtime.js'))) return runtimeDir;
  return null;
}

function loadEnvFiles(projectDir: string) {
  const files = [join(projectDir, '.env'), join(projectDir, '.env.local')];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      let key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function loadConfig(projectDir: string): Promise<Record<string, unknown>> {
  const { defineConfig, definePlugin, preset, validateConfig } = devMods;
  loadEnvFiles(projectDir);

  const jsPath = join(projectDir, 'vesk.config.js');
  const tsPath = join(projectDir, 'vesk.config.ts');
  let configPath: string | null = null;
  if (existsSync(jsPath)) configPath = jsPath;
  else if (existsSync(tsPath)) configPath = tsPath;

  if (!configPath) return {};

  let raw: unknown;
  if (configPath.endsWith('.ts')) {
    const { transpile } = await import('typescript');
    const src = readFileSync(configPath, 'utf-8');
    let js = transpile(src, { module: 99, target: 99 });
    js = js.replace(/import\s+\{[^}]*\}\s*from\s+['"]@vesk\/compiler['"]\s*;?\s*/g, '');
    js = `const { defineConfig, definePlugin, preset } = globalThis.__vesk_inject;\n` + js;
    const tmpFile = join(projectDir, '.vesk', 'config.tmp.js');
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, js, 'utf-8');
    (globalThis as Record<string, unknown>).__vesk_inject = { defineConfig, definePlugin, preset };

    raw = (await import(tmpFile)).default;
    delete (globalThis as Record<string, unknown>).__vesk_inject;
  } else {
    raw = (await import(configPath)).default;
  }

  const config = (typeof defineConfig === 'function' ? defineConfig(raw) : raw) as Record<string, unknown>;
  if (typeof validateConfig === 'function') validateConfig(config);

  const sec = config.security;
  if (sec !== undefined && sec !== false && typeof sec === 'object' && (sec as Record<string, unknown>).redactLogs !== false) {
    try { devMods.setRedactLogging(true); } catch {}
  }

  return config;
}

const TAILWIND_BLOCK = /^\s*@(theme\s*\{|layer\s+(components|utilities)\s*\{|utility\s+\w+\s*\{)/;

function stripTailwindDirectives(css: string): string {
  const lines = css.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("@import 'tailwindcss'") || line.startsWith('@import "tailwindcss"')) {
      i++;
      continue;
    }
    if (line.startsWith('@source ')) {
      i++;
      continue;
    }
    if (TAILWIND_BLOCK.test(line)) {
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      i++;
      while (i < lines.length && braceCount > 0) {
        braceCount += (lines[i].match(/\{/g) || []).length;
        braceCount -= (lines[i].match(/\}/g) || []).length;
        i++;
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n').trim();
}

function relaxCspForDev(sec: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!sec || sec.contentSecurityPolicy === false || sec.contentSecurityPolicy === 'off') return sec;
  let csp = sec.contentSecurityPolicy;
  if (csp === true) {
    csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
  }
  if (typeof csp === 'string' && csp.includes("script-src 'self'")) {
    csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
  }
  return { ...sec, contentSecurityPolicy: csp };
}

function countPages(nodes: any[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.page) n++;
    if (node.children.length > 0) n += countPages(node.children);
  }
  return n;
}

function collectRoutePaths(nodes: any[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.page && node.fullPath) out.push(node.fullPath);
    if (node.children.length > 0) collectRoutePaths(node.children, out);
  }
  return out;
}

function countFilesNamed(dir: string, name: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countFilesNamed(p, name);
    else if (entry.name === name) n++;
  }
  return n;
}

function buildRequestContext(req: any): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(', ') : (v === undefined || v === null ? '' : String(v));
  }
  const cookies: Record<string, string> = {};
  const raw = headers.cookie || '';
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) cookies[k] = v;
  }
  return { headers, url: req.url, method: req.method || 'GET', cookies, locals: {}, ip: undefined };
}

function makeWebRequest(req: any, url: URL): Request & { json(): Promise<unknown>; text(): Promise<string>; formData(): Promise<FormData> } {
  const parsedUrl = new URL(url.href);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(', ') : (v === undefined || v === null ? '' : String(v));
  }
  const webRequest = new Request(parsedUrl, {
    method: req.method || 'GET',
    headers,
    body: req.__bodyBuffer && (req.__bodyBuffer as Buffer).length > 0 ? (req.__bodyBuffer as Buffer) : null,
  }) as Request & { json(): Promise<unknown>; text(): Promise<string>; formData(): Promise<FormData> };
  return webRequest;
}

function extractCompName(src: string): string | null {
  return devMods.resolveComponentName(src);
}

function securityMeta(security?: Record<string, unknown>): string {
  if (!security) return '';
  let meta = '';
  if (security.referrerPolicy !== false) meta += `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
  if (security.contentSecurityPolicy !== false) meta += `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
  if (security.autoEscape !== false) meta += '\t<!-- vesk: auto-escape enabled -->\n';
  return meta;
}

function storeDataScript(payload: SsrDataPayload): string | null {
  if (!payload.props && !payload.ssrData) return null;
  const store = devState.ssrDataStore as Map<string, SsrDataPayload>;
  if (store.size >= 100) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest) store.delete(oldest);
  }
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set(token, payload);
  return '/_vesk/ssr-data.js?t=' + token;
}

function prodStoreDataScript(payload: SsrDataPayload): string | null {
  if (!payload.props && !payload.ssrData) return null;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const store = (globalThis as Record<string, Record<string, SsrDataPayload>>).__vsk_ssr_data_store ||= {};
  store[token] = payload;
  const keys = Object.keys(store);
  if (keys.length > 100) {
    for (let i = 0; i < keys.length - 100; i++) delete store[keys[i]];
  }
  return '/ssr-data.js?t=' + token;
}

function chainForPath(routeTree: any[], pathname: string): any[] {
  const match = devMods.matchUrl(routeTree, pathname);
  if (!match) return [];
  const urlParts = pathname.split('/').filter(Boolean);
  const chain: any[] = [];
  let segIdx = 0;
  for (const node of match.nodes) {
    if (node.fullPath === '/') {
      chain.push(node);
    } else if (!node.isGroup && (node.segmentCount as number) > 0) {
      if (segIdx < urlParts.length) {
        chain.push(node);
        segIdx++;
      }
    } else {
      chain.push(node);
    }
  }
  return chain;
}

function pageSourcesFor(appDirPath: string, routeTree: any[]): string[] {
  const out: string[] = [];
  function walk(nodes: any[]): void {
    for (const node of nodes) {
      if (node.page) out.push(resolve(appDirPath, node.sourceDir as string, 'page.vsk'));
      if (node.layout) out.push(resolve(appDirPath, node.sourceDir as string, 'layout.vsk'));
      walk(node.children);
    }
  }
  walk(routeTree);
  return out;
}

function walkVskFiles(dir: string, out: string[], seen: Set<string>): void {
  if (!existsSync(dir)) return;
  let entries: any[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (seen.has(full)) continue;
    seen.add(full);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vesk') continue;
      walkVskFiles(full, out, seen);
    } else if (entry.isFile() && entry.name.endsWith('.vsk')) {
      out.push(full);
    }
  }
}

function candidateSources(appDirPath: string, routeTree: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of pageSourcesFor(appDirPath, routeTree)) {
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  const projectRoot = resolve(appDirPath, '..');
  for (const dir of [resolve(projectRoot, 'components'), appDirPath, projectRoot]) {
    walkVskFiles(dir, out, seen);
  }
  return out;
}

function registerSource(sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  try {
    devMods.compileFile(readFileSync(sourcePath, 'utf-8'), { sourcePath });
  } catch {
    // ignore compile errors while probing for the action owner
  }
}

function ensureActionRegistered(actionId: string, pagePathname: string, appDirPath: string, routeTree: any[]): void {
  if (devMods.getAction(actionId)) return;
  const match = devMods.matchUrl(routeTree, pagePathname);
  if (match) {
    for (let i = match.nodes.length - 1; i >= 0; i--) {
      registerSource(resolve(appDirPath, match.nodes[i].sourceDir as string, 'page.vsk'));
      registerSource(resolve(appDirPath, match.nodes[i].sourceDir as string, 'layout.vsk'));
    }
  }
  if (devMods.getAction(actionId)) return;
  for (const sourcePath of candidateSources(appDirPath, routeTree)) {
    if (devMods.getAction(actionId)) break;
    registerSource(sourcePath);
  }
}

async function renderPageHtml(pagePathname: string, params: Record<string, string>): Promise<string | null> {
  const { appDirPath, routeTree, security } = devState;
  const chain = chainForPath(routeTree, pagePathname);
  if (chain.length === 0) return null;

  let body = '';
  let head = '';
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
    const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

    if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
      const src = readFileSync(pageFilePath, 'utf-8');
      const compName = extractCompName(src) || (node.page as string);
      const result = await devMods.renderPage(src, compName, { params }, new Map(), { hydrate: true, sourcePath: pageFilePath });
      body = result.body;
      head = result.head || '';
    }

    if (node.layout && existsSync(layoutFilePath)) {
      const src = readFileSync(layoutFilePath, 'utf-8');
      const compName = extractCompName(src) || (node.layout as string);
      const result = await devMods.renderPage(src, compName, { children: body }, new Map(), { hydrate: true, sourcePath: layoutFilePath });
      body = result.body;
      head = (result.head || '') + head;
    }
  }

  const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));
  if (hasLayout) {
    const secMeta = securityMeta(security);
    return `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${devMods.prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
  }

  const leaf = chain.find(n => n.page);
  if (!leaf) return null;
  const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
  const compName = extractCompName(src) || (leaf.page as string);
  const html = await devMods.renderFullPage(src, compName, { params }, new Map(), {
    hydrate: true,
    clientScriptUrl: '/_vesk/client.js',
    cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
    security,
    externalDataScript: storeDataScript,
    sourcePath: resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'),
  });
  return html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
}

async function handleDevAction(req: any, url: URL, bodyBuffer: Buffer): Promise<DevResponse> {
  const { appDirPath, routeTree, security } = devState;
  if (!url.pathname.startsWith('/_vesk/action/')) return null as any;

  const actionId = url.pathname.replace('/_vesk/action/', '');

  const webRequest = makeWebRequest({ ...req, __bodyBuffer: bodyBuffer }, url);

  const referer = String(req.headers.referer || '');
  let refererUrl: URL | null = null;
  try {
    if (referer) refererUrl = new URL(referer);
  } catch {
    refererUrl = null;
  }
  const pagePathname = refererUrl ? refererUrl.pathname : '/';

  ensureActionRegistered(actionId, pagePathname, appDirPath, routeTree);

  const action = devMods.getAction(actionId);
  if (!action) {
    return { status: 404, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: 'Action not found' })).toString('base64') };
  }

  let input: Record<string, unknown> = {};
  const ct = webRequest.headers.get('content-type') || '';
  if (ct.includes('json')) {
    input = await webRequest.json().catch(() => ({}));
  } else if (ct.includes('multipart/form-data') || ct.includes('x-www-form-urlencoded')) {
    const fd = await webRequest.formData().catch(() => null);
    if (fd) input = Object.fromEntries(fd.entries());
  } else {
    const text = await webRequest.text().catch(() => '');
    if (text) {
      try { input = JSON.parse(text); } catch { /* ignore */ }
    }
  }

  const issues = devMods.validateActionInput(action, input);
  const isFetch = !(req.headers.accept || '').includes('text/html');
  const match = devMods.matchUrl(routeTree, pagePathname);
  const params = match ? match.params : {};

  if (issues.length > 0) {
    if (isFetch) {
      return { status: 200, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, issues })).toString('base64') };
    }
    const prevReq = (globalThis as Record<string, unknown>).__vesk_request;
    (globalThis as Record<string, unknown>).__vesk_action_errors = devMods.issuesToFieldMap(issues);
    try {
      const html = await renderPageHtml(pagePathname, params);
      if (html === null) {
        return { status: 500, headers: [['Content-Type', 'text/plain']], bodyB64: Buffer.from('Action validation failed and the referer page could not be rendered').toString('base64') };
      }
      return { status: 200, headers: [['Content-Type', 'text/html']], bodyB64: Buffer.from(html).toString('base64') };
    } finally {
      (globalThis as Record<string, unknown>).__vesk_action_errors = undefined;
      (globalThis as Record<string, unknown>).__vesk_request = prevReq;
    }
  }

  const actionUrl = new URL(url.href);
  const prevReq = (globalThis as Record<string, unknown>).__vesk_request;
  (globalThis as Record<string, unknown>).__vesk_request = {
    request: webRequest,
    params,
    url: actionUrl,
    locals: {},
    cookies: devMods.parseCookies(String(req.headers.cookie || '')),
  };
  try {
    const result = await action.execute(input, {
      request: webRequest,
      params,
      url: actionUrl.href,
      headers: () => {
        const m = new Map<string, string>();
        for (const [k, v] of webRequest.headers.entries()) m.set(k.toLowerCase(), String(v));
        return m;
      },
      cookies: () => devMods.parseCookies(String(req.headers.cookie || '')),
      locals: () => {
        const cur = (globalThis as Record<string, unknown>).__vesk_request as { locals?: Record<string, unknown> } | undefined;
        return cur && cur.locals ? cur.locals : {};
      },
      redirect: (u: string, status?: number) => new Response(null, { status: status || 303, headers: { Location: u } }),
    });
    if (isFetch) {
      return { status: 200, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: true, data: result ?? null })).toString('base64') };
    }
    const location = pagePathname + (refererUrl ? refererUrl.search : '');
    return { status: 303, headers: [['Location', location]], bodyB64: '' };
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Action failed';
    if (isFetch) {
      return { status: 500, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: message })).toString('base64') };
    }
    return { status: 500, headers: [['Content-Type', 'text/plain']], bodyB64: Buffer.from(message).toString('base64') };
  } finally {
    (globalThis as Record<string, unknown>).__vesk_request = prevReq;
  }
}

async function handleDevApi(req: any, url: URL, bodyBuffer: Buffer): Promise<DevResponse | null> {
  const { appDirPath, routeTree } = devState;
  if (!url.pathname.startsWith('/api')) return null;

  const apiDirPath = join(appDirPath, 'api');
  if (!existsSync(apiDirPath)) return null;

  const mwChain = devMods.collectMiddlewareChain(routeTree, url.pathname, appDirPath);
  const apiRoutes = await devMods.scanApiRoutes(apiDirPath);
  const apiMatch = devMods.matchApiUrl(apiRoutes, req.url || url.pathname);
  if (!apiMatch) return null;

  const requestUrl = req.url
    ? `http://localhost:${devState.port}${req.url.startsWith('/') ? req.url : '/' + req.url}`
    : url.href;

  let apiLocals: Record<string, unknown> = {};
  if (mwChain.length > 0) {
    const mwReq = new Request(requestUrl, { headers: req.headers as Record<string, string>, method: req.method || 'GET' });
    try {
      const mwResult = await devMods.executeMiddlewareChain(mwChain, mwReq, apiMatch.params, {
        plugins: (devState.config.plugins || []) as any[],
        onLast: async () => new Response(null),
      });
      apiLocals = mwResult.locals || {};
    } catch (e) {
      const err = e as Error & { name: string };
      if (err.name === 'NotFoundError') {
        return { status: 404, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ error: 'Not Found' })).toString('base64') };
      }
      throw e;
    }
  }

  const webRequest = devMods.buildWebRequest(req, req.url || url.pathname, bodyBuffer.length ? bodyBuffer : null);
  const response = await devMods.executeApiRoute(
    apiMatch.node.filePath!,
    (req.method || 'GET').toUpperCase(),
    webRequest,
    apiMatch.params,
    apiLocals,
    devState.apiWatchCache,
  );
  if (!response) {
    return { status: 500, headers: [['Content-Type', 'text/plain']], bodyB64: Buffer.from('API route returned no response').toString('base64') };
  }
  const body = await response.text();
  const headers: [string, string][] = [];
  for (const [k, v] of response.headers.entries()) headers.push([k, v]);
  return { status: response.status, headers, bodyB64: Buffer.from(body).toString('base64') };
}

async function handleDevSsr(req: any, url: URL): Promise<DevResponse> {
  const { routeTree, appDirPath, security, config, port } = devState;
  const forData = req.headers['x-vesk-data'] === '1';

  const match = devMods.matchUrl(routeTree, url.pathname);

  const rawCtx = buildRequestContext(req);
  if (security?.trustProxy) {
    devMods.applyTrustProxy(rawCtx, security.trustProxy as boolean | string);
  }
  if (req.__clientIp && !rawCtx.ip) rawCtx.ip = req.__clientIp;
  const ctx = rawCtx;

  async function renderSSR(): Promise<{ html: string; props?: Record<string, unknown>; head?: string }> {
    return devMods.withSsrStore(async () => {
      const chain = cleanChain;
      let body = '';
      let head = '';
      let props: Record<string, unknown> | undefined;

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
        const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

        if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
          const src = readFileSync(pageFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.page as string);
          const result = await devMods.renderPage(src, compName, { params: match.params }, new Map(), { hydrate: true, sourcePath: pageFilePath });
          body = result.body;
          head = result.head || '';
          props = result.props;
        }

        if (node.layout && existsSync(layoutFilePath)) {
          const src = readFileSync(layoutFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.layout as string);
          const result = await devMods.renderPage(src, compName, { children: body }, new Map(), { hydrate: true, sourcePath: layoutFilePath });
          body = result.body;
          head = (result.head || '') + head;
        }
      }

      if (forData) {
        return { html: '', props: props || { params: match.params }, head };
      }

      const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));
      let html: string;
      if (hasLayout) {
        const ssrData = devMods.ssrSink.snapshot();
        const dataScripts = devMods.buildDataScripts(props, ssrData || {}, storeDataScript);
        const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';
        let secMeta = '';
        if (security) {
          if (security.referrerPolicy !== false) secMeta += `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
          if (security.contentSecurityPolicy !== false) secMeta += `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
          if (security.autoEscape !== false) secMeta += '\t<!-- vesk: auto-escape enabled -->\n';
        }
        html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${devMods.prettifyHtml(body)}\n</div>${dataScriptBlock}\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
      } else {
        const leaf = chain.find(n => n.page);
        if (leaf) {
          const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
          const compName = extractCompName(src) || (leaf.page as string);
          html = await devMods.renderFullPage(src, compName, { params: match.params }, new Map(), {
            hydrate: true,
            clientScriptUrl: '/_vesk/client.js',
            cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
            security,
            externalDataScript: storeDataScript,
            sourcePath: resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'),
          });
          html = html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } else {
          throw new Error('No page or layout matched');
        }
      }
      return { html, props: props || { params: match.params }, head };
    });
  }

  if (!match) {
    const rootNode = routeTree.find((n: any) => (n.fullPath as string) === '/');
    let notFoundHtml: string | null = null;
    if (rootNode && rootNode.notFound) {
      const nfPath = resolve(appDirPath, rootNode.sourceDir as string, 'not-found.vsk');
      if (existsSync(nfPath)) {
        try {
          const nfSrc = readFileSync(nfPath, 'utf-8');
          const nfCompName = extractCompName(nfSrc) || (rootNode.notFound as string);
          notFoundHtml = await devMods.renderFullPage(nfSrc, nfCompName, { params: {}, url: url.pathname }, new Map(), {
            hydrate: true,
            cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
            security,
            externalDataScript: storeDataScript,
            sourcePath: nfPath,
          });
          notFoundHtml = notFoundHtml.replace('</body>', '\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } catch {}
      }
    }
    return {
      status: 404,
      headers: [['Content-Type', 'text/html']],
      bodyB64: Buffer.from(notFoundHtml || `<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`).toString('base64'),
    };
  }

  const urlParts = url.pathname.split('/').filter(Boolean);
  const cleanChain: any[] = [];
  let segIdx = 0;
  for (const node of match.nodes) {
    if (node.fullPath === '/') {
      cleanChain.push(node);
    } else if (!node.isGroup && (node.segmentCount as number) > 0) {
      if (segIdx < urlParts.length) {
        cleanChain.push(node);
        segIdx++;
      }
    } else {
      cleanChain.push(node);
    }
  }

  const mwChain = devMods.collectMiddlewareChain(routeTree, url.pathname, appDirPath);

  const toDevResponse = (status: number, headers: Record<string, string>, body: string): DevResponse => {
    const h: [string, string][] = Object.entries(headers);
    if (security) {
      const secHeaders = devMods.securityHeaders({ security }) as Record<string, string>;
      for (const [k, v] of Object.entries(secHeaders)) h.push([k, v]);
    }
    return { status, headers: h, bodyB64: Buffer.from(body).toString('base64') };
  };

  try {
    if (mwChain.length > 0) {
      const mwReq = new Request(`http://localhost:${port}${url.pathname}${url.search}`, {
        headers: req.headers as Record<string, string>,
        method: req.method || 'GET',
      });
      const mwResult = await devMods.executeMiddlewareChain(mwChain, mwReq, match.params, {
        plugins: (config.plugins || []) as any[],
        onLast: async (rewrite: string | null) => {
          if (rewrite) url.pathname = rewrite;
          const prev = (globalThis as Record<string, unknown>).__vesk_request;
          (globalThis as Record<string, unknown>).__vesk_request = ctx;
          try {
            try {
              const rendered = await renderSSR();
              if (forData) {
                return new Response(JSON.stringify({ path: url.pathname, params: match.params, props: rendered.props, head: rendered.head }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'x-vesk-data' } });
              }
              return new Response(rendered.html, { headers: { 'Content-Type': 'text/html' } });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (forData) {
                const code = errorStatusCode(e);
                return new Response(JSON.stringify({ error: msg, statusCode: code }), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'x-vesk-data' } });
              }
              throw e;
            }
          } finally {
            (globalThis as Record<string, unknown>).__vesk_request = prev;
          }
        },
      });
      if (mwResult.response) {
        const body = await mwResult.response.text();
        const headers: [string, string][] = [];
        for (const [k, v] of mwResult.response.headers.entries()) headers.push([k, v]);
        if (security) {
          const secHeaders = devMods.securityHeaders({ security }) as Record<string, string>;
          for (const [k, v] of Object.entries(secHeaders)) headers.push([k, v]);
        }
        return { status: mwResult.response.status, headers, bodyB64: Buffer.from(body).toString('base64') };
      }
      return { status: 204, headers: [], bodyB64: '' };
    } else {
      const prev = (globalThis as Record<string, unknown>).__vesk_request;
      (globalThis as Record<string, unknown>).__vesk_request = ctx;
      try {
        if (forData) {
          try {
            const rendered = await renderSSR();
            return toDevResponse(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'x-vesk-data' }, JSON.stringify({ path: url.pathname, params: match.params, props: rendered.props, head: rendered.head }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toDevResponse(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'x-vesk-data' }, JSON.stringify({ error: msg }));
          }
        }
        const rendered = await renderSSR();
        return toDevResponse(200, { 'Content-Type': 'text/html; charset=utf-8' }, rendered.html);
      } finally {
        (globalThis as Record<string, unknown>).__vesk_request = prev;
      }
    }
  } catch (e) {
    const err = e as Error & { name: string; status?: number; url?: string; stack?: string };
    if (err.name === 'Redirect') {
      const status = err.status || 302;
      return { status, headers: [['Location', String(err.url)]], bodyB64: Buffer.from(`<!DOCTYPE html><html><body><a href="${err.url}">Redirect</a></body></html>`).toString('base64') };
    }
    if (err.name === 'NotFoundError') {
      let notFoundHtml: string | null = null;
      if (match && match.nodes) {
        for (let i = match.nodes.length - 1; i >= 0; i--) {
          const node = match.nodes[i];
          if (node.notFound) {
            const nfPath = resolve(appDirPath, node.sourceDir as string, 'not-found.vsk');
            if (existsSync(nfPath)) {
              try {
                const nfSrc = readFileSync(nfPath, 'utf-8');
                const nfCompName = extractCompName(nfSrc) || (node.notFound as string);
                const html = await devMods.renderFullPage(nfSrc, nfCompName, { params: match.params, url: url.pathname }, new Map(), {
                  hydrate: true,
                  cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
                  security,
                  externalDataScript: storeDataScript,
                  sourcePath: nfPath,
                });
                notFoundHtml = html.replace('</body>', '\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
              } catch {}
            }
            break;
          }
        }
      }
      return { status: 404, headers: [['Content-Type', 'text/html']], bodyB64: Buffer.from(notFoundHtml || '<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>').toString('base64') };
    }
    let errorHtml: string | null = null;
    if (match && match.nodes) {
      for (let i = match.nodes.length - 1; i >= 0; i--) {
        const node = match.nodes[i];
        if (node.error) {
          const errPath = resolve(appDirPath, node.sourceDir as string, 'error.vsk');
          if (existsSync(errPath)) {
            try {
              const errSrc = readFileSync(errPath, 'utf-8');
              const errCompName = extractCompName(errSrc) || (node.error as string);
              const errProps = { error: err.message, stack: err.stack, statusCode: errorStatusCode(err), url: url.pathname };
              const html = await devMods.renderFullPage(errSrc, errCompName, errProps, new Map(), {
                hydrate: true,
                cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
                security,
                externalDataScript: storeDataScript,
                sourcePath: errPath,
              });
              errorHtml = html.replace('</body>', '\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
            } catch {}
          }
          break;
        }
      }
    }
    const message = err.message || String(e);
    const stack = err.stack || '';
    const errCode = errorStatusCode(err);
    return {
      status: errCode,
      headers: [['Content-Type', 'text/html']],
      bodyB64: Buffer.from(errorHtml || `<!DOCTYPE html><html><body><h1>${errCode}</h1><pre>${message}\n${stack}</pre></body></html>`).toString('base64'),
    };
  }
}

async function handleDevRequest(p: DevRequest): Promise<DevResponse> {
  const state = devState;
  if (!state) {
    return { status: 500, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ error: 'dev server not initialized' })).toString('base64') };
  }

  const url = new URL(p.url, `http://localhost:${p.port || state.port}`);
  const bodyBuffer = p.bodyB64 ? Buffer.from(p.bodyB64, 'base64') : Buffer.alloc(0);

  const reqHost = p.headers.host || `localhost:${p.port || state.port}`;
  const reqOrigin = p.headers.origin || '';
  const corsAllowed = devMods.corsHeaders(state.security || {}, reqOrigin, reqHost) as Record<string, string>;
  if (corsAllowed['Access-Control-Allow-Origin'] && p.method === 'OPTIONS') {
    const headers: [string, string][] = Object.entries({ ...corsAllowed, 'Content-Length': '0' });
    return { status: 204, headers, bodyB64: '' };
  }

  (globalThis as Record<string, unknown>).__vesk_ssr_base_url = `http://127.0.0.1:${p.port || state.port}`;

  const req: any = {
    method: p.method,
    url: url.pathname + url.search,
    headers: p.headers,
    socket: { remoteAddress: p.clientIp || '127.0.0.1' },
    __bodyBuffer: bodyBuffer,
    __clientIp: p.clientIp,
  };

  const withCors = (resp: DevResponse): DevResponse => {
    if (!corsAllowed || Object.keys(corsAllowed).length === 0) return resp;
    const seen = new Set(resp.headers.map(([k]) => k.toLowerCase()));
    for (const [k, v] of Object.entries(corsAllowed)) {
      if (!seen.has(k.toLowerCase())) resp.headers.push([k, v]);
    }
    return resp;
  };

  if (url.pathname === '/_vesk/ssr-data.js') {
    const token = url.searchParams.get('t') || '';
    const payload = state.ssrDataStore.get(token);
    if (payload) state.ssrDataStore.delete(token);
    const lines: string[] = [];
    if (payload?.props) lines.push(`globalThis.__vesk_props = ${JSON.stringify(payload.props)};`);
    if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${JSON.stringify(payload.ssrData)};`);
    return withCors({ status: 200, headers: [['Content-Type', 'application/javascript'], ['Cache-Control', 'no-store']], bodyB64: Buffer.from(lines.join('\n') || '// no ssr data').toString('base64') });
  }

  if (url.pathname.startsWith('/_vesk/action/')) {
    return withCors(await handleDevAction(req, url, bodyBuffer));
  }

  const apiResp = await handleDevApi(req, url, bodyBuffer);
  if (apiResp) return withCors(apiResp);

  return withCors(await handleDevSsr(req, url));
}

function updateSourceMapping(): void {
  const { routeTree, sourceToComponents } = devState;
  sourceToComponents.clear();
  for (const [compName, sourcePath] of devMods.collectSources(routeTree)) {
    const existing = sourceToComponents.get(sourcePath) || [];
    existing.push(compName);
    sourceToComponents.set(sourcePath, existing);
  }
}

function readRawCss(projectDir: string): { raw: string; cssPath: string } {
  const cssPath = join(projectDir, 'src', 'global.css');
  const altCssPath = join(projectDir, 'src', 'app.css');
  if (existsSync(cssPath)) return { raw: readFileSync(cssPath, 'utf-8'), cssPath };
  if (existsSync(altCssPath)) return { raw: readFileSync(altCssPath, 'utf-8'), cssPath: altCssPath };
  return { raw: '', cssPath: cssPath };
}

async function rebuildTailwindCss(): Promise<boolean> {
  const { rawCss, cssPath, plugins } = devState;
  if (!rawCss) {
    devState.cssGlobal = '';
    devState.cssTailwind = '';
    return false;
  }
  try {
    let nextGlobal = stripTailwindDirectives(rawCss);
    let nextTailwind = rawCss;
    for (const plugin of plugins) {
      if (typeof plugin.onCSS === 'function') {
        const result = await plugin.onCSS(rawCss, cssPath);
        if (result !== null && typeof result === 'string') {
          nextTailwind = result;
        }
      }
    }
    if (nextGlobal === nextTailwind || nextGlobal === rawCss) {
      nextTailwind = nextGlobal;
    }
    const changed = nextGlobal !== devState.lastCssGlobal || nextTailwind !== devState.lastCssTailwind;
    devState.cssGlobal = nextGlobal;
    devState.cssTailwind = nextTailwind;
    devState.lastCssGlobal = nextGlobal;
    devState.lastCssTailwind = nextTailwind;
    return changed;
  } catch (e) {
    console.error('sidecar: CSS rebuild error:', e);
    return false;
  }
}

/**
 * Names the current main bundle imports from /_vesk/runtime.js. The dev
 * runtime must be tree-shaken with exactly this set: bundling the full
 * export surface reorders/re-shapes runtime internals and breaks hydration
 * in ways the used-name bundle does not.
 */
function runtimeImportNamesFrom(clientJs: string): string[] | null {
  const m = clientJs.match(/^import\s*\{([^}]*)\}\s*from\s*['"]\/_vesk\/runtime\.js['"];?\s*$/m);
  if (!m) return null;
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? names : null;
}

async function bundleRuntime(): Promise<void> {
  const { runtimeDir } = devState;
  try {
    const used = runtimeImportNamesFrom(devState.clientBundle || '')
      ?? [...devMods.runtimeExportNames(runtimeDir)].filter((n): n is string => !!n);
    devState.runtimeBundle = await devMods.buildTreeShakenRuntime(runtimeDir, used);
  } catch (e) {
    console.error('sidecar: runtime bundle error:', (e as Error).message);
  }
}

async function buildClientBundle(): Promise<void> {
  const { routeTree, appDirPath, config } = devState;
  const opts: Record<string, unknown> = { importRuntime: true, hmr: true, codeSplit: true, cache: devState.bundleCache };
  if (config.routeDataCache !== undefined) opts.routeDataCache = config.routeDataCache;
  const { main, chunks } = await devMods.generateClientBundle(routeTree, appDirPath, new Map(), opts);
  devState.clientBundle = main;
  const next = new Map<string, string>();
  for (const c of chunks) next.set(`/_vesk/static/${c.name}`, c.code);
  devState.clientChunks = next;
}

/**
 * Rebuilds only the route chunks (the main bundle is untouched — a broken
 * route must never blank or break the client app). On any compile error the
 * previous chunk map is kept and the error is reported so the dev overlay
 * shows it; the HMR fnSources path still hot-swaps the edited component.
 */
/**
 * Targeted hot-path chunk rebuild for the haul dev server: stat-checks only
 * the edited file, reuses every other cached file without filesystem access,
 * and returns the stripped component source so the HMR update message needs
 * no second compileClient pass.
 */
async function buildClientChunks(fullPath: string): Promise<{ err: Error | null; editedSource: string | null; actualName: string | null }> {
  const { routeTree, appDirPath } = devState;
  try {
    const { chunks, editedSources, editedNames } = await devMods.generateClientBundle(routeTree, appDirPath, new Map(), {
      importRuntime: true,
      hmr: true,
      codeSplit: true,
      cache: devState.bundleCache,
      only: [fullPath],
      returnEditedSources: true,
    });
    const next = new Map<string, string>();
    for (const c of chunks) next.set(`/_vesk/static/${c.name}`, c.code);
    devState.clientChunks = next;
    return { err: null, editedSource: editedSources?.get(fullPath) ?? null, actualName: editedNames?.get(fullPath) ?? null };
  } catch (e) {
    return { err: e as Error, editedSource: null, actualName: null };
  }
}

function hmrClientJs(): string {
  const candidates = [
    join(devState.runtimeDir, 'hmr-client.js'),
    join(devState.runtimeDir, 'hmr-client.ts'),
    join(runtimeDir, 'hmr-client.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return '// hmr client unavailable';
}

function richErrorPayload(err: any, fullPath: string, errorMessage: string): Record<string, unknown> {
  let line = 0, col = 0, file = '';
  const suggestions: string[] = [];
  const nextSteps: string[] = [];
  let tip = '';
  const errDetails = err as Record<string, unknown> | undefined;
  if (errDetails?.name === 'VeskError') {
    line = (errDetails.line as number) || 0;
    col = (errDetails.column as number) || 0;
    file = (errDetails.file as string) || fullPath.replace(devState.projectDir, '').replace(/^\//, '') || basename(fullPath) || '';
    if (errDetails.suggestions) suggestions.push(...(errDetails.suggestions as string[]));
    if (errDetails.nextSteps) nextSteps.push(...(errDetails.nextSteps as string[]));
    tip = (errDetails.tip as string) || '';
  } else {
    const lineMatch = errorMessage.match(/(?:line|at\s+line)\s*(\d+)/i);
    const colMatch = errorMessage.match(/(?:column|col)\s*(\d+)/i);
    line = lineMatch ? parseInt(lineMatch[1]) : 0;
    col = colMatch ? parseInt(colMatch[1]) : 0;
    file = fullPath.replace(devState.projectDir, '').replace(/^\//, '') || basename(fullPath) || '';
  }
  let code = '';
  if (line > 0 && existsSync(fullPath)) {
    try {
      const src = readFileSync(fullPath, 'utf-8');
      const lines = src.split('\n');
      const start = Math.max(0, line - 3);
      const end = Math.min(lines.length, line + 2);
      code = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    } catch {}
  }
  const tips: string[] = [];
  if (tip) tips.push(tip);
  if (errorMessage.toLowerCase().includes('unexpected token')) tips.push('Check for missing or extra brackets, parentheses, or quotes.');
  if (errorMessage.toLowerCase().includes('unexpected identifier')) tips.push('A keyword or identifier is in an unexpected position.');
  if (errorMessage.toLowerCase().includes('expected')) tips.push('Check the syntax around the reported line.');
  if (errorMessage.toLowerCase().includes('not defined') || errorMessage.toLowerCase().includes('is not defined')) tips.push('The variable or component may not be imported or declared.');
  if (errorMessage.toLowerCase().includes('invalid')) tips.push('Check the expression syntax.');
  if (errorMessage.toLowerCase().includes('component') && errorMessage.toLowerCase().includes('not')) tips.push('Ensure the component is properly defined.');
  if (nextSteps.length) tips.push(...nextSteps);
  if (tips.length === 0) tips.push('Review the code around the reported line.');
  return { type: 'error', message: errorMessage, file, line, column: col, code, stack: err?.stack || '', tips, suggestions, nextSteps };
}

async function devInit(params: any): Promise<any> {
  await loadDevModules();
  const { appDir, projectDir, publicDir, port } = params;

  devMods.setRuntimeModule(devMods.runtimeServer);

  const config = await loadConfig(projectDir);
  const plugins = config.plugins || [];
  const security = relaxCspForDev(config.security as Record<string, unknown> | undefined);

  let rateLimiter: any = null;
  if (security?.rateLimit) {
    const rlConfig = security.rateLimit as Record<string, unknown>;
    rateLimiter = devMods.createRateLimiter({ windowMs: (rlConfig.windowMs as number) || 60000, max: (rlConfig.max as number) || 100 });
  }

  const { raw, cssPath } = readRawCss(projectDir);

  devState = {
    appDirPath: appDir,
    projectDir,
    publicDir,
    port,
    config,
    plugins,
    security,
    rateLimiter,
    rawCss: raw,
    cssPath,
    routeTree: [],
    clientBundle: '',
    clientChunks: new Map<string, string>(),
    runtimeBundle: '',
    hmrClientJs: '',
    cssGlobal: '',
    cssTailwind: '',
    lastCssGlobal: '',
    lastCssTailwind: '',
    sourceToComponents: new Map<string, string[]>(),
    apiWatchCache: new Map<string, number>(),
    ssrDataStore: new Map<string, SsrDataPayload>(),
    runtimeDir: resolveRuntimeDir(projectDir) || runtimeDir,
    bundleCache: { files: new Map() },
  };

  devState.routeTree = devMods.scanRoutes(appDir);
  updateSourceMapping();

  await rebuildTailwindCss();
  await buildClientBundle();
  await bundleRuntime();
  devState.hmrClientJs = hmrClientJs();

  const apiCount = countFilesNamed(join(appDir, 'api'), 'route.ts');
  return {
    ok: true,
    routes: collectRoutePaths(devState.routeTree),
    pageCount: countPages(devState.routeTree),
    apiCount,
    runtimeBundle: devState.runtimeBundle,
    clientBundle: devState.clientBundle,
    clientChunks: Object.fromEntries(devState.clientChunks),
    hmrClientJs: devState.hmrClientJs,
    cssGlobal: devState.cssGlobal,
    cssTailwind: devState.cssTailwind,
    rateLimit: security?.rateLimit || null,
  };
}

async function devRebuild(params: any): Promise<any> {
  const state = devState;
  if (!state) return { messages: [] };

  const fullPath: string = params.filePath || '';
  const filename = basename(fullPath);
  const fileExists = existsSync(fullPath);
  const messages: Record<string, unknown>[] = [];
  const assets: Record<string, unknown> = {};

  // Snapshot previous assets so the RPC reply can carry a diff instead of
  // the full bundle on every keystroke.
  const prevClientBundle: string = state.clientBundle || '';
  const prevChunks: Map<string, string> = state.clientChunks instanceof Map ? state.clientChunks : new Map();

  const collectAssetDiff = (): { clientBundleChanged: boolean; removedChunkNames: string[] } => {
    const patched: Record<string, string> = {};
    for (const [name, code] of state.clientChunks instanceof Map ? state.clientChunks : []) {
      if (prevChunks.get(name) !== code) patched[name] = code;
    }
    const removedChunkNames: string[] = [];
    for (const name of prevChunks.keys()) {
      if (!(state.clientChunks as Map<string, string>).has(name)) removedChunkNames.push(name);
    }
    const clientBundleChanged = (state.clientBundle || '') !== prevClientBundle;
    if (clientBundleChanged) assets.clientBundle = state.clientBundle;
    assets.clientChunks = patched;
    return { clientBundleChanged, removedChunkNames };
  };

  const isApiFile = /\/api\//.test(fullPath.replace(/\\/g, '/')) && (filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.tsx'));

  if (filename.endsWith('.vsk')) {
    const t0 = Date.now();
    try {
      const stripAnnots = (t: unknown): string =>
        JSON.stringify(t, (k, v) => (k === 'chunk' || k === 'chunkError') ? undefined : v);
      const prevTree = stripAnnots(state.routeTree);
      state.routeTree = devMods.scanRoutes(state.appDirPath);
      updateSourceMapping();
      const changedComponents = state.sourceToComponents.get(fullPath) || [];
      const treeChanged = prevTree !== stripAnnots(state.routeTree);

      // CSS rescan runs concurrently with the JS build: a .vsk edit cannot
      // change src/global.css, so there is no ordering dependency, and the
      // reply no longer waits for two serial compile passes.
      const cssPromise = rebuildTailwindCss();

      let bundleError: Error | null = null;
      let hotEditedSource: string | null = null;
      let hotActualName: string | null = null;
      if (treeChanged) {
        // Route structure changed: rebuild main bundle + chunks. A failure
        // here blanks the main bundle only transiently; the HMR overlay
        // surfaces it and the next successful edit restores it.
        try {
          await buildClientBundle();
          await bundleRuntime();
        } catch (e) {
          bundleError = e as Error;
        }
      } else {
        // Content-only change: targeted chunk rebuild (keeping the previous
        // chunk map on error) and leave the main bundle untouched, so a
        // broken route can never take the rest of the app down with it.
        const hot = await buildClientChunks(fullPath);
        bundleError = hot.err;
        hotEditedSource = hot.editedSource;
        hotActualName = hot.actualName;
      }

      if (changedComponents.length > 0) {
        let fnSources: Record<string, string> | undefined;
        let errorMessage = bundleError ? bundleError.message : '';
        if (!treeChanged && !bundleError && hotEditedSource !== null) {
          let compCode = hotEditedSource;
          for (const cname of changedComponents) {
            if (hotActualName && hotActualName !== cname) {
              compCode += `\nObject.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(hotActualName)}], configurable: true });\n`;
            }
          }
          if (compCode.trim()) fnSources = { _raw: compCode };
        } else if (fileExists && !bundleError) {
          try {
            const src = readFileSync(fullPath, 'utf-8');
            let compCode = devMods.compileClient(src, null, { forceClient: true });
            compCode = compCode.replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?\s*\n?/gm, '');
            compCode = compCode.replace(/^const __components = \{\};\s*\n?/m, '');
            compCode = compCode.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/m, '');
            compCode = compCode.replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, '');
            compCode = compCode.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
            const actualName = devMods.resolveComponentName(src);
            for (const cname of changedComponents) {
              if (actualName && actualName !== cname) {
                compCode += `\nObject.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });\n`;
              }
            }
            if (compCode.trim()) fnSources = { _raw: compCode };
          } catch (e) {
            errorMessage = (e as Error).message;
          }
        }
        if (fnSources) {          messages.push({
            type: 'update',
            time: Date.now() - t0,
            components: Object.fromEntries(changedComponents.map(name => [name, true])),
            fnSources,
          });
        } else if (errorMessage) {
          messages.push(richErrorPayload(bundleError || new Error(errorMessage), fullPath, errorMessage));
        } else {
          messages.push({ type: 'reload' });
        }
      } else {
        messages.push({ type: 'reload' });
      }

      const cssChanged = await cssPromise;
      if (cssChanged) messages.push({ type: 'css-update' });
      const { clientBundleChanged, removedChunkNames } = collectAssetDiff();
      if (cssChanged) {
        assets.cssGlobal = state.cssGlobal;
        assets.cssTailwind = state.cssTailwind;
      }
      return { messages, assets, clientBundleChanged, cssChanged, removedChunkNames };
    } catch (e) {
      messages.push({ type: 'error', message: (e as Error).message, file: filename });
      return { messages, assets, clientBundleChanged: false, cssChanged: false };
    }
  }

  if (filename.endsWith('.css')) {
    if (fileExists) {
      const content = readFileSync(fullPath, 'utf-8');
      if (fullPath === state.cssPath || fullPath.replace(/\\/g, '/') === state.cssPath.replace(/\\/g, '/')) {
        state.rawCss = content;
      }
    }
    const cssChanged = await rebuildTailwindCss();
    if (cssChanged) {
      messages.push({ type: 'css-update' });
      assets.cssGlobal = state.cssGlobal;
      assets.cssTailwind = state.cssTailwind;
    }
    return { messages, assets, clientBundleChanged: false, cssChanged };
  }

  if (isApiFile && fileExists) {
    state.apiWatchCache.set(fullPath, Date.now());
    return { messages, assets };
  }

  if (filename === 'vesk.config.ts' || filename === 'vesk.config.js' || filename === 'tsconfig.json' || filename === 'package.json') {
    try {
      const config = await loadConfig(state.projectDir);
      state.config = config;
      state.plugins = config.plugins || [];
      state.security = relaxCspForDev(config.security as Record<string, unknown> | undefined);
      if (state.security?.rateLimit) {
        const rlConfig = state.security.rateLimit as Record<string, unknown>;
        state.rateLimiter = devMods.createRateLimiter({ windowMs: (rlConfig.windowMs as number) || 60000, max: (rlConfig.max as number) || 100 });
      } else {
        state.rateLimiter = null;
      }
    } catch (e) {
      messages.push({ type: 'error', message: (e as Error).message, file: filename });
    }
  }

  state.routeTree = devMods.scanRoutes(state.appDirPath);
  updateSourceMapping();
  await buildClientBundle();
  await bundleRuntime();
  const cssChanged = await rebuildTailwindCss();
  messages.push({ type: 'reload', reason: `${filename} changed` });
  if (cssChanged) {
    assets.cssGlobal = state.cssGlobal;
    assets.cssTailwind = state.cssTailwind;
  }
  const { clientBundleChanged, removedChunkNames } = collectAssetDiff();
  return { messages, assets, clientBundleChanged, cssChanged, removedChunkNames };
}

// ────────────────────────────────────────────────────────────────────────────
// Prod server state + RPC (mirrors packages/adapter/src/prod-server.ts)
// ────────────────────────────────────────────────────────────────────────────

interface ProdRouteEntry {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
}

interface ProdConfig {
  version: number;
  middleware: boolean;
  routes: ProdRouteEntry[];
  prerendered?: Array<{ path: string; file: string }>;
  static: { prefix: string; dir: string };
  actions?: Array<{ id: string; function: string }>;
}

let prodState: any = null;

function prodMatchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  let pi = 0, pp = 0;
  const params: Record<string, string> = {};
  while (pi < pathParts.length && pp < patternParts.length) {
    if (patternParts[pp].startsWith(':')) {
      params[patternParts[pp].slice(1)] = pathParts[pi];
      pi++; pp++;
    } else if (patternParts[pp] === pathParts[pi]) {
      pi++; pp++;
    } else {
      return null;
    }
  }
  if (pp === patternParts.length && pi === pathParts.length) return params;
  return null;
}

function prodMime(ext: string): string {
  const mime: Record<string, string> = {
    '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon', '.html': 'text/html', '.json': 'application/json',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  };
  return mime[ext] || 'application/octet-stream';
}

function prodStaticResponse(filePath: string): DevResponse | null {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  const ext = extname(filePath);
  return { status: 200, headers: [['Content-Type', prodMime(ext)]], bodyB64: readFileSync(filePath).toString('base64') };
}

async function prodInit(params: any): Promise<any> {
  await loadDevModules();
  const { outDir, projectDir, port } = params;
  const configPath = join(outDir, 'config.json');
  if (!existsSync(configPath)) throw new Error(`no build found at ${outDir}`);
  const buildConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as ProdConfig;

  let securityConfig: Record<string, unknown> = {};
  try {
    const config = await loadConfig(projectDir);
    securityConfig = { security: config.security };
  } catch (e) {
    console.error('prod_init: config load error:', (e as Error).message);
  }

  let rateLimiter: any = null;
  const security = (securityConfig.security as Record<string, unknown>) || {};
  if ((security as Record<string, unknown>).rateLimit) {
    const rl = (security as Record<string, unknown>).rateLimit as Record<string, unknown>;
    rateLimiter = devMods.createRateLimiter({ windowMs: (rl.windowMs as number) || 60000, max: (rl.max as number) || 100 });
  }

  let middlewareMod: any = null;
  const mwPath = join(outDir, 'server', 'middleware.js');
  if (existsSync(mwPath)) {
    try {
      middlewareMod = await import(`${mwPath}?t=${Date.now()}`);
    } catch (e) {
      console.error('prod_init: middleware load error:', (e as Error).message);
    }
  }

  prodState = {
    outDir,
    projectDir,
    port,
    buildConfig,
    securityConfig,
    rateLimiter,
    middlewareMod,
    functionCache: new Map<string, any>(),
  };

  const warmTargets: string[] = [];
  for (const route of buildConfig.routes) {
    if (route.function) warmTargets.push(route.function);
  }
  for (const action of buildConfig.actions || []) {
    if (action.function) warmTargets.push(action.function);
  }
  await Promise.all(warmTargets.map(fn => prodLoadFunction(fn)));

  const routes = buildConfig.routes || [];
  return {
    ok: true,
    routes: routes.filter(r => r.type === 'ssr').map(r => r.path),
    pageCount: routes.filter(r => r.type === 'ssr').length,
    apiCount: routes.filter(r => r.type === 'api').length,
    actionCount: (buildConfig.actions || []).length,
    middleware: !!middlewareMod,
  };
}

async function prodLoadFunction(funcPath: string): Promise<any | null> {
  const state = prodState;
  if (state.functionCache.has(funcPath)) return state.functionCache.get(funcPath);
  const fullPath = resolve(state.outDir, funcPath);
  if (!existsSync(fullPath)) return null;
  try {
    const mod = await import(`${fullPath}?t=${Date.now()}`);
    state.functionCache.set(funcPath, mod);
    return mod;
  } catch (e) {
    console.error('prod: load function error', funcPath, (e as Error).message);
    return null;
  }
}

let prodRtMod: any = null;
let prodRtModMtime = 0;

async function getProdRtMod(): Promise<any> {
  const state = prodState;
  const p = join(state.outDir, 'server', 'runtime.js');
  const mtime = statSync(p).mtimeMs;
  if (prodRtMod && prodRtModMtime === mtime) return prodRtMod;
  prodRtMod = await import(p);
  prodRtModMtime = mtime;
  return prodRtMod;
}

async function prodRenderNotFound(urlPath: string): Promise<string | null> {
  const state = prodState;
  const appDir = join(state.projectDir, 'app');
  const nfPath = join(appDir, 'not-found.vsk');
  if (!existsSync(nfPath)) return null;
  try {
    const rtMod = await getProdRtMod() as { renderFullPage: (...args: any[]) => Promise<string> };
    const src = readFileSync(nfPath, 'utf-8');
    const compName = devMods.resolveComponentName(src) || 'NotFound';
    return await rtMod.renderFullPage(src, compName, { params: {}, url: urlPath }, new Map(), {
      hydrate: true,
      cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
      clientScriptUrl: '/_vesk/static/client.js',
      security: (state.securityConfig.security as Record<string, unknown>) || {},
      externalDataScript: prodStoreDataScript,
      sourcePath: nfPath,
    });
  } catch (e) {
    console.error('prod: not-found render error:', (e as Error).message);
    return null;
  }
}

let notFoundHtmlCache: string | null = null;
let notFoundHtmlComputed = false;

async function prodRenderNotFoundCached(urlPath: string): Promise<string | null> {
  if (notFoundHtmlComputed) return notFoundHtmlCache;
  notFoundHtmlComputed = true;
  notFoundHtmlCache = await prodRenderNotFound(urlPath);
  return notFoundHtmlCache;
}

async function prodRenderError(props: Record<string, unknown>): Promise<string | null> {
  const state = prodState;
  const appDir = join(state.projectDir, 'app');
  const errPath = join(appDir, 'error.vsk');
  if (!existsSync(errPath)) return null;
  try {
    const rtMod = await getProdRtMod() as { renderFullPage: (...args: any[]) => Promise<string> };
    const src = readFileSync(errPath, 'utf-8');
    const compName = devMods.resolveComponentName(src) || 'Error';
    return await rtMod.renderFullPage(src, compName, props, new Map(), {
      hydrate: true,
      cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'],
      clientScriptUrl: '/_vesk/static/client.js',
      security: (state.securityConfig.security as Record<string, unknown>) || {},
      externalDataScript: prodStoreDataScript,
      sourcePath: errPath,
    });
  } catch (e) {
    console.error('prod: error render error:', (e as Error).message);
    return null;
  }
}

const prodIpStore = new AsyncLocalStorage<{ clientIp: string }>();

function withProdClientIp<T>(clientIp: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  return prodIpStore.run({ clientIp: clientIp || '127.0.0.1' }, fn);
}

// Route server-side useFetch calls that target this app's own origin directly to
// the in-process request handler instead of round-tripping through the Go proxy
// (sidecar -> haul -> sidecar RPC). External URLs fall back to a real fetch.
function installSsrFetchHook(): void {
  (globalThis as Record<string, unknown>).__vesk_ssr_fetch = (input: any, init?: RequestInit): Promise<Response> => {
    const state = prodState;
    const fallback = (): Promise<Response> => fetch(input as any, init as any);
    if (!state) return fallback();
    const baseUrl = (globalThis as Record<string, unknown>).__vesk_ssr_base_url as string | undefined;
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
    let target: URL;
    try {
      target = new URL(urlStr, baseUrl || `http://localhost:${state.port || 3000}`);
    } catch {
      return fallback();
    }
    const ownOrigin = (() => {
      try {
        return baseUrl ? target.origin === new URL(baseUrl).origin : target.origin === `http://localhost:${state.port || 3000}`;
      } catch {
        return false;
      }
    })();
    if (!ownOrigin) return fallback();

    const req = input instanceof Request ? input : null;
    const method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    try {
      new Headers((init && init.headers) || (req && req.headers) || {}).forEach((v, k) => { headers[k] = v; });
    } catch {}

    return (async () => {
      let bodyB64: string | undefined;
      try {
        const rawBody = (init && init.body !== undefined && init.body !== null)
          ? init.body
          : (req && req.body !== null) ? req.body : undefined;
        if (rawBody !== undefined && rawBody !== null) {
          bodyB64 = Buffer.from(await new Response(rawBody).arrayBuffer()).toString('base64');
        }
      } catch {}
      const devReq: DevRequest = {
        method,
        url: target.pathname + target.search,
        headers,
        bodyB64,
        clientIp: prodIpStore.getStore()?.clientIp || '127.0.0.1',
        port: state.port,
      };
      const savedBase = (globalThis as Record<string, unknown>).__vesk_ssr_base_url;
      let resp: DevResponse;
      try {
        resp = await handleProdRequest(devReq);
      } finally {
        (globalThis as Record<string, unknown>).__vesk_ssr_base_url = savedBase;
      }
      const bodyBuf = resp.bodyB64 ? Buffer.from(resp.bodyB64, 'base64') : Buffer.alloc(0);
      const hdrs = new Headers();
      for (const [k, v] of resp.headers) {
        if (k.toLowerCase() === 'content-length') continue;
        try { hdrs.append(k, String(v)); } catch {}
      }
      return new Response(bodyBuf, { status: resp.status, headers: hdrs });
    })();
  };
}

async function handleProdRequest(p: DevRequest): Promise<DevResponse> {
  const state = prodState;
  if (!state) {
    return { status: 500, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ error: 'prod server not initialized' })).toString('base64') };
  }
  let mwLocals: Record<string, unknown> = {};

  const url = new URL(p.url, `http://localhost:${p.port || state.port}`);
  const bodyBuffer = p.bodyB64 ? Buffer.from(p.bodyB64, 'base64') : Buffer.alloc(0);
  const req: any = {
    method: p.method,
    url: url.pathname + url.search,
    headers: p.headers,
    socket: { remoteAddress: p.clientIp || '127.0.0.1' },
    __bodyBuffer: bodyBuffer,
    __clientIp: p.clientIp,
  };

  const reqHost = p.headers.host || `localhost:${p.port || state.port}`;
  const security = (state.securityConfig.security as Record<string, unknown>) || {};
  const trustProxy = security.trustProxy as boolean | string | undefined;
  const proto = p.headers['x-forwarded-proto'] && trustProxy ? p.headers['x-forwarded-proto'] : 'http';
  (globalThis as Record<string, unknown>).__vesk_ssr_base_url = `${proto}://${reqHost}`;
  installSsrFetchHook();

  const secHeaders: Record<string, string> = {};
  try {
    const sh = devMods.securityHeaders({ security }) as Record<string, string>;
    for (const [k, v] of Object.entries(sh)) secHeaders[k] = v;
  } catch {}

  const withSec = (resp: DevResponse): DevResponse => {
    const seen = new Set(resp.headers.map(([k]) => k.toLowerCase()));
    for (const [k, v] of Object.entries(secHeaders)) {
      if (!seen.has(k.toLowerCase())) resp.headers.push([k, v]);
    }
    return resp;
  };

  if (state.rateLimiter && !state.rateLimiter.check(p.clientIp || '127.0.0.1')) {
    const rl = (security.rateLimit as Record<string, unknown>) || {};
    const retryAfter = Math.ceil(((rl.windowMs as number) || 60000) / 1000);
    return { status: 429, headers: [['Content-Type', 'application/json'], ['Retry-After', String(retryAfter)]], bodyB64: Buffer.from(JSON.stringify({ error: 'Too Many Requests' })).toString('base64') };
  }

  const staticDir = join(state.outDir, 'static');

  const publicDir = join(staticDir, 'public');
  const sanitized = url.pathname.replace(/\.\./g, '');
  const rootFile = resolve(publicDir, sanitized.slice(1));
  if (rootFile.startsWith(publicDir)) {
    const s = prodStaticResponse(rootFile);
    if (s) return withSec(s);
  }

  if (url.pathname === '/ssr-data.js') {
    const token = url.searchParams.get('t') || '';
    const store = (globalThis as Record<string, unknown>).__vsk_ssr_data_store as Record<string, { props?: Record<string, unknown>; ssrData?: Record<string, unknown> }> | undefined;
    const payload = store?.[token];
    if (payload) delete store[token];
    const lines: string[] = [];
    if (payload?.props) lines.push(`globalThis.__vesk_props = ${JSON.stringify(payload.props)};`);
    if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${JSON.stringify(payload.ssrData)};`);
    return { status: 200, headers: [['Content-Type', 'application/javascript'], ['Cache-Control', 'no-store']], bodyB64: Buffer.from(lines.join('\n') || '// no ssr data').toString('base64') };
  }

  if (url.pathname === '/_vesk/runtime.js') {
    const clientPath = join(staticDir, 'client.js');
    const s = prodStaticResponse(clientPath);
    if (s) return withSec(s);
  }

  if (url.pathname.startsWith('/_vesk/static/')) {
    const relPath = url.pathname.replace('/_vesk/static/', '').replace(/\.\./g, '');
    const staticPath = resolve(staticDir, relPath);
    if (!staticPath.startsWith(staticDir)) {
      return { status: 403, headers: [['Content-Type', 'text/plain']], bodyB64: Buffer.from('Forbidden').toString('base64') };
    }
    const s = prodStaticResponse(staticPath);
    if (s) return withSec(s);
  }

  if (state.buildConfig.prerendered) {
    const prerendered = state.buildConfig.prerendered.find((r: any) => r.path === url.pathname);
    if (prerendered) {
      const htmlPath = join(state.outDir, prerendered.file);
      const s = prodStaticResponse(htmlPath);
      if (s) {
        s.headers = s.headers.map(([k, v]) => (k === 'Content-Type' ? [k, 'text/html'] : [k, v]));
        return withSec(s);
      }
    }
  }

  if (state.middlewareMod && state.middlewareMod.execute) {
    const mwCtx: Record<string, unknown> = {
      request: new Request(url.href, { headers: p.headers as Record<string, string>, method: p.method || 'GET' }),
      params: {},
      url,
      locals: {},
      cookies: {},
      set(key: string, value: unknown) { (this.locals as Record<string, unknown>)[key] = value; },
      get(key: string) { return (this.locals as Record<string, unknown>)[key]; },
    };
    try {
      const mwResult = await state.middlewareMod.execute(mwCtx);
      if (mwResult.response) {
        const body = await mwResult.response.text();
        const headers: [string, string][] = [];
        for (const [k, v] of mwResult.response.headers.entries()) headers.push([k, v]);
        return withSec({ status: mwResult.response.status, headers, bodyB64: Buffer.from(body).toString('base64') });
      }
      if (mwResult.rewriteUrl) url.pathname = mwResult.rewriteUrl;
      mwLocals = (mwCtx.locals as Record<string, unknown>) || {};
    } catch (e) {
      console.error('prod: middleware error:', (e as Error).message);
    }
  }

  const withVeskRequest = <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = (globalThis as Record<string, unknown>).__vesk_request;
    (globalThis as Record<string, unknown>).__vesk_request = {
      request: req,
      params: {},
      url,
      locals: mwLocals,
      cookies: {},
    };
    try {
      return fn();
    } finally {
      (globalThis as Record<string, unknown>).__vesk_request = prev;
    }
  };

  if (url.pathname.startsWith('/_vesk/action/')) {
    const actionId = url.pathname.replace('/_vesk/action/', '');
    const actionEntry = state.buildConfig.actions && state.buildConfig.actions.find((a: any) => a.id === actionId);
    if (!actionEntry) {
      return withSec({ status: 404, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: 'Action not found' })).toString('base64') });
    }
    const mod = await prodLoadFunction(actionEntry.function);
    if (!mod || !mod.handleAction) {
      return withSec({ status: 404, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: 'Action not found' })).toString('base64') });
    }
    try {
      const webRequest = makeWebRequest(req, url);
      const response = await withVeskRequest(() => withProdClientIp(p.clientIp, () => mod.handleAction(webRequest, actionId)));
      const body = await response.text();
      const headers: [string, string][] = [];
      for (const [k, v] of response.headers.entries()) headers.push([k, v]);
      return withSec({ status: response.status, headers, bodyB64: Buffer.from(body).toString('base64') });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return withSec({ status: 500, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: message })).toString('base64') });
    }
  }

  if (url.pathname.startsWith('/api')) {
    for (const route of state.buildConfig.routes) {
      if (route.type === 'api') {
        const params = prodMatchPath(route.path, url.pathname);
        if (params) {
          const mod = await prodLoadFunction(route.function);
          if (mod) {
            try {
              const webRequest = makeWebRequest(req, url);
              const response = await withVeskRequest(() => withProdClientIp(p.clientIp, () => mod.handle(webRequest)));
              const body = await response.text();
              const headers: [string, string][] = [];
              for (const [k, v] of response.headers.entries()) headers.push([k, v]);
              return withSec({ status: response.status, headers, bodyB64: Buffer.from(body).toString('base64') });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              return withSec({ status: 500, headers: [['Content-Type', 'application/json']], bodyB64: Buffer.from(JSON.stringify({ error: message })).toString('base64') });
            }
          }
        }
      }
    }
  }

  for (const route of state.buildConfig.routes) {
    if (route.type === 'ssr') {
      const params = prodMatchPath(route.path, url.pathname);
      if (params) {
        const mod = await prodLoadFunction(route.function);
        if (mod) {
          try {
            const webRequest = makeWebRequest(req, url);

            let cachedResult: { html: string; headers: Record<string, string> } | null = null;
            if (route.revalidate && route.revalidate > 0) {
              cachedResult = await devMods.runtimeServer.pageIsr(url.pathname, async () => {
                const response = await withVeskRequest(() => withProdClientIp(p.clientIp, () => mod.handle(webRequest)));
                return { html: await response.text(), headers: Object.fromEntries(response.headers) };
              }, { revalidate: route.revalidate, tags: route.tags || [] });
            }
            if (cachedResult) {
              const headers: [string, string][] = Object.entries(cachedResult.headers || { 'Content-Type': 'text/html' });
              return withSec({ status: 200, headers, bodyB64: Buffer.from(cachedResult.html).toString('base64') });
            }

            const response = await withVeskRequest(() => withProdClientIp(p.clientIp, () => mod.handle(webRequest)));
            const headers: Record<string, string | number> = Object.fromEntries(response.headers);
            if (!headers['content-type'] && !headers['Content-Type']) headers['Content-Type'] = 'text/html';
            const body = await response.text();
            return withSec({ status: response.status, headers: Object.entries(headers) as [string, string][], bodyB64: Buffer.from(body).toString('base64') });
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            if (err.name === 'NotFoundError') {
              const nfHtml = await prodRenderNotFoundCached(url.pathname);
              return withSec({ status: 404, headers: [['Content-Type', 'text/html']], bodyB64: Buffer.from(nfHtml || '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/_vesk/static/_tailwind.css" /><link rel="stylesheet" href="/_vesk/static/global.css" /></head><body><h1>404</h1><p>Not Found</p><script type="module" src="/_vesk/static/client.js"></script></body></html>').toString('base64') });
            }
            console.error('haul ssr error:', err.message);
            let errorHtml: string | null = null;
            try {
              errorHtml = await prodRenderError({ error: err.message, stack: (err as Error).stack, statusCode: errorStatusCode(err), url: url.pathname });
            } catch {}
            return withSec({ status: errorStatusCode(err), headers: [['Content-Type', 'text/html']], bodyB64: Buffer.from(errorHtml || '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/_vesk/static/_tailwind.css" /><link rel="stylesheet" href="/_vesk/static/global.css" /></head><body><div style="font-family:system-ui;padding:2rem"><h1>' + errorStatusCode(err) + ' \u2014 Internal Server Error</h1><pre>' + String(err.message).replace(/</g,'&lt;') + '</pre></div><script type="module" src="/_vesk/static/client.js"></script></body></html>').toString('base64') });
          }
        }
      }
    }
  }

  const nfHtml = await prodRenderNotFoundCached(url.pathname);
  return withSec({ status: 404, headers: [['Content-Type', 'text/html']], bodyB64: Buffer.from(nfHtml || '<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>').toString('base64') });
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/runtime.js') {
    const candidates = [
      resolve(runtimeDir, 'index-client.js'),
      resolve(runtimeDir, 'index-server.js'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return serveStatic(req, res, p, 'application/javascript');
    }
    res.writeHead(404);
    res.end('runtime not found');
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('method not allowed');
    return;
  }

  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => { body += chunk; });
  req.on('end', () => {
    let rpcReq: JsonRpcRequest;
    try {
      rpcReq = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('invalid json');
      return;
    }

    const respond = (response: JsonRpcResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    };

    (async () => {
      try {
        await ensureModules();
        switch (rpcReq.method) {
          case 'compile_client': {
            const { source, filePath, options } = (rpcReq.params[0] || {}) as any;
            const opts = options || { forceClient: true };
            const code = compileClient(source, filePath || null, opts);
            if (opts.postprocess) {
              const post = postprocessClientCode(code);
              respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code: post.code, runtimeImports: post.runtimeImports } });
              return;
            }
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'compile_server': {
            const { source, filePath, options } = (rpcReq.params[0] || {}) as any;
            const code = compileServer(source, filePath || null, options || {});
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'compile_middleware_code': {
            const { sources } = (rpcReq.params[0] || {}) as any;
            const parts: string[] = [];
            for (let i = 0; i < (sources || []).length; i++) {
              const extracted = extractMiddlewareParts(sources[i]);
              if (!extracted) continue;
              parts.push(`async function mw_${i}(${extracted.params}) {\n${extracted.body}\n}`);
            }
            if (parts.length === 0) {
              respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code: null } });
              return;
            }
            const code = [
              '// ── Middleware chain (inline) ──',
              '',
              parts.join('\n\n'),
              '',
              `const __mwChain = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
              '',
              'async function __executeMw(ctx) {',
              '  let rewriteUrl = null;',
              '  async function run(index) {',
              '    if (index >= __mwChain.length) return null;',
              '    const fn = __mwChain[index];',
              '    let nc = false;',
              '    async function next(rewrite) {',
              '      if (nc) return null;',
              '      nc = true;',
              '      if (rewrite) rewriteUrl = rewrite;',
              '      return run(index + 1);',
              '    }',
              '    const result = await fn(ctx, next);',
              '    if (result instanceof Response) return result;',
              '    if (!nc) return run(index + 1);',
              '    return null;',
              '  }',
              '  const response = await run(0);',
              '  return { response, rewriteUrl };',
              '}',
              '',
            ].join('\n');
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'generate_dts': {
            const { source, filePath } = (rpcReq.params[0] || {}) as any;
            const dts = generateVskDts(source, filePath || null);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { dts } });
            return;
          }
          case 'vsk_to_tsx': {
            const { source } = (rpcReq.params[0] || {}) as any;
            const tsx = vskToTsx(source);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { tsx } });
            return;
          }
          case 'typecheck': {
            const { projectRoot, strict } = rpcReq.params[0] as any;
            const root = projectRoot || process.cwd();
            const diagnostics = typecheckProject(root, { strict: strict ?? true });
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { diagnostics } });
            return;
          }
          case 'resolve_runtime': {
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { compilerDir, runtimeDir } });
            return;
          }
          case 'bundle_runtime_iife': {
            const { runtimeDir: rd, usedNames } = (rpcReq.params[0] || {}) as any;
            const code = bundleClientRuntimeIife(rd || runtimeDir, usedNames || []);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'bundle_server_runtime': {
            const { runtimeDir: rd, compilerDir: cd, entryPath } = (rpcReq.params[0] || {}) as any;
            const code = bundleServerRuntime(rd || runtimeDir, cd || compilerDir, entryPath);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'strip_types': {
            const { source } = (rpcReq.params[0] || {}) as any;
            const stripMod = await import('@vesk/compiler/src/strip-ts');
            const code = stripMod.stripCodeTypes(source);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'rewrite_runtime_imports': {
            const { source } = (rpcReq.params[0] || {}) as any;
            const code = rewriteRuntimeImportSources(source);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { code } });
            return;
          }
          case 'scan_routes': {
            const { appDir } = (rpcReq.params[0] || {}) as any;
            const routes = scanRoutes(appDir);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { routes } });
            return;
          }
          case 'scan_api_routes': {
            const { apiDir } = (rpcReq.params[0] || {}) as any;
            const routes = scanApiRoutes(apiDir);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { routes } });
            return;
          }
          case 'collect_action_ids': {
            const { paths } = (rpcReq.params[0] || {}) as any;
            const actionsMod = await import('@vesk/compiler/src/actions');
            const ids: string[] = [];
            const seen = new Set<string>();
            for (const p of paths || []) {
              if (!existsSync(p)) continue;
              try {
                const src = readFileSync(p, 'utf-8');
                for (const id of actionsMod.collectActionIds(src)) {
                  if (!seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                  }
                }
              } catch (e) {
                console.error('collect_action_ids error for', p, (e as Error).message);
              }
            }
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { ids } });
            return;
          }
          case 'on_css': {
            const { cssContent, filePath, projectDir } = (rpcReq.params[0] || {}) as any;
            const result = await processCssWithPlugins(cssContent, filePath, projectDir);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result: { css: result } });
            return;
          }
          case 'dev_init': {
            const result = await devInit(rpcReq.params[0] || {});
            respond({ jsonrpc: '2.0', id: rpcReq.id, result });
            return;
          }
          case 'dev_render': {
            const result = await handleDevRequest((rpcReq.params[0] || {}) as DevRequest);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result });
            return;
          }
          case 'dev_rebuild': {
            const result = await devRebuild(rpcReq.params[0] || {});
            respond({ jsonrpc: '2.0', id: rpcReq.id, result });
            return;
          }
          case 'prod_init': {
            const result = await prodInit(rpcReq.params[0] || {});
            respond({ jsonrpc: '2.0', id: rpcReq.id, result });
            return;
          }
          case 'prod_render': {
            const result = await handleProdRequest((rpcReq.params[0] || {}) as DevRequest);
            respond({ jsonrpc: '2.0', id: rpcReq.id, result });
            return;
          }
          default:
            console.log('sidecar: unknown method', rpcReq.method);
            respond(err(rpcReq.id, `unknown method: ${rpcReq.method}`));
        }
      } catch (e) {
        console.error('sidecar error:', e);
        respond(err(rpcReq.id, e instanceof Error ? e.message : String(e)));
      }
    })();
  });
});

const port = process.env.VESK_SIDECAR_PORT ? Number(process.env.VESK_SIDECAR_PORT) : 0;
server.on('connection', (socket) => {
  socket.setNoDelay(true);
});
server.listen(port, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(JSON.stringify({ port: actualPort }));
});
