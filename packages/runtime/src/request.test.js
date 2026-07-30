import { ServerResponse, ServerRequest, VeskRequest, VeskResponse, applyRequestSecurity, withValidation, useBody, useParams, useRequest, cors, defineHook, removeHook, runHooks, webhook } from './request';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	console.log(`\n${name}`);
	fn();
}

function it(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(actual);
			const e = JSON.stringify(expected);
			if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
		},
		toBeNull() {
			if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
		},
		toBeInstanceOf(cls) {
			if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`);
		},
		toContain(expected) {
			if (!String(actual).includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
		},
		notToContain(expected) {
			if (String(actual).includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`);
		},
		not: {
			toContain(expected) { if (String(actual).includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`); },
		},
	};
}

describe('ServerResponse', () => {

	it('ServerResponse.json creates JSON response', async () => {
		const res = ServerResponse.json({ ok: true, count: 42 });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.count).toBe(42);
	});

	it('ServerResponse.redirect creates redirect', () => {
		const res = ServerResponse.redirect('/login');
		expect(res.status).toBe(307);
		expect(res.headers.get('Location')).toBe('/login');
	});

	it('ServerResponse.redirect with custom status', () => {
		const res = ServerResponse.redirect('/old', 308);
		expect(res.status).toBe(308);
		expect(res.headers.get('Location')).toBe('/old');
	});

	it('ServerResponse.rewrite sets rewrite header', () => {
		const res = ServerResponse.rewrite('/internal');
		expect(res.status).toBe(200);
		expect(res.headers.get('x-vesk-rewrite')).toBe('/internal');
	});

	it('ServerResponse.next sets next header', () => {
		const res = ServerResponse.next();
		expect(res.status).toBe(200);
		expect(res.headers.get('x-vesk-next')).toBe('1');
	});

	it('ServerResponse extends Response', () => {
		const res = ServerResponse.json({});
		expect(res).toBeInstanceOf(Response);
		expect(res).toBeInstanceOf(ServerResponse);
	});
});

describe('ServerRequest', () => {

	it('extends Request with cookies, params, locals', () => {
		const req = new ServerRequest('http://test/api/users/42', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'test' }),
		});
		req.cookies = { session: 'abc' };
		req.params = { id: '42' };
		req.locals = { user: { role: 'admin' } };
		expect(req.cookies.session).toBe('abc');
		expect(req.params.id).toBe('42');
		expect(req.locals.user.role).toBe('admin');
		expect(req.method).toBe('POST');
	});

	it('inherits Request.json()', async () => {
		const req = new ServerRequest('http://test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hello: 'world' }),
		});
		const body = await req.json();
		expect(body.hello).toBe('world');
	});

	it('has default empty cookies, params, locals', () => {
		const req = new ServerRequest('http://test');
		expect(req.cookies).toEqual({});
		expect(req.params).toEqual({});
		expect(req.locals).toEqual({});
	});
});

describe('withValidation', () => {

	it('throws if zod not available and request has invalid JSON body', async () => {
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json',
		});
		const result = await withValidation(req, { safeParse: () => ({ success: false, error: { issues: [{ path: ['name'], message: 'Required' }] } }) });
		expect(result.status).toBe(400);
		const body = await result.json();
		expect(body.error).toBe('Invalid request body');
	});
});

describe('API Hooks', () => {

	it('useBody parses request body', async () => {
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hello: 'world' }),
		});
		globalThis.__vesk_request = { _request: req };
		const body = await useBody();
		expect(body.hello).toBe('world');
		delete globalThis.__vesk_request;
	});

	it('useBody caches parsed body', async () => {
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ val: 42 }),
		});
		globalThis.__vesk_request = { _request: req };
		const body1 = await useBody();
		const body2 = await useBody();
		expect(body1.val).toBe(42);
		expect(body2.val).toBe(42);
		delete globalThis.__vesk_request;
	});

	it('useBody returns null when no body', async () => {
		globalThis.__vesk_request = { _request: null };
		const body = await useBody();
		expect(body).toBeNull();
		delete globalThis.__vesk_request;
	});

	it('useParams returns empty object outside request context', () => {
		globalThis.__vesk_request = null;
		const params = useParams();
		expect(params).toEqual({});
	});

	it('useParams returns params from context', () => {
		globalThis.__vesk_request = { params: { id: '42', slug: 'hello' } };
		const params = useParams();
		expect(params.id).toBe('42');
		expect(params.slug).toBe('hello');
		delete globalThis.__vesk_request;
	});

	it('useRequest returns the request context', () => {
		const ctx = { method: 'GET', url: '/test' };
		globalThis.__vesk_request = ctx;
		const result = useRequest();
		expect(result.method).toBe('GET');
		expect(result.url).toBe('/test');
		delete globalThis.__vesk_request;
	});

	it('useRequest returns null outside request context', () => {
		globalThis.__vesk_request = null;
		expect(useRequest()).toBeNull();
	});
});

describe('CORS', () => {

	it('cors middleware handles OPTIONS preflight', () => {
		const c = cors();
		const req = new Request('http://test', { method: 'OPTIONS' });
		const result = c(req);
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});

	it('cors with custom origin', () => {
		const c = cors({ origin: 'https://example.com' });
		const req = new Request('http://test', { method: 'OPTIONS' });
		const result = c(req);
		expect(result.status).toBe(204);
		expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
	});

	it('cors sets credentials header', () => {
		const c = cors({ credentials: false });
		const req = new Request('http://test', { method: 'OPTIONS' });
		const result = c(req);
		expect(result.headers.get('Access-Control-Allow-Credentials')).toBeNull();
	});

	it('cors with exposeHeaders', () => {
		const c = cors({ exposeHeaders: ['X-Custom', 'X-Data'] });
		const req = new Request('http://test', { method: 'OPTIONS' });
		const result = c(req);
		expect(result.headers.get('Access-Control-Expose-Headers')).toBe('X-Custom, X-Data');
	});
});

describe('Lifecycle Hooks', () => {

	it('defineHook and runHooks calls registered hook', async () => {
		let called = false;
		const fn = () => { called = true; };
		defineHook('test-hook', fn);
		await runHooks('test-hook');
		expect(called).toBe(true);
		removeHook('test-hook', fn);
	});

	it('runHooks passes arguments to hook', async () => {
		let args = [];
		const fn = (...a) => { args = a; };
		defineHook('args-hook', fn);
		await runHooks('args-hook', 'a', 42);
		expect(args[0]).toBe('a');
		expect(args[1]).toBe(42);
		removeHook('args-hook', fn);
	});

	it('runHooks short-circuits on Response', async () => {
		const fn1 = () => new Response('short-circuit', { status: 201 });
		const fn2 = () => { throw new Error('should not be called'); };
		defineHook('short-hook', fn1);
		defineHook('short-hook', fn2);
		const result = await runHooks('short-hook');
		expect(result.status).toBe(201);
		const text = await result.text();
		expect(text).toBe('short-circuit');
		removeHook('short-hook', fn1);
		removeHook('short-hook', fn2);
	});

	it('removeHook removes a hook', async () => {
		let calls = 0;
		const fn = () => { calls++; };
		defineHook('remove-test', fn);
		await runHooks('remove-test');
		expect(calls).toBe(1);
		removeHook('remove-test', fn);
		await runHooks('remove-test');
		expect(calls).toBe(1);
	});
});

describe('webhook', () => {

	it('webhook factory throws without secret', () => {
		let threw = false;
		try {
			webhook({ handler: () => {} });
		} catch (e) {
			threw = true;
			if (!e.message.includes('secret')) throw new Error(`Expected secret error, got: ${e.message}`);
		}
		if (!threw) throw new Error('Should have thrown');
	});

	it('webhook factory throws without handler', () => {
		let threw = false;
		try {
			webhook({ secret: 'test' });
		} catch (e) {
			threw = true;
			if (!e.message.includes('handler')) throw new Error(`Expected handler error, got: ${e.message}`);
		}
		if (!threw) throw new Error('Should have thrown');
	});

	it('webhook rejects missing signature', async () => {
		const wh = webhook({ secret: 'test', handler: async () => new Response('ok') });
		const req = new Request('http://test', { method: 'POST', body: '{}' });
		const result = await wh(req);
		expect(result.status).toBe(401);
	});

	it('webhook rejects invalid signature', async () => {
		const wh = webhook({ secret: 'test', handler: async () => new Response('ok') });
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'x-webhook-signature': 'sha256=invalid' },
			body: JSON.stringify({ event: 'test' }),
		});
		const result = await wh(req);
		expect(result.status).toBe(401);
	});
});

// ── VeskRequest tests ────────────────────────────────────────────

describe('VeskRequest', () => {

	it('extends ServerRequest with query, ip, protocol, hostname', () => {
		const req = new VeskRequest('http://test/path?page=2&limit=10', {
			headers: { 'x-forwarded-for': '203.0.113.42', 'x-forwarded-proto': 'https', host: 'example.com:443' },
		});
		expect(req.query).toEqual({ page: '2', limit: '10' });
		expect(req.ip).toBe('203.0.113.42');
		expect(req.protocol).toBe('https');
		expect(req.hostname).toBe('example.com');
	});

	it('query falls back to empty object', () => {
		const req = new VeskRequest('http://test/');
		expect(req.query).toEqual({});
	});

	it('ip falls back to unknown', () => {
		const req = new VeskRequest('http://test/');
		expect(req.ip).toBe('unknown');
	});

	it('protocol falls back to http', () => {
		const req = new VeskRequest('http://test/');
		expect(req.protocol).toBe('http');
	});

	it('hostname falls back to localhost', () => {
		const req = new VeskRequest('http://test/');
		expect(req.hostname).toBe('localhost');
	});

	it('body parses JSON body', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hello: 'world', num: 42 }),
		});
		const body = await req.body;
		expect(body.hello).toBe('world');
		expect(body.num).toBe(42);
	});

	it('body caches parsed body', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ val: 99 }),
		});
		const b1 = await req.body;
		const b2 = await req.body;
		expect(b1.val).toBe(99);
		expect(b2).toBe(b1);
	});

	it('body parses form data', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ name: 'test', role: 'admin' }).toString(),
		});
		const body = await req.body;
		expect(body.name).toBe('test');
		expect(body.role).toBe('admin');
	});

	it('parsedUrl returns cached URL', () => {
		const req = new VeskRequest('http://test/foo?q=1');
		const u1 = req.parsedUrl;
		const u2 = req.parsedUrl;
		expect(u1).toBe(u2);
		expect(u1.pathname).toBe('/foo');
	});

	it('security overrides: setCsp', () => {
		const req = new VeskRequest('http://test/');
		req.setCsp("default-src 'self'");
		const sec = req.getSecurityOverrides();
		expect(sec.contentSecurityPolicy).toBe("default-src 'self'");
	});

	it('security overrides: setCsp(false) disables', () => {
		const req = new VeskRequest('http://test/');
		req.setCsp(false);
		expect(req.getSecurityOverrides().contentSecurityPolicy).toBe(false);
	});

	it('security overrides: setRateLimit', () => {
		const req = new VeskRequest('http://test/');
		req.setRateLimit({ windowMs: 1000, max: 5 });
		expect(req.getSecurityOverrides().rateLimit).toEqual({ windowMs: 1000, max: 5 });
	});

	it('security overrides: setRateLimit(false) disables', () => {
		const req = new VeskRequest('http://test/');
		req.setRateLimit(false);
		expect(req.getSecurityOverrides().rateLimit).toBe(false);
	});

	it('security overrides: setCsrf', () => {
		const req = new VeskRequest('http://test/');
		req.setCsrf(false);
		expect(req.getSecurityOverrides().csrf).toBe(false);
		req.setCsrf(true);
		expect(req.getSecurityOverrides().csrf).toBe(true);
	});

	it('security overrides: setSecurityHeader', () => {
		const req = new VeskRequest('http://test/');
		req.setSecurityHeader('X-Frame-Options', 'SAMEORIGIN');
		req.setSecurityHeader('X-Custom', 'value');
		expect(req.getSecurityOverrides().customHeaders['X-Frame-Options']).toBe('SAMEORIGIN');
		expect(req.getSecurityOverrides().customHeaders['X-Custom']).toBe('value');
	});

	it('security overrides: setTrustProxy', () => {
		const req = new VeskRequest('http://test/');
		req.setTrustProxy(true);
		expect(req.getSecurityOverrides().trustProxy).toBe(true);
		req.setTrustProxy('192.168.1.1');
		expect(req.getSecurityOverrides().trustProxy).toBe('192.168.1.1');
	});

	it('security overrides: default empty', () => {
		const req = new VeskRequest('http://test/');
		expect(req.getSecurityOverrides()).toEqual({});
	});

	it('inherits cookies, params, locals from ServerRequest', () => {
		const req = new VeskRequest('http://test/');
		req.cookies = { token: 'abc' };
		req.params = { id: '42' };
		req.locals = { user: 'admin' };
		expect(req.cookies.token).toBe('abc');
		expect(req.params.id).toBe('42');
		expect(req.locals.user).toBe('admin');
	});
});

// ── VeskResponse tests ───────────────────────────────────────────

describe('VeskResponse', () => {

	it('VeskResponse.json creates JSON VeskResponse', async () => {
		const res = VeskResponse.json({ ok: true });
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		expect(res).toBeInstanceOf(VeskResponse);
		const body = await res.json();
		expect(body.ok).toBe(true);
	});

	it('VeskResponse.redirect creates redirect VeskResponse', () => {
		const res = VeskResponse.redirect('/login');
		expect(res).toBeInstanceOf(VeskResponse);
		expect(res.status).toBe(307);
		expect(res.headers.get('Location')).toBe('/login');
	});

	it('VeskResponse.html creates HTML VeskResponse', async () => {
		const res = VeskResponse.html('<h1>Hello</h1>');
		expect(res).toBeInstanceOf(VeskResponse);
		expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		const text = await res.text();
		expect(text).toBe('<h1>Hello</h1>');
	});

	it('VeskResponse.rewrite creates rewrite VeskResponse', () => {
		const res = VeskResponse.rewrite('/new');
		expect(res).toBeInstanceOf(VeskResponse);
		expect(res.headers.get('x-vesk-rewrite')).toBe('/new');
	});

	it('VeskResponse.next creates next VeskResponse', () => {
		const res = VeskResponse.next();
		expect(res).toBeInstanceOf(VeskResponse);
		expect(res.headers.get('x-vesk-next')).toBe('1');
	});

	it('VeskResponse.status chains status code', () => {
		const res = VeskResponse.json({}).setStatus(201);
		expect(res.status).toBe(201);
	});

	it('VeskResponse.setCookie sets cookie headers', () => {
		const res = VeskResponse.json({}).setCookie('session', 'abc123');
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('session=abc123');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Path=/');
	});

	it('VeskResponse.setCookie with custom options', () => {
		const res = VeskResponse.json({}).setCookie('theme', 'dark', {
			httpOnly: false, secure: false, sameSite: 'Strict', path: '/app', maxAge: 3600, domain: 'example.com',
		});
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('theme=dark');
		expect(cookie).not.toContain('HttpOnly');
		expect(cookie).not.toContain('Secure');
		expect(cookie).toContain('SameSite=Strict');
		expect(cookie).toContain('Path=/app');
		expect(cookie).toContain('Max-Age=3600');
		expect(cookie).toContain('Domain=example.com');
	});

	it('VeskResponse.clearCookie clears a cookie', () => {
		const res = VeskResponse.json({}).clearCookie('session');
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('session=');
		expect(cookie).toContain('Max-Age=0');
	});

	it('VeskResponse.setCsp overrides CSP', () => {
		const res = VeskResponse.json({}).setCsp("default-src 'none'");
		res.build();
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
	});

	it('VeskResponse.setCsp(false) omits CSP', () => {
		const res = VeskResponse.json({}).setCsp(false);
		res.build();
		expect(res.headers.get('Content-Security-Policy')).toBeNull();
	});

	it('VeskResponse.setSecurityHeader sets custom header', () => {
		const res = VeskResponse.json({}).setSecurityHeader('X-Custom', 'val');
		res.build();
		expect(res.headers.get('X-Custom')).toBe('val');
	});

	it('VeskResponse.cache sets Cache-Control', () => {
		const res = VeskResponse.json({}).cache(300);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
	});

	it('VeskResponse.noCache disables caching', () => {
		const res = VeskResponse.json({}).noCache();
		expect(res.headers.get('Cache-Control')).toContain('no-store');
		expect(res.headers.get('Pragma')).toBe('no-cache');
		expect(res.headers.get('Expires')).toBe('0');
	});

	it('VeskResponse.cors sets CORS headers', () => {
		const res = VeskResponse.json({}).cors({ origin: 'https://app.com', methods: 'GET,POST', headers: 'X-Custom' });
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.com');
		expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST');
		expect(res.headers.get('Access-Control-Allow-Headers')).toBe('X-Custom');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});

	it('VeskResponse.build() chains all methods', () => {
		const res = VeskResponse.json({ data: 'test' })
			.setStatus(201)
			.setCsp("default-src 'self'")
			.setCookie('token', 'xyz')
			.cache(60)
			.build();
		expect(res.status).toBe(201);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
		expect(res.headers.get('Set-Cookie')).toContain('token=xyz');
	});

	it('VeskResponse.text() auto-flushes security headers', async () => {
		const res = VeskResponse.html('<p>ok</p>').setCsp("default-src 'self'");
		const text = await res.text();
		expect(text).toBe('<p>ok</p>');
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
	});

	it('multiple setCookie calls accumulate', () => {
		const res = VeskResponse.json({})
			.setCookie('a', '1')
			.setCookie('b', '2');
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('a=1');
		expect(cookie).toContain('b=2');
	});
});

// ── applyRequestSecurity ─────────────────────────────────────────

describe('applyRequestSecurity', () => {

	it('applies CSP override from request to response', () => {
		const req = new VeskRequest('http://test/');
		req.setCsp("default-src 'none'");
		const res = VeskResponse.json({});
		applyRequestSecurity(req, res);
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
	});

	it('applies custom headers from request to response', () => {
		const req = new VeskRequest('http://test/');
		req.setSecurityHeader('X-Frame-Options', 'SAMEORIGIN');
		req.setSecurityHeader('X-Custom', 'val');
		const res = VeskResponse.json({});
		applyRequestSecurity(req, res);
		expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
		expect(res.headers.get('X-Custom')).toBe('val');
	});

	it('handles empty request overrides gracefully', () => {
		const req = new VeskRequest('http://test/');
		const res = VeskResponse.json({});
		applyRequestSecurity(req, res);
		expect(res.headers.get('Content-Security-Policy')).toBeNull();
	});

	it('handles null/undefined request gracefully', () => {
		const res = VeskResponse.json({});
		applyRequestSecurity(null, res);
		applyRequestSecurity(undefined, res);
		expect(res.status).toBe(200);
	});
});

// ── VeskResponse auto-build behavior ──────────────────────────

describe('VeskResponse build / auto-flush', () => {

	it('build() flushes cookies into headers', () => {
		const res = VeskResponse.json({ ok: true }).setCookie('session', 'abc', { httpOnly: true, secure: true, path: '/' });
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('session=abc');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
	});

	it('build() flushes multiple cookies', () => {
		const res = VeskResponse.json({})
			.setCookie('a', '1')
			.setCookie('b', '2');
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('a=1');
		expect(cookie).toContain('b=2');
	});

	it('build() flushes security headers', () => {
		const res = VeskResponse.json({}).setCsp("default-src 'none'");
		res.build();
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
	});

	it('build() does not override existing headers', () => {
		const res = VeskResponse.json({}, { headers: { 'Content-Type': 'text/plain' } });
		res.build();
		expect(res.headers.get('Content-Type')).toBe('text/plain');
	});

	it('setStatus is respected via getter after build', () => {
		const res = VeskResponse.json({}).setStatus(201);
		expect(res.status).toBe(201);
	});

	it('setStatus defaults to 200', () => {
		const res = VeskResponse.json({});
		expect(res.status).toBe(200);
	});

	it('cors() sets CORS headers', () => {
		const res = VeskResponse.json({}).cors({ origin: 'https://example.com' });
		res.build();
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});

	it('cache() sets Cache-Control', () => {
		const res = VeskResponse.json({}).cache(300);
		expect(res.headers.get('Cache-Control')).toContain('max-age=300');
	});

	it('noCache() disables caching', () => {
		const res = VeskResponse.json({}).noCache();
		expect(res.headers.get('Cache-Control')).toContain('no-store');
		expect(res.headers.get('Pragma')).toBe('no-cache');
		expect(res.headers.get('Expires')).toBe('0');
	});

	it('text() flushes cookies before returning body', async () => {
		const res = VeskResponse.json({ msg: 'hi' }).setCookie('x', 'y');
		const body = await res.text();
		expect(body).toBe('{"msg":"hi"}');
		expect(res.headers.get('Set-Cookie')).toContain('x=y');
	});

	it('json() flushes cookies before parsing', async () => {
		const res = VeskResponse.json({ msg: 'hi' }).setCookie('x', 'y');
		const data = await res.json();
		expect(data.msg).toBe('hi');
		expect(res.headers.get('Set-Cookie')).toContain('x=y');
	});

	it('VeskResponse.json() static builds before returning', () => {
		const res = VeskResponse.json({ n: 42 }).setStatus(201);
		expect(res.status).toBe(201);
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});

	it('clearCookie removes a cookie', () => {
		const res = new VeskResponse('').clearCookie('session');
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('session=');
		expect(cookie).toContain('Max-Age=0');
	});

	it('security headers are set via setSecurityHeader', () => {
		const res = VeskResponse.json({}).setSecurityHeader('X-Frame-Options', 'DENY');
		res.build();
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('setSecurityHeader with false omits the header', () => {
		const res = VeskResponse.json({}).setSecurityHeader('X-Frame-Options', false);
		res.build();
		expect(res.headers.get('X-Frame-Options')).toBeNull();
	});

	it('build() is idempotent', () => {
		const res = VeskResponse.json({}).setCookie('x', 'y');
		res.build();
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('x=y');
	});

});

// ── VeskResponse static factory returns proper type ──────────────

describe('VeskResponse static factories return VeskResponse', () => {

	it('json returns VeskResponse', () => {
		expect(VeskResponse.json({})).toBeInstanceOf(VeskResponse);
	});
	it('redirect returns VeskResponse', () => {
		expect(VeskResponse.redirect('/')).toBeInstanceOf(VeskResponse);
	});
	it('html returns VeskResponse', () => {
		expect(VeskResponse.html('')).toBeInstanceOf(VeskResponse);
	});
	it('rewrite returns VeskResponse', () => {
		expect(VeskResponse.rewrite('/')).toBeInstanceOf(VeskResponse);
	});
	it('next returns VeskResponse', () => {
		expect(VeskResponse.next()).toBeInstanceOf(VeskResponse);
	});
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
