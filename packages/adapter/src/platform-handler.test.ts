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

  rmSync(tmpRoot, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});