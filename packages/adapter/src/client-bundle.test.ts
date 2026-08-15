/**
 * Regression test: the code-split main bundle must only emit
 * `globalThis.<name> = <name>` for runtime names that are actually imported.
 *
 * The globals block used to reference `reconcile` unconditionally while the
 * import line only included it when some page's compiled code imported it
 * (keyed maps). Any app without a keyed map (e.g. a freshly scaffolded one)
 * then threw `reconcile is not defined` at module load and never hydrated.
 *
 * Asserts:
 *   - simple app (no keyed map) => NO `globalThis.reconcile = reconcile;`
 *   - app with an inline `.map()` keyed loop => reconcile IS imported AND the
 *     global IS emitted (still works when actually needed).
 */
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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
  console.log('\n=== Code-split main bundle globals (reconcile regression) ===');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-cb-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'list'), { recursive: true });

  writeFileSync(join(appDir, 'page.vsk'), `component Home {
	let &[count] = track(0)
	<h1>Welcome</h1>
	<p>{count}</p>
	<button onClick={() => count++}>+</button>
}
`);

  writeFileSync(join(appDir, 'list', 'page.vsk'), `const numbers: number[] = [1, 2, 3]

component List {
	<div class="flex gap-2">
		{numbers.map(n => <span key={n} class="bg-blue-600 text-white text-sm px-3 py-1 rounded-full">{n}</span>)}
	</div>
}
`);

  // Case A: no keyed map anywhere => reconcile must NOT be referenced.
  const simpleTree = [routeNode(appDir, '', '/', 0)];
  const { main: simpleMain } = await generateClientBundle(simpleTree, appDir, new Map(), {
    importRuntime: true,
    codeSplit: true,
  });

  await assert(
    !simpleMain.includes('globalThis.reconcile = reconcile;'),
    'simple app: no unconditional `globalThis.reconcile = reconcile`',
  );
  await assert(
    !/import\s*\{[^}]*reconcile[^}]*\}\s*from/.test(simpleMain),
    'simple app: reconcile not imported',
  );
  await assert(
    simpleMain.includes('globalThis.track = track;'),
    'simple app: imported names still globalized',
  );
  await assert(
    !simpleMain.includes('reconcile is not defined'),
    'simple app: no dead reconcile reference',
  );

  // Case B: keyed map present => reconcile is imported AND globalized.
  const keyedTree = [
    routeNode(appDir, '', '/', 0),
    routeNode(join(appDir, 'list'), 'list', '/list', 1, 'Page_List'),
  ];
  const { main: keyedMain } = await generateClientBundle(keyedTree, appDir, new Map(), {
    importRuntime: true,
    codeSplit: true,
  });

  await assert(
    /import\s*\{[^}]*reconcile[^}]*\}\s*from/.test(keyedMain),
    'keyed app: reconcile imported',
  );
  await assert(
    keyedMain.includes('globalThis.reconcile = reconcile;'),
    'keyed app: reconcile global emitted when imported',
  );

  rmSync(dir, { recursive: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
