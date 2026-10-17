/**
 * The request shim: `request.body` as a real stream, on one socket, read once.
 *
 * These are the cases a socket-level test cannot pin. "The cap stops the upload
 * early" is only checkable where the number of bytes pulled off the incoming
 * message is observable, and "reading the stream then calling text()" is only
 * checkable where a hang is a hang and not a 4-minute timeout.
 *
 * The shim used to build its `Request` with `body: null` and expose only
 * whole-body readers, which is why every streaming parser — including
 * `@vesk/plugin-multipart` — saw no body at all. `multipart-upload.test.ts`
 * proves the fix over a real socket; this file pins the details.
 */
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { makeWebRequest, bodyTooLarge } from '@vesk/adapter/src/web-request';

let passed = 0;
let failed = 0;

const WATCHDOG_MS = 10_000;

/**
 * Every test gets a watchdog. A promise that never settles takes its ref'd
 * handles with it, so Node exits 0 with no summary and the harness records
 * nothing — a silently truncated suite is worse than a red one.
 */
async function it(name: string, fn: () => void | Promise<void>) {
	try {
		await withWatchdog(Promise.resolve().then(fn), name);
		passed++; console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
	}
	// Yield so a pending test cannot bleed into the next one's timers.
	await new Promise<void>(r => setImmediate(r));
}

function withWatchdog<T>(p: Promise<T>, name: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const guard = new Promise<T>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`timed out after ${WATCHDOG_MS}ms — the await never settled`)),
			WATCHDOG_MS,
		);
	});
	return Promise.race([p, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function assert(cond: unknown, msg: string): void {
	if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
	if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * A stand-in for `IncomingMessage` that also counts what was pulled off it, so
 * "stopped early" is observable rather than inferred.
 */
function fakeRequest(body: string, method = 'POST'): IncomingMessage & { pulled: number; destroyed: boolean } {
	const bytes = Buffer.from(body, 'utf-8');
	let at = 0;
	const req = new Readable({
		read() {
			if (at >= bytes.length) { this.push(null); return; }
			const end = Math.min(at + 64, bytes.length);
			const chunk = bytes.subarray(at, end);
			at = end;
			(req as unknown as { pulled: number }).pulled = at;
			this.push(chunk);
		},
	}) as unknown as IncomingMessage & { pulled: number; destroyed: boolean };
	(req as unknown as { pulled: number }).pulled = 0;
	req.method = method;
	req.url = '/api/x';
	req.headers = { host: 'localhost', 'content-type': 'text/plain', 'content-length': String(bytes.length) };
	// Destruction is OBSERVED, never faked. An earlier version wrapped
	// `destroy` and set `req.destroyed = true` itself; the real method then saw
	// itself already destroyed, returned without emitting 'close', and the
	// stream's async iterator waited forever. It looks exactly like a hang in
	// the code under test, which is a fixture bug worth a comment.
	req.on('close', () => { (req as unknown as { destroyed: boolean }).destroyed = true; });
	return req;
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<number> {
	if (!stream) return 0;
	const reader = stream.getReader();
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
	}
	return total;
}

async function main(): Promise<void> {
	console.log('\n=== body is a real stream ===');

	await it('a POST body is readable as a stream', async () => {
		const req = fakeRequest('hello streaming world');
		const request = makeWebRequest(req, 'http://localhost/api/x');
		assert(request.body !== null, 'body is not null');
		eq(await drain(request.body), 21, 'all bytes arrived');
	});

	await it('a GET has no body stream at all', async () => {
		const request = makeWebRequest(fakeRequest('', 'GET'), 'http://localhost/api/x');
		eq(request.body, null, 'null, matching a real GET Request');
		eq(await request.text(), '', 'text() is empty');
	});

	await it('the stream is created lazily, not at construction', async () => {
		// Attaching data listeners eagerly would start draining every bodiless
		// request in the process.
		const req = fakeRequest('untouched until asked');
		const request = makeWebRequest(req, 'http://localhost/api/x');
		eq(req.pulled, 0, 'nothing pulled before the body was asked for');
		await request.text();
		assert(req.pulled > 0, 'pulled once asked');
	});

	console.log('\n=== one socket, read once ===');

	await it('text() after the stream was drained serves the same bytes', async () => {
		const req = fakeRequest('abcdefghij');
		const request = makeWebRequest(req, 'http://localhost/api/x');
		const streamed = await drain(request.body);
		// Without the cache this waits for an 'end' that already fired, and hangs.
		eq(await request.text(), 'abcdefghij', 'the whole body');
		eq(streamed, 10, 'the stream saw the same');
	});

	await it('json() after the stream was drained parses the same bytes', async () => {
		const req = fakeRequest('{"a":1}');
		const request = makeWebRequest(req, 'http://localhost/api/x');
		await drain(request.body);
		eq(JSON.stringify(await request.json()), '{"a":1}', 'json from the cache');
	});

	await it('formData() after the stream was drained still parses', async () => {
		const req = fakeRequest('a=1&b=2', 'POST');
		req.headers = { host: 'localhost', 'content-type': 'application/x-www-form-urlencoded' };
		const request = makeWebRequest(req, 'http://localhost/api/x');
		await drain(request.body);
		const fd = await request.formData();
		eq(fd.get('a'), '1', 'field a');
		eq(fd.get('b'), '2', 'field b');
	});

	await it('reading the body twice yields the SAME stream, not a second reader', async () => {
		const request = makeWebRequest(fakeRequest('abc'), 'http://localhost/api/x');
		eq(request.body, request.body, 'stable identity — a second reader would double-consume');
	});

	console.log('\n=== the cap stops the upload early ===');

	await it('the stream errors as soon as the cap is passed, not at the end', async () => {
		// 100 KiB of body, 8 KiB cap. The point is `pulled`: an implementation
		// that buffered everything and checked afterwards would have read all
		// 102400 bytes before failing.
		const req = fakeRequest('x'.repeat(100 * 1024));
		const request = makeWebRequest(req, 'http://localhost/api/x', 8 * 1024);
		let status: number | null = null;
		let seen = 0;
		try {
			for await (const chunk of request.body as ReadableStream<Uint8Array>) seen += chunk.byteLength;
		} catch (e) {
			status = (e as { status?: number }).status ?? null;
		}
		eq(status, 413, 'the failure carries 413');
		assert(req.pulled < 100 * 1024, `stopped early: pulled ${req.pulled} of ${100 * 1024}`);
		assert(seen > 0, 'the bytes before the cap were delivered');
		assert(req.destroyed, 'the socket is destroyed, so the client stops sending');
	});

	await it('the buffered readers enforce the same cap', async () => {
		const req = fakeRequest('x'.repeat(100 * 1024));
		const request = makeWebRequest(req, 'http://localhost/api/x', 8 * 1024);
		let status: number | null = null;
		try {
			await request.text();
		} catch (e) {
			status = (e as { status?: number }).status ?? null;
		}
		eq(status, 413, 'text() is capped identically');
	});

	await it('bodyTooLarge carries the 413 status the server reads', () => {
		eq(bodyTooLarge(10).status, 413, 'status');
		assert(bodyTooLarge(10).message.includes('10'), 'the message names the limit');
	});

	console.log('\n=== query and cookie parsing are unchanged ===');

	await it('query params are flattened', () => {
		const request = makeWebRequest(fakeRequest(''), 'http://localhost/api/x?a=1&b=two');
		eq(request.query.a, '1', 'a');
		eq(request.query.b, 'two', 'b');
	});
	await it('cookies are parsed and percent-decoded', () => {
		const req = fakeRequest('');
		req.headers = { host: 'localhost', cookie: 'session=abc%20def; theme=dark' };
		const request = makeWebRequest(req, 'http://localhost/api/x');
		eq(request.cookies.session, 'abc def', 'decoded value');
		eq(request.cookies.theme, 'dark', 'second cookie');
	});
	await it('a malformed escape does not lose the rest of the jar', () => {
		const req = fakeRequest('');
		req.headers = { host: 'localhost', cookie: 'bad=%E0%A4%A; good=1' };
		const request = makeWebRequest(req, 'http://localhost/api/x');
		eq(request.cookies.good, '1', 'the good cookie survives');
		assert(request.cookies.bad !== undefined, 'the malformed one is kept raw');
	});
	await it('no cookie header yields an empty jar, not a crash', () => {
		const request = makeWebRequest(fakeRequest(''), 'http://localhost/api/x');
		eq(JSON.stringify(request.cookies), '{}', 'empty');
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed === 0 ? 0 : 1);
}

void main();