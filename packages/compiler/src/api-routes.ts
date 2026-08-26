import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { ApiRouteNode } from '@vesk/compiler/src/types';
import { collapseSlashes } from '@vesk/compiler/src/router';
import { assertSameOrigin, DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-utils';

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}



export function scanApiRoutes(apiDir: string): ApiRouteNode[] {
  if (!existsSync(apiDir)) return [];
  return scanApiDir(apiDir, apiDir, '/');
}

function scanApiDir(rootDir: string, dir: string, parentPath: string): ApiRouteNode[] {
  const nodes: ApiRouteNode[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return nodes; }

  let hasRoute = false;
  let routeFileName: string | null = null;
  for (const entry of entries) {
    if (entry === 'route.js' || entry === 'route.ts') {
      hasRoute = true;
      routeFileName = entry;
      break;
    }
  }

  const segName = basename(dir);
  const isDynamic = segName.startsWith('[') && segName.endsWith(']') && !segName.startsWith('[...');
  const isCatchAll = segName.startsWith('[...') && segName.endsWith(']');
  const isPrivate = segName.startsWith('_');
  const isRouteGroup = segName.startsWith('(') && segName.endsWith(')');

  if (isPrivate && dir !== rootDir) return nodes;

  if (isRouteGroup) {
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      let entryStat;
      try { entryStat = statSync(entryPath); } catch { continue; }
      if (entryStat.isDirectory()) {
        const childNodes = scanApiDir(rootDir, entryPath, parentPath);
        nodes.push(...childNodes);
      }
    }
    return nodes;
  }

  let seg = '';
  if (dir === rootDir) {
    seg = '';
  } else if (isDynamic) {
    seg = ':' + segName.slice(1, -1);
  } else if (isCatchAll) {
    seg = ':' + segName.slice(4, -1);
  } else {
    seg = segName;
  }

  const fullPath = seg
    ? (parentPath === '/' ? '/' : parentPath + '/') + seg
    : (parentPath || '/');

  const node: ApiRouteNode = {
    path: seg,
    fullPath: collapseSlashes(fullPath) || '/',
    isDynamic,
    isCatchAll,
    filePath: hasRoute && routeFileName ? join(dir, routeFileName) : null,
    children: [],
  };

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let entryStat;
    try { entryStat = statSync(entryPath); } catch { continue; }
    if (entryStat.isDirectory()) {
      const childNodes = scanApiDir(rootDir, entryPath, fullPath);
      node.children.push(...childNodes);
    }
  }

  if (node.filePath || node.children.length > 0) {
    nodes.push(node);
  }

  return nodes;
}

export function matchApiUrl(tree: ApiRouteNode[], pathname: string): { node: ApiRouteNode; params: Record<string, string> } | null {
  let normalized = pathname.split('?')[0].split('#')[0];
  // strip a leading /api segment (exact or followed by /) without regex
  if (normalized === '/api') {
    normalized = '/';
  } else if (normalized.startsWith('/api/') && !normalized.startsWith('//')) {
    normalized = normalized.slice(4);
  }
  const parts = normalized.split('/').filter(Boolean);
  const params: Record<string, string> = {};

  function matchNodes(nodes: ApiRouteNode[], partIndex: number): ApiRouteNode | null {
    for (const node of nodes) {
      if (node.fullPath === '/') {
        if (partIndex >= parts.length && node.filePath) return node;
        return matchNodes(node.children, partIndex);
      }

      if (partIndex >= parts.length) {
        if (node.filePath) return node;
        continue;
      }

      const part = parts[partIndex];

      if (node.isCatchAll) {
        const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
        params[paramName] = parts.slice(partIndex).map(decodeURIComponent).join('/');
        return node;
      }

      if (node.isDynamic) {
        const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
        params[paramName] = decodeURIComponent(part);
        if (node.children.length > 0) {
          const result = matchNodes(node.children, partIndex + 1);
          if (result) return result;
        }
        if (node.filePath) return node;
        delete params[paramName];
        continue;
      }

      if (node.path === part) {
        if (node.children.length > 0) {
          const result = matchNodes(node.children, partIndex + 1);
          if (result) return result;
        }
        if (node.filePath) return node;
        continue;
      }
    }
    return null;
  }

  const matched = matchNodes(tree, 0);
  if (!matched) return null;
  return { node: matched, params: { ...params } };
}

export function parseCookies(str: string): Record<string, string> {
  const obj: Record<string, string> = {};
  if (!str) return obj;
  for (const pair of str.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) obj[k] = v;
  }
  return obj;
}

export interface DevCache extends Map<string, number> {}

export type BuildWebRequestInput = {
  method?: string;
  headers?: Record<string, string | string[] | number | undefined>;
  socket?: { remoteAddress?: string };
  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer | Uint8Array | string>;
};

/**
 * Build a standard Web API Request from a Node.js IncomingMessage.
 *
 * When `body` is omitted, the body is read lazily from the Node stream and
 * `json()`/`text()` are patched accordingly. A `cookies` getter is attached
 * (NextRequest-compatible).
 */
export function buildWebRequest(
  nodeReq: BuildWebRequestInput,
  url: string,
  body?: BodyInit | null,
  options?: { maxBodyBytes?: number }
): Request & { cookies: Record<string, string>; query: Record<string, string> } {
  const parsedUrl = new URL(url, `http://${nodeReq.headers?.host || 'localhost'}`);
  const method = nodeReq.method || 'GET';
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(nodeReq.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(', ') : v === undefined ? '' : String(v);
  }

  const webRequest = new Request(parsedUrl, { method, headers, body: body ?? null });

  if (body === undefined) {
    let _bodyBuffer: Buffer | null = null;
    const getBody = async (): Promise<Buffer> => {
      if (_bodyBuffer) return _bodyBuffer;
      const chunks: Uint8Array[] = [];
      let total = 0;
      const max = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
      for await (const chunk of nodeReq) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        total += bytes.byteLength;
        if (total > max) throw tooLargeError(max);
        chunks.push(bytes as Uint8Array);
      }
      _bodyBuffer = Buffer.concat(chunks as Buffer[]);
      return _bodyBuffer;
    };
    Object.defineProperty(webRequest, 'json', {
      value: async () => { try { return JSON.parse((await getBody()).toString()); } catch { return null; } },
      configurable: true,
    });
    Object.defineProperty(webRequest, 'text', {
      value: async () => (await getBody()).toString('utf-8'),
      configurable: true,
    });
  }

  const rawCookies = parseCookies(String(nodeReq.headers?.cookie || ''));
  Object.defineProperty(webRequest, 'cookies', { get: () => rawCookies, enumerable: true });

  const query: Record<string, string> = {};
  for (const [k, v] of parsedUrl.searchParams.entries()) query[k] = v;
  Object.defineProperty(webRequest, 'query', { get: () => query, enumerable: true });

  return webRequest as Request & { cookies: Record<string, string>; query: Record<string, string> };
}

export function tooLargeError(max: number): Error & { status: number } {
  const err = new Error(`Request body exceeds limit (${max} bytes)`) as Error & { status: number };
  err.status = 413;
  return err;
}

export async function executeApiRoute(
  filePath: string,
  method: string,
  request: Request,
  params: Record<string, string> = {},
  locals: Record<string, unknown> = {},
  devCache?: DevCache
): Promise<Response | null> {
  let mod: Record<string, unknown>;
  try {
    if (devCache && devCache.has(filePath)) {
      const t = devCache.get(filePath)!;
      const url = new URL('file://' + filePath);
      url.searchParams.set('t', String(t));
      mod = await import(url.href) as Record<string, unknown>;
    } else {
      mod = await import(filePath) as Record<string, unknown>;
    }
  } catch (e: unknown) {
    // details only in dev (devCache present); prod gets a generic message
    const body = devCache
      ? { error: 'Failed to load route module', details: (e as Error).message }
      : { error: 'Failed to load route module' };
    return new Response(JSON.stringify(body), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const routeConfig = (mod.config || {}) as Record<string, unknown>;

  // Default CSRF defense for mutating API calls: same-origin check unless the
  // route opts out via `config.csrf = false`.
  {
    const methodUpper = method.toUpperCase();
    if (routeConfig.csrf !== false && methodUpper !== 'GET' && methodUpper !== 'HEAD' && methodUpper !== 'OPTIONS') {
      try {
        assertSameOrigin({
          method: methodUpper,
          headers: Object.fromEntries([...request.headers.entries()].map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Cross-origin request blocked' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const handler = mod[method] as ((req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>) | undefined;
  if (!handler) {
    if (method === 'OPTIONS') {
      const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
        .filter(m => mod[m]);
      return new Response(null, {
        status: 204,
        headers: { Allow: allowed.join(', ') },
      });
    }
    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), {
      status: 405, headers: { 'Content-Type': 'application/json', Allow: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].filter(m => mod[m]).join(', ') },
    });
  }

  const ctx: Record<string, unknown> = {
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
    ),
    url: request.url,
    method: request.method,
    cookies: parseCookies(request.headers.get('cookie') || ''),
    locals,
    _request: request,
    params,
  };

  Object.defineProperty(request, 'locals', {
    get: () => locals,
    enumerable: true,
  });

  const prev = (globalThis as Record<string, unknown>).__vesk_request;
  (globalThis as Record<string, unknown>).__vesk_request = ctx;
  try {
    let signal = request.signal;
    if (routeConfig.maxDuration) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`Request timed out after ${routeConfig.maxDuration}s`)),
        (routeConfig.maxDuration as number) * 1000
      );
      signal = controller.signal;
      Object.defineProperty(request, 'signal', { value: signal, writable: false });
    }

    const beforeHooks = (mod.beforeRequest || []) as Array<(req: Request, ctx: Record<string, unknown>) => Response | Promise<Response>>;
    for (const hook of beforeHooks) {
      const hookResult = await hook(request, { params, locals });
      if (hookResult instanceof Response) return hookResult;
    }

    const { runHooks: execHooks } = await import('@vesk/runtime/server') as { runHooks: (name: string, ...args: unknown[]) => Promise<Response | undefined> };
    let globalHookResult = await execHooks('beforeRequest', request, { params, locals });
    if (globalHookResult instanceof Response) return globalHookResult;

    let response: unknown;
    try {
      response = await handler(request, { params: Promise.resolve(params) });
    } catch (e: unknown) {
      let errorResult = await execHooks('onError', e, request);
      if (errorResult instanceof Response) return errorResult;
      throw e;
    }

    const afterHooks = (mod.afterRequest || []) as Array<(req: Request, res: unknown) => Response | Promise<Response>>;
    for (const hook of afterHooks) {
      const hookResult = await hook(request, response);
      if (hookResult instanceof Response) response = hookResult;
    }

    let globalAfterResult = await execHooks('afterRequest', request, response);
    if (globalAfterResult instanceof Response) response = globalAfterResult;

    const respObj = response as { build?: () => void };
    if (typeof respObj?.build === 'function') {
      respObj.build();
    }

    if (response instanceof Response) {
      const rewriteUrl = response.headers.get('x-vesk-rewrite');
      if (rewriteUrl) {
        return executeRewrite(rewriteUrl, request) as unknown as Response;
      }
      if (response.headers.get('x-vesk-next')) {
        return null;
      }
      return response;
    }
    return new Response(JSON.stringify(response), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const err = e as Error & { name: string; status?: number; url?: string };
    if (err.name === 'Redirect') {
      return new Response(null, {
        status: err.status || 302,
        headers: { Location: err.url || '' },
      });
    }
    if (err.name === 'NotFoundError') {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    // never leak internal error messages in production responses
    const body = devCache ? { error: err.message } : { error: 'Internal Server Error' };
    return new Response(JSON.stringify(body), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    (globalThis as Record<string, unknown>).__vesk_request = prev;
  }
}

async function executeRewrite(url: string, originalRequest: Request): Promise<Request> {
  const rewriteReq = new Request(url, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body: originalRequest.body,
  });
  if ((originalRequest as unknown as Record<string, unknown>).locals) {
    Object.defineProperty(rewriteReq, 'locals', {
      get: () => (originalRequest as unknown as Record<string, unknown>).locals,
      enumerable: true,
    });
  }
  return rewriteReq;
}
