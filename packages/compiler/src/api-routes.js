import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

/**
 * Vesk API Routes — file-based API route handling.
 *
 * Conventions:
 *   app/api/route.js              → GET /api
 *   app/api/users/route.js        → GET /api/users
 *   app/api/users/[id]/route.js   → GET /api/users/:id
 *   app/api/[...slug]/route.js    → GET /api/*slug
 *   app/api/(group)/route.js      → route groups (parenthesized dirs skipped)
 *
 * Handler signature (App Router):
 *   export async function GET(request, { params }) {
 *     const { id } = await params;
 *     return Response.json({ id });
 *   }
 *
 * Named exports: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
 * request: standard Web API Request
 * params: Promise<Record<string,string>>
 * return: Response
 *
 * Per-route config:
 *   export const config = {
 *     runtime: 'nodejs',       // only nodejs supported currently
 *     maxDuration: 30,         // max execution time in seconds
 *     revalidate: 60,          // ISR revalidation period in seconds
 *   };
 */

// ── API Route Tree ─────────────────────────────────────────────

/**
 * @typedef {Object} ApiRouteNode
 * @property {string} path       - URL segment ('' for root, ':param', '*' for catch-all)
 * @property {string} fullPath   - Full URL pattern
 * @property {boolean} isDynamic - Dynamic segment [param]
 * @property {boolean} isCatchAll - Catch-all [...param]
 * @property {string} filePath   - Path to route.js on disk
 * @property {ApiRouteNode[]} children
 */

/**
 * Scan the app/api directory and return an API route tree.
 * @param {string} apiDir
 * @returns {ApiRouteNode[]}
 */
export function scanApiRoutes(apiDir) {
	if (!existsSync(apiDir)) return [];
	return scanApiDir(apiDir, apiDir, '/');
}

function scanApiDir(rootDir, dir, parentPath) {
	const nodes = [];
	let entries;
	try { entries = readdirSync(dir); } catch { return nodes; }

	let hasRoute = false;
	let routeFileName = null;
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

	// Route groups: unwrap children but don't add a segment
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

	const node = {
		path: seg,
		fullPath: fullPath.replace(/\/+/g, '/') || '/',
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

// ── URL Matching ───────────────────────────────────────────────

/**
 * Match an API URL pathname against the API route tree.
 * @param {ApiRouteNode[]} tree
 * @param {string} pathname
 * @returns {{ node: ApiRouteNode, params: Record<string,string> } | null}
 */
export function matchApiUrl(tree, pathname) {
	const normalized = pathname.replace(/^\/api(\/|$)/, '/');
	const parts = normalized.split('/').filter(Boolean);
	const params = {};

	function matchNodes(nodes, partIndex) {
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

// ── Helpers ────────────────────────────────────────────────────

export function parseCookies(str) {
	const obj = {};
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

// ── Request Builder ────────────────────────────────────────────

/**
 * Build a standard Web API Request from a Node.js IncomingMessage.
 */
export function buildWebRequest(nodeReq, url) {
	const parsedUrl = new URL(url, `http://${nodeReq.headers.host || 'localhost'}`);
	const method = nodeReq.method || 'GET';

	// Read body lazily
	let _bodyBuffer = null;
	async function getBody() {
		if (_bodyBuffer) return _bodyBuffer;
		const chunks = [];
		for await (const chunk of nodeReq) chunks.push(chunk);
		_bodyBuffer = Buffer.concat(chunks);
		return _bodyBuffer;
	}

	// Don't pass body yet — Request constructor doesn't accept Promise
	// Instead override .json()/.text() to read from the Node stream
	const webRequest = new Request(parsedUrl, {
		method,
		headers: nodeReq.headers,
		body: null,
	});

	// Patch body reading methods to read from the actual Node stream
	webRequest.json = async () => {
		try { return JSON.parse((await getBody()).toString()); } catch { return null; }
	};
	webRequest.text = async () => (await getBody()).toString('utf-8');
	webRequest.formData = async () => {
		const text = await webRequest.text();
		const obj = {};
		for (const pair of text.split('&')) {
			const [k, v] = pair.split('=').map(s => decodeURIComponent(s || ''));
			if (k) obj[k] = v;
		}
		return obj;
	};
	webRequest.clone = () => webRequest;

	// Add cookies getter (VeskRequest-compatible)
	const rawCookies = parseCookies(nodeReq.headers.cookie || '');
	Object.defineProperty(webRequest, 'cookies', {
		get: () => rawCookies,
		enumerable: true,
	});

	return webRequest;
}

// ── Handler Execution ─────────────────────────────────────────

/**
 * Execute an API route handler (App Router style).
 *
 * Imports the route module, calls the named method export with
 * (request, { params: Promise<...> }), and returns a Response.
 *
 * Supports:
 *   - Named HTTP method handlers (GET, POST, PUT, etc.)
 *   - Per-route config (export const config = { ... })
 *   - Auto OPTIONS response when no OPTIONS handler defined
 *   - Streaming Response bodies (ReadableStream)
 *   - ServerResponse.redirect / .rewrite / .next
 *   - Zod-validated request body parsing (via withValidation helper)
 */
export async function executeApiRoute(filePath, method, request, params = {}, locals = {}, devCache) {
	let mod;
	try {
		if (devCache && devCache.has(filePath)) {
			const t = devCache.get(filePath);
			const url = new URL('file://' + filePath);
			url.searchParams.set('t', String(t));
			mod = await import(url.href);
		} else {
			mod = await import(filePath);
		}
	} catch (e) {
		return new Response(JSON.stringify({ error: 'Failed to load route module', details: e.message }), {
			status: 500, headers: { 'Content-Type': 'application/json' },
		});
	}

	// Read per-route config
	const routeConfig = mod.config || {};

	// Auto-OPTIONS: respond with Allow header
	const handler = mod[method];
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

	// Set request context for cookies()/headers()/locals() hooks
	const ctx = {
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
	// Expose locals directly on the request object
	Object.defineProperty(request, 'locals', {
		get: () => locals,
		enumerable: true,
	});

	const prev = globalThis.__vesk_request;
	globalThis.__vesk_request = ctx;
	try {
		// Apply maxDuration as an AbortSignal timeout if set
		let signal = request.signal;
		if (routeConfig.maxDuration) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${routeConfig.maxDuration}s`)), routeConfig.maxDuration * 1000);
			signal = controller.signal;
			// Don't leak the timeout if the request completes
			Object.defineProperty(request, 'signal', { value: signal, writable: false });
		}

		// Run beforeRequest hooks (from module exports)
		const beforeHooks = mod.beforeRequest || [];
		for (const hook of beforeHooks) {
			const hookResult = await hook(request, { params, locals });
			if (hookResult instanceof Response) return hookResult;
		}

		// Run globally registered beforeRequest hooks
		const { runHooks: execHooks } = await import('@vesk/runtime/server');
		let globalHookResult = await execHooks('beforeRequest', request, { params, locals });
		if (globalHookResult instanceof Response) return globalHookResult;

		let response;
		try {
			response = await handler(request, { params: Promise.resolve(params) });
		} catch (e) {
			// Run onError hooks
			let errorResult = await execHooks('onError', e, request);
			if (errorResult instanceof Response) return errorResult;
			throw e;
		}

		// Run afterRequest hooks (from module exports)
		const afterHooks = mod.afterRequest || [];
		for (const hook of afterHooks) {
			const hookResult = await hook(request, response);
			if (hookResult instanceof Response) response = hookResult;
		}

		// Run globally registered afterRequest hooks
		let globalAfterResult = await execHooks('afterRequest', request, response);
		if (globalAfterResult instanceof Response) response = globalAfterResult;

		// Auto-build VeskResponse to flush cookies + security headers
		if (response?.constructor?.name === 'VeskResponse' && typeof response.build === 'function') {
			response.build();
		}

		if (response instanceof Response) {
			// Handle ServerResponse.rewrite — internal rewrite
			const rewriteUrl = response.headers.get('x-vesk-rewrite');
			if (rewriteUrl) {
				return executeRewrite(rewriteUrl, request);
			}
			// Handle ServerResponse.next — continue to default handler
			if (response.headers.get('x-vesk-next')) {
				return null;
			}
			return response;
		}
		return new Response(JSON.stringify(response), {
			status: 200, headers: { 'Content-Type': 'application/json' },
		});
	} catch (e) {
		if (e.name === 'Redirect') {
			return new Response(null, {
				status: e.status || 302,
				headers: { Location: e.url },
			});
		}
		if (e.name === 'NotFoundError') {
			return new Response(JSON.stringify({ error: 'Not Found' }), {
				status: 404, headers: { 'Content-Type': 'application/json' },
			});
		}
		return new Response(JSON.stringify({ error: e.message }), {
			status: 500, headers: { 'Content-Type': 'application/json' },
		});
	} finally {
		globalThis.__vesk_request = prev;
	}
}

/**
 * Internal rewrite executor — re-enters the route matching and execution
 * pipeline for a new URL.
 */
async function executeRewrite(url, originalRequest) {
	// Build a new request with the rewrite URL
	const rewriteReq = new Request(url, {
		method: originalRequest.method,
		headers: originalRequest.headers,
		body: originalRequest.body,
	});
	// Copy over locals
	if (originalRequest.locals) {
		Object.defineProperty(rewriteReq, 'locals', {
			get: () => originalRequest.locals,
			enumerable: true,
		});
	}
	// This expects the caller to re-invoke route matching + execution
	// The rewrite response is returned directly
	return rewriteReq;
}

function basename(p) {
	const idx = p.lastIndexOf('/');
	return idx === -1 ? p : p.slice(idx + 1);
}
