import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';
import { createServer } from 'node:http';
import { securityHeaders } from '../../compiler/src/server-utils.js';

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

export async function startProdServer(outDir, options = {}) {
  const port = options.port || 3000;
  const staticDir = resolve(outDir, 'static');
  const configPath = resolve(outDir, 'config.json');

  if (!existsSync(configPath)) {
    console.error(`vesk start: no build found at ${outDir}`);
    console.error(`Run "vesk build" first`);
    process.exit(1);
  }

  const buildConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.error(`vesk start: serving from ${outDir}`);

  // ── Load security config from vesk.config (alongside build output) ──
  const projectDir = resolve(outDir, '..');
  let securityConfig = {};
  try {
    const veskConfigPath = resolve(projectDir, 'vesk.config.js');
    const veskConfigTsPath = resolve(projectDir, 'vesk.config.ts');
    let rawConfig = {};
    if (existsSync(veskConfigPath)) {
      rawConfig = require(veskConfigPath);
    } else if (existsSync(veskConfigTsPath)) {
      const { transpile } = require('typescript');
      const src = readFileSync(veskConfigTsPath, 'utf-8');
      const result = transpile(src, { module: 99, target: 99 });
      rawConfig = eval(result);
    }
    if (typeof rawConfig === 'function') rawConfig = rawConfig();
    securityConfig = rawConfig.security || {};
  } catch {}

  // ── Rate limiter ──
  let rateLimiter = null;
  if (securityConfig.rateLimit) {
    const rlConfig = securityConfig.rateLimit;
    const { createRateLimiter } = await import('../../compiler/src/server-codegen.js');
    rateLimiter = createRateLimiter({ windowMs: rlConfig.windowMs || 60000, max: rlConfig.max || 100 });
  }

  // Cache SSR and API function modules
  const functionCache = new Map();

  async function loadFunction(funcPath) {
    if (functionCache.has(funcPath)) return functionCache.get(funcPath);
    const fullPath = resolve(outDir, funcPath);
    if (!existsSync(fullPath)) return null;
    try {
      const mod = await import(`${fullPath}?t=${Date.now()}`);
      functionCache.set(funcPath, mod);
      return mod;
    } catch {
      return null;
    }
  }

  function matchPath(pattern, pathname) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    let pi = 0, pp = 0;
    const params = {};
    while (pi < pathParts.length && pp < patternParts.length) {
      if (patternParts[pp].startsWith(':')) {
        const name = patternParts[pp].slice(1);
        params[name] = pathParts[pi];
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

  // ── trustProxy helper for production server ──
  function getClientIpFromReq(req) {
    if (!securityConfig.trustProxy) return req.socket?.remoteAddress || 'unknown';
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0]).trim();
    return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // ── Rate limiting ──
    if (rateLimiter) {
      const clientIp = getClientIpFromReq(req);
      if (!rateLimiter.check(clientIp)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((securityConfig.rateLimit?.windowMs || 60000) / 1000)) });
        res.end(JSON.stringify({ error: 'Too Many Requests' }));
        return;
      }
    }

    // ── Security headers on every response ──
    const origWriteHead = res.writeHead.bind(res);
    let secHeadersApplied = false;
    res.writeHead = (statusCode, headers) => {
      if (!secHeadersApplied) {
        secHeadersApplied = true;
        const sh = securityHeaders({ security: securityConfig });
        headers = { ...sh, ...headers };
      }
      return origWriteHead(statusCode, headers);
    };

    // ── Root-level public files (served at /) ──
    const publicDir = resolve(staticDir, 'public');
    const sanitized = url.pathname.replace(/\.\./g, '');
    const rootFile = resolve(publicDir, sanitized.slice(1));
    if (rootFile.startsWith(publicDir) && existsSync(rootFile) && statSync(rootFile).isFile()) {
      const ext = extname(rootFile);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(rootFile));
      return;
    }

    // ── Runtime module (aliased to client bundle for dynamic import support) ──
    if (url.pathname === '/_vesk/runtime.js') {
      const clientPath = resolve(staticDir, 'client.js');
      if (existsSync(clientPath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(readFileSync(clientPath));
        return;
      }
    }

    // ── Static files (under /_vesk/static/) ──
    if (url.pathname.startsWith('/_vesk/static/')) {
      const relPath = url.pathname.replace('/_vesk/static/', '').replace(/\.\./g, '');
      const staticPath = resolve(staticDir, relPath);
      if (!staticPath.startsWith(staticDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (existsSync(staticPath) && statSync(staticPath).isFile()) {
        const ext = extname(staticPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(staticPath));
        return;
      }
    }

    // ── Prerendered HTML ──
    if (buildConfig.prerendered) {
      const prerendered = buildConfig.prerendered.find(r => r.path === url.pathname);
      if (prerendered) {
        const htmlPath = resolve(outDir, prerendered.file);
        if (existsSync(htmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(readFileSync(htmlPath));
          return;
        }
      }
    }

    // ── API Routes ──
    if (url.pathname.startsWith('/api')) {
      for (const route of buildConfig.routes) {
        if (route.type === 'api') {
          const params = matchPath(route.path, url.pathname);
          if (params) {
            const mod = await loadFunction(route.function);
            if (mod) {
              try {
                const webRequest = makeWebRequest(req, url.href);
                const response = await mod.handle(webRequest);
                const body = await response.text();
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(body);
                return;
              } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
                return;
              }
            }
          }
        }
      }
    }

    // ── SSR Routes ──
    for (const route of buildConfig.routes) {
      if (route.type === 'ssr') {
        const params = matchPath(route.path, url.pathname);
        if (params) {
          const mod = await loadFunction(route.function);
          if (mod) {
            try {
              const webRequest = makeWebRequest(req, url.href);

              // Check ISR cache first
              let cachedResult = null;
              if (route.revalidate && route.revalidate > 0) {
                const { pageIsr } = await import('@vesk/runtime');
                cachedResult = await pageIsr(url.pathname, async () => {
                  const response = await mod.handle(webRequest);
                  return { html: await response.text(), headers: Object.fromEntries(response.headers) };
                }, { revalidate: route.revalidate, tags: route.tags || [] });
              }

              if (cachedResult) {
                res.writeHead(200, cachedResult.headers || { 'Content-Type': 'text/html' });
                res.end(cachedResult.html);
                return;
              }

              // Stream the SSR response chunk by chunk
              const response = await mod.handle(webRequest);
              const contentType = response.headers.get('content-type') || 'text/html';
              const contentLength = response.headers.get('content-length');
              const headers = { 'Content-Type': contentType };
              if (contentLength) headers['Content-Length'] = contentLength;

              if (response.body && typeof response.body.getReader === 'function') {
                res.writeHead(response.status, headers);
                const reader = response.body.getReader();
                const pump = () => {
                  reader.read().then(({ done, value }) => {
                    if (done) { res.end(); return; }
                    res.write(value);
                    pump();
                  }).catch(() => res.end());
                };
                pump();
              } else {
                const body = await response.text();
                res.writeHead(response.status, headers);
                res.end(body);
              }
              return;
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>`);
              return;
            }
          }
        }
      }
    }

    // ── SPA Fallback — serve root route for unmatched routes ──
    if (buildConfig) {
      const rootRoute = buildConfig.routes.find(r => r.type === 'ssr' && r.path === '/');
      if (rootRoute) {
        const mod = await loadFunction(rootRoute.function);
        if (mod) {
          try {
            const webRequest = makeWebRequest(req, url.href);
            const response = await mod.handle(webRequest);
            const body = await response.text();
            const headers = Object.fromEntries(response.headers);
            res.writeHead(200, headers);
            res.end(body);
            return;
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>`);
            return;
          }
        }
      }
    }

    // ── 404 ──
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>`);
  });

  server.listen(port, () => {
    console.error(`vesk production server at http://localhost:${port}`);
  });

  return server;
}
