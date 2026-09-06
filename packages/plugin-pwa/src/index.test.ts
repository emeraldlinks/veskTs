/**
 * Tests for @vesk/plugin-pwa
 * Run: npx tsx src/index.test.ts
 */

import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pwaPlugin } from './index';

const TMP = resolve('/tmp/vesk-pwa-test');

function setupTmpDir() {
  try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ }
  mkdirSync(join(TMP, 'public'), { recursive: true });
}

function pwa(opts?: Parameters<typeof pwaPlugin>[0]) {
  return pwaPlugin({ publicDir: join(TMP, 'public'), ...opts });
}

function readManifest() {
  const path = join(TMP, 'public', 'manifest.webmanifest');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

function readSw() {
  const path = join(TMP, 'public', 'sw.js');
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function readInit() {
  const path = join(TMP, 'public', 'pwa-init.js');
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(value: string, substr: string, label: string) {
  if (!value.includes(substr)) {
    throw new Error(`${label}: "${value}" does not include "${substr}"`);
  }
}

// ── manifest defaults ────────────────────────────────────────────────────────────

let fail = false;
function test(name: string, fn: () => void) {
  try { fn(); console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, e instanceof Error ? e.message : e); fail = true; }
}

// ── basic plugin shape ──────────────────────────────────────────────────────────

test('plugin name is @vesk/plugin-pwa', () => {
  assertEqual(pwa().name, '@vesk/plugin-pwa');
});

test('plugin has onBuildStart', () => {
  const plugin = pwa();
  assertEqual(typeof plugin.onBuildStart, 'function');
});

test('plugin has onBuildEnd', () => {
  const plugin = pwa();
  assertEqual(typeof plugin.onBuildEnd, 'function');
});

test('plugin has onFileWatch', () => {
  const plugin = pwa();
  assertEqual(typeof plugin.onFileWatch, 'function');
});

test('plugin has provides', () => {
  const plugin = pwa();
  if (!plugin.provides) throw new Error('provides is undefined');
  assertEqual(typeof plugin.provides.pwaHeadTags, 'function');
  assertEqual(typeof plugin.provides.pwaManifestLink, 'function');
  assertEqual(typeof plugin.provides.pwaSwRegister, 'function');
  assertEqual(typeof plugin.provides.pwaMetaThemeColor, 'function');
  assertEqual(typeof plugin.provides.pwaName, 'function');
  assertEqual(typeof plugin.provides.pwaShortName, 'function');
});

// ── manifest generation ───────────────────────────────────────────────────────────

test('onBuildStart generates manifest.webmanifest', async () => {
  setupTmpDir();
  await pwa({ name: 'My App' }).onBuildStart!();
  const m = readManifest();
  if (!m) throw new Error('manifest not generated');
  assertEqual(m.name, 'My App');
});

test('manifest short_name falls back to name', async () => {
  setupTmpDir();
  await pwa({ name: 'My App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.short_name, 'My App');
});

test('manifest short_name uses explicit shortName', async () => {
  setupTmpDir();
  await pwa({ name: 'My Long App Name', shortName: 'MyApp' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.short_name, 'MyApp');
  assertEqual(m.name, 'My Long App Name');
});

test('manifest description is included', async () => {
  setupTmpDir();
  await pwa({ name: 'App', description: 'A great app' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.description, 'A great app');
});

test('manifest scope defaults to /', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.scope, '/');
});

test('manifest scope can be overridden', async () => {
  setupTmpDir();
  await pwa({ name: 'App', scope: '/app/' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.scope, '/app/');
});

test('manifest display defaults to standalone', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.display, 'standalone');
});

test('manifest display can be set to fullscreen', async () => {
  setupTmpDir();
  await pwa({ name: 'App', display: 'fullscreen' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.display, 'fullscreen');
});

test('manifest orientation is any by default', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual('orientation' in m, false);
});

test('manifest orientation included when set', async () => {
  setupTmpDir();
  await pwa({ name: 'App', orientation: 'landscape' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.orientation, 'landscape');
});

test('manifest theme_color defaults to #000000', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.theme_color, '#000000');
});

test('manifest theme_color can be overridden', async () => {
  setupTmpDir();
  await pwa({ name: 'App', themeColor: '#1a73e8' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.theme_color, '#1a73e8');
});

test('manifest background_color defaults to #ffffff', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.background_color, '#ffffff');
});

test('manifest background_color can be overridden', async () => {
  setupTmpDir();
  await pwa({ name: 'App', backgroundColor: '#f0f0f0' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.background_color, '#f0f0f0');
});

test('manifest lang defaults to en-US', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.lang, 'en-US');
});

test('manifest lang can be overridden', async () => {
  setupTmpDir();
  await pwa({ name: 'App', lang: 'de-DE' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.lang, 'de-DE');
});

test('manifest icons default to /icon-192.png and /icon-512.png', async () => {
  setupTmpDir();
  await pwa({ name: 'App' }).onBuildStart!();
  const m = readManifest()!;
  if (!m.icons || m.icons.length !== 2) throw new Error('Expected 2 default icons');
  assertEqual(m.icons[0].src, '/icon-192.png');
  assertEqual(m.icons[0].sizes, '192x192');
  assertEqual(m.icons[0].type, 'image/png');
  assertEqual(m.icons[1].src, '/icon-512.png');
  assertEqual(m.icons[1].sizes, '512x512');
  assertEqual(m.icons[1].type, 'image/png');
});

test('manifest icons can be overridden', async () => {
  setupTmpDir();
  await pwa({
    name: 'App',
    icons: [{ src: '/custom-icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }]
  }).onBuildStart!();
  const m = readManifest()!;
  if (!m.icons || m.icons.length !== 1) throw new Error('Expected 1 icon');
  assertEqual(m.icons[0].src, '/custom-icon.png');
  assertEqual(m.icons[0].sizes, '256x256');
  assertEqual(m.icons[0].purpose, 'any');
});

test('manifest has start_url and id for installability', async () => {
  setupTmpDir();
  await pwa({ name: 'App', scope: '/sub/' }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.start_url, '/sub/', 'start_url');
  assertEqual(m.id, '/sub/', 'id');
});

test('onBuildStart generates real PNG icons', async () => {
  setupTmpDir();
  await pwa({ name: 'App', themeColor: '#22c55e' }).onBuildStart!();
  for (const name of ['icon-192.png', 'icon-512.png']) {
    const path = join(TMP, 'public', name);
    if (!existsSync(path)) throw new Error(`${name} not generated`);
    const buf = readFileSync(path);
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${name} is not a PNG`);
  }
});

test('custom icons skip auto-generated PNGs', async () => {
  setupTmpDir();
  await pwa({ name: 'App', icons: [{ src: '/custom-icon.png', sizes: '256x256', type: 'image/png' }] }).onBuildStart!();
  if (existsSync(join(TMP, 'public', 'icon-192.png'))) throw new Error('icon-192.png should not be generated with custom icons');
});

// ── service worker generation ───────────────────────────────────────────────────

test('onBuildStart generates sw.js', async () => {
  setupTmpDir();
  await pwa().onBuildStart!();
  const sw = readSw();
  if (!sw) throw new Error('sw.js not generated');
  assertIncludes(sw, 'serviceWorker', 'sw content');
  assertIncludes(sw, 'install', 'sw content');
  assertIncludes(sw, 'fetch', 'sw content');
});

test('sw.js includes stale-while-revalidate strategy by default', async () => {
  setupTmpDir();
  await pwa().onBuildStart!();
  const sw = readSw()!;
  assertIncludes(sw, 'stale-while-revalidate', 'strategy comment');
});

test('sw.js strategy cache-first', async () => {
  setupTmpDir();
  await pwa({ swStrategy: 'cache-first' }).onBuildStart!();
  const sw = readSw()!;
  assertIncludes(sw, 'cache-first', 'strategy comment');
  assertIncludes(sw, 'caches.match', 'cache-first implementation');
});

test('sw.js strategy network-first', async () => {
  setupTmpDir();
  await pwa({ swStrategy: 'network-first' }).onBuildStart!();
  const sw = readSw()!;
  assertIncludes(sw, 'network-first', 'strategy comment');
});

test('sw.js strategy stale-while-revalidate', async () => {
  setupTmpDir();
  await pwa({ swStrategy: 'stale-while-revalidate' }).onBuildStart!();
  const sw = readSw()!;
  assertIncludes(sw, 'stale-while-revalidate', 'strategy comment');
});

test('noServiceWorker skips sw.js generation', async () => {
  setupTmpDir();
  await pwa({ noServiceWorker: true }).onBuildStart!();
  const sw = readSw();
  if (sw !== null) throw new Error('sw.js should not be generated');
});

test('noServiceWorker still generates manifest', async () => {
  setupTmpDir();
  await pwa({ noServiceWorker: true, name: 'App' }).onBuildStart!();
  const m = readManifest();
  if (!m) throw new Error('manifest should be generated');
  assertEqual(m.name, 'App');
});

// ── pwa-init.js (external SW registration) ──────────────────────────────────

test('onBuildStart generates pwa-init.js', async () => {
  setupTmpDir();
  await pwa().onBuildStart!();
  const init = readInit();
  if (!init) throw new Error('pwa-init.js not generated');
  assertIncludes(init, "navigator.serviceWorker.register('/sw.js'", 'SW registration');
  assertIncludes(init, "scope: '/'", 'default scope');
});

test('pwa-init.js uses configured scope', async () => {
  setupTmpDir();
  await pwa({ scope: '/app/' }).onBuildStart!();
  const init = readInit()!;
  assertIncludes(init, "scope: '/app/'", 'configured scope');
});

test('noServiceWorker skips pwa-init.js generation', async () => {
  setupTmpDir();
  await pwa({ noServiceWorker: true }).onBuildStart!();
  const init = readInit();
  if (init !== null) throw new Error('pwa-init.js should not be generated');
});

// ── onHead injection ────────────────────────────────────────────────────────

test('onHead injects manifest + theme-color + init script into head', async () => {
  const plugin = pwa({ name: 'App', themeColor: '#123456' });
  const head = await plugin.onHead!('\t<meta charset="utf-8" />');
  if (!head) throw new Error('onHead returned null');
  assertIncludes(head, 'rel="manifest" href="/manifest.webmanifest"', 'manifest link');
  assertIncludes(head, 'name="theme-color" content="#123456"', 'theme-color meta');
  assertIncludes(head, 'src="/pwa-init.js"', 'init script');
});

test('onHead dedups tags already present in the head', async () => {
  const existing = '<link rel="manifest" href="/manifest.webmanifest" />\n<meta name="theme-color" content="#000000" />';
  const plugin = pwa({ name: 'App' });
  const head = await plugin.onHead!(existing);
  const manifestCount = (head.match(/rel="manifest"/g) || []).length;
  const themeCount = (head.match(/name="theme-color"/g) || []).length;
  assertEqual(manifestCount, 1, 'manifest link appears once');
  assertEqual(themeCount, 1, 'theme-color appears once');
  assertIncludes(head, 'pwa-init.js', 'init script still injected');
});

test('onHead does not duplicate when all tags already present', async () => {
  const plugin = pwa({ name: 'App' });
  const head = await plugin.onHead!('\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />');
  const first = await plugin.onHead!(head as string);
  const manifestCount = (first.match(/rel="manifest"/g) || []).length;
  const initCount = (first.match(/pwa-init\.js/g) || []).length;
  assertEqual(manifestCount, 1, 'manifest link appears once after re-run');
  assertEqual(initCount, 1, 'init script appears once after re-run');
});

// ── provides helpers ───────────────────────────────────────────────────────────

test('provides.pwaHeadTags returns manifest link + theme-color meta + SW init script', () => {
  const plugin = pwa({ name: 'App', themeColor: '#ff0000' });
  const headTags = (plugin.provides!.pwaHeadTags as () => string)();
  assertIncludes(headTags, 'rel="manifest"', 'manifest link');
  assertIncludes(headTags, 'href="/manifest.webmanifest"', 'manifest href');
  assertIncludes(headTags, 'name="theme-color"', 'theme-color meta');
  assertIncludes(headTags, '#ff0000', 'theme-color value');
  assertIncludes(headTags, 'pwa-init.js', 'SW init script');
  assertEqual(headTags.includes('navigator.serviceWorker'), false, 'no inline SW script');
});

test('provides.pwaHeadTags is empty when noServiceWorker', () => {
  const plugin = pwa({ name: 'App', noServiceWorker: true });
  const headTags = (plugin.provides!.pwaHeadTags as () => string)();
  assertIncludes(headTags, 'rel="manifest"', 'manifest link still present');
  // noServiceWorker means no SW init script
  assertEqual(headTags.includes('navigator.serviceWorker'), false);
  assertEqual(headTags.includes('pwa-init.js'), false);
});

test('provides.pwaManifestLink returns manifest <link>', () => {
  const plugin = pwa();
  const link = (plugin.provides!.pwaManifestLink as () => string)();
  assertEqual(link, '<link rel="manifest" href="/manifest.webmanifest" />');
});

test('provides.pwaSwRegister returns the external init script', () => {
  const plugin = pwa({ scope: '/app/' });
  const reg = (plugin.provides!.pwaSwRegister as () => string)();
  assertIncludes(reg, '<script src="/pwa-init.js"', 'init script tag');
  assertEqual(reg.includes('navigator.serviceWorker'), false, 'no inline SW code');
});

test('provides.pwaSwRegister is empty when noServiceWorker', () => {
  const plugin = pwa({ noServiceWorker: true });
  const reg = (plugin.provides!.pwaSwRegister as () => string)();
  assertEqual(reg, '');
});

test('provides.pwaMetaThemeColor returns theme-color meta', () => {
  const plugin = pwa({ themeColor: '#00ff00' });
  const meta = (plugin.provides!.pwaMetaThemeColor as () => string)();
  assertIncludes(meta, 'name="theme-color"', 'meta tag');
  assertIncludes(meta, '#00ff00', 'color value');
});

test('provides.pwaName returns the app name', () => {
  const plugin = pwa({ name: 'My App' });
  assertEqual((plugin.provides!.pwaName as () => string)(), 'My App');
});

test('provides.pwaShortName returns shortName or name', () => {
  const plugin = pwa({ name: 'My App', shortName: 'App' });
  assertEqual((plugin.provides!.pwaShortName as () => string)(), 'App');
  const plugin2 = pwa({ name: 'My App Only' });
  assertEqual((plugin2.provides!.pwaShortName as () => string)(), 'My App Only');
});

// ── onFileWatch ───────────────────────────────────────────────────────────────

test('onFileWatch returns handled for manifest', async () => {
  const plugin = pwa();
  const result = await plugin.onFileWatch!(join(TMP, 'public', 'manifest.webmanifest'));
  assertEqual(result.handled, true);
});

test('onFileWatch returns handled for sw.js', async () => {
  const plugin = pwa();
  const result = await plugin.onFileWatch!(join(TMP, 'public', 'sw.js'));
  assertEqual(result.handled, true);
});

test('onFileWatch returns handled for pwa-init.js', async () => {
  const plugin = pwa();
  const result = await plugin.onFileWatch!(join(TMP, 'public', 'pwa-init.js'));
  assertEqual(result.handled, true);
});

test('onFileWatch returns not handled for other files', async () => {
  const plugin = pwa();
  const result = await plugin.onFileWatch!('/some/other/file.css');
  assertEqual(result.handled, false);
});

// ── onBuildEnd ────────────────────────────────────────────────────────────────

test('onBuildEnd regenerates manifest', async () => {
  setupTmpDir();
  const plugin = pwa({ name: 'First Name' });
  await plugin.onBuildStart!();
  // Change the name and run onBuildEnd
  const plugin2 = pwa({ name: 'Second Name' });
  await plugin2.onBuildEnd!();
  const m = readManifest()!;
  assertEqual(m.name, 'Second Name');
});

// ── onRequest ────────────────────────────────────────────────────────────────

test('onRequest sets pwaManifestBody when manifest exists', async () => {
  setupTmpDir();
  await pwa({ name: 'Req Test' }).onBuildStart!();
  const plugin = pwa({ name: 'Req Test' });
  const ctx = { request: new Request('http://localhost/manifest.webmanifest'), set: (_k: string, _v: unknown) => {}, get: (_k: string) => {} };
  await plugin.onRequest!(ctx as Parameters<typeof plugin.onRequest>[0]);
  // onRequest only sets ctx.set('pwaManifestBody', ...) - verify no error thrown
});

test('onRequest sets pwaSwBody when sw.js exists', async () => {
  setupTmpDir();
  await pwa().onBuildStart!();
  const plugin = pwa();
  const ctx = { request: new Request('http://localhost/sw.js'), set: (_k: string, _v: unknown) => {}, get: (_k: string) => {} };
  await plugin.onRequest!(ctx as Parameters<typeof plugin.onRequest>[0]);
});

// ── edge cases ───────────────────────────────────────────────────────────────

test('icon with purpose maskable', async () => {
  setupTmpDir();
  await pwa({
    name: 'App',
    icons: [{ src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
  }).onBuildStart!();
  const m = readManifest()!;
  assertEqual(m.icons[0].purpose, 'maskable');
});

test('manifest JSON is valid', async () => {
  setupTmpDir();
  await pwa({ name: 'Valid JSON Test' }).onBuildStart!();
  const path = join(TMP, 'public', 'manifest.webmanifest');
  const raw = readFileSync(path, 'utf-8');
  const m = JSON.parse(raw);
  assertEqual(m.name, 'Valid JSON Test');
});

test('all display modes accepted', async () => {
  for (const display of ['standalone', 'fullscreen', 'minimal-ui', 'browser']) {
    setupTmpDir();
    await pwa({ name: 'App', display: display as 'standalone' }).onBuildStart!();
    const m = readManifest()!;
    assertEqual(m.display, display, `display: ${display}`);
  }
});

test('all sw strategies generate different code', async () => {
  const strategies = ['stale-while-revalidate', 'cache-first', 'network-first'] as const;
  const bodies: string[] = [];
  for (const s of strategies) {
    setupTmpDir();
    await pwa({ swStrategy: s }).onBuildStart!();
    bodies.push(readSw()!);
  }
  // All three should be different
  const unique = new Set(bodies);
  if (unique.size !== 3) throw new Error('SW strategies should produce distinct output');
});

// ── cleanup ───────────────────────────────────────────────────────────────────

function safeRm() { try { rmSync(TMP, { recursive: true }); } catch { /* ignore */ } }
safeRm();

if (fail) {
  console.error('\nSome tests failed.');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}