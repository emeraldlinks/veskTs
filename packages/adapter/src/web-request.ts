/**
 * The `Request` handed to API routes and server actions.
 *
 * One implementation, used by both the dev and production servers. They each
 * carried an identical copy until this existed, which is how the same defect sat
 * in both: the shim built its `Request` with `body: null` and supplied only
 * whole-body readers (`text()`, `json()`, `formData()`). Anything reading
 * `request.body` — which is every streaming parser, including
 * `@vesk/plugin-multipart` — saw no body at all and failed with `NO_BODY`.
 * That is the difference between an upload handler that works and one that
 * 400s on every request, so the body is now a real stream.
 *
 * The stream is created LAZILY, on first access to `request.body`. Attaching
 * `data` listeners eagerly would start draining every GET body in the process,
 * and a GET that never asked for its body would still be read.
 *
 * Reading is single-pass by definition, so both access patterns have to work on
 * one socket: every byte that flows through the stream is cached, and
 * `text()`/`json()`/`formData()` serve from that cache if the stream has already
 * been taken. A handler that reads `request.body` and then calls
 * `request.text()` gets the body once, not a hang.
 */
import type { IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';
import { DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-codegen';

export interface ExtendedRequest extends Request {
  json(): Promise<unknown>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
  clone(): ExtendedRequest;
  cookies: Record<string, string>;
  query: Record<string, string>;
}

export function bodyTooLarge(maxBytes: number): Error & { status: number } {
  const err = new Error(`Request body exceeds limit (${maxBytes} bytes)`) as Error & { status: number };
  err.status = 413;
  return err;
}

export function makeWebRequest(
  nodeReq: IncomingMessage,
  url: string,
  maxBodyBytes: number = DEFAULT_MAX_BODY_BYTES,
): ExtendedRequest {
  const parsedUrl = new URL(url, `http://${nodeReq.headers.host || 'localhost'}`);
  const method = nodeReq.method || 'GET';

  let cachedBody: Buffer | null = null;
  let streamTaken = false;
  let streamEnded = false;
  const endWaiters: Array<() => void> = [];

  const settleEnd = (body: Buffer | null) => {
    if (body !== null) cachedBody = body;
    streamEnded = true;
    for (const resolve of endWaiters.splice(0)) resolve();
  };

  function createBodyStream(): ReadableStream<Uint8Array> {
    streamTaken = true;
    const cache: Buffer[] = [];
    let total = 0;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        nodeReq.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBodyBytes) {
            // Same cap the buffered readers enforce, checked as the bytes arrive
            // so an oversized upload is refused mid-body rather than after the
            // last byte has been read and held in memory.
            settleEnd(Buffer.concat(cache));
            cache.length = 0;
            try { controller.error(bodyTooLarge(maxBodyBytes)); } catch { /* already settled */ }
            nodeReq.destroy();
            return;
          }
          cache.push(chunk);
          try { controller.enqueue(new Uint8Array(chunk)); } catch { /* consumer cancelled */ }
        });
        nodeReq.on('end', () => {
          settleEnd(Buffer.concat(cache));
          cache.length = 0;
          try { controller.close(); } catch { /* errored */ }
        });
        nodeReq.on('error', (e) => {
          settleEnd(Buffer.concat(cache));
          cache.length = 0;
          try { controller.error(e); } catch { /* already settled */ }
        });
      },
    });
  }

  async function getBody(): Promise<Buffer> {
    if (cachedBody) return cachedBody;
    if (streamTaken) {
      // The stream is the reader now. Everything it has seen is in the cache,
      // and it settles on 'end' — so wait rather than racing an empty read.
      while (!streamEnded) await new Promise<void>(r => endWaiters.push(r));
      return cachedBody || Buffer.alloc(0);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of nodeReq) {
      total += chunk.byteLength;
      if (total > maxBodyBytes) throw bodyTooLarge(maxBodyBytes);
      chunks.push(Buffer.from(chunk));
    }
    cachedBody = Buffer.concat(chunks);
    return cachedBody;
  }

  const webRequest = new Request(parsedUrl, {
    method,
    headers: nodeReq.headers as Record<string, string>,
    body: null,
  }) as ExtendedRequest;

  // Shadow the prototype's `body` getter with a lazily-created stream over the
  // Node request. An own accessor on the instance wins over the prototype one,
  // which is the only reason this works without a Node-specific Request class.
  let bodyStream: ReadableStream<Uint8Array> | null = null;
  Object.defineProperty(webRequest, 'body', {
    configurable: true,
    enumerable: false,
    get: () => {
      if (bodyStream) return bodyStream;
      // `new Request(..., { body: null })` reports null for GET/HEAD, which is
      // correct; only a request that can carry a body needs a stream.
      if (method === 'GET' || method === 'HEAD') return null;
      bodyStream = createBodyStream();
      return bodyStream;
    },
  });

  webRequest.json = async () => { try { return JSON.parse((await getBody()).toString()); } catch { return null; } };
  webRequest.text = async () => (await getBody()).toString('utf-8');
  webRequest.formData = async () => {
    const body = await getBody();
    const ct = String(nodeReq.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      const temp = new Request('http://localhost', { method: 'POST', headers: nodeReq.headers as Record<string, string>, body: body as unknown as BodyInit });
      return temp.formData();
    }
    const fd = new FormData();
    if (ct.includes('x-www-form-urlencoded')) {
      for (const [k, v] of new URLSearchParams(body.toString()).entries()) fd.append(k, v);
    }
    return fd;
  };
  webRequest.clone = () => webRequest;

  const cookies: Record<string, string> = {};
  // Iterate the pieces, do NOT destructure them. `cookie.split(';')` yields an
  // array of STRINGS, and a string is iterable, so `for (const [k, v] of …)`
  // bound `k` to the first CHARACTER of the pair ('s' of "session=…"),
  // `indexOf('=')` was always -1, and the loop never populated anything.
  // `request.cookies` has therefore been `{}` in every production request that
  // ever read it. The `[k, v]` form is right for `searchParams.entries()`,
  // which really does yield pairs — which is why the bug survived next to
  // working code.
  for (const part of String(nodeReq.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape must not lose the whole cookie jar.
      cookies[name] = raw;
    }
  }
  webRequest.cookies = cookies;
  const query: Record<string, string> = {};
  for (const [k, v] of parsedUrl.searchParams.entries()) query[k] = v;
  webRequest.query = query;
  return webRequest;
}