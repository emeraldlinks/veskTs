/**
 * PoC: does `globalThis.__vesk_ssr_fetch` actually remove the server-side
 * loopback HTTP hop?
 *
 * Answers the question by measuring, not by reading. Runs the SAME useFetch
 * three ways:
 *   A. server mode, no hook        → expect a real fetch
 *   B. server mode, hook installed → expect zero fetches
 *   C. client mode, hook installed → hook must be IGNORED (correctness)
 *
 * If C wrongly used the hook, installing it would leak server data to the
 * browser — the single most dangerous bug in this design.
 */
import { useFetch } from './packages/runtime/src/resource.ts';

function cleanup() {
  for (const k of [
    '__vsk_ssr', '__vsk_ssr_token', '__vsk_ssr_promises',
    '__vsk_fetch_inflight', '__vsk_fetch_registry', '__vsk_fetch_cache',
    '__vsk_ssr_failure_cache', '__vesk_ssr_base_url',
    '__vesk_ssr_fetch', '__vesk_request',
    // MISSING from the upstream cleanup list in resource.test.ts:86-96. Without
    // this, a previous test's handoff data satisfies the next resource instantly
    // and it never fetches at all — the counts all read 0.
    '__vsk_ssr_data',
  ]) delete (globalThis as any)[k];
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

let realFetchCalls = 0;
let hookCalls = 0;

async function settle(res: any) {
  const token = (globalThis as any).__vsk_ssr_token;
  const key = token ? `__vsk_ssr_promises_${token}` : '__vsk_ssr_promises';
  const ps = (globalThis as any)[key] as Promise<unknown>[] | undefined;
  if (ps) await Promise.allSettled([...ps]);
  return res;
}

const results: Record<string, unknown> = {};
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${detail}`); }
}

console.log('\n\x1b[1mPoC — __vesk_ssr_fetch short-circuit\x1b[0m\n');

// ── A. server, no hook → must hit real fetch ────────────────────────────────
cleanup();
realFetchCalls = 0; hookCalls = 0;
(globalThis as any).__vsk_ssr = true;
(globalThis as any).__vsk_ssr_token = 'poc-a';
(globalThis as any).__vesk_ssr_base_url = 'http://internal';
globalThis.fetch = (async () => { realFetchCalls++; return json({ via: 'real-fetch' }); }) as any;

await settle(useFetch('/api/posts'));
results.A = { realFetchCalls, hookCalls };
check('A: without the hook, useFetch performs a real fetch',
  realFetchCalls === 1, `got ${realFetchCalls}`);

// ── B. server, hook installed → zero network ────────────────────────────────
cleanup();
realFetchCalls = 0; hookCalls = 0;
(globalThis as any).__vsk_ssr = true;
(globalThis as any).__vsk_ssr_token = 'poc-b';
(globalThis as any).__vesk_ssr_base_url = 'http://internal';
globalThis.fetch = (async () => { realFetchCalls++; return json({ via: 'real-fetch' }); }) as any;
(globalThis as any).__vesk_ssr_fetch = async (url: string) => {
  hookCalls++;
  return json({ via: 'hook', url });
};

await settle(useFetch('/api/posts'));
results.B = { realFetchCalls, hookCalls };
check('B: with the hook, zero real fetches (loopback removed)',
  realFetchCalls === 0, `real=${realFetchCalls}`);
check('B: the hook was actually invoked', hookCalls === 1, `hook=${hookCalls}`);

// ── B2. the hook's data reaches the SSR handoff ─────────────────────────────
const handoff = (globalThis as any).__vsk_ssr_data;
check('B2: hook data lands in the SSR handoff so the client skips refetch',
  handoff?.['/api/posts']?.via === 'hook', JSON.stringify(handoff));

// ── B3. one hook can serve many resources in the same render ───────────────
cleanup();
realFetchCalls = 0; hookCalls = 0;
(globalThis as any).__vsk_ssr = true;
(globalThis as any).__vsk_ssr_token = 'poc-b3';
(globalThis as any).__vesk_ssr_fetch = async () => { hookCalls++; return json({ n: hookCalls }); };

await settle(useFetch('/api/a'));
await settle(useFetch('/api/b'));
check('B3: hook serves every resource in one render', hookCalls === 2, `hook=${hookCalls}`);

// ── C. client must IGNORE the hook ──────────────────────────────────────────
cleanup();
realFetchCalls = 0; hookCalls = 0;
delete (globalThis as any).__vsk_ssr;                 // client mode
(globalThis as any).__vesk_ssr_fetch = async () => { hookCalls++; return json({ leaked: true }); };
globalThis.fetch = (async () => { realFetchCalls++; return json({ via: 'real-fetch' }); }) as any;

const clientRes = useFetch('/api/posts');
await Promise.race([
  clientRes,
  new Promise((r) => setTimeout(r, 300)),
]);
check('C: client IGNORES the hook (no server data leak)',
  hookCalls === 0 && realFetchCalls === 1,
  `hook=${hookCalls} real=${realFetchCalls}`);

cleanup();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);