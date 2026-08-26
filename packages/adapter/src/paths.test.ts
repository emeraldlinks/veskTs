import { resolveWithin, isAllowedWsUpgrade } from '@vesk/adapter/src/paths';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }
function it(name, fn) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e) { failed++; console.log(`  \u2717 ${name}\n    ${e.message}`); }
}
function expect(actual) {
  return {
    toBe(expected) { if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
    toBeNull() { if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`); },
    toContain(expected) { if (!String(actual).includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`); },
  };
}

const base = `${tmpdir()}/vesk-paths-test-${process.pid}`;
mkdirSync(`${base}/public`, { recursive: true });
writeFileSync(`${base}/public/index.html`, 'ok');

describe('resolveWithin', () => {
  it('resolves files inside the base dir', () => {
    const p = resolveWithin(base, 'public/index.html');
    expect(p.includes('public')).toBe(true);
    expect(p.includes('index.html')).toBe(true);
  });

  it('rejects ../ traversal outside the base dir', () => {
    expect(resolveWithin(base, '../secret.txt')).toBeNull();
    expect(resolveWithin(base, 'public/../../etc/passwd')).toBeNull();
  });

  it('rejects the base directory itself (files only)', () => {
    expect(resolveWithin(base, '.')).toBeNull();
    expect(resolveWithin(base, '')).toBeNull();
  });

  it('rejects sibling directories with shared prefixes', () => {
    // a sibling like <base>-public must not pass a naive startsWith check
    expect(resolveWithin(`${base}/public`, '..')).toBeNull();
  });
});

describe('isAllowedWsUpgrade', () => {
  it('allows same-origin upgrades', () => {
    expect(isAllowedWsUpgrade({ origin: 'http://localhost:3000', host: 'localhost:3000' })).toBe(true);
  });

  it('allows non-browser clients without Origin', () => {
    expect(isAllowedWsUpgrade({ host: 'localhost:3000' })).toBe(true);
  });

  it('blocks cross-site Origin (CSWS)', () => {
    expect(isAllowedWsUpgrade({ origin: 'https://evil.com', host: 'localhost:3000' })).toBe(false);
  });

  it('blocks Origin when Host header missing', () => {
    expect(isAllowedWsUpgrade({ origin: 'https://evil.com' })).toBe(false);
  });
});

rmSync(base, { recursive: true, force: true });
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
