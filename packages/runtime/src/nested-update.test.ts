/**
 * `setIn` / `updateIn` / `getIn` — nested updates for a tracked value.
 *
 * `track()` holds ONE cell per declaration, so a nested field write has no
 * ergonomic spelling and costs three levels of spread per keystroke:
 *
 *   set(store, { ...store, user: { ...store.user, name: 'Grace' } })
 *
 * These helpers remove that. They are ADDITIVE — nothing about how a cell is
 * created, read or written changes, and `track()`/`get`/`set`/`peek`/`untrack`
 * are untouched. `set(store, updateIn(get(store), ['user', 'name'], 'Grace'))`
 * is the same value the spread produces, in one call.
 *
 * Immutability is deliberate. The compiler tracks cell identity, so mutating in
 * place would leave `get()` returning the same object with no notification —
 * a silent no-op that reads as "the UI is broken".
 *
 * (An earlier attempt rewrote `store.user.name = 'Grace'` into this shape at the
 * syntax tree. It worked for the written value but regressed an unrelated sibling
 * read, so it is NOT shipped — see the TODO item. The helpers stand on their own.)
 *
 * Run with: npx tsx packages/runtime/src/nested-update.test.ts
 */
import { getIn, setIn, updateIn, pathOf } from '@vesk/runtime/src/nested-update';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function it(name: string, fn: () => void): void {
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

const base = { user: { name: 'Ada', city: 'London' }, count: 0, tags: ['x'] };

console.log('\n=== nested updates ===');

it('setIn sets a nested field without touching the original', () => {
  const next = setIn(base, ['user', 'name'], 'Grace');
  eq(next.user, { name: 'Grace', city: 'London' }, 'nested object replaced by path');
  eq(base.user.name, 'Ada', 'the original must not be mutated');
  eq(next.count, 0, 'siblings survive');
  assert(next !== base && next.user !== base.user, 'the changed levels must be new objects');
});

it('setIn on an array index copies the array', () => {
  const next = setIn(base, ['tags', 0], 'y');
  eq(next.tags, ['y'], 'array item replaced');
  eq(base.tags, ['x'], 'the original array is untouched');
  assert(next.tags !== base.tags, 'a copied array is required for identity-based tracking');
});

it('setIn appends through an index past the end', () => {
  const next = setIn({ items: ['a'] }, ['items', 1], 'b');
  eq(next.items, ['a', 'b'], 'sparse append');
});

it('setIn with an empty path replaces the whole value', () => {
  eq(setIn(base, [], { replaced: true }), { replaced: true }, 'empty path is a plain set');
});

it('setIn on a missing branch is a visible no-op, not a crash mid-render', () => {
  const value = { a: 1 };
  assert(setIn(value, ['missing', 'deep'], 2) === value, 'a write to a missing branch returns the original');
  assert(setIn(null as unknown as Record<string, unknown>, ['a'], 1) === null, 'writes into a non-object are inert');
});

it('updateIn derives from the current value at that path', () => {
  const next = updateIn(base, ['count'], (n) => (n as number) + 5);
  eq(next.count, 5, 'derived write');
  const deeper = updateIn(base, ['user', 'name'], (n) => `${String(n)}!`);
  eq(deeper.user.name, 'Ada!', 'deeper path');
});

it('getIn reads without subscribing', () => {
  eq(getIn(base, ['user', 'name']), 'Ada', 'object path');
  eq(getIn(base, ['tags', 0]), 'x', 'array index');
  eq(getIn(base, ['nope', 'deeper']), undefined, 'missing path');
  eq(getIn(base, ['user', 'name', 'too', 'deep']), undefined, 'reading through a scalar');
  eq(getIn(base, []), base, 'empty path is the value itself');
});

it('repeated writes compose', () => {
  let store = base;
  store = setIn(store, ['user', 'name'], 'Grace');
  store = setIn(store, ['user', 'city'], 'Paris');
  store = setIn(store, ['count'], 3);
  eq(store, { user: { name: 'Grace', city: 'Paris' }, count: 3, tags: ['x'] }, 'all three writes landed');
});

it('pathOf extracts statically-known paths and refuses dynamic ones', () => {
  const member = (object: unknown, prop: unknown, computed = false) => ({ type: 'MemberExpression', object, property: prop, computed });
  const id = (name: string) => ({ type: 'Identifier', name });
  eq(pathOf(member(id('store'), id('user'))), ['user'], 'one segment');
  eq(pathOf(member(member(id('store'), id('user')), id('name'))), ['user', 'name'], 'two segments');
  // `store[0]` addresses index 0 of the root: the path is [0], not ['items', 0].
  eq(pathOf(member(id('store'), { type: 'Literal', value: 0 }, true)), [0], 'a literal index on the root');
  eq(pathOf(member(member(id('store'), id('items')), { type: 'Literal', value: 0 }, true)), ['items', 0], 'a literal index inside a member');
  eq(pathOf(member(id('store'), id('key'), true)), null, 'a computed key cannot be keyed statically');
  eq(pathOf(member(id('store'), id('items'))), ['items'], 'plain member');
  eq(pathOf(id('store')), [], 'a bare identifier is an empty path');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All nested-update tests passed!');