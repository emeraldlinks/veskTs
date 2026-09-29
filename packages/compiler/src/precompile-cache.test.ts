/**
 * `precompileFile` memoization.
 *
 * Every generated SSR function precompiles its page, its layout chain, its
 * error boundary and every shared component, so a build compiled the same
 * `layout.vsk` once per route and each shared `components/*.vsk` once per route
 * that used it — on the 28-route test-app that was 25 root-layout compiles and
 * 28 compiles of one shared counter (117 calls, 37 distinct files), and it grows
 * as routes × shared files. The plan is a pure function of (source, path), so
 * one compile per file per build is enough.
 *
 * The load-bearing part is that the memo is keyed on the SOURCE, not just the
 * path: the dev server rebuilds in-process, and a stale plan would ship
 * yesterday's component.
 *
 * Run with: npx tsx packages/compiler/src/precompile-cache.test.ts
 */
import { precompileFile, clearPrecompileCache } from '@vesk/compiler/src/precompile';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
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

const SOURCE = `component Counter(props) {
	const &[count] = track(props.start ?? 0)
	<button onclick={() => set(count, get(count) + 1)}>{count}</button>
}
`;

console.log('\n=== precompileFile memo ===');

it('the same file compiled twice yields one plan object (memo hit)', () => {
  clearPrecompileCache();
  const first = precompileFile(SOURCE, '/app/does-not-exist/Counter.vsk');
  const second = precompileFile(SOURCE, '/app/does-not-exist/Counter.vsk');
  assert(first === second, 'the second precompile of an unchanged file recompiled instead of reusing the plan');
});

it('a changed source recompiles rather than serving the stale plan', () => {
  clearPrecompileCache();
  const path = '/app/does-not-exist/Counter.vsk';
  const before = precompileFile(SOURCE, path);
  const changed = SOURCE.replace('+ 1', '+ 2');
  const after = precompileFile(changed, path);
  assert(before !== after, 'an edited file was served the previous plan — the dev watcher would ship stale code');
  assert(
    JSON.stringify(after).includes('+ 2') && !JSON.stringify(after).includes('+ 1'),
    'the recompiled plan does not carry the new source',
  );
});

it('distinct paths keep distinct plans', () => {
  clearPrecompileCache();
  const a = precompileFile(SOURCE, '/app/a/Counter.vsk');
  const b = precompileFile(SOURCE, '/app/b/Counter.vsk');
  assert(a !== b, 'two different files shared one plan — a route could serve another route\'s component');
  assert(JSON.stringify(a) === JSON.stringify(b), 'the path leaked into the plan for the same source');
});

it('a source with no path is never memoized', () => {
  clearPrecompileCache();
  const a = precompileFile(SOURCE);
  const b = precompileFile(SOURCE);
  assert(a !== b, 'a pathless precompile was memoized under a shared key');
  assert(JSON.stringify(a) === JSON.stringify(b), 'pathless precompiles of the same source disagree');
});

it('clearPrecompileCache forces the next call to compile', () => {
  const path = '/app/does-not-exist/Counter.vsk';
  const before = precompileFile(SOURCE, path);
  clearPrecompileCache();
  const after = precompileFile(SOURCE, path);
  assert(before !== after, 'clearPrecompileCache did not drop the memo');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All precompile-cache tests passed!');
