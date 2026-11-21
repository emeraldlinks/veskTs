import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_MAX_BODY_BYTES, getClientProtocol } from '@vesk/compiler/src/server-codegen';
import { bodyTooLarge } from '@vesk/adapter/src/web-request';

export { matchPath } from '@vesk/adapter/src/route-match';
export { buildSsrDataScript } from '@vesk/adapter/src/ssr-data';
export type { SsrDataPayload } from '@vesk/adapter/src/ssr-data';

export function toNodeHeaders(response: Response): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = Object.fromEntries(response.headers);
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  return headers;
}

const STREAMING_TYPES = new Set(['text/event-stream', 'application/x-ndjson']);
const DELIVER_BUFFER_LIMIT = 1024 * 1024;

function pumpRemaining(res: ServerResponse, reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
    }
    res.end();
  })();
}

export async function deliverResponse(
  res: ServerResponse,
  response: Response,
  headers: Record<string, string | string[]> = toNodeHeaders(response),
): Promise<void> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    res.writeHead(response.status, headers);
    res.end(await response.text());
    return;
  }
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const reader = body.getReader();
  if (STREAMING_TYPES.has(contentType)) {
    res.writeHead(response.status, headers);
    pumpRemaining(res, reader);
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.byteLength;
      if (size > DELIVER_BUFFER_LIMIT) { overflow = true; break; }
    }
  } catch {
  }
  res.writeHead(response.status, headers);
  if (overflow) {
    for (const chunk of chunks) res.write(chunk);
    pumpRemaining(res, reader);
    return;
  }
  res.end(Buffer.concat(chunks));
}

export async function deliverMiddlewareResponse(res: ServerResponse, response: unknown): Promise<void> {
  const built = response as Response & { build?: () => void };
  if (typeof built.build === 'function') built.build();
  await deliverResponse(res, built);
}

export function errorStatus(e: unknown, fallback = 500): number {
  const s = (e as { status?: unknown } | null)?.status ?? (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' && s >= 400 && s < 600 ? s : fallback;
}

export async function readBody(req: AsyncIterable<Uint8Array>, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > maxBytes) throw bodyTooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readBodyJson(req: AsyncIterable<Uint8Array>, maxBytes: number = DEFAULT_MAX_BODY_BYTES): Promise<unknown | undefined> {
  const buffer = await readBody(req, maxBytes);
  if (buffer.byteLength === 0) return undefined;
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.split(',')[0]?.trim();
  return trimmed || undefined;
}

export function resolveRequestUrl(req: IncomingMessage, port: number, trustProxy: boolean): URL {
  const proto = (req.socket as { encrypted?: boolean }).encrypted
    ? 'https'
    : getClientProtocol({ headers: req.headers } as Record<string, unknown>, trustProxy);
  const forwardedHost = trustProxy ? firstHeaderValue(req.headers['x-forwarded-host']) : undefined;
  const host = forwardedHost || (req.headers.host as string) || `localhost:${port}`;
  const path = req.url || '/';
  try {
    return new URL(path, `${proto}://${host}`);
  } catch {
    return new URL(path, `http://localhost:${port}`);
  }
}
