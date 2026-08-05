/**
 * Tailwind plugin tests — focused on extractTailwindDirectives, whose
 * brace counting must survive braces inside strings and comments.
 */
import { extractTailwindDirectives } from './index';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }

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
    toContain(sub) {
      if (!actual.includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)} in ${JSON.stringify(actual)}`);
    },
    notToContain(sub) {
      if (actual.includes(sub)) throw new Error(`Expected not to contain ${JSON.stringify(sub)} in ${JSON.stringify(actual)}`);
    },
  };
}

describe('extractTailwindDirectives', () => {
  it('keeps @import tailwindcss and @source lines in directives', () => {
    const css = `@import 'tailwindcss';\n@source "./components";\nbody { color: red }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain("@import 'tailwindcss'");
    expect(r.directives).toContain('@source "./components"');
    expect(r.userCSS).toContain('body { color: red }');
  });

  it('extracts a full @theme block', () => {
    const css = `@theme {\n  --color-brand: #0ea5e9;\n}\np { margin: 0 }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('--color-brand');
    expect(r.userCSS).notToContain('--color-brand');
    expect(r.userCSS).toContain('p { margin: 0 }');
  });

  it('does not get confused by braces inside strings', () => {
    const css = `@theme {\n  --svg: url("data:image/svg+xml,<svg>{x}</svg>");\n}\nbody { background: var(--svg) }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('--svg');
    expect(r.directives).toContain('data:image/svg+xml');
    expect(r.userCSS).toContain('body { background: var(--svg) }');
  });

  it('does not get confused by braces inside comments', () => {
    const css = `@layer base {\n  /* } { not real braces */\n  h1 { font-size: 2rem }\n}\n.foo { color: blue }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('h1 { font-size: 2rem }');
    expect(r.directives).toContain('/* } { not real braces */');
    expect(r.userCSS).toContain('.foo { color: blue }');
  });

  it('extracts nested @utility blocks', () => {
    const css = `@utility flex {\n  display: flex;\n}\nmain { padding: 1rem }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('display: flex');
    expect(r.userCSS).toContain('main { padding: 1rem }');
  });

  it('handles a one-line block', () => {
    const css = `@theme { --x: 1 } .keep { a: b }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('--x: 1');
    expect(r.userCSS).toContain('.keep { a: b }');
  });

  it('keeps user CSS that contains braces intact', () => {
    const css = `.card { color: red }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toBe('');
    expect(r.userCSS).toBe('.card { color: red }');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
