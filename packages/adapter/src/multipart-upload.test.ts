/**
 * Multipart uploads, end to end: a real HTTP request into a real built Vesk app.
 *
 * `parser.test.ts` proves the parser against hand-built byte arrays. What it
 * cannot prove is the half that actually broke in production: that
 * `request.formData()`'s buffering behaviour and `Object.fromEntries`'
 * File-collapsing are the reason this plugin exists, and that the limits are
 * enforced *while the body is arriving* rather than after it. Both need a
 * socket.
 *
 * The fixture is a real `build()` served through `startProdServer`, with the
 * plugin resolved from the app's own `node_modules` by name — the same path a
 * published install takes, so a broken `exports` map would fail here rather than
 * in someone else's app.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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

const PORT = 3191;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pluginDir = resolve(repoRoot, 'packages', 'plugin-multipart');

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

	write('layout.vsk', 'component RootLayout(props: { children?: any }) { return <div id="shell">{props.children}</div>; }');
	write('page.vsk', 'component HomePage() { return <h1>HOME</h1>; }');

	// Echoes what the handler actually received. `instanceof File`, the byte
	// length and the decoded text are the three things that were impossible
	// through request.formData() + Object.fromEntries.
	write('api/upload/route.ts', [
		"import { parseUploadOrError } from '@vesk/plugin-multipart';",
		'',
		'export async function POST(request) {',
		'  const parsed = await parseUploadOrError(request, {',
		'    maxFileSize: 64 * 1024,',
		'    allowedMimeTypes: ["image/png", "text/*"],',
		'  });',
		'  if (parsed instanceof Response) return parsed;',
		'  const file = parsed.files[0];',
		'  const value = file?.value;',
		'  const isFile = typeof File !== "undefined" && value instanceof File;',
		'  const text = isFile ? await value.text() : String(value ?? "");',
		'  return Response.json({',
		'    fileName: file?.filename ?? null,',
		'    contentType: file?.contentType ?? null,',
		'    size: file?.size ?? 0,',
		'    isFile,',
		'    isBlob: typeof Blob !== "undefined" && value instanceof Blob,',
		'    roundTrip: text,',
		'    fieldCount: parsed.fields.length,',
		'    totalSize: parsed.totalSize,',
		'  });',
		'}',
		'',
	].join('\n'));

	// Same handler, no limits: proves the response shape is independent of them.
	write('api/open/route.ts', [
		"import { parseMultipartRequest } from '@vesk/plugin-multipart';",
		'',
		'export async function POST(request) {',
		'  const parsed = await parseMultipartRequest(request);',
		'  const kinds = parsed.files.map((f) => (typeof f.value === "string" ? "string" : "File"));',
		'  return Response.json({ fileCount: parsed.files.length, kinds, total: parsed.totalSize });',
		'}',
		'',
	].join('\n'));

	// The core path, with a generous server cap, so the two are comparable: this
	// route reads the body with `request.formData()` and nothing else.
	write('api/plain/route.ts', [
		'export async function POST(request) {',
		'  const fd = await request.formData();',
		'  const raw = fd.get("file");',
		'  return Response.json({',
		'    rawIsFile: typeof File !== "undefined" && raw instanceof File,',
		'    size: raw instanceof File ? raw.size : -1,',
		'    viaRecord: typeof Object.fromEntries(fd.entries()).file,',
		'  });',
		'}',
		'',
	].join('\n'));

	// Reads `request.body` and THEN `request.text()`. One socket, two readers —
	// the second must serve from what the first already pulled, not hang waiting
	// for bytes that were never coming again.
	write('api/twice/route.ts', [
		'export async function POST(request) {',
		'  const stream = request.body;',
		'  if (!stream) return Response.json({ error: "no stream" }, { status: 500 });',
		'  const reader = stream.getReader();',
		'  let streamed = 0;',
		'  for (;;) {',
		'    const { done, value } = await reader.read();',
		'    if (done) break;',
		'    streamed += value.byteLength;',
		'  }',
		'  const text = await request.text();',
		'  return Response.json({ streamed, textLength: text.length, same: streamed === Buffer.byteLength(text) });',
		'}',
		'',
	].join('\n'));

	// A body larger than the cap must be refused by the STREAM path, not only by
	// the buffered readers, and it must be refused before the whole body is read.
	write('api/capped/route.ts', [
		'export async function POST(request) {',
		'  let seen = 0;',
		'  try {',
		'    for await (const chunk of request.body) seen += chunk.byteLength;',
		'  } catch (e) {',
		'    return Response.json({ status: e?.status ?? null, seen }, { status: e?.status ?? 500 });',
		'  }',
		'  return Response.json({ status: null, seen });',
		'}',
		'',
	].join('\n'));

	// A GET must still report no body — a lazily attached stream must not turn
	// every bodiless request into a readable stream.
	write('api/nobody/route.ts', [
		'export async function GET(request) {',
		'  return Response.json({ hasBody: request.body !== null, text: await request.text() });',
		'}',
		'',
	].join('\n'));
}

/** A multipart body built by hand, so the bytes on the wire are known. */
function multipartBody(boundary: string, parts: Array<{ name: string; value?: string; filename?: string; type?: string; bytes?: number }>): Uint8Array {
	const enc = new TextEncoder();
	const chunks: Uint8Array[] = [];
	for (const part of parts) {
		let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
		if (part.filename !== undefined) header += `; filename="${part.filename}"`;
		header += '\r\n';
		if (part.type) header += `Content-Type: ${part.type}\r\n`;
		header += '\r\n';
		chunks.push(enc.encode(header));
		if (part.bytes !== undefined) {
			// A real body of `bytes` length, built by repetition rather than
			// allocated one byte at a time.
			const unit = enc.encode('V'.repeat(1024));
			let written = 0;
			while (written < part.bytes) {
				const take = Math.min(unit.length, part.bytes - written);
				chunks.push(unit.subarray(0, take));
				written += take;
			}
		} else {
			chunks.push(enc.encode(part.value ?? ''));
		}
		chunks.push(enc.encode('\r\n'));
	}
	chunks.push(enc.encode(`--${boundary}--\r\n`));
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) { out.set(c, at); at += c.length; }
	return out;
}

async function post(pathname: string, boundary: string, parts: Array<{ name: string; value?: string; filename?: string; type?: string; bytes?: number }>): Promise<{ status: number; json: Record<string, unknown> }> {
	const body = multipartBody(boundary, parts);
	const res = await fetch(`${base}${pathname}`, {
		method: 'POST',
		headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
		body,
	});
	const text = await res.text();
	let json: Record<string, unknown> = {};
	try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { raw: text.slice(0, 200) }; }
	return { status: res.status, json };
}

async function main(): Promise<void> {
	projectRoot = mkdtempSync(resolve(tmpdir(), 'vesk-multipart-'));
	writeApp(projectRoot);

	// Resolve the plugin by name from the app's own node_modules, exactly as an
	// installed dependency would be. Also proves the package `exports` map is
	// reachable from outside the repo.
	mkdirSync(resolve(projectRoot, 'node_modules', '@vesk'), { recursive: true });
	symlinkSync(pluginDir, resolve(projectRoot, 'node_modules', '@vesk', 'plugin-multipart'), 'dir');

	const appDir = resolve(projectRoot, 'app');
	const outDir = resolve(projectRoot, '.vesk');
	console.error('building fixture app…');
	await build(appDir, { outDir, publicDir: resolve(projectRoot, 'public'), codeSplit: true });
	server = await startProdServer(outDir, { port: PORT, maxBodyBytes: 4 * 1024 * 1024 });
	await new Promise(r => setTimeout(r, 150));
	base = `http://127.0.0.1:${PORT}`;

	console.log('\n=== what the plugin is actually for ===');

	await it('request.formData() does hand back a real File', async () => {
		// Recorded because the plugin's own module docstring claimed the
		// opposite. `Object.fromEntries(fd.entries())` preserves the File on this
		// runtime; what collapses an upload is `{...fd}` (a FormData has no own
		// enumerable properties, so the spread yields nothing). The reason this
		// plugin exists is the LIMITS, not the value type — the next two tests
		// are the real justification, and they are verified rather than assumed.
		const { status, json } = await post('/api/plain', 'b1', [
			{ name: 'file', filename: 'note.txt', type: 'text/plain', value: 'hello world' },
		]);
		eq(status, 200, 'status');
		eq(json.rawIsFile, true, 'formData() yields a real File');
		eq(json.viaRecord, 'object', 'and Object.fromEntries preserves it');
		eq(json.size, 11, 'with the right byte length');
	});
	await it('core formData() has no per-file limit: a 900 KB upload succeeds', async () => {
		// The server runs with a 4 MiB body cap here, so the core path accepts
		// this. The plugin route caps files at 64 KiB and must refuse the same
		// bytes — that difference IS the feature.
		const { status, json } = await post('/api/plain', 'b1b', [
			{ name: 'file', filename: 'big.txt', type: 'text/plain', bytes: 900 * 1024 },
		]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		eq(json.size, 900 * 1024, 'the whole file arrived');
	});
	await it('the same bytes are refused by a configured per-file limit', async () => {
		const { status, json } = await post('/api/upload', 'b1c', [
			{ name: 'file', filename: 'big.txt', type: 'text/plain', bytes: 900 * 1024 },
		]);
		eq(status, 413, `status, body=${JSON.stringify(json)}`);
	});

	console.log('\n=== real File values survive ===');

	await it('parseUpload returns a genuine File with the right metadata', async () => {
		const { status, json } = await post('/api/upload', 'b2', [
			{ name: 'title', value: 'my upload' },
			{ name: 'file', filename: 'note.txt', type: 'text/plain', value: 'hello world' },
		]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		eq(json.isFile, true, 'the value is a File');
		eq(json.isBlob, true, 'and a Blob');
		eq(json.fileName, 'note.txt', 'filename');
		eq(json.contentType, 'text/plain', 'content type');
		eq(json.size, 11, 'byte length');
		eq(json.roundTrip, 'hello world', 'the bytes round-trip');
		eq(json.fieldCount, 1, 'the non-file field is separated out');
	});
	await it('multiple files are all reported, each as a File', async () => {
		const { status, json } = await post('/api/open', 'b3', [
			{ name: 'a', filename: 'a.txt', type: 'text/plain', value: 'aaa' },
			{ name: 'b', filename: 'b.txt', type: 'text/plain', value: 'bbb' },
		]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		eq(json.fileCount, 2, 'two files');
		assert(Array.isArray(json.kinds), 'kinds reported');
		eq((json.kinds as unknown[]).join(','), 'File,File', 'both values are Files');
	});
	await it('an empty body is not mistaken for a file', async () => {
		const { status, json } = await post('/api/upload', 'b4', [
			{ name: 'title', value: 'no attachment' },
		]);
		eq(status, 200, 'status');
		eq(json.isFile, false, 'no file part');
		eq(json.fileName, null, 'no filename');
		eq(json.fieldCount, 1, 'the field is still there');
	});

	console.log('\n=== the request shim: one socket, two readers ===');

	await it('request.body is a real stream', async () => {
		const { status, json } = await post('/api/twice', 'b8', [
			{ name: 'x', value: 'hello body stream' },
		]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		assert(json.streamed > 0, 'the stream produced bytes');
		eq(json.same, true, 'text() after the stream reports the same length');
		eq(json.textLength, json.streamed, 'both readers saw the whole body');
	});
	await it('the body cap is enforced on the STREAM path too', async () => {
		// The server cap is 4 MiB and this body is 6 MiB. That it stops early
		// rather than at the end is asserted in web-request.test.ts, where the
		// number of bytes actually pulled off the socket is observable; over a
		// real socket only the status is.
		const big = await post('/api/capped', 'b9', [{ name: 'x', bytes: 6 * 1024 * 1024 }]);
		eq(big.status, 413, `expected 413, got ${big.status} body=${JSON.stringify(big.json)}`);
	});
	await it('a body under the cap streams through untouched', async () => {
		const { status, json } = await post('/api/capped', 'b9b', [{ name: 'x', value: 'small' }]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		eq(json.status, null, 'no error');
		assert(Number(json.seen) > 0, 'bytes arrived');
	});
	await it('a GET still reports no body', async () => {
		const res = await fetch(`${base}/api/nobody`);
		eq(res.status, 200, 'status');
		const json = await res.json() as Record<string, unknown>;
		eq(json.hasBody, false, 'request.body is null for a GET');
		eq(json.text, '', 'text() is empty, not a hang');
	});

	console.log('\n=== limits are enforced over the wire ===');

	await it('an oversized file is 413, not a truncated success', async () => {
		// The route caps at 64 KiB. The body is 200 KiB.
		const { status, json } = await post('/api/upload', 'b5', [
			{ name: 'file', filename: 'big.txt', type: 'text/plain', bytes: 200 * 1024 },
		]);
		eq(status, 413, `status, body=${JSON.stringify(json)}`);
		assert(typeof json.error === 'string', 'an error message is returned');
		assert(String(json.error).length > 0, 'the message is not empty');
	});
	await it('a disallowed MIME type is 415', async () => {
		const { status, json } = await post('/api/upload', 'b6', [
			{ name: 'file', filename: 'evil.exe', type: 'application/x-msdownload', value: 'MZ' },
		]);
		eq(status, 415, `status, body=${JSON.stringify(json)}`);
		assert(typeof json.error === 'string', 'an error message is returned');
	});
	await it('a MIME wildcard in the allowlist works', async () => {
		const { status, json } = await post('/api/upload', 'b7', [
			{ name: 'file', filename: 'page.html', type: 'text/html', value: '<p>hi</p>' },
		]);
		eq(status, 200, `status, body=${JSON.stringify(json)}`);
		eq(json.isFile, true, 'text/* accepted the part');
	});
	await it('a body with no boundary is rejected, not mis-parsed', async () => {
		const res = await fetch(`${base}/api/upload`, {
			method: 'POST',
			headers: { 'content-type': 'multipart/form-data' },
			body: 'garbage',
		});
		// Whatever the status, it must not be a 200 claiming a parsed upload.
		assert(res.status !== 200 || !(await res.text()).includes('"isFile":true'), 'no false success');
	});
	await it('a non-multipart POST to the same route is rejected', async () => {
		const res = await fetch(`${base}/api/upload`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		assert(res.status >= 400, `expected a 4xx, got ${res.status}`);
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	if (server) await new Promise<void>(r => { server!.close(() => r()); });
	rmSync(projectRoot, { recursive: true, force: true });
	process.exit(failed === 0 ? 0 : 1);
}

void main();