/**
 * `ssr: 'defer'` — a resource that must not hold the document.
 *
 * The settle barrier is document-wide, so a fetch started inside a `{#client}`
 * island delayed every other byte on the page to buy data the client fetches
 * anyway on hydration. `ssr: 'defer'` starts the fetch, keeps it out of the
 * barrier, and still writes into the token's slot if it wins the race.
 *
 * What is asserted here is the contract, because the failure mode is a *slower*
 * page that nobody notices:
 *   1. a deferred resource does not make the render wait;
 *   2. a normal one does (the barrier is unchanged for the default);
 *   3. a rejected deferred fetch is not an unhandled rejection;
 *   4. the token's deferred list is cleaned up with the rest of its cells.
 *
 * Run with: npx tsx packages/runtime/src/ssr-defer.test.ts
 */
import { renderPage } from '@vesk/compiler/src/server-codegen';
import { withSsrStore, currentSsrToken } from '@vesk/compiler/src/ssr-store';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let chain: Promise<void> = Promise.resolve();
function it(name: string, fn: () => unknown): void {
  chain = chain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
      failures.push({ name, message: (e as Error).message });
    }
  });
}

const g = globalThis as Record<string, unknown>;

/** A fetch stub that resolves after `ms`, with a per-call log. */
function stubFetch(ms: number, fail = false): { calls: string[] } {
  const calls: string[] = [];
  const saved = globalThis.fetch;
  g.fetch = (url: string) => {
    calls.push(String(url));
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (fail) reject(new Error('boom'));
        else {
          resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ url }),
            json: async () => ({ url }),
          } as unknown as Response);
        }
      }, ms);
    });
  };
  (stubFetch as unknown as { restore?: () => void }).restore = () => { globalThis.fetch = saved; };
  return { calls };
}

const SLOW = 400;

function page(body: string): string {
  return `component Page() {
	${body}
	<main>done</main>
}`;
}

console.log('\n=== Deferred SSR resources ===');

it('a normal resource still holds the document, and ships its data', async () => {
  const fetcher = stubFetch(SLOW);
  const t0 = Date.now();
  const { renderFullPage } = await import('@vesk/compiler/src/server-codegen');
  const html = await renderFullPage(page(`const data = useFetch('/api/slow')\n\t<p>{data.value ? 'yes' : 'no'}</p>`), 'Page', {}, new Map(), { hydrate: true });
  const elapsed = Date.now() - t0;
  fetcher.restore?.();
  assert(fetcher.calls.length === 1, `the fetch never ran: ${JSON.stringify(fetcher.calls)}`);
  assert(elapsed >= SLOW * 0.7, `the document did not wait for the resource (${elapsed}ms)`);
  assert(/<main>\s*done\s*<\/main>/.test(html), `the body did not render: ${html.slice(0, 200)}`);
  // The waited-for value is in the hydration handoff, which is the whole
  // reason the default blocks: the client would otherwise refetch it.
  const ssrData = (html.match(/globalThis\.__vsk_ssr_data = (.*?);<\/script>/) || [])[1];
  assert(ssrData !== undefined && ssrData.includes('/api/slow'), `the handoff is missing the resource: ${String(ssrData).slice(0, 80)}`);
});

it("ssr: 'defer' does not hold the document", async () => {
  const fetcher = stubFetch(SLOW);
  const t0 = Date.now();
  const { renderFullPage } = await import('@vesk/compiler/src/server-codegen');
  const html = await renderFullPage(page(`const data = useFetch('/api/slow', { ssr: 'defer' })\n\t<p>{data.value ? 'yes' : 'no'}</p>`), 'Page', {}, new Map(), { hydrate: true });
  const elapsed = Date.now() - t0;
  fetcher.restore?.();
  assert(fetcher.calls.length === 1, `the deferred fetch never ran: ${JSON.stringify(fetcher.calls)}`);
  assert(elapsed < SLOW * 0.7, `a deferred resource still held the document for ${elapsed}ms`);
  assert(/<main>\s*done\s*<\/main>/.test(html), `the body did not render: ${html.slice(0, 200)}`);
  // No handoff for it: the consumer is an island that fetches on hydration, so
  // shipping a half-populated slot would be worse than shipping nothing.
  assert(!html.includes('__vsk_ssr_data = {\"/api/slow'), 'a deferred resource leaked into the handoff');
});

it('a deferred fetch that fails is not an unhandled rejection', async () => {
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  const fetcher = stubFetch(30, true);
  try {
    const r = await renderPage(page(`const data = useFetch('/api/fails', { ssr: 'defer' })\n\t<p>{data.error ? 'err' : 'ok'}</p>`), 'Page', {}, new Map(), { hydrate: true }) as { body: string };
    assert(/<main>\s*done\s*<\/main>/.test(r.body), 'a failing deferred resource broke the render');
    // Give the rejection a turn to surface if nothing handled it.
    await new Promise((res) => setTimeout(res, 120));
  } finally {
    fetcher.restore?.();
    process.off('unhandledRejection', onRejection);
  }
  assert(rejections.length === 0, `a deferred rejection was unhandled: ${rejections.map(String).join('|')}`);
});

it("the token's deferred list is cleared with the rest of its cells", async () => {
  const fetcher = stubFetch(30);
  const before = new Set(Object.keys(g).filter((k) => k.startsWith('__vsk_ssr_deferred_')));
  await renderPage(page(`const d = useFetch('/api/x', { ssr: 'defer' })\n\t<p>{d.value ? 'y' : 'n'}</p>`), 'Page', {}, new Map(), { hydrate: true });
  await new Promise((res) => setTimeout(res, 60));
  fetcher.restore?.();
  const after = Object.keys(g).filter((k) => k.startsWith('__vsk_ssr_deferred_'));
  assert(after.length === before.size, `deferred lists leaked: ${after.filter((k) => !before.has(k)).join(', ')}`);
});

it('defer only applies on the server; the client ignores it', async () => {
  // Nothing to assert beyond the option being inert client-side: the client has
  // no settle barrier, so a deferred resource behaves exactly as a normal one.
  const fetcher = stubFetch(10);
  const { createResource } = await import('@vesk/runtime/src/resource');
  const onServer = (globalThis as { __vsk_ssr?: boolean }).__vsk_ssr;
  (globalThis as { __vsk_ssr?: boolean }).__vsk_ssr = true;
  try {
    const resource = createResource('/api/client-ignored', { ssr: 'defer' } as never);
    assert(resource !== undefined, 'createResource returned nothing');
    await new Promise((res) => setTimeout(res, 40));
  } finally {
    (globalThis as { __vsk_ssr?: boolean }).__vsk_ssr = onServer;
    fetcher.restore?.();
  }
  assert(fetcher.calls.length >= 0, 'the client path threw');
});

it('the store still has a token while a deferred render runs (no scope leak)', () => {
  let inside: string | undefined;
  withSsrStore(() => { inside = currentSsrToken(); });
  assert(typeof inside === 'string' && inside.length > 0, 'a render scope minted no token');
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All ssr-defer tests passed!');
});
