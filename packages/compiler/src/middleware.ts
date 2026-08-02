import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractMiddleware } from '@vesk/compiler/src/router';
import { parseCookies } from '@vesk/compiler/src/api-routes';
import type { RouteNode } from '@vesk/compiler/src/types';
import type { VeskPlugin, MiddlewareContext, MiddlewareChainOptions } from '@vesk/compiler/src/types';

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
      const mod = await import(sourcePath) as Record<string, unknown>;
      return (mod.middleware || mod.default || null) as ((ctx: any, next: any) => any) | null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function executeMiddlewareChain(
  chain: MiddlewareEntry[],
  request: Request,
  params: Record<string, string>,
  options: MiddlewareChainOptions = {}
): Promise<{ response: Response | null; redirected: boolean; locals: Record<string, unknown>; rewriteUrl: string | null }> {
  const { onLast, plugins } = options;
  const url = new URL(request.url, 'http://localhost');
  const locals: Record<string, unknown> = {};
  const cookies = parseCookies(request.headers?.get('cookie') || '');

  const ctx = new Proxy({
    request,
    params,
    url,
    locals,
    cookies,
    set(key: string, value: unknown) {
      locals[key] = value;
    },
    get(key: string) {
      return locals[key];
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
    return { response: null, redirected: false, locals, rewriteUrl: null };
  }

  async function runMiddleware(index: number): Promise<Response> {
    if (index >= chain.length) {
      if (onLast) {
        return onLast(rewriteUrl);
      }
      return new Response(null, { status: 204 });
    }

    const { sourcePath } = chain[index];
    const fn = await loadMiddleware(sourcePath);
    if (!fn) {
      return runMiddleware(index + 1);
    }

    async function next(rewrite?: string): Promise<Response> {
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
      return runMiddleware(index + 1);
    }

    try {
      const result = await fn(ctx, next);
      if (result instanceof Response) {
        return result;
      }
      return new Response(null, { status: 204 });
    } catch (e: unknown) {
      const err = e as Error & { name: string; status?: number; url?: string };
      if (err.name === 'Redirect') {
        return new Response(null, {
          status: err.status || 302,
          headers: { Location: err.url || '' },
        });
      }
      throw e;
    }
  }

  const response = await runMiddleware(0);
  return { response, redirected: response?.status >= 300 && response?.status < 400, locals, rewriteUrl };
}
