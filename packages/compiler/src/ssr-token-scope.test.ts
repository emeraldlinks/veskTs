/**
 * Request-scoped SSR token tests.
 *
 * Regression: the SSR handoff token lived on `globalThis` and every render
 * adopted/reused/deleted it process-wide. Two concurrent requests could adopt
 * the same token, and whichever finished first deleted the other's
 * `__vsk_ssr_data_<token>` slot — so the second page serialized an empty
 * handoff and shipped without its `ssr-data.js` script. The symptom was
 * intermittent (`/async` view-source had 0 ssr-data refs) and only appeared
 * under real HTTP concurrency.
 *
 * The fix backs `globalThis.__vsk_ssr_token` with an AsyncLocalStorage store,
 * so the synchronous reads in generated code and in the runtime resolve
 * per-request. Three properties are load-bearing and all are asserted here:
 *
 *   1. concurrent scopes get distinct tokens and cannot delete each other's
 *      slot (the original bug);
 *   2. the global is a *configurable accessor* — any surviving
 *      `delete globalThis.__vsk_ssr_token` removes the property definition and
 *      silently reverts the process to a process-global token;
 *   3. the slot reaper must not collect a slot a live render still owns.
 *
 * Run with: npx tsx packages/compiler/src/ssr-token-scope.test.ts
 */
import { renderFullPage, renderPageStream } from '@vesk/compiler/src/server-codegen';
import {
  withSsrStore,
  withSsrStoreOf,
  createSsrStore,
  currentSsrToken,
  resetSsrToken,
  keepSsrSlot,
  dropSsrSlot,
  isSsrSlotLive
} from '@vesk/compiler/src/ssr-store';

let passed = 0;
let failed = 0;
const errors: Array<{ name: string; message: string }> = [];
let asyncChain: Promise<void> = Promise.resolve();

function it(name: string, fn: () => unknown) {
  asyncChain = asyncChain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
      errors.push({ name, message: (e as Error).message });
    }
  });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg} (expected ${String(expected)}, got ${String(actual)})`);
}

const g = globalThis as any;

function ssrDataOf(html: string): Record<string, unknown> | null {
  const match = html.match(/globalThis\.__vsk_ssr_data = (.*?);<\/script>/s);
  return match ? JSON.parse(match[1]) : null;
}

/** A fetch that resolves after `ms`, so renders can be overlapped on purpose. */
function slowFetch(payload: unknown, ms: number) {
  return (url: string) =>
    new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve({
          ok: true,
          json: () => Promise.resolve(typeof payload === 'function' ? (payload as (u: string) => unknown)(url) : payload),
        } as unknown as Response);
      }, ms);
    });
}

async function withFetch<T>(fn: () => Promise<T>, impl: typeof fetch): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

console.log('\n=== Request-scoped SSR token ===');

it('the token global is an accessor, not a plain data property', () => {
  const d = Object.getOwnPropertyDescriptor(globalThis, '__vsk_ssr_token');
  assert(!!d, '__vsk_ssr_token is not defined on globalThis at all');
  assert(typeof d!.get === 'function', '__vsk_ssr_token has no getter — writes would be process-global again');
  assert(typeof d!.set === 'function', '__vsk_ssr_token has no setter — scopes could not claim a token');
});

it('reads the token only inside a render scope, and never leaks a write out of one', () => {
  assertEq(g.__vsk_ssr_token, undefined, 'token should read undefined outside a render scope');
  g.__vsk_ssr_token = 'written-outside-scope';
  assertEq(g.__vsk_ssr_token, undefined, 'a write outside a scope must not become the next render token');
  const inScope = withSsrStore(() => currentSsrToken());
  assert(typeof inScope === 'string' && inScope.length > 0, 'withSsrStore did not mint a token');
  assertEq(g.__vsk_ssr_token, undefined, 'token leaked past the end of its scope');
});

it('gives every scope its own token and isolates their data slots', () => {
  const seen: Array<string | undefined> = [];
  const slots: Array<Record<string, unknown>> = [];
  const run = (id: string) =>
    withSsrStore(() => {
      const token = currentSsrToken();
      seen.push(token);
      g[`__vsk_ssr_data_${token}`] = { id };
      slots.push(g[`__vsk_ssr_data_${token}`]);
      return token;
    });
  const a = run('a');
  const b = run('b');
  assert(a !== b, `two scopes adopted the same token: ${a}`);
  assertEq(slots[0].id, 'a', "scope A's slot was clobbered by scope B");
  assertEq(slots[1].id, 'b', "scope B's slot was clobbered by scope A");
  delete g[`__vsk_ssr_data_${a}`];
  delete g[`__vsk_ssr_data_${b}`];
});

it('re-entrant withSsrStore reuses the outer token instead of nesting a second scope', () => {
  withSsrStore(() => {
    const outer = currentSsrToken();
    withSsrStore(() => {
      assertEq(currentSsrToken(), outer, 'nested withSsrStore minted a second token for one request');
    });
  });
});

it('withSsrStoreOf keeps one token across separate scopes (streaming)', () => {
  const store = createSsrStore();
  const first = withSsrStoreOf(store, () => currentSsrToken());
  const second = withSsrStoreOf(store, () => currentSsrToken());
  assertEq(first, store.token, 'first pull did not see the pinned store token');
  assertEq(second, first, 'a later pull saw a different token than the earlier one');
});

it('resetSsrToken mints a fresh token and drops the previous slot claim', () => {
  withSsrStore(() => {
    const first = currentSsrToken()!;
    keepSsrSlot(first);
    assert(isSsrSlotLive(first), 'keepSsrSlot did not claim the slot');
    const second = resetSsrToken();
    assert(second !== first, 'resetSsrToken reused the old token — a data-nav route could settle into the previous one');
    assert(!isSsrSlotLive(first), 'the replaced token is still claiming a slot');
    dropSsrSlot(second);
  });
});

it('slot liveness: keep/drop is observable and defaults to free', () => {
  assert(!isSsrSlotLive('never-claimed'), 'an unclaimed token must not count as live');
  keepSsrSlot('claimed');
  assert(isSsrSlotLive('claimed'), 'keepSsrSlot did not register');
  dropSsrSlot('claimed');
  assert(!isSsrSlotLive('claimed'), 'dropSsrSlot did not release');
});

it('a duplicate module copy shares one request-scope state', async () => {
  // The server bundle reached this module through two specifiers for a while,
  // so the process ran two copies: two AsyncLocalStorages and two liveness
  // maps. A scope opened by the copy the generated handler imports was then
  // invisible to the copy `renderFullPage` reaps with, which read every
  // concurrent request's slot as abandoned and deleted it — the page rendered
  // but shipped without its ssr-data script. The state is pinned to
  // globalThis precisely so a second copy is harmless; simulate one.
  const copy = (await import('@vesk/compiler/src/ssr-store?duplicate-copy=1')) as typeof import('@vesk/compiler/src/ssr-store');
  assert(copy !== (await import('@vesk/compiler/src/ssr-store')), 'the simulated duplicate resolved to the same module instance');

  const token = withSsrStore(() => {
    const own = currentSsrToken()!;
    // The other copy must see this scope, and vice versa.
    assertEq(copy.currentSsrToken(), own, 'a duplicate module copy does not see the live request scope');
    keepSsrSlot(own);
    assert(copy.isSsrSlotLive(own), 'a duplicate module copy does not see a live slot claim');
    // The scope itself holds one claim, so a single drop must not free the
    // slot — claims are refcounted and nested renders add their own.
    dropSsrSlot(own);
    assert(copy.isSsrSlotLive(own), 'a duplicate module copy lost the scope-level claim after one release');
    copy.dropSsrSlot(own);
    assert(!copy.isSsrSlotLive(own), 'a duplicate module copy does not see a released slot claim');
    assertEq(copy.withSsrStore(() => copy.currentSsrToken()), own, 'a duplicate module copy minted a second token for one request');
    return own;
  });
  assert(typeof token === 'string' && token.length > 0, 'withSsrStore did not mint a token');
  assert(!copy.isSsrSlotLive(token), 'the scope released its claim on settle');
});

console.log('\n=== Concurrent renders keep their own handoff ===');

it('two overlapping renderFullPage calls each ship their own ssr-data', async () => {
  // The slow render is started first and finishes last, so the fast one
  // completes (and cleans up) while the slow one is still mid-flight — the
  // exact interleaving that used to wipe the slow render's data slot.
  const source = `component App {
    const data = useFetch('/api/item')
    <h1>{data.loading ? 'Loading...' : data.value}</h1>
  }`;
  const [slowHtml, fastHtml] = await withFetch(
    () =>
      Promise.all([
        renderFullPage(source, 'App', { id: 'slow' }),
        renderFullPage(source, 'App', { id: 'fast' }),
      ]).then((r) => r as unknown as [string, string]),
    slowFetch((url: string) => ({ value: url }), 40) as unknown as typeof fetch
  );
  const slowData = ssrDataOf(slowHtml);
  const fastData = ssrDataOf(fastHtml);
  assert(slowData, `the slow render lost its handoff: ${slowHtml.slice(0, 800)}`);
  assert(fastData, `the fast render lost its handoff: ${fastHtml.slice(0, 800)}`);
  assert(
    Object.keys(slowData).length > 0,
    'the slow render serialized an empty handoff — its data slot was deleted by the concurrent render',
  );
  assert(
    Object.keys(fastData).length > 0,
    'the fast render serialized an empty handoff — its data slot was deleted by the concurrent render',
  );
});

it('many concurrent renders all ship a handoff, and none serialize a stranger payload', async () => {
  // The fetch URL is derived from props so every render has its own resource
  // key — a shared key would dedupe into one in-flight promise and the test
  // could not tell a clobbered slot from a legitimately shared one.
  const source = `component App(props) {
    const data = useFetch('/api/who/' + props.who)
    <p>{data.value}</p>
  }`;
  const N = 24;
  const htmls = await withFetch(
    () => Promise.all(Array.from({ length: N }, (_, i) => renderFullPage(source, 'App', { who: `w${i}` }))),
    slowFetch((url: string) => ({ who: url }), 5) as unknown as typeof fetch
  );
  let withData = 0;
  for (let i = 0; i < htmls.length; i++) {
    const data = ssrDataOf(htmls[i]);
    if (!data || Object.keys(data).length === 0) continue;
    withData++;
    const values = Object.values(data).map((v) => JSON.stringify(v));
    assert(
      values.some((v) => v.includes(`/api/who/w${i}`)),
      `render ${i} serialized only foreign payloads: ${values.join(' | ')}`,
    );
  }
  assertEq(withData, N, `${N - withData}/${N} concurrent renders shipped without an ssr-data script`);
});

it('a live render slot survives the reaper that bounds abandoned slots', async () => {
  // 40+ concurrent renders is past the reaper's cap. Under a cap that ignored
  // ownership it would delete a *live* slot, which is the same empty-handoff
  // bug triggered by load instead of interleaving.
  const source = `component App {
    const data = useFetch('/api/n')
    <p>{data.value}</p>
  }`;
  const N = 48;
  const htmls = await withFetch(
    () => Promise.all(Array.from({ length: N }, (_, i) => renderFullPage(source, 'App', { n: i }))),
    slowFetch((url: string) => ({ n: url }), 15) as unknown as typeof fetch
  );
  const empty = htmls.filter((h) => {
    const d = ssrDataOf(h);
    return !d || Object.keys(d).length === 0;
  });
  assertEq(empty.length, 0, `${empty.length}/${N} renders shipped an empty handoff — the reaper collected a live slot`);
});

it('a 48-request deduped burst on one resource key ships 48 handoffs', async () => {
  // This is the shape of the real /async failure: 48 concurrent requests, one
  // shared resource key. The first render starts the fetch, the rest dedupe
  // onto it, and all 48 documents have to serialize their own handoff. It is
  // the case that broke when the server bundle carried two copies of the
  // request-scope store: every scope was invisible to the reaper, which
  // deleted live slots until 7 of the 48 documents shipped with no ssr-data
  // script while their page bodies looked perfectly fine.
  const source = `component App(props) {
    const data = useFetch('/api/shared')
    <p>{data.value}</p>
  }`;
  const N = 48;
  const htmls = await withFetch(
    () => Promise.all(Array.from({ length: N }, (_, i) => renderFullPage(source, 'App', { i }))),
    slowFetch({ value: 'shared payload' }, 25) as unknown as typeof fetch
  );
  const empty = htmls.filter((h) => {
    const d = ssrDataOf(h);
    return !d || Object.keys(d).length === 0;
  });
  assertEq(empty.length, 0, `${empty.length}/${N} deduped renders shipped an empty handoff — a shared resource key must still give every document its own handoff`);
});

console.log('\n=== Streaming renders ===');

it('renderPageStream keeps one token across yields and serializes the handoff', async () => {
  const source = `component App {
    const data = useFetch('/api/stream')
    <p>{data.value}</p>
  }`;
  const html = await withFetch(async () => {
    let out = '';
    for await (const chunk of renderPageStream(source, 'App', {}, new Map(), { hydrate: true })) {
      out += chunk;
    }
    return out;
  }, slowFetch((url: string) => ({ v: url }), 5) as unknown as typeof fetch);
  const data = ssrDataOf(html);
  assert(data && Object.keys(data).length > 0, `stream lost its handoff across yields: ${html.slice(0, 800)}`);
});

it('a streamed render does not orphan its data slot', async () => {
  const source = `component App {
    const data = useFetch('/api/leak')
    <p>{data.value}</p>
  }`;
  const before = Object.keys(g).filter((k) => k.startsWith('__vsk_ssr_data_')).length;
  await withFetch(async () => {
    for await (const _ of renderPageStream(source, 'App', {}, new Map(), { hydrate: true })) { void _; }
  }, slowFetch({ v: 1 }, 1) as unknown as typeof fetch);
  const after = Object.keys(g).filter((k) => k.startsWith('__vsk_ssr_data_')).length;
  assert(after <= before, `streamed render leaked data slots: ${before} -> ${after}`);
});

await asyncChain;
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const e of errors) console.log(`  FAIL: ${e.name} — ${e.message}`);
  process.exit(1);
}
console.log('All ssr-token-scope tests passed!');
