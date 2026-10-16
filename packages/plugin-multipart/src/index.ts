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
 * import { parseUpload } from '@vesk/plugin-multipart';
 *
 * export async function POST(req: VeskRequest) {
 *   const upload = await parseUpload(req, {
 *     maxFileSize: 8 * 1024 * 1024,
 *     allowedMimeTypes: ['image/png', 'image/jpeg'],
 *   });
 *   const avatar = upload.files[0]?.value as File;
 *   return ServerResponse.json({ ok: true, name: avatar?.name });
 * }
 * ```
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
	MultipartError,
};
export type { MultipartPart, MultipartOptions, ParsedMultipart };

const MiB = 1024 * 1024;

export interface MultipartPluginOptions extends MultipartOptions {
	/** Skip parsing requests below this content-length (default 1). */
	minBytes?: number;
	/**
	 * Parse every multipart request before it reaches the handler. The parsed
	 * result is attached to the request as `__vesk_multipart`, so a handler can
	 * reach it without re-reading the stream.
	 *
	 * Off by default: a handler that never calls `parseUpload` pays nothing.
	 */
	autoParse?: boolean;
}

/**
 * `parseUpload` that returns the JSON error `Response` itself on rejection —
 * the ergonomic form for a route handler:
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
				(request as unknown as Record<string, unknown>).__vesk_multipart = parsed;
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
