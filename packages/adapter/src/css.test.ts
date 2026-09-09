/**
 * Shared stylesheet resolution (`@vesk/adapter/src/css`): the single source of
 * truth every consumer (build, prod server, generated SSR functions, dev
 * server, action handler) feeds environment facts into, plus the tailwind
 * directive stripper both dev and build use.
 *
 * Run: npx tsx packages/adapter/src/css.test.ts
 */

import { resolveCssUrls, isTailwindPlugin, hasUserCss, hasBuiltGlobalCss, resolveUserCssPath, GLOBAL_CSS_URL } from '@vesk/adapter/src/css';
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
  it('enabled → single global.css link', () => {
    assert(
      JSON.stringify(resolveCssUrls({ enabled: true })) ===
        JSON.stringify([GLOBAL_CSS_URL]),
      'single compiled global.css when a stylesheet output exists'
    );
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

describe('hasBuiltGlobalCss', () => {
  it('false when global.css missing', () => {
    makeFixture();
    assert(!hasBuiltGlobalCss(fixture), 'missing file');
  });
  it('false when global.css is empty/whitespace-only', () => {
    makeFixture();
    mkdirSync(resolve(fixture, 'static'), { recursive: true });
    writeFileSync(resolve(fixture, 'static', 'global.css'), '   \n  ', 'utf-8');
    assert(!hasBuiltGlobalCss(fixture), 'empty file treated as absent');
  });
  it('true when global.css has content', () => {
    makeFixture();
    mkdirSync(resolve(fixture, 'static'), { recursive: true });
    writeFileSync(resolve(fixture, 'static', 'global.css'), '@layer theme { .tw { } }', 'utf-8');
    assert(hasBuiltGlobalCss(fixture), 'non-empty file');
  });
});

describe('shared facts match each consumer contract', () => {
  it('per-route bake (ssr-function/hmr) uses same shape the renderer consumes', () => {
    const cssUrls = resolveCssUrls({ enabled: true });
    assert(JSON.stringify(cssUrls) === '["/_vesk/static/global.css"]', 'baked option JSON matches generated functions');
  });
});

// cleanup
process.on('exit', () => {
  try { rmSync(fixture, { recursive: true, force: true }); } catch {}
});