import { ServerResponse, ServerRequest, withValidation, useBody, useParams, useRequest, cors, defineHook, removeHook, runHooks, webhook } from './request.js';

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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
