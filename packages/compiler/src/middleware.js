/**
 * Middleware chain collection and execution for Vesk.
 * Implements the onion model: outermost middleware runs first on the way in,
 * last on the way out, with URL rewrite and short-circuit support.
 * @module middleware
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractMiddleware } from './router.js';
import { parseCookies } from './api-routes.js';

/**
 * Collect middleware chain for a given URL, walking from root → leaf.
 * Returns an array of { sourcePath, node } ordered outermost first.
 */
export function collectMiddlewareChain(routeTree, url, appDir) {
	const parts = url.split('/').filter(Boolean);
	const chain = [];

	function walk(nodes, depth) {
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
	} else {
		walk(routeTree, 0);
	}

	return chain;
}

/**
 * Load and prepare a middleware function from a source file.
 * Supports .js/.ts (direct import).
 */
export async function loadMiddleware(sourcePath) {
	if (sourcePath.endsWith('.vsk')) {
		const src = extractMiddleware(sourcePath);
		if (!src) return null;
		return eval(`(${src})`);
	}
	if (sourcePath.endsWith('.js') || sourcePath.endsWith('.ts')) {
		try {
			const mod = await import(sourcePath);
			return mod.middleware || mod.default || null;
		} catch { return null; }
	}
	return null;
}

/**
 * Execute a middleware chain with onion model.
 *
 * Each middleware receives: (ctx, next)
 *   ctx = { request, params, url, locals, cookies }
 *   next = async (rewriteUrl?) => Response   // passes to next middleware or page
 *
 * Can:
 *   - Return a Response directly          → short-circuit
 *   - Call await next() and return result  → onion (before/after)
 *   - Call next('/rewrite')               → rewrite URL in place
 *   - throw redirect() / notFound()       → caught
 *
 * The last middleware resolves to a sentinel — the caller replaces it with
 * the actual page render. Returns { response, redirected, locals, rewriteUrl }
 */
export async function executeMiddlewareChain(chain, request, params, options = {}) {
	const { onLast } = options;
	const url = new URL(request.url, 'http://localhost');
	const locals = {};
	const cookies = parseCookies(request.headers?.cookie || '');

	const ctx = {
		request,
		params,
		url,
		locals,
		cookies,
	};

	let rewriteUrl = null;

	if (chain.length === 0) {
		return { response: null, redirected: false, locals, rewriteUrl: null };
	}

	// Build the middleware chain recursively
	async function runMiddleware(index) {
		if (index >= chain.length) {
			// All middleware passed — call the page render
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

		// next() function for this middleware
		async function next(rewrite) {
			if (rewrite) {
				rewriteUrl = rewrite;
				// Update ctx.url to reflect the rewrite
				try {
					const newUrl = new URL(rewrite, 'http://localhost');
					ctx.url = newUrl;
				} catch {
					// rewrite is a pathname — resolve against original base
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
			// No return from middleware — call next if they didn't
			// but if next was already called and returned, propagate
			return new Response(null, { status: 204 });
		} catch (e) {
			if (e.name === 'Redirect') {
				return new Response(null, {
					status: e.status || 302,
					headers: { Location: e.url },
				});
			}
			if (e.name === 'NotFoundError') {
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
