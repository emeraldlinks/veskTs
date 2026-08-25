import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { scanRoutes } from '@vesk/compiler/src/router';
import { collectMiddlewareChain, loadMiddleware, executeMiddlewareChain } from '@vesk/compiler/src/middleware';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function test(name, fn) {
	const p = Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e) => { failed++; console.log(`  ✗ ${name} — ${e.message}`); });
	pending.push(p);
	return p;
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${actual}`); },
		toBeNull() { if (actual !== null && actual !== undefined) throw new Error(`expected null, got ${JSON.stringify(actual)}`); },
	};
}

function createFixture(files) {
	const tmp = mkdtempSync('/tmp/vesk-mw-test-');
	for (const [path, content] of Object.entries(files)) {
		const fullPath = join(tmp, path);
		mkdirSync(join(fullPath, '..'), { recursive: true });
		writeFileSync(fullPath, content || '');
	}
	return tmp;
}

function cleanup(tmp) {
	try { rmSync(tmp, { recursive: true }); } catch {}
}

console.log('Middleware chain collection\n');

test('collects root middleware for /', () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': 'export async function middleware(ctx, next) { return next(); }',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/', tmp);
	expect(chain.length).toBe(1);
	expect(chain[0].sourcePath.endsWith('middleware.ts')).toBe(true);
	cleanup(tmp);
});

test('collects nested middleware chain parent-first', () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': 'export async function middleware(ctx, next) { return next(); }',
		'app/blog/page.vsk': '',
		'app/blog/middleware.ts': 'export async function middleware(ctx, next) { return next(); }',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/blog', tmp);
	expect(chain.length).toBe(2);
	expect(chain[0].sourcePath.endsWith('app/middleware.ts')).toBe(true);
	expect(chain[1].sourcePath.endsWith('blog/middleware.ts')).toBe(true);
	cleanup(tmp);
});

console.log('\nMiddleware loading\n');

test('loads TS middleware module', async () => {
	const tmp = createFixture({
		'app/middleware.ts': [
			"import type { MiddlewareContext } from '@vesk/compiler';",
			'export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {',
			"  ctx.set('x', '1');",
			'  return next();',
			'}',
		].join('\n'),
	});
	const fn = await loadMiddleware(join(tmp, 'app/middleware.ts'));
	expect(fn === null).toBe(false);
	cleanup(tmp);
});

test('re-loads edited middleware without stale cache', async () => {
	const tmp = createFixture({
		'app/middleware.ts': "export async function middleware(ctx, next) {\n  ctx.set('v', 1);\n}",
	});
	const p = join(tmp, 'app/middleware.ts');
	const first = await loadMiddleware(p);
	const ctxA = { locals: {}, set(k, v) { this.locals[k] = v; }, get(k) { return this.locals[k]; } };
	await first(ctxA, async () => null);
	expect(ctxA.locals.v).toBe(1);

	// Edit the file — the loader must not serve the cached old module.
	writeFileSync(p, "export async function middleware(ctx, next) {\n  ctx.set('v', 2);\n}");
	const second = await loadMiddleware(p);
	const ctxB = { locals: {}, set(k, v) { this.locals[k] = v; }, get(k) { return this.locals[k]; } };
	await second(ctxB, async () => null);
	expect(ctxB.locals.v).toBe(2);
	cleanup(tmp);
});

console.log('\nMiddleware chain execution\n');

test('middleware runs and locals propagate through onLast', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': [
			'export async function middleware(ctx, next) {',
			"  ctx.set('user', { id: 1, name: 'Alice' });",
			'  return next();',
			'}',
		].join('\n'),
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/', tmp);
	let sawLocals = null;
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/'), {}, {
		onLast: async (_rewrite, ctx) => {
			sawLocals = ctx ? ctx.get('user') : null;
			return new Response('PAGE');
		},
	});
	expect(result.response.status).toBe(200);
	expect(await result.response.text()).toBe('PAGE');
	expect(result.locals.user.name).toBe('Alice');
	expect(sawLocals.name).toBe('Alice');
	cleanup(tmp);
});

test('await next() without return still yields the rendered response (no 204)', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': 'export async function middleware(ctx, next) {\n  ctx.set(\'v\', 1);\n  await next();\n}',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/', tmp);
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/'), {}, {
		onLast: async () => new Response('RENDERED'),
	});
	expect(result.response.status).toBe(200);
	expect(await result.response.text()).toBe('RENDERED');
	expect(result.locals.v).toBe(1);
	cleanup(tmp);
});

test('no-return middleware falls through to next link in chain', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': 'export function middleware(ctx) { ctx.set(\'a\', 1); }',
		'app/blog/page.vsk': '',
		'app/blog/middleware.ts': 'export async function middleware(ctx, next) {\n  ctx.set(\'b\', ctx.get(\'a\'));\n  return next();\n}',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/blog', tmp);
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/blog'), {}, {
		onLast: async () => new Response('OK'),
	});
	expect(await result.response.text()).toBe('OK');
	expect(result.locals.b).toBe(1);
	cleanup(tmp);
});

test('returned Response short-circuits the chain', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/api/x/route.ts': 'export async function GET() { return Response.json({ ok: true }); }',
		'app/middleware.ts': [
			'export async function middleware(ctx, next) {',
			"  if (ctx.url.pathname.startsWith('/api')) {",
			"    return new Response('Blocked', { status: 401 });",
			'  }',
			'  return next();',
			'}',
		].join('\n'),
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/api/x', tmp);
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/api/x'), {}, {
		onLast: async () => new Response('SHOULD-NOT-RENDER'),
	});
	expect(result.response.status).toBe(401);
	expect(await result.response.text()).toBe('Blocked');
	cleanup(tmp);
});

test('redirect errors become redirect responses', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': [
			'class Redirect extends Error { constructor(url, status) { super(url); this.name = \'Redirect\'; this.url = url; this.status = status; } }',
			'export function middleware() { throw new Redirect(\'/login\', 302); }',
		].join('\n'),
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/', tmp);
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/'), {}, {});
	expect(result.response.status).toBe(302);
	expect(result.response.headers.get('Location')).toBe('/login');
	expect(result.redirected).toBe(true);
	cleanup(tmp);
});

test('next(rewrite) records rewriteUrl and updates ctx.url', async () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/middleware.ts': 'export async function middleware(ctx, next) { return next(\'/rewritten\'); }',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const chain = collectMiddlewareChain(tree, '/', tmp);
	let seenPath = '';
	const result = await executeMiddlewareChain(chain, new Request('http://localhost/original'), {}, {
		onLast: async (rewrite, ctx) => {
			seenPath = ctx ? ctx.url.pathname : '';
			return new Response('OK');
		},
	});
	expect(result.rewriteUrl).toBe('/rewritten');
	expect(seenPath).toBe('/rewritten');
	cleanup(tmp);
});

test('empty chain with no onLast returns null response', async () => {
	const result = await executeMiddlewareChain([], new Request('http://localhost/'), {}, {});
	expect(result.response).toBeNull();
	cleanup('/tmp/nonexistent');
});

await Promise.all(pending);

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All middleware tests passed!');
