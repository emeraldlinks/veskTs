/**
 * Tailwind plugin tests — focused on extractTailwindDirectives, whose
 * brace counting must survive braces inside strings and comments.
 */
import { extractTailwindDirectives } from './index';

let passed = 0;
let failed = 0;
const asyncQueue: Promise<void>[] = [];

function describe(name: string, fn: () => void) { console.log(`\n${name}`); fn(); }

function it(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result && typeof (result as Promise<void>).then === 'function') {
    asyncQueue.push(
      (result as Promise<void>)
        .then(() => { passed++; console.log(`  ✓ ${name} (async)`); })
        .catch(e => { failed++; console.log(`  ✗ ${name} (async)`); console.log(`    ${e.message}`); }),
    );
  } else {
    try { passed++; console.log(`  ✓ ${name}`); } catch {}
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toContain(sub: string) {
      if (typeof actual !== 'string' || !actual.includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)} in ${JSON.stringify(actual)}`);
    },
    notToContain(sub: string) {
      if (typeof actual === 'string' && actual.includes(sub)) throw new Error(`Expected not to contain ${JSON.stringify(sub)} in ${JSON.stringify(actual)}`);
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

  it('extracts an @theme inline block and emits its variables', async () => {
    const css = `@theme inline {\n  --color-background: var(--background);\n  --font-display: "Space Grotesk", sans-serif;\n}\nbody { color: red }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('--color-background');
    expect(r.directives).toContain('--font-display');
    expect(r.userCSS).notToContain('--color-background');
    expect(r.userCSS).toContain('body { color: red }');
    const { compile } = await import('@tailwindcss/node');
    const res = await compile(
      `@import 'tailwindcss';\n${r.directives}\n@layer base {\n  body { background-color: var(--color-background); font-family: var(--font-display); }\n}`,
      {
        base: process.cwd(),
        from: `${process.cwd()}/global.css`,
        onDependency: () => {},
      },
    );
    const out = res.build([]);
    expect(out).toContain('--color-background: var(--background)');
    expect(out).toContain('--font-display: "Space Grotesk"');
  });

  it('extracts @theme static and @theme reference as tailwind directives', () => {
    const css = `@theme static {\n  --color-a: #111;\n}\n@theme reference {\n  --color-b: #222;\n}\n.x { color: red }`;
    const r = extractTailwindDirectives(css);
    expect(r.directives).toContain('--color-a');
    expect(r.directives).toContain('--color-b');
    expect(r.userCSS).toContain('.x { color: red }');
    expect(r.userCSS).notToContain('--color-a');
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

(async () => {
  for (const p of asyncQueue) await p;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
})();
