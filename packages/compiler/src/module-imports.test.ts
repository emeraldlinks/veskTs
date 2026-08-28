/**
 * SSR module-value imports — `packages/compiler/src/module-imports.ts`.
 *
 * Covers loading plain `.ts`/`.tsx`/`.json` module values into the SSR scope
 * (`__vesk`) so component bodies can reference them the way the client bundle
 * already can. Both expression-mode and statement-mode bodies are exercised.
 *
 * Run with: npx tsx packages/compiler/src/module-imports.test.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@vesk/compiler/src/server-codegen';
import {
  localValueImportNames,
  isLocalValueImport,
  resolveSsrModule,
  loadSsrModule,
  applyLocalModuleImports,
} from '@vesk/compiler/src/module-imports';

let passed = 0;
let failed = 0;

function expect(actual: unknown) {
  return {
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`expected to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 400)}`);
      }
    },
    notToContain(expected: string) {
      if (typeof actual === 'string' && actual.includes(expected)) {
        throw new Error(`expected NOT to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 400)}`);
      }
    },
    toEqual(expected: unknown) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`expected ${b}, got ${a}`);
    },
  };
}

interface Fixture {
  dir: string;
  file(p: string): string;
  cleanup(): void;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-mod-'));
  return {
    dir,
    file(p: string): string {
      return join(dir, p);
    },
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

// ============================================================
// Name extraction (token-level, no module load)
// ============================================================
test('localValueImportNames: named/default/namespace yields local bindings', () => {
  const names = localValueImportNames([
    `import { GUIDE } from '../lib/guide.ts';`,
    `import DATA from './data';`,
    `import * as lib from './lib.tsx';`,
    `import { type T, helper } from './mix.ts';`,
  ]);
  expect([...names]).toEqual(['GUIDE', 'DATA', 'lib', 'helper']);
});

test('localValueImportNames: runtime, .vsk, and css/md targets are excluded', () => {
  const names = localValueImportNames([
    `import { derived } from '@vesk/runtime';`,
    `import { get } from '@vesk/reactivity';`,
    `import SideNav from './SideNav.vsk';`,
    `import './site.css';`,
    `import md from './doc.md';`,
  ]);
  expect(names.length).toEqual(0);
});

test('isLocalValueImport: value import yes, effect-only/runtime/vsk no', () => {
  expect(isLocalValueImport(`import { GUIDE } from '../lib/guide.ts';`)).toEqual(true);
  expect(isLocalValueImport(`import './side-effect.js';`)).toEqual(false);
  expect(isLocalValueImport(`import { effect } from '@vesk/runtime';`)).toEqual(false);
  expect(isLocalValueImport(`import C from './C.vsk';`)).toEqual(false);
});

// ============================================================
// Module loading (dependent on resolver + ESM->CJS rewriting)
// ============================================================
test('resolveSsrModule: extension probing and directory/index resolution', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('a.ts'), '');
    writeFileSync(fx.file('b'), '');
    mkdirSync(fx.file('nested'));
    writeFileSync(fx.file('nested/index.ts'), '');
    expect(resolveSsrModule('./a', fx.dir)).toEqual(fx.file('a.ts'));
    expect(resolveSsrModule('./b', fx.dir)).toEqual(fx.file('b'));
    expect(resolveSsrModule('./nested', fx.dir)).toEqual(fx.file('nested/index.ts'));
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: TS stripping + ESM export forms', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('guide.ts'), [
      `interface Entry { title: string }`,
      `export const GUIDE: Entry[] = [{ title: 'Alpha' }, { title: 'Beta' }];`,
      `export function shout(s: string): string { return s.toUpperCase() + '!'; }`,
      `class Thing { name = 't' }`,
      `export { Thing as Renamed };`,
      `export const KIND = 'x' as const;`,
      `export default 41;`,
    ].join('\n'));
    const mod = loadSsrModule(fx.file('guide.ts')) as Record<string, unknown>;
    expect((mod.GUIDE as Array<{ title: string }>).length).toEqual(2);
    expect((mod.shout as (s: string) => string)('hey')).toEqual('HEY!');
    const thing = new (mod.Renamed as new () => { name: string })();
    expect(thing.name).toEqual('t');
    expect(mod.KIND).toEqual('x');
    expect(mod.default).toEqual(41);
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: nested relative imports, export-from, star and re-export forms', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('suffix.ts'), `export function suffix(s: string): string { return s + '!'; }`);
    writeFileSync(fx.file('inner.ts'), [
      `import { suffix } from './suffix';`,
      `export const TAG = suffix('tagged');`,
      `const unused = 1;`,
      `export { suffix, suffix as default };`,
    ].join('\n'));
    writeFileSync(fx.file('barrel.ts'), [
      `export { TAG as ReTag } from './inner';`,
      `export * from './inner';`,
      `export * as group from './inner';`,
    ].join('\n'));
    const inner = loadSsrModule(fx.file('inner.ts')) as Record<string, unknown>;
    expect(inner.TAG).toEqual('tagged!');
    expect(typeof inner.default).toEqual('function');
    expect(typeof inner.suffix).toEqual('function');
    const barrel = loadSsrModule(fx.file('barrel.ts')) as Record<string, unknown>;
    expect(barrel.ReTag).toEqual('tagged!');
    expect(barrel.TAG).toEqual('tagged!');
    expect((barrel.group as Record<string, unknown>).suffix).toEqual(inner.suffix);
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: JSON module exposes values (with default self-reference)', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('cfg.json'), JSON.stringify({ name: 'jsonval', items: [1, 2] }));
    const mod = loadSsrModule(fx.file('cfg.json')) as Record<string, unknown>;
    expect((mod as { name: string }).name).toEqual('jsonval');
    if (mod.default !== mod) throw new Error('json module default should self-reference');
  } finally {
    fx.cleanup();
  }
});

test('applyLocalModuleImports: merges only requested names, leaves runtime alone', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('lib.ts'), `export const A = 1;\nexport const B = 2;`);
    const scope: Record<string, unknown> = { derived: 'runtime-fn' };
    applyLocalModuleImports(
      scope,
      [`import { B } from './lib.ts';`, `import { derived } from '@vesk/runtime';`],
      fx.file('page.vsk')
    );
    expect(scope.B).toEqual(2);
    expect('A' in scope).toEqual(false);
    expect(scope.derived).toEqual('runtime-fn');
  } finally {
    fx.cleanup();
  }
});

// ============================================================
// End-to-end SSR rendering (expression + statement modes)
// ============================================================
test('SSR: expression-mode component renders named-import value', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('data.ts'), `export const GUIDE = [{ title: 'Alpha' }];`);
    const src = [
      `import { GUIDE } from './data.ts';`,
      `component Page {`,
      `  return <ul>{GUIDE.map((g) => <li>{g.title}</li>)}</ul>`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('<li>Alpha</li>');
  } finally {
    fx.cleanup();
  }
});

test('SSR: statement-mode component renders named-import value', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('data.ts'), `export const GUIDE = [{ title: 'Alpha' }, { title: 'Beta' }];`);
    const src = [
      `import { GUIDE } from './data.ts';`,
      `component Page {`,
      `  <ul>`,
      `  for (const g of GUIDE) {`,
      `    <li>{g.title}</li>`,
      `  }`,
      `  </ul>`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('<li>Alpha</li>');
    expect(html).toContain('<li>Beta</li>');
  } finally {
    fx.cleanup();
  }
});

test('SSR: imported function call works in both modes', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('helper.ts'), `export function shout(s: string): string { return s.toUpperCase() + '!'; }`);
    const exprSrc = [
      `import { shout } from './helper.ts';`,
      `component Page { return <p>{shout('hey')}</p> }`,
    ].join('\n');
    expect(render(exprSrc, 'Page', {}, new Map(), { sourcePath: fx.file('p1.vsk') }) as string).toContain('HEY!');
    const stmtSrc = [
      `import { shout } from './helper.ts';`,
      `component Page {`,
      `  const out = shout('hey');`,
      `  <p>{out}</p>`,
      `}`,
    ].join('\n');
    expect(render(stmtSrc, 'Page', {}, new Map(), { sourcePath: fx.file('p2.vsk') }) as string).toContain('HEY!');
  } finally {
    fx.cleanup();
  }
});

test('SSR: default and type-only specifiers resolve', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('lib.ts'), `type Shape = string;\nexport const V: Shape = 'default-val';`);
    const src = [
      `import { type NeverMinded } from './lib.ts';`,
      `import { V as Renamed } from './lib.ts';`,
      `component Page {`,
      `  if (Renamed.length > 0) { <span>{Renamed}</span> }`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('<span>default-val</span>');
    expect(html).notToContain('NeverMinded');
  } finally {
    fx.cleanup();
  }
});

test('SSR: namespace import and json import values', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('lib.ts'), `export const N = 7;`);
    writeFileSync(fx.file('cfg.json'), JSON.stringify({ name: 'jsonval' }));
    const src = [
      `import * as lib from './lib.ts';`,
      `import cfg from './cfg.json';`,
      `component Page { return <p>{lib.N}:{cfg.name}</p> }`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('7:jsonval');
  } finally {
    fx.cleanup();
  }
});

test('SSR: extensionless local import resolves', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('data.ts'), `export const ID = 'extless';`);
    const src = [
      `import { ID } from './data';`,
      `component Page { return <b>{ID}</b> }`,
    ].join('\n');
    expect(render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string).toContain('extless');
  } finally {
    fx.cleanup();
  }
});

test('SSR: nested local import (module importing module) resolves', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('suffix.ts'), `export function suffix(s: string): string { return s + '!'; }`);
    writeFileSync(fx.file('inner.ts'), `import { suffix } from './suffix';\nexport const TAG = suffix('nested');`);
    const src = [
      `import { TAG } from './inner.ts';`,
      `component Page { return <i>{TAG}</i> }`,
    ].join('\n');
    expect(render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string).toContain('nested!');
  } finally {
    fx.cleanup();
  }
});

test('SSR: composed sub-.vsk component sees its own module import', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('data.ts'), `export const GUIDE = [{ title: 'SubAlpha' }];`);
    writeFileSync(fx.file('Sub.vsk'), [
      `import { GUIDE } from './data.ts';`,
      `component Sub {`,
      `  const first = GUIDE[0];`,
      `  <span>{first.title}</span>`,
      `}`,
    ].join('\n'));
    const src = [
      `import Sub from './Sub.vsk';`,
      `component Page {`,
      `  return <div><Sub /></div>`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('<span>SubAlpha</span>');
  } finally {
    fx.cleanup();
  }
});

test('SSR: runtime imports continue to work alongside local module imports', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('data.ts'), `export const GUIDE = [{ title: 'Alpha' }];`);
    const src = [
      `import { GUIDE } from './data.ts';`,
      `import { derived } from '@vesk/runtime';`,
      `component Page {`,
      `  const &[count, rawCell] = track(0);`,
      `  return <ul>{GUIDE.map((g) => <li>{g.title}</li>)}</ul>`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('<li>Alpha</li>');
  } finally {
    fx.cleanup();
  }
});

// ============================================================
// Hardening: native resolution, exports maps, builtins, live
// bindings, fail-loud guards, cycles, invalidation, side-effect
// imports.
// ============================================================
test('loadSsrModule: node: builtin value import resolves and is usable', () => {
  const fx = makeFixture();
  try {
    const scope: Record<string, unknown> = {};
    applyLocalModuleImports(scope, [`import { join } from 'node:path';`], fx.file('page.vsk'));
    expect(typeof scope.join).toEqual('function');
    expect((scope.join as (...a: string[]) => string)('a', 'b')).toEqual(join('a', 'b'));
  } finally {
    fx.cleanup();
  }
});

test('resolveSsrModule: bare specifier honors the exports map (node_modules fixture)', () => {
  const fx = makeFixture();
  try {
    mkdirSync(fx.file('node_modules/fixpkg/dist'), { recursive: true });
    writeFileSync(fx.file('node_modules/fixpkg/package.json'), JSON.stringify({ name: 'fixpkg', version: '1.0.0', exports: { '.': './dist/lib.js' } }));
    writeFileSync(fx.file('node_modules/fixpkg/dist/lib.js'), `export const VALUE = 'from-map';`);
    const resolved = resolveSsrModule('fixpkg', fx.dir);
    expect(resolved).toEqual(fx.file('node_modules/fixpkg/dist/lib.js'));
    const mod = loadSsrModule(resolved as string) as Record<string, unknown>;
    expect(mod.VALUE).toEqual('from-map');
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: live bindings observe post-import mutation', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('counter.ts'), [
      `export let count = 1;`,
      `export function bump(): number { count += 1; return count; }`,
      `export function getCount(): number { return count; }`,
    ].join('\n'));
    const mod = loadSsrModule(fx.file('counter.ts')) as {
      count: number;
      bump: () => number;
      getCount: () => number;
    };
    (mod.bump)();
    expect(mod.count).toEqual(2);
    expect(mod.getCount()).toEqual(2);
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: import.meta fails loudly with a specific error', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('meta.ts'), `export const u = import.meta.url;`);
    let threw: Error | null = null;
    try {
      loadSsrModule(fx.file('meta.ts'));
    } catch (e) {
      threw = e as Error;
    }
    if (!threw) throw new Error('expected import.meta module to throw');
    if (!/import\.meta/.test(threw.message)) throw new Error(`expected import.meta in error, got: ${threw.message}`);
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: top-level await never yields a silent partial load', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('tla.ts'), `export const v = await Promise.resolve(1);`);
    let result: unknown = 'sentinel';
    try {
      result = loadSsrModule(fx.file('tla.ts'));
    } catch (e) {
      result = e;
    }
    if (result !== null && !(result instanceof Error)) {
      throw new Error(`expected null (or explicit error) for TLA module, got: ${String(result)}`);
    }
  } finally {
    fx.cleanup();
  }
});

test('loadSsrModule: circular imports resolve without infinite recursion', () => {
  const fx = makeFixture();
  try {
    writeFileSync(fx.file('a.ts'), [
      `import { B } from './b';`,
      `export const A = 'a';`,
      `export function fromA(): string { return 'from-a'; }`,
    ].join('\n'));
    writeFileSync(fx.file('b.ts'), [
      `import { A } from './a';`,
      `export const B = 'b:' + (A === undefined ? 'none' : A);`,
    ].join('\n'));
    const a = loadSsrModule(fx.file('a.ts')) as Record<string, unknown>;
    expect(a.A).toEqual('a');
    expect((a.fromA as () => string)()).toEqual('from-a');
    // b evaluated while a was still partial, so it observed the in-flight
    // exports (A undefined there) exactly once — and that snapshot is cached.
    const b = loadSsrModule(fx.file('b.ts')) as Record<string, unknown>;
    expect(b.B).toEqual('b:none');
    const bAgain = loadSsrModule(fx.file('b.ts')) as Record<string, unknown>;
    expect(bAgain.B).toEqual('b:none');
  } finally {
    fx.cleanup();
  }
});

test('applyLocalModuleImports: transitive closure invalidation on dep edit', () => {
  const fx = makeFixture();
  try {
    const t0 = new Date(Date.now() - 60000);
    const t1 = new Date(Date.now() - 30000);
    writeFileSync(fx.file('leaf.ts'), `export const V = 'v1';`);
    utimesSync(fx.file('leaf.ts'), t0, t0);
    writeFileSync(fx.file('mid.ts'), `import { V } from './leaf';\nexport const W = V + '!';`);
    utimesSync(fx.file('mid.ts'), t0, t0);

    const scope1: Record<string, unknown> = {};
    applyLocalModuleImports(scope1, [`import { W } from './mid.ts';`], fx.file('page.vsk'));
    expect(scope1.W).toEqual('v1!');

    writeFileSync(fx.file('leaf.ts'), `export const V = 'v2';`);
    utimesSync(fx.file('leaf.ts'), t1, t1);

    const scope2: Record<string, unknown> = {};
    applyLocalModuleImports(scope2, [`import { W } from './mid.ts';`], fx.file('page.vsk'));
    expect(scope2.W).toEqual('v2!');
  } finally {
    fx.cleanup();
  }
});

test('applyLocalModuleImports: side-effect imports run their module top-level code', () => {
  const fx = makeFixture();
  try {
    delete (globalThis as { __VESK_SSR_SETUP?: string }).__VESK_SSR_SETUP;
    writeFileSync(fx.file('setup.ts'), `(globalThis as any).__VESK_SSR_SETUP = 'ran';`);
    writeFileSync(fx.file('lib.ts'), `export const A = 1;`);
    const scope: Record<string, unknown> = {};
    applyLocalModuleImports(scope, [`import './setup.ts';`, `import { A } from './lib.ts';`], fx.file('page.vsk'));
    expect((globalThis as { __VESK_SSR_SETUP?: string }).__VESK_SSR_SETUP).toEqual('ran');
    expect(scope.A).toEqual(1);
  } finally {
    fx.cleanup();
  }
});

test('SSR: side-effect import + value import both present during render', () => {
  const fx = makeFixture();
  try {
    delete (globalThis as { __VESK_SSR_SETUP?: string }).__VESK_SSR_SETUP;
    writeFileSync(fx.file('setup.ts'), `(globalThis as any).__VESK_SSR_SETUP = 'ran';`);
    writeFileSync(fx.file('lib.ts'), `export const A = 1;`);
    const src = [
      `import './setup.ts';`,
      `import { A } from './lib.ts';`,
      `component Page {`,
      `  <p>{globalThis.__VESK_SSR_SETUP}:{A}</p>`,
      `}`,
    ].join('\n');
    const html = render(src, 'Page', {}, new Map(), { sourcePath: fx.file('page.vsk') }) as string;
    expect(html).toContain('ran:1');
  } finally {
    fx.cleanup();
  }
});

// ============================================================
console.log(`\nmodule-imports: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);