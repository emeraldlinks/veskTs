import { ServerResponse, ServerRequest, VeskRequest, VeskResponse, toVeskResponse, DEFAULT_MAX_BODY_BYTES, PayloadTooLargeError, applyRequestSecurity, withValidation, useBody, useParams, useRequest, headers, toHeadersMap, cors, defineHook, removeHook, runHooks, webhook } from '@vesk/runtime/src/request';

let passed = 0;
let failed = 0;
const suites: Array<{ name: string; tests: Array<{ name: string; fn: () => unknown }> }> = [];
let currentSuite: { name: string; tests: Array<{ name: string; fn: () => unknown }> } | null = null;

function describe(name, fn) {
	currentSuite = { name, tests: [] };
	suites.push(currentSuite);
	fn();
	currentSuite = null;
}

function it(name, fn) {
	if (!currentSuite) throw new Error(`it(${JSON.stringify(name)}) called outside describe()`);
	currentSuite.tests.push({ name, fn });
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
		toBeUndefined() {
			if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
		},
		toThrow(expected?: string) {
			if (typeof actual !== 'function') throw new Error('toThrow() expects a function');
			try {
				actual();
			} catch (e) {
				if (expected && !String((e as Error).message).includes(expected)) {
					throw new Error(`Expected error containing "${expected}", got "${(e as Error).message}"`);
				}
				return;
			}
			throw new Error('Expected function to throw');
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

describe('headers()', () => {
	it('returns a real Map with lower-cased header names', () => {
		globalThis.__vesk_request = {
			headers: new Map([['X-Test', 'yes'], ['Accept', 'text/html']]),
		};
		const h = headers();
		expect(h).toBeInstanceOf(Map);
		expect(h.size).toBe(2);
		expect(h.get('x-test')).toBe('yes');
		expect(h.get('accept')).toBe('text/html');
		expect(h.has('X-Test')).toBe(true);
		expect([...h.keys()].includes('x-test')).toBe(true);
		expect((h as unknown as Record<string, string>)['x-test']).toBe('yes');
		delete globalThis.__vesk_request;
	});

	it('normalizes Headers, Maps, and plain Node header records', () => {
		const fromHeaders = toHeadersMap(new Headers({ 'X-Test': 'yes' }));
		expect(fromHeaders.get('x-test')).toBe('yes');

		const fromMap = toHeadersMap(new Map([['X-Test', 'yes']]));
		expect(fromMap.get('x-test')).toBe('yes');

		const fromRecord = toHeadersMap({ 'X-Test': ['a', 'b'], ignore: undefined });
		expect(fromRecord.get('x-test')).toBe('a, b');
		expect(fromRecord.has('ignore')).toBe(false);
	});

	it('keeps legacy record contexts readable through the Map API', () => {
		globalThis.__vesk_request = { headers: { 'X-Legacy': '1' } };
		const h = headers();
		expect(h).toBeInstanceOf(Map);
		expect(h.get('x-legacy')).toBe('1');
		delete globalThis.__vesk_request;
	});

	it('returns an empty Map outside a request', () => {
		globalThis.__vesk_request = null;
		const h = headers();
		expect(h).toBeInstanceOf(Map);
		expect(h.size).toBe(0);
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

// Computed with WebCrypto directly rather than through the helper under test,
// so a bug in `computeSignature` cannot make its own test pass.
async function hmacHex(secret, payload, hash) {
	const key = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

	it('webhook accepts a correctly signed body (SHA-256 default)', async () => {
		const secret = 'whsec_test';
		const body = JSON.stringify({ event: 'charge.success' });
		const sig = await hmacHex(secret, body, 'SHA-256');
		let seen = null;
		const wh = webhook({ secret, handler: async (e) => { seen = e; return new Response('ok'); } });
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'x-webhook-signature': 'sha256=' + sig },
			body,
		});
		const result = await wh(req);
		expect(result.status).toBe(200);
		expect(seen).toEqual({ event: 'charge.success' });
	});

	// Paystack: HMAC-SHA512 hex, no prefix, over `amount + reference` — not the
	// raw body. Neither the algorithm nor the payload matches the default.
	it('webhook verifies a Paystack-shaped SHA-512 signature over a field subset', async () => {
		const secret = 'sk_test_secret';
		const event = { event: 'charge.success', data: { amount: 500000, reference: 'ref_abc123' } };
		const body = JSON.stringify(event);
		const sig = await hmacHex(secret, `${event.data.amount}${event.data.reference}`, 'SHA-512');
		let seen = null;
		const wh = webhook({
			secret,
			headerName: 'x-paystack-signature',
			signaturePrefix: '',
			algorithm: 'SHA-512',
			signedPayload: (e) => `${e.data.amount}${e.data.reference}`,
			handler: async (ev) => { seen = ev; return new Response('ok'); },
		});
		const req = new Request('http://test', {
			method: 'POST',
			headers: { 'x-paystack-signature': sig },
			body,
		});
		const result = await wh(req);
		expect(result.status).toBe(200);
		expect(seen).toEqual(event);
	});

	it('a SHA-256 signature is refused when SHA-512 is configured', async () => {
		const secret = 'sk_test_secret';
		const event = { event: 'charge.success', data: { amount: 500000, reference: 'ref_abc123' } };
		const body = JSON.stringify(event);
		const sig = await hmacHex(secret, `${event.data.amount}${event.data.reference}`, 'SHA-256');
		const wh = webhook({
			secret, headerName: 'x-paystack-signature', signaturePrefix: '', algorithm: 'SHA-512',
			signedPayload: (e) => `${e.data.amount}${e.data.reference}`,
			handler: async () => new Response('ok'),
		});
		const result = await wh(new Request('http://test', { method: 'POST', headers: { 'x-paystack-signature': sig }, body }));
		expect(result.status).toBe(401);
	});

	it('a valid signature over the wrong fields is refused', async () => {
		const secret = 'sk_test_secret';
		const event = { event: 'charge.success', data: { amount: 500000, reference: 'ref_abc123' } };
		const body = JSON.stringify(event);
		// Correct secret and hash, but the amount a real attacker would raise.
		const sig = await hmacHex(secret, `900000${event.data.reference}`, 'SHA-512');
		const wh = webhook({
			secret, headerName: 'x-paystack-signature', signaturePrefix: '', algorithm: 'SHA-512',
			signedPayload: (e) => `${e.data.amount}${e.data.reference}`,
			handler: async () => new Response('ok'),
		});
		const result = await wh(new Request('http://test', { method: 'POST', headers: { 'x-paystack-signature': sig }, body }));
		expect(result.status).toBe(401);
	});

	it('an event missing the signed fields is a 401, not a 500', async () => {
		const secret = 'sk_test_secret';
		const wh = webhook({
			secret, headerName: 'x-paystack-signature', signaturePrefix: '', algorithm: 'SHA-512',
			signedPayload: (e) => `${e.data.amount}${e.data.reference}`,
			handler: async () => new Response('ok'),
		});
		const sig = await hmacHex(secret, 'x', 'SHA-512');
		const result = await wh(new Request('http://test', {
			method: 'POST', headers: { 'x-paystack-signature': sig }, body: JSON.stringify({ noData: true }),
		}));
		expect(result.status).toBe(401);
	});

	it('signedPayload does not weaken the POST-only rule', async () => {
		const wh = webhook({
			secret: 's', algorithm: 'SHA-512', signaturePrefix: '',
			signedPayload: () => 'x', handler: async () => new Response('ok'),
		});
		const result = await wh(new Request('http://test', { method: 'GET' }));
		expect(result.status).toBe(405);
	});

	// Compile-time contract: declaring the event type must infer through both
	// `handler` and `signedPayload`. `amount` is read off the typed event, so if
	// the generic were dropped this file would fail to typecheck.
	it('webhook generic infers the event in handler and signedPayload', async () => {
		type PaystackEvent = { event: string; data: { amount: number; reference: string } };
		const secret = 'sk_test_secret';
		const event: PaystackEvent = { event: 'charge.success', data: { amount: 500000, reference: 'ref_typed' } };
		const body = JSON.stringify(event);
		const sig = await hmacHex(secret, `${event.data.amount}${event.data.reference}`, 'SHA-512');
		let amount = 0;
		const wh = webhook<PaystackEvent>({
			secret, headerName: 'x-paystack-signature', signaturePrefix: '', algorithm: 'SHA-512',
			signedPayload: (e) => `${e.data.amount}${e.data.reference}`,
			handler: (e) => { amount = e.data.amount; return new Response('ok'); },
		});
		const result = await wh(new Request('http://test', {
			method: 'POST', headers: { 'x-paystack-signature': sig }, body,
		}));
		expect(result.status).toBe(200);
		expect(amount).toBe(500000);
	});

	it('a non-POST delivery never reaches signedPayload', async () => {
		let called = false;
		const wh = webhook({
			secret: 's', algorithm: 'SHA-512', signedPayload: () => { called = true; return 'x'; },
			handler: async () => new Response('ok'),
		});
		await wh(new Request('http://test', { method: 'GET' }));
		await wh(new Request('http://test', { method: 'DELETE' }));
		expect(called).toBe(false);
	});
});

// ── VeskRequest tests ────────────────────────────────────────────

describe('VeskRequest', () => {

	it('extends ServerRequest with query, ip, protocol, hostname', () => {
		const req = new VeskRequest('http://test/path?page=2&limit=10', {
			headers: { 'x-forwarded-for': '203.0.113.42', 'x-forwarded-proto': 'https', host: 'example.com:443' },
		});
		expect(req.query).toEqual({ page: '2', limit: '10' });
		// proxy headers are ignored until explicitly trusted (anti-spoofing)
		expect(req.ip).toBe('unknown');
		expect(req.protocol).toBe('http');
		expect(req.hostname).toBe('example.com');
	});

	it('ip/protocol honor x-forwarded-* only after setTrustProxy', () => {
		const req = new VeskRequest('https://test/path', {
			headers: { 'x-forwarded-for': '203.0.113.42', 'x-forwarded-proto': 'https' },
		});
		req.setTrustProxy(true);
		expect(req.ip).toBe('203.0.113.42');
		expect(req.protocol).toBe('https');
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

	it('host and origin use the Host header', () => {
		const req = new VeskRequest('http://internal:8080/path', { headers: { host: 'example.com:443' } });
		expect(req.host).toBe('example.com:443');
		expect(req.origin).toBe('http://example.com:443');
	});

	it('host honors x-forwarded-host only after setTrustProxy', () => {
		const req = new VeskRequest('http://internal/path', {
			headers: { host: 'internal', 'x-forwarded-host': 'public.example.com' },
		});
		expect(req.host).toBe('internal');
		req.setTrustProxy(true);
		expect(req.host).toBe('public.example.com');
		expect(req.origin).toBe('http://public.example.com');
	});

	it('host and origin fall back to the parsed URL', () => {
		const req = new VeskRequest('https://fallback.test/path');
		expect(req.host).toBe('fallback.test');
		expect(req.origin).toBe('https://fallback.test');
	});

	it('hostname strips the port and supports a setter', () => {
		const req = new VeskRequest('http://test/', { headers: { host: 'example.com:8080' } });
		expect(req.hostname).toBe('example.com');
		req.hostname = 'override.test';
		expect(req.hostname).toBe('override.test');
	});

	it('protocol supports a setter', () => {
		const req = new VeskRequest('http://test/');
		expect(req.protocol).toBe('http');
		req.protocol = 'https';
		expect(req.protocol).toBe('https');
	});

	it('ip uses x-real-ip when trusted and supports a setter', () => {
		const req = new VeskRequest('http://test/', { headers: { 'x-real-ip': '198.51.100.7' } });
		req.setTrustProxy(true);
		expect(req.ip).toBe('198.51.100.7');
		req.ip = '203.0.113.9';
		expect(req.ip).toBe('203.0.113.9');
	});

	it('resolveUrl resolves relative paths and passes absolute URLs through', () => {
		const req = new VeskRequest('https://example.com/dir/page');
		expect(req.resolveUrl('/api/self')).toBe('https://example.com/api/self');
		expect(req.resolveUrl('child')).toBe('https://example.com/child');
		expect(req.resolveUrl('https://other.test/x')).toBe('https://other.test/x');
		expect(req.resolveUrl('//cdn.test/x')).toBe('//cdn.test/x');
	});

	it('set/get expose the locals map', () => {
		const req = new VeskRequest('http://test/');
		expect(req.get('missing')).toBeUndefined();
		req.set('user', { id: 7 });
		expect(req.get('user').id).toBe(7);
		expect(req.locals.user.id).toBe(7);
	});

	it('parses and decodes cookies from the Cookie header', () => {
		const req = new VeskRequest('http://test/', {
			headers: { cookie: 'session=abc%20123; theme=dark; empty=' },
		});
		expect(req.cookie('session')).toBe('abc 123');
		expect(req.cookie('theme')).toBe('dark');
		expect(req.cookie('empty')).toBe('');
		expect(req.cookie('missing')).toBeUndefined();
	});

	it('shouldBindQuery returns raw query and validates with safeParse', () => {
		const req = new VeskRequest('http://test/?page=2&limit=10');
		expect(req.shouldBindQuery().data.page).toBe('2');
		const ok = req.shouldBindQuery({ safeParse: (d) => ({ success: true, data: { page: Number(d.page) } }) });
		expect(ok.data.page).toBe(2);
		const bad = req.shouldBindQuery({ safeParse: () => ({ success: false, error: { issues: [] } }) });
		expect(bad.error.issues.length).toBe(0);
	});

	it('bindQuery returns data and throws validation errors', () => {
		const req = new VeskRequest('http://test/?page=2');
		expect(req.bindQuery().page).toBe('2');
		expect(() => req.bindQuery({ safeParse: () => ({ success: false, error: new Error('bad query') }) })).toThrow('bad query');
	});

	it('shouldBindJSON reads a clone so the body stays available', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ok: true, name: 'vesk' }),
		});
		const bound = await req.shouldBindJSON();
		expect(bound.data.ok).toBe(true);
		const body = await req.body;
		expect(body.name).toBe('vesk');
	});

	it('shouldBindJSON and bindJSON apply schema validation', async () => {
		const makeReq = () => new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ count: '3' }),
		});
		const ok = await makeReq().shouldBindJSON({ safeParse: (d) => ({ success: true, data: { count: Number(d.count) } }) });
		expect(ok.data.count).toBe(3);

		const cachedReq = makeReq();
		expect(await cachedReq.body).toEqual({ count: '3' });
		expect((await cachedReq.shouldBindJSON()).data).toEqual({ count: '3' });
		expect((await cachedReq.bindJSON()).count).toBe('3');

		const bad = await makeReq().shouldBindJSON({ safeParse: () => ({ success: false, error: new Error('invalid json body') }) });
		expect(bad.error.message).toBe('invalid json body');
		let threw = false;
		try {
			await makeReq().bindJSON({ safeParse: () => ({ success: false, error: new Error('invalid json body') }) });
		} catch (e) {
			threw = String((e as Error).message).includes('invalid json body');
		}
		expect(threw).toBe(true);
	});

	it('getBody() aliases the cached parsed body', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ n: 1 }),
		});
		const first = await req.getBody();
		const second = await req.getBody();
		const body = await req.body;
		expect(first.n).toBe(1);
		expect(second).toBe(first);
		expect(body).toBe(first);
	});

	it('body falls back to text when the content type is not JSON or form', async () => {
		const req = new VeskRequest('http://test/', {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: 'hello',
		});
		expect(await req.body).toBe('hello');
	});

	it('query and parsedUrl setters update the parsed view', () => {
		const req = new VeskRequest('http://test/first?a=1');
		expect(req.query.a).toBe('1');
		req.query = { b: '2' };
		expect(req.query.b).toBe('2');
		req.parsedUrl = new URL('http://test/second?c=3');
		expect(req.parsedUrl.pathname).toBe('/second');
		expect(req.query.c).toBe('3');
		expect(req.query.b).toBeUndefined();
	});

	it('VeskRequest.from copies method/headers/cookies and seeds params/locals', () => {
		const platform = new Request('http://test/items/7', {
			method: 'POST',
			headers: { cookie: 'session=xyz', 'x-test': 'yes' },
		});
		const req = VeskRequest.from(platform, { params: { id: '7' }, locals: { user: 'admin' } });
		expect(req.method).toBe('POST');
		expect(req.headers.get('x-test')).toBe('yes');
		expect(req.cookies.session).toBe('xyz');
		expect(req.params.id).toBe('7');
		expect(req.locals.user).toBe('admin');
		expect(req.get('user')).toBe('admin');
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

	it('VeskResponse.redirect instance mutates status and Location', () => {
		const res = VeskResponse.json({ ok: true }).setCookie('session', 'abc');
		const returned = res.redirect('/login');
		expect(returned).toBe(res);
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/login');
		res.build();
		expect(res.headers.get('Set-Cookie')).toContain('session=abc');
	});

	it('VeskResponse.redirect instance accepts a custom status', () => {
		const res = VeskResponse.json({ ok: true }).redirect('/moved', 308);
		expect(res.status).toBe(308);
		expect(res.headers.get('Location')).toBe('/moved');
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

	it('is callable without new', async () => {
		const res = VeskResponse('plain body', { status: 202, headers: { 'x-test': '1' } });
		expect(res).toBeInstanceOf(VeskResponse);
		expect(res.status).toBe(202);
		expect(res.getHeader('x-test')).toBe('1');
		expect(res.statusCode).toBe(202);
		expect(await res.text()).toBe('plain body');
	});

	it('stream() preserves the ReadableStream body and init headers', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('chunked'));
				controller.close();
			},
		});
		const res = VeskResponse.stream(stream, { status: 201, headers: { 'Content-Type': 'text/plain' } });
		expect(res.body).toBe(stream);
		expect(res.status).toBe(201);
		expect(res.headers.get('Content-Type')).toBe('text/plain');
		expect(await res.text()).toBe('chunked');
	});

	it('instance redirect preserves body, cookies and security headers', async () => {
		const res = VeskResponse.json({ ok: true })
			.setCookie('session', 'abc')
			.setCsp("default-src 'none'")
			.redirect('/login', 303)
			.build();
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/login');
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
		expect(res.headers.get('Set-Cookie')).toContain('session=abc');
		expect(await res.json()).toEqual({ ok: true });
	});

	it('clearCookie(name) expires one cookie and preserves the others', () => {
		const res = VeskResponse.json({})
			.setCookie('a', '1')
			.setCookie('b', '2')
			.clearCookie('a', { path: '/app', domain: 'example.com' });
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('a=;');
		expect(cookie).toContain('Max-Age=0');
		expect(cookie).toContain('Path=/app');
		expect(cookie).toContain('Domain=example.com');
		expect(cookie).toContain('b=2');
		expect(cookie).not.toContain('a=1');
	});

	it('clearCookie() expires every queued cookie', () => {
		const res = VeskResponse.json({})
			.setCookie('a', '1')
			.setCookie('b', '2')
			.clearCookie();
		res.build();
		const cookie = res.headers.get('Set-Cookie');
		expect(cookie).toContain('a=;');
		expect(cookie).toContain('b=;');
		expect(cookie).not.toContain('a=1');
		expect(cookie).not.toContain('b=2');
	});

	it('formData() parses a form-encoded body', async () => {
		const res = VeskResponse(new URLSearchParams({ name: 'vesk', role: 'admin' }));
		const data = await res.formData();
		expect(data.get('name')).toBe('vesk');
		expect(data.get('role')).toBe('admin');
	});

	it('text/json/formData enforce the response body cap', async () => {
		for (const method of ['text', 'json', 'formData']) {
			const res = VeskResponse(new URLSearchParams({ a: '1' }), {
				headers: { 'content-length': String(DEFAULT_MAX_BODY_BYTES + 1) },
			});
			let error = null;
			try {
				await (res as any)[method]();
			} catch (e) {
				error = e;
			}
			expect(error instanceof PayloadTooLargeError).toBe(true);
			expect(error.status).toBe(413);
		}
	});

	it('cors({ credentials: false }) omits only the credentials header', () => {
		const res = VeskResponse.json({}).cors({ credentials: false });
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
	});

	it('static json/html/rewrite/next/redirect report their documented status/headers', () => {
		expect(VeskResponse.json({}, { status: 201 }).status).toBe(201);
		expect(VeskResponse.html('<b>x</b>').headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(VeskResponse.rewrite('/internal').headers.get('x-vesk-rewrite')).toBe('/internal');
		expect(VeskResponse.next().headers.get('x-vesk-next')).toBe('1');
		expect(VeskResponse.redirect('/old', 308).status).toBe(308);
	});

	it('toVeskResponse upgrades a plain Response and passes through VeskResponse/null', async () => {
		expect(toVeskResponse(null)).toBeNull();
		expect(toVeskResponse(undefined)).toBeUndefined();
		const original = VeskResponse.json({ ok: true });
		expect(toVeskResponse(original)).toBe(original);

		const plain = new Response('plain', { status: 418, headers: { 'x-tea': 'yes' } });
		const upgraded = toVeskResponse(plain);
		expect(upgraded).toBeInstanceOf(VeskResponse);
		expect(upgraded.status).toBe(418);
		expect(upgraded.getHeader('x-tea')).toBe('yes');
		expect(await upgraded.text()).toBe('plain');
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

describe('VeskRequest previous route', () => {

	it('reads a local previous route from x-vesk-previous-route', () => {
		const req = new VeskRequest('http://localhost/login', {
			headers: { 'x-vesk-previous-route': '/account?tab=security#top' },
		});
		expect(req.previousRoute).toBe('/account?tab=security#top');
		expect(req.previousRouteInfo.source).toBe('x-vesk-previous-route');
		expect(req.previousRouteInfo.headers.get('x-vesk-previous-route')).toBe('/account?tab=security#top');
	});

	it('falls back to x-return-to and then a same-origin referer', () => {
		const returnTo = new VeskRequest('http://localhost/login', {
			headers: { 'x-return-to': '/billing' },
		});
		expect(returnTo.previousRoute).toBe('/billing');

		const referer = new VeskRequest('http://localhost/login', {
			headers: { referer: 'http://localhost/account?x=1' },
		});
		expect(referer.previousRoute).toBe('/account?x=1');
		expect(referer.previousRouteInfo.source).toBe('referer');
	});

	it('accepts a same-app referer with loopback host and port variants', () => {
		const req = new VeskRequest('http://localhost/login', {
			headers: { referer: 'http://127.0.0.1:3000/account?x=1' },
		});
		expect(req.previousRoute).toBe('/account?x=1');
		expect(req.previousRouteInfo.source).toBe('referer');
	});

	it('reads next/returnTo from the query string', () => {
		const req = new VeskRequest('http://localhost/login?next=%2Fdashboard%3Fx%3D1');
		expect(req.previousRoute).toBe('/dashboard?x=1');
		expect(req.previousRouteInfo.source).toBe('query');
	});

	it('rejects cross-origin and protocol-relative previous routes', () => {
		const crossOrigin = new VeskRequest('http://localhost/login', {
			headers: { referer: 'https://evil.test/account' },
		});
		expect(crossOrigin.previousRoute).toBeNull();

		const protocolRelative = new VeskRequest('http://localhost/login', {
			headers: { 'x-vesk-previous-route': '//evil.test/account' },
		});
		expect(protocolRelative.previousRoute).toBeNull();
	});

});

for (const suite of suites) {
	console.log(`\n${suite.name}`);
	for (const test of suite.tests) {
		try {
			await test.fn();
			passed++;
			console.log(`  ✓ ${test.name}`);
		} catch (e) {
			failed++;
			console.log(`  ✗ ${test.name}`);
			console.log(`    ${(e as Error).message}`);
		}
	}
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
