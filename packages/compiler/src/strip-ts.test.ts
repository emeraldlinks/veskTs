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

// ─────────────────────────────────────────────────────────────────────────────
// Parameter annotations that survive only when a DEFAULT value is present.
//
// A parameter with a default is an `AssignmentPattern`, and the annotation lives
// on `left` rather than on the pattern node. Clearing only `param.typeAnnotation`
// therefore handled `(a: string)` and left every defaulted parameter's type in
// place, so the emitted module kept a literal `: Partial<Record<string, number>>`
// and the SSR module loader died on `Unexpected token ':'`. Every non-defaulted
// shape tested clean, which is exactly why this survived — it only appeared once
// a parameter also had an initializer.
// ─────────────────────────────────────────────────────────────────────────────

/** True when a TS type annotation survived into the emitted JS. */
function hasAnnotation(code: string): boolean {
  // Look at the parameter region only: the arrow body legitimately contains
  // colons of its own.
  const head = code.split('=>')[0] ?? '';
  return /[:?]/.test(head.replace(/\{[^}]*\}/g, '{}'));
}

test('stripCodeTypes: a parameter annotation WITH a default is dropped', () => {
  const out = stripCodeTypes('export const f = (a: Partial<Record<string, number>> = {}) => 1;');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('a = {}');
});

test('stripCodeTypes: an inline object-literal type with a default is dropped', () => {
  const out = stripCodeTypes('export const f = (o: { isIssuable?: boolean } = {}) => 1;');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('o = {}');
});

test('stripCodeTypes: a default EXPRESSION parameter annotation is dropped', () => {
  const out = stripCodeTypes('export const f = (v: ThemeVariant = theme.get()) => 1;');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('theme.get()');
});

test('stripCodeTypes: an optional parameter with a default is dropped', () => {
  const out = stripCodeTypes('export const f = (a?: string = "x") => a;');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('"x"');
});

test('stripCodeTypes: a DESTRUCTURED parameter with a default is dropped', () => {
  const out = stripCodeTypes('export const f = ({ a, b }: Opts = {}) => a;');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('{ a, b } = {}');
});

test('stripCodeTypes: a rest parameter annotation is dropped', () => {
  const out = stripCodeTypes('export const f = (...rest: string[]) => rest.length;');
  expect(hasAnnotation(out)).toEqual(false);
});

test('stripCodeTypes: an array-destructured parameter with a default is dropped', () => {
  const out = stripCodeTypes('export const f = ([a, b]: number[] = []) => a;');
  expect(hasAnnotation(out)).toEqual(false);
});

test('stripCodeTypes: every parameter shape together, on a function declaration', () => {
  const out = stripCodeTypes('export function g(a: string, b?: number = 2, { c }: C = {}, ...r: string[]) { return a; }');
  expect(hasAnnotation(out)).toEqual(false);
  expect(out).toContain('b = 2');
});

test('stripCodeTypes: a parameter WITHOUT a default is still dropped (no regression)', () => {
  const out = stripCodeTypes('export const f = (a: string, b: Record<string, number>) => 1;');
  expect(hasAnnotation(out)).toEqual(false);
});

test('stripCodeTypes: a default value with no annotation is left intact', () => {
  const out = stripCodeTypes('export const f = (a = 5) => a;');
  expect(out).toContain('a = 5');
});

test('stripCodeTypes: the stripped module is valid JavaScript', () => {
  // The real failure was not a missing annotation but an emitted module that
  // could not be evaluated at all, so assert evaluability, not just text.
  const out = stripCodeTypes('export const f = (a: Partial<Record<string, number>> = {}) => Object.keys(a).length;');
  const body = out.replace(/^export\s+/, '');
  const value = new Function(`${body}; return f;`)() as (a: Record<string, number>) => number;
  expect(value({ x: 1, y: 2 })).toEqual(2);
});

const results = () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
};
results();