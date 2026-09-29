/**
 * The production error-reporting seam.
 *
 * Production never leaks a stack trace to the client (the right default), which
 * used to leave an adopter two bad options: show the stack, or replace the
 * adapter's error handling. This is the supported middle — a plugin's `onError`
 * in dev, `_events.ts`'s `onError` in production — and it is useless without a
 * build id, so the manifest carries one (the asset map's own fingerprint).
 *
 * The properties that matter are the failure modes: a hook that throws must not
 * become a second failure, one bad hook must not silence the rest, and one
 * error object must not be reported twice.
 *
 * Run with: npx tsx packages/adapter/src/error-report.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearErrorReporters, errorReporterCount, registerErrorHooks, registerErrorReporter, reportServerError } from '@vesk/adapter/src/error-report';
import { executeError } from '@vesk/adapter/src/events';
import { buildEventsEntry } from '@vesk/adapter/src/events';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Serialized: every case is async, and a detached one would print its failure
// after the summary — a suite that reports 9 passed and then throws.
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

console.log('\n=== Error reporting seam ===');

it('registers plugin hooks and ignores plugins without one', async () => {
  clearErrorReporters();
  assert(errorReporterCount() === 0, 'hooks leaked from a previous test');
  const seen: unknown[] = [];
  registerErrorHooks([
    { name: 'no-hook' } as never,
    { name: 'sentry', onError: (e) => { seen.push(e); } } as never,
  ]);
  assert(errorReporterCount() === 1, `expected one hook, got ${errorReporterCount()}`);
  await reportServerError(new Error('boom'), { target: 'node' });
  assert(seen.length === 1, 'the registered hook was not called');
  clearErrorReporters();
});

it('a hook that throws is caught, and the other hooks still run', async () => {
  clearErrorReporters();
  const seen: string[] = [];
  registerErrorReporter(() => { throw new Error('the reporter is down'); });
  registerErrorReporter(() => { seen.push('second'); });
  const origError = console.error;
  console.error = () => {};
  try {
    await reportServerError(new Error('page failed'), { target: 'node' });
  } finally {
    console.error = origError;
  }
  assert(seen.length === 1, 'a throwing hook stopped the remaining hooks');
  clearErrorReporters();
});

it('the context carries route, status, target and the build id', async () => {
  clearErrorReporters();
  let ctx: Record<string, unknown> | null = null;
  registerErrorReporter((_e, c) => { ctx = c as unknown as Record<string, unknown>; });
  await reportServerError(new Error('kaput'), {
    url: 'https://example.test/blog/x?a=1',
    routePath: '/blog/[slug]',
    target: 'node',
    status: 500,
    durationMs: 12,
    buildConfig: { buildId: 'abc123', veskVersion: '0.2.48' },
  });
  const c = ctx as unknown as Record<string, unknown>;
  assert(c.url === 'https://example.test/blog/x?a=1', `url missing: ${JSON.stringify(c)}`);
  assert(c.routePath === '/blog/[slug]', 'route pattern missing');
  assert(c.target === 'node' && c.status === 500, 'target/status missing');
  assert(c.durationMs === 12, 'duration missing');
  assert(c.buildId === 'abc123', 'build id missing — a report cannot be tied to a deploy');
  assert(c.version === '0.2.48', 'vesk version missing');
  assert(c.errorName === 'Error' && String(c.message) === 'kaput', 'error details missing');
  clearErrorReporters();
});

it('one error object is reported once, even if two paths catch it', async () => {
  clearErrorReporters();
  let calls = 0;
  registerErrorReporter(() => { calls++; });
  const err = new Error('same failure');
  await reportServerError(err, { target: 'node' });
  await reportServerError(err, { target: 'node' });
  assert(calls === 1, `the same error was reported ${calls} times`);
  // A different error is a different report.
  await reportServerError(new Error('different'), { target: 'node' });
  assert(calls === 2, 'a second, distinct error was swallowed');
  clearErrorReporters();
});

it('a non-Error value reports without throwing', async () => {
  clearErrorReporters();
  let seen: unknown = null;
  registerErrorReporter((e) => { seen = e; });
  await reportServerError('just a string', { target: 'edge' });
  assert(seen === 'just a string', 'a non-Error throwable was not passed through');
  clearErrorReporters();
});

it('_events.ts onError is compiled into the server events module', async () => {
  // Production has no plugin objects, so this is the seam that actually ships.
  const dir = mkdtempSync(join(tmpdir(), 'vesk-events-'));
  const src = join(dir, '_events.ts');
  writeFileSync(src, 'export async function onError(err, ctx) { globalThis.__seen = [err, ctx] }\n');
  const code = buildEventsEntry(src);
  assert(code.includes("'onError'") || code.includes('onError'), 'onError is not part of the compiled handlers');
  assert(code.includes('export const onError'), 'onError is not re-exported for the server');
  assert(code.includes('executeStart') && code.includes('executeRequest'), 'the existing lifecycle handlers disappeared');
});

it('executeError calls _events onError and survives one that throws', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const calls: unknown[] = [];
    await executeError(new Error('e'), { url: '/x' }, { onError: (e, c) => { calls.push([e, c]); } });
    assert(calls.length === 1, '_events onError was not called');

    let reached = false;
    await executeError(new Error('e2'), {}, {
      onError: () => { throw new Error('reporter down'); },
    });
    reached = true;
    assert(reached, 'executeError propagated a throwing hook');
  } finally {
    console.error = origError;
  }
});

it('executeError is a no-op when the app has no onError', async () => {
  await executeError(new Error('e'), {}, null);
  await executeError(new Error('e'), {}, {});
});

it('reporting with no hooks registered is safe and silent', async () => {
  clearErrorReporters();
  const origError = console.error;
  console.error = () => {};
  try {
    await reportServerError(new Error('nobody listening'), { target: 'node' });
  } finally {
    console.error = origError;
  }
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All error-report tests passed!');
});
