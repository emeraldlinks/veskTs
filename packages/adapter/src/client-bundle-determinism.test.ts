/**
 * Regression test for client-chunk build determinism.
 *
 * The chunk bundler writes its entries into `mkdtemp` scratch dirs
 * (`tmp-vesk-chunk-*`, `tmp-vesk-shared-*`) and hands those paths to esbuild,
 * which bakes each module's path into the output as a `// <path>` banner. The
 * shared scratch dir is imported (as generated shims) by EVERY route chunk and
 * the entry bundle, so its random name leaked into all of them. Production
 * chunk names are content hashes, so that made every hash change on every
 * build even when the source was byte-identical: each rebuild emitted a fresh
 * `page-X.<hash>.js` and never overwrote the previous one, and `static/` grew
 * without bound.
 *
 * This test bundles the same app — including a cross-route shared module, which
 * is what triggers the shared pass — twice and asserts every chunk and the
 * entry bundle are byte-for-byte identical and carry no random scratch suffix.
 */
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0;
let failed = 0;

async function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function routeNode(sourceDir: string, path: string, fullPath: string, segmentCount: number, page = 'Page_Index') {
  return {
    path,
    fullPath,
    isGroup: false,
    isDynamic: false,
    isCatchAll: false,
    page,
    layout: null,
    loading: null,
    error: null,
    notFound: null,
    hasMiddleware: false,
    children: [],
    sourceDir,
    segmentCount,
  };
}

const RANDOM_SCRATCH_RE = /tmp-vesk-(?:chunk|shared|mono)-[A-Za-z0-9]+/;

async function main() {
  console.log('\n=== Client chunk determinism (stable content hash) ===');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-cb-det-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'lib'), { recursive: true });
  mkdirSync(join(appDir, 'list'), { recursive: true });

  // A cross-route shared module: imported by both pages, so it is hoisted into
  // the shared scratch bundle — the exact path whose random dir name used to
  // leak into every chunk.
  writeFileSync(join(appDir, 'lib', 'store.ts'), `export const sharedCount = 5;
export function double(n: number): number { return n * 2; }
`);

  writeFileSync(join(appDir, 'page.vsk'), `import { sharedCount, double } from './lib/store'
component Home {
	let &[count] = track(0)
	<h1>Welcome {double(sharedCount)}</h1>
	<p>{count}</p>
	<button onClick={() => count++}>+</button>
}
`);

  writeFileSync(join(appDir, 'list', 'page.vsk'), `import { sharedCount } from '../lib/store'
component List {
	<ul><li>{sharedCount}</li></ul>
}
`);

  const tree = [
    routeNode(appDir, '', '/', 0),
    routeNode(join(appDir, 'list'), 'list', '/list', 1, 'Page_List'),
  ];

  const first = await generateClientBundle(tree, appDir, new Map(), { importRuntime: true, codeSplit: true });
  const second = await generateClientBundle(tree, appDir, new Map(), { importRuntime: true, codeSplit: true });

  const firstChunks = new Map(first.chunks.map((c) => [c.name, c.code]));
  const secondChunks = new Map(second.chunks.map((c) => [c.name, c.code]));

  await assert(first.chunks.length > 0, `bundled ${first.chunks.length} chunks`);
  await assert(first.chunks.length === second.chunks.length, 'both builds emit the same chunk count');
  await assert(
    [...firstChunks.keys()].sort().join(',') === [...secondChunks.keys()].sort().join(','),
    'both builds emit the same chunk names',
  );

  // Prove the shared pass actually ran, so this test really covers the leak
  // path and not just the per-chunk entry.
  const allCode = [...firstChunks.values()].join('\n') + first.main;
  await assert(allCode.includes('tmp-vesk-shared'), 'shared-module pass ran (shim paths present in output)');

  let identical = true;
  let leaked = false;
  for (const [name, code] of firstChunks) {
    if (secondChunks.get(name) !== code) identical = false;
    if (RANDOM_SCRATCH_RE.test(code)) leaked = true;
  }
  for (const [, code] of secondChunks) if (RANDOM_SCRATCH_RE.test(code)) leaked = true;
  if (RANDOM_SCRATCH_RE.test(first.main) || RANDOM_SCRATCH_RE.test(second.main)) leaked = true;

  await assert(identical, 'chunk code is byte-for-byte identical across builds (stable content hash)');
  await assert(!leaked, 'no random scratch-dir suffix (tmp-vesk-*-<rand>) leaks into chunk bytes');
  await assert(first.main === second.main, 'entry bundle is byte-for-byte identical across builds');

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
