import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

/**
 * Vesk API Routes — Next.js App Router-style file-based API.
 *
 * Conventions:
 *   app/api/route.js              → GET /api
 *   app/api/users/route.js        → GET /api/users
 *   app/api/users/[id]/route.js   → GET /api/users/:id
 *   app/api/[...slug]/route.js    → GET /api/*slug
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

	if (isPrivate && dir !== rootDir) return nodes;

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

	// Add cookies getter (NextRequest-compatible)
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
 */
export async function executeApiRoute(filePath, method, request, params = {}, locals = {}) {
	let mod;
	try {
		mod = await import(filePath);
	} catch (e) {
		return new Response(JSON.stringify({ error: 'Failed to load route module', details: e.message }), {
			status: 500, headers: { 'Content-Type': 'application/json' },
		});
	}

	const handler = mod[method];
	if (!handler) {
		return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), {
			status: 405, headers: { 'Content-Type': 'application/json' },
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
	};
	// Expose locals directly on the request object
	Object.defineProperty(request, 'locals', {
		get: () => locals,
		enumerable: true,
	});

	const prev = globalThis.__vesk_request;
	globalThis.__vesk_request = ctx;
	try {
		const response = await handler(request, { params: Promise.resolve(params) });
		if (response instanceof Response) return response;
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

function basename(p) {
	const idx = p.lastIndexOf('/');
	return idx === -1 ? p : p.slice(idx + 1);
}
