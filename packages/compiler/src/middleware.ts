import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractMiddleware } from '@vesk/compiler/src/router';
import { parseCookies } from '@vesk/compiler/src/api-routes';
import { toHeadersMap } from '@vesk/runtime/src/request';
import { PREVIOUS_ROUTE_HEADER, resolvePreviousRoute, sanitizePreviousRoute } from '@vesk/runtime/src/previous-route';
import type { RouteNode } from '@vesk/compiler/src/types';
import type { VeskPlugin, MiddlewareContext, MiddlewareChainOptions } from '@vesk/compiler/src/types';
import { isWhitespaceChar } from '@vesk/compiler/src/scan';

export interface MiddlewareEntry {
  sourcePath: string;
  node: RouteNode;
}

export function collectMiddlewareChain(routeTree: RouteNode[], url: string, appDir: string): MiddlewareEntry[] {
  const parts = url.split('/').filter(Boolean);
  const chain: MiddlewareEntry[] = [];

  function walk(nodes: RouteNode[], depth: number): boolean {
    for (const node of nodes) {
      if (node.isGroup) {
        if (walk(node.children, depth)) return true;
        continue;
      }

      if (node.fullPath === '/') {
        collectForNode(node);
        return walk(node.children, depth);
      }

      if (depth >= parts.length) {
        if (node.page) {
          collectForNode(node);
          return true;
        }
        continue;
      }

      const part = parts[depth];

      if (node.isCatchAll) {
        collectForNode(node);
        return true;
      }

      if (node.isDynamic) {
        if (tryCollectAndRecurse(node, depth)) return true;
        continue;
      }

      if (node.path === part) {
        if (tryCollectAndRecurse(node, depth)) return true;
        continue;
      }
    }
    return false;
  }

  function collectForNode(node: RouteNode): void {
    if (node.hasMiddleware) {
      const mwPath = resolve(appDir, node.sourceDir, 'middleware.ts');
      if (existsSync(mwPath)) {
        chain.push({ sourcePath: mwPath, node });
      }
    }
  }

  function tryCollectAndRecurse(node: RouteNode, depth: number): boolean {
    collectForNode(node);
    if (node.children.length > 0) {
      return walk(node.children, depth + 1);
    }
    return !!node.page;
  }

  const root = routeTree.find(n => n.fullPath === '/');
  if (root) {
    collectForNode(root);
    walk(root.children, 0);
  } else {
    walk(routeTree, 0);
  }

  return chain;
}

export async function loadMiddleware(sourcePath: string): Promise<((ctx: any, next: any) => any) | null> {
  if (sourcePath.endsWith('.vsk')) {
    const src = extractMiddleware(sourcePath);
    if (!src) return null;
    return eval(`(${src})`) as (ctx: any, next: any) => any;
  }
  if (sourcePath.endsWith('.js') || sourcePath.endsWith('.ts')) {
    try {
      const url = new URL('file://' + sourcePath);
      url.searchParams.set('t', String(Date.now()) + Math.random().toString(36).slice(2));
      const mod = await import(url.href) as Record<string, unknown>;
      return (mod.middleware || mod.default || null) as ((ctx: any, next: any) => any) | null;
    } catch {
      return null;
    }
  }
  return null;
}

function __mwCloneResponse(res: any): any {
  if (!res || !(res instanceof Response)) return res;
  const r = res as any;
  const VeskRes = (globalThis as any).VeskResponse;
  const init: ResponseInit = { status: r.status, statusText: r.statusText, headers: new Headers(r.headers) };
  let out: any;
  try {
    out = VeskRes ? new VeskRes(r.body, init) : new Response(r.body, init);
  } catch {
    out = new Response(r.body, init);
  }
  try {
    if (Array.isArray(r._cookieHeaders)) {
      if (Array.isArray(out._cookieHeaders)) out._cookieHeaders.push(...r._cookieHeaders);
      else out._cookieHeaders = [...r._cookieHeaders];
    }
    if (r._secHeaders && typeof r._secHeaders === 'object') {
      out._secHeaders = { ...(out._secHeaders && typeof out._secHeaders === 'object' ? out._secHeaders : {}), ...r._secHeaders };
    }
    if (r._finalStatus != null && out._finalStatus == null) out._finalStatus = r._finalStatus;
  } catch {}
  // Flush queued cookies/security headers onto the outgoing Headers so pass-through mutations are visible.
  if (typeof out.build === 'function') try { out.build(); } catch {}
  return out;
}

function __mwMakeResponse(body: unknown, init?: ResponseInit): Response {
  const VeskRes = (globalThis as any).VeskResponse;
  try {
    if (VeskRes) return new VeskRes(body, init);
  } catch {}
  return new Response(body as BodyInit, init);
}

function __mwBindResult(data: unknown, schema: unknown): { data?: unknown; error?: unknown } {
  if (schema && typeof (schema as { safeParse?: unknown }).safeParse === 'function') {
    try {
      const parsed = (schema as { safeParse: (d: unknown) => { success: boolean; data?: unknown; error?: unknown } }).safeParse(data);
      if (parsed && typeof parsed === 'object' && 'success' in parsed) {
        return parsed.success ? { data: parsed.data } : { error: parsed.error };
      }
    } catch (e) {
      return { error: e };
    }
  }
  return { data };
}

function __mwApplyPending(ctx: Record<string, unknown>, res: unknown): any {
  if (!res || !(res instanceof Response)) return res;
  const pending = ctx.__pendingHeaders as Record<string, string> | undefined;
  if (!pending) return res;
  const keys = Object.keys(pending);
  if (!keys.length) return res;
  const out = __mwCloneResponse(res);
  try {
    for (const key of keys) out.headers.set(key, pending[key]);
  } catch {}
  return out;
}

export async function executeMiddlewareChain(
  chain: MiddlewareEntry[],
  request: Request,
  params: Record<string, string>,
  options: MiddlewareChainOptions = {}
): Promise<{ response: Response | null; redirected: boolean; locals: Record<string, unknown>; rewriteUrl: string | null }> {
  const { onLast, plugins } = options;
  const url = new URL(request.url, 'http://localhost');
  const serverStore = (globalThis as Record<string, unknown>).__vesk_server_ctx as Record<string, unknown> | undefined;
  const locals: Record<string, unknown> = Object.assign({}, serverStore || {});
  const cookies = parseCookies(request.headers?.get('cookie') || '');

  let __aborted = false;
  let __abortResponse: Response | null = null;
  const __errors: Array<{ error: unknown }> = [];
  const __requestHeaders = toHeadersMap(request.headers);
  const __requestQuery: Record<string, string> = {};
  for (const [key, value] of url.searchParams) __requestQuery[key] = value;
  const __previousRouteBase = () => resolvePreviousRoute({
    headers: __requestHeaders,
    query: __requestQuery,
    origin: url.origin,
  });
  let __previousRouteOverride: string | null = null;
  const __pendingHeaders: Record<string, string> = {};

  const ctx = new Proxy({
    request,
    params,
    url,
    locals,
    headers: __requestHeaders,
    cookies,
    errors: __errors,
    set(key: string, value: unknown) {
      locals[key] = value;
    },
    get(key: string) {
      return locals[key];
    },
    __pendingHeaders,
    cookie(name: string) {
      return cookies.get(name);
    },
    get previousRoute(): string | null {
      if (__previousRouteOverride !== null) return __previousRouteOverride;
      return __previousRouteBase().route;
    },
    set previousRoute(value: unknown) {
      const safe = sanitizePreviousRoute(value, url.origin);
      __previousRouteOverride = safe;
      if (safe) __pendingHeaders[PREVIOUS_ROUTE_HEADER] = safe;
      else delete __pendingHeaders[PREVIOUS_ROUTE_HEADER];
    },
    get previousRouteInfo() {
      const info = __previousRouteBase();
      if (__previousRouteOverride === null) return info;
      return { ...info, route: __previousRouteOverride, source: PREVIOUS_ROUTE_HEADER };
    },
    get previousRouteHeaders() {
      return __previousRouteBase().headers;
    },
    getHeader(name: string) {
      return request.headers.get(name);
    },
    header(name: string, value: string | null | undefined) {
      const key = String(name).toLowerCase();
      if (value == null) delete __pendingHeaders[key];
      else __pendingHeaders[key] = String(value);
    },
    status(code: number) {
      return __mwCloneResponse(__mwMakeResponse(null, { status: code }));
    },
    json(body: unknown, init?: ResponseInit) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, init?.headers || {});
      const VeskRes = (globalThis as any).VeskResponse;
      try {
        if (VeskRes && typeof VeskRes.json === 'function') {
          return __mwCloneResponse(VeskRes.json(body, { ...init, headers }));
        }
      } catch {}
      return __mwCloneResponse(new Response(JSON.stringify(body), { ...init, headers }));
    },
    text(body: string, init?: ResponseInit) {
      return __mwCloneResponse(__mwMakeResponse(body, init));
    },
    html(body: string, init?: ResponseInit) {
      const headers = Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, init?.headers || {});
      return __mwCloneResponse(__mwMakeResponse(body, { ...init, headers }));
    },
    redirect(target: string, status = 302) {
      return __mwCloneResponse(__mwMakeResponse(null, { status, headers: { Location: target } }));
    },
    shouldBindQuery(schema?: unknown) {
      try {
        const queryUrl = new URL(request.url, 'http://localhost');
        const data = Object.fromEntries(queryUrl.searchParams.entries());
        return __mwBindResult(data, schema);
      } catch (e) {
        return { error: e };
      }
    },
    bindQuery(schema?: unknown) {
      const result = (this as any).shouldBindQuery(schema) as { data?: Record<string, string>; error?: unknown };
      if (result.error) throw result.error;
      return result.data;
    },
    async shouldBindJSON(schema?: unknown) {
      try {
        const clone = typeof request.clone === 'function' ? request.clone() : request;
        const data = await clone.json();
        return __mwBindResult(data, schema);
      } catch (e) {
        return { error: e };
      }
    },
    async bindJSON(schema?: unknown) {
      const result = await (this as any).shouldBindJSON(schema) as { data?: unknown; error?: unknown };
      if (result.error) throw result.error;
      return result.data;
    },
    error(err: unknown) {
      __errors.push({ error: err });
      return err;
    },
    abort() {
      __aborted = true;
    },
    isAborted() {
      return __aborted;
    },
    abortWithStatus(status: number) {
      __aborted = true;
      const VeskRes = (globalThis as any).VeskResponse;
      __abortResponse = __mwCloneResponse(VeskRes ? new VeskRes(null, { status }) : new Response(null, { status }));
      return __abortResponse;
    },
    abortWithStatusJSON(status: number, body: unknown) {
      __aborted = true;
      const VeskRes = (globalThis as any).VeskResponse;
      __abortResponse = __mwCloneResponse(VeskRes && typeof VeskRes.json === 'function' ? VeskRes.json(body, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
      return __abortResponse;
    },
  } as Record<string, unknown>, {
    get(target: Record<string, unknown>, prop: string | symbol): unknown {
      if (prop in target) return target[prop as string];
      return locals[prop as string];
    },
  });

  if (plugins && plugins.length > 0) {
    for (const plugin of plugins) {
      if (plugin.provides) {
        for (const [key, factory] of Object.entries(plugin.provides)) {
          if (typeof factory === 'function' && !(factory instanceof RegExp)) {
            try {
              (ctx as any).set(key, await factory());
            } catch {
              // factory failed — skip this provide
            }
          } else {
            (ctx as any).set(key, factory);
          }
        }
      }
      if (typeof plugin.onRequest === 'function') {
        await plugin.onRequest(ctx as MiddlewareContext);
      }
    }
  }

  let rewriteUrl: string | null = null;

  if (chain.length === 0) {
    if (onLast) {
      const prev = (globalThis as Record<string, unknown>).__vesk_request;
      (globalThis as Record<string, unknown>).__vesk_request = ctx as unknown as Record<string, unknown>;
      try {
        const loneResponse = await onLast(rewriteUrl, ctx as MiddlewareContext);
        const normalized = __mwApplyPending(ctx as any, __mwCloneResponse(loneResponse as any)) as Response | null;
        return { response: normalized ?? null, redirected: !!normalized && normalized.status >= 300 && normalized.status < 400, locals, rewriteUrl };
      } finally {
        (globalThis as Record<string, unknown>).__vesk_request = prev;
      }
    }
    return { response: null, redirected: false, locals, rewriteUrl: null };
  }

  async function runMiddleware(index: number): Promise<Response | null> {
    if (__aborted) return __abortResponse;
    if (index >= chain.length) {
      if (onLast) {
        const out = await onLast(rewriteUrl, ctx as MiddlewareContext);
        return __mwCloneResponse(out as any) as Response | null;
      }
      return null;
    }

    const { sourcePath } = chain[index];
    const fn = await loadMiddleware(sourcePath);
    if (!fn) {
      return runMiddleware(index + 1);
    }

    let nextCalled = false;
    let nextResult: Response | null = null;
    async function next(rewrite?: string): Promise<Response> {
      if (__aborted) return (__abortResponse as Response) ?? (null as unknown as Response);
      if (nextCalled) return null as unknown as Response;
      nextCalled = true;
      if (rewrite) {
        rewriteUrl = rewrite;
        try {
          const newUrl = new URL(rewrite, 'http://localhost');
          ctx.url = newUrl;
        } catch {
          const base = new URL(request.url, 'http://localhost');
          ctx.url = new URL(rewrite, base.origin);
        }
      }
      nextResult = await runMiddleware(index + 1);
      return nextResult as Response;
    }

    try {
      const result = await fn(ctx, next);
      if (__aborted) return __abortResponse || __mwCloneResponse(nextResult as any) || __mwCloneResponse(result as any) as any;
      if (result instanceof Response) {
        return __mwCloneResponse(result) as Response;
      }
      if (nextResult !== null && (nextResult as unknown) instanceof Response) {
        return __mwCloneResponse(nextResult) as Response;
      }
      if (!nextCalled) {
        return runMiddleware(index + 1);
      }
      return null;
    } catch (e: unknown) {
      __errors.push({ error: e });
      const err = e as Error & { name: string; status?: number; url?: string };
      if (err.name === 'Redirect') {
        return __mwCloneResponse(new Response(null, {
          status: err.status || 302,
          headers: { Location: err.url || '' },
        })) as Response;
      }
      // undici's `Response.redirect()` rejects *relative* URLs with a
      // TypeError ("Failed to parse URL from /login"). A middleware returning
      // `Response.redirect('/login', 302)` should work just like
      // `ServerResponse.redirect('/login')` — normalize it into a redirect
      // response instead of surfacing a 500.
      const msg = String(err.message);
      const urlPrefix = 'Failed to parse URL from ';
      if (e instanceof TypeError && msg.startsWith(urlPrefix)) {
        const rest = msg.slice(urlPrefix.length);
        let end = 0;
        while (end < rest.length && !isWhitespaceChar(rest[end])) end++;
        const target = rest.slice(0, end);
        return __mwCloneResponse(new Response(null, { status: 302, headers: { Location: target } })) as Response;
      }
      // Any other TypeError from the middleware (e.g. reading a property of
      // `undefined` like `ctx.cookies[SESSION_COOKIE]` when `ctx.cookies` is
      // missing) must not crash the server. On serverless platforms (Vercel,
      // Netlify, Cloudflare) an uncaught throw surfaces as
      // FUNCTION_INVOCATION_FAILED — Next.js avoids this by wrapping entry
      // points the same way. Return a 500 instead.
      if (e instanceof TypeError) {
        return __mwCloneResponse(new Response(null, { status: 500 })) as Response;
      }
      throw e;
    }
  }

  // Ensure the outermost ctx is available as __vesk_request during the chain,
  // so that server locals / onLast rendering sees middleware locals.
  const prevOuter = (globalThis as Record<string, unknown>).__vesk_request;
  (globalThis as Record<string, unknown>).__vesk_request = ctx as unknown as Record<string, unknown>;
  let response: Response | null;
  try {
    response = await runMiddleware(0);
  } finally {
    (globalThis as Record<string, unknown>).__vesk_request = prevOuter;
  }
  const finalResponse = __mwApplyPending(ctx as any, __mwCloneResponse(response as any)) as Response | null;
  return { response: finalResponse, redirected: !!finalResponse && finalResponse.status >= 300 && finalResponse.status < 400, locals, rewriteUrl };
}
