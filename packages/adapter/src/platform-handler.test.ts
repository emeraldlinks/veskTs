/**
 * Platform-handler compiler resolution (`@vesk/adapter/src/platform-handler`):
 * the universal edge handler source must resolve `@vesk/compiler/dist/*` from
 * `node_modules` (published-package installs on Vercel/Netlify/etc.) just like
 * the runtime/client bundlers do — not only from a monorepo checkout.
 *
 * The built dist is copied into a temp registry-style layout (so `__dirname`
 * no longer sits inside the monorepo) and invoked from there, exactly like a
 * published install.
 *
 * Run: npx tsx packages/adapter/src/platform-handler.test.ts
 */

import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`);
  return fn();
}
async function it(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
process.on('exit', () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestInput {
  ssrRoutes: Array<{ fullPath: string }>;
  apiRoutes: Array<{ fullPath: string }>;
  prerenderedPaths: string[];
  hasMiddleware: boolean;
  appDir: string;
}

async function main() {
  const tmpRoot = join(tmpdir(), `vesk-plat-test-${process.pid}`);
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  // Lay out node_modules like a published install: adapter dist + compiler dist.
  const adapterDir = () => join(tmpRoot, 'node_modules', '@vesk', 'adapter');
  const compilerDist = () => join(tmpRoot, 'node_modules', '@vesk', 'compiler', 'dist');
  function stageAdapter() {
    mkdirSync(adapterDir(), { recursive: true });
    cpSync(resolve(__dirname, '..', 'dist', 'platform-handler.js'), join(adapterDir(), 'platform-handler.js'));
  }
  function stageCompiler() {
    mkdirSync(compilerDist(), { recursive: true });
    writeFileSync(join(compilerDist(), 'server-cookies.js'), 'export const parseCookies = () => ({});\n');
  }
  function importStaged() {
    return import(pathToFileURL(join(adapterDir(), 'platform-handler.js')).href) as Promise<{
      generatePlatformHandlerSource: (input: TestInput) => string;
    }>;
  }

  await describe('generatePlatformHandlerSource compiler resolution (registry install)', async () => {
    await it('resolves @vesk/compiler/dist/server-cookies.js from node_modules via appDir', async () => {
      stageAdapter();
      stageCompiler();
      const { generatePlatformHandlerSource } = await importStaged();
      const src = generatePlatformHandlerSource({
        ssrRoutes: [{ fullPath: '/' }],
        apiRoutes: [],
        prerenderedPaths: [],
        hasMiddleware: true,
        appDir: tmpRoot,
      });
      const importLine = src.split('\n').find((l) => l.includes('server-cookies.js'));
      assert(!!importLine, 'expected a parseCookies import from server-cookies.js');
      assert(importLine!.includes(compilerDist()), `import must resolve to the appDir node_modules copy (got: ${importLine})`);
    });

    await it('throws the guarded error when compiler dist is absent anywhere', async () => {
      rmSync(join(tmpRoot, 'node_modules'), { recursive: true, force: true });
      stageAdapter();
      const { generatePlatformHandlerSource } = await importStaged();
      let threw = false;
      try {
        generatePlatformHandlerSource({
          ssrRoutes: [],
          apiRoutes: [],
          prerenderedPaths: [],
          hasMiddleware: true,
          appDir: tmpRoot,
        });
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes('@vesk/compiler/dist not found'), 'error message should mention the missing compiler dist');
      }
      assert(threw, 'expected a throw when @vesk/compiler/dist is unreachable');
    });

    await it('emits middleware wiring when hasMiddleware is set', async () => {
      rmSync(join(tmpRoot, 'node_modules'), { recursive: true, force: true });
      stageAdapter();
      stageCompiler();
      const { generatePlatformHandlerSource } = await importStaged();
      const src = generatePlatformHandlerSource({
        ssrRoutes: [],
        apiRoutes: [],
        prerenderedPaths: [],
        hasMiddleware: true,
        appDir: tmpRoot,
      });
      assert(src.includes('__executeMw'), 'expected middleware executor in handler source');
      assert(src.includes('server-cookies.js'), 'expected parseCookies import for middleware');
    });
  });

  await describe('generated handleRequest error mapping (edge parity)', async () => {
    const appDir = join(tmpRoot, 'app');
    mkdirSync(appDir, { recursive: true });
    const fnsDir = join(tmpRoot, 'server', 'functions');
    mkdirSync(fnsDir, { recursive: true });

    writeFileSync(join(fnsDir, 'docs_slug.js'), `
export async function handle(request) {
  const slug = new URL(request.url).pathname.split('/').pop();
  if (slug === 'nope') {
    const e = new Error('doc slug missing: ' + slug);
    e.name = 'NotFoundError';
    throw e;
  }
  return new Response('<h1>doc ' + slug + '</h1>', { headers: { 'Content-Type': 'text/html' } });
}
`);

    writeFileSync(join(fnsDir, 'legacy.js'), `
export async function handle(request) {
  const e = new Error('moved');
  e.name = 'Redirect';
  e.url = '/new';
  e.status = 302;
  throw e;
}
`);

    const { generatePlatformHandlerSource } = await importStaged();
    const src = generatePlatformHandlerSource({
      ssrRoutes: [{ fullPath: '/docs/:slug' }, { fullPath: '/legacy' }],
      apiRoutes: [],
      prerenderedPaths: [],
      hasMiddleware: false,
      appDir,
    });
    assert(src.includes('__invokeRoute'), 'expected an __invokeRoute guard in the generated handler');
    const entry = join(tmpRoot, 'handler-entry.js');
    writeFileSync(entry, src);
    const { handleRequest } = await import(pathToFileURL(entry).href);

    await it('renders a matched SSR route (200)', async () => {
      const res = await handleRequest(new Request('http://test.local/docs/hello'));
      assert(res.status === 200, `expected 200, got ${res.status}`);
    });

    await it('maps NotFoundError from the SSR function to 404 (no edge crash)', async () => {
      const res = await handleRequest(new Request('http://test.local/docs/nope'));
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await it('maps Redirect from the SSR function to a 3xx with Location', async () => {
      const res = await handleRequest(new Request('http://test.local/legacy'));
      assert(res.status === 302, `expected 302, got ${res.status}`);
      assert(res.headers.get('location') === '/new', `expected Location /new, got ${res.headers.get('location')}`);
    });

    await it('falls back to 404 for unmatched paths', async () => {
      const res = await handleRequest(new Request('http://test.local/zzz'));
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await it('serves the SSR-data handoff for /ssr-data.js?t=<token> (edge hydration parity)', async () => {
      const g = globalThis as Record<string, unknown>;
      const store = (g.__vsk_ssr_data_store || (g.__vsk_ssr_data_store = {})) as Record<string, Record<string, unknown>> ;
      store['tok123'] = { ssrData: { 'vesk-compiler-latest': { version: '0.2.36' } }, props: { a: 1 } };
      const res = await handleRequest(new Request('http://test.local/ssr-data.js?t=tok123'));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert((res.headers.get('content-type') || '').includes('javascript'), `expected application/javascript, got ${res.headers.get('content-type')}`);
      assert(res.headers.get('cache-control') === 'no-store', `expected no-store, got ${res.headers.get('cache-control')}`);
      const body = await res.text();
      assert(body.includes('globalThis.__vsk_ssr_data'), 'expected __vsk_ssr_data global in body');
      assert(body.includes('"version":"0.2.36"') || body.includes('0.2.36'), 'expected serialized payload in body');
      assert(body.includes('globalThis.__vesk_props'), 'expected __vesk_props global in body');
      assert(store['tok123'] === undefined, 'expected store entry to be consumed on read');
    });

    await it('serves a no-op script for an unknown ssr-data token (never a 404)', async () => {
      const res = await handleRequest(new Request('http://test.local/ssr-data.js?t=zzznope'));
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await res.text();
      assert(body.includes('// no ssr data'), `expected no-op script body, got: ${body}`);
    });
  });

  rmSync(tmpRoot, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});