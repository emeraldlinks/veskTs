/**
 * SSR handoff under concurrency (HTTP, no browser).
 *
 * Regression: a page that fetches during SSR (`/async` → `useFetch('/api/posts')`)
 * shipped without its `<script src="/ssr-data.js?t=…">` when several requests
 * overlapped. The page *body* rendered correctly — the multi-pass renderer
 * reads the process-global data store — so the only symptom was a client with
 * no hydration payload, which meant a refetch (or a blank region) after load.
 *
 * Root cause of the surviving failures: the production server bundle carried
 * two copies of the request-scope store (one reached through a specifier of
 * its own instead of through server-codegen). Each copy had its own
 * AsyncLocalStorage and its own liveness map, so the scope a request opened was
 * invisible to the reaper, which then deleted the data slots of requests that
 * were still rendering.
 *
 * The gate is 48 simultaneous requests for one shared resource key — the shape
 * that triggered it: past the reaper's 40-slot cap, and every request after the
 * first dedupes onto the same in-flight fetch.
 *
 * Usage: node tests/ssr-handoff-concurrency-test.mjs
 * Requires the e2e servers (scripts/e2e-setup.js): prod on :3099, dev on :3002.
 * Env: N (default 48), PROD_PORT, DEV_PORT.
 */
const N = parseInt(process.env.N || '48', 10);
const PROD = process.env.PROD_BASE || `http://127.0.0.1:${process.env.PROD_PORT || 3099}`;
const DEV = process.env.DEV_BASE || `http://127.0.0.1:${process.env.DEV_PORT || 3002}`;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

const DATA_SCRIPT = /ssr-data\.js\?t=/;

/**
 * Fire N simultaneous requests and classify each response. A response without
 * the handoff script is 66 bytes shorter than one with it, so the byte-size
 * histogram is a compact way to show the failures.
 */
async function burst(base, label) {
  console.log(`\n=== ${label} — ${N} concurrent ${base}/async ===`);
  // Warm the route first: the first request pays the module-import cost, and a
  // cold import race is a different failure than the one under test.
  await fetch(base + '/async').then((r) => r.text()).catch(() => {});

  const bodies = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(base + '/async').then((r) => r.text(), (e) => `FETCH-ERROR ${e.message}`)),
  );

  const errors = bodies.filter((b) => b.startsWith('FETCH-ERROR'));
  const withData = bodies.filter((b) => DATA_SCRIPT.test(b));
  const without = bodies.filter((b) => !DATA_SCRIPT.test(b) && !b.startsWith('FETCH-ERROR'));
  const sizes = {};
  for (const b of bodies) sizes[b.length] = (sizes[b.length] || 0) + 1;
  console.log(`  size histogram: ${JSON.stringify(sizes)}`);

  assert(errors.length === 0, `every request completed (${errors.length} transport errors${errors.length ? ': ' + errors[0] : ''})`);
  assert(
    withData.length === N - errors.length,
    `all ${withData.length} responses carried the ssr-data handoff` +
      (without.length ? ` — ${without.length} shipped without it: ${without.map((b) => b.length + 'b').join(', ')}` : ''),
  );
  // When a response does lose the handoff, its body still has to be complete:
  // that is exactly what made this bug invisible in screenshots and only showed
  // up in the client, as a refetch or an empty region after load.
  if (without.length > 0) {
    const incomplete = without.filter((b) => !b.includes('Async Demo') || !b.includes('Powered by Vesk'));
    assert(
      incomplete.length === 0,
      `the ${without.length} data-less responses were otherwise complete pages (body rendered, handoff lost)`,
    );
  } else {
    passed++;
    console.log('  \u2713 no data-less response to inspect (every handoff survived)');
  }

  // And the payloads themselves must be per-request: no foreign data leaking in.
  const payloads = [];
  for (const b of withData) {
    const m = b.match(/ssr-data\.js\?t=([0-9a-f]+)/);
    if (m) payloads.push(m[1]);
  }
  assert(
    new Set(payloads).size === payloads.length,
    `every response pointed at its own payload url (${new Set(payloads).size}/${payloads.length} distinct)`,
  );
}

console.log('\n=== SSR handoff under concurrency ===');
await burst(PROD, 'production');
await burst(DEV, 'dev');

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
