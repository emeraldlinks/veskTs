/**
 * Vesk Runtime Tests — useFetch / createResource
 *
 * Covers: fetch-compatible options (method, headers, JSON body), dedup,
 * staleTime caching, keepPreviousData, retry + backoff, timeout, enabled,
 * mutate(), abort-on-destroy, and the SSR pass-loop integration.
 */
import { useFetch, createResource, mutate, clearSsrData, HttpError, TimeoutError } from '@vesk/runtime/src/resource';
import { root, destroy_block } from '@vesk/runtime/src/ripple-blocks';
import { track, get, run_block } from '@vesk/runtime/src/ripple-runtime';
import type { Tracked } from '@vesk/runtime/src/ripple-runtime';

let passed = 0;
let failed = 0;
const errors: Error[] = [];
let asyncChain: Promise<void> = Promise.resolve();

function it(name: string, fn: () => Promise<void> | void): void {
  asyncChain = asyncChain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      errors.push(e as Error);
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    }
  });
}

function expect(value: unknown) {
  return {
    toBe(expected: unknown) {
      if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(value) !== JSON.stringify(expected))
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const originalFetch = globalThis.fetch;
interface FetchCall {
  url: RequestInfo | URL;
  init?: RequestInit;
}

function mockFetch(handler: (call: FetchCall) => Promise<Response>) {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init });
    return handler({ url, init: init ?? {} });
  };
  return {
    calls,
    restore: () => {
      (globalThis as any).fetch = originalFetch;
    },
  };
}

function jsonResponse(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(data),
  } as Response);
}

function cleanupGlobals(): void {
  delete (globalThis as any).__vsk_ssr;
  delete (globalThis as any).__vsk_ssr_token;
  delete (globalThis as any).__vsk_ssr_promises;
  delete (globalThis as any).__vsk_ssr_promises_test;
  delete (globalThis as any).__vsk_fetch_inflight;
  delete (globalThis as any).__vsk_fetch_registry;
  delete (globalThis as any).__vsk_fetch_cache;
  delete (globalThis as any).__vesk_ssr_base_url;
  delete (globalThis as any).__vesk_request;
  clearSsrData();
}

// ============================================================
// Fetch-compatible options (fetch/axios-like usage)
// ============================================================
console.log('\n=== useFetch — fetch/axios-like options ===');

it('passes method, headers, JSON body, credentials to fetch', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ ok: true }));
  const res = useFetch<{ ok: boolean }>('/api/echo', {
    method: 'POST',
    headers: { 'X-Custom': 'yes' },
    body: { name: 'vesk' },
    credentials: 'include',
  });
  await waitFor(() => !res.loading);
  expect(mock.calls.length).toBe(1);
  const init = mock.calls[0].init;
  expect(init?.method).toBe('POST');
  expect(init?.credentials).toBe('include');
  expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  expect((init?.headers as Record<string, string>)['X-Custom']).toBe('yes');
  expect(init?.body).toBe(JSON.stringify({ name: 'vesk' }));
  expect(res.data).toEqual({ ok: true });
  mock.restore();
});

it('does not JSON-stringify string or FormData-like bodies', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse(null));
  useFetch('/api/raw', { method: 'PUT', body: 'plain text' });
  await waitFor(() => mock.calls.length === 1);
  expect(mock.calls[0].init?.body).toBe('plain text');
  mock.restore();
});

it('surfaces HTTP errors as HttpError with status', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({}, 404));
  const res = useFetch('/api/missing');
  await waitFor(() => res.error !== null);
  expect(res.error instanceof HttpError).toBe(true);
  expect((res.error as HttpError).status).toBe(404);
  mock.restore();
});

it('does not retry 4xx errors', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({}, 403));
  const res = useFetch('/api/forbidden', { retry: 3, retryDelay: 5 });
  await waitFor(() => res.error !== null);
  expect(mock.calls.length).toBe(1);
  mock.restore();
});

// ============================================================
// Retry + timeout
// ============================================================
console.log('\n=== useFetch — retry + timeout ===');

it('retries transient failures with backoff, then succeeds', async () => {
  cleanupGlobals();
  let attempts = 0;
  const mock = mockFetch(() => {
    attempts++;
    if (attempts <= 2) return jsonResponse({}, 500);
    return jsonResponse({ healed: true });
  });
  const res = useFetch<{ healed: boolean }>('/api/flaky', { retry: 2, retryDelay: 10 });
  await waitFor(() => !res.loading);
  expect(mock.calls.length).toBe(3);
  expect(res.data).toEqual({ healed: true });
  mock.restore();
});

it('does not retry non-GET requests', async () => {
  cleanupGlobals();
  let attempts = 0;
  const mock = mockFetch(() => {
    attempts++;
    return jsonResponse({}, 500);
  });
  const res = useFetch('/api/post', { method: 'POST', body: { a: 1 }, retry: 3, retryDelay: 5 });
  await waitFor(() => res.error !== null);
  expect(mock.calls.length).toBe(1);
  mock.restore();
});

it('fails with TimeoutError when the request hangs', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => new Promise<Response>(() => {}));
  const res = useFetch('/api/hang', { timeout: 50 });
  await waitFor(() => res.error !== null, 3000);
  expect(res.error instanceof TimeoutError).toBe(true);
  expect(mock.calls.length).toBe(1);
  mock.restore();
});

// ============================================================
// Dedup
// ============================================================
console.log('\n=== useFetch — dedup ===');

it('shares one in-flight request for the same key', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ shared: true }));
  const a = useFetch('/api/shared');
  const b = useFetch('/api/shared');
  await waitFor(() => !a.loading && !b.loading);
  expect(mock.calls.length).toBe(1);
  expect(a.data).toEqual({ shared: true });
  expect(b.data).toEqual({ shared: true });
  mock.restore();
});

it('dedupe: false issues separate requests', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ n: 1 }));
  const a = useFetch('/api/sep', { dedupe: false });
  const b = useFetch('/api/sep', { dedupe: false });
  await waitFor(() => !a.loading && !b.loading);
  expect(mock.calls.length).toBe(2);
  mock.restore();
});

// ============================================================
// staleTime caching + keepPreviousData
// ============================================================
console.log('\n=== useFetch — caching ===');

it('reuses cached data within staleTime without refetching', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ cached: true }));
  const a = useFetch('/api/cache1', { staleTime: 60000 });
  await waitFor(() => !a.loading);
  expect(mock.calls.length).toBe(1);
  const b = useFetch('/api/cache1', { staleTime: 60000 });
  expect(mock.calls.length).toBe(1);
  expect(b.data).toEqual({ cached: true });
  expect(b.loading).toBe(false);
  mock.restore();
});

it('refetches after staleTime expires', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ v: 1 }));
  const a = useFetch('/api/cache2', { staleTime: 30 });
  await waitFor(() => !a.loading);
  await sleep(60);
  const b = useFetch('/api/cache2', { staleTime: 30 });
  expect(mock.calls.length).toBe(2);
  await waitFor(() => !b.loading);
  mock.restore();
});

it('keepPreviousData keeps old data while revalidating', async () => {
  cleanupGlobals();
  let value = 'v1';
  const mock = mockFetch(() => jsonResponse(value));
  const res = useFetch<string>('/api/kpd', { staleTime: 30000, keepPreviousData: true });
  await waitFor(() => !res.loading && res.data === 'v1');
  value = 'v2';
  res.refresh?.();
  expect(res.loading).toBe(true);
  expect(res.data).toBe('v1');
  await waitFor(() => !res.loading);
  expect(res.data).toBe('v2');
  mock.restore();
});

// ============================================================
// mutate + enabled + refresh
// ============================================================
console.log('\n=== useFetch — mutate / enabled / refresh ===');

it('mutate(key, data) updates live resources immediately', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ initial: true }));
  const res = useFetch('/api/mut1', { key: 'mut1' });
  await waitFor(() => !res.loading);
  mutate('mut1', { patched: true });
  expect(res.data).toEqual({ patched: true });
  expect(mock.calls.length).toBe(1);
  mock.restore();
});

it('mutate(key) revalidates with a fresh request', async () => {
  cleanupGlobals();
  let value = 'first';
  const mock = mockFetch(() => jsonResponse(value));
  const res = useFetch<string>('/api/mut2', { key: 'mut2' });
  await waitFor(() => !res.loading);
  value = 'second';
  mutate('mut2');
  await waitFor(() => res.data === 'second');
  expect(mock.calls.length).toBe(2);
  mock.restore();
});

it('refresh() bypasses stale cache', async () => {
  cleanupGlobals();
  let value = 'a';
  const mock = mockFetch(() => jsonResponse(value));
  const res = useFetch<string>('/api/ref', { staleTime: 60000 });
  await waitFor(() => !res.loading);
  value = 'b';
  res.refresh?.();
  await waitFor(() => res.data === 'b');
  expect(mock.calls.length).toBe(2);
  mock.restore();
});

it('enabled: false skips the fetch entirely', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({}));
  const res = useFetch('/api/disabled', { enabled: false });
  expect(mock.calls.length).toBe(0);
  expect(res.loading).toBe(false);
  expect(res.data).toBe(undefined);
  mock.restore();
});

// ============================================================
// Abort on destroy
// ============================================================
console.log('\n=== useFetch — abort on destroy ===');

it('aborts the in-flight request when its block is destroyed', async () => {
  cleanupGlobals();
  let aborted = false;
  const mock = mockFetch(({ init }) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    }),
  );
  const block = root(() => {
    useFetch('/api/abort');
  });
  await sleep(10);
  expect(mock.calls.length).toBe(1);
  expect(aborted).toBe(false);
  destroy_block(block);
  await waitFor(() => aborted);
  mock.restore();
});

it('does not abort when the block re-runs (not destroyed)', async () => {
  cleanupGlobals();
  let resolveFetch: (r: Response) => void = () => {};
  const mock = mockFetch(() => new Promise<Response>(r => { resolveFetch = r; }));
  let res: ReturnType<typeof useFetch>;
  const block = root(() => {
    res = useFetch('/api/rerun');
  });
  await waitFor(() => mock.calls.length === 1);
  run_block(block);
  await sleep(10);
  expect(mock.calls.length).toBe(1);
  resolveFetch(jsonResponse({ ok: 1 }));
  await waitFor(() => !res.loading);
  expect(mock.calls.length).toBe(1);
  expect(res.data).toEqual({ ok: 1 });
  mock.restore();
});

// ============================================================
// SSR integration
// ============================================================
console.log('\n=== useFetch — SSR pass loop ===');

it('tracks promises token-scoped and writes __vsk_ssr_data', async () => {
  cleanupGlobals();
  (globalThis as any).__vsk_ssr = true;
  (globalThis as any).__vsk_ssr_token = 'test-token';
  const mock = mockFetch(() => jsonResponse({ fromServer: true }));
  const res = useFetch('/api/ssr');
  expect(res.loading).toBe(true);
  const key = '__vsk_ssr_promises_test-token';
  const promises = (globalThis as any)[key] as Promise<unknown>[];
  expect(promises.length).toBe(1);
  await Promise.allSettled(promises);
  expect((globalThis as any).__vsk_ssr_data['/api/ssr']).toEqual({ fromServer: true });
  const res2 = useFetch('/api/ssr');
  expect(res2.loading).toBe(false);
  expect(res2.data).toEqual({ fromServer: true });
  expect(mock.calls.length).toBe(1);
  mock.restore();
  cleanupGlobals();
});

it('dedups concurrent SSR requests across components', async () => {
  cleanupGlobals();
  (globalThis as any).__vsk_ssr = true;
  (globalThis as any).__vsk_ssr_token = 'test-token';
  const mock = mockFetch(() => jsonResponse({ x: 1 }));
  useFetch('/api/ssr-dedup');
  useFetch('/api/ssr-dedup');
  const promises = (globalThis as any)['__vsk_ssr_promises_test-token'] as Promise<unknown>[];
  await Promise.allSettled(promises);
  expect(mock.calls.length).toBe(1);
  mock.restore();
  cleanupGlobals();
});

// ============================================================
// Awaitable API (await useFetch() resolves to the data)
// ============================================================
console.log('\n=== useFetch — awaitable API ===');

it('await useFetch() resolves to the raw response data', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ hello: 'world' }));
  const posts = await useFetch<{ hello: string }>('/api/await-json');
  expect(posts).toEqual({ hello: 'world' });
  expect(mock.calls.length).toBe(1);
  mock.restore();
});

it('await useFetch() rejects with HttpError on HTTP failure', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({}, 500));
  let thrown: unknown;
  try {
    await useFetch('/api/await-500');
  } catch (e) {
    thrown = e;
  }
  expect(thrown instanceof HttpError).toBe(true);
  expect((thrown as HttpError).status).toBe(500);
  mock.restore();
});

it('await useFetch() rejects with the settle error when already failed', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({}, 404));
  const res = useFetch('/api/await-404');
  await waitFor(() => res.error !== null);
  let thrown: unknown;
  try {
    await res;
  } catch (e) {
    thrown = e;
  }
  expect(thrown instanceof HttpError).toBe(true);
  mock.restore();
});

it('exposes sync data/loading/error getters and is not callable', async () => {
  cleanupGlobals();
  const mock = mockFetch(() => jsonResponse({ live: true }));
  const res = useFetch<{ live: boolean }>('/api/await-live');
  expect(res.loading).toBe(true);
  expect(res.data).toBe(undefined);
  expect(typeof (res as unknown as () => unknown)).toBe('object');
  const data = await res;
  expect(data).toEqual({ live: true });
  expect(res.loading).toBe(false);
  expect(res.data).toEqual({ live: true });
  expect(res.error).toBe(null);
  mock.restore();
});

it('await useFetch() waits for a slow request', async () => {
  cleanupGlobals();
  let resolveFetch: (r: Response) => void = () => {};
  const mock = mockFetch(() => new Promise<Response>(r => { resolveFetch = r; }));
  const pending = useFetch<string>('/api/await-slow');
  let settled = false;
  const awaited = (async () => { const d = await pending; settled = true; return d; })();
  await sleep(30);
  expect(settled).toBe(false);
  expect(pending.loading).toBe(true);
  resolveFetch(jsonResponse('finally'));
  expect(await awaited).toBe('finally');
  expect(pending.loading).toBe(false);
  expect(pending.data).toBe('finally');
  mock.restore();
});

it('useFetch.json resolves relative URLs and awaits cleanly', async () => {
  cleanupGlobals();
  (globalThis as any).__vesk_ssr_base_url = 'http://localhost:4173';
  const mock = mockFetch(() => jsonResponse({ rel: true }));
  const data = await useFetch.json<{ rel: boolean }>('/api/rel');
  expect(mock.calls[0].url).toBe('http://localhost:4173/api/rel');
  expect(data).toEqual({ rel: true });
  delete (globalThis as any).__vesk_ssr_base_url;
  mock.restore();
});

// ============================================================
// createResource (fn form) + into
// ============================================================
console.log('\n=== createResource — fn form + into ===');

it('writes resolved data into a tracked cell via createResource', async () => {
  cleanupGlobals();
  const cell = track<unknown[]>([]);
  createResource(async () => [{ id: 1 }], 'posts', cell);
  await waitFor(() => (get(cell as Tracked) as unknown[]).length === 1);
  expect(get(cell as Tracked)).toEqual([{ id: 1 }]);
});

// Summary
await asyncChain;
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const e of errors) {
    console.log(`  FAIL: ${e.name} — ${e.message}`);
  }
  process.exit(1);
} else {
  console.log('All resource tests passed!');
}
