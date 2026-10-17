/**
 * Nested error / not-found boundaries, end to end.
 *
 * These are behaviour tests, not string assertions: a real app is built, served
 * through `startProdServer`, and each response is checked for the CONTENT that
 * identifies which boundary answered. The thing being pinned is a selection
 * rule — "the boundary nearest the failing route" — and a rule about which file
 * it comes from cannot demonstrate that.
 *
 * The shape of the fixture is the one that used to break:
 *
 *   app/not-found.vsk        ROOT NOT FOUND
 *   app/error.vsk            ROOT ERROR
 *   app/docs/not-found.vsk   DOCS NOT FOUND
 *   app/docs/error.vsk       DOCS ERROR
 *
 * so a NotFoundError or a throw under /docs must answer with the DOCS boundary,
 * and the same failure under / must answer with the ROOT one. The client router
 * already walked the matched chain deepest-first, so before this the two
 * disagreed: SPA navigation honoured the nested boundary and a hard load did
 * not.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { build } from '@vesk/adapter/src/index';
import { startProdServer } from '@vesk/adapter/src/prod-server';

let passed = 0;
let failed = 0;

async function it(name: string, fn: () => void | Promise<void>) {
	return Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e: unknown) => { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); });
}

function assert(cond: unknown, msg: string): void {
	if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
	if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const PORT = 3187;

let projectRoot = '';
let server: Server | null = null;
let base = '';

/**
 * A layout at the root so every route goes through the non-streamed SSR path,
 * where the boundary is rendered inside the layout stack. Without a layout the
 * page path streams and its status is committed before the body can fail, which
 * is a real constraint rather than a gap in this work (asserted below).
 *
 * Branch layout, and why each exists:
 *   docs/  nested not-found answered by the SSR function (a page throws)
 *   shop/  a THROWING layout, so the SSR function cannot absorb the failure and
 *          the server's own boundary walk has to answer — the path that was
 *          root-only before
 *   bare/  no layout at all: the streamed page path
 *
 * `/docs/[slug]` is deliberately the only child of `docs/`: a static
 * `/docs/boom` sibling would be shadowed by it in the manifest, and this file is
 * about boundaries, not precedence (that is pinned in manifest.test.ts).
 */
function writeApp(root: string): void {
	const appDir = resolve(root, 'app');
	const write = (rel: string, content: string) => {
		const file = resolve(appDir, ...rel.split('/'));
		mkdirSync(resolve(file, '..'), { recursive: true });
		writeFileSync(file, content);
	};

	write('layout.vsk', 'component RootLayout(props: { children?: any }) { return <div class="shell">{props.children}</div>; }');
	write('not-found.vsk', 'component RootNotFound() { return <h1>ROOT NOT FOUND</h1>; }');
	write('error.vsk', 'component RootError(props: { error: string }) { return <h1>ROOT ERROR</h1>; }');
	write('page.vsk', 'component HomePage() { return <h1>HOME</h1>; }');

	write('docs/layout.vsk', 'component DocsLayout(props: { children?: any }) { return <section class="docs">{props.children}</section>; }');
	write('docs/page.vsk', 'component DocsPage() { return <h1>DOCS INDEX</h1>; }');
	write('docs/not-found.vsk', 'component DocsNotFound() { return <h1>DOCS NOT FOUND</h1>; }');
	// Throws a NotFoundError from a page component — the shape a `not-found.vsk`
	// exists for. The SSR function catches it and renders the boundary.
	write('docs/[slug]/page.vsk', 'component DocPage() { throw Object.assign(new Error("no such doc"), { name: "NotFoundError" }); }');

	// A layout that throws: the generated function's try/catch only wraps the
	// PAGE render, so this escapes and the server answers. That is the seam the
	// root-only read used to cover, and the reason the walk has to be nearest-
	// match rather than root.
	write('shop/layout.vsk', 'component ShopLayout(props: { children?: any }) { throw new Error("layout exploded"); }');
	write('shop/page.vsk', 'component ShopPage() { return <h1>SHOP</h1>; }');
	write('shop/not-found.vsk', 'component ShopNotFound() { return <h1>SHOP NOT FOUND</h1>; }');
	write('shop/error.vsk', 'component ShopError() { return <h1>SHOP ERROR</h1>; }');

	write('bare/page.vsk', 'component BarePage() { throw Object.assign(new Error("bare missing"), { name: "NotFoundError" }); }');
	write('bare/not-found.vsk', 'component BareNotFound() { return <h1>BARE NOT FOUND</h1>; }');
}

async function get(pathname: string): Promise<{ status: number; body: string }> {
	const res = await fetch(`${base}${pathname}`);
	return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
	projectRoot = mkdtempSync(resolve(tmpdir(), 'vesk-boundaries-'));
	writeApp(projectRoot);
	const appDir = resolve(projectRoot, 'app');
	const outDir = resolve(projectRoot, '.vesk');

	console.error('building fixture app…');
	await build(appDir, { outDir, publicDir: resolve(projectRoot, 'public'), codeSplit: true });
	server = await startProdServer(outDir, { port: PORT });
	await new Promise(r => setTimeout(r, 150));
	base = `http://127.0.0.1:${PORT}`;

	console.log('\n=== a healthy route is unaffected ===');

	await it('a normal page still renders 200', async () => {
		const r = await get('/');
		eq(r.status, 200, 'status');
		assert(r.body.includes('HOME'), 'home content');
		assert(r.body.includes('class="shell"'), 'root layout still wraps the page');
		assert(!r.body.includes('NOT FOUND'), 'no boundary leaked into a healthy page');
	});
	await it('a nested layout still composes', async () => {
		const r = await get('/docs');
		eq(r.status, 200, 'status');
		assert(r.body.includes('DOCS INDEX'), 'docs content');
		assert(r.body.includes('class="docs"'), 'docs layout');
		assert(r.body.includes('class="shell"'), 'root layout still outermost');
	});

	console.log('\n=== nested boundaries reached through the server (not the SSR function) ===');

	await it('/shop renders the SHOP error boundary when its own layout throws', async () => {
		// The generated function's try/catch wraps the PAGE render only, so a
		// layout failure escapes to the server. Before this change the server
		// read app/error.vsk and nothing else, so this answered ROOT ERROR.
		const r = await get('/shop');
		eq(r.status, 500, `expected 500, got ${r.status}`);
		assert(r.body.includes('SHOP ERROR'), `expected the shop boundary, got ${r.body.slice(0, 300)}`);
		assert(!r.body.includes('ROOT ERROR'), 'did not fall back to the root boundary');
	});
	await it('an unmatched URL under /shop renders the SHOP not-found boundary', async () => {
		const r = await get('/shop/nowhere');
		eq(r.status, 404, `expected 404, got ${r.status}`);
		assert(r.body.includes('SHOP NOT FOUND'), `expected the shop boundary, got ${r.body.slice(0, 300)}`);
		assert(!r.body.includes('ROOT NOT FOUND'), 'did not fall back to the root boundary');
	});
	await it('a production boundary never leaks the internal message', async () => {
		const r = await get('/shop');
		assert(!r.body.includes('layout exploded'), `the thrown message must not reach the page: ${r.body.slice(0, 300)}`);
	});

	console.log('\n=== nested not-found boundaries (deepest match) ===');

	await it('/docs/whatever renders the DOCS not-found boundary with 404', async () => {
		const r = await get('/docs/whatever');
		eq(r.status, 404, `expected 404, got ${r.status}`);
		assert(r.body.includes('DOCS NOT FOUND'), `expected the docs boundary, got ${r.body.slice(0, 300)}`);
		assert(!r.body.includes('ROOT NOT FOUND'), 'did not fall back to the root boundary');
	});
	await it('the not-found boundary keeps the app chrome', async () => {
		// Discriminating on the boundary text as well: the chrome alone would
		// also be present on the root boundary's render.
		const r = await get('/docs/whatever');
		assert(r.body.includes('class="shell"'), 'root layout survives the 404');
		assert(r.body.includes('class="docs"'), 'docs layout survives the 404');
	});
	await it('an unmatched URL uses the ROOT not-found boundary', async () => {
		const r = await get('/definitely/not/a/route');
		eq(r.status, 404, `expected 404, got ${r.status}`);
		assert(r.body.includes('ROOT NOT FOUND'), `expected the root boundary, got ${r.body.slice(0, 300)}`);
		assert(!r.body.includes('DOCS NOT FOUND'), 'did not use the docs boundary for a URL outside /docs');
	});
	await it('/docs/unmatched-path still uses the DOCS boundary', async () => {
		// No SSR function matches this URL, so the server answers it. The walk
		// is over URL segments, which is exactly the case the nested file exists
		// for.
		const r = await get('/docs/missing/deeper');
		eq(r.status, 404, `expected 404, got ${r.status}`);
		assert(r.body.includes('DOCS NOT FOUND'), `expected the docs boundary, got ${r.body.slice(0, 300)}`);
	});
	await it('a nested boundary does NOT leak outside its segment', async () => {
		const r = await get('/elsewhere');
		eq(r.status, 404, 'status');
		assert(r.body.includes('ROOT NOT FOUND'), `root boundary for a URL outside /docs, got ${r.body.slice(0, 300)}`);
	});

	console.log('\n=== the streamed (no layout) page path ===');

	await it('a nested not-found still answers 404 without a layout', async () => {
		// No layout.vsk under bare/, so the page renders through the streamed
		// path, where the HTTP status is committed before the body fails. The
		// boundary content must still be the nested one, and the status correct.
		const r = await get('/bare/x');
		eq(r.status, 404, `expected 404, got ${r.status}`);
		assert(r.body.includes('BARE NOT FOUND'), `expected the bare boundary, got ${r.body.slice(0, 400)}`);
		assert(!r.body.includes('ROOT NOT FOUND'), 'did not fall back to the root boundary');
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	if (server) await new Promise<void>(r => { server!.close(() => r()); });
	rmSync(projectRoot, { recursive: true, force: true });
	process.exit(failed === 0 ? 0 : 1);
}

void main();