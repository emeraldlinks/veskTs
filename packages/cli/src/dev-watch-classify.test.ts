/**
 * Tests for the classified HMR watch helpers in packages/cli/src/dev-server.ts.
 *
 * These keep the hot-path decision tree pure and testable: which watched file
 * triggers a full rebuild vs a targeted hot-swap, and which edits can skip the
 * disk rescan entirely. The watcher must cover every `.ts`/`.vsk`/`.js`/`.md`
 * file in a vesk project regardless of path — only `node_modules`, build
 * outputs and VCS internals are excluded.
 */
import { classifyHmrWatchPath, shouldRescanRoutes, ROUTE_STRUCTURAL_VSK } from './dev-server';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

console.log('\n=== HMR watch classification ===\n');

// --- Ignored paths ---
const ignored: string[] = [
  'node_modules/react/index.js',
  '.vesk/dev/static/client.js',
  '.git/objects/abc',
  '.git/HEAD',
  'tarballs/pkg.tgz',
  'tmp-vesk-chunk-abc.js',
  'node_modules/.pnpm/idx',
];
for (const p of ignored) {
  assert(classifyHmrWatchPath(p) === 'ignored', `ignored: ${p}`);
}

// --- Coverage: every real file kind anywhere in the project ---
const vskCases: string[] = [
  'app/page.vsk',
  'app/components/Button.vsk',
  'components/Deep/Nested.vsk',
  'README.md',                       // markdown at root
  'content/blog/hello.md',
  'content/blog/hello.markdown',
  'src/lib/doc.md',
];
for (const p of vskCases) {
  assert(classifyHmrWatchPath(p) === 'vsk', `vsk/md: ${p}`);
}

const cssCases: string[] = [
  'app/global.css',
  'src/styles/x.css',
  'assets/main.css',
];
for (const p of cssCases) {
  assert(classifyHmrWatchPath(p) === 'css', `css: ${p}`);
}

const eventsCases: string[] = ['_events.ts', 'src/_events.js', 'app/_events.ts'];
for (const p of eventsCases) {
  assert(classifyHmrWatchPath(p) === 'events', `events: ${p}`);
}

const configCases: string[] = [
  'vesk.config.ts', 'vesk.config.js', 'vesk.config.mjs',
  'tsconfig.json', 'package.json',
  'src/vesk.config.ts', 'config/tsconfig.json',
];
for (const p of configCases) {
  assert(classifyHmrWatchPath(p) === 'config', `config: ${p}`);
}

const scriptCases: string[] = [
  'src/lib/api.ts', 'app/lib/helper.js', 'scripts/build.mjs',
  'tests/dev-test.js', 'src/routes/+page.ts',
];
for (const p of scriptCases) {
  assert(classifyHmrWatchPath(p) === 'script', `script: ${p}`);
}

// --- shouldRescanRoutes ---
assert(shouldRescanRoutes('node_modules/x', 'rename') === true, 'rename (create/delete) always rescans');
assert(shouldRescanRoutes('app/new-page/page.vsk', 'rename') === true, 'rename new page forces rescan');
assert(shouldRescanRoutes('app/components/Button.vsk', 'change') === false, 'component content edit skips scan');
assert(shouldRescanRoutes('content/blog/hello.md', 'change') === false, 'md content edit skips scan');
assert(shouldRescanRoutes('app/global.css', 'change') === false, 'css edit skips scan');
assert(shouldRescanRoutes('src/lib/x.ts', 'change') === false, 'ts edit skips scan');
assert(shouldRescanRoutes('README.md', 'change') === false, 'root md skips scan');

for (const name of ROUTE_STRUCTURAL_VSK) {
  assert(shouldRescanRoutes(`app/${name}`, 'change') === true, `${name} content edit rescans`);
}

// structural marker only matters when it's a .vsk (e.g. a non-vsk 'page' is irrelevant)
assert(shouldRescanRoutes('app/components/page.vsk', 'change') === true, 'structural basename anywhere rescans');

// --- Windows separators (issue #1: endless rebuild loop) ---
// Node's recursive fs.watch reports backslash paths on Windows. Before the
// normalization these slipped past the node_modules/ skip checks, matched the
// `.mjs` extension and retriggered the build that had just written the file.
const windowsIgnored: string[] = [
  'node_modules\\@vesk\\runtime\\dist\\.runtime-tree-entry.mjs',
  'node_modules\\react\\index.js',
  '.vesk\\dev\\static\\client.js',
  '.git\\HEAD',
  'tarballs\\pkg.tgz',
];
for (const p of windowsIgnored) {
  assert(classifyHmrWatchPath(p) === 'ignored', `ignored (windows): ${p}`);
}
const windowsHandled: Array<[string, string]> = [
  ['app\\page.vsk', 'vsk'],
  ['app\\global.css', 'css'],
  ['src\\lib\\api.ts', 'script'],
  ['app\\components\\page.vsk', 'vsk'],
];
for (const [p, kind] of windowsHandled) {
  assert(classifyHmrWatchPath(p) === kind, `${kind} (windows): ${p}`);
}
assert(shouldRescanRoutes('app\\page.vsk', 'change') === true, 'windows structural .vsk rescans');
assert(shouldRescanRoutes('app\\components\\Button.vsk', 'change') === false, 'windows component edit skips scan');

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
