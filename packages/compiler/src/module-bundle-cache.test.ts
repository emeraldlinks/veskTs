/**
 * Module-bundle caching (the build-side of `readSsrSource` / `collectModuleBundled`).
 *
 * A docs-style app where 26 pages import one content module — or any app whose
 * layout imports an icon barrel of 1,600 modules — read, parsed, stripped and
 * re-transpiled that whole closure once per page, because every `.vsk` compile
 * builds its own `ModuleCollector`. Measured on vesk-doc: 11,235 reads of 1,620
 * distinct files, and 51s of a 95s build inside `collectModuleBundle`.
 *
 * The caches are keyed by path and validated by mtime, so the two properties
 * that matter are: repeats are free, and an edited file is re-read.
 *
 * Run with: npx tsx packages/compiler/src/module-bundle-cache.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSsrSource, collectModuleBundled } from '@vesk/compiler/src/module-imports';
import type { ModuleCollector } from '@vesk/compiler/src/module-imports';

/** Each `.vsk` compile builds its own collector — that is the whole point. */
function freshCollector(): ModuleCollector {
  return { keysByAbs: new Map(), modules: [] };
}

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

/** A fixture dir with a shared module that two "pages" would import. */
function fixture(): { dir: string; shared: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-modcache-'));
  const shared = join(dir, 'content.ts');
  writeFileSync(shared, 'export const GUIDE = { title: "one" };\n');
  return { dir, shared };
}

/** Force a distinct mtime so a cache keyed on mtime cannot be fooled. */
function touch(path: string, seconds: number): void {
  const when = new Date(Date.now() + seconds * 1000);
  utimesSync(path, when, when);
}

console.log('\n=== Module bundle cache ===');

it('readSsrSource serves the current text of a file', () => {
  const { shared } = fixture();
  const first = readSsrSource(shared);
  assert(first !== null, 'readSsrSource returned null for a readable file');
  assert(first.raw.includes('"one"'), `unexpected first read: ${first.raw.slice(0, 80)}`);
});

it('an edited module is re-read, not served from the cache', () => {
  const { shared } = fixture();
  readSsrSource(shared);
  writeFileSync(shared, 'export const GUIDE = { title: "two" };\n');
  touch(shared, 5);
  const after = readSsrSource(shared);
  assert(after !== null, 'readSsrSource returned null after an edit');
  assert(
    after.raw.includes('"two"'),
    `the cache served the previous text after the file changed: ${after.raw.slice(0, 80)}`,
  );
});

it('a missing module still reports unreadable instead of throwing', () => {
  const missing = join(tmpdir(), `vesk-no-such-${process.pid}.ts`);
  const res = readSsrSource(missing);
  assert(res === null, `expected null for a missing file, got ${JSON.stringify(res)?.slice(0, 60)}`);
});

it('two collectors get the same transpiled code for a shared module', () => {
  const { shared } = fixture();
  const first = freshCollector();
  const second = freshCollector();
  collectModuleBundled(shared, first);
  collectModuleBundled(shared, second);
  assert(first.modules.length === 1, 'the shared module was not bundled at all');
  const codeOf = (c: ModuleCollector): string => c.modules.map((m) => m.code).join('\n');
  assert(
    codeOf(first) === codeOf(second),
    'a second collector produced different code for the same module — the cached code diverges',
  );
  assert(codeOf(first).includes('GUIDE'), 'the shared module\'s export is missing from the bundle');
});

it('an edited shared module changes what the next importer gets', () => {
  const { shared } = fixture();
  const codeOf = (): string => {
    const c = freshCollector();
    collectModuleBundled(shared, c);
    return c.modules.map((m) => m.code).join('\n');
  };
  const before = codeOf();
  writeFileSync(shared, 'export const GUIDE = { title: "three" };\n');
  touch(shared, 5);
  const after = codeOf();
  assert(
    before !== after,
    'the bundle cache served the previous module body after the file changed — a stale edit would ship',
  );
  assert(after.includes('three'), `the new body is missing from the bundle: ${after.slice(0, 120)}`);
});

it('a large closure does not thrash the cache (icon-barrel shape)', () => {
  // The eviction bug: a 512-entry cap with clear()-on-overflow gave a 0% hit
  // rate on a 1,620-module closure, because every insert evicted everything
  // inserted before it. Assert the cache survives a closure far past the old
  // cap by re-bundling it and requiring the result to be unchanged.
  const dir = mkdtempSync(join(tmpdir(), 'vesk-modcache-big-'));
  const N = 700;
  const barrel = join(dir, 'barrel.ts');
  const lines: string[] = [];
  for (let i = 0; i < N; i++) {
    const leaf = join(dir, `leaf${i}.ts`);
    writeFileSync(leaf, `export const v${i} = ${i};\n`);
    lines.push(`export { v${i} } from './leaf${i}.ts';`);
  }
  writeFileSync(barrel, lines.join('\n') + '\n');
  const bundle = (): ModuleCollector => {
    const c = freshCollector();
    collectModuleBundled(barrel, c);
    return c;
  };
  const first = bundle();
  const second = bundle();
  const codeOf = (c: ModuleCollector): string => c.modules.map((m) => m.code).join('\n');
  assert(first.modules.length > N, `expected the whole closure to be bundled, got ${first.modules.length}`);
  assert(codeOf(first) === codeOf(second), 'a large closure produced different code on the second pass');
  assert(codeOf(second).includes('v699'), 'the tail of the closure is missing from the second pass');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All module-bundle-cache tests passed!');
