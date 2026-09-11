import { parse } from '@vesk/compiler/src/parser';
import { stripCodeTypes, hasTsSyntax, isTypeOnlyStatement } from '@vesk/compiler/src/strip-ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

function expect(actual: unknown) {
  return {
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`expected to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 300)}`);
      }
    },
    notToContain(expected: string) {
      if (typeof actual === 'string' && actual.includes(expected)) {
        throw new Error(`expected NOT to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 300)}`);
      }
    },
    toEqual(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

test('stripCodeTypes: top-level import type declaration is elided', () => {
  const src = `import type { VeskRequest } from '@vesk/types';
import { VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  return VeskResponse.json({ ok: true });
}`;
  const out = stripCodeTypes(src);
  expect(out).notToContain("from '@vesk/types'");
  expect(out).notToContain('import type');
  expect(out).notToContain(': VeskRequest');
  expect(out).toContain("import { VeskResponse } from '@vesk/runtime/server'");
  expect(out).toContain('export async function GET(req)');
});

test('stripCodeTypes: type-only default import is elided', () => {
  const src = `import type VeskApp from '@vesk/types';
export async function GET(req) { return new Response('ok'); }`;
  const out = stripCodeTypes(src);
  expect(out).notToContain('import type');
  expect(out).toContain("return new Response('ok')");
});

test('stripCodeTypes: inline type specifiers are dropped from mixed imports', () => {
  const src = `import { type A, helper, type B } from './mixed.ts';
export async function GET() { return helper(A, B); }`;
  const out = stripCodeTypes(src);
  expect(out).notToContain('type A');
  expect(out).notToContain('type B');
  expect(out).toContain("import { helper } from './mixed.ts'");
});

test('stripCodeTypes: export type is elided and inline export type specifiers dropped', () => {
  const src = `export type { F } from './f.ts';
export { type G, H } from './g.ts';
export type * from './all.ts';
export async function GET() { return new Response('ok'); }`;
  const out = stripCodeTypes(src);
  expect(out).notToContain('export type');
  expect(out).notToContain("from './f.ts'");
  expect(out).notToContain('type G');
  expect(out).toContain("export { H } from './g.ts'");
  expect(out).notToContain('all.ts');
});

test('stripCodeTypes: a file with ONLY import type (no other TS syntax) is still stripped', () => {
  const src = `import type { VeskRequest } from '@vesk/types';
export async function GET(req: VeskRequest) {
  return new Response('ok');
}`;
  const ast = parse(src);
  expect(hasTsSyntax(ast)).toEqual(true);
  const out = stripCodeTypes(src);
  expect(out).notToContain('import type');
  expect(out).toContain('export async function GET(req)');
});

test('stripCodeTypes: value-only route source stays byte-identical', () => {
  const src = `import { VeskResponse } from '../runtime.js';
export async function GET(req) {
  return VeskResponse.json({ ok: true });
}`;
  const out = stripCodeTypes(src);
  expect(out).toEqual(src);
});

test('stripCodeTypes: side-effect imports are preserved', () => {
  const src = `import './styles.css';
export async function GET() { return new Response('ok'); }`;
  const out = stripCodeTypes(src);
  expect(out).toContain("import './styles.css'");
});

test('isTypeOnlyStatement: recognizes import type and export type', () => {
  const typeImport = parse(`import type { X } from './x';`).body[0];
  const valueImport = parse(`import { X } from './x';`).body[0];
  const typeExport = parse(`export type { X } from './x';`).body[0];
  expect(isTypeOnlyStatement(typeImport)).toEqual(true);
  expect(isTypeOnlyStatement(valueImport)).toEqual(false);
  expect(isTypeOnlyStatement(typeExport)).toEqual(true);
});

const results = () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
};
results();