import { readFileSync, existsSync, watch, statSync } from 'fs';
import { resolve, extname, dirname, join } from 'path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'url';
import { build } from './index.js';
import { createHmrServer } from './hmr.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function makeWebRequest(nodeReq, url) {
  const parsedUrl = new URL(url, `http://${nodeReq.headers.host || 'localhost'}`);
  const method = nodeReq.method || 'GET';
  let _bodyBuffer = null;
  async function getBody() {
    if (_bodyBuffer) return _bodyBuffer;
    const chunks = [];
    for await (const chunk of nodeReq) chunks.push(chunk);
    _bodyBuffer = Buffer.concat(chunks);
    return _bodyBuffer;
  }
  const webRequest = new Request(parsedUrl, { method, headers: nodeReq.headers, body: null });
  webRequest.json = async () => { try { return JSON.parse((await getBody()).toString()); } catch { return null; } };
  webRequest.text = async () => (await getBody()).toString('utf-8');
  webRequest.clone = () => webRequest;
  return webRequest;
}

const MIME = {
  '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.html': 'text/html', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

export async function startDevServer(appDir, options = {}) {
  const port = options.port || 3000;
  const devDir = resolve(appDir, '..', '.vesk', 'dev');
  const publicDir = options.publicDir || resolve(appDir, '..', 'public');

  // Scan external components from ./components/
  let componentMap = new Map();
  const monorepoRouter = resolve(__dirname, '..', '..', 'compiler', 'src', 'router.js');
  const pkgRouter = resolve(appDir, '..', 'node_modules', '@vesk/compiler', 'src', 'router.js');
  const routerPath = existsSync(monorepoRouter) ? monorepoRouter : (existsSync(pkgRouter) ? pkgRouter : null);
  if (routerPath) {
    const { scanComponents } = await import(routerPath);
    const componentsDir = resolve(appDir, '..', 'components');
    if (existsSync(componentsDir)) {
      componentMap = scanComponents(componentsDir);
    }
  }

  let config = null;
  let lastBuild = 0;
  let ssrVersion = Date.now();
  let routeTree = [];

  async function doBuild() {
    const start = Date.now();
    try {
      const result = await build(appDir, { outDir: devDir, publicDir, hmr: true });
      const configPath = resolve(devDir, 'config.json');
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      }
      if (result) routeTree = result.routeTree;
      lastBuild = Date.now();
      console.error(`vesk dev: rebuilt in ${Date.now() - start}ms`);
    } catch (e) {
      console.error(`vesk dev: build error: ${e.message}`);
    }
  }

  await doBuild();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // ── HMR client script ──
    if (url.pathname === '/_vesk/hmr.js') {
      const monorepoRoot = resolve(__dirname, '..', '..', '..');
      const runtimeSrc = resolve(monorepoRoot, 'packages', 'runtime', 'src');
      const hmrPath = existsSync(runtimeSrc)
        ? resolve(runtimeSrc, 'hmr-client.js')
        : resolve(appDir, '..', 'node_modules', '@vesk/runtime', 'src', 'hmr-client.js');
      if (existsSync(hmrPath)) {
        const hmrContent = readFileSync(hmrPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(hmrContent);
        return;
      }
    }

    // ── Static files ──
    if (url.pathname.startsWith('/_vesk/static/')) {
      const relPath = url.pathname.replace('/_vesk/static/', '').replace(/\.\./g, '');
      const staticPath = resolve(devDir, 'static', relPath);
      // Path traversal check
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

    // Public files (served at root — check source overrides first, then build output)
    if (url.pathname !== '/') {
      const sanitized = url.pathname.replace(/\.\./g, '');

      // Source public/ dir (user overrides)
      const sourcePath = resolve(publicDir, sanitized.slice(1));
      if (sourcePath.startsWith(publicDir) && existsSync(sourcePath) && statSync(sourcePath).isFile()) {
        const ext = extname(sourcePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(sourcePath));
        return;
      }

      // Build output static/public/ dir (auto-generated SEO files, favicon, etc.)
      const buildPublicDir = resolve(devDir, 'static', 'public');
      const buildPath = resolve(buildPublicDir, sanitized.slice(1));
      if (buildPath.startsWith(buildPublicDir) && existsSync(buildPath) && statSync(buildPath).isFile()) {
        const ext = extname(buildPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(buildPath));
        return;
      }
    }

    // ── API Routes ──
    if (config && url.pathname.startsWith('/api')) {
      const apiRoute = config.routes.find(r => r.type === 'api' && matchPath(r.path, url.pathname));
      if (apiRoute) {
          const handlerPath = resolve(devDir, apiRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`);
            const webRequest = makeWebRequest(req, url.href);
            const response = await mod.handle(webRequest);
            const body = await response.text();
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(body);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }
      }
    }

    // ── SSR Routes ──
    if (config) {
      const ssrRoute = config.routes.find(r => r.type === 'ssr' && matchPath(r.path, url.pathname));
      if (ssrRoute) {
          const handlerPath = resolve(devDir, ssrRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`);
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
            res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>`);
          }
          return;
        }
      }
    }

    // ── SPA Fallback — serve root route for unmatched non-API, non-static routes ──
    if (config) {
      const rootRoute = config.routes.find(r => r.type === 'ssr' && r.path === '/');
      if (rootRoute) {
        const handlerPath = resolve(devDir, rootRoute.function);
        if (existsSync(handlerPath)) {
          try {
            const mod = await import(`${handlerPath}?t=${ssrVersion}`);
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
            res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>`);
          }
          return;
        }
      }
    }

    // ── 404 ──
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>`);
  });

  // ── Start HMR WebSocket server ──
  const hmr = createHmrServer(server, appDir, devDir, componentMap);

  // ── Watch src/ directory for CSS changes ──
  const srcDir = resolve(appDir, '..', 'src');
  const cssWatcher = setInterval(() => {}, 0); // noop placeholder

  try {
    if (existsSync(srcDir)) {
      watch(srcDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith('.css')) {
          doBuild();
        }
      });
    }
  } catch {
    // src/ dir not available
  }

  // ── File watcher ──
  let debounceTimer = null;
  let pendingFiles = new Set();

  try {
    watch(appDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (debounceTimer) clearTimeout(debounceTimer);

      pendingFiles.add(filename);
      debounceTimer = setTimeout(() => {
        const files = [...pendingFiles];
        pendingFiles = new Set();

        // Check config files first (full rebuild)
        const configFiles = files.filter(f =>
          f === 'vesk.config.ts' || f === 'vesk.config.js' ||
          f === 'tsconfig.json' || f === 'package.json' ||
          f.endsWith('/vesk.config.ts') || f.endsWith('/vesk.config.js') ||
          f.endsWith('/tsconfig.json') || f.endsWith('/package.json')
        );

        // Check API/middleware files next (full rebuild)
        const apiMiddlewareFiles = files.filter(f =>
          (f.includes('/api/') || f === 'middleware.ts' || f.endsWith('/middleware.ts')) &&
          (f.endsWith('.ts') || f.endsWith('.js'))
        );

        // Process .vsk files incrementally
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
    console.error(`vesk dev: file watching unavailable`);
  }

  server.listen(port, () => {
    console.error(`vesk dev server at http://localhost:${port}`);
  });

  await new Promise(() => {});
}

function matchPath(pattern, pathname) {
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
