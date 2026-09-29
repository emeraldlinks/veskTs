/**
 * `vesk migrate` — codemod mechanics and the migration report.
 *
 * The first codemod is a real correctness fix, not cosmetics: `const [c, setC] =
 * track(0)` parses, lands in the IR as a plain statement, and is therefore NOT
 * reactive — the page renders, the click handler runs, and nothing updates.
 * The documented form is `const &[c, setC] = track(0)`.
 *
 * Two properties matter beyond that: a codemod must not touch bytes it did not
 * change (the diff has to show the migration and nothing else), and it must
 * never write into `node_modules` or a build output.
 *
 * Run with: npx tsx packages/cli/src/migrate.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEMODS, applicableCodemods, compareCore, type Codemod } from './codemods.js';
import { collectTargets, detectInstalledVersion, runMigrate } from './migrate.js';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { TrackDecl } from '@vesk/compiler/src/ir';

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

const trackCodemod = CODEMODS.find((c) => c.id === 'track-destructuring') as Codemod;
const ctx = { filePath: '/p/app/page.vsk', displayPath: 'app/page.vsk' };

/** Does this source create a TrackDecl (i.e. is it reactive)? */
function isReactive(src: string): boolean {
  const ir = generateIR(parse(src, { filename: 'X.vsk' }), src, 'X.vsk');
  const comp = ir.components[0] as { body: unknown[] };
  return comp.body.some((n) => n instanceof TrackDecl);
}

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-migrate-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf-8');
  }
  return dir;
}

console.log('\n=== vesk migrate ===');

it('the array form of track() is NOT reactive — the reason the codemod exists', () => {
  const arrayForm = `component A() {\n\tconst [c, setC] = track(0)\n\t<b>{c}</b>\n}`;
  const ampForm = `component A() {\n\tconst &[c, setC] = track(0)\n\t<b>{c}</b>\n}`;
  assert(!isReactive(arrayForm), 'the array form should NOT create a TrackDecl — that is the bug');
  assert(isReactive(ampForm), 'the documented form must create a TrackDecl');
});

it('rewrites the array form to the documented form', () => {
  const src = `component A() {\n\tconst [c, setC] = track(0)\n\t<b>{c}</b>\n}`;
  const out = trackCodemod.run(src, ctx);
  assert(out.code !== null, 'nothing was rewritten');
  assert(out.code!.includes('const &[c, setC] = track(0)'), `got: ${out.code}`);
  assert(isReactive(out.code!), 'the rewritten source must actually be reactive');
  assert(out.notes.length === 1 && out.notes[0].includes('was not reactive'), `no explanatory note: ${JSON.stringify(out.notes)}`);
});

it('leaves the documented form, identifiers, and unrelated code byte-identical', () => {
  for (const src of [
    `component A() {\n\tconst &[c] = track(0)\n\t<b>{c}</b>\n}`,
    `component A() {\n\tconst c = track(0)\n\t<b>{get(c)}</b>\n}`,
    `component A() {\n\tconst list = [1, 2, 3]\n\t<b>{list.length}</b>\n}`,
    `component A() {\n\tconst [a, b] = pair()\n\t<b>{a}</b>\n}`,
    `component A() {\n\tlet [c] = track(1)\n\t<b>{c}</b>\n}`,
  ]) {
    const out = trackCodemod.run(src, ctx);
    const expected = src.includes('let [c] = track(1)') ? src.replace('let [c]', 'let &[c]') : src;
    assert(out.code === null || out.code === expected, `unexpected rewrite for:\n${src}\ngot:\n${out.code}`);
  }
});

it('rewrites every occurrence, not just the first', () => {
  const src = `component A() {\n\tconst [a, setA] = track(0)\n\tconst [b, setB] = derived(() => get(a) * 2)\n\t<b>{a}{b}</b>\n}`;
  const out = trackCodemod.run(src, ctx);
  assert((out.code!.match(/&\[/g) || []).length === 2, `expected two rewrites: ${out.code}`);
  assert(out.notes.length === 2, 'one note per rewrite');
});

it('a file it cannot parse is reported, not rewritten', () => {
  const out = trackCodemod.run('component A( { <<< broken', ctx);
  assert(out.code === null, 'an unparsable file must not be rewritten');
});

it('rewrite preserves every byte it did not change', () => {
  const src = [
    `// leading comment with  odd   spacing`,
    `component A() {`,
    `\tconst  [c,setC]  =  track( 0 )`,
    '',
    `\t<b>{c}</b>`,
    `}`,
    '',
  ].join('\n');
  const out = trackCodemod.run(src, ctx);
  assert(out.code !== null, 'nothing rewritten');
  const before = src.split('\n');
  const after = out.code!.split('\n');
  assert(before.length === after.length, 'line count changed');
  for (let i = 0; i < before.length; i++) {
    if (i === 2) continue;
    assert(before[i] === after[i], `line ${i + 1} changed: ${JSON.stringify(before[i])} -> ${JSON.stringify(after[i])}`);
  }
});

it('the type-import codemod only touches type imports, and only their source', () => {
  const codemod = CODEMODS.find((c) => c.id === 'import-type-source') as Codemod;
  const types = `import type { MiddlewareContext } from '@vesk/compiler'\nimport { Link } from '@vesk/runtime'`;
  const out = codemod.run(types, { filePath: '/p/a.ts', displayPath: 'a.ts' });
  assert(out.code!.includes("from '@vesk/types'"), 'type import not rewritten');
  assert(out.code!.includes("import { Link } from '@vesk/runtime'"), 'a VALUE import must be left alone');
  assert(out.notes.some((n) => n.includes('value import')), 'the skipped value import must be reported');
});

it('the type-import codemod refuses a name @vesk/types does not export', () => {
  // A migration must never produce an import that does not resolve. The gate is
  // the installed @vesk/types declaration file, so this is checked, not assumed.
  const codemod = CODEMODS.find((c) => c.id === 'import-type-source') as Codemod;
  const dir = project({
    'node_modules/@vesk/types/dist/index.d.ts': [
      'export interface KnownType { a: 1 }',
      'export type OtherKnown = string;',
      '',
    ].join('\n'),
    'app/ok.ts': "import type { KnownType } from '@vesk/compiler'",
    'app/bad.ts': "import type { NotInTypes } from '@vesk/compiler'",
  });
  const okCtx = { filePath: join(dir, 'app/ok.ts'), displayPath: 'app/ok.ts', projectDir: dir };
  const badCtx = { filePath: join(dir, 'app/bad.ts'), displayPath: 'app/bad.ts', projectDir: dir };
  const ok = codemod.run("import type { KnownType } from '@vesk/compiler'", okCtx);
  assert(ok.code !== null && ok.code!.includes("'@vesk/types'"), `known type not rewritten: ${JSON.stringify(ok)}`);
  const bad = codemod.run("import type { NotInTypes } from '@vesk/compiler'", badCtx);
  assert(bad.code === null, 'rewrote an import to a name @vesk/types does not export');
  assert(bad.notes.some((n) => n.includes('NotInTypes')), `no report for the skipped import: ${JSON.stringify(bad.notes)}`);
  // The local repo copy of @vesk/types is the fallback when the project has no
  // node_modules, so a real name still rewrites.
  const fallback = codemod.run("import type { MiddlewareContext } from '@vesk/compiler'", ctx);
  assert(fallback.code !== null, 'the repo fallback could not read @vesk/types');
});

it('applicableCodemods respects the version range and an explicit filter', () => {
  assert(applicableCodemods('0.1.0', '0.2.48').length > 0, 'a project behind the fix gets the codemods');
  // A project already at the codemod's target has nothing to do — this is the
  // idempotence the "second run is a no-op" test depends on.
  assert(applicableCodemods('0.2.48', '0.2.48').length === 0, 'an up-to-date project has nothing to do');
  assert(applicableCodemods('0.2.48').length === 0, 'up-to-date with no target is still a no-op');
  assert(applicableCodemods('0.2.47').length > 0, 'a project one patch behind gets the codemod with no target given');
  // `to` only restricts: asking for an older target must not run a newer codemod.
  assert(applicableCodemods('0.1.0', '0.2.40').length === 0, 'a codemod newer than the requested target must not run');
  const one = applicableCodemods('0.1.0', '0.2.48', ['track-destructuring']);
  assert(one.length === 1 && one[0].id === 'track-destructuring', 'filter by id');
  assert(compareCore('0.2.9', '0.2.10') < 0, 'core compare is numeric');
});

it('detects the installed version from node_modules, not the running CLI', () => {
  const dir = project({ 'node_modules/@vesk/vesk-cli/package.json': JSON.stringify({ version: '0.1.5' }) });
  const found = detectInstalledVersion(dir, '0.2.48');
  assert(found.version === '0.1.5', `expected the installed version, got ${found.version} from ${found.source}`);
  const bare = mkdtempSync(join(tmpdir(), 'vesk-migrate-bare-'));
  const fallback = detectInstalledVersion(bare, '0.2.48');
  assert(fallback.version === '0.2.48' && fallback.source === 'this CLI', 'falls back to the running CLI');
});

it('never walks into node_modules, build output or VCS', () => {
  const dir = project({
    'app/page.vsk': 'component A() { <b>x</b> }',
    'src/helper.ts': 'export const a = 1',
    'node_modules/pkg/index.js': 'export const x = 1',
    'dist/out.js': 'const y = 2',
    '.git/config': 'nope',
  });
  const found = collectTargets(dir);
  assert(found.includes(join('app', 'page.vsk')), `app file missing from ${JSON.stringify(found)}`);
  assert(found.includes(join('src', 'helper.ts')), 'ts file missing');
  for (const skip of ['node_modules', 'dist', '.git']) {
    assert(!found.some((f) => f.startsWith(skip + '/')), `walked into ${skip}: ${JSON.stringify(found)}`);
  }
});

it('a dry run reports the files without writing them', () => {
  const dir = project({ 'app/page.vsk': 'component A() {\n\tconst [c, setC] = track(0)\n\t<b>{c}</b>\n}' });
  const before = readFileSync(join(dir, 'app/page.vsk'), 'utf-8');
  const report = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.1.0', to: '0.2.48', dryRun: true });
  assert(report.filesChanged.length === 1, `expected one file, got ${JSON.stringify(report.filesChanged)}`);
  assert(report.dryRun, 'the report records that it was a rehearsal');
  assert(readFileSync(join(dir, 'app/page.vsk'), 'utf-8') === before, 'a dry run wrote to disk');
});

it('a real run rewrites the file, and a second run is a no-op', () => {
  const dir = project({ 'app/page.vsk': 'component A() {\n\tconst [c, setC] = track(0)\n\t<b>{c}</b>\n}' });
  const first = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.1.0', to: '0.2.48' });
  assert(first.filesChanged.length === 1, 'the first run changed nothing');
  const rewritten = readFileSync(join(dir, 'app/page.vsk'), 'utf-8');
  assert(rewritten.includes('const &[c, setC]'), `not rewritten: ${rewritten}`);
  const second = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.1.0', to: '0.2.48' });
  assert(second.filesChanged.length === 0, 'a second run changed the file again — migrate is not idempotent');
  // …and a project whose version is already the codemod's target is a no-op
  // without even reading the files (the range check, not the rewrite, decides).
  const upToDate = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.2.48', to: '0.2.48' });
  assert(upToDate.codemods.length === 0, `an up-to-date project still ran ${upToDate.codemods.join(', ')}`);
  assert(readFileSync(join(dir, 'app/page.vsk'), 'utf-8') === rewritten, 'a second run altered the bytes');
});

it('a project with nothing to migrate says so and touches nothing', () => {
  const dir = project({ 'app/page.vsk': 'component A() {\n\tconst &[c] = track(0)\n\t<b>{c}</b>\n}' });
  const before = readFileSync(join(dir, 'app/page.vsk'), 'utf-8');
  const report = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.1.0', to: '0.2.48' });
  assert(report.filesChanged.length === 0, 'a clean project was changed');
  assert(report.notes.some((n) => n.includes('was not reactive')) === false, 'no spurious notes');
  assert(readFileSync(join(dir, 'app/page.vsk'), 'utf-8') === before, 'bytes changed');
});

it('migrates a real app fixture the way a user would run it', () => {
  const dir = project({
    'app/page.vsk': 'component Home() {\n\tconst [count, setCount] = track(0)\n\t<button onclick={() => setCount(count + 1)}>{count}</button>\n}',
    'app/nested/other.vsk': 'component Other() {\n\tconst [open, setOpen] = track(false)\n\t<p>{open}</p>\n}',
    'src/unrelated.ts': 'export const [a, b] = [1, 2];\n',
    'node_modules/dep/index.vsk': 'component Dep() {\n\tconst [x] = track(0)\n\t<b>{x}</b>\n}',
  });
  const report = runMigrate({ projectDir: dir, cliVersion: '0.2.48', from: '0.1.0', to: '0.2.48' });
  assert(report.filesChanged.length === 2, `expected the two .vsk files, got ${JSON.stringify(report.filesChanged)}`);
  for (const f of ['app/page.vsk', 'app/nested/other.vsk']) {
    const code = readFileSync(join(dir, f), 'utf-8');
    assert(code.includes('&['), `${f} was not rewritten`);
    assert(isReactive(code), `${f} is still not reactive`);
  }
  assert(readFileSync(join(dir, 'src/unrelated.ts'), 'utf-8').includes('export const [a, b]'), 'a plain array destructure was rewritten');
  assert(readFileSync(join(dir, 'node_modules/dep/index.vsk'), 'utf-8').includes('const [x]'), 'a dependency was rewritten');
});

it('every codemod declares a complete, ordered range', () => {
  for (const c of CODEMODS) {
    assert(/^[a-z0-9-]+$/.test(c.id), `${c.id}: ids must be flag-safe`);
    assert(compareCore(c.from, c.to) <= 0, `${c.id}: from ${c.from} must be <= to ${c.to}`);
    assert(c.describe.length > 20, `${c.id}: needs a description`);
    assert(c.appliesTo('/x/a.vsk') === c.appliesTo('/x/a.vsk'), `${c.id}: appliesTo must be pure`);
  }
  const ids = CODEMODS.map((c) => c.id);
  assert(new Set(ids).size === ids.length, `duplicate codemod ids: ${ids.join(', ')}`);
});

it('a codemod never throws on unrelated input', () => {
  const samples = ['', 'not a component at all', 'const [a, b] = [1, 2]', '<<>>', 'export default 1'];
  for (const codemod of CODEMODS) {
    for (const sample of samples) {
      let out;
      try {
        out = codemod.run(sample, ctx);
      } catch (e) {
        throw new Error(`${codemod.id} threw on ${JSON.stringify(sample)}: ${(e as Error).message}`);
      }
      assert(typeof out.code === 'string' || out.code === null, `${codemod.id} returned a non-string`);
    }
  }
  assert(!existsSync(join(tmpdir(), 'definitely-not-written')), 'sanity');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All migrate tests passed!');
