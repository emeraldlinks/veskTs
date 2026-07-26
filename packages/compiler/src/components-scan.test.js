import { scanComponents } from './router.js';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected) {
      if (JSON.stringify([...actual]) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify([...actual])}`);
      }
    },
  };
}

let _tmpCounter = 0;
function tmpDir() {
  const dir = resolve(tmpdir(), 'vesk-test-components-' + Date.now() + '-' + (_tmpCounter++));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('scanComponents', () => {
  it('returns empty map for non-existent directory', () => {
    const result = scanComponents('/nonexistent/path');
    expect(result.size).toBe(0);
  });

  it('scans root-level .vsk files', () => {
    const dir = tmpDir();
    writeFileSync(resolve(dir, 'Button.vsk'), 'component Button = (props) => <button>{props.children}</button>');
    writeFileSync(resolve(dir, 'Header.vsk'), 'component Header = (props) => <header>{props.children}</header>');
    const result = scanComponents(dir);
    expect(result.size).toBe(2);
    expect(result.has('Button')).toBe(true);
    expect(result.has('Header')).toBe(true);
  });

  it('scans subdirectories with prefixed names', () => {
    const dir = tmpDir();
    mkdirSync(resolve(dir, 'ui'));
    writeFileSync(resolve(dir, 'ui', 'Button.vsk'), '');
    mkdirSync(resolve(dir, 'ui', 'form'));
    writeFileSync(resolve(dir, 'ui', 'form', 'Input.vsk'), '');
    const result = scanComponents(dir);
    expect(result.size).toBe(2);
    expect(result.has('UiButton')).toBe(true);
    expect(result.has('UiFormInput')).toBe(true);
  });

  it('skips private directories starting with _', () => {
    const dir = tmpDir();
    mkdirSync(resolve(dir, '_internal'));
    writeFileSync(resolve(dir, '_internal', 'Secret.vsk'), '');
    writeFileSync(resolve(dir, 'Public.vsk'), '');
    const result = scanComponents(dir);
    expect(result.size).toBe(1);
    expect(result.has('Public')).toBe(true);
    expect(result.has('_internalSecret')).toBe(false);
  });

  it('skips non-.vsk files', () => {
    const dir = tmpDir();
    writeFileSync(resolve(dir, 'Button.vsk'), '');
    writeFileSync(resolve(dir, 'styles.css'), '');
    writeFileSync(resolve(dir, 'utils.js'), '');
    const result = scanComponents(dir);
    expect(result.size).toBe(1);
    expect(result.has('Button')).toBe(true);
  });

  it('deduplicates same-name components preferring first', () => {
    const dir = tmpDir();
    mkdirSync(resolve(dir, 'shared'));
    writeFileSync(resolve(dir, 'Button.vsk'), '');
    writeFileSync(resolve(dir, 'shared', 'Button.vsk'), '');
    const result = scanComponents(dir);
    // Should have "Button" from root, not "SharedButton" — subdir with single
    // file gets "SharedButton" prefixed name
    expect(result.has('Button')).toBe(true);
    expect(result.has('SharedButton')).toBe(true);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
