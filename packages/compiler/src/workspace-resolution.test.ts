/**
 * Module resolution: package `exports` maps and workspace subpaths.
 *
 * A Vesk app has to drop into an existing pnpm/npm/yarn workspace without
 * vendoring its dependencies. That means resolving what those packages
 * actually ship: a modern package declares `exports` and often no `main` at
 * all, and subpath imports (`@acme/ui/button`) go through the map rather than
 * through the directory layout. The old walk only knew `main` + `index`, so
 * such a package simply did not resolve.
 *
 * Run with: npx tsx packages/compiler/src/workspace-resolution.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSsrModule, collectModuleBundled, type ModuleCollector } from '@vesk/compiler/src/module-imports';

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

/** A project dir with a fake node_modules entry. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vesk-workspace-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf-8');
  }
  return root;
}

console.log('\n=== Workspace / exports resolution ===');

it('resolves a package that ships ONLY an exports map (no main)', () => {
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      type: 'module',
      exports: { '.': './dist/index.js' },
    }),
    'node_modules/@acme/ui/dist/index.js': 'export const Button = 1;',
  });
  const resolved = resolveSsrModule('@acme/ui', dir);
  assert(resolved !== null, 'an exports-only package did not resolve (no `main` to fall back on)');
  assert(String(resolved).endsWith('dist/index.js'), `resolved to ${resolved}`);
});

it('prefers the import condition over require', () => {
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      exports: { '.': { import: './dist/index.mjs', require: './dist/index.cjs' } },
    }),
    'node_modules/@acme/ui/dist/index.mjs': 'export const a = 1;',
    'node_modules/@acme/ui/dist/index.cjs': 'module.exports = {};',
  });
  const resolved = String(resolveSsrModule('@acme/ui', dir));
  assert(resolved.endsWith('index.mjs'), `expected the import condition, got ${resolved}`);
});

it('resolves a subpath import through exports', () => {
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      exports: { '.': './dist/index.js', './button': './dist/button.js' },
    }),
    'node_modules/@acme/ui/dist/index.js': 'export const x = 1;',
    'node_modules/@acme/ui/dist/button.js': 'export const Button = 1;',
  });
  const resolved = String(resolveSsrModule('@acme/ui/button', dir));
  assert(resolved.endsWith('dist/button.js'), `subpath import resolved to ${resolved}`);
});

it('resolves a wildcard subpath pattern', () => {
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      exports: { '.': './dist/index.js', './components/*': './dist/components/*.js' },
    }),
    'node_modules/@acme/ui/dist/index.js': 'export const x = 1;',
    'node_modules/@acme/ui/dist/components/card.js': 'export const Card = 1;',
  });
  const resolved = String(resolveSsrModule('@acme/ui/components/card', dir));
  assert(resolved.endsWith('dist/components/card.js'), `pattern subpath resolved to ${resolved}`);
});

it('falls back to module, then main, then index — in that order', () => {
  const withAll = workspace({
    'node_modules/pkg/package.json': JSON.stringify({
      name: 'pkg',
      module: 'esm/index.js',
      main: 'cjs/index.js',
    }),
    'node_modules/pkg/esm/index.js': 'export const a = 1;',
    'node_modules/pkg/cjs/index.js': 'module.exports = {};',
  });
  assert(String(resolveSsrModule('pkg', withAll)).includes('esm/index.js'), 'module did not win over main');

  const mainOnly = workspace({
    'node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', main: './cjs/index.js' }),
    'node_modules/pkg/cjs/index.js': 'module.exports = {};',
  });
  assert(String(resolveSsrModule('pkg', mainOnly)).includes('cjs/index.js'), 'main did not resolve');

  const bare = workspace({
    'node_modules/pkg/index.js': 'export const a = 1;',
  });
  assert(String(resolveSsrModule('pkg', bare)).endsWith('index.js'), 'a bare index did not resolve');
});

it('a package that exports nothing is skipped, not crash-prone', () => {
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({ name: '@acme/ui', exports: { './private/*': './dist/private/*.js' } }),
  });
  assert(resolveSsrModule('@acme/ui', dir) === null, 'an unexported root should not resolve');
  assert(resolveSsrModule('@acme/ui/nope', dir) === null, 'an unexported subpath should not resolve');
  const malformed = workspace({ 'node_modules/broken/package.json': '{ not json' });
  assert(resolveSsrModule('broken', malformed) === null, 'a malformed package.json must not throw');
});

it('relative and absolute imports still resolve (no regression)', () => {
  const dir = workspace({ 'app/lib/util.ts': 'export const u = 1;', 'app/page.vsk': 'component P() { <p>x</p> }' });
  assert(String(resolveSsrModule('./lib/util', join(dir, 'app'))).endsWith('app/lib/util.ts'), 'relative broke');
  assert(String(resolveSsrModule(join(dir, 'app/lib/util.ts'), join(dir, 'app'))).endsWith('util.ts'), 'absolute broke');
});

it('a workspace package import is bundled into the module closure', () => {
  // The point of resolving it: the value has to reach the SSR scope, not just
  // resolve to a path.
  const dir = workspace({
    'node_modules/@acme/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      exports: { '.': './dist/index.js', './button': './dist/button.js' },
    }),
    'node_modules/@acme/ui/dist/index.js': 'export const shared = 1;',
    'node_modules/@acme/ui/dist/button.js': "import { shared } from './index.js';\nexport const Button = shared;",
  });
  const collector: ModuleCollector = { keysByAbs: new Map(), modules: [] };
  const key = collectModuleBundled(String(resolveSsrModule('@acme/ui/button', dir)), collector);
  assert(key.startsWith('__veskMod'), 'no synthetic module key was produced');
  const code = collector.modules.map((m) => m.code).join('\n');
  assert(code.includes('Button'), 'the workspace export is not in the bundle');
  assert(code.includes('shared'), 'the workspace package internal was not bundled with it');
  assert(collector.modules.length === 2, `expected the closure to include index.js, got ${collector.modules.length} modules`);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All workspace-resolution tests passed!');
