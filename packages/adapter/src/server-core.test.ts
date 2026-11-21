import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildSsrDataScript,
  deliverMiddlewareResponse,
  deliverResponse,
  errorStatus,
  matchPath,
  readBody,
  readBodyJson,
  resolveRequestUrl,
  toNodeHeaders,
} from '@vesk/adapter/src/server-core';

let passed = 0;
let failed = 0;

async function it(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function mockResponse(): { res: ServerResponse; status: () => number | undefined; headers: () => Record<string, unknown>; body: () => string } {
  let status: number | undefined;
  let headers: Record<string, unknown> = {};
  let body = '';
  const res = {
    writeHead(code: number, h: Record<string, unknown>) {
      status = code;
      headers = h;
      return this;
    },
    write(chunk: Uint8Array | string) {
      body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    },
    end(chunk?: Uint8Array | string) {
      if (chunk !== undefined) body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return this;
    },
  } as unknown as ServerResponse;
  return { res, status: () => status, headers: () => headers, body: () => body };
}

async function* chunks(values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

function request(url: string, headers: Record<string, string>): IncomingMessage {
  return { url, headers, socket: {} } as unknown as IncomingMessage;
}

await it('toNodeHeaders keeps every Set-Cookie value', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'a=1; Path=/');
  headers.append('set-cookie', 'b=2; Path=/');
  const node = toNodeHeaders(new Response('ok', { headers }));
  assert(JSON.stringify(node['set-cookie']) === JSON.stringify(['a=1; Path=/', 'b=2; Path=/']), 'expected both cookies');
});

await it('deliverResponse writes a buffered body with its status and headers', async () => {
  const sink = mockResponse();
  await deliverResponse(sink.res, new Response('{"ok":true}', {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));
  assert(sink.status() === 201, 'expected status 201');
  assert(sink.body() === '{"ok":true}', 'expected buffered JSON body');
});

await it('deliverResponse uses explicit headers when provided', async () => {
  const sink = mockResponse();
  await deliverResponse(sink.res, new Response('ok'), { 'X-Vesk-Test': '1' });
  assert(sink.headers()['X-Vesk-Test'] === '1', 'expected explicit headers');
});

await it('deliverResponse streams event-stream responses', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from('data: one\n\n'));
      controller.enqueue(Buffer.from('data: two\n\n'));
      controller.close();
    },
  });
  const sink = mockResponse();
  await deliverResponse(sink.res, new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(sink.body().includes('data: one'), 'expected first SSE chunk');
  assert(sink.body().includes('data: two'), 'expected second SSE chunk');
});

await it('deliverMiddlewareResponse builds VeskResponse before delivery', async () => {
  const sink = mockResponse();
  let built = false;
  const response = Object.assign(new Response('ok', { status: 202 }), {
    build() { built = true; },
  });
  await deliverMiddlewareResponse(sink.res, response);
  assert(built, 'expected build() to run');
  assert(sink.status() === 202, 'expected status 202');
  assert(sink.body() === 'ok', 'expected response body');
});

await it('errorStatus accepts only error status codes', () => {
  assert(errorStatus({ status: 418 }, 500) === 418, 'expected status');
  assert(errorStatus({ statusCode: 503 }, 500) === 503, 'expected statusCode');
  assert(errorStatus({ status: 302 }, 500) === 500, 'redirect must fall back');
  assert(errorStatus(null, 500) === 500, 'null must fall back');
});

await it('readBody enforces the byte limit', async () => {
  try {
    await readBody(chunks(['1234']), 3);
    throw new Error('expected a 413');
  } catch (e) {
    assert(errorStatus(e, 500) === 413, 'expected body-too-large status');
  }
});

await it('readBodyJson returns undefined for empty and invalid JSON', async () => {
  assert((await readBodyJson(chunks([]), 100)) === undefined, 'empty body must be undefined');
  assert((await readBodyJson(chunks(['{']), 100)) === undefined, 'invalid JSON must be undefined');
});

await it('readBodyJson parses a JSON body', async () => {
  const parsed = await readBodyJson(chunks(['{"a":1}']), 100);
  assert((parsed as { a: number }).a === 1, 'expected parsed body');
});

await it('matchPath returns params for dynamic and catch-all routes', () => {
  assert(matchPath('/users/:id', '/users/42')?.id === '42', 'expected dynamic param');
  assert(matchPath('/files/*rest', '/files/a/b')?.rest === 'a/b', 'expected catch-all param');
  assert(matchPath('/files/*rest', '/files')?.rest === '', 'expected empty trailing catch-all');
  assert(matchPath('/users/:id', '/users') === null, 'expected no match');
});

await it('resolveRequestUrl honors trusted proxy headers only when configured', () => {
  const forwarded = request('/login', {
    host: 'internal:3000',
    'x-forwarded-host': 'public.example',
    'x-forwarded-proto': 'https',
  });
  assert(resolveRequestUrl(forwarded, 3000, true).origin === 'https://public.example', 'expected forwarded origin');
  assert(resolveRequestUrl(forwarded, 3000, false).origin === 'http://internal:3000', 'expected Host origin');
  assert(resolveRequestUrl(request('/x', { host: 'bad host:not-a-port' }), 3000, false).origin === 'http://localhost:3000', 'expected fallback origin');
});

await it('buildSsrDataScript escapes script-breaking characters', () => {
  const script = buildSsrDataScript({ props: { html: '</script>' } });
  assert(script.includes('globalThis.__vesk_props'), 'expected props assignment');
  assert(!script.includes('</script>'), 'expected escaped payload');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
