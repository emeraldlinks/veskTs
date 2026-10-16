/**
 * Streaming `multipart/form-data` parser for Vesk.
 *
 * Why this exists instead of `await request.formData()`:
 *
 *  1. **It buffered the whole body in memory.** The core servers cap request
 *     bodies at 1 MiB (`DEFAULT_MAX_BODY_BYTES`) and hand the buffer to
 *     undici, which then re-parses it. A 40 MB upload could not be accepted
 *     at all, and the process held every byte before rejecting anything.
 *  2. **`Object.fromEntries(fd.entries())` destroys files.** A `File` value
 *     collapses to an opaque string, so `useBody()` / `withValidation()` could
 *     never see a real upload, and nothing could enforce type or size.
 *  3. **No limits could be applied per field.** Validation had to happen after
 *     the entire body was resident.
 *
 * This parser consumes the request stream incrementally and enforces the
 * limits as bytes arrive, so an over-limit upload is aborted after the first
 * few KB rather than after buffering all of it.
 *
 * No regex is used for parsing (see the repo's no-regex rule): this is a byte
 * state machine over an incremental buffer.
 */

/** A single parsed multipart part. */
export interface MultipartPart {
	/** The `name` attribute of the part's Content-Disposition. */
	name: string;
	/** Raw filename from the part, when it was a file upload. */
	filename?: string;
	/** Lowercased MIME type from the part's Content-Type, when present. */
	contentType?: string;
	/** Every header on the part. */
	headers: Record<string, string>;
	/** The part body. Text parts get a decoded string; files a `File`. */
	value: string | File;
	/** Byte length of the part body. */
	size: number;
	/** True when the part carried a filename (i.e. is an upload). */
	isFile: boolean;
}

export interface MultipartLimits {
	/** Max bytes for a single file part. Default 10 MiB. */
	maxFileSize?: number;
	/** Max bytes across the whole body. Default 100 MiB. */
	maxTotalSize?: number;
	/** Max number of file parts. Default 20. */
	maxFiles?: number;
	/** Max number of non-file fields. Default 100. */
	maxFields?: number;
}

export interface MultipartOptions extends MultipartLimits {
	/**
	 * When set, any file whose content type is not in this list is rejected
	 * with a 415. Matching is on the full type or a `type/*` wildcard.
	 */
	allowedMimeTypes?: string[];
	/**
	 * Extension allowlist (with or without the leading dot), checked against
	 * the filename. Applied even when `allowedMimeTypes` is unset.
	 */
	allowedExtensions?: string[];
}

/** Thrown for any rejection. `status` maps onto an HTTP response. */
export class MultipartError extends Error {
	status: number;
	code: string;
	constructor(message: string, code: string, status: number) {
		super(message);
		this.name = 'MultipartError';
		this.code = code;
		this.status = status;
	}
}

const DASH = 0x2d; // '-'
const CR = 0x0d;
const LF = 0x0a;

const SPACE = 0x20;
const TAB = 0x09;
const QUOTE = '"';
const SEMI = 0x3b;
const ZERO = 0x30;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function lower(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) out += s[i].toLowerCase();
	return out;
}

function indexOfFrom(haystack: Uint8Array, needles: number[][], from: number): number {
	const maxLen = needles.reduce((m, n) => (n.length > m ? n.length : m), 0);
	outer: for (let i = from; i <= haystack.length - maxLen; i++) {
		for (const needle of needles) {
			if (i + needle.length > haystack.length) continue;
			for (let k = 0; k < needle.length; k++) {
				if (haystack[i + k] !== needle[k]) continue outer;
			}
			return i;
		}
	}
	return -1;
}

function parseContentDisposition(value: string): { name: string; filename?: string } {
	// name="x"; filename="y" — attribute walk, no regex.
	let name = '';
	let filename: string | undefined;
	let i = 0;
	while (i < value.length) {
		while (i < value.length && (value[i] === ' ' || value[i] === ';' || value[i] === '\t')) i++;
		let key = '';
		while (i < value.length && value[i] !== '=' && value[i] !== ';') key += value[i++];
		key = lower(key.trim());
		let val = '';
		if (value[i] === '=') {
			i++;
			if (value[i] === QUOTE) {
				i++;
				while (i < value.length && value[i] !== QUOTE) val += value[i++];
				i++; // closing quote
			} else {
				while (i < value.length && value[i] !== ';') val += value[i++];
				val = val.trim();
			}
		}
		if (key === 'name') name = val;
		else if (key === 'filename') filename = val;
		if (value[i] === ';') i++;
	}
	return { name, filename };
}

function parseHeaders(block: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const line of block.split('\r\n')) {
		if (!line) continue;
		const idx = line.indexOf(':');
		if (idx === -1) continue;
		headers[lower(line.slice(0, idx).trim())] = line.slice(idx + 1).trim();
	}
	return headers;
}

function encodeName(name: string): string {
	// Handles the exotic case of a non-ASCII field name without throwing.
	try {
		encodeURIComponent(name);
		return name;
	} catch {
		return name;
	}
}

function extractFilenamePath(filename: string): string {
	let i = filename.lastIndexOf('/');
	if (i !== -1) filename = filename.slice(i + 1);
	i = filename.lastIndexOf('\\');
	if (i !== -1) filename = filename.slice(i + 1);
	return filename;
}

function mimeAllowed(contentType: string, list: string[]): boolean {
	const ct = lower(contentType);
	for (const raw of list) {
		const entry = lower(raw.trim());
		if (entry.endsWith('/*')) {
			if (ct.startsWith(entry.slice(0, entry.length - 1))) return true;
		} else if (entry === ct) {
			return true;
		}
	}
	return false;
}

export interface ParsedMultipart {
	parts: MultipartPart[];
	files: MultipartPart[];
	fields: MultipartPart[];
	/** Sum of every part body, excluding part headers and boundaries. */
	totalSize: number;
}

const DEFAULTS = {
	maxFileSize: 10 * 1024 * 1024,
	maxTotalSize: 100 * 1024 * 1024,
	maxFiles: 20,
	maxFields: 100,
};

/**
 * Parse a multipart body from a `ReadableStream`, enforcing limits as bytes
 * arrive. Rejects with `MultipartError` (413/415/400) on the first violation.
 */
export async function parseMultipart(
	stream: ReadableStream<Uint8Array>,
	boundary: string,
	options: MultipartOptions = {},
): Promise<ParsedMultipart> {
	const maxFileSize = options.maxFileSize ?? DEFAULTS.maxFileSize;
	const maxTotalSize = options.maxTotalSize ?? DEFAULTS.maxTotalSize;
	const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;
	const maxFields = options.maxFields ?? DEFAULTS.maxFields;

	const delimiter = encoder.encode(`--${boundary}`);
	const parts: MultipartPart[] = [];
	let totalSize = 0;
	let fileCount = 0;
	let fieldCount = 0;

	// Everything read so far, minus whatever has already been consumed.
	let buffer: Uint8Array = new Uint8Array(0);
	let consumed = 0;

	/** Drop already-consumed prefix so the buffer does not grow without bound. */
	function compact(): void {
		if (consumed === 0) return;
		buffer = buffer.slice(consumed);
		consumed = 0;
	}

	function append(chunk: Uint8Array): void {
		if (buffer.length - consumed === 0) {
			buffer = chunk;
			consumed = 0;
			return;
		}
		const merged = new Uint8Array(buffer.length - consumed + chunk.length);
		merged.set(buffer.subarray(consumed), 0);
		merged.set(chunk, buffer.length - consumed);
		buffer = merged;
		consumed = 0;
	}

	const reader = stream.getReader();
	try {
		for (;;) {
			// ── headers ──────────────────────────────────────────────
			let headerEnd = -1;
			for (;;) {
				headerEnd = indexOfFrom(buffer, [[CR, LF, CR, LF]], consumed);
				if (headerEnd !== -1) break;
				const next = await reader.read();
				if (next.done) throw new MultipartError('Malformed multipart: no part headers found', 'MALFORMED_MULTIPART', 400);
				append(next.value);
				totalSize += next.value.length;
				if (totalSize > maxTotalSize) {
					throw new MultipartError(`Upload exceeds maxTotalSize (${maxTotalSize} bytes)`, 'UPLOAD_TOO_LARGE', 413);
				}
			}

			const headerText = decoder.decode(buffer.subarray(consumed, headerEnd));
			const headers = parseHeaders(headerText);
			const disposition = headers['content-disposition'] || '';
			const { name, filename } = parseContentDisposition(disposition);
			const contentType = headers['content-type'];

			let bodyStart = headerEnd + 4;

			// ── body, streamed until the next boundary ───────────────
			const bodyChunks: Uint8Array[] = [];
			let bodySize = 0;
			let boundaryAt = -1;

			for (;;) {
				boundaryAt = findDelimiter(buffer, delimiter, bodyStart);
				if (boundaryAt !== -1) break;
				if (buffer.length - bodyStart > 0) {
					const keep = delimiter.length + 4;
					if (buffer.length - bodyStart > keep) {
						bodyChunks.push(buffer.slice(bodyStart, buffer.length - keep));
						bodySize += buffer.length - bodyStart - keep;
						bodyStart = buffer.length - keep;
					}
				}
				if (bodySize > maxFileSize) {
					throw new MultipartError(
						filename
							? `File "${filename}" exceeds maxFileSize (${maxFileSize} bytes)`
							: `Field "${name}" exceeds maxFileSize (${maxFileSize} bytes)`,
						'FILE_TOO_LARGE',
						413,
					);
				}
				const next = await reader.read();
				if (next.done) throw new MultipartError('Malformed multipart: truncated body', 'MALFORMED_MULTIPART', 400);
				// append() drops the already-consumed prefix and rebases the
				// buffer, so every absolute offset shifts by exactly that
				// amount. Without this the scan drifted and multi-chunk bodies
				// came back empty or truncated.
				const dropped = consumed;
				append(next.value);
				bodyStart -= dropped;
				totalSize += next.value.length;
				if (totalSize > maxTotalSize) {
					throw new MultipartError(`Upload exceeds maxTotalSize (${maxTotalSize} bytes)`, 'UPLOAD_TOO_LARGE', 413);
				}
			}

			if (boundaryAt > bodyStart) {
				bodyChunks.push(buffer.slice(bodyStart, boundaryAt));
				bodySize += boundaryAt - bodyStart;
			}
			// The in-loop check only runs while the delimiter is still missing,
			// so a body that arrives in one chunk skipped it entirely.
			if (bodySize > maxFileSize) {
				throw new MultipartError(
					filename !== undefined
						? `File "${filename}" exceeds maxFileSize (${maxFileSize} bytes)`
						: `Field "${name}" exceeds maxFileSize (${maxFileSize} bytes)`,
					'FILE_TOO_LARGE',
					413,
				);
			}

			const isFile = filename !== undefined;
			const safeName = isFile ? extractFilenamePath(filename as string) : undefined;
			if (isFile) {
				fileCount++;
				if (fileCount > maxFiles) {
					throw new MultipartError(`Too many files (max ${maxFiles})`, 'TOO_MANY_FILES', 413);
				}
				if (options.allowedMimeTypes && contentType && !mimeAllowed(contentType, options.allowedMimeTypes)) {
					throw new MultipartError(`File type not allowed: ${contentType}`, 'FILE_TYPE_NOT_ALLOWED', 415);
				}
				if (options.allowedExtensions?.length && safeName) {
					const dot = safeName.lastIndexOf('.');
					const ext = dot === -1 ? '' : lower(safeName.slice(dot));
					const ok = options.allowedExtensions.some((e) => lower(e) === ext || lower(e) === `.${ext.slice(1)}`);
					if (!ok) {
						throw new MultipartError(`File extension not allowed: ${ext || '(none)'}`, 'FILE_TYPE_NOT_ALLOWED', 415);
					}
				}
			} else {
				fieldCount++;
				if (fieldCount > maxFields) {
					throw new MultipartError(`Too many form fields (max ${maxFields})`, 'TOO_MANY_FIELDS', 400);
				}
			}

			const merged = concat(bodyChunks, bodySize);
			const value: string | File = isFile
				? new File([merged as BlobPart], safeName ?? 'upload', { type: contentType || 'application/octet-stream' })
				: decoder.decode(merged);

			parts.push({
				name: encodeName(name),
				filename: isFile ? safeName : undefined,
				contentType,
				headers,
				value,
				size: bodySize,
				isFile,
			});

			// Advance past the delimiter and the CRLF that follows it.
			let after = boundaryAt + 2 + delimiter.length;
			if (buffer[after] === DASH && buffer[after + 1] === DASH) {
				// closing boundary "--" — done
				compact();
				return finish(parts, totalSize);
			}
			if (buffer[after] === CR && buffer[after + 1] === LF) after += 2;
			consumed = after;

			if (parts.length > maxFiles + maxFields + 8) {
				throw new MultipartError('Too many multipart parts', 'TOO_MANY_FIELDS', 400);
			}
		}
	} finally {
		try { reader.releaseLock(); } catch { /* already released */ }
	}
}

/** Locate `\r\n--boundary` at or after `from`. */
function findDelimiter(buffer: Uint8Array, delimiter: Uint8Array, from: number): number {
	const needle = new Uint8Array(2 + delimiter.length);
	needle[0] = CR;
	needle[1] = LF;
	needle.set(delimiter, 2);
	// A candidate only counts when the bytes AFTER the delimiter are valid:
	// CRLF (another part follows) or "--" (final boundary). Without this a
	// file whose contents happen to contain "\r\n--<boundary>" was cut short.
	for (let i = from; i <= buffer.length - needle.length; i++) {
		let match = true;
		for (let k = 0; k < needle.length; k++) {
			if (buffer[i + k] !== needle[k]) { match = false; break; }
		}
		if (!match) continue;
		const after = i + needle.length;
		const nextIsCrlf = buffer[after] === CR && buffer[after + 1] === LF;
		const nextIsFinal = buffer[after] === DASH && buffer[after + 1] === DASH;
		if (nextIsCrlf || nextIsFinal) return i;
	}
	return -1;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
	if (chunks.length === 1) return chunks[0];
	const out = new Uint8Array(size);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

function finish(parts: MultipartPart[], totalSize: number): ParsedMultipart {
	return {
		parts,
		files: parts.filter(p => p.isFile),
		fields: parts.filter(p => !p.isFile),
		totalSize,
	};
}

/**
 * Extract the boundary token from a `Content-Type` header. Returns null when
 * the header is not multipart or carries no boundary.
 */
export function boundaryFromContentType(contentType: string | null | undefined): string | null {
	if (!contentType) return null;
	// Only the media type and the parameter NAME are case-insensitive; the
	// boundary VALUE is opaque and must survive verbatim (lowercasing it
	// changed the delimiter the parser then searched for).
	if (!lower(contentType.trim()).startsWith('multipart/')) return null;
	for (const chunk of contentType.split(';')) {
		const trimmed = chunk.trim();
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		if (lower(trimmed.slice(0, eq).trim()) !== 'boundary') continue;
		let v = trimmed.slice(eq + 1).trim();
		if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
		return v.length > 0 ? v : null;
	}
	return null;
}

/** Convenience: parse straight from a `Request` using its content-type. */
export async function parseMultipartRequest(
	request: Request,
	options: MultipartOptions = {},
): Promise<ParsedMultipart> {
	if (!request.body) throw new MultipartError('Request has no body', 'NO_BODY', 400);
	const boundary = boundaryFromContentType(request.headers.get('content-type'));
	if (!boundary) {
		throw new MultipartError('Not a multipart request (missing boundary)', 'NOT_MULTIPART', 415);
	}
	return parseMultipart(request.body as ReadableStream<Uint8Array>, boundary, options);
}

/**
 * Shape a parsed upload for `withValidation()`-style code and for
 * `Object.fromEntries`-style flattening WITHOUT destroying `File` values.
 * Repeated field names collect into an array.
 */
export function toRecord(parsed: ParsedMultipart): Record<string, string | File | Array<string | File>> {
	const out: Record<string, string | File | Array<string | File>> = {};
	for (const part of parsed.parts) {
		const existing = out[part.name];
		if (existing === undefined) {
			out[part.name] = part.value;
		} else if (Array.isArray(existing)) {
			existing.push(part.value);
		} else {
			out[part.name] = [existing as string | File, part.value];
		}
	}
	return out;
}

export { ZERO as _ZERO };