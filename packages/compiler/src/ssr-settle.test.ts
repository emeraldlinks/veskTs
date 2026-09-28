/**
 * SSR settle-barrier tests.
 *
 * Regression: `settleSsrPromises` used to await a single snapshot of the
 * token's pending-promise array. The runtime only ever pushes onto that
 * array, and settling one promise can register another (an async component
 * body resumes after its first await and issues the next fetch). Returning
 * from the snapshot left that second promise unawaited, so its data landed
 * after the render took its snapshot and the page shipped with no
 * `__vsk_ssr_data` handoff — the client refetched what SSR already had.
 *
 * Run with: npx tsx packages/compiler/src/ssr-settle.test.ts
 */
import { renderFullPage } from '@vesk/compiler/src/server-codegen';

let passed = 0;
let failed = 0;
const errors: Array<{ name: string; message: string }> = [];
let asyncChain: Promise<void> = Promise.resolve();

function it(name: string, fn: () => unknown) {
  asyncChain = asyncChain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  \u2713 ${name}`);
    } catch (e) {
      failed++;
      console.log(`  \u2717 ${name}`);
      console.log(`    ${(e as Error).message}`);
      errors.push({ name, message: (e as Error).message });
    }
  });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function fetchReturning(payload: unknown) {
  return () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as unknown as Response);
}

function ssrDataOf(html: string): Record<string, unknown> | null {
  const match = html.match(/globalThis\.__vsk_ssr_data = (.*?);<\/script>/s);
  return match ? JSON.parse(match[1]) : null;
}

console.log('\n=== SSR settle — chained resources ===');

it('serializes a fetch that is only registered after the first one settles', async () => {
  const source = `async component App {
    const first = await useFetch('/api/first')
    const second = await useFetch('/api/second')
    <div>{first.n}{second.n}</div>
  }`;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    url.includes('first') ? fetchReturning({ n: 1 })() : fetchReturning({ n: 2 })()) as typeof fetch;
  let html: string;
  try {
    html = await renderFullPage(source, 'App', {});
  } finally {
    globalThis.fetch = savedFetch;
  }
  const data = ssrDataOf(html);
  assert(data, `no __vsk_ssr_data handoff in document: ${html.slice(0, 600)}`);
  const keys = Object.keys(data);
  assert(
    keys.some((k) => k.includes('/api/first')),
    `first fetch missing from handoff: ${JSON.stringify(keys)}`,
  );
  assert(
    keys.some((k) => k.includes('/api/second')),
    `chained second fetch missing from handoff: ${JSON.stringify(keys)}`,
  );
});

it('renders both chained fetch payloads in the body, not just the handoff', async () => {
  const source = `async component App {
    const first = await useFetch('/api/first')
    const second = await useFetch('/api/second')
    <div><span>{"F" + first.n}</span><span>{"S" + second.n}</span></div>
  }`;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    url.includes('first') ? fetchReturning({ n: 1 })() : fetchReturning({ n: 2 })()) as typeof fetch;
  let html: string;
  try {
    html = await renderFullPage(source, 'App', {});
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert(html.includes('F1'), `first payload not rendered: ${html.slice(0, 600)}`);
  assert(html.includes('S2'), `chained payload not rendered: ${html.slice(0, 600)}`);
});

it('keeps a single-fetch page fast — no extra round trips when nothing new registers', async () => {
  let calls = 0;
  const source = `component App {
    const posts = useFetch('/api/posts')
    <h1>{posts.loading ? 'Loading...' : 'Loaded'}</h1>
  }`;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    calls++;
    return fetchReturning([{ title: 'A' }])();
  }) as typeof fetch;
  let html: string;
  try {
    html = await renderFullPage(source, 'App', {});
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert(!html.includes('Loading...'), `body stuck in loading state: ${html.slice(0, 600)}`);
  assert(ssrDataOf(html), `handoff missing for single fetch: ${html.slice(0, 600)}`);
  assert(calls === 1, `expected exactly one fetch, got ${calls}`);
});

await asyncChain;
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const e of errors) console.log(`  FAIL: ${e.name} — ${e.message}`);
  process.exit(1);
}
console.log('All ssr-settle tests passed!');
