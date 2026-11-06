/**
 * Node platform emit: ship TCP driver closures into the serverless function.
 *
 * A Vesk Node function is otherwise self-contained (esbuild inlines static
 * imports), but a driver loaded through a variable `import(spec)` — e.g.
 * `slintorm`'s `importDriver("pg")` — cannot be bundled or traced, and Build
 * Output API functions install no dependencies. Without shipping the package
 * closure the Postgres driver fails at runtime with `Cannot find module 'pg'`.
 *
 * Run: npx tsx packages/adapter/src/platform-deploy.test.ts
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { shipNodeDriverClosures, vercelBootstrapSource } from '@vesk/adapter/src/platform-deploy';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function it(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

function write(root: string, rel: string, body = '') {
  const full = resolve(root, rel);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, body);
}
function pkg(root: string, name: string, manifest: Record<string, unknown>) {
  write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, ...manifest }));
}

console.log('\n=== Node driver closure shipping ===');

it('copies a driver and its transitive dependency closure', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'vesk-driver-'));
  const funcDir = resolve(root, '.vercel/output/functions/__index.func');
  pkg(root, 'pg', {
    dependencies: { 'pg-fake-dep': '^1.0.0' },
    devDependencies: { 'pg-dev-only': '^1.0.0' },
  });
  write(root, 'node_modules/pg/index.js', 'module.exports = {};');
  pkg(root, 'pg-fake-dep', { dependencies: { 'pg-transitive': '^1.0.0' } });
  write(root, 'node_modules/pg-fake-dep/index.js', 'module.exports = {};');
  pkg(root, 'pg-transitive', {});
  write(root, 'node_modules/pg-transitive/index.js', 'module.exports = {};');
  pkg(root, 'pg-dev-only', {});
  write(root, 'node_modules/pg-dev-only/index.js', 'module.exports = {};');

  shipNodeDriverClosures(root, funcDir);

  assert(existsSync(resolve(funcDir, 'node_modules/pg/index.js')), 'driver was not shipped');
  assert(existsSync(resolve(funcDir, 'node_modules/pg/package.json')), 'driver package.json was not shipped');
  assert(existsSync(resolve(funcDir, 'node_modules/pg-fake-dep/index.js')), 'direct dependency was not shipped');
  assert(existsSync(resolve(funcDir, 'node_modules/pg-transitive/index.js')), 'transitive dependency was not shipped');
  assert(!existsSync(resolve(funcDir, 'node_modules/pg-dev-only')), 'devDependency must not be shipped');
  rmSync(root, { recursive: true, force: true });
});

it('skips nested node_modules (flattened by name) and builtins', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'vesk-driver-'));
  const funcDir = resolve(root, '.vercel/output/functions/__index.func');
  pkg(root, 'pg', {});
  write(root, 'node_modules/pg/index.js', 'module.exports = {};');
  write(root, 'node_modules/pg/node_modules/nested-only/index.js', 'nested');

  shipNodeDriverClosures(root, funcDir);

  assert(existsSync(resolve(funcDir, 'node_modules/pg/index.js')), 'driver was not shipped');
  assert(!existsSync(resolve(funcDir, 'node_modules/pg/node_modules')), 'nested node_modules must be skipped');
  assert(!existsSync(resolve(funcDir, 'node_modules/node:sqlite')), 'node: builtins must not be shipped');
  assert(!existsSync(resolve(funcDir, 'node_modules/node:net')), 'node: builtins must not be shipped');
  rmSync(root, { recursive: true, force: true });
});

it('resolves SSR fetch URLs against the forwarded public host, not the protected host', () => {
  const source = vercelBootstrapSource();
  assert(source.includes("req.headers['x-forwarded-host']"), 'must prefer x-forwarded-host for the public alias');
  assert(source.includes("req.headers['x-forwarded-proto']"), 'must honor x-forwarded-proto for https');
  assert(!source.includes("'http://' + (req.headers.host"), 'must not hardcode http against the raw host');
  assert(source.includes('new URL(req.url, `${__proto}://${__host}`)'), 'request URL must use the resolved proto/host');
});

it('is a no-op when no driver is installed', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'vesk-driver-'));
  const funcDir = resolve(root, '.vercel/output/functions/__index.func');
  mkdirSync(funcDir, { recursive: true });
  shipNodeDriverClosures(root, funcDir);
  assert(!existsSync(resolve(funcDir, 'node_modules')), 'nothing should be created when no driver is installed');
  rmSync(root, { recursive: true, force: true });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
