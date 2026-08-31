import { readFileSync, existsSync, watch, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import { DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-codegen';
import { build } from '@vesk/adapter/src/index';
import { createHmrServer } from './hmr';
import * as hmrApi from './hmr';
import { createDevApiRouter } from './dev-api';
import { buildRuntimeCode } from '@vesk/adapter/src/client-bundle';
import { resolveWithin, installMdReadHook } from '@vesk/adapter/src/paths';
import type { RouteNode, DevServerOptions, Manifest, VeskPlugin } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Shape returned by the dev HMR state endpoint. Mirrors what the parallel
 * `hmr.ts` agent's `getHmrState()` returns; we tolerate its absence at
 * module-load time (see `devHmrState`) so this module stays importable even
 * before the state provider lands.
 */
export interface DevHmrState {
  status: 'up' | 'compiling' | 'error' | 'down';
  lastCompileMs: number | null;
  error: Record<string, unknown> | null;
  hasError: boolean;
  componentCount: number;
}

/** Default state when no HMR provider is available (no server). */
export function defaultDevHmrState(): DevHmrState {
  return { status: 'up', lastCompileMs: null, error: null, hasError: false, componentCount: 0 };
}

/** The live HMR state provider: the parallel agent's `getHmrState` if present, else a safe no-server default. */
const devHmrState: () => DevHmrState =
  typeof (hmrApi as unknown as { getHmrState?: () => DevHmrState }).getHmrState === 'function'
    ? (hmrApi as unknown as { getHmrState: () => DevHmrState }).getHmrState
    : defaultDevHmrState;

interface ExtendedRequest extends Request {
  json(): Promise<unknown>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  clone(): ExtendedRequest;
}

/**
 * Writes a handler Response to the socket, piping a streaming body
 * chunk-by-chunk (SSE / text streams) instead of buffering everything.
 */
async function deliverResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* stream aborted by the client */
    }
    res.end();
    return;
  }
  res.end(await response.text());
}

export function bodyTooLarge(maxBytes: number): Error & { status: number } {
  const err = new Error(`Request body exceeds limit (${maxBytes} bytes)`) as Error & { status: number };
  err.status = 413;
  return err;
}

function errorStatus(e: unknown, fallback: number): number {
  const s = (e as { status?: unknown } | null)?.status ?? (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : fallback;
}

async function readBody(req: AsyncIterable<Uint8Array>, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > maxBytes) throw bodyTooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export interface DevPanelResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** When 'base64', the dev server writes Buffer.from(body, 'base64') to the socket (binary payloads like icons). */
  encoding?: 'utf8' | 'base64';
}

export interface PluginRouterChangeEvent {
  type: 'activate' | 'deactivate' | 'install' | 'uninstall' | 'update';
  name?: string;
}

export interface PluginStateRouterOptions {
  appDir: string;
  veskDir: string;
  configPluginNames: string[];
  getHmrState?: () => DevHmrState;
  /** Called after a mutation so the caller can rebuild + notify HMR clients. */
  onPluginChange?: (event: PluginRouterChangeEvent) => void | Promise<void>;
}

/**
 * Pure, dependency-injectable router for the dev panel HTTP endpoints
 * (`/__vesk/...`). Everything is testable with fake inputs — no socket, no
 * listener. Returns `null` for paths that are not dev-panel endpoints so the
 * dev server can fall through to its normal route handling.
 *
 * Endpoints:
 *   GET  /__vesk/hmr/state                       → { ...DevHmrState }
 *   GET  /__vesk/plugins                         → { plugins: PluginRecord[] } (registry-enriched)
 *   POST /__vesk/plugins/activate                → { ok, record }
 *   POST /__vesk/plugins/deactivate              → { ok, record }
 *   POST /__vesk/plugins/install                 → { ok, record }
 *   POST /__vesk/plugins/uninstall               → { ok }
 *   POST /__vesk/plugins/update                  → { ok, record }
 *   GET  /__vesk/plugins/search?q=<query>        → { results: PluginSearchResult[] }
 *   GET  /__vesk/plugins/:name/icon              → { base64 + mime } (or 404)
 *   GET  /__vesk/plugins/:name/exports           → { PluginExportsInfo }
 *   (anything else under /__vesk/*)              → 404 { error }
 */
export function createPluginStateRouter(opts: PluginStateRouterOptions): {
  route: (method: string, pathname: string, body?: unknown, search?: string) => Promise<DevPanelResponse | null>;
} {
  // Delegates to the unified DevTools router (dev-api.ts) for the plugin +
  // HMR-state surface, preserving the exact wire contract.
  return createDevApiRouter({
    appDir: opts.appDir,
    veskDir: opts.veskDir,
    configPluginNames: opts.configPluginNames,
    getHmrState: opts.getHmrState,
    onPluginChange: opts.onPluginChange,
  });
}

/**
 * Inline bootstrap script injected after the dev/HMR scripts on every served
 * dev page. On DOMContentLoaded it polls `/__vesk/hmr/state` and — if the
 * server reports a persisted error — calls the client's registered
 * `globalThis.__vesk_hmr_show(payload)` to re-open the error overlay. This
 * satisfies the Nuxt-like "a refresh during an active error should still show
 * the overlay" requirement, because the client bundle's own state fetch only
 * fires after its module runs.
 *
 * Idempotency: the `window.__vesk_hmr_bootstrap` guard makes the inline script
 * run at most once per page even if it is injected at multiple `</body>` sites
 * (or on a page served more than once). The overlay itself cannot be duplicated
 * because the client's `showOverlay` reuses a single `#__vesk_overlay` element
 * (guarded in `createOverlay`), and `__vesk_hmr_show` is registered once by
 * `registerGlobalHmr`. So a double-show (inline bootstrap + client's own
 * `loadPersistedState`) re-renders the same overlay rather than stacking a
 * second one.
 */
export function devBootstrapScript(): string {
  return (
    "<script>\n" +
    "if(!window.__vesk_hmr_bootstrap){window.__vesk_hmr_bootstrap=1;" +
    "(function(){function boot(){fetch('/__vesk/hmr/state')" +
    ".then(function(r){return r.ok?r.json():null;}).then(function(s){" +
    "if(s&&s.error&&window.__vesk_hmr_show){window.__vesk_hmr_show(s.error);}" +
    "}).catch(function(){});}" +
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}" +
    "})();" +
    "}\n" +
    "</script>"
  );
}

/**
 * Inject the dev/HMR client script plus the inline state bootstrap into an HTML
 * page at its first `</body>`. Idempotent when there is no `</body>`: the HTML
 * is returned unchanged (never injected twice / never appended uncontrolled).
 */
export function injectDevScripts(html: string): string {
  if (!html.includes('</body>')) return html;
  const scripts = '\t<script type="module" src="/_vesk/hmr.js"></script>\n' + devBootstrapScript() + '\n';
  return html.replace('</body>', scripts + '</body>');
}

function makeWebRequest(nodeReq: IncomingMessage, url: string, maxBodyBytes: number = DEFAULT_MAX_BODY_BYTES): ExtendedRequest {
  const parsedUrl = new URL(url, `http://${nodeReq.headers.host || 'localhost'}`);
  const method = nodeReq.method || 'GET';
  let _bodyBuffer: Buffer | null = null;
  async function getBody(): Promise<Buffer> {
    if (_bodyBuffer) return _bodyBuffer;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of nodeReq) {
      total += chunk.byteLength;
      if (total > maxBodyBytes) throw bodyTooLarge(maxBodyBytes);
      chunks.push(Buffer.from(chunk));
    }
    _bodyBuffer = Buffer.concat(chunks);
    return _bodyBuffer;
  }
  const webRequest = new Request(parsedUrl, { method, headers: nodeReq.headers as Record<string, string>, body: null }) as ExtendedRequest;
  webRequest.json = async () => { try { return JSON.parse((await getBody()).toString()); } catch { return null; } };
  webRequest.text = async () => (await getBody()).toString('utf-8');
  webRequest.formData = async () => {
    const body = await getBody();
    const ct = String(nodeReq.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      const temp = new Request('http://localhost', { method: 'POST', headers: nodeReq.headers as Record<string, string>, body: body as unknown as BodyInit });
      return temp.formData();
    }
    const fd = new FormData();
    if (ct.includes('x-www-form-urlencoded')) {
      for (const [k, v] of new URLSearchParams(body.toString()).entries()) fd.append(k, v);
    }
    return fd;
  };
  webRequest.clone = () => webRequest;
  return webRequest;
}

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.html': 'text/html', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

export async function startDevServer(appDir: string, options?: DevServerOptions): Promise<Server | void> {
  const port = options?.port || 3000;
  const host = options?.host || '127.0.0.1';
  const maxBodyBytes = options?.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
  const devDir = resolve(appDir, '..', '.vesk', 'dev');
  const publicDir = options?.publicDir || resolve(appDir, '..', 'public');
  installMdReadHook([publicDir, resolve(devDir, 'static', 'public')]);

  // Dev-panel plugin list: plugin / module names declared in the dev server's own config.
  const configPluginNames: string[] = (options?.plugins || []).map((p) => {
    if (typeof p === 'string') return p;
    return (p as VeskPlugin).name;
  }).filter((n): n is string => typeof n === 'string' && !!n);

  // Late-bound so the router's onPluginChange can broadcast over the HMR
  // WebSocket, which is only created further down in this function.
  let hmrSession: ReturnType<typeof createHmrServer> | null = null;

  const devPanel = createPluginStateRouter({
    appDir,
    veskDir: resolve(appDir, '..', '.vesk'),
    configPluginNames,
    getHmrState: devHmrState,
    onPluginChange: async (event) => {
      try {
        await doBuild();
        if (hmrSession) {
          hmrSession.broadcast('reload', { reason: `Plugin ${event.type}: ${event.name ?? ''}`, time: Date.now() });
        }
      } catch {
        /* plugin change rebuild is best-effort; the server keeps serving */
      }
    },
  });

  let componentMap = new Map<string, string>();
  const monorepoRouter = resolve(__dirname, '..', '..', 'compiler', 'dist', 'router.js');
  const pkgRouter = resolve(appDir, '..', 'node_modules', '@vesk/compiler', 'router.js');
  const routerPath = existsSync(monorepoRouter) ? monorepoRouter : (existsSync(pkgRouter) ? pkgRouter : null);
  if (routerPath) {
    const { scanComponents } = await import(routerPath) as { scanComponents: (componentsDir: string) => Map<string, string> };
    const componentsDir = resolve(appDir, '..', 'components');
    if (existsSync(componentsDir)) {
      componentMap = scanComponents(componentsDir);
    }
  }

  let config: Manifest | null = null;
  let lastBuild = 0;
  let ssrVersion = Date.now();
  let routeTree: RouteNode[] = [];
  let runtimeBundle = '';

  async function doBuild(): Promise<void> {
    const start = Date.now();
    try {
      const result = await build(appDir, { outDir: devDir, publicDir, hmr: true });
      const configPath = resolve(devDir, 'config.json');
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8')) as Manifest;
      }
      if (result) routeTree = result.routeTree;
      const monorepoRoot = resolve(__dirname, '..', '..', '..');
      const runtimeDir = resolve(monorepoRoot, 'packages', 'runtime', 'dist');
      runtimeBundle = buildRuntimeCode(runtimeDir);
      lastBuild = Date.now();
      console.error(`vesk dev: rebuilt in ${Date.now() - start}ms`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`vesk dev: build error: ${message}`);
    }
  }

  await doBuild();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // Dev panel endpoints (/__vesk/...): HMR state, plugin list, activate/
    // deactivate/install/uninstall. Routed through the pure injectable router.
    if (url.pathname.startsWith('/__vesk/')) {
      let body: unknown = undefined;
      if ((req.method || 'GET') === 'POST') {
        try {
          const buf = await readBody(req, maxBodyBytes);
          body = buf.length > 0 ? JSON.parse(buf.toString()) : {};
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          return;
        }
      }
      const result = await devPanel.route(req.method || 'GET', url.pathname, body, url.search);
      if (result) {
        res.writeHead(result.status, result.headers);
        res.end(result.encoding === 'base64' ? Buffer.from(result.body, 'base64') : result.body);
        return;
      }
    }

    if (url.pathname === '/_vesk/hmr.js') {
      const monorepoRoot = resolve(__dirname, '..', '..', '..');
      const runtimeSrc = resolve(monorepoRoot, 'packages', 'runtime', 'dist');
      const hmrJsPath = resolve(runtimeSrc, 'hmr-client.js');
      const hmrTsPath = resolve(runtimeSrc, 'hmr-client.ts');
      const hmrPath = existsSync(hmrJsPath) ? hmrJsPath : (existsSync(hmrTsPath) ? hmrTsPath : null);
      if (hmrPath) {
        let hmrContent = readFileSync(hmrPath, 'utf-8');
        if (hmrPath.endsWith('.ts')) {
          hmrContent = stripCodeTypes(hmrContent);
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(hmrContent);
        return;
      }
    }

    if (url.pathname === '/_vesk/runtime.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(runtimeBundle);
      return;
    }

    if (url.pathname.startsWith('/_vesk/static/')) {
      const relPath = url.pathname.slice('/_vesk/static/'.length);
      const staticPath = resolveWithin(resolve(devDir, 'static'), relPath);
      if (!staticPath) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (existsSync(staticPath) && statSync(staticPath).isFile()) {
        const ext = extname(staticPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(staticPath));
        return;
      }
    }

    if (url.pathname !== '/') {

      const sourcePath = url.pathname.length > 1 ? resolveWithin(publicDir, url.pathname.slice(1)) : null;
      if (sourcePath && existsSync(sourcePath) && statSync(sourcePath).isFile()) {
        const ext = extname(sourcePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(sourcePath));
        return;
      }

      const buildPublicDir = resolve(devDir, 'static', 'public');
      const buildPath = url.pathname.length > 1 ? resolveWithin(buildPublicDir, url.pathname.slice(1)) : null;
      if (buildPath && existsSync(buildPath) && statSync(buildPath).isFile()) {
        const ext = extname(buildPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(buildPath));
        return;
      }
    }

    if (config && url.pathname.startsWith('/_vesk/action/')) {
      const actionId = url.pathname.replace('/_vesk/action/', '');
      const actionEntry = config.actions && config.actions.find(a => a.id === actionId);
      if (actionEntry) {
        const handlerPath = resolve(devDir, actionEntry.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`) as { handleAction?: (req: Request, id: string) => Promise<Response> };
            if (mod.handleAction) {
              const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
              const response = await mod.handleAction(webRequest, actionId);
              const body = await response.text();
              const headers = Object.fromEntries(response.headers);
              const contentType = headers['content-type'] || '';
              let finalBody = body;
              if (contentType.includes('text/html')) {
                finalBody = injectDevScripts(body);
              }
              res.writeHead(response.status, headers);
              res.end(finalBody);
              return;
            }
          } catch (e) {
            const status = errorStatus(e, 500);
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
            return;
          }
        }
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Action not found' }));
      return;
    }

    if (config && url.pathname.startsWith('/api')) {
      const apiRoute = config.routes.find(r => r.type === 'api' && matchPath(r.path, url.pathname));
      if (apiRoute) {
        const handlerPath = resolve(devDir, apiRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`) as { handle: (req: Request) => Promise<Response> };
            const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
            const response = await mod.handle(webRequest);
            await deliverResponse(res, response);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
          }
          return;
        }
      }
    }

    if (config) {
      const ssrRoute = config.routes.find(r => r.type === 'ssr' && matchPath(r.path, url.pathname));
      if (ssrRoute) {
        const handlerPath = resolve(devDir, ssrRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`) as { handle: (req: Request) => Promise<Response> };
            const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
            const response = await mod.handle(webRequest);
            const body = await response.text();

            const headers = Object.fromEntries(response.headers);
            const contentType = headers['content-type'] || '';
            let finalBody = body;
            if (contentType.includes('text/html')) {
              finalBody = injectDevScripts(body);
            }
            res.writeHead(response.status, headers);
            res.end(finalBody);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>');
          }
          return;
        }
      }
    }

    if (config) {
      const rootRoute = config.routes.find(r => r.type === 'ssr' && r.path === '/');
      if (rootRoute) {
        const handlerPath = resolve(devDir, rootRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`) as { handle: (req: Request) => Promise<Response> };
            const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
            const response = await mod.handle(webRequest);
            const body = await response.text();
            const headers = Object.fromEntries(response.headers);
            const contentType = headers['content-type'] || '';
            let finalBody = body;
            if (contentType.includes('text/html')) {
              finalBody = injectDevScripts(body);
            }
            res.writeHead(200, headers);
            res.end(finalBody);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>');
          }
          return;
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>');
  });

  const hmr = createHmrServer(server, appDir, devDir, componentMap);
  hmrSession = hmr;

  const srcDir = resolve(appDir, '..', 'src');

  try {
    if (existsSync(srcDir)) {
      watch(srcDir, { recursive: true }, (_eventType: string, filename: string | null) => {
        if (!filename) return;
        if (filename.endsWith('.css')) {
          doBuild();
        }
      });
    }
  } catch {
    // src/ dir not available
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFiles = new Set<string>();

  try {
    watch(appDir, { recursive: true }, (_eventType: string, filename: string | null) => {
      if (!filename) return;
      if (debounceTimer) clearTimeout(debounceTimer);

      pendingFiles.add(filename);
      debounceTimer = setTimeout(() => {
        const files = [...pendingFiles];
        pendingFiles = new Set<string>();

        const configFiles = files.filter(f =>
          f === 'vesk.config.ts' || f === 'vesk.config.js' ||
          f === 'tsconfig.json' || f === 'package.json' ||
          f.endsWith('/vesk.config.ts') || f.endsWith('/vesk.config.js') ||
          f.endsWith('/tsconfig.json') || f.endsWith('/package.json')
        );

        const apiMiddlewareFiles = files.filter(f =>
          (f.includes('/api/') || f === 'middleware.ts' || f.endsWith('/middleware.ts')) &&
          (f.endsWith('.ts') || f.endsWith('.js'))
        );

        const vskFiles = files.filter(f => f.endsWith('.vsk'));

        if (configFiles.length > 0) {
          hmr.handleFileChange(configFiles[0], doBuild, routeTree);
        } else if (apiMiddlewareFiles.length > 0) {
          hmr.handleFileChange(apiMiddlewareFiles[0], doBuild, routeTree);
        } else if (vskFiles.length > 0) {
          (async () => {
            for (const f of vskFiles) {
              await hmr.handleFileChange(f, doBuild, routeTree);
            }
            ssrVersion = Date.now();
          })();
        } else if (files.length > 0) {
          hmr.handleFileChange(files[0], doBuild, routeTree);
        }
      }, 40);
    });
  } catch (e) {
    console.error('vesk dev: file watching unavailable');
  }

  await new Promise<void>(resolve => {
    server.listen(port, host, () => {
      console.error(`vesk dev server at http://localhost:${port} (listening on ${host})`);
      resolve();
    });
  });

  if (options?.block !== false) {
    await new Promise(() => {});
  }
  return server;
}

function matchPath(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  let pi = 0, pp = 0;
  while (pi < pathParts.length && pp < patternParts.length) {
    if (patternParts[pp].startsWith(':')) {
      pi++; pp++;
    } else if (patternParts[pp] === pathParts[pi]) {
      pi++; pp++;
    } else {
      return false;
    }
  }
  return pp === patternParts.length && pi === pathParts.length;
}
