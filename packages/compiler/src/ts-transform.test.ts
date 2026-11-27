import { transformTsModule } from '@vesk/compiler/src/ts-transform';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`); });
}

function expect(actual: unknown) {
  return {
    toContain(s: string) { if (typeof actual !== 'string' || !actual.includes(s)) throw new Error(`expected to contain ${s}: ${String(actual).slice(0,200)}`); },
    not: { toContain(s: string) { if (typeof actual === 'string' && actual.includes(s)) throw new Error(`expected not to contain ${s}: ${String(actual).slice(0,200)}`); } },
  };
}

console.log('ts-transform\n');
await test('strips implements and TS types', async () => {
  const out = await transformTsModule('interface I{} class X implements I { private x: number = 1; m(arg: string): number { return this.x; } }', { filename: 'a.ts' });
  expect(out).toContain('class X');
  expect(out).not.toContain('implements');
  expect(out).not.toContain('private');
  expect(out).not.toContain(': number');
});
await test('strips parameter properties and generics', async () => {
  const out = await transformTsModule('class A { constructor(public x: string, private readonly y = 1) {} } function id<T>(v: T): T { return v; }', { filename: 'a.ts' });
  expect(out).toContain('class A');
  expect(out).not.toContain('public');
  expect(out).not.toContain('private');
  expect(out).not.toContain('readonly');
  expect(out).toContain('function id');
});
await test('preserves ESM imports/exports', async () => {
  const out = await transformTsModule('import type { T } from "./x"; import { a } from "./y"; export type { T }; export const b: T = a;', { filename: 'a.ts' });
  expect(out).toContain('import { a }');
  expect(out).not.toContain('import type');
  expect(out).toContain('export');
  expect(out).toContain('b');
});
await test('clears the native fallback timeout after each transform', async () => {
  const timers = () => (process.getActiveResourcesInfo?.() || []).filter((kind) => kind === 'Timeout').length;
  const before = timers();
  await transformTsModule('const value: number = 1;', { filename: 'timer.ts' });
  await transformTsModule('export const other: string = "x";', { filename: 'timer2.ts' });
  const after = timers();
  if (after > before) throw new Error(`native transform left ${after - before} timer(s) behind`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
