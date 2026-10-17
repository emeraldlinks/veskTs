import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRateLimiter, resolveComponentName, safeJsonForScript, getClientProtocol, DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-codegen';
import { securityHeaders } from '@vesk/compiler/src/server-utils';
import { cacheControlFor } from '@vesk/adapter/src/asset-hash';
import { reportServerError } from '@vesk/adapter/src/error-report';
import { executeError } from '@vesk/adapter/src/events';
import { resolveWithin, installMdReadHook } from '@vesk/adapter/src/paths';
import { resolveCssUrls, hasBuiltGlobalCss } from '@vesk/adapter/src/css';
import { loadVeskConfig } from '@vesk/adapter/src/load-config';
import { renderDefaultNotFoundPage, renderDefaultErrorPage } from '@vesk/adapter/src/default-pages';
import { installResponsePipeline } from '@vesk/adapter/src/response-pipeline';
import { resolveBoundaryFileForUrl } from '@vesk/adapter/src/ssr-function';
import { makeWebRequest, bodyTooLarge } from '@vesk/adapter/src/web-request';
import { mimeFor } from '@vesk/adapter/src/platform-output';
import type { SecurityConfig, CompressionConfig, ProdServerOptions } from '@vesk/adapter/src/types';

// Re-exported so a host embedding the prod server gets the transport types it
// may need to type its own options without reaching into @vesk/types directly.
export type { CompressionConfig, ProdServerOptions };

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

/** Open-ended content types. Buffering one would hold the response until the
 *  stream closed — which, for a never-ending event stream, is never. */
const STREAMING_TYPES = new Set(['text/event-stream', 'application/x-ndjson']);

/** Above this, a "buffered" body is streamed instead rather than held whole. */
const DELIVER_BUFFER_LIMIT = 1024 * 1024;

/**
 * Writes a handler Response to the socket.
 *
 * A finite body is delivered as ONE `end(buffer)`, not chunk-by-chunk, and that
 * is load-bearing: the response pipeline can only tag a body and revalidate it
 * against `If-None-Match` — and only apply content-encoding — once it can see
 * the whole body. Streaming a 2 KB JSON body would silently opt every API
 * response out of both. A response that turns out to exceed the buffer limit,
 * or that declares an open-ended content type, falls back to streaming so the
 * memory and time-to-first-byte cost of a genuinely large body is unchanged.
 */
async function deliverResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers);
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    res.writeHead(response.status, headers);
    res.end(await response.text());
    return;
  }
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const reader = body.getReader();
  if (STREAMING_TYPES.has(contentType)) {
    res.writeHead(response.status, headers);
    pumpRemaining(res, reader);
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.byteLength;
      if (size > DELIVER_BUFFER_LIMIT) { overflow = true; break; }
    }
  } catch {
    /* stream aborted by the client */
  }
  res.writeHead(response.status, headers);
  if (overflow) {
    for (const chunk of chunks) res.write(chunk);
    pumpRemaining(res, reader);
    return;
  }
  res.end(Buffer.concat(chunks));
}

/** Drain an already-started reader onto the socket, then end it. */
function pumpRemaining(res: ServerResponse, reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void (async () => {
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
  })();
}

function errorStatus(e: unknown, fallback: number): number {
  const s = (e as { status?: unknown } | null)?.status ?? (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : fallback;
}

interface BuildConfigRoute {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
}

interface BuildConfig {
  version: number;
  [key: string]: unknown;
  middleware: boolean;
  routes: BuildConfigRoute[];
  prerendered?: Array<{ path: string; file: string }>;
  static: {
    prefix: string;
    dir: string;
  };
  actions?: Array<{ id: string; function: string }>;
  /** Emitted assets with content hashes (see Manifest.assets). */
  assets?: { hashed: boolean; client: { file: string; url: string; hash: string; bytes: number; integrity: string } };
  /** Build-time-baked onHead-plugin head snippet for not-found/error pages. */
  headExtra?: string;
}

interface MatchPathResult {
  [key: string]: string;
}

export async function startProdServer(outDir: string, options?: ProdServerOptions): Promise<Server> {
  const port = options?.port || 3000;
  const host = options?.host || '127.0.0.1';
  const maxBodyBytes = options?.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  // Production default: generated handlers consult this to gate error details.
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
  const staticDir = resolve(outDir, 'static');
  const configPath = resolve(outDir, 'config.json');
  installMdReadHook([resolve(staticDir, 'public')]);

  if (!existsSync(configPath)) {
    console.error(`vesk start: no build found at ${outDir}`);
    console.error('Run "vesk build" first');
    process.exit(1);
  }

  const buildConfig: BuildConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  // Baked onHead-plugin head snippet (config.json `headExtra`) — applied to
  // pages that render directly here (not-found / error) where no SSR function
  // and no in-process plugin objects exist.
  const bakedHeadExtra: string = buildConfig.headExtra || '';
  console.error(`vesk start: serving from ${outDir}`);

  const projectDir = resolve(outDir, '..');
  let securityConfig: SecurityConfig = {};
  let mdConfig: Record<string, unknown> | undefined;
  let compressionConfig: CompressionConfig = {};
  let healthCheckEnabled = true;
  try {
    const config = await loadVeskConfig(projectDir);
    if (config) {
      securityConfig = { security: config.security as SecurityConfig['security'] };
      mdConfig = config.md as Record<string, unknown> | undefined;
      // `compression: false` disables encoding entirely; an object tunes it.
      compressionConfig = config.compression === false ? { enabled: false } : (config.compression || {});
      healthCheckEnabled = config.healthCheck !== false;
    }
  } catch (e) {
    // Fail closed: keep the secure defaults above and warn loudly — a broken
    // config must never silently disable the app's chosen security policy.
    console.error('vesk start: failed to load vesk.config — falling back to secure defaults:', e instanceof Error ? e.message : e);
  }
  // Explicit server options win over vesk.config (the CLI passes nothing here,
  // so this is the programmatic path — how tests and embedders configure it).
  if (options?.compression !== undefined) {
    compressionConfig = options.compression === false ? { enabled: false } : options.compression;
  }
  if (options?.healthCheck !== undefined) healthCheckEnabled = options.healthCheck !== false;
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

  interface EventsModule {
    onError?: (err: unknown, base?: Record<string, unknown>) => unknown;
    executeStart?: (base?: Record<string, unknown>) => Promise<void>;
    executeRequest?: (base?: Record<string, unknown>) => Promise<void>;
    executeStop?: (base?: Record<string, unknown>) => Promise<void>;
  }
  let eventsMod: EventsModule | null = null;
  const eventsPath = resolve(outDir, 'server', 'events.js');
  if (existsSync(eventsPath)) {
    try {
      eventsMod = await import(`${eventsPath}?t=${Date.now()}`) as EventsModule;
    } catch {
      // ignore
    }
  }

  interface SsrFunctionModule {
    handle: (req: Request) => Promise<Response>;
    handleAction?: (req: Request, id: string) => Promise<Response>;
  }

  const functionCache = new Map<string, SsrFunctionModule>();
  /** Import failures, kept so the same broken module is not re-imported per request. */
  const functionFailures = new Map<string, unknown>();

  /**
   * Load a generated function module.
   *
   * Returns null both for "no such file" and for "the file exists but could not
   * be imported", and the caller cannot tell them apart — which turned a route
   * with a bad import into a **404 with no diagnostic anywhere**. A missing
   * export or an unresolvable dependency is a build bug, and the only evidence
   * was an empty 404. `functionFailure` records what happened so the request
   * path can answer 500 and log it, which is what a broken route is.
   */
  function functionFailure(funcPath: string): unknown {
    return functionFailures.get(funcPath);
  }

  async function loadFunction(funcPath: string): Promise<SsrFunctionModule | null> {
    if (functionCache.has(funcPath)) return functionCache.get(funcPath)!;
    if (functionFailures.has(funcPath)) return null;
    const fullPath = resolve(outDir, funcPath);
    if (!existsSync(fullPath)) return null;
    try {
      const mod = await import(`${fullPath}?t=${Date.now()}`) as SsrFunctionModule;
      functionCache.set(funcPath, mod);
      return mod;
    } catch (e) {
      console.error(`vesk start: failed to load ${funcPath}:`, e instanceof Error ? e.message : e);
      functionFailures.set(funcPath, e);
      return null;
    }
  }

  function matchPath(pattern: string, pathname: string): MatchPathResult | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    let pi = 0, pp = 0;
    const params: MatchPathResult = {};
    while (pi < pathParts.length && pp < patternParts.length) {
      const seg = patternParts[pp];
      if (seg.startsWith('*')) {
        // Catch-all: absorbs every remaining segment (possibly none).
        params[seg.slice(1)] = pathParts.slice(pi).join('/');
        pi = pathParts.length;
        pp++;
      } else if (seg.startsWith(':')) {
        const name = seg.slice(1);
        params[name] = pathParts[pi];
        pi++; pp++;
      } else if (seg === pathParts[pi]) {
        pi++; pp++;
      } else {
        return null;
      }
    }
    // A trailing catch-all still matches with an empty tail (`/api/files` ->
    // `/api/files/*rest` with rest=''). The loop above exits as soon as the
    // URL is exhausted, so without this the catch-all was never reached.
    if (pp === patternParts.length - 1 && patternParts[pp].startsWith('*')) {
      params[patternParts[pp].slice(1)] = pathParts.slice(pi).join('/');
      pp++;
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

    // Liveness probe. Deliberately the FIRST thing in the handler, ahead of the
    // rate limiter, middleware and the pipeline below:
    //  - a probe that can be answered 429 is indistinguishable from a dead
    //    server to an orchestrator, which then restarts a healthy pod;
    //  - it must not be rewritten or authed by user middleware;
    //  - it must never be encoded or tagged — a load balancer revalidating a
    //    cached "ok" is testing its own cache, not this process.
    if (healthCheckEnabled && (url.pathname === '/healthz' || url.pathname === '/_vesk/healthz')) {
      const probe = JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(probe)),
        'Cache-Control': 'no-store',
      });
      res.end(probe);
      return;
    }

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

    // Per-request security overrides (`request.setCsp()`, `.setSecurityHeader()`,
    // `.setRateLimit()`, `.setCsrf()`) accumulate in the runtime's
    // AsyncLocalStorage bag. The server cannot import the runtime directly (it
    // is injected into generated code as a string), so it reads the bridge it
    // registers on globalThis. Without this every one of those setters was a
    // silent no-op.
    const securityBridge = (globalThis as Record<string, unknown>).__vesk_security as {
      run?: <T>(fn: () => T) => T;
      get?: () => Record<string, unknown> | null;
    } | undefined;
    // Rate limiting is enforced BEFORE the handler runs, so a per-request
    // limit set inside the handler cannot apply to this same request. It is
    // surfaced here for the next request on the connection-independent bag;
    // the global limit configured in vesk.config is what gates this one.
    // Wrap a handler call so overrides it records land in a fresh bag that is
    // still readable when the response is written. Falls back to a pass-through
    // when the runtime has not registered its bridge.
    const securityRun = securityBridge?.run;
    const withSecurityScope = securityRun
      ? (fn: () => Promise<Response>): Promise<Response> => securityRun!(fn)
      : (fn: () => Promise<Response>): Promise<Response> => fn();
    const applyOverrideHeaders = (headers: Record<string, string | number>): Record<string, string | number> => {
      const overrides = securityBridge?.get?.();
      if (!overrides) return headers;
      const next: Record<string, string | number> = { ...headers };
      if (typeof overrides.contentSecurityPolicy === 'string') {
        next['Content-Security-Policy'] = overrides.contentSecurityPolicy;
      }
      const custom = overrides.customHeaders as Record<string, string | false> | undefined;
      if (custom) {
        for (const [name, value] of Object.entries(custom)) {
          if (value === false) delete next[name];
          else next[name] = value;
        }
      }
      return next;
    };
    const origWriteHead2 = res.writeHead.bind(res);
    let overridesApplied = false;
    res.writeHead = ((statusCode: number, headers?: Record<string, string | number>) => {
      if (!overridesApplied) {
        overridesApplied = true;
        headers = applyOverrideHeaders((headers || {}) as Record<string, string | number>);
      }
      return origWriteHead2(statusCode, headers as Record<string, string | number>);
    }) as typeof res.writeHead;

    // Installed LAST so it wraps the two header decorators above: its captured
    // `writeHead` is their wrapper, so security headers and per-request
    // overrides are still merged in — once, at flush time. One install covers
    // every response the handler produces (static files, SSR HTML, API JSON,
    // middleware short-circuits), so no call site can be missed.
    installResponsePipeline(res, req, {
      compress: compressionConfig.enabled !== false,
      compressThreshold: compressionConfig.threshold,
      brotliQuality: compressionConfig.brotliQuality,
      gzipLevel: compressionConfig.gzipLevel,
      etag: compressionConfig.etag !== false,
    });

    const publicDir = resolve(staticDir, 'public');
    const rootFile = url.pathname.length > 1 ? resolveWithin(publicDir, url.pathname.slice(1)) : null;
    if (rootFile && existsSync(rootFile) && statSync(rootFile).isFile()) {
      res.writeHead(200, { 'Content-Type': mimeFor(rootFile) });
      res.end(readFileSync(rootFile));
      return;
    }

    if (url.pathname === '/ssr-data.js') {
      const token = url.searchParams.get('t') || '';
      const store = (globalThis as Record<string, unknown>).__vsk_ssr_payload_store as Record<string, { props?: Record<string, unknown>; ssrData?: Record<string, unknown> }> | undefined;
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

    // Persisted-store pre-paint payload (buildStorePrePaintPayload), stashed by
    // storeInitScriptGlobal under its own token store so consuming one never
    // eats the page's /ssr-data.js handoff. Served once, consumed-and-deleted.
    if (url.pathname === '/store-init.js') {
      const token = url.searchParams.get('t') || '';
      const store = (globalThis as Record<string, unknown>).__vsk_store_init_payload_store as Record<string, string> | undefined;
      const payload = store?.[token];
      if (payload) delete store[token];
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      res.end(payload ?? '// no store init');
      return;
    }

    // Stable alias for the client runtime: the file on disk is content-hashed in
    // production, so the name is resolved from the manifest rather than assumed.
    if (url.pathname === '/_vesk/runtime.js') {
      const clientFile = buildConfig?.assets?.client?.file || 'client.js';
      const clientPath = resolve(staticDir, clientFile);
      if (existsSync(clientPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': cacheControlFor(clientFile, false),
        });
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
        res.writeHead(200, {
          'Content-Type': mimeFor(staticPath),
          // A content-hashed name can never change meaning, so it is immutable
          // for a year; anything unhashed must be revalidated or a deploy would
          // serve stale JS forever.
          'Cache-Control': cacheControlFor(basename(staticPath), false),
        });
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

    let mwCtx: Record<string, unknown>;
    const serverStore = (globalThis as Record<string, unknown>).__vesk_server_ctx as Record<string, unknown> | undefined;
    if (middlewareMod) {
      mwCtx = {
        request: new Request(url.href, { headers: req.headers as Record<string, string>, method: req.method || 'GET' }),
        params: {},
        url,
        locals: Object.assign({}, serverStore || {}),
        cookies: {},
        set(key: string, value: unknown) { (this.locals as Record<string, unknown>)[key] = value; },
        get(key: string) { return (this.locals as Record<string, unknown>)[key]; },
      };
    } else {
      mwCtx = {
        params: {},
        url,
        locals: Object.assign({}, serverStore || {}),
        cookies: {},
        request: null,
        set() {},
        get() { return undefined; },
      };
    }
    if (eventsMod) {
      try {
        await eventsMod.executeRequest?.(mwCtx);
      } catch (e) {
        console.error('vesk request: onRequest error:', e instanceof Error ? e.message : e);
      }
    }
    if (middlewareMod) {
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
    // Expose root middleware locals to API/SSR handlers (which seed their own
    // ctx.locals from this before running route-level middleware).
    (globalThis as Record<string, unknown>).__vesk_request = mwCtx;

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
        const handleAction = mod.handleAction!.bind(mod);
        const response = await withSecurityScope(() => handleAction(webRequest, actionId));
        await deliverResponse(res, response);      } catch (e) {
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
            if (!mod) {
              // The route matched, so a 404 would be a lie: the handler is
              // there and could not be loaded.
              if (functionFailure(route.function)) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
                return;
              }
              continue;
            }
            try {
              const webRequest = makeWebRequest(req, url.href, maxBodyBytes);
              const response = await withSecurityScope(() => mod.handle(webRequest));
              await deliverResponse(res, response);
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

    const appDir = resolve(projectDir, 'app');
    const pageCssUrls = resolveCssUrls({
      enabled: hasBuiltGlobalCss(outDir),
    });

    /**
     * Render the boundary that owns `url.pathname`.
     *
     * Deepest-match over the URL's directories, not a hard read of the root
     * file: `app/admin/not-found.vsk` is the boundary for `/admin/*`, and the
     * root one is the fallback. The generated SSR function does the same walk at
     * build time (`resolveNotFoundFile`) and renders the boundary itself inside
     * the layout stack; this path is what remains for an unmatched URL, for a
     * route with no layout (which streams, so its status is already committed),
     * and for an error thrown outside a page's own try block.
     */
    const boundaryCache = new Map<string, string | null>();
    async function renderBoundaryFile(file: 'not-found.vsk' | 'error.vsk', pathname: string, props: Record<string, unknown>): Promise<string | null> {
      const boundaryPath = resolveBoundaryFileForUrl(pathname, appDir, file);
      if (!boundaryPath) return null;
      const key = `${file}:${boundaryPath}`;
      let html = boundaryCache.has(key) ? boundaryCache.get(key)! : null;
      if (html === null) {
        try {
          const runtimePath = resolve(outDir, 'server', 'runtime.js');
          const { renderFullPage, storeDataScriptGlobal } = await import(runtimePath) as { renderFullPage: (source: string, componentName: string, props: Record<string, unknown>, registry: Map<string, Function>, options: Record<string, unknown>) => Promise<string>; storeDataScriptGlobal: (payload: unknown) => string | null };
          const src = readFileSync(boundaryPath, 'utf-8');
          const compName = resolveComponentName(src) || (file === 'error.vsk' ? 'Error' : 'NotFound');
          html = await renderFullPage(src, compName, props, new Map(), { hydrate: true, cssUrls: pageCssUrls, clientScriptUrl: buildConfig?.assets?.client?.url || '/_vesk/static/client.js', clientScriptIntegrity: buildConfig?.assets?.client?.integrity, security: securityConfig?.security || {}, externalDataScript: storeDataScriptGlobal, sourcePath: boundaryPath, headExtra: bakedHeadExtra });
        } catch {
          return null;
        }
      }
      return html;
    }

    let notFoundHtml: string | null = null;
    {
      const rendered = await renderBoundaryFile('not-found.vsk', url.pathname, { params: {}, url: url.pathname });
      notFoundHtml = rendered;
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
                  const response = await withSecurityScope(() => mod.handle(webRequest));
                  return { html: await response.text(), headers: Object.fromEntries(response.headers) };
                }, { revalidate: route.revalidate, tags: route.tags || [] });
              }

              if (cachedResult) {
                res.writeHead(200, cachedResult.headers || { 'Content-Type': 'text/html' });
                res.end(cachedResult.html);
                return;
              }

              const response = await withSecurityScope(() => mod.handle(webRequest));
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
              if (err.name === 'Redirect') {
                const redirect = err as Error & { url?: unknown; status?: unknown };
                res.writeHead(Number(redirect.status) || 302, { Location: typeof redirect.url === 'string' ? redirect.url : '/' });
                res.end();
                return;
              }
              if (err.name === 'NotFoundError') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(notFoundHtml || renderDefaultNotFoundPage({ url: url.pathname, headExtra: bakedHeadExtra }));
                return;
              }
              console.error('vesk ssr error:', err.message);
              // Two seams, both best-effort: a plugin's `onError` (dev-style
              // plugin objects don't exist here) and `_events.ts`'s, which IS
              // baked into the production build.
              await reportServerError(err, {
                url: url.pathname + url.search,
                routePath: route.path,
                target: 'node',
                status: 500,
                buildConfig,
              });
              if (eventsMod) {
                await executeError(err, { url: url.href, routePath: route.path, target: 'node', status: 500 }, eventsMod);
              }
              // Same nearest-boundary walk as not-found above. This is the last resort for a
              // throw the generated function could not absorb — a layout render
              // failure, or the error boundary itself failing — and it must pick
              // the boundary that owns the URL, not the root one.
              const expose = process.env.NODE_ENV !== 'production';
              const errorHtml = await renderBoundaryFile('error.vsk', url.pathname, {
                error: expose ? err.message : 'Internal Server Error',
                stack: expose ? err.stack : '',
                statusCode: 500,
                url: url.pathname,
              });
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(errorHtml || renderDefaultErrorPage({ message: process.env.NODE_ENV !== 'production' ? err.message : undefined, url: url.pathname, headExtra: bakedHeadExtra }));
              return;
            }
          }
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(notFoundHtml || renderDefaultNotFoundPage({ url: url.pathname, headExtra: bakedHeadExtra }));
  });

  try {
    await eventsMod?.executeStart?.({ server, port, host });
  } catch (e) {
    console.error('vesk start: onStart error:', e instanceof Error ? e.message : e);
  }

  server.on('close', () => {
    void (async () => {
      try {
        await eventsMod?.executeStop?.({ server, port, host });
      } catch (e) {
        console.error('vesk stop: onStop error:', e instanceof Error ? e.message : e);
      }
    })();
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`vesk stop: received ${signal}, closing…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  // Named handlers so they can be detached on close. Without this every
  // start/stop cycle leaks two process listeners, which is a hard crash
  // (MaxListenersExceededWarning → throw) once a host restarts the server more
  // than five times — the shape every test harness and hot-restarting dev
  // wrapper uses.
  const onSigint = () => shutdown('SIGINT');
  const onSigterm = () => shutdown('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  server.once('close', () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  });

  server.listen(port, host, () => {
    console.error(`vesk production server at http://localhost:${port} (listening on ${host})`);
  });

  return server;
}
