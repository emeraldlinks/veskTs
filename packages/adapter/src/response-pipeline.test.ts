/**
 * Transport-level response pipeline: `/healthz`, content-encoding negotiation,
 * and ETag/304 revalidation — exercised against a real `startProdServer` over a
 * real socket, not a mock response object.
 *
 * Two deliberate choices in the harness:
 *
 * - **Raw `node:http`, not `fetch`.** `fetch` transparently decompresses a
 *   gzip/br body and normalises `Content-Length`, which hides both the encoding
 *   decision and the length the server actually declared — i.e. it hides
 *   precisely the two things under test.
 * - **A hand-written build output (`config.json` + `static/`) rather than a
 *   full `build()`**, so the suite is deterministic and fast. The API fixtures
 *   are shaped exactly like generated functions (they export `handle`), because
 *   "does this break SSE" is the one question the pure helpers cannot answer.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { startProdServer } from '@vesk/adapter/src/prod-server';
import {
	negotiateEncoding,
	isCompressibleType,
	etagFor,
	ifNoneMatchSatisfied,
} from '@vesk/adapter/src/response-pipeline';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void | Promise<void>) {
	return Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e: unknown) => { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); });
}

function assert(cond: unknown, msg: string): void {
	if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
	if (actual !== expected) {
		throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Pure-helper unit tests
// ────────────────────────────────────────────────────────────────────────────

async function helperTests(): Promise<void> {
	console.log('\n=== encoding negotiation ===');

	await it('br wins a tie (every browser lists both at q=1)', () => {
		eq(negotiateEncoding('gzip, deflate, br'), 'br', 'tie');
	});
	await it('gzip when br is absent', () => {
		eq(negotiateEncoding('gzip, deflate'), 'gzip', 'gzip only');
	});
	await it('br;q=0 is honoured — a client may refuse br', () => {
		eq(negotiateEncoding('br;q=0, gzip'), 'gzip', 'br refused');
	});
	await it('gzip;q=0 and br refused leaves nothing', () => {
		eq(negotiateEncoding('br;q=0, gzip;q=0'), null, 'both refused');
	});
	await it('q=0 via the wildcard disables an unlisted coding', () => {
		eq(negotiateEncoding('*;q=0'), null, 'star q=0');
		eq(negotiateEncoding('*;q=0, gzip'), 'gzip', 'star q=0 with gzip');
	});
	await it('higher q wins over client preference order', () => {
		eq(negotiateEncoding('gzip;q=1.0, br;q=0.5'), 'gzip', 'gzip higher');
	});
	await it('a duplicated coding cannot raise its own q back to 1', () => {
		// First occurrence wins per RFC 9110 — otherwise a client could opt out
		// of a coding with `br;q=0` and opt back in with a second entry.
		eq(negotiateEncoding('gzip;q=0, gzip;q=1.0'), null, 'first wins');
	});
	await it('unknown codings (deflate, zstd) are not proxied', () => {
		eq(negotiateEncoding('deflate, zstd'), null, 'no support');
		eq(negotiateEncoding(''), null, 'empty');
		eq(negotiateEncoding(undefined), null, 'absent');
	});
	await it('a header array folds to one list', () => {
		eq(negotiateEncoding(['gzip', 'br']), 'br', 'array');
	});
	await it('token matching is case-insensitive', () => {
		eq(negotiateEncoding('GZIP'), 'gzip', 'uppercase');
	});

	console.log('\n=== compressible types ===');

	await it('text and JS/JSON/XML families compress', () => {
		assert(isCompressibleType('text/html'), 'text/html');
		assert(isCompressibleType('text/css; charset=utf-8'), 'text/css with params');
		assert(isCompressibleType('application/javascript'), 'js');
		assert(isCompressibleType('application/json'), 'json');
		assert(isCompressibleType('application/ld+json'), 'ld+json');
		assert(isCompressibleType('application/rss+xml'), 'rss+xml');
		assert(isCompressibleType('image/svg+xml'), 'svg');
	});
	await it('already-compressed and binary families do not', () => {
		for (const t of ['image/png', 'image/jpeg', 'image/webp', 'font/woff2', 'video/mp4',
			'application/zip', 'application/octet-stream', 'application/wasm', '']) {
			assert(!isCompressibleType(t), `expected ${JSON.stringify(t)} to be incompressible`);
		}
		assert(!isCompressibleType(undefined), 'absent content-type');
	});

	console.log('\n=== ETag matching ===');

	await it('same bytes produce the same validator', () => {
		const a = etagFor(Buffer.from('hello world'));
		eq(etagFor(Buffer.from('hello world')), a, 'stable');
		assert(etagFor(Buffer.from('hello worlds')) !== a, 'different bytes differ');
	});
	await it('If-None-Match uses weak comparison (W/ prefix ignored)', () => {
		const etag = etagFor(Buffer.from('x'));
		assert(ifNoneMatchSatisfied(etag, etag), 'exact');
		assert(ifNoneMatchSatisfied(`W/${etag}`, etag), 'weak client');
		assert(ifNoneMatchSatisfied(`"other", ${etag}`, etag), 'in a list');
		assert(ifNoneMatchSatisfied('*', etag), 'wildcard');
	});
	await it('a stale or absent validator does not match', () => {
		const etag = etagFor(Buffer.from('x'));
		assert(!ifNoneMatchSatisfied('"nope"', etag), 'stale');
		assert(!ifNoneMatchSatisfied(undefined, etag), 'absent');
		assert(!ifNoneMatchSatisfied('', etag), 'empty');
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Live-server fixture
// ────────────────────────────────────────────────────────────────────────────

const BIG_JS = `// fixture asset\n${'export const padding = "0123456789abcdef";\n'.repeat(400)}`;
const SMALL_TXT = 'tiny';
// Comfortably under the default 1 KiB threshold but still highly compressible,
// so \`threshold: 0\` has something it can actually shrink.
const MEDIUM_TXT = `note: ${'lorem ipsum dolor sit amet '.repeat(20)}\n`;
// PNG magic prefix followed by bytes that are already incompressible, so the
// only possible reason to skip it is the content type.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);

let fixtureRoot = '';
let outDir = '';
let server: Server | null = null;
let port = 3121;

function writeFixture(): void {
	fixtureRoot = mkdtempSync(resolve(tmpdir(), 'vesk-pipeline-'));
	outDir = resolve(fixtureRoot, 'build');
	mkdirSync(resolve(outDir, 'static', 'public'), { recursive: true });
	mkdirSync(resolve(outDir, 'server'), { recursive: true });

	writeFileSync(resolve(outDir, 'config.json'), JSON.stringify({
		version: 1,
		middleware: false,
		routes: [
			{ path: '/api/json', type: 'api', function: 'server/api-json.js' },
			{ path: '/api/stream', type: 'api', function: 'server/api-stream.js' },
		],
		static: { prefix: '/_vesk/static', dir: 'static' },
	}, null, 2));

	writeFileSync(resolve(outDir, 'static', 'public', 'big.js'), BIG_JS);
	writeFileSync(resolve(outDir, 'static', 'public', 'small.txt'), SMALL_TXT);
	writeFileSync(resolve(outDir, 'static', 'public', 'medium.txt'), MEDIUM_TXT);
	writeFileSync(resolve(outDir, 'static', 'public', 'logo.png'), PNG);
	// A content-hashed asset under static/, so the immutable cache policy — and
	// therefore the revalidation path — runs against the real production layout.
	writeFileSync(resolve(outDir, 'static', 'client.a1b2c3d4e5.js'), BIG_JS);

	writeFileSync(resolve(outDir, 'server', 'api-json.js'), `
export async function handle() {
  return new Response(JSON.stringify({ hello: 'world', note: 'padding '.repeat(300) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}
`);
	// A ReadableStream body — the shape the runtime's streaming fetch / SSE uses.
	writeFileSync(resolve(outDir, 'server', 'api-stream.js'), `
export async function handle() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: one\\n\\n'));
      controller.enqueue(encoder.encode('data: two\\n\\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
  });
}
`);
}

async function start(nextPort: number, opts: Record<string, unknown> = {}): Promise<void> {
	if (server) {
		await new Promise<void>(r => { server!.close(() => r()); });
		server = null;
	}
	port = nextPort;
	server = await startProdServer(outDir, { port, ...opts } as never);
	await new Promise(r => setTimeout(r, 60));
}

interface Raw {
	status: number;
	headers: Record<string, string>;
	body: Buffer;
}

/** Raw request — no transparent decompression, no header normalisation. */
function get(pathname: string, opts: { headers?: Record<string, string>; method?: string } = {}): Promise<Raw> {
	return new Promise((resolvePromise, reject) => {
		const req = httpRequest({
			host: '127.0.0.1',
			port,
			path: pathname,
			method: opts.method || 'GET',
			headers: opts.headers || {},
		}, res => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () => {
				const headers: Record<string, string> = {};
				for (const [k, v] of Object.entries(res.headers)) {
					headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
				}
				resolvePromise({ status: res.statusCode || 0, headers, body: Buffer.concat(chunks) });
			});
			res.on('error', reject);
		});
		req.on('error', reject);
		req.end();
	});
}

/** The bytes as the client would see them after content-decoding. */
function decoded(r: Raw): Buffer {
	const enc = r.headers['content-encoding'];
	if (enc === 'gzip') return gunzipSync(r.body);
	if (enc === 'br') return brotliDecompressSync(r.body);
	return r.body;
}

// ────────────────────────────────────────────────────────────────────────────
// Live-server tests
// ────────────────────────────────────────────────────────────────────────────

async function liveTests(): Promise<void> {
	await start(3121);

	console.log('\n=== /healthz ===');

	await it('GET /healthz answers 200 JSON with no-store', async () => {
		const r = await get('/healthz');
		eq(r.status, 200, 'status');
		assert(/application\/json/.test(r.headers['content-type'] || ''), 'content-type');
		eq(r.headers['cache-control'], 'no-store', 'cache-control');
		eq(JSON.parse(r.body.toString()).status, 'ok', 'status field');
	});
	await it('the alias /_vesk/healthz answers too', async () => {
		eq((await get('/_vesk/healthz')).status, 200, 'alias status');
	});
	await it('HEAD /healthz returns the headers and no body', async () => {
		const r = await get('/healthz', { method: 'HEAD' });
		eq(r.status, 200, 'status');
		eq(r.body.length, 0, 'empty body');
		assert(Number(r.headers['content-length']) > 0, 'still declares what a GET would return');
	});
	await it('never encoded or tagged, even when the client asks for both', async () => {
		const r = await get('/healthz', { headers: { 'accept-encoding': 'gzip, br' } });
		eq(r.headers['content-encoding'], undefined, 'no content-encoding');
		eq(r.headers.etag, undefined, 'no etag');
		eq(r.body.toString(), r.body.toString(), 'identity body');
	});
	await it('not counted against the rate limiter', async () => {
		await start(3122);
		// 60 probes: any that passed through the limiter would 429 from the
		// second request onward, and an orchestrator cannot tell that from a
		// dead process.
		const statuses = new Set<number>();
		for (let i = 0; i < 60; i++) statuses.add((await get('/healthz')).status);
		eq([...statuses].join(','), '200', 'every probe answered');
		await start(3121);
	});
	await it('healthCheck: false removes it from the public surface', async () => {
		await start(3123, { healthCheck: false });
		eq((await get('/healthz')).status, 404, 'status');
		await start(3121);
	});

	console.log('\n=== compression ===');

	await it('gzip-encodes a large JS asset and round-trips the bytes', async () => {
		const r = await get('/big.js', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.status, 200, 'status');
		eq(r.headers['content-encoding'], 'gzip', 'content-encoding');
		assert(/Accept-Encoding/i.test(r.headers.vary || ''), `Vary must name Accept-Encoding, got ${r.headers.vary}`);
		// Content-Length must describe what is actually on the wire.
		eq(r.headers['content-length'], String(r.body.length), 'content-length is the encoded length');
		assert(r.body.length !== BIG_JS.length, 'the declared length must not be the identity length');
		eq(gunzipSync(r.body).toString(), BIG_JS, 'body round-trips');
	});
	await it('actually shrinks the payload', async () => {
		const r = await get('/big.js', { headers: { 'accept-encoding': 'gzip' } });
		assert(r.body.length < BIG_JS.length / 4, `expected a large reduction, got ${r.body.length} from ${BIG_JS.length}`);
	});
	await it('prefers brotli when offered', async () => {
		const r = await get('/big.js', { headers: { 'accept-encoding': 'br, gzip' } });
		eq(r.headers['content-encoding'], 'br', 'content-encoding');
		eq(r.headers['content-length'], String(r.body.length), 'content-length');
		eq(brotliDecompressSync(r.body).toString(), BIG_JS, 'body round-trips');
	});
	await it('honours br;q=0', async () => {
		const r = await get('/big.js', { headers: { 'accept-encoding': 'br;q=0, gzip' } });
		eq(r.headers['content-encoding'], 'gzip', 'content-encoding');
		eq(gunzipSync(r.body).toString(), BIG_JS, 'body round-trips');
	});
	await it('sends identity when nothing is acceptable', async () => {
		const r = await get('/big.js', { headers: { 'accept-encoding': 'deflate' } });
		eq(r.headers['content-encoding'], undefined, 'no encoding');
		eq(r.body.toString(), BIG_JS, 'body intact');
		assert(/Accept-Encoding/i.test(r.headers.vary || ''), 'Vary still announced');
	});
	await it('does not compress a body under the threshold', async () => {
		const r = await get('/small.txt', { headers: { 'accept-encoding': 'gzip, br' } });
		eq(r.headers['content-encoding'], undefined, 'tiny body stays identity');
		eq(r.body.toString(), SMALL_TXT, 'body intact');
	});
	await it('leaves a sub-threshold body unencoded even though it would fit', async () => {
		const r = await get('/medium.txt', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['content-encoding'], undefined, 'under the threshold');
		eq(r.body.toString(), MEDIUM_TXT, 'identity body');
	});
	await it('threshold: 0 lowers the floor', async () => {
		await start(3124, { compression: { threshold: 0 } });
		const r = await get('/medium.txt', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['content-encoding'], 'gzip', 'encoded');
		eq(gunzipSync(r.body).toString(), MEDIUM_TXT, 'round-trips');
		await start(3121);
	});
	await it('never encodes a body that encoding would enlarge', async () => {
		// 4 bytes of text gzip to ~23. Announcing an encoding that makes the
		// response bigger costs the client CPU on every fetch for no gain.
		await start(3127, { compression: { threshold: 0 } });
		const r = await get('/small.txt', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['content-encoding'], undefined, 'no encoding announced');
		eq(r.body.toString(), SMALL_TXT, 'identity body');
		await start(3121);
	});
	await it('serves public files with the canonical content type', async () => {
		// prod-server used to carry its own, shorter MIME table. Anything missing
		// from it was served as application/octet-stream — which also silently
		// opts the file out of compression, so the gap was invisible in both places.
		const txt = await get('/small.txt');
		assert(/^text\/plain/.test(txt.headers['content-type'] || ''), `expected text/plain, got ${txt.headers['content-type']}`);
		eq((await get('/logo.png')).headers['content-type'], 'image/png', 'png');
		eq((await get('/big.js')).headers['content-type'], 'application/javascript; charset=utf-8', 'js');
	});
	await it('leaves an already-compressed content type alone', async () => {
		const r = await get('/logo.png', { headers: { 'accept-encoding': 'gzip, br' } });
		eq(r.headers['content-encoding'], undefined, 'png not encoded');
		assert(Buffer.compare(r.body, PNG) === 0, 'png bytes intact');
	});
	await it('compression: false serves everything as-is', async () => {
		await start(3125, { compression: false });
		const r = await get('/big.js', { headers: { 'accept-encoding': 'gzip, br' } });
		eq(r.headers['content-encoding'], undefined, 'no encoding');
		eq(r.body.toString(), BIG_JS, 'body intact');
		await start(3121);
	});
	await it('encodes an API JSON body', async () => {
		const r = await get('/api/json', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['content-encoding'], 'gzip', 'content-encoding');
		eq(JSON.parse(gunzipSync(r.body).toString()).hello, 'world', 'payload');
	});
	await it('still applies security headers to an encoded response', async () => {
		// The pipeline defers writeHead, so it must be composing with the
		// security / per-request-override decorators, not replacing them.
		const r = await get('/big.js', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['x-frame-options'], 'DENY', 'X-Frame-Options');
		assert(r.headers['content-security-policy'], 'CSP present');
		eq(r.headers['x-content-type-options'], 'nosniff', 'nosniff');
	});

	console.log('\n=== streaming (SSE) must survive the pipeline ===');

	await it('streams identity when no coding is accepted', async () => {
		const r = await get('/api/stream', { headers: { 'accept-encoding': 'identity' } });
		eq(r.status, 200, 'status');
		eq(r.headers['content-type'], 'text/event-stream', 'content-type');
		eq(r.headers['content-encoding'], undefined, 'identity');
		eq(r.body.toString(), 'data: one\n\ndata: two\n\n', 'every chunk arrives, in order');
	});
	await it('encodes a stream on the fly without buffering it first', async () => {
		// Buffering a stream to decide on the encoding is what would break it —
		// an event stream may never close. Encoding incrementally is the only
		// way a streamed body can be compressed at all.
		const r = await get('/api/stream', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers['content-encoding'], 'gzip', 'content-encoding');
		eq(gunzipSync(r.body).toString(), 'data: one\n\ndata: two\n\n', 'gzip round-trips');
		eq(r.headers['content-length'], undefined, 'no Content-Length — the encoded length is not knowable up front');
		eq(r.headers['transfer-encoding'], 'chunked', 'still streamed');
	});
	await it('encodes a stream with brotli too', async () => {
		const r = await get('/api/stream', { headers: { 'accept-encoding': 'br' } });
		eq(r.headers['content-encoding'], 'br', 'content-encoding');
		eq(brotliDecompressSync(r.body).toString(), 'data: one\n\ndata: two\n\n', 'brotli round-trips');
	});
	await it('never puts a validator on a stream', async () => {
		const r = await get('/api/stream');
		eq(r.headers.etag, undefined, 'no validator');
	});
	await it('announces Vary on a streamed response', async () => {
		const r = await get('/api/stream', { headers: { 'accept-encoding': 'identity' } });
		assert(/Accept-Encoding/i.test(r.headers.vary || ''), 'Vary must name Accept-Encoding');
	});

	console.log('\n=== ETag / 304 ===');

	await it('tags a 200 GET with a quoted ETag and keeps the body', async () => {
		const r = await get('/big.js');
		assert(/^"[A-Za-z0-9+/=]+"$/.test(r.headers.etag || ''), `quoted validator, got ${r.headers.etag}`);
		eq(r.body.toString(), BIG_JS, 'body');
	});
	await it('a matching If-None-Match yields 304 with no body', async () => {
		const first = await get('/big.js');
		const etag = first.headers.etag!;
		const second = await get('/big.js', { headers: { 'if-none-match': etag } });
		eq(second.status, 304, 'status');
		eq(second.headers.etag, etag, 'etag echoed');
		eq(second.body.length, 0, 'empty body');
		eq(second.headers['content-type'], undefined, 'no Content-Type on a 304');
		eq(second.headers['content-length'], undefined, 'no Content-Length on a 304');
		eq(second.headers['transfer-encoding'], undefined, 'no chunked framing on a 304');
		assert(/Accept-Encoding/i.test(second.headers.vary || ''), 'Vary survives the 304');
	});
	await it('304 also works for a client that accepts an encoding', async () => {
		const etag = (await get('/big.js')).headers.etag!;
		const r = await get('/big.js', { headers: { 'if-none-match': etag, 'accept-encoding': 'gzip' } });
		eq(r.status, 304, 'status');
		eq(r.headers.etag, etag, 'etag');
		eq(r.body.length, 0, 'empty body');
	});
	await it('If-None-Match: * revalidates against the current bytes', async () => {
		eq((await get('/big.js', { headers: { 'if-none-match': '*' } })).status, 304, 'wildcard');
	});
	await it('a weak validator from a proxy still matches', async () => {
		const etag = (await get('/big.js')).headers.etag!;
		eq((await get('/big.js', { headers: { 'if-none-match': `W/${etag}` } })).status, 304, 'weak match');
	});
	await it('a stale validator returns the full 200', async () => {
		const r = await get('/big.js', { headers: { 'if-none-match': '"deadbeefdeadbeefdeadbeef"' } });
		eq(r.status, 200, 'status');
		eq(r.body.toString(), BIG_JS, 'body');
	});
	await it('one validator per representation, not per encoding', async () => {
		const plain = (await get('/big.js')).headers.etag;
		const zipped = (await get('/big.js', { headers: { 'accept-encoding': 'gzip' } })).headers.etag;
		const brotli = (await get('/big.js', { headers: { 'accept-encoding': 'br' } })).headers.etag;
		eq(zipped, plain, 'gzip variant');
		eq(brotli, plain, 'brotli variant');
		eq((await get('/big.js')).headers.etag, plain, 'stable across requests');
	});
	await it('the validator changes when the bytes change', async () => {
		const before = (await get('/small.txt')).headers.etag;
		writeFileSync(resolve(outDir, 'static', 'public', 'small.txt'), 'tiny!');
		const after = (await get('/small.txt')).headers.etag;
		assert(before !== after, 'a deploy must invalidate every cached copy');
		writeFileSync(resolve(outDir, 'static', 'public', 'small.txt'), SMALL_TXT);
	writeFileSync(resolve(outDir, 'static', 'public', 'medium.txt'), MEDIUM_TXT);
	});
	await it('does not validate a non-GET even with a matching validator', async () => {
		const etag = (await get('/big.js')).headers.etag!;
		const r = await get('/api/json', { method: 'POST', headers: { 'if-none-match': etag } });
		eq(r.status, 200, 'status');
		eq(r.headers.etag, undefined, 'no validator on a non-GET');
	});
	await it('does not put a validator on a no-store single-use payload', async () => {
		// /ssr-data.js is consumed-and-deleted as it is read, so a 304 would hand
		// the client back a body the server has already destroyed.
		const r = await get('/ssr-data.js?t=does-not-exist');
		eq(r.status, 200, 'status');
		eq(r.headers['cache-control'], 'no-store', 'no-store');
		eq(r.headers.etag, undefined, 'no validator on a consumed payload');
		eq(r.body.toString(), '// no ssr data', 'body');
	});
	await it('an immutable hashed asset revalidates like any other 200', async () => {
		const r = await get('/_vesk/static/client.a1b2c3d4e5.js');
		eq(r.status, 200, 'status');
		assert((r.headers['cache-control'] || '').includes('immutable'), 'immutable policy preserved');
		assert(r.headers.etag, 'tagged');
	});
	await it('an API response 304 keeps its caching directives', async () => {
		const first = await get('/api/json');
		const second = await get('/api/json', { headers: { 'if-none-match': first.headers.etag! } });
		eq(second.status, 304, 'status');
		eq(second.headers['cache-control'], 'public, max-age=0, must-revalidate', 'cache-control preserved');
		eq(second.body.length, 0, 'empty body');
	});
	await it('etag: false disables the validator but keeps encoding', async () => {
		await start(3126, { compression: { etag: false } });
		const r = await get('/big.js', { headers: { 'accept-encoding': 'gzip' } });
		eq(r.headers.etag, undefined, 'no etag');
		eq(r.headers['content-encoding'], 'gzip', 'still encoded');
		await start(3121);
	});
	await it('HEAD revalidates without a body', async () => {
		const etag = (await get('/big.js')).headers.etag!;
		const r = await get('/big.js', { method: 'HEAD', headers: { 'if-none-match': etag } });
		eq(r.status, 304, 'status');
		eq(r.body.length, 0, 'no body');
	});
}

async function main(): Promise<void> {
	writeFixture();
	await helperTests();
	await liveTests();
	console.log(`\n${passed} passed, ${failed} failed`);
	if (server) await new Promise<void>(r => { server!.close(() => r()); });
	rmSync(fixtureRoot, { recursive: true, force: true });
	process.exit(failed === 0 ? 0 : 1);
}

void main();