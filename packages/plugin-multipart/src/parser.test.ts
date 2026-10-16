import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseMultipart,
	parseMultipartRequest,
	boundaryFromContentType,
	toRecord,
	MultipartError,
} from './parser.js';

const CRLF = '\r\n';
const B = '----veskTestBoundary9x';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(c);
			controller.close();
		},
	});
}

function bodyOf(text: string): ReadableStream<Uint8Array> {
	return streamOf([new TextEncoder().encode(text)]);
}

/** Split a text body into `n` chunks to exercise the incremental path. */
function chunked(text: string, n: number): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	const size = Math.ceil(bytes.length / n) || 1;
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
	return streamOf(chunks);
}

describe('boundaryFromContentType', () => {
	it('reads a plain boundary', () => {
		assert.equal(boundaryFromContentType(`multipart/form-data; boundary=${B}`), B);
	});
	it('reads a quoted boundary', () => {
		assert.equal(boundaryFromContentType(`multipart/form-data; boundary="${B}"`), B);
	});
	it('is case-insensitive on the parameter name', () => {
		assert.equal(boundaryFromContentType(`MULTIPART/FORM-DATA; BOUNDARY=${B}`), B);
	});
	it('returns null for non-multipart', () => {
		assert.equal(boundaryFromContentType('application/json'), null);
	});
	it('returns null when boundary is absent', () => {
		assert.equal(boundaryFromContentType('multipart/form-data'), null);
	});
	it('returns null for a null header', () => {
		assert.equal(boundaryFromContentType(null), null);
	});
});

describe('parseMultipart', () => {
	it('parses a single text field', async () => {
		const body = `--${B}${CRLF}Content-Disposition: form-data; name="title"${CRLF}${CRLF}Hello${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.equal(r.parts.length, 1);
		assert.equal(r.parts[0].name, 'title');
		assert.equal(r.parts[0].value, 'Hello');
		assert.equal(r.parts[0].isFile, false);
	});

	it('parses several fields in order', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="a"${CRLF}${CRLF}1${CRLF}` +
			`--${B}${CRLF}Content-Disposition: form-data; name="b"${CRLF}${CRLF}2${CRLF}` +
			`--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.deepEqual(r.fields.map(p => [p.name, p.value]), [['a', '1'], ['b', '2']]);
	});

	it('preserves File values (the core Object.fromEntries bug)', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="doc"; filename="report.pdf"${CRLF}` +
			`Content-Type: application/pdf${CRLF}${CRLF}PDFDATA${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.equal(r.files.length, 1);
		const f = r.files[0].value as File;
		assert.ok(f instanceof File, 'value must be a real File, not an opaque string');
		assert.equal(f.name, 'report.pdf');
		assert.equal(f.type, 'application/pdf');
		assert.equal(await f.text(), 'PDFDATA');
	});

	it('keeps binary bytes intact through the stream', async () => {
		const bytes = new Uint8Array(256);
		for (let i = 0; i < 256; i++) bytes[i] = i;
		const head = new TextEncoder().encode(
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="b.bin"${CRLF}` +
				`Content-Type: application/octet-stream${CRLF}${CRLF}`,
		);
		const tail = new TextEncoder().encode(`${CRLF}--${B}--${CRLF}`);
		const r = await parseMultipart(streamOf([head, bytes, tail]), B);
		const got = new Uint8Array((r.files[0].value as File).size);
		await (r.files[0].value as Blob).arrayBuffer().then((ab) => got.set(new Uint8Array(ab)));
		assert.deepEqual([...got], [...bytes]);
	});

	it('parses correctly when the body arrives in many chunks', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="title"${CRLF}${CRLF}Hello world${CRLF}` +
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="x.txt"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}chunky${CRLF}--${B}--${CRLF}`;
		for (const n of [1, 3, 7, 16, 64, 512]) {
			const r = await parseMultipart(chunked(body, n), B);
			assert.equal(r.fields[0].value, 'Hello world', `chunked by ${n}`);
			assert.equal((r.files[0].value as File).name, 'x.txt', `chunked by ${n}`);
		}
	});

	it('handles a boundary-like sequence inside the file body', async () => {
		const inner = `${CRLF}--${B}x`;
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="t.txt"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}before${inner}after${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.equal(await (r.files[0].value as File).text(), `before${inner}after`);
	});

	it('strips a directory path from the filename', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="../../etc/passwd"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}x${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.equal((r.files[0].value as File).name, 'passwd');
	});

	it('handles an empty field value', async () => {
		const body = `--${B}${CRLF}Content-Disposition: form-data; name="empty"${CRLF}${CRLF}${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		assert.equal(r.fields[0].value, '');
	});

	it('rejects a file over maxFileSize with 413', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="big.bin"${CRLF}` +
			`Content-Type: application/octet-stream${CRLF}${CRLF}` +
			'x'.repeat(5000) + `${CRLF}--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { maxFileSize: 1000 }),
			(e: MultipartError) => e.status === 413 && e.code === 'FILE_TOO_LARGE',
		);
	});

	it('rejects a body over maxTotalSize with 413', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="big.bin"${CRLF}` +
			`Content-Type: application/octet-stream${CRLF}${CRLF}` +
			'x'.repeat(5000) + `${CRLF}--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { maxTotalSize: 2000 }),
			(e: MultipartError) => e.status === 413 && e.code === 'UPLOAD_TOO_LARGE',
		);
	});

	it('rejects too many files with 413', async () => {
		const mk = (i: number) =>
			`--${B}${CRLF}Content-Disposition: form-data; name="f${i}"; filename="f${i}.txt"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}v${CRLF}`;
		const body = mk(1) + mk(2) + mk(3) + `--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { maxFiles: 2 }),
			(e: MultipartError) => e.status === 413 && e.code === 'TOO_MANY_FILES',
		);
	});

	it('rejects too many fields with 400', async () => {
		const mk = (i: number) =>
			`--${B}${CRLF}Content-Disposition: form-data; name="f${i}"${CRLF}${CRLF}v${CRLF}`;
		const body = mk(1) + mk(2) + mk(3) + `--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { maxFields: 2 }),
			(e: MultipartError) => e.status === 400 && e.code === 'TOO_MANY_FIELDS',
		);
	});

	it('rejects a disallowed mime type with 415', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="a.exe"${CRLF}` +
			`Content-Type: application/x-msdownload${CRLF}${CRLF}MZ${CRLF}--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { allowedMimeTypes: ['image/*'] }),
			(e: MultipartError) => e.status === 415 && e.code === 'FILE_TYPE_NOT_ALLOWED',
		);
	});

	it('accepts a wildcard mime type', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="a.png"${CRLF}` +
			`Content-Type: image/png${CRLF}${CRLF}PNG${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B, { allowedMimeTypes: ['image/*'] });
		assert.equal(r.files.length, 1);
	});

	it('rejects a disallowed extension with 415', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="a.php"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}x${CRLF}--${B}--${CRLF}`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B, { allowedExtensions: ['.png', '.jpg'] }),
			(e: MultipartError) => e.status === 415,
		);
	});

	it('rejects a truncated body with 400', async () => {
		const body = `--${B}${CRLF}Content-Disposition: form-data; name="f"${CRLF}${CRLF}never ends`;
		await assert.rejects(
			() => parseMultipart(bodyOf(body), B),
			(e: MultipartError) => e.status === 400,
		);
	});
});

describe('parseMultipartRequest', () => {
	it('parses a real Request', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="a"${CRLF}${CRLF}1${CRLF}` +
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="n.txt"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}n${CRLF}--${B}--${CRLF}`;
		const req = new Request('http://x/', {
			method: 'POST',
			headers: { 'content-type': `multipart/form-data; boundary=${B}` },
			body,
		});
		const r = await parseMultipartRequest(req);
		assert.equal(r.fields[0].value, '1');
		assert.equal((r.files[0].value as File).name, 'n.txt');
	});

	it('rejects a non-multipart request with 415', async () => {
		const req = new Request('http://x/', { method: 'POST', body: '{}' });
		await assert.rejects(
			() => parseMultipartRequest(req),
			(e: MultipartError) => e.status === 415 && e.code === 'NOT_MULTIPART',
		);
	});
});

describe('toRecord', () => {
	it('keeps File values (unlike Object.fromEntries)', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="t"${CRLF}${CRLF}v${CRLF}` +
			`--${B}${CRLF}Content-Disposition: form-data; name="f"; filename="a.txt"${CRLF}` +
			`Content-Type: text/plain${CRLF}${CRLF}A${CRLF}--${B}--${CRLF}`;
		const r = await parseMultipart(bodyOf(body), B);
		const rec = toRecord(r);
		assert.equal(rec.t, 'v');
		assert.ok(rec.f instanceof File);
	});

	it('collects repeated names into an array', async () => {
		const body =
			`--${B}${CRLF}Content-Disposition: form-data; name="tag"${CRLF}${CRLF}a${CRLF}` +
			`--${B}${CRLF}Content-Disposition: form-data; name="tag"${CRLF}${CRLF}b${CRLF}` +
			`--${B}--${CRLF}`;
		const rec = toRecord(await parseMultipart(bodyOf(body), B));
		assert.deepEqual(rec.tag, ['a', 'b']);
	});
});