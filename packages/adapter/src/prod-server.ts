import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { SecurityConfig } from './types';

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

async function readBody(req: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

interface ExtendedRequest extends Request {
  json(): Promise<unknown>;
  text(): Promise<string>;
  clone(): ExtendedRequest;
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

interface BuildConfigRoute {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
}

interface BuildConfig {
  version: number;
  middleware: boolean;
  routes: BuildConfigRoute[];
  prerendered?: Array<{ path: string; file: string }>;
  static: {
    prefix: string;
    dir: string;
  };
}

interface MatchPathResult {
  [key: string]: string;
}

export async function startProdServer(outDir: string, options?: { port?: number }): Promise<Server> {
  const port = options?.port || 3000;
  const staticDir = resolve(outDir, 'static');
  const configPath = resolve(outDir, 'config.json');
  const compilerSrc = resolve(__dirname, '..', '..', 'compiler', 'src');
  const runtimeSrc = resolve(__dirname, '..', '..', 'runtime', 'src');

  if (!existsSync(configPath)) {
    console.error(`vesk start: no build found at ${outDir}`);
    console.error('Run "vesk build" first');
    process.exit(1);
  }

  const buildConfig: BuildConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.error(`vesk start: serving from ${outDir}`);

  const projectDir = resolve(outDir, '..');
  let securityConfig: SecurityConfig = {};
  try {
    const veskConfigPath = resolve(projectDir, 'vesk.config.js');
    const veskConfigTsPath = resolve(projectDir, 'vesk.config.ts');
    let rawConfig: unknown = {};
    if (existsSync(veskConfigPath)) {
      rawConfig = _require(veskConfigPath);
    } else if (existsSync(veskConfigTsPath)) {
      const { transpile } = _require('typescript') as { transpile: (src: string, opts: Record<string, number>) => string };
      const src = readFileSync(veskConfigTsPath, 'utf-8');
      const result = transpile(src, { module: 99, target: 99 });
      rawConfig = eval(`(${result})`);
    }
    if (typeof rawConfig === 'function') rawConfig = rawConfig();
    const configObj = rawConfig as Record<string, unknown>;
    securityConfig = { security: configObj.security as SecurityConfig['security'] };
  } catch {
    // ignore config load errors
  }

  let rateLimiter: { check: (ip: string) => boolean } | null = null;
  if (securityConfig?.rateLimit) {
    const rlConfig = securityConfig.rateLimit;
    const { createRateLimiter } = await import(resolve(compilerSrc, 'server-codegen.ts')) as { createRateLimiter: (opts: { windowMs: number; max: number }) => { check: (ip: string) => boolean } };
    rateLimiter = createRateLimiter({ windowMs: rlConfig.windowMs || 60000, max: rlConfig.max || 100 });
  }

  let securityHeadersFn: ((config: Record<string, unknown>) => Record<string, string>) | null = null;
  try {
    const securityMod = await import(resolve(compilerSrc, 'server-utils.ts')) as { securityHeaders: (config: Record<string, unknown>) => Record<string, string> };
    securityHeadersFn = securityMod.securityHeaders;
  } catch {
    // security headers not available
  }

  let middlewareMod: { execute: (ctx: Record<string, unknown>) => Promise<{ response: Response | null; rewriteUrl: string | null }> } | null = null;
  const mwPath = resolve(outDir, 'server', 'middleware.js');
  if (existsSync(mwPath)) {
    try {
      middlewareMod = await import(`${mwPath}?t=${Date.now()}`) as { execute: (ctx: Record<string, unknown>) => Promise<{ response: Response | null; rewriteUrl: string | null }> };
    } catch {
      // ignore
    }
  }

  const functionCache = new Map<string, { handle: (req: Request) => Promise<Response> }>();

  async function loadFunction(funcPath: string): Promise<{ handle: (req: Request) => Promise<Response> } | null> {
    if (functionCache.has(funcPath)) return functionCache.get(funcPath)!;
    const fullPath = resolve(outDir, funcPath);
    if (!existsSync(fullPath)) return null;
    try {
      const mod = await import(`${fullPath}?t=${Date.now()}`) as { handle: (req: Request) => Promise<Response> };
      functionCache.set(funcPath, mod);
      return mod;
    } catch {
      return null;
    }
  }

  function matchPath(pattern: string, pathname: string): MatchPathResult | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    let pi = 0, pp = 0;
    const params: MatchPathResult = {};
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

  function getClientIpFromReq(req: IncomingMessage): string {
    if (!securityConfig?.trustProxy) return req.socket?.remoteAddress || 'unknown';
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0]).trim();
    return (req.headers['x-real-ip'] as string) || req.socket?.remoteAddress || 'unknown';
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (rateLimiter) {
      const clientIp = getClientIpFromReq(req);
      if (!rateLimiter.check(clientIp)) {
        const retryAfter = Math.ceil((securityConfig?.rateLimit?.windowMs || 60000) / 1000);
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
        res.end(JSON.stringify({ error: 'Too Many Requests' }));
        return;
      }
    }

    const origWriteHead = res.writeHead.bind(res);
    let secHeadersApplied = false;
    res.writeHead = ((statusCode: number, headers?: Record<string, string | number>) => {
      if (!secHeadersApplied && securityHeadersFn) {
        secHeadersApplied = true;
        const sh = securityHeadersFn({ security: (securityConfig?.security as Record<string, unknown>) || {} });
        headers = { ...sh, ...headers };
      }
      return origWriteHead(statusCode, headers as Record<string, string | number>);
    }) as typeof res.writeHead;

    const publicDir = resolve(staticDir, 'public');
    const sanitized = url.pathname.replace(/\.\./g, '');
    const rootFile = resolve(publicDir, sanitized.slice(1));
    if (rootFile.startsWith(publicDir) && existsSync(rootFile) && statSync(rootFile).isFile()) {
      const ext = extname(rootFile);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(rootFile));
      return;
    }

    if (url.pathname === '/_vesk/runtime.js') {
      const clientPath = resolve(staticDir, 'client.js');
      if (existsSync(clientPath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(readFileSync(clientPath));
        return;
      }
    }

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

    if (middlewareMod) {
      const mwCtx: Record<string, unknown> = {
        request: new Request(url.href, { headers: req.headers as Record<string, string>, method: req.method || 'GET' }),
        params: {},
        url,
        locals: {},
        cookies: {},
        set(key: string, value: unknown) { (this.locals as Record<string, unknown>)[key] = value; },
        get(key: string) { return (this.locals as Record<string, unknown>)[key]; },
      };
      const mwResult = await middlewareMod.execute(mwCtx);
      if (mwResult.response) {
        const body = await mwResult.response.text();
        res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
        res.end(body);
        return;
      }
      if (mwResult.rewriteUrl) {
        url.pathname = mwResult.rewriteUrl;
      }
    }

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
                const message = e instanceof Error ? e.message : String(e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: message }));
                return;
              }
            }
          }
        }
      }
    }

    for (const route of buildConfig.routes) {
      if (route.type === 'ssr') {
        const params = matchPath(route.path, url.pathname);
        if (params) {
          const mod = await loadFunction(route.function);
            if (mod) {
            try {
              const webRequest = makeWebRequest(req, url.href);

              let cachedResult: { html: string; headers: Record<string, string> } | null = null;
              if (route.revalidate && route.revalidate > 0) {
                const { pageIsr } = await import('../../runtime/src/index-server.ts') as unknown as { pageIsr: (path: string, fn: () => Promise<{ html: string; headers: Record<string, string> }>, opts: { revalidate: number; tags: string[] }) => Promise<{ html: string; headers: Record<string, string> } | null> };
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

              const response = await mod.handle(webRequest);
              const contentType = response.headers.get('content-type') || 'text/html';
              const contentLength = response.headers.get('content-length');
              const headers: Record<string, string | number> = { 'Content-Type': contentType };
              if (contentLength) headers['Content-Length'] = contentLength;

              if (response.body && typeof response.body.getReader === 'function') {
                res.writeHead(response.status, headers);
                const reader = response.body.getReader();
                const pump = () => {
                  reader.read().then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
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
              console.error('vesk ssr error:', e instanceof Error ? e.message : String(e));
              const appDir = resolve(projectDir, 'app');
              const errPath = resolve(appDir, 'error.vsk');
              let errorHtml: string | null = null;
              if (existsSync(errPath)) {
                try {
                  const runtimePath = resolve(outDir, 'server', 'runtime.js');
                  const { renderFullPage } = await import(runtimePath) as { renderFullPage: (source: string, componentName: string, props: Record<string, unknown>, registry: Map<string, Function>, options: Record<string, unknown>) => Promise<string> };
                  const src = readFileSync(errPath, 'utf-8');
                  const compNameMatch = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
                  const compName = compNameMatch ? compNameMatch[1] : 'Error';
                  errorHtml = await renderFullPage(src, compName, { error: (e instanceof Error ? e.message : String(e)), stack: (e instanceof Error ? e.stack : ''), statusCode: 500, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: securityConfig?.security || {} });
                } catch {}
              }
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(errorHtml || '<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>');
              return;
            }
          }
        }
      }
    }

    const appDir = resolve(projectDir, 'app');
    const nfPath = resolve(appDir, 'not-found.vsk');
    let notFoundHtml: string | null = null;
    if (existsSync(nfPath)) {
      try {
        const runtimePath = resolve(outDir, 'server', 'runtime.js');
        const { renderFullPage } = await import(runtimePath) as { renderFullPage: (source: string, componentName: string, props: Record<string, unknown>, registry: Map<string, Function>, options: Record<string, unknown>) => Promise<string> };
        const src = readFileSync(nfPath, 'utf-8');
        const compNameMatch = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
        const compName = compNameMatch ? compNameMatch[1] : 'NotFound';
        notFoundHtml = await renderFullPage(src, compName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: securityConfig?.security || {} });
      } catch {}
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(notFoundHtml || '<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>');
  });

  server.listen(port, () => {
    console.error(`vesk production server at http://localhost:${port}`);
  });

  return server;
}
