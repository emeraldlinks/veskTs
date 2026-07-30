interface RequestContext {
	_request?: Request;
	params?: Record<string, string>;
	cookies?: Record<string, string>;
	locals?: Record<string, unknown>;
	_parsedBody?: unknown;
	[k: string]: unknown;
}

function getRequest(): RequestContext | null {
	return (globalThis as Record<string, unknown>).__vesk_request as RequestContext || null;
}

function getHooks(): Record<string, Function[]> {
	if (!(globalThis as Record<string, unknown>).__vesk_hooks) (globalThis as Record<string, unknown>).__vesk_hooks = {};
	return (globalThis as Record<string, unknown>).__vesk_hooks as Record<string, Function[]>;
}

export function defineHook(name: string, fn: Function): void {
	const hooks = getHooks();
	if (!hooks[name]) hooks[name] = [];
	hooks[name].push(fn);
}

export function removeHook(name: string, fn: Function): void {
	const hooks = getHooks();
	if (!hooks[name]) return;
	hooks[name] = hooks[name].filter(h => h !== fn);
}

export async function runHooks(name: string, ...args: unknown[]): Promise<Response | undefined> {
	const hooks = getHooks()[name] || [];
	for (const fn of hooks) {
		const result = await fn(...args);
		if (result instanceof Response) return result;
	}
}

export function useParams(): Record<string, string> {
	const ctx = getRequest();
	return ctx?.params || {};
}

export function useRequest(): RequestContext | null {
	return getRequest();
}

export async function useBody(): Promise<unknown> {
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
			const obj: Record<string, string> = {};
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

interface CorsOptions {
	origin?: string;
	methods?: string;
	allowedHeaders?: string;
	credentials?: boolean;
	maxAge?: number;
	exposeHeaders?: string[];
}

interface CorsMiddleware {
	(request: Request): Response | undefined;
	applyCors(response: Response): Response;
	_corsHeaders: Record<string, string>;
	_pending?: Record<string, string>;
}

export function cors(options: CorsOptions = {}): CorsMiddleware {
	const {
		origin = '*',
		methods = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
		allowedHeaders = 'Content-Type, Authorization',
		credentials = true,
		maxAge = 86400,
		exposeHeaders,
	} = options;

	const corsHeaders: Record<string, string> = {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': methods,
		'Access-Control-Allow-Headers': allowedHeaders,
		'Access-Control-Max-Age': String(maxAge),
	};
	if (credentials) corsHeaders['Access-Control-Allow-Credentials'] = 'true';
	if (exposeHeaders?.length) corsHeaders['Access-Control-Expose-Headers'] = exposeHeaders.join(', ');

	function applyCors(response: Response): Response {
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

	const middleware: CorsMiddleware = function(request: Request): Response | undefined {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		middleware._pending = corsHeaders;
	} as CorsMiddleware;

	middleware.applyCors = applyCors;
	middleware._corsHeaders = corsHeaders;

	return middleware;
}

interface WebhookOptions {
	secret: string;
	handler: (event: unknown, request: Request) => unknown;
	headerName?: string;
	signaturePrefix?: string;
}

export function webhook(options: WebhookOptions): (request: Request) => Promise<Response> {
	const {
		secret,
		handler,
		headerName = 'x-webhook-signature',
		signaturePrefix = 'sha256=',
	} = options;

	if (!secret) throw new Error('webhook() requires a secret');
	if (!handler) throw new Error('webhook() requires a handler function');

	async function computeSignature(body: BufferSource | string): Promise<string> {
		const key = typeof secret === 'string' ? new TextEncoder().encode(secret) as BufferSource : secret as BufferSource;
		const data: BufferSource = typeof body === 'string' ? new TextEncoder().encode(body) : body as BufferSource;

		const crypto = globalThis.crypto;
		if (!crypto?.subtle) {
			throw new Error('Web Crypto API not available (required for webhook signature verification)');
		}
		return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
			.then(k => crypto.subtle.sign('HMAC', k, data))
			.then(sig => {
				const hex = Array.from(new Uint8Array(sig))
					.map(b => b.toString(16).padStart(2, '0'))
					.join('');
				return hex;
			});
	}

	async function webhookHandler(request: Request): Promise<Response> {
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

		let event: unknown;
		try {
			event = JSON.parse(body);
		} catch {
			event = body;
		}

		return handler(event, request) as Response;
	}

	return webhookHandler;
}

interface CookieStore {
	get(name: string): string | undefined;
	getAll(): { name: string; value: string }[];
	toString(): string;
	[k: string]: string | undefined | Function;
}

export function cookies(): CookieStore {
	const req = getRequest();
	let jar: Record<string, string> = {};

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
		get(target: Record<string, string>, prop: string | symbol) {
			if (prop === 'get') return (name: string) => target[name] || undefined;
			if (prop === 'getAll') return () => Object.entries(target).map(([name, value]) => ({ name, value }));
			if (prop === 'toString') return () => Object.entries(target).map(([k, v]) => `${k}=${v}`).join('; ');
			if (prop in target) return target[prop as string];
			return undefined;
		},
	}) as unknown as CookieStore;
}

export function locals(): Record<string, unknown> {
	const req = getRequest();
	if (req && req.locals) return req.locals;
	return {};
}

export function headers(): Record<string, string | Function | undefined> {
	const req = getRequest();
	const map = new Map<string, string>();

	if (req && req.headers) {
		for (const [k, v] of Object.entries(req.headers)) {
			map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
		}
	}

	return new Proxy({} as Record<string, string | Function | undefined>, {
		get(_target: Record<string, string | Function | undefined>, prop: string | symbol) {
			if (prop === 'get') return (name: string) => map.get(name.toLowerCase()) || null;
			if (prop === 'has') return (name: string) => map.has(name.toLowerCase());
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
	}) as Record<string, string | Function | undefined>;
}

export class ServerRequest extends Request {
	_cookies: Record<string, string>;
	_params: Record<string, string>;
	_locals: Record<string, unknown>;

	constructor(input: string | URL, init?: RequestInit) {
		super(input, init);
		this._cookies = {};
		this._params = {};
		this._locals = {};
	}

	get cookies(): CookieStore {
		const target = this._cookies;
		return new Proxy(target, {
			get(t: Record<string, string>, prop: string | symbol) {
				if (prop === 'get') return (name: string) => t[name] || undefined;
				if (prop === 'getAll') return () => Object.entries(t).map(([name, value]) => ({ name, value }));
				if (prop === 'toString') return () => Object.entries(t).map(([k, v]) => `${k}=${v}`).join('; ');
				if (prop in t) return t[prop as string];
				return undefined;
			},
		}) as unknown as CookieStore;
	}
	set cookies(v: Record<string, string>) { this._cookies = v; }

	get params(): Record<string, string> { return this._params; }
	set params(v: Record<string, string>) { this._params = v; }

	get locals(): Record<string, unknown> { return this._locals; }
	set locals(v: Record<string, unknown>) { this._locals = v; }
}

interface VeskResponseInstance extends Response {
	setStatus(code: number): VeskResponseInstance;
	build(): VeskResponseInstance;
	text(): Promise<string>;
	json(): Promise<unknown>;
	setCookie(name: string, value: string, opts?: {
		maxAge?: number; httpOnly?: boolean; secure?: boolean;
		sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; domain?: string;
	}): VeskResponseInstance;
	clearCookie(name: string, opts?: { path?: string; domain?: string }): VeskResponseInstance;
	setCsp(policy: string | false): VeskResponseInstance;
	setSecurityHeader(name: string, value: string | false): VeskResponseInstance;
	cache(ttlSeconds: number): VeskResponseInstance;
	noCache(): VeskResponseInstance;
	cors(opts?: { origin?: string; methods?: string; headers?: string; credentials?: boolean }): VeskResponseInstance;
	_flushSecurityHeaders(): void;
	readonly status: number;
}

export class ServerResponse extends Response {
	static json(body: unknown, init?: ResponseInit): ServerResponse {
		return new ServerResponse(JSON.stringify(body), {
			...init,
			headers: { 'Content-Type': 'application/json', ...init?.headers },
		});
	}

	static redirect(url: string, status = 307): ServerResponse {
		return new ServerResponse(null, {
			status,
			headers: { Location: url },
		});
	}

	static rewrite(url: string): ServerResponse {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-rewrite': url },
		});
	}

	static next(): ServerResponse {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-next': '1' },
		});
	}
}

export class VeskRequest extends ServerRequest {
	_query: Record<string, string> | null;
	_ip: string | null;
	_protocol: string | null;
	_hostname: string | null;
	_body: unknown;
	_bodyPromise: Promise<unknown> | null;
	_parsedUrl: URL | null;
	__security?: Record<string, unknown>;

	constructor(input: string | URL, init?: RequestInit) {
		super(input, init);
		this._query = null;
		this._ip = null;
		this._protocol = null;
		this._hostname = null;
		this._body = null;
		this._bodyPromise = null;
		this._parsedUrl = null;
		Object.defineProperty(this, 'body', {
			get: () => {
				if (!this._bodyPromise) {
					this._bodyPromise = this._parseBody();
				}
				return this._bodyPromise;
			},
			configurable: true,
			enumerable: true,
		});
	}

	get parsedUrl(): URL {
		if (!this._parsedUrl) {
			this._parsedUrl = new URL(this.url);
		}
		return this._parsedUrl;
	}

	get query(): Record<string, string> {
		if (!this._query) {
			const params: Record<string, string> = {};
			for (const [k, v] of this.parsedUrl.searchParams) {
				params[k] = v;
			}
			this._query = params;
		}
		return this._query;
	}
	set query(v: Record<string, string>) { this._query = v; }

	get ip(): string {
		if (!this._ip) {
			const fwd = this.headers?.get('x-forwarded-for');
			if (fwd) this._ip = fwd.split(',')[0].trim();
			else this._ip = 'unknown';
		}
		return this._ip;
	}
	set ip(v: string) { this._ip = v; }

	get protocol(): string {
		if (!this._protocol) {
			const proto = this.headers?.get('x-forwarded-proto');
			this._protocol = proto ? proto.split(',')[0].trim() : 'http';
		}
		return this._protocol;
	}
	set protocol(v: string) { this._protocol = v; }

	get hostname(): string {
		if (!this._hostname) {
			this._hostname = this.headers?.get('host')?.split(':')[0] || 'localhost';
		}
		return this._hostname;
	}
	set hostname(v: string) { this._hostname = v; }

	async _parseBody(): Promise<unknown> {
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

	get _security(): Record<string, unknown> {
		if (!this.__security) this.__security = {};
		return this.__security;
	}

	setCsp(policy: string | false): void {
		this._security.contentSecurityPolicy = policy;
	}

	setRateLimit(options: { windowMs?: number; max?: number } | false): void {
		this._security.rateLimit = options;
	}

	setCsrf(enable: boolean): void {
		this._security.csrf = enable;
	}

	setSecurityHeader(name: string, value: string | false): void {
		if (!this._security.customHeaders) this._security.customHeaders = {};
		(this._security.customHeaders as Record<string, string | false>)[name] = value;
	}

	setTrustProxy(enable: boolean | string): void {
		this._security.trustProxy = enable;
	}

	getSecurityOverrides(): Record<string, unknown> {
		return this._security;
	}
}

class _VeskResponse extends ServerResponse {
	_cookieHeaders: string[];
	_secHeaders: Record<string, string | null>;
	_finalStatus: number | null;

	constructor(body?: BodyInit | null, init?: ResponseInit) {
		super(body, init);
		this._cookieHeaders = [];
		this._secHeaders = {};
		this._finalStatus = null;
	}

	setStatus(code: number): _VeskResponse {
		this._finalStatus = code;
		return this;
	}

	get status(): number {
		return this._finalStatus !== null ? this._finalStatus : super.status;
	}

	build(): _VeskResponse {
		this._flushSecurityHeaders();
		return this;
	}

	async text(): Promise<string> {
		this._flushSecurityHeaders();
		return super.text();
	}

	async json(): Promise<unknown> {
		this._flushSecurityHeaders();
		return super.json();
	}

	setCookie(name: string, value: string, opts: {
		maxAge?: number; httpOnly?: boolean; secure?: boolean;
		sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; domain?: string;
	} = {}): _VeskResponse {
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

	clearCookie(name: string, opts: { path?: string; domain?: string } = {}): _VeskResponse {
		return this.setCookie(name, '', { ...opts, maxAge: 0 });
	}

	setCsp(policy: string | false): _VeskResponse {
		this._secHeaders['Content-Security-Policy'] = policy === false ? null : policy;
		return this;
	}

	setSecurityHeader(name: string, value: string | false): _VeskResponse {
		this._secHeaders[name] = value === false ? null : value;
		return this;
	}

	cache(ttlSeconds: number): _VeskResponse {
		this.headers?.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);
		return this;
	}

	noCache(): _VeskResponse {
		this.headers?.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		this.headers?.set('Pragma', 'no-cache');
		this.headers?.set('Expires', '0');
		return this;
	}

	cors(opts: { origin?: string; methods?: string; headers?: string; credentials?: boolean } = {}): _VeskResponse {
		this.headers?.set('Access-Control-Allow-Origin', opts.origin || '*');
		if (opts.methods) this.headers?.set('Access-Control-Allow-Methods', opts.methods);
		if (opts.headers) this.headers?.set('Access-Control-Allow-Headers', opts.headers);
		if (opts.credentials !== false) this.headers?.set('Access-Control-Allow-Credentials', 'true');
		return this;
	}

	_flushSecurityHeaders(): void {
		for (const [name, value] of Object.entries(this._secHeaders)) {
			if (value === null) continue;
			const existing = this.headers?.get(name);
			if (!existing) this.headers?.set(name, value);
		}
		if (this._cookieHeaders.length > 0) {
			const existing = this.headers?.get('Set-Cookie');
			if (existing) {
				this.headers?.set('Set-Cookie', existing + ', ' + this._cookieHeaders.join(', '));
			} else {
				this.headers?.set('Set-Cookie', this._cookieHeaders.join(', '));
			}
		}
	}

	static json(body: unknown, init?: ResponseInit): _VeskResponse {
		return new _VeskResponse(JSON.stringify(body), {
			...init,
			headers: { 'Content-Type': 'application/json', ...init?.headers },
		});
	}

	static redirect(url: string, status = 307): _VeskResponse {
		return new _VeskResponse(null, { status, headers: { Location: url } });
	}

	static rewrite(url: string): _VeskResponse {
		return new _VeskResponse(null, { status: 200, headers: { 'x-vesk-rewrite': url } });
	}

	static next(): _VeskResponse {
		return new _VeskResponse(null, { status: 200, headers: { 'x-vesk-next': '1' } });
	}

	static html(html: string, init?: ResponseInit): _VeskResponse {
		return new _VeskResponse(html, {
			...init,
			headers: { 'Content-Type': 'text/html; charset=utf-8', ...init?.headers },
		});
	}
}

export const VeskResponse = new Proxy(_VeskResponse, {
	apply(target: Function, _thisArg: unknown, args: unknown[]) {
		return new (target as new (...args: unknown[]) => _VeskResponse)(...args);
	}
}) as typeof _VeskResponse & ((body?: unknown, init?: ResponseInit) => VeskResponseInstance);

export function applyRequestSecurity(request: VeskRequest, response: VeskResponseInstance): void {
	if (!request || !response) return;
	const overrides = request.getSecurityOverrides?.() || {};
	if (overrides.contentSecurityPolicy !== undefined) {
		response.setCsp(overrides.contentSecurityPolicy as string | false);
	}
	if (overrides.customHeaders) {
		for (const [name, value] of Object.entries(overrides.customHeaders as Record<string, string | false>)) {
			response.setSecurityHeader(name, value);
		}
	}
	(response as unknown as _VeskResponse)._flushSecurityHeaders();
}

export async function withValidation(
	request: Request,
	schema: { safeParse: (data: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] }; data?: unknown } },
	opts: { jsonOnly?: boolean } = {},
): Promise<unknown | Response> {
	let data: unknown;
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
				issues: result.error!.issues.map(i => ({
					path: i.path.join('.'),
					message: i.message,
				})),
			}, { status: 400 });
		}
		return result.data;
	} catch (e: unknown) {
		return ServerResponse.json({
			error: 'Invalid request body',
			details: (e as Error).message,
		}, { status: 400 });
	}
}

let _signImpl: Record<string, Function | null> | null = null;

async function _getImpl(): Promise<Record<string, Function | null>> {
	if (_signImpl) return _signImpl;
	try {
		_signImpl = await import('../../compiler/src/server-utils.js') as unknown as Record<string, Function | null>;
	} catch {
		try {
			const mod = await import('@vesk/compiler') as Record<string, Function | null>;
			_signImpl = mod;
		} catch {
			_signImpl = { signCookie: null, unsignCookie: null, setSignedCookie: null, readSignedCookie: null };
		}
	}
	return _signImpl;
}

export async function signCookie(name: string, value: string, host?: string): Promise<string> {
	const impl = await _getImpl();
	if (impl.signCookie) return impl.signCookie(name, value, host) as string;
	throw new Error('signCookie: @vesk/compiler not available');
}

export async function unsignCookie(name: string, signedValue: string, host?: string): Promise<string | null> {
	const impl = await _getImpl();
	if (impl.unsignCookie) return impl.unsignCookie(name, signedValue, host) as string | null;
	throw new Error('unsignCookie: @vesk/compiler not available');
}

export async function setSignedCookie(name: string, value: string, options: Record<string, unknown> = {}, host?: string): Promise<string> {
	const impl = await _getImpl();
	if (impl.setSignedCookie) return impl.setSignedCookie(name, value, options, host) as string;
	throw new Error('setSignedCookie: @vesk/compiler not available');
}

export async function readSignedCookie(name: string, cookieString: string, host?: string): Promise<string | null> {
	const impl = await _getImpl();
	if (impl.readSignedCookie) return impl.readSignedCookie(name, cookieString, host) as string | null;
	throw new Error('readSignedCookie: @vesk/compiler not available');
}
