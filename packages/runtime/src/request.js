/**
 * Vesk request hooks — cookies(), headers(), useBody(), useParams(), cors(),
 * lifecycle hooks (defineHook/runHooks), and webhook handler factory.
 *
 * SSR: reads from globalThis.__vesk_request (set by dev server before renderPage)
 * API: reads from globalThis.__vesk_request (set by executeApiRoute)
 * Client: cookies() reads document.cookie, headers() returns empty
 */

function getRequest() {
	return globalThis.__vesk_request || null;
}

// ── Lifecycle Hook Registry ────────────────────────────────────

function getHooks() {
	if (!globalThis.__vesk_hooks) globalThis.__vesk_hooks = {};
	return globalThis.__vesk_hooks;
}

/**
 * Register a lifecycle hook function.
 *
 * Built-in hook names:
 *   'beforeRequest'  — runs before the handler, receives (request, context)
 *                       context = { params, locals }
 *                       return a Response to short-circuit
 *   'afterRequest'   — runs after the handler, receives (request, response)
 *                       return a Response to replace the response
 *   'onError'        — runs when the handler throws, receives (error, request)
 *                       return a Response to send instead of the default 500
 *
 * Custom names are also allowed for user-defined hook systems.
 *
 * @param {string} name
 * @param {Function} fn
 */
export function defineHook(name, fn) {
	const hooks = getHooks();
	if (!hooks[name]) hooks[name] = [];
	hooks[name].push(fn);
}

/**
 * Remove a previously registered hook.
 * @param {string} name
 * @param {Function} fn
 */
export function removeHook(name, fn) {
	const hooks = getHooks();
	if (!hooks[name]) return;
	hooks[name] = hooks[name].filter(h => h !== fn);
}

/**
 * Run all hooks registered for a given lifecycle event.
 * Each hook runs in sequence. If a hook returns a Response,
 * subsequent hooks are skipped and the Response is returned.
 *
 * @param {string} name
 * @param {...any} args
 * @returns {Promise<Response|undefined>}
 */
export async function runHooks(name, ...args) {
	const hooks = getHooks()[name] || [];
	for (const fn of hooks) {
		const result = await fn(...args);
		if (result instanceof Response) return result;
	}
}

// ── Composable Request Hooks ──────────────────────────────────

/**
 * Get the current request's matching parameters.
 *
 * In API routes, this returns the dynamic route params resolved
 * from the URL path (e.g., { id: '42' } for /api/users/42).
 *
 * Must be called within a request context (API handler or SSR render).
 *
 * @returns {Record<string,string>}
 */
export function useParams() {
	const ctx = getRequest();
	return ctx?.params || {};
}

/**
 * Get the current request context object.
 *
 * Returns:
 *   { headers, url, method, cookies, locals, params }
 *
 * @returns {object|null}
 */
export function useRequest() {
	return getRequest();
}

/**
 * Parse and cache the request body.
 *
 * Automatically detects content type. Returns the parsed JSON object
 * for application/json, a string for text/plain, or a plain object
 * for application/x-www-form-urlencoded.
 *
 * Caches the result so it can be safely called multiple times.
 *
 * @returns {Promise<unknown|null>}
 */
export async function useBody() {
	const ctx = getRequest();
	if (!ctx) throw new Error('useBody() called outside request context');
	if (ctx._parsedBody !== undefined) return ctx._parsedBody;

	const req = ctx._request;
	if (!req) return null;

	const ct = (req.headers.get && req.headers.get('content-type')) || '';
	try {
		if (ct.includes('json')) {
			ctx._parsedBody = await req.json();
		} else if (ct.includes('x-www-form-urlencoded')) {
			const text = await req.text();
			const obj = {};
			for (const pair of text.split('&')) {
				const [k, v] = pair.split('=').map(s => decodeURIComponent(s || ''));
				if (k) obj[k] = v;
			}
			ctx._parsedBody = obj;
		} else {
			ctx._parsedBody = await req.text();
		}
	} catch {
		ctx._parsedBody = null;
	}
	return ctx._parsedBody;
}

// ── CORS Middleware ────────────────────────────────────────────

/**
 * Create a CORS middleware.
 *
 * Usage in a route module:
 *   import { cors } from '@vesk/runtime';
 *   export const beforeRequest = [cors()];
 *
 * Or use it standalone:
 *   const c = cors({ origin: 'https://app.com' });
 *   const result = c(request);
 *   if (result instanceof Response) return result;
 *
 * @param {object} [options]
 * @param {string} [options.origin='*']
 * @param {string} [options.methods='GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS']
 * @param {string} [options.allowedHeaders='Content-Type, Authorization']
 * @param {boolean} [options.credentials=true]
 * @param {number} [options.maxAge=86400]
 * @param {string[]} [options.exposeHeaders]
 * @returns {Function} middleware that returns Response (for OPTIONS) or undefined
 */
export function cors(options = {}) {
	const {
		origin = '*',
		methods = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
		allowedHeaders = 'Content-Type, Authorization',
		credentials = true,
		maxAge = 86400,
		exposeHeaders,
	} = options;

	const corsHeaders = {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': methods,
		'Access-Control-Allow-Headers': allowedHeaders,
		'Access-Control-Max-Age': String(maxAge),
	};
	if (credentials) corsHeaders['Access-Control-Allow-Credentials'] = 'true';
	if (exposeHeaders?.length) corsHeaders['Access-Control-Expose-Headers'] = exposeHeaders.join(', ');

	/**
	 * Apply CORS headers to an existing Response.
	 * @param {Response} response
	 * @returns {Response}
	 */
	function applyCors(response) {
		const headers = new Headers(response.headers);
		for (const [k, v] of Object.entries(corsHeaders)) {
			headers.set(k, v);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	/**
	 * CORS middleware function.
	 * - For OPTIONS requests: returns a 204 with CORS headers (preflight).
	 * - For other methods: attaches a `_corsHeaders` property so the
	 *   afterRequest hook can apply them.
	 *
	 * @param {Request} request
	 * @returns {Response|undefined}
	 */
	function middleware(request) {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		// Tag the response pipeline to add CORS headers later
		middleware._pending = corsHeaders;
	}

	middleware.applyCors = applyCors;
	middleware._corsHeaders = corsHeaders;

	return middleware;
}

// ── Webhook Handler Factory ─────────────────────────────────────

/**
 * Create a webhook handler that verifies payload signatures.
 *
 * Usage in a route module:
 *   import { webhook } from '@vesk/runtime';
 *
 *   export const POST = webhook({
 *     secret: process.env.STRIPE_SECRET,
 *     handler: async (event, request) => {
 *       return ServerResponse.json({ received: true });
 *     },
 *   });
 *
 * Supports:
 *   - HMAC-SHA256 signature verification (SHA256= / sha256= prefix)
 *   - Raw body reading for signature computation
 *   - Configurable header name (default: x-webhook-signature)
 *
 * @param {object} options
 * @param {string} options.secret - Shared secret for HMAC verification
 * @param {Function} options.handler - Handler called with (parsedEvent, request)
 * @param {string} [options.headerName='x-webhook-signature'] - Signature header name
 * @param {string} [options.signaturePrefix='sha256='] - Expected signature prefix
 * @returns {Function} POST handler
 */
export function webhook(options) {
	const {
		secret,
		handler,
		headerName = 'x-webhook-signature',
		signaturePrefix = 'sha256=',
	} = options;

	if (!secret) throw new Error('webhook() requires a secret');
	if (!handler) throw new Error('webhook() requires a handler function');

	/**
	 * Compute HMAC-SHA256 signature.
	 * @param {string|Buffer} body
	 * @returns {string}
	 */
	function computeSignature(body) {
		const key = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
		const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;

		// Use Web Crypto API
		const crypto = globalThis.crypto;
		if (!crypto?.subtle) {
			throw new Error('Web Crypto API not available (required for webhook signature verification)');
		}
		// We return the promise but the caller awaits it
		return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
			.then(key => crypto.subtle.sign('HMAC', key, data))
			.then(sig => {
				const hex = Array.from(new Uint8Array(sig))
					.map(b => b.toString(16).padStart(2, '0'))
					.join('');
				return hex;
			});
	}

	async function webhookHandler(request) {
		const signature = request.headers.get(headerName);
		if (!signature) {
			return new Response(JSON.stringify({ error: 'Missing signature header' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const body = await request.text();
		const expectedSig = await computeSignature(body);
		const prefixLen = signaturePrefix.length;
		const providedSig = signature.startsWith(signaturePrefix)
			? signature.slice(prefixLen)
			: signature;

		// Constant-time comparison (sort of — at least not short-circuit on first char)
		if (providedSig.length !== expectedSig.length) {
			return new Response(JSON.stringify({ error: 'Invalid signature' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		let match = true;
		for (let i = 0; i < expectedSig.length; i++) {
			if (providedSig[i] !== expectedSig[i]) match = false;
		}
		if (!match) {
			return new Response(JSON.stringify({ error: 'Invalid signature' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Parse the event (try JSON first)
		let event;
		try {
			event = JSON.parse(body);
		} catch {
			event = body;
		}

		return handler(event, request);
	}

	return webhookHandler;
} // closes webhook

/**
 * Get the current request's cookies.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or undefined
 *   .getAll()      → [{ name, value }]
 *   .toString()    → raw Cookie header
 *   [name]         → direct access
 *
 * In SSR/API: reads from the incoming request's Cookie header.
 * On client: reads from document.cookie (synchronous snapshot).
 */
export function cookies() {
	const req = getRequest();
	let jar = {};

	if (req && req.cookies) {
		jar = { ...req.cookies };
	} else if (typeof document !== 'undefined') {
		for (const pair of document.cookie.split(';')) {
			const eq = pair.indexOf('=');
			if (eq === -1) continue;
			const k = pair.slice(0, eq).trim();
			const v = pair.slice(eq + 1).trim();
			if (k) jar[k] = decodeURIComponent(v);
		}
	}

	return new Proxy(jar, {
		get(target, prop) {
			if (prop === 'get') return (name) => target[name] || undefined;
			if (prop === 'getAll') return () => Object.entries(target).map(([name, value]) => ({ name, value }));
			if (prop === 'toString') return () => Object.entries(target).map(([k, v]) => `${k}=${v}`).join('; ');
			if (prop in target) return target[prop];
			return undefined;
		},
	});
}

/**
 * Get the current request's headers.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or null (case-insensitive)
 *   .has(name)     → boolean
 *   .entries()     → [name, value][] iterator
 *   [name]         → direct access (lowercase)
 *
 * In SSR/API: reads from the incoming request's headers.
 * On client: returns empty store (no server headers in browser).
 */
/**
 * Get the current request's locals — mutable context shared between middleware
 * and page/API handlers. Set by middleware, read by pages/APIs.
 *
 * SSR/API: reads from globalThis.__vesk_request.locals
 * Client: returns empty object
 */
export function locals() {
	const req = getRequest();
	if (req && req.locals) return req.locals;
	return {};
}

export function headers() {
	const req = getRequest();
	let map = new Map();

	if (req && req.headers) {
		for (const [k, v] of Object.entries(req.headers)) {
			map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
		}
	}

	return new Proxy({}, {
		get(_target, prop) {
			if (prop === 'get') return (name) => map.get(name.toLowerCase()) || null;
			if (prop === 'has') return (name) => map.has(name.toLowerCase());
			if (prop === 'entries') return () => map.entries();
			if (typeof prop === 'string') return map.get(prop.toLowerCase()) ?? undefined;
			return undefined;
		},
		ownKeys() {
			return [...map.keys()];
		},
		getOwnPropertyDescriptor() {
			return { enumerable: true, configurable: true };
		},
	});
}

// ── ServerRequest ──────────────────────────────────────────────

/**
 * Enhanced Request class for Vesk server API routes.
 *
 * Extends the standard Web API Request with:
 *   .cookies  — parsed cookies object
 *   .params   — route params (set by the router)
 *   .locals   — mutable context shared between middleware and handlers
 */
export class ServerRequest extends Request {
	/**
	 * @param {string|URL} input
	 * @param {RequestInit} [init]
	 */
	constructor(input, init) {
		super(input, init);
		this._cookies = {};
		this._params = {};
		this._locals = {};
	}

	/** Parsed cookies, keyed by name. */
	get cookies() { return this._cookies; }
	set cookies(v) { this._cookies = v; }

	/** Route parameters (e.g., { id: '42' }). */
	get params() { return this._params; }
	set params(v) { this._params = v; }

	/** Mutable request-scoped context object. */
	get locals() { return this._locals; }
	set locals(v) { this._locals = v; }
}

// ── ServerResponse ─────────────────────────────────────────────

/**
 * ServerResponse — Vesk server response builder.
 *
 *   ServerResponse.json({ data })
 *   ServerResponse.redirect('/login')
 *   ServerResponse.rewrite('/new-path')
 *   ServerResponse.next()
 */
export class ServerResponse extends Response {
	/**
	 * @param {unknown} body
	 * @param {ResponseInit} [init]
	 * @returns {ServerResponse}
	 */
	static json(body, init) {
		const res = new ServerResponse(JSON.stringify(body), {
			...init,
			headers: { 'Content-Type': 'application/json', ...init?.headers },
		});
		return res;
	}

	/**
	 * Create a redirect response.
	 * @param {string} url
	 * @param {number} [status] - default 307 (temporary) or 308 (permanent)
	 * @returns {ServerResponse}
	 */
	static redirect(url, status = 307) {
		return new ServerResponse(null, {
			status,
			headers: { Location: url },
		});
	}

	/**
	 * Rewrite to a different URL (internal rewrite, status 200).
	 * @param {string} url
	 * @returns {ServerResponse}
	 */
	static rewrite(url) {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-rewrite': url },
		});
	}

	/**
	 * Pass through to the next handler / default handling.
	 * @returns {ServerResponse}
	 */
	static next() {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-next': '1' },
		});
	}
}

// ── VeskRequest — enhanced ServerRequest with richer API ────────

/**
 * VeskRequest — Vesk's enhanced API route request.
 *
 * Extends ServerRequest with:
 *   .query     — parsed URL query string object
 *   .ip        — client IP address (respects trustProxy)
 *   .protocol  — 'http' or 'https' (respects trustProxy)
 *   .hostname  — host without port
 *   .body      — cached parsed body (json, form, or text)
 *
 * Usage in API routes:
 *   export async function GET(request: VeskRequest) {
 *     const { page, limit } = request.query;
 *     return Response.json({ results });
 *   }
 */
export class VeskRequest extends ServerRequest {
	constructor(input, init) {
		super(input, init);
		this._query = null;
		this._ip = null;
		this._protocol = null;
		this._hostname = null;
		this._body = null;
		this._parsedUrl = null;
	}

	get parsedUrl() {
		if (!this._parsedUrl) {
			this._parsedUrl = new URL(this.url);
		}
		return this._parsedUrl;
	}

	/** Parsed URL query parameters as a plain object. */
	get query() {
		if (!this._query) {
			const params = {};
			for (const [k, v] of this.parsedUrl.searchParams) {
				params[k] = v;
			}
			this._query = params;
		}
		return this._query;
	}

	set query(v) { this._query = v; }

	/** Client IP address (from socket or X-Forwarded-For). */
	get ip() {
		if (!this._ip) {
			const fwd = this.headers?.get('x-forwarded-for');
			if (fwd) this._ip = fwd.split(',')[0].trim();
			else this._ip = 'unknown';
		}
		return this._ip;
	}

	set ip(v) { this._ip = v; }

	/** Protocol string ('http' or 'https'). */
	get protocol() {
		if (!this._protocol) {
			const proto = this.headers?.get('x-forwarded-proto');
			this._protocol = proto ? proto.split(',')[0].trim() : 'http';
		}
		return this._protocol;
	}

	set protocol(v) { this._protocol = v; }

	/** Hostname without port. */
	get hostname() {
		if (!this._hostname) {
			this._hostname = this.headers?.get('host')?.split(':')[0] || 'localhost';
		}
		return this._hostname;
	}

	set hostname(v) { this._hostname = v; }

	/**
	 * Parse the request body once and cache it.
	 * Returns the parsed object based on Content-Type.
	 */
	get body() {
		if (!this._bodyPromise) {
			this._bodyPromise = this._parseBody();
		}
		return this._bodyPromise;
	}

	async _parseBody() {
		const ct = this.headers?.get('content-type') || '';
		if (ct.includes('json')) {
			return await this.json();
		} else if (ct.includes('form')) {
			const fd = await this.formData();
			return Object.fromEntries(fd.entries());
		} else {
			const text = await this.text();
			try { return JSON.parse(text); } catch { return text; }
		}
	}

	// ── Security overrides ──────────────────────────────────────
	// Per-route/middleware overrides for security config.
	// These are read by the server when building the response.

	/** @type {object|null} */
	get _security() {
		if (!this.__security) this.__security = {};
		return this.__security;
	}

	/**
	 * Override Content-Security-Policy for this response.
	 * @param {string|false} policy - CSP string, or false to disable
	 */
	setCsp(policy) {
		this._security.contentSecurityPolicy = policy;
	}

	/**
	 * Override rate limiting for this route.
	 * @param {{ windowMs?: number, max?: number }|false} options - rate limit config, or false to disable
	 */
	setRateLimit(options) {
		this._security.rateLimit = options;
	}

	/**
	 * Enable or disable CSRF protection for this route.
	 * @param {boolean} enable
	 */
	setCsrf(enable) {
		this._security.csrf = enable;
	}

	/**
	 * Set a custom security header on this response.
	 * @param {string} name - header name (e.g. 'X-Frame-Options')
	 * @param {string|false} value - header value, or false to omit
	 */
	setSecurityHeader(name, value) {
		if (!this._security.customHeaders) this._security.customHeaders = {};
		this._security.customHeaders[name] = value;
	}

	/**
	 * Enable trustProxy for this route.
	 * @param {boolean|string} enable - true to trust any proxy, or a specific IP
	 */
	setTrustProxy(enable) {
		this._security.trustProxy = enable;
	}

	/**
	 * Get accumulated security overrides (used internally by the server).
	 * @returns {object}
	 */
	getSecurityOverrides() {
		return this._security;
	}
}

// ── VeskResponse — enhanced response with rich security & cookie API ──

/**
 * VeskResponse — Vesk's enhanced API route response.
 *
 * Static factories:
 *   VeskResponse.json(data)        — JSON response
 *   VeskResponse.redirect(url)     — redirect response
 *   VeskResponse.html(html)        — HTML response
 *   VeskResponse.rewrite(url)      — internal rewrite
 *   VeskResponse.next()            — pass-through
 *
 * Instance methods:
 *   .setCookie(name, value, opts)  — set a cookie
 *   .clearCookie(name, opts)       — remove a cookie
 *   .setCsp(policy)                — override CSP for this response
 *   .setSecurityHeader(n, v)       — set any security header
 *   .cache(ttl)                    — set Cache-Control
 *   .noCache()                     — disable caching
 */
class _VeskResponse extends ServerResponse {
	constructor(body, init) {
		super(body, init);
		this._cookieHeaders = [];
		this._secHeaders = {};
		this._finalStatus = null;
	}

	setStatus(code) {
		this._finalStatus = code;
		return this;
	}

	get status() {
		return this._finalStatus !== null ? this._finalStatus : super.status;
	}

	build() {
		this._flushSecurityHeaders();
		return this;
	}

	async text() {
		this._flushSecurityHeaders();
		return super.text();
	}

	async json() {
		this._flushSecurityHeaders();
		return super.json();
	}

	setCookie(name, value, opts = {}) {
		const parts = [`${name}=${encodeURIComponent(value)}`];
		if (opts.httpOnly !== false) parts.push('HttpOnly');
		if (opts.secure !== false) parts.push('Secure');
		parts.push('SameSite=' + (opts.sameSite || 'Lax'));
		parts.push('Path=' + (opts.path || '/'));
		if (opts.maxAge !== undefined) parts.push('Max-Age=' + opts.maxAge);
		if (opts.domain) parts.push('Domain=' + opts.domain);
		this._cookieHeaders.push(parts.join('; '));
		return this;
	}

	clearCookie(name, opts = {}) {
		return this.setCookie(name, '', { ...opts, maxAge: 0 });
	}

	setCsp(policy) {
		this._secHeaders['Content-Security-Policy'] = policy === false ? null : policy;
		return this;
	}

	setSecurityHeader(name, value) {
		this._secHeaders[name] = value === false ? null : value;
		return this;
	}

	cache(ttlSeconds) {
		this.headers?.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);
		return this;
	}

	noCache() {
		this.headers?.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		this.headers?.set('Pragma', 'no-cache');
		this.headers?.set('Expires', '0');
		return this;
	}

	cors(opts = {}) {
		this.headers?.set('Access-Control-Allow-Origin', opts.origin || '*');
		if (opts.methods) this.headers?.set('Access-Control-Allow-Methods', opts.methods);
		if (opts.headers) this.headers?.set('Access-Control-Allow-Headers', opts.headers);
		if (opts.credentials !== false) this.headers?.set('Access-Control-Allow-Credentials', 'true');
		return this;
	}

	/** Flush accumulated security headers into the response headers. */
	_flushSecurityHeaders() {
		for (const [name, value] of Object.entries(this._secHeaders)) {
			if (value === null) continue;
			const existing = this.headers?.get(name);
			if (!existing) this.headers?.set(name, value);
		}
		if (this._cookieHeaders.length > 0) {
			this.headers?.set('Set-Cookie', this._cookieHeaders.join(', '));
		}
	}

	// ── Static factories (override ServerResponse to return VeskResponse) ──

	/**
	 * Create a JSON response.
	 * @param {unknown} body
	 * @param {ResponseInit} [init]
	 * @returns {VeskResponse}
	 */
	static json(body, init) {
		return new _VeskResponse(JSON.stringify(body), {
			...init,
			headers: { 'Content-Type': 'application/json', ...init?.headers },
		});
	}

	static redirect(url, status = 307) {
		return new _VeskResponse(null, { status, headers: { Location: url } });
	}

	static rewrite(url) {
		return new _VeskResponse(null, { status: 200, headers: { 'x-vesk-rewrite': url } });
	}

	static next() {
		return new _VeskResponse(null, { status: 200, headers: { 'x-vesk-next': '1' } });
	}

	static html(html, init) {
		return new _VeskResponse(html, {
			...init,
			headers: { 'Content-Type': 'text/html; charset=utf-8', ...init?.headers },
		});
	}
}

export const VeskResponse = new Proxy(_VeskResponse, {
	apply(target, thisArg, args) {
		return new target(...args);
	}
});

// ── Helper: apply a VeskRequest's security overrides to a VeskResponse ──

/**
 * Apply security overrides from a VeskRequest to a VeskResponse.
 * Called internally by the server before sending the response.
 * @param {VeskRequest} request
 * @param {VeskResponse} response
 */
export function applyRequestSecurity(request, response) {
	if (!request || !response) return;
	const overrides = request.getSecurityOverrides?.() || {};
	if (overrides.contentSecurityPolicy !== undefined) {
		response.setCsp(overrides.contentSecurityPolicy);
	}
	if (overrides.customHeaders) {
		for (const [name, value] of Object.entries(overrides.customHeaders)) {
			response.setSecurityHeader(name, value);
		}
	}
	response._flushSecurityHeaders();
}

/**
 * Request body validation helper — wraps a Zod schema and parses the
 * request body, returning a 400 Response on validation failure.
 *
 * Usage:
 *   import { z } from 'zod';
 *   import { withValidation } from '@vesk/runtime';
 *
 *   const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });
 *   export async function POST(request) {
 *     const body = await withValidation(request, CreateUserSchema);
 *     if (body instanceof Response) return body; // 400 on validation error
 *     // body is typed as z.infer<typeof CreateUserSchema>
 *     return Response.json({ id: 1, ...body });
 *   }
 *
 * @param {Request} request
 * @param {import('zod').ZodType} schema
 * @param {object} [opts]
 * @param {boolean} [opts.jsonOnly] - only parse JSON, no form data
 * @returns {Promise<unknown | Response>}
 */
export async function withValidation(request, schema, opts = {}) {
	let data;
	const contentType = request.headers.get('content-type') || '';

	try {
		if (contentType.includes('json')) {
			data = await request.json();
		} else if (!opts.jsonOnly) {
			const formData = await request.formData();
			if (formData && typeof formData === 'object') {
				data = Object.fromEntries(
					[...formData.entries()].map(([k, v]) => [k, v])
				);
			} else {
				data = await request.text().then(t => t ? JSON.parse(t) : {});
			}
		} else {
			data = await request.json();
		}

		const result = schema.safeParse(data);
		if (!result.success) {
			return ServerResponse.json({
				error: 'Validation failed',
				issues: result.error.issues.map(i => ({
					path: i.path.join('.'),
					message: i.message,
				})),
			}, { status: 400 });
		}
		return result.data;
	} catch (e) {
		return ServerResponse.json({
			error: 'Invalid request body',
			details: e.message,
		}, { status: 400 });
	}
}

// ── Signed cookie helpers ─────────────────────────────────────
// These delegate to the compiler's crypto-based implementation.
// They are available at runtime for API route handlers.

let _signImpl = null;

async function _getImpl() {
	if (_signImpl) return _signImpl;
	try {
		_signImpl = await import('../../compiler/src/server-utils.js');
	} catch {
		try {
			const mod = await import('@vesk/compiler');
			_signImpl = mod;
		} catch {
			_signImpl = { signCookie: null, unsignCookie: null, setSignedCookie: null, readSignedCookie: null };
		}
	}
	return _signImpl;
}

/** Sign a cookie value with HMAC-SHA256 to prevent tampering. */
export async function signCookie(name, value, host) {
	const impl = await _getImpl();
	if (impl.signCookie) return impl.signCookie(name, value, host);
	throw new Error('signCookie: @vesk/compiler not available');
}

/** Verify and unsign a cookie value. Returns null if tampered. */
export async function unsignCookie(name, signedValue, host) {
	const impl = await _getImpl();
	if (impl.unsignCookie) return impl.unsignCookie(name, signedValue, host);
	throw new Error('unsignCookie: @vesk/compiler not available');
}

/**
 * Set a signed cookie with standard cookie options (HttpOnly, Secure, SameSite, Path, Max-Age).
 * Returns a Set-Cookie header string.
 */
export async function setSignedCookie(name, value, options = {}, host) {
	const impl = await _getImpl();
	if (impl.setSignedCookie) return impl.setSignedCookie(name, value, options, host);
	throw new Error('setSignedCookie: @vesk/compiler not available');
}

/** Read and verify a signed cookie from a cookie string. Returns the unsigned value or null. */
export async function readSignedCookie(name, cookieString, host) {
	const impl = await _getImpl();
	if (impl.readSignedCookie) return impl.readSignedCookie(name, cookieString, host);
	throw new Error('readSignedCookie: @vesk/compiler not available');
}


