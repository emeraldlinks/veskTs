import { readFileSync, existsSync, watch, statSync } from 'fs';
import { resolve, extname } from 'path';
import { createServer } from 'node:http';
import { build } from './index.js';
import { createHmrServer } from './hmr.js';

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

  let config = null;
  let lastBuild = 0;
  let routeTree = [];

  async function doBuild() {
    const start = Date.now();
    try {
      const result = await build(appDir, { outDir: devDir, publicDir });
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

    // ── Static files ──
    if (url.pathname.startsWith('/_vesk/static/')) {
      const relPath = url.pathname.replace('/_vesk/static/', '');
      const staticPath = resolve(devDir, 'static', relPath);
      if (existsSync(staticPath) && statSync(staticPath).isFile()) {
        const ext = extname(staticPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(staticPath));
        return;
      }
    }

    // Public files (served at root)
    if (url.pathname !== '/') {
      const publicPath = resolve(publicDir, url.pathname.slice(1));
      if (existsSync(publicPath) && statSync(publicPath).isFile()) {
        const ext = extname(publicPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(publicPath));
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
            const mod = await import(`${handlerPath}?t=${lastBuild}`);
            const webRequest = new Request(url.href, {
              method: req.method || 'GET',
              headers: req.headers,
            });
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
            const mod = await import(`${handlerPath}?t=${lastBuild}`);
            const webRequest = new Request(url.href, {
              method: req.method || 'GET',
              headers: req.headers,
            });
            const response = await mod.handle(webRequest);
            const body = await response.text();

            const headers = Object.fromEntries(response.headers);
            res.writeHead(response.status, headers);
            res.end(body);
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>${e.message}</pre></body></html>`);
          }
          return;
        }
      }
    }

    // ── 404 ──
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`);
  });

  // ── Start HMR WebSocket server ──
  const hmr = createHmrServer(server, appDir, devDir);

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
          for (const f of vskFiles) {
            hmr.handleFileChange(f, doBuild, routeTree);
          }
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
