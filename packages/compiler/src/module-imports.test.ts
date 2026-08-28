/**
 * SSR module-value imports — `packages/compiler/src/module-imports.ts`.
 *
 * Covers loading plain `.ts`/`.tsx`/`.json` module values into the SSR scope
 * (`__vesk`) so component bodies can reference them the way the client bundle
 * already can. Both expression-mode and statement-mode bodies are exercised.
 *
 * Run with: npx tsx packages/compiler/src/module-imports.test.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
console.log(`\nmodule-imports: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);