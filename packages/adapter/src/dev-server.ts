import { readFileSync, existsSync, watch, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { build } from '@vesk/adapter/src/index';
import { createHmrServer } from '@vesk/adapter/src/hmr';
import { buildRuntimeCode } from '@vesk/adapter/src/client-bundle';
import type { RouteNode, DevServerOptions, Manifest } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExtendedRequest extends Request {
  json(): Promise<unknown>;
  text(): Promise<string>;
  clone(): ExtendedRequest;
}

async function readBody(req: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function makeWebRequest(nodeReq: IncomingMessage, url: string): ExtendedRequest {
  const parsedUrl = new URL(url, `http://${nodeReq.headers.host || 'localhost'}`);
  const method = nodeReq.method || 'GET';
  let _bodyBuffer: Buffer | null = null;
  async function getBody(): Promise<Buffer> {
    if (_bodyBuffer) return _bodyBuffer;
    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) chunks.push(Buffer.from(chunk));
    _bodyBuffer = Buffer.concat(chunks);
    return _bodyBuffer;
  }
  const webRequest = new Request(parsedUrl, { method, headers: nodeReq.headers as Record<string, string>, body: null }) as ExtendedRequest;
  webRequest.json = async () => { try { return JSON.parse((await getBody()).toString()); } catch { return null; } };
  webRequest.text = async () => (await getBody()).toString('utf-8');
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
  const devDir = resolve(appDir, '..', '.vesk', 'dev');
  const publicDir = options?.publicDir || resolve(appDir, '..', 'public');

  let componentMap = new Map<string, string>();
  const monorepoRouter = resolve(__dirname, '..', '..', 'compiler', 'src', 'router.ts');
  const pkgRouter = resolve(appDir, '..', 'node_modules', '@vesk/compiler', 'src', 'router.ts');
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
      const runtimeDir = resolve(monorepoRoot, 'packages', 'runtime', 'src');
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

    if (url.pathname === '/_vesk/hmr.js') {
      const monorepoRoot = resolve(__dirname, '..', '..', '..');
      const runtimeSrc = resolve(monorepoRoot, 'packages', 'runtime', 'src');
      const hmrJsPath = resolve(runtimeSrc, 'hmr-client.js');
      const hmrTsPath = resolve(runtimeSrc, 'hmr-client.ts');
      const hmrPath = existsSync(hmrJsPath) ? hmrJsPath : (existsSync(hmrTsPath) ? hmrTsPath : null);
      if (hmrPath) {
        let hmrContent = readFileSync(hmrPath, 'utf-8');
        if (hmrPath.endsWith('.ts')) {
          hmrContent = transformSync(hmrContent, { loader: 'ts' }).code;
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
      const relPath = url.pathname.replace('/_vesk/static/', '').replace(/\.\./g, '');
      const staticPath = resolve(devDir, 'static', relPath);
      if (!staticPath.startsWith(resolve(devDir, 'static'))) {
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
      const sanitized = url.pathname.replace(/\.\./g, '');

      const sourcePath = resolve(publicDir, sanitized.slice(1));
      if (sourcePath.startsWith(publicDir) && existsSync(sourcePath) && statSync(sourcePath).isFile()) {
        const ext = extname(sourcePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(sourcePath));
        return;
      }

      const buildPublicDir = resolve(devDir, 'static', 'public');
      const buildPath = resolve(buildPublicDir, sanitized.slice(1));
      if (buildPath.startsWith(buildPublicDir) && existsSync(buildPath) && statSync(buildPath).isFile()) {
        const ext = extname(buildPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(buildPath));
        return;
      }
    }

    if (config && url.pathname.startsWith('/api')) {
      const apiRoute = config.routes.find(r => r.type === 'api' && matchPath(r.path, url.pathname));
      if (apiRoute) {
        const handlerPath = resolve(devDir, apiRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`) as { handle: (req: Request) => Promise<Response> };
            const webRequest = makeWebRequest(req, url.href);
            const response = await mod.handle(webRequest);
            const body = await response.text();
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(body);
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
            const webRequest = makeWebRequest(req, url.href);
            const response = await mod.handle(webRequest);
            const body = await response.text();

            const headers = Object.fromEntries(response.headers);
            const contentType = headers['content-type'] || '';
            let finalBody = body;
            if (contentType.includes('text/html')) {
              finalBody = body.replace(
                '</body>',
                '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>'
              );
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
            const webRequest = makeWebRequest(req, url.href);
            const response = await mod.handle(webRequest);
            const body = await response.text();
            const headers = Object.fromEntries(response.headers);
            const contentType = headers['content-type'] || '';
            let finalBody = body;
            if (contentType.includes('text/html')) {
              finalBody = body.replace(
                '</body>',
                '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>'
              );
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
      }, 200);
    });
  } catch (e) {
    console.error('vesk dev: file watching unavailable');
  }

  await new Promise<void>(resolve => {
    server.listen(port, () => {
      console.error(`vesk dev server at http://localhost:${port}`);
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
