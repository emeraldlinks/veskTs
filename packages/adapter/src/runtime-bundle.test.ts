/**
 * Server-runtime bundle: one copy of the request-scope store, and no key
 * collision with the per-request data slots.
 *
 * Regression (the "0/48 concurrent requests ship an ssr-data script" bug):
 * the bundle entry used to pull `withSsrStore` in through its own
 * `@vesk/compiler/src/ssr-store` specifier, which resolved to a *different*
 * file than the one `server-render` imports. esbuild happily bundles both, so
 * the process ended up with two module copies — two AsyncLocalStorages, two
 * liveness maps, and the second copy's `__vsk_ssr_token` accessor shadowing the
 * first. A request's scope was then invisible to the reaper, which read every
 * concurrent slot as abandoned and deleted it: the page body rendered fine (the
 * multi-pass renderer reads the flat global) but the document serialized an
 * empty handoff and shipped no hydration data script.
 *
 * Second regression: the CSP payload store was named `__vsk_ssr_data_store`,
 * which matches the `__vsk_ssr_data_<token>` prefix the reaper sweeps, so the
 * reaper could wipe every pending `/ssr-data.js` payload.
 *
 * Run with: npx tsx packages/adapter/src/runtime-bundle.test.ts
 */
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleRuntime } from '@vesk/adapter/src/runtime-bundle';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

console.log('\n=== Server runtime bundle ===');

const appDir = resolve(new URL('../../../test-app', import.meta.url).pathname);
// Inside the app on purpose: a real build writes its bundle into the app's
// output directory, which is what makes a bare `@vesk/...` specifier in the
// entry resolve to the app's installed package instead of the workspace one.
const outDir = resolve(appDir, '.vesk', '.runtime-bundle-test');
let bundle = '';
try {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'server'), { recursive: true });
  const runtimePath = await bundleRuntime(appDir, outDir);
  bundle = readFileSync(runtimePath, 'utf-8');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
    failures.push({ name, message: (e as Error).message });
  }
}

it('bundles the request-scope store exactly once', () => {
  const copies = countOf(bundle, '"__vsk_ssr_token"');
  assert(
    copies === 1,
    `the bundle holds ${copies} copies of the SSR request-scope store — a duplicate copy ` +
      'means a second AsyncLocalStorage and a second liveness map, so concurrent requests ' +
      'lose their data slots. Import it through server-codegen instead of its own specifier.',
  );
});

it('exports withSsrStore for the generated request handlers', () => {
  assert(
    /withSsrStore/.test(bundle),
    'the bundle no longer exports withSsrStore, so generated SSR functions cannot open a request scope',
  );
});

it('keeps the CSP payload store out of the per-request slot namespace', () => {
  assert(
    bundle.includes('__vsk_ssr_payload_store'),
    'the /ssr-data.js payload store is not stored under __vsk_ssr_payload_store',
  );
  assert(
    !bundle.includes('__vsk_ssr_data_store'),
    'the payload store is back under __vsk_ssr_data_store, which the compiler\'s slot reaper sweeps ' +
      '(a reaped payload store turns a served page\'s /ssr-data.js into a 404)',
  );
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All runtime-bundle tests passed!');
