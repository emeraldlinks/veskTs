/**
 * Regression test: the client bundle must SHIP the QR encoder, not stub it.
 *
 * `vesk-qr` lazy-loads its encoder via `await import('qrcode-generator')`. The
 * mono client bundler used to stub `qrcode-generator` (plus canvas/@zxing) to
 * `export {}`, which is correct only for the optional raster/scan deps. For the
 * encoder it meant `getQrcode()` resolved to an empty namespace, so
 * `CofoundrMatrix.generate()` threw "QREncodingError: generator is not a
 * function" during hydration — the server rendered QR SVGs, then the client
 * replaced them with the error boundary.
 *
 * Only `canvas` and `@zxing/*` may be stubbed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';

// Fixture lives INSIDE the repo so esbuild can resolve `@vesk/runtime` by
// walking up to the repo's node_modules. A fixture-local `qrcode-generator`
// keeps the test independent of the real package (not installed at the root)
// while still exercising the exact bare-specifier resolution path.
const FIXTURE_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'tmp', 'qr-encoder-bundle-test');

let passed = 0;
let failed = 0;

async function it(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(error as Error).message}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

process.on('exit', () => {
  try {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function fixtureRoot(): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  return FIXTURE_ROOT;
}

async function buildAppThatLoadsEncoder(): Promise<string> {
  const dir = mkdtempSync(join(fixtureRoot(), 'app-'));
  const appDir = join(dir, 'app');
  const srcDir = join(dir, 'src');
  const pkgDir = join(dir, 'node_modules', 'qrcode-generator');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(pkgDir, { recursive: true });

  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'qrcode-generator', version: '0.0.0', main: 'qrcode.js' }),
  );
  writeFileSync(
    join(pkgDir, 'qrcode.js'),
    "module.exports = function QrcodeGenerator() { return 'QR_FAKE_ENCODER_MARKER'; };\n",
  );
  writeFileSync(
    join(srcDir, 'enc.ts'),
    "export async function loadEncoder(): Promise<unknown> {\n" +
      "  const mod = await import('qrcode-generator');\n" +
      "  return (mod as { default?: unknown }).default || mod;\n" +
      "}\n" +
      "export async function loadCanvas(): Promise<unknown> {\n" +
      "  const mod = await import('canvas');\n" +
      "  return (mod as { default?: unknown }).default || mod;\n" +
      "}\n",
  );
  writeFileSync(
    join(appDir, 'page.vsk'),
    "import { loadEncoder, loadCanvas } from '../src/enc';\n" +
      "component Page() { <button onClick={() => { loadEncoder(); loadCanvas(); }}>qr</button> }\n",
  );

  const routeTree = [
    { fullPath: '/', sourceDir: '', page: 'Page', children: [] },
  ];
  const built = await generateClientBundle(routeTree as never, appDir, new Map(), {
    codeSplit: false,
    importRuntime: false,
  });
  return built.main;
}

await it('mono client bundle inlines the dynamic QR encoder instead of stubbing it', async () => {
  const code = await buildAppThatLoadsEncoder();
  assert(
    !code.includes('browser-stub:qrcode-generator'),
    'qrcode-generator was stubbed to `export {}`; the encoder must be bundled so client QR generation works',
  );
  assert(
    code.includes('QR_FAKE_ENCODER_MARKER'),
    'the real qrcode-generator module body is missing from the client bundle',
  );
});

await it('optional raster/scan packages are still stubbed', async () => {
  const code = await buildAppThatLoadsEncoder();
  assert(
    code.includes('browser-stub:canvas'),
    'canvas must stay stubbed — it is optional and must not be pulled into the browser bundle',
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
