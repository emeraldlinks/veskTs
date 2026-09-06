/**
 * Plugin headExtra bake path: ensure `generateSsrFunction` and
 * `generateManifest` bake `headExtra` into their outputs when supplied, and
 * omit it entirely when absent.
 *
 * Run: npx tsx packages/adapter/src/plugin-head.test.ts
 */

import { generateSsrFunction } from '@vesk/adapter/src/ssr-function';
import { generateManifest } from '@vesk/adapter/src/manifest';
import type { RouteNode } from '@vesk/adapter/src/types';

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
  if (failed > 0) process.exit(1);
});

const TEST_APP = '/root/vesk/test-app/app';

const baseRoute: RouteNode = {
  path: '/',
  fullPath: '/',
  name: 'index',
  sourceDir: '',
  component: 'page.vsk',
  layout: 'layout.vsk',
  children: [],
  _revalidate: undefined,
} as unknown as RouteNode;

const FAKE_MANIFEST = '<link rel="manifest" href="/manifest.webmanifest" />\n<meta name="theme-color" content="#4f46e5" />';
const FAKE_SCRIPT = '<script src="/pwa-init.js" defer></script>';

describe('generateSsrFunction', () => {

  it('emits headExtra in options when headExtra is provided', () => {
    const { funcCode } = generateSsrFunction(baseRoute, TEST_APP, '/tmp/adapter-head-test', undefined, {
      headExtra: FAKE_MANIFEST,
    });
    assert(funcCode.includes(', headExtra:'), 'generated code missing headExtra option');
    assert(funcCode.includes('/manifest.webmanifest'), 'manifest URL not baked');
  });

  it('omits headExtra from options when not provided', () => {
    const { funcCode } = generateSsrFunction(baseRoute, TEST_APP, '/tmp/adapter-head-test', undefined, {
      headExtra: '',
    });
    assert(!funcCode.includes('headExtra:'), 'empty headExtra should be omitted');
  });

  it('omits headExtra when options is empty', () => {
    const { funcCode } = generateSsrFunction(baseRoute, TEST_APP, '/tmp/adapter-head-test', undefined, {});
    assert(!funcCode.includes('headExtra:'), 'missing headExtra should be omitted');
  });

  it('bakes multiple tags into headExtra correctly', () => {
    const { funcCode } = generateSsrFunction(baseRoute, TEST_APP, '/tmp/adapter-head-test', undefined, {
      headExtra: FAKE_MANIFEST + '\n' + FAKE_SCRIPT,
    });
    assert(funcCode.includes('/manifest.webmanifest'), 'manifest missing');
    assert(funcCode.includes('/pwa-init.js'), 'pwa-init script missing');
  });

});

describe('generateManifest', () => {

  it('includes headExtra key when provided', () => {
    const m: Record<string, unknown> = generateManifest([], [], [], [], false, undefined, FAKE_MANIFEST);
    assert('headExtra' in m, 'headExtra key missing');
    assert((m.headExtra as string).includes('manifest.webmanifest'), 'manifest URL not in headExtra');
  });

  it('omits headExtra key when not provided', () => {
    const m: Record<string, unknown> = generateManifest([], [], [], [], false, undefined, undefined);
    assert(!('headExtra' in m), 'headExtra should not be present');
  });

  it('omits headExtra key when empty string', () => {
    const m: Record<string, unknown> = generateManifest([], [], [], [], false, undefined, '');
    assert(!('headExtra' in m), 'empty headExtra should be omitted');
  });

  it('includes manifest + theme-color tags together', () => {
    const m: Record<string, unknown> = generateManifest([], [], [], [], false, undefined, FAKE_MANIFEST);
    assert((m.headExtra as string).includes('/manifest.webmanifest'), 'manifest missing');
    assert((m.headExtra as string).includes('#4f46e5'), 'theme-color missing');
  });

});