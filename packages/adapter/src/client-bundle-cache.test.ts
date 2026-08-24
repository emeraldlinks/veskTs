/**
 * Incremental dev-rebuild cache for generateClientBundle.
 *
 * The HMR rebuild path passes a shared ClientBundleCache across calls.
 * Asserts:
 *   - first call compiles every file (cold cache);
 *   - second call with no edits reuses everything (compiledFiles === 0,
 *     mainFromCache === true) and produces byte-identical output;
 *   - editing one page recompiles only that file and the changed chunk
 *     reflects the new source while untouched chunks are byte-identical;
 *   - introducing a new runtime import in the edited page invalidates the
 *     cached main bundle (mainFromCache === false) so the new name is
 *     exported from /_vesk/runtime.js imports;
 *   - adding/removing a route (tree change) still produces correct chunks
 *     through the same cache instance.
 */
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import type { ClientBundleCache } from '@vesk/adapter/src/types';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');

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

async function main() {
  console.log('\n=== Incremental client-bundle cache ===');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-cb-cache-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'about'), { recursive: true });

  const homePath = join(appDir, 'page.vsk');
  const aboutPath = join(appDir, 'about', 'page.vsk');
  writeFileSync(homePath, `component Home {
	let &[n] = track(1)
	<h1>Home v1</h1>
}`);
  writeFileSync(aboutPath, `component About {
	<h1>About</h1>
}`);

  // Pin mtimes so the warm-rebuild comparison below is deterministic even
  // on filesystems with coarse timestamp granularity.
  const pinned = new Date(2026, 0, 1);
  utimesSync(homePath, pinned, pinned);
  utimesSync(aboutPath, pinned, pinned);

  const routeTree = () => [
    { ...routeNode(appDir, '/', '/', 0), offline: 'Offline_Index', network: 'Network_Index' },
    routeNode(join(appDir, 'about'), '/about', '/about', 1, 'Page_About'),
  ];

  const cache: ClientBundleCache = { files: new Map() };
  const opts = { importRuntime: true, hmr: true, codeSplit: true, cache };


  try {
    // Cold build
    const cold = await generateClientBundle(routeTree(), appDir, new Map(), opts);
    assert(cold.compiledFiles === 2, `cold build compiles both pages (${cold.compiledFiles})`);
    assert(cold.cachedFileHits === 0, `cold build has no cache hits (${cold.cachedFileHits})`);
    assert(cold.mainFromCache === false, 'cold build builds main bundle');
    const homeChunkCold = cold.chunks.find(c => c.name.includes('index'));
    const aboutChunkCold = cold.chunks.find(c => c.name.includes('about'));
    assert(!!homeChunkCold && homeChunkCold.code.includes('Home v1'), 'home chunk contains Home v1');
    assert(!!aboutChunkCold, 'about chunk exists');
    // Route-level connectivity boundaries compile into the node's chunk.
    writeFileSync(join(appDir, 'offline.vsk'), `component OfflineRoot {
  	<p>offline-root-boundary</p>
  }`);
    writeFileSync(join(appDir, 'network.vsk'), `component NetworkRoot {
  	<p>network-root-boundary</p>
  }`);

    // Force recompile of the root chunk so the new files are picked up.
    cache.files.delete(homePath);
    const withBoundaries = await generateClientBundle(routeTree(), appDir, new Map(), opts);
    const homeChunkB = withBoundaries.chunks.find(c => c.name === homeChunkCold!.name)!;
    assert(homeChunkB.code.includes('offline-root-boundary'), 'offline.vsk compiled into route chunk');
    assert(homeChunkB.code.includes('network-root-boundary'), 'network.vsk compiled into route chunk');

    // Warm rebuild — no changes since the boundary build. Byte-identity is
    // now measured against the boundary build's chunk (the cold one predates
    // offline.vsk / network.vsk).
    const warm = await generateClientBundle(routeTree(), appDir, new Map(), opts);
    assert(warm.compiledFiles === 0, `warm rebuild recompiles nothing (${warm.compiledFiles})`);
    assert(warm.cachedFileHits === 4, `warm rebuild serves all files from cache (${warm.cachedFileHits})`);
    assert(warm.mainFromCache === true, 'warm rebuild reuses the main bundle');
    assert(warm.main === withBoundaries.main, 'warm main bundle is byte-identical');
    const homeChunkWarm = warm.chunks.find(c => c.name === homeChunkCold!.name);
    assert(homeChunkWarm!.code === homeChunkB.code, 'untouched chunk is byte-identical');

    // Edit one page → only it recompiles; its chunk updates, other doesn't.
    writeFileSync(homePath, `component Home {
	let &[n] = track(2)
	<h1>Home v2</h1>
}`);
    const edited = await generateClientBundle(routeTree(), appDir, new Map(), opts);
    assert(edited.compiledFiles === 1, `edit recompiles exactly one file (${edited.compiledFiles})`);
    assert(edited.cachedFileHits === 3, `edit serves the untouched files from cache (${edited.cachedFileHits})`);
    const homeChunkEdited = edited.chunks.find(c => c.name === homeChunkCold!.name);
    assert(homeChunkEdited!.code.includes('Home v2'), 'edited chunk reflects new source');
    const aboutChunkEdited = edited.chunks.find(c => c.name === aboutChunkCold!.name);
    assert(aboutChunkEdited!.code === aboutChunkCold!.code, 'sibling chunk still byte-identical');

    // New runtime import in the edited page → main bundle must be rebuilt
    // so the name is imported from /_vesk/runtime.js.
    writeFileSync(homePath, `import { peek } from "@vesk/runtime";

component Home {
	let &[n] = track(3)
	<h1>Home v3</h1>
}`);
    const withImport = await generateClientBundle(routeTree(), appDir, new Map(), opts);
    assert(withImport.main !== cold.main, 'new runtime import rebuilds main bundle');
    assert(withImport.main.includes('peek'), 'main bundle imports the new runtime name');
    assert(withImport.main.includes('Home v3') === false, 'main bundle does not inline component code');
    const homeChunkNew = withImport.chunks.find(c => c.name === homeChunkCold!.name)!;
    assert(homeChunkNew.code.includes('Home v3'), 'chunk reflects v3 source');

    // Tree change (new route) via the same cache instance.
    mkdirSync(join(appDir, 'docs'), { recursive: true });
    writeFileSync(join(appDir, 'docs', 'page.vsk'), `component Docs {
	<h1>Docs</h1>
}`);
    const treeWithDocs = [
      ...routeTree(),
      routeNode(join(appDir, 'docs'), '/docs', '/docs', 1, 'Page_Docs'),
    ];
    const grew = await generateClientBundle(treeWithDocs, appDir, new Map(), opts);
    assert(grew.chunks.some(c => c.name.includes('docs')), 'new route produces its chunk');
    assert(grew.chunks.some(c => c.name === homeChunkCold!.name), 'existing chunk survives tree change');
    assert(grew.compiledFiles === 1, `only the new route compiled (${grew.compiledFiles})`);

    // Targeted hot path: only[] + returnEditedSources. The edited page is
    // stat-checked and recompiled; every other file is reused without
    // touching the filesystem (verified by mutating a file's content while
    // keeping its cached stat — the stale entry must still be served, since
    // the dev watcher guarantees unwatched files did not change).
    writeFileSync(homePath, `component Home {
	let &[n] = track(4)
	<h1>Home v4</h1>
}`);
    const targeted = await generateClientBundle(routeTree(), appDir, new Map(), {
      importRuntime: true,
      hmr: true,
      codeSplit: true,
      cache,
      only: [homePath],
      returnEditedSources: true,
    });
    assert(targeted.compiledFiles === 1, `targeted rebuild compiles exactly the edited file (${targeted.compiledFiles})`);
    const targetedHome = targeted.chunks.find(c => c.name === homeChunkCold!.name)!;
    assert(targetedHome.code.includes('Home v4'), 'targeted rebuild updates the edited chunk');
    assert(!!targeted.editedSources && targeted.editedSources.has(homePath), 'editedSources carries the edited file');
    const bareSrc = targeted.editedSources!.get(homePath)!;
    assert(!/^import\s/m.test(bareSrc), 'edited source has no import statements');
    assert(bareSrc.includes('Home') || bareSrc.includes('__components'), 'edited source contains component code');
    assert(!!targeted.editedNames && targeted.editedNames.get(homePath) === 'Home', 'editedNames resolves the component name');

    // With only[], a file whose cached stat no longer matches is STILL
    // reused (no stat call happens for non-edited files).
    writeFileSync(aboutPath, `component About {
	<h1>About silently changed</h1>
}`);
    writeFileSync(homePath, `component Home {
	let &[n] = track(5)
	<h1>Home v5</h1>
}`);
    const staleOk = await generateClientBundle(routeTree(), appDir, new Map(), {
      importRuntime: true,
      hmr: true,
      codeSplit: true,
      cache,
      only: [homePath],
      returnEditedSources: true,
    });
    assert(staleOk.compiledFiles === 1, `only the edited file compiles even when others went stale (${staleOk.compiledFiles})`);
    const staleAbout = staleOk.chunks.find(c => c.name === aboutChunkCold!.name)!;
    assert(staleAbout.code.includes('About') && !staleAbout.code.includes('silently changed'), 'non-edited file served from cache without stat');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
