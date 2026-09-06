/**
 * Shared stylesheet resolution (`@vesk/adapter/src/css`): the single source of
 * truth every consumer (build, prod server, generated SSR functions, dev
 * server, action handler) feeds environment facts into, plus the tailwind
 * directive stripper both dev and build use.
 *
 * Run: npx tsx packages/adapter/src/css.test.ts
 */

import { resolveCssUrls, isTailwindPlugin, hasUserCss, hasBuiltTailwindCss, resolveUserCssPath, stripTailwindDirectives, TAILWIND_CSS_URL, GLOBAL_CSS_URL } from '@vesk/adapter/src/css';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}
function it(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
process.on('exit', () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exitCode = 1;
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(tmpdir(), `vesk-css-test-${Date.now()}`);

function makeFixture(): void {
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(resolve(fixture, 'app'), { recursive: true });
  mkdirSync(resolve(fixture, 'src'), { recursive: true });
}

describe('resolveCssUrls orderings', () => {
  it('tailwind + global → tailwind first, then global', () => {
    assert(
      JSON.stringify(resolveCssUrls({ tailwind: true, userCss: true })) ===
        JSON.stringify([TAILWIND_CSS_URL, GLOBAL_CSS_URL]),
      'tailwind must come before global'
    );
  });
  it('tailwind only', () => {
    assert(JSON.stringify(resolveCssUrls({ tailwind: true })) === JSON.stringify([TAILWIND_CSS_URL]), 'only _tailwind.css');
  });
  it('global only', () => {
    assert(JSON.stringify(resolveCssUrls({ userCss: true })) === JSON.stringify([GLOBAL_CSS_URL]), 'only global.css');
  });
  it('no facts → empty', () => {
    assert(resolveCssUrls({}).length === 0, 'no css URLs when no output available');
  });
  it('defaults to empty when no facts passed', () => {
    assert(resolveCssUrls({}).length === 0, 'empty by default');
  });
});

describe('isTailwindPlugin', () => {
  it('matches tailwind plugin case-insensitively', () => {
    assert(isTailwindPlugin([{ name: '@vesk/plugin-tailwind' }]), 'tailwind plugin detected');
    assert(isTailwindPlugin([{ name: 'Tailwind' }]), 'case-insensitive match');
  });
  it('false for unrelated / empty / null', () => {
    assert(!isTailwindPlugin([]), 'empty list');
    assert(!isTailwindPlugin(null), 'null list');
    assert(!isTailwindPlugin([{ name: 'plugin-head' }]), 'unrelated plugin');
  });
});

describe('resolveUserCssPath / hasUserCss', () => {
  it('null and false when no stylesheet source exists', () => {
    makeFixture();
    assert(resolveUserCssPath(resolve(fixture, 'app')) === null, 'resolveUserCssPath null');
    assert(!hasUserCss(resolve(fixture, 'app')), 'hasUserCss false');
  });
  it('detects src/global.css', () => {
    makeFixture();
    writeFileSync(resolve(fixture, 'src', 'global.css'), 'body {}', 'utf-8');
    assert(hasUserCss(resolve(fixture, 'app')), 'global.css detected');
    assert(
      resolveUserCssPath(resolve(fixture, 'app')) === resolve(fixture, 'src', 'global.css'),
      'global.css path reported'
    );
  });
  it('falls back to src/app.css', () => {
    makeFixture();
    writeFileSync(resolve(fixture, 'src', 'app.css'), 'body {}', 'utf-8');
    assert(resolveUserCssPath(resolve(fixture, 'app')) === resolve(fixture, 'src', 'app.css'), 'app.css fallback');
  });
  it('prefers global.css over app.css', () => {
    makeFixture();
    writeFileSync(resolve(fixture, 'src', 'global.css'), 'a { color: red; }', 'utf-8');
    writeFileSync(resolve(fixture, 'src', 'app.css'), 'b { color: blue; }', 'utf-8');
    assert(resolveUserCssPath(resolve(fixture, 'app')) === resolve(fixture, 'src', 'global.css'), 'global wins');
  });
});

describe('hasBuiltTailwindCss', () => {
  it('false when _tailwind.css missing', () => {
    makeFixture();
    assert(!hasBuiltTailwindCss(fixture), 'missing file');
  });
  it('false when _tailwind.css is empty/whitespace-only', () => {
    makeFixture();
    mkdirSync(resolve(fixture, 'static'), { recursive: true });
    writeFileSync(resolve(fixture, 'static', '_tailwind.css'), '   \n  ', 'utf-8');
    assert(!hasBuiltTailwindCss(fixture), 'empty file treated as absent');
  });
  it('true when _tailwind.css has content', () => {
    makeFixture();
    mkdirSync(resolve(fixture, 'static'), { recursive: true });
    writeFileSync(resolve(fixture, 'static', '_tailwind.css'), '@layer theme { .tw { } }', 'utf-8');
    assert(hasBuiltTailwindCss(fixture), 'non-empty file');
  });
});

describe('stripTailwindDirectives', () => {
  it('strips both quote styles of the tailwind import', () => {
    const out = stripTailwindDirectives(`@import 'tailwindcss';

body { color: red; }`);
    assert(!out.includes('@import'), 'single-quote import stripped');
    assert(out.includes('body'), 'user rule kept');
    const out2 = stripTailwindDirectives(`@import "tailwindcss";
p { margin: 0; }`);
    assert(!out2.includes('@import'), 'double-quote import stripped');
  });
  it('strips @source directives', () => {
    const out = stripTailwindDirectives(`@import 'tailwindcss';
@source "./components";
body {}`);
    assert(!out.includes('@source'), '@source stripped');
  });
  it('strips multiline @theme blocks but keeps sibling rules', () => {
    const out = stripTailwindDirectives(`@theme {
  --color-brand: oklch(0.5 0.2 240);
  --font-sans: "Inter", sans-serif;
}
.card { padding: 1rem; }`);
    assert(!out.includes('--color-brand'), '@theme block gone');
    assert(out.includes('.card'), 'following rule kept');
  });
  it('strips @layer components/utilities blocks, keeps @layer base', () => {
    const out = stripTailwindDirectives(`@layer base {
  html { scroll-behavior: smooth; }
}
@layer components {
  .btn { display: inline-block; }
}
@layer utilities {
  .underline { text-decoration: underline; }
}`);
    assert(out.includes('@layer base'), '@layer base preserved');
    assert(!out.includes('.btn'), '@layer components stripped');
    assert(!out.includes('.underline'), '@layer utilities stripped');
  });
  it('strips @utility blocks', () => {
    const out = stripTailwindDirectives(`@utility text-balance {
  text-wrap: balance;
}`);
    assert(!out.includes('text-balance'), '@utility stripped');
  });
  it('returns the stripped user css (test-app global.css shape) trimmed', () => {
    const out = stripTailwindDirectives(`@import 'tailwindcss';

@layer base {
	html { scroll-behavior: smooth; }
}`);
    assert(!out.includes('@import'), 'no import left');
    assert(out.includes('@layer base'), 'base layer kept');
    assert(out.includes('scroll-behavior'), 'rule kept');
  });
});

describe('shared facts match each consumer contract', () => {
  it('per-route bake (ssr-function/hmr) uses same shape the renderer consumes', () => {
    const cssUrls = resolveCssUrls({ tailwind: true, userCss: true });
    assert(JSON.stringify(cssUrls) === '["/_vesk/static/_tailwind.css","/_vesk/static/global.css"]', 'baked option JSON matches generated functions');
  });
});

// cleanup
process.on('exit', () => {
  try { rmSync(fixture, { recursive: true, force: true }); } catch {}
});