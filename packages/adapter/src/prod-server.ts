import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRateLimiter, resolveComponentName, safeJsonForScript, getClientProtocol, DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-codegen';
import { securityHeaders } from '@vesk/compiler/src/server-utils';
import { resolveWithin } from '@vesk/adapter/src/paths';
import type { SecurityConfig } from '@vesk/adapter/src/types';

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

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

export function bodyTooLarge(maxBytes: number): Error & { status: number } {
  const err = new Error(`Request body exceeds limit (${maxBytes} bytes)`) as Error & { status: number };
  err.status = 413;
  return err;
}

function errorStatus(e: unknown, fallback: number): number {
  const s = (e as { status?: unknown } | null)?.status ?? (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : fallback;
}

interface ExtendedRequest extends Request {
  json(): Promise<unknown>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  clone(): ExtendedRequest;
  cookies: Record<string, string>;
  query: Record<string, string>;
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
  const cookies: Record<string, string> = {};
  for (const [k, v] of String(nodeReq.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean)) {
    const eq = k.indexOf('=');
    if (eq > -1) cookies[k.slice(0, eq)] = decodeURIComponent(k.slice(eq + 1));
  }
  webRequest.cookies = cookies;
  const query: Record<string, string> = {};
  for (const [k, v] of parsedUrl.searchParams.entries()) query[k] = v;
  webRequest.query = query;
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
  actions?: Array<{ id: string; function: string }>;
}

interface MatchPathResult {
  [key: string]: string;
}

export async function startProdServer(outDir: string, options?: { port?: number; host?: string; maxBodyBytes?: number }): Promise<Server> {
  const port = options?.port || 3000;
  const host = options?.host || '127.0.0.1';
  const maxBodyBytes = options?.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  // Production default: generated handlers consult this to gate error details.
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
  const staticDir = resolve(outDir, 'static');
  const configPath = resolve(outDir, 'config.json');

  if (!existsSync(configPath)) {
    console.error(`vesk start: no build found at ${outDir}`);
    console.error('Run "vesk build" first');
    process.exit(1);
  }

  const buildConfig: BuildConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.error(`vesk start: serving from ${outDir}`);

  const projectDir = resolve(outDir, '..');
  let securityConfig: SecurityConfig = {};
  let mdConfig: Record<string, unknown> | undefined;
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
    mdConfig = configObj.md as Record<string, unknown> | undefined;
  } catch (e) {
    // Fail closed: keep the secure defaults above and warn loudly — a broken
    // config must never silently disable the app's chosen security policy.
    console.error('vesk start: failed to load vesk.config — falling back to secure defaults:', e instanceof Error ? e.message : e);
  }
  if (mdConfig) {
    try {
      const { configureMd } = await import('@vesk/runtime/src/md') as { configureMd: (p?: unknown) => void };
      configureMd(mdConfig);
    } catch { /* runtime md module unavailable — keep default escape policy */ }
  }

  let rateLimiter: { check: (ip: string) => boolean } | null = null;
  if (securityConfig?.rateLimit) {
    const rlConfig = securityConfig.rateLimit;
    rateLimiter = createRateLimiter({ windowMs: rlConfig.windowMs || 60000, max: rlConfig.max || 100, trustProxy: !!securityConfig?.trustProxy });
  }

  let securityHeadersFn: ((config: Record<string, unknown>) => Record<string, string>) | null = null;
  try {
    securityHeadersFn = securityHeaders;
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

  interface SsrFunctionModule {
    handle: (req: Request) => Promise<Response>;
    handleAction?: (req: Request, id: string) => Promise<Response>;
  }

  const functionCache = new Map<string, SsrFunctionModule>();

  async function loadFunction(funcPath: string): Promise<SsrFunctionModule | null> {
    if (functionCache.has(funcPath)) return functionCache.get(funcPath)!;
    const fullPath = resolve(outDir, funcPath);
    if (!existsSync(fullPath)) return null;
    try {
      const mod = await import(`${fullPath}?t=${Date.now()}`) as SsrFunctionModule;
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
    const reqHost = (req.headers.host as string) || `localhost:${port}`;
    const proto = (req.socket as { encrypted?: boolean }).encrypted
      ? 'https'
      : getClientProtocol({ headers: req.headers } as Record<string, unknown>, !!securityConfig?.trustProxy);
    (globalThis as Record<string, unknown>).__vesk_ssr_base_url = `${proto}://${reqHost}`;

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
    const rootFile = url.pathname.length > 1 ? resolveWithin(publicDir, url.pathname.slice(1)) : null;
    if (rootFile && existsSync(rootFile) && statSync(rootFile).isFile()) {
      const ext = extname(rootFile);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(readFileSync(rootFile));
      return;
    }

    if (url.pathname === '/ssr-data.js') {
      const token = url.searchParams.get('t') || '';
      const store = (globalThis as Record<string, unknown>).__vsk_ssr_data_store as Record<string, { props?: Record<string, unknown>; ssrData?: Record<string, unknown> }> | undefined;
      const payload = store?.[token];
      if (payload) delete store[token];
      const lines: string[] = [];
      // script-safe serialization: props may contain user data
      if (payload?.props) lines.push(`globalThis.__vesk_props = ${safeJsonForScript(JSON.stringify(payload.props))};`);
      if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${safeJsonForScript(JSON.stringify(payload.ssrData))};`);
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      res.end(lines.join('\n') || '// no ssr data');
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
      const relPath = url.pathname.slice('/_vesk/static/'.length);
      const staticPath = resolveWithin(staticDir, relPath);
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
      }      if (mwResult.rewriteUrl) {
        url.pathname = mwResult.rewriteUrl;
      }
    }

    if (url.pathname.startsWith('/_vesk/action/')) {
      const actionId = url.pathname.replace('/_vesk/action/', '');
      const actionEntry = buildConfig.actions && buildConfig.actions.find(a => a.id === actionId);
      if (!actionEntry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Action not found' }));
        return;
      }
      const mod = await loadFunction(actionEntry.function);
      if (!mod || !mod.handleAction) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Action not found' }));
        return;
      }
      try {
        const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
        const response = await mod.handleAction(webRequest, actionId);
        const body = await response.text();
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(body);      } catch (e) {
        const status = errorStatus(e, 500);
        const message = status === 500 && process.env.NODE_ENV === 'production'
          ? 'Internal Server Error'
          : e instanceof Error ? e.message : String(e);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
      return;
    }

    if (url.pathname.startsWith('/api')) {
      for (const route of buildConfig.routes) {
        if (route.type === 'api') {
          const params = matchPath(route.path, url.pathname);
          if (params) {
            const mod = await loadFunction(route.function);
            if (mod) {
              try {
                const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
                const response = await mod.handle(webRequest);
                const body = await response.text();
                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(body);
                return;
              } catch (e) {
                const status = errorStatus(e, 500);
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: status === 500 ? 'Internal Server Error' : e instanceof Error ? e.message : String(e) }));
                return;
              }
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
        const compName = resolveComponentName(src) || 'NotFound';
        notFoundHtml = await renderFullPage(src, compName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: securityConfig?.security || {}, sourcePath: nfPath });
      } catch {}
    }

    for (const route of buildConfig.routes) {
      if (route.type === 'ssr') {
        const params = matchPath(route.path, url.pathname);
        if (params) {
          const mod = await loadFunction(route.function);
            if (mod) {
            try {
              const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
              let cachedResult: { html: string; headers: Record<string, string> } | null = null;
              if (route.revalidate && route.revalidate > 0) {
                const { pageIsr } = await import('@vesk/runtime/src/index-server') as unknown as { pageIsr: (path: string, fn: () => Promise<{ html: string; headers: Record<string, string> }>, opts: { revalidate: number; tags: string[] }) => Promise<{ html: string; headers: Record<string, string> } | null> };
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
              const headers: Record<string, string | number> = Object.fromEntries(response.headers);
              if (!headers['content-type'] && !headers['Content-Type']) headers['Content-Type'] = 'text/html';

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
              const err = e instanceof Error ? e : new Error(String(e));
              if (err.name === 'NotFoundError') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(notFoundHtml || '<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>');
                return;
              }
              console.error('vesk ssr error:', err.message);
              const errPath = resolve(appDir, 'error.vsk');
              let errorHtml: string | null = null;
              if (existsSync(errPath)) {
                try {
                  const runtimePath = resolve(outDir, 'server', 'runtime.js');
                  const { renderFullPage } = await import(runtimePath) as { renderFullPage: (source: string, componentName: string, props: Record<string, unknown>, registry: Map<string, Function>, options: Record<string, unknown>) => Promise<string> };
                  const src = readFileSync(errPath, 'utf-8');
                  const compName = resolveComponentName(src) || 'Error';
                  // never leak stack traces / internal messages to prod error pages
                  const expose = process.env.NODE_ENV !== 'production';
                  errorHtml = await renderFullPage(src, compName, { error: expose ? err.message : 'Internal Server Error', stack: expose ? err.stack : '', statusCode: 500, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: securityConfig?.security || {}, sourcePath: errPath });
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

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(notFoundHtml || '<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>');
  });

  server.listen(port, host, () => {
    console.error(`vesk production server at http://localhost:${port} (listening on ${host})`);
  });

  return server;
}
