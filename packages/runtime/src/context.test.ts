/**
 * Context + typed-locals runtime behavior.
 *
 * The typing (value type flows from createContext through get/set, and locals
 * keys link to their value types) is verified by real `tsc` in
 * `packages/compiler/src/typecheck.test.ts`. These tests cover runtime
 * behavior: provider/consumer lookup, the default when no ancestor set it, and
 * the locals store.
 *
 * Run: npx tsx packages/runtime/src/context.test.ts
 */
import { createContext, createLocals, setActiveComponent } from '@vesk/runtime/src/context';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) { if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
    toEqual(expected: unknown) {
      const a = JSON.stringify(actual); const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`expected ${b}, got ${a}`);
    },
    toBeUndefined() { if (actual !== undefined) throw new Error(`expected undefined, got ${JSON.stringify(actual)}`); },
  };
}

/** Minimal component-chain node shaped like the runtime's internal one. */
function node(parent: any, values?: Map<any, unknown>) {
  return { p: parent, c: values ?? null };
}

test('get() returns the default with no active component', () => {
  setActiveComponent(null);
  const Ctx = createContext('fallback');
  expect(Ctx.get()).toBe('fallback');
});

test('set() then get() round-trips inside the same component', () => {
  const Ctx = createContext(0);
  setActiveComponent(node(null) as any);
  Ctx.set(42);
  expect(Ctx.get()).toBe(42);
  setActiveComponent(null);
});

test('a descendant reads the nearest ancestor value', () => {
  const Ctx = createContext('default');
  const grandParent = node(null);
  const parent = node(grandParent);
  const child = node(parent);

  setActiveComponent(grandParent as any);
  Ctx.set('from-grandparent');
  setActiveComponent(parent as any);
  Ctx.set('from-parent');
  setActiveComponent(child as any);
  expect(Ctx.get()).toBe('from-parent');
  setActiveComponent(null);
});

test('an intermediate component without a value falls through to an ancestor', () => {
  const Ctx = createContext('default');
  const ancestor = node(null);
  const middle = node(ancestor);
  const leaf = node(middle);

  setActiveComponent(ancestor as any);
  Ctx.set('from-ancestor');
  setActiveComponent(leaf as any);
  expect(Ctx.get()).toBe('from-ancestor');
  setActiveComponent(null);
});

test('two contexts with the same default stay independent', () => {
  const A = createContext('same');
  const B = createContext('same');
  setActiveComponent(node(null) as any);
  A.set('a-only');
  expect(B.get()).toBe('same');
  setActiveComponent(null);
});

test('set() outside a component throws', () => {
  setActiveComponent(null);
  const Ctx = createContext('x');
  let threw = false;
  try { Ctx.set('y'); } catch { threw = true; }
  expect(threw).toBe(true);
});

test('contexts carry a distinct identity', () => {
  const A = createContext(1);
  const B = createContext(1);
  if (A.id === B.id) throw new Error('expected distinct context ids');
});

test('object values survive the round trip by reference', () => {
  const Ctx = createContext<{ n: number } | null>(null);
  const value = { n: 7 };
  setActiveComponent(node(null) as any);
  Ctx.set(value);
  expect(Ctx.get()).toBe(value);
  setActiveComponent(null);
});

test('createLocals stores and reads values by key', () => {
  const l = createLocals<{ user: { name: string } | null; requestId: string }>();
  expect(l.get('user')).toBeUndefined();
  l.set('user', { name: 'Ada' });
  l.set('requestId', 'r1');
  expect(l.get('user')).toEqual({ name: 'Ada' });
  expect(l.get('requestId')).toBe('r1');
});

test('createLocals has/delete/all', () => {
  const l = createLocals<{ a: number; b: string }>();
  l.set('a', 1);
  expect(l.has('a')).toBe(true);
  expect(l.has('b')).toBe(false);
  l.set('b', 'x');
  expect(l.all()).toEqual({ a: 1, b: 'x' });
  l.delete('a');
  expect(l.has('a')).toBe(false);
  expect(l.all()).toEqual({ b: 'x' });
});

test('createLocals all() returns a copy, not the live store', () => {
  const l = createLocals<{ n: number }>();
  l.set('n', 1);
  const snapshot = l.all();
  l.set('n', 2);
  expect(snapshot.n).toBe(1);
  expect(l.get('n')).toBe(2);
});

test('createLocals default shape accepts any key', () => {
  const l = createLocals();
  l.set('anything', { deep: true });
  expect(l.get('anything')).toEqual({ deep: true });
});

setActiveComponent(null);
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
