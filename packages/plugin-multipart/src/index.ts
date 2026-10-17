/**
 * @vesk/plugin-multipart — streaming `multipart/form-data` uploads for Vesk.
 *
 * Core Vesk can parse multipart through `request.formData()`, but the body is
 * buffered whole under the 1 MiB `DEFAULT_MAX_BODY_BYTES` cap and
 * `Object.fromEntries(fd.entries())` collapses `File` values into opaque
 * strings — so an upload could not be inspected, validated or persisted. That
 * work belongs here rather than in core: most apps never accept a file, and the
 * parser is a few hundred lines that should not ship to everyone.
 *
 * Usage — in a route or API handler:
 *
 * ```ts
 * import { parseUploadOrError } from '@vesk/plugin-multipart';
 *
 * export async function POST(request) {
 *   const upload = await parseUploadOrError(request, {
 *     maxFileSize: 8 * 1024 * 1024,
 *     allowedMimeTypes: ['image/png', 'image/jpeg'],
 *   });
 *   if (upload instanceof Response) return upload; // already a 413/415/400
 *   const avatar = upload.files[0]?.value;
 *   if (avatar instanceof File) console.log(avatar.name, avatar.size);
 *   return Response.json({ ok: true });
 * }
 * ```
 *
 * There is deliberately no bare `parseUpload`: a rejection is a protocol-level
 * outcome (413 / 415 / 400) and every call site has to answer with it, so the
 * function that can return a ready `Response` is the one to reach for. Use
 * `parseMultipartRequest` when you want the throw, to handle it yourself.
 *
 * `request.body` must be a real stream. `vesk dev` and `vesk start` both provide
 * one (see `packages/adapter/src/web-request.ts`); a handler that reaches for
 * `request.formData()` instead is buffered whole under the core 1 MiB body cap
 * and has no per-file, per-type or count limits to enforce.
 *
 * Rejections throw `MultipartError`, whose `status` is 413 (too large / too
 * many), 415 (disallowed type) or 400 (malformed). Nothing is buffered beyond
 * `maxFileSize` per part, so an oversized upload is cut off after the first few
 * KB instead of after the whole body has been read.
 *
 * @module plugin-multipart
 */

import type { VeskPlugin } from '@vesk/types';
import {
	parseMultipart,
	parseMultipartRequest,
	boundaryFromContentType,
	toRecord,
	multipartResult,
	attachMultipartResult,
	MultipartError,
	type MultipartPart,
	type MultipartOptions,
	type ParsedMultipart,
} from './parser.js';

export {
	parseMultipart,
	parseMultipartRequest,
	boundaryFromContentType,
	toRecord,
	multipartResult,
	MultipartError,
};
export type { MultipartPart, MultipartOptions, ParsedMultipart };

const MiB = 1024 * 1024;

export interface MultipartPluginOptions extends MultipartOptions {
	/** Skip parsing requests below this content-length (default 1). */
	minBytes?: number;
	/**
	 * Parse every multipart request before it reaches the handler, so a
	 * configured limit is enforced before any of your code runs.
	 *
	 * Off by default: a handler that never parses an upload pays nothing.
	 *
	 * You rarely read the result yourself — `parseUploadOrError` and
	 * `parseMultipartRequest` reuse a body that has already been parsed, since a
	 * request body cannot be read twice. Reach for `multipartResult(request)`
	 * only where you cannot fail, such as an error page.
	 */
	autoParse?: boolean;
}

/**
 * `parseMultipartRequest` that returns the JSON error `Response` itself on
 * rejection — the ergonomic form for a route handler.
 *
 * ```ts
 * const upload = await parseUploadOrError(req, { maxFileSize: 8 * MiB });
 * if (upload instanceof Response) return upload; // already a 413/415/400
 * ```
 */
export async function parseUploadOrError(
	request: Request,
	options: MultipartOptions = {},
): Promise<ParsedMultipart | Response> {
	try {
		return await parseMultipartRequest(request, options);
	} catch (e) {
		if (e instanceof MultipartError) {
			return new Response(
				JSON.stringify({ error: e.message, code: e.code }),
				{ status: e.status, headers: { 'Content-Type': 'application/json' } },
			);
		}
		throw e;
	}
}

export function multipart(options: MultipartPluginOptions = {}): VeskPlugin {
	const { autoParse = false, minBytes = 1, ...parseOptions } = options;
	return {
		name: 'multipart',
		async onRequest(ctx) {
			if (!autoParse) return;
			const request = ctx.request;
			if (!request) return;
			const length = Number(request.headers.get('content-length') || '0');
			if (Number.isFinite(length) && length < minBytes) return;
			if (!boundaryFromContentType(request.headers.get('content-type'))) return;
			try {
				const parsed = await parseMultipartRequest(request, parseOptions);
				attachMultipartResult(request, parsed);
			} catch (e) {
				if (e instanceof MultipartError) {
					(ctx as unknown as { response?: Response }).response = new Response(
						JSON.stringify({ error: e.message, code: e.code }),
						{ status: e.status, headers: { 'Content-Type': 'application/json' } },
					);
				} else {
					throw e;
				}
			}
		},
	};
}

export default multipart;
export { MiB };
