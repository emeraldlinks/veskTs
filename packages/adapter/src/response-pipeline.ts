/**
 * Transport-level response pipeline: conditional GET (ETag → 304) and
 * content-encoding negotiation (brotli / gzip).
 *
 * Both live in one wrapper because they share the same constraint: the decision
 * can only be made once the whole body is known. `res.writeHead` sends headers
 * to the socket immediately, so a wrapper that compressed or tagged at
 * `writeHead` time would either have to buffer every response in the server (a
 * second copy of every page) or get the answer wrong for streamed bodies.
 * Instead this captures `writeHead` and defers it until the body is either
 * complete (`end`) or discovered to be a stream (`write`).
 *
 * Consequences worth knowing:
 *
 * - **One install covers every call site.** The prod server writes headers in
 *   ~15 places; wrapping `res` once means a new one cannot be forgotten. A
 *   static file, an SSR page, a JSON API body and a middleware short-circuit
 *   all pass through the same path.
 * - **The first `write()` opts the response out of everything.** A stream
 *   (SSE, a chunked `renderPageStream`) cannot be re-encoded after the first
 *   bytes are out, so `write()` flushes the captured headers verbatim and every
 *   later `write`/`end` is a passthrough. No `Content-Encoding` is ever
 *   announced for a body that was not encoded.
 * - **The wrapper composes with header decorators.** Installing *after* another
 *   `writeHead` wrapper means this layer's captured reference IS that wrapper,
 *   so security headers and per-request overrides are still applied — at flush
 *   time, exactly once.
 *
 * Deliberately not here: range requests, `Last-Modified`/`If-Modified-Since`
 * (the ETag covers the same revalidation need and cannot disagree with itself),
 * and compression of already-encoded bodies.
 */
import { createHash } from 'node:crypto';
import {
	brotliCompress,
	constants as zlibConstants,
	createBrotliCompress,
	createGzip,
	gzip,
} from 'node:zlib';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export type ContentEncoding = 'br' | 'gzip';

/**
 * Pick a content coding from `Accept-Encoding`.
 *
 * Quality values are honoured because a client is entitled to say "I accept
 * gzip but not brotli" (`br;q=0`) or "gzip only at half priority". `*` applies
 * to codings the header does not name. Ties go to brotli: every browser that
 * sends both lists them equally, and brotli is smaller.
 */
export function negotiateEncoding(header: string | string[] | undefined): ContentEncoding | null {
	if (!header) return null;
	// `header` is `string | string[]` per Node's typings, but a duplicated
	// header arrives joined by ", " in practice; both shapes fold to one list.
	const value = Array.isArray(header) ? header.join(',') : header;
	const q: Record<string, number> = {};
	for (const part of value.split(',')) {
		const seg = part.trim();
		if (!seg) continue;
		const semi = seg.indexOf(';');
		const token = (semi === -1 ? seg : seg.slice(0, semi)).trim().toLowerCase();
		if (!token) continue;
		let weight = 1;
		if (semi !== -1) {
			for (const param of seg.slice(semi + 1).split(';')) {
				const eq = param.indexOf('=');
				if (eq === -1) continue;
				if (param.slice(0, eq).trim().toLowerCase() !== 'q') continue;
				const parsed = Number.parseFloat(param.slice(eq + 1).trim());
				if (Number.isFinite(parsed)) weight = parsed;
			}
		}
		// First occurrence wins, per RFC 9110 — a client cannot raise its own
		// preference by listing a coding twice.
		if (!(token in q)) q[token] = weight;
	}
	const star = q['*'];
	const br = q['br'] !== undefined ? q['br'] : star;
	const gz = q['gzip'] !== undefined ? q['gzip'] : star;
	if (br !== undefined && br > 0 && (gz === undefined || gz <= 0 || br >= gz)) return 'br';
	if (gz !== undefined && gz > 0) return 'gzip';
	return null;
}

/**
 * Would compressing this content type actually pay?
 *
 * The rule is "text-like, not already compressed". Images, fonts, video and
 * archives are already compressed — a second pass costs CPU and usually makes
 * the body *larger*, which is why the size check in `installResponsePipeline`
 * is kept as a second line of defence rather than the only one.
 */
export function isCompressibleType(contentType: string | undefined): boolean {
	if (!contentType) return false;
	const type = (contentType.split(';')[0] || '').trim().toLowerCase();
	if (!type) return false;
	if (type.startsWith('text/')) return true;
	if (type === 'image/svg+xml' || type === 'image/x-icon' || type === 'image/bmp') return true;
	if (type.endsWith('+json') || type.endsWith('+xml')) return true;
	switch (type) {
		case 'application/javascript':
		case 'application/x-javascript':
		case 'application/ecmascript':
		case 'application/json':
		case 'application/manifest+json':
		case 'application/ld+json':
		case 'application/graphql':
		case 'application/x-ndjson':
		case 'application/xml':
		case 'application/xhtml+xml':
		case 'application/rss+xml':
		case 'application/atom+xml':
			return true;
		default:
			return false;
	}
}

/**
 * A validator for these exact bytes.
 *
 * sha1 rather than sha256 because this is a cache validator, not a security
 * primitive (RFC 9110 requires "a function of the representation", and nginx
 * ships md5 here), and every request hashes its body. Truncated to 20 bytes of
 * base64 — 27 characters — which is far beyond collision range for a validator.
 */
export function etagFor(body: Buffer): string {
	return `"${createHash('sha1').update(body).digest('base64').slice(0, 27)}"`;
}

/**
 * `If-None-Match` satisfaction, weak comparison as RFC 9110 §13.1.2 requires
 * for GET. Weak comparison ignores the `W/` prefix on either side, which is what
 * makes a `W/"x"` from a proxy match our strong `"x"`.
 */
export function ifNoneMatchSatisfied(header: string | string[] | undefined, etag: string): boolean {
	if (!header) return false;
	const value = Array.isArray(header) ? header.join(',') : header;
	const candidates = value.split(',').map(s => s.trim()).filter(Boolean);
	if (candidates.includes('*')) return true;
	const strip = (s: string) => (s.startsWith('W/') ? s.slice(2) : s).trim();
	const target = strip(etag);
	for (const candidate of candidates) {
		if (strip(candidate) === target) return true;
	}
	return false;
}

export interface ResponsePipelineOptions {
	/** Set false to disable content-coding negotiation. Default true. */
	compress?: boolean;
	/** Smallest body worth compressing, in bytes. Default 1024. */
	compressThreshold?: number;
	/** Set false to disable ETag/304. Default true. */
	etag?: boolean;
	/** brotli quality 0-11. Default 5 — 11 is several hundred ms per megabyte. */
	brotliQuality?: number;
	/** gzip level 1-9. Default 6. */
	gzipLevel?: number;
}

type HeaderBag = Record<string, string | number | string[] | undefined>;

function getHeader(headers: HeaderBag, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === wanted) {
			const v = headers[key];
			if (v === undefined) return undefined;
			return Array.isArray(v) ? v.join(', ') : String(v);
		}
	}
	return undefined;
}

function hasNoStore(cacheControl: string | undefined): boolean {
	if (!cacheControl) return false;
	return cacheControl.split(',').some(part => part.trim().toLowerCase() === 'no-store');
}

/** Add `value` to `Vary` without duplicating an entry already there. */
function withVary(current: string | undefined, value: string): string {
	if (!current) return value;
	const existing = current.split(',').map(s => s.trim().toLowerCase());
	if (existing.includes(value.toLowerCase())) return current;
	if (existing.includes('*')) return current;
	return `${current}, ${value}`;
}

/**
 * Wrap `res` so every buffered response is tagged with an ETag, revalidated
 * against `If-None-Match`, and encoded — in that order, because a 304 must be
 * decided on the *unencoded* bytes.
 */
export function installResponsePipeline(
	res: ServerResponse,
	req: IncomingMessage,
	options: ResponsePipelineOptions = {},
): void {
	const compressEnabled = options.compress !== false;
	const etagEnabled = options.etag !== false;
	const threshold = options.compressThreshold ?? 1024;
	const brotliQuality = options.brotliQuality ?? 5;
	const gzipLevel = options.gzipLevel ?? 6;

	const realWriteHead = res.writeHead.bind(res) as (
		statusCode: number,
		headers?: Record<string, string | number | string[]>,
	) => ServerResponse;
	const realWrite = res.write.bind(res);
	const realEnd = res.end.bind(res);
	const realFlushHeaders = res.flushHeaders.bind(res);

	let pendingStatus = 200;
	let pendingHeaders: HeaderBag = {};
	let flushed = false;
	let streaming = false;
	let streamCompressor: (NodeJS.WritableStream & { write(c: Buffer): boolean; end(c?: Buffer): void }) | null = null;

	/** Emit the captured status+headers exactly once, merging in `extra`. */
	function flush(extra?: Record<string, string | undefined>): void {
		if (flushed) return;
		flushed = true;
		const headers: Record<string, string | number | string[]> = {};
		for (const [key, value] of Object.entries(pendingHeaders)) {
			if (value !== undefined) headers[key] = value;
		}
		for (const [key, value] of Object.entries(extra || {})) {
			if (value === undefined) delete headers[key];
			else headers[key] = value;
		}
		realWriteHead(pendingStatus, headers);
	}

	res.writeHead = ((statusCode: number, headers?: Record<string, string | number | string[]>) => {
		if (flushed || streaming) return realWriteHead(statusCode, headers);
		pendingStatus = statusCode;
		pendingHeaders = { ...(headers || {}) };
		return res;
	}) as typeof res.writeHead;

	/**
	 * Would this response's bytes differ if the client sent a different
	 * `Accept-Encoding`? If yes it must be announced in `Vary` whether or not
	 * an encoding was actually applied — a cache that stored the identity copy
	 * without seeing `Vary` would then serve it to a client that can decode br.
	 */
	function encodingIsVariable(): boolean {
		return compressEnabled
			&& !getHeader(pendingHeaders, 'content-encoding')
			&& isCompressibleType(getHeader(pendingHeaders, 'content-type'));
	}

	function startStreamCompression(encoding: ContentEncoding): void {
		const compressor = encoding === 'br'
			? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality } })
			: createGzip({ level: gzipLevel });
		// The compressor owns the socket from here: its output is what the client
		// receives, and its `end` is what actually finishes the response. This is
		// what lets a *streamed* body still be encoded — buffering it to compute a
		// validator would defeat the streaming in the first place.
		compressor.on('data', (chunk: Buffer) => { realWrite(chunk); });
		compressor.on('end', () => { realEnd(); });
		compressor.on('error', () => {
			// A compressor failure must still produce a complete response object;
			// the bytes already written are the unencoded prefix, which is why the
			// socket has to be closed rather than left open.
			try { realEnd(); } catch { /* already finished */ }
		});
		streamCompressor = compressor;
	}

	res.write = ((chunk: unknown, encoding?: unknown) => {
		if (!flushed && !streaming) {
			streaming = true;
			const vary = withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding');
			const encodingChosen = encodingIsVariable() ? negotiateEncoding(req.headers['accept-encoding']) : null;
			if (encodingChosen) {
				startStreamCompression(encodingChosen);
				// Content-Length cannot survive: the encoded stream's length is
				// unknown until it ends, and a wrong one truncates the response.
				flush({ 'Content-Encoding': encodingChosen, Vary: vary, 'Content-Length': undefined });
			} else {
				flush({ Vary: encodingIsVariable() ? vary : undefined });
			}
		}
		if (streamCompressor) {
			streamCompressor.write(toBuffer(chunk, encoding) || Buffer.alloc(0));
			return true;
		}
		return typeof encoding === 'undefined'
			? realWrite(chunk)
			: (realWrite as (...a: unknown[]) => boolean)(chunk, encoding);
	}) as typeof res.write;

	res.flushHeaders = (() => {
		if (!flushed) {
			streaming = true;
			flush();
		}
		realFlushHeaders.call(res);
	}) as typeof res.flushHeaders;

	function toBuffer(chunk: unknown, encoding: unknown): Buffer | null {
		if (chunk === undefined || chunk === null) return null;
		if (Buffer.isBuffer(chunk)) return chunk;
		if (typeof chunk === 'string') {
			return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8');
		}
		if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		return null;
	}

	function finish(body: Buffer | null, endArgs: unknown[]): void {
		const method = (req.method || 'GET').toUpperCase();

		// Nothing to compress, tag or revalidate. Empty bodies include 204 and
		// 304 responses, which must not carry a Content-Length anyway.
		if (!body || body.length === 0 || streaming || flushed) {
			flush();
			(realEnd as (...args: unknown[]) => void)(...endArgs);
			return;
		}

		const cacheable = method === 'GET' || method === 'HEAD';
		const existingEtag = getHeader(pendingHeaders, 'etag');
		// `no-store` means the bytes are not reusable, so a validator would only
		// produce a 304 that hands the client back a body the server has already
		// consumed. This is load-bearing for the single-use `/ssr-data.js` and
		// `/store-init.js` payloads, which are deleted as they are read.
		const canValidate = cacheable && pendingStatus === 200 && !hasNoStore(getHeader(pendingHeaders, 'cache-control'));

		if (!canValidate) {
			maybeCompress(body, endArgs);
			return;
		}

		const etag = existingEtag || (etagEnabled ? etagFor(body) : undefined);
		if (etag && ifNoneMatchSatisfied(req.headers['if-none-match'], etag)) {
			// A 304 carries the validator and the caching directives and nothing
			// else — no body, and no Content-Type/Content-Length describing one.
			const headers304: Record<string, string> = { ETag: etag };
			const cc = getHeader(pendingHeaders, 'cache-control');
			if (cc) headers304['Cache-Control'] = cc;
			headers304.Vary = withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding');
			flushed = true;
			realWriteHead(304, headers304);
			(realEnd as (...args: unknown[]) => void)();
			return;
		}
		if (etag && !existingEtag) {
			pendingHeaders = { ...pendingHeaders, ETag: etag };
		}
		maybeCompress(body, endArgs);
	}

	function maybeCompress(body: Buffer, endArgs: unknown[]): void {
		// Below the threshold the bytes are identical whatever the client asks
		// for, so no `Vary` is owed — announcing one would fragment caches for
		// nothing. At or above it, the representation does vary by encoding and
		// `Vary` is announced whether or not a coding was chosen.
		if (compressEnabled
			&& body.length < threshold
			|| !encodingIsVariable()) {
			flush();
			(realEnd as (...args: unknown[]) => void)(...endArgs);
			return;
		}
		const encoding = negotiateEncoding(req.headers['accept-encoding']);
		if (!encoding) {
			flush({ Vary: withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding') });
			(realEnd as (...args: unknown[]) => void)(...endArgs);
			return;
		}
		const compress = encoding === 'br' ? brotliCompressAsync : gzipAsync;
		const params = encoding === 'br'
			? { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality } }
			: { level: gzipLevel };
		void Promise.resolve()
			.then(() => compress(body, params as never))
			.then((encoded: Buffer) => {
				// A body that did not get smaller is not worth the encoding: it
				// costs the client CPU on every fetch for nothing.
				if (flushed || streaming) {
					flush();
					(realEnd as (...args: unknown[]) => void)(...endArgs);
					return;
				}
				if (encoded.length >= body.length) {
					flush({ Vary: withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding') });
					(realEnd as (...args: unknown[]) => void)(...endArgs);
					return;
				}
				flush({
					'Content-Encoding': encoding,
					Vary: withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding'),
					'Content-Length': String(encoded.length),
				});
				(realEnd as (...args: unknown[]) => void)(encoded);
			})
			.catch(() => {
				// Compression must never be the reason a response is lost.
				flush({ Vary: withVary(getHeader(pendingHeaders, 'vary'), 'Accept-Encoding') });
				(realEnd as (...args: unknown[]) => void)(...endArgs);
			});
	}

	res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
		if (streamCompressor) {
			// Ending the compressor is what ends the response — it flushes its
			// own buffered tail first, so the client gets a complete stream.
			if (typeof callback === 'function') res.once('finish', callback as () => void);
			const tail = toBuffer(chunk, encoding);
			if (tail) streamCompressor.end(tail);
			else streamCompressor.end();
			return res;
		}
		if (streaming || flushed) {
			return (realEnd as (...args: unknown[]) => void)(chunk, encoding, callback);
		}
		// Node's end() has four shapes — (), (cb), (data), (data, enc),
		// (data, cb), (data, enc, cb). Forward only the arguments that were
		// actually supplied: `end(body, undefined, undefined)` is NOT the same
		// as `end(body)` for a callback-taking overload.
		const endArgs: unknown[] = chunk === undefined
			? (callback === undefined ? [] : [callback])
			: encoding === undefined
				? (callback === undefined ? [chunk] : [chunk, callback])
				: (callback === undefined ? [chunk, encoding] : [chunk, encoding, callback]);
		const body = toBuffer(chunk, encoding);
		finish(body, endArgs);
		return res;
	}) as typeof res.end;
}