/**
 * An SSR page that `fetch()`es its own API route must keep ITS request context
 * for every render pass.
 *
 * The generated SSR function renders in up to three passes, awaiting
 * `useFetch(..., { ssr: 'wait' })` between them. A relative fetch resolves
 * against the request origin and re-enters `startProdServer`'s handler as a
 * nested request, which installs its own `globalThis.__vesk_request` (with
 * `params: {}`). Before the fix that nested context was never restored, so
 * every pass after the first read empty params — a dynamic page fetched
 * `/api/verify/` (404) and rendered its "not found" branch even though pass 0
 * had already stashed the valid payload.
 *
 * This pins the CONTENT of the response, not a helper: the page must render the
 * fetched record for the URL's own param on every pass.
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

const PORT = 3189;

let projectRoot = '';
let server: Server | null = null;
let base = '';

function writeApp(root: string): void {
	const appDir = resolve(root, 'app');
	const write = (rel: string, content: string) => {
		const file = resolve(appDir, ...rel.split('/'));
		mkdirSync(resolve(file, '..'), { recursive: true });
		writeFileSync(file, content);
	};

	// A root layout forces the non-streamed SSR path.
	write('layout.vsk', 'component RootLayout(props: { children?: any }) { return <div id="shell">{props.children}</div>; }');

	// Dynamic API route: `/api/verify/` (empty param) does NOT match, so a page
	// that loses its params gets a 404 and falls into its error branch.
	write(
		'api/verify/[credentialId]/route.ts',
		[
			'export async function GET(_request, ctx) {',
			'  const { credentialId } = await ctx.params;',
			"  return new Response(JSON.stringify({ id: credentialId }), {",
			"    headers: { 'content-type': 'application/json' },",
			'  });',
			'}',
		].join('\n'),
	);

	// Statement mode — the shape the real verification page uses.
	write(
		'verify/[credentialId]/page.vsk',
		[
			"import { useFetch } from '@vesk/runtime';",
			"import { useParams } from '@vesk/runtime/router';",
			'',
			'export default component VerifyPage() {',
			'  const params = useParams();',
			"  const credentialId = params.credentialId || '';",
			'  const record = useFetch<{ id: string }>(`/api/verify/${encodeURIComponent(credentialId)}`, {',
			'    key: `verify-${credentialId}`,',
			"    ssr: 'wait',",
			'  });',
			'  if (record.error) {',
			'    <div id="error">CREDENTIAL NOT FOUND</div>',
			'  } else if (record.data) {',
			'    <div id="holder">HOLDER {record.data.id}</div>',
			'  }',
			'}',
		].join('\n'),
	);

	// Expression mode — same behaviour, different body mode.
	write(
		'expr/[credentialId]/page.vsk',
		[
			"import { useFetch } from '@vesk/runtime';",
			"import { useParams } from '@vesk/runtime/router';",
			'',
			'export default component ExprPage() {',
			'  const params = useParams();',
			"  const credentialId = params.credentialId || '';",
			'  const record = useFetch<{ id: string }>(`/api/verify/${encodeURIComponent(credentialId)}`, {',
			'    key: `expr-${credentialId}`,',
			"    ssr: 'wait',",
			'  });',
			"  const label = record.error ? 'CREDENTIAL NOT FOUND' : record.data ? `HOLDER ${record.data.id}` : 'loading';",
			'  return <div id="out">{label}</div>;',
			'}',
		].join('\n'),
	);
}

async function get(pathname: string): Promise<{ status: number; body: string }> {
	const res = await fetch(`${base}${pathname}`);
	return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
	projectRoot = mkdtempSync(resolve(tmpdir(), 'vesk-self-fetch-'));
	writeApp(projectRoot);
	const appDir = resolve(projectRoot, 'app');
	const outDir = resolve(projectRoot, '.vesk');

	console.error('building fixture app…');
	await build(appDir, { outDir, publicDir: resolve(projectRoot, 'public'), codeSplit: true });
	server = await startProdServer(outDir, { port: PORT });
	await new Promise(r => setTimeout(r, 150));
	base = `http://127.0.0.1:${PORT}`;

	console.log('\n=== statement-mode page keeps its params across render passes ===');
	await it('renders the fetched record for the URL param', async () => {
		const r = await get('/verify/ABC123');
		assert(r.status === 200, `expected 200, got ${r.status}`);
		assert(r.body.includes('HOLDER ABC123'), `expected the valid record, got ${r.body.slice(0, 400)}`);
		assert(!r.body.includes('CREDENTIAL NOT FOUND'), 'must not fall into the not-found branch');
	});
	console.log('\n=== expression-mode page keeps its params across render passes ===');
	await it('renders the fetched record for the URL param', async () => {
		const r = await get('/expr/XYZ789');
		assert(r.status === 200, `expected 200, got ${r.status}`);
		assert(r.body.includes('HOLDER XYZ789'), `expected the valid record, got ${r.body.slice(0, 400)}`);
		assert(!r.body.includes('CREDENTIAL NOT FOUND'), 'must not fall into the not-found branch');
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	if (server) await new Promise<void>(r => { server!.close(() => r()); });
	rmSync(projectRoot, { recursive: true, force: true });
	process.exit(failed === 0 ? 0 : 1);
}

void main();
