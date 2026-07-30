import { existsSync } from 'fs';
import { resolve } from 'path';
import { extractMiddleware } from './router.js';
import { parseCookies } from './api-routes.js';
export function collectMiddlewareChain(routeTree, url, appDir) {
    const parts = url.split('/').filter(Boolean);
    const chain = [];
    function walk(nodes, depth) {
        for (const node of nodes) {
            if (node.isGroup) {
                if (walk(node.children, depth))
                    return true;
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
                if (tryCollectAndRecurse(node, depth))
                    return true;
                continue;
            }
            if (node.path === part) {
                if (tryCollectAndRecurse(node, depth))
                    return true;
                continue;
            }
        }
        return false;
    }
    function collectForNode(node) {
        if (node.hasMiddleware) {
            const mwPath = resolve(appDir, node.sourceDir, 'middleware.ts');
            if (existsSync(mwPath)) {
                chain.push({ sourcePath: mwPath, node });
            }
        }
    }
    function tryCollectAndRecurse(node, depth) {
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
    }
    else {
        walk(routeTree, 0);
    }
    return chain;
}
export async function loadMiddleware(sourcePath) {
    if (sourcePath.endsWith('.vsk')) {
        const src = extractMiddleware(sourcePath);
        if (!src)
            return null;
        return eval(`(${src})`);
    }
    if (sourcePath.endsWith('.js') || sourcePath.endsWith('.ts')) {
        try {
            const mod = await import(sourcePath);
            return (mod.middleware || mod.default || null);
        }
        catch {
            return null;
        }
    }
    return null;
}
export async function executeMiddlewareChain(chain, request, params, options = {}) {
    const { onLast, plugins } = options;
    const url = new URL(request.url, 'http://localhost');
    const locals = {};
    const cookies = parseCookies(request.headers?.get('cookie') || '');
    const ctx = new Proxy({
        request,
        params,
        url,
        locals,
        cookies,
        set(key, value) {
            locals[key] = value;
        },
        get(key) {
            return locals[key];
        },
    }, {
        get(target, prop) {
            if (prop in target)
                return target[prop];
            return locals[prop];
        },
    });
    if (plugins && plugins.length > 0) {
        for (const plugin of plugins) {
            if (plugin.provides) {
                for (const [key, factory] of Object.entries(plugin.provides)) {
                    if (typeof factory === 'function' && !(factory instanceof RegExp)) {
                        try {
                            ctx.set(key, await factory());
                        }
                        catch {
                            // factory failed — skip this provide
                        }
                    }
                    else {
                        ctx.set(key, factory);
                    }
                }
            }
            if (typeof plugin.onRequest === 'function') {
                await plugin.onRequest(ctx);
            }
        }
    }
    let rewriteUrl = null;
    if (chain.length === 0) {
        return { response: null, redirected: false, locals, rewriteUrl: null };
    }
    async function runMiddleware(index) {
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
        async function next(rewrite) {
            if (rewrite) {
                rewriteUrl = rewrite;
                try {
                    const newUrl = new URL(rewrite, 'http://localhost');
                    ctx.url = newUrl;
                }
                catch {
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
        }
        catch (e) {
            const err = e;
            if (err.name === 'Redirect') {
                return new Response(null, {
                    status: err.status || 302,
                    headers: { Location: err.url || '' },
                });
            }
            if (err.name === 'NotFoundError') {
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            throw e;
        }
    }
    const response = await runMiddleware(0);
    return { response, redirected: response?.status >= 300 && response?.status < 400, locals, rewriteUrl };
}
