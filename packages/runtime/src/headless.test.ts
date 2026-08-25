import { Show, For, Switch, Match } from '@vesk/runtime/src/headless';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}
function expect(actual: any) {
  return {
    toBe(expected: any) { if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
    toEqual(expected: any) { const a = JSON.stringify(actual), b = JSON.stringify(expected); if (a !== b) throw new Error(`expected ${b}, got ${a}`); },
  };
}

test('Show renders children when when=true', () => {
  expect(Show({ when: true, children: 'hi', fallback: 'bye' })).toBe('hi');
});
test('Show renders fallback when when=false', () => {
  expect(Show({ when: false, children: 'hi', fallback: 'bye' })).toBe('bye');
});
test('Show renders null when no fallback and when=false', () => {
  expect(Show({ when: 0, children: 'hi' })).toBe(null);
});
test('For renders list via children fn', () => {
  const out = For({ each: [1,2,3], children: (x: number) => x*2 });
  expect(out).toEqual([2,4,6]);
});
test('For renders fallback when empty', () => {
  expect(For({ each: [], children: (x: number) => x, fallback: 'empty' })).toBe('empty');
});
test('Match renders children when when=true', () => {
  expect(Match({ when: true, children: 'a' })).toBe('a');
});
test('Match renders null when when=false', () => {
  expect(Match({ when: false, children: 'a' })).toBe(null);
});
test('Switch returns first truthy Match', () => {
  const a = Match({ when: false, children: 'a' });
  const b = Match({ when: true, children: 'b' });
  const c = Match({ when: true, children: 'c' });
  expect(Switch({ children: [a,b,c] })).toBe('b');
});
test('Switch returns fallback when none match', () => {
  const a = Match({ when: false, children: 'a' });
  expect(Switch({ children: [a], fallback: 'fb' })).toBe('fb');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed+failed} total`);
if (failed>0) process.exit(1);
