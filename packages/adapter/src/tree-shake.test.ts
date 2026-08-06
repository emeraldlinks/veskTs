/**
 * End-to-end test for the tree-shaken client runtime.
 *
 * The runtime bundle is one closed esbuild IIFE; only the requested names are
 * re-exported with an explicit `export { ... };` statement (top-level `const`
 * bindings are NOT ESM exports, so without it browsers resolve zero names).
 * Asserts that: the IIFE is present, exactly the requested names are exported,
 * unused runtime modules are dropped, the bundle imports cleanly as ESM, and a
 * missing name falls back to the legacy concatenated runtime.
 */
import { buildTreeShakenRuntime, runtimeExportNames } from '@vesk/adapter/src/client-bundle';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');
const runtimeDir = resolve(root, 'packages', 'runtime', 'dist');

let passed = 0;
let failed = 0;

async function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  console.log('\n=== Tree-shaken runtime ===');

  const minimal = ['track', 'get', 'set', 'effect'];
  const rt = await buildTreeShakenRuntime(runtimeDir, minimal);

  await assert(rt.includes('__veskRuntime'), 'closed IIFE global present');
  await assert(/\bexport\s*\{\s*track, get, set, effect\s*\};/.test(rt), 'explicit `export { track, get, set, effect };` emitted');
  await assert(/const\s*\{\s*track, get, set, effect\s*\}\s*=\s*__veskRuntime;/.test(rt), 'destructure from IIFE global present');
  await assert(!rt.includes('// --- ripple-constants.js ---'), 'no legacy concat markers');
  await assert(!rt.includes('formIsSSR'), 'form module dropped (unused)');
  await assert(!rt.includes('getClientCache'), 'resource module dropped (unused)');
  await assert(!rt.includes('generateSrcset'), 'image module dropped (unused)');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-rt-'));
  const out = join(dir, 'rt.mjs');
  writeFileSync(out, rt);
  const m = await import(pathToFileURL(out).href + '?v=' + Date.now());
  rmSync(dir, { recursive: true });

  await assert(minimal.every((n) => n in m), 'requested names resolve via ESM import');
  await assert(Object.keys(m).length === 4, 'no extra exports leak out of the IIFE');

  console.log('\n=== Full dev name set ===');
  const all = runtimeExportNames(runtimeDir);
  await assert(all.size > 100, `available name set is > 100 (got ${all.size})`);
  const allRt = await buildTreeShakenRuntime(runtimeDir, [...all]);
  for (const n of ['Form', 'Field', 'matchRoute', 'ensureChunk', 'reconcile']) {
    await assert(new RegExp(`export \\{[^}]*\\b${n}\\b[^}]*\\};`).test(allRt), `full set explicitly exports ${n}`);
  }

  console.log('\n=== Fallback ===');
  const fallback = await buildTreeShakenRuntime(runtimeDir, ['track', 'notARealExport']);
  await assert(fallback.includes('// --- ripple-constants.js ---'), 'missing name falls back to legacy concatenated runtime');
  await assert(!fallback.includes('__veskRuntime'), 'fallback is the old concat, not the IIFE');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main();
