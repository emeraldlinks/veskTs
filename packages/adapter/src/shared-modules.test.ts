/**
 * Shared-module extraction for code-split client bundles.
 *
 * A module imported by more than one route chunk used to be inlined into every
 * chunk, which meant one module-scope `track()` cell per chunk: signing in
 * through the login chunk left the portal chunk's copy of the session empty and
 * the app rendered its signed-out view — with a green build and no error. These
 * tests pin the single-copy contract at the bundle level.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';

// Fixtures live INSIDE the repo: their modules import `@vesk/runtime`, which
// esbuild can only resolve by walking up to this repo's node_modules.
const FIXTURE_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'tmp', 'shared-modules-test');

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: Error) => {
      failed++;
      console.log(`  ✗ ${name}\n    ${error.message}`);
    });
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function fixtureRoot(): string {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  return FIXTURE_ROOT;
}

process.on('exit', () => {
  try {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/**
 * Two routes importing the same app module — the shape that used to produce two
 * independent copies of its state.
 */
async function buildTwoRouteApp(): Promise<{ main: string; chunks: Map<string, string> }> {
  const dir = mkdtempSync(join(fixtureRoot(), 'two-route-'));
  const appDir = join(dir, 'app');
  const libDir = join(dir, 'src');
  mkdirSync(join(appDir, 'login'), { recursive: true });
  mkdirSync(join(appDir, 'dashboard'), { recursive: true });
  mkdirSync(libDir, { recursive: true });

  writeFileSync(
    join(libDir, 'store.ts'),
    "import { track } from '@vesk/runtime';\nexport const STORE_BODY_MARKER = 'shared-store-body';\nexport const session = track<string | null>(null);\nexport const signIn = (id: string): void => { session.set(id); };\n",
  );
  writeFileSync(
    join(appDir, 'page.vsk'),
    "component Page() { <h1>home</h1> }\n",
  );
  writeFileSync(
    join(appDir, 'login/page.vsk'),
    "import { signIn } from '../../src/store';\ncomponent LoginPage() { <button onClick={() => signIn('u1')}>in</button> }\n",
  );
  writeFileSync(
    join(appDir, 'dashboard/page.vsk'),
    "import { session } from '../../src/store';\ncomponent DashboardPage() { <p>{session}</p> }\n",
  );

  const routeTree: Array<Record<string, unknown>> = [
    {
      fullPath: '/',
      sourceDir: '',
      page: 'Page',
      children: [
        { fullPath: '/login', sourceDir: 'login', page: 'LoginPage', children: [] },
        { fullPath: '/dashboard', sourceDir: 'dashboard', page: 'DashboardPage', children: [] },
      ],
    },
  ];
  const built = await generateClientBundle(routeTree as never, appDir, new Map(), {
    codeSplit: true,
    importRuntime: true,
  });
  return {
    main: built.main,
    chunks: new Map(built.chunks.map((chunk) => [chunk.name, chunk.code])),
  };
}

await it('a module shared by two route chunks exists in exactly one bundle', async () => {
  const { main, chunks } = await buildTwoRouteApp();
  const all = [['main', main], ...chunks.entries()];
  // `STORE_BODY_MARKER` only exists inside the module body — a shim that merely
  // names the module as a lookup key would not carry it.
  const carriers = all.filter(([, code]) => code.includes('shared-store-body')).map(([name]) => name);
  assert(
    carriers.length === 1,
    `the shared module body must be emitted exactly once, found it in: ${carriers.join(', ')}`,
  );
});

await it('the entry bundle publishes shared modules on globalThis.__veskShared', async () => {
  const { main } = await buildTwoRouteApp();
  assert(
    main.includes('__veskShared'),
    'the entry bundle must publish the shared-module map; route chunks read their bindings from it',
  );
  assert(
    main.includes('shared-store-body'),
    'the entry bundle must carry the shared module body — that is the single copy',
  );
});

await it('route chunks read shared bindings through a shim, not a second copy', async () => {
  const { chunks } = await buildTwoRouteApp();
  const routeChunks = [...chunks.entries()].filter(([name]) => name.startsWith('page-'));
  assert(routeChunks.length >= 2, 'expected at least two route chunks');
  for (const [name, code] of routeChunks) {
    if (!code.includes('__veskShared')) continue;
    assert(
      !code.includes("import * as m0 from"),
      `${name} inlined a shared module instead of using the shared copy`,
    );
  }
});

await it('a module used by only one chunk is left alone (no needless entry bloat)', async () => {
  const { mkdirSync: md, writeFileSync: w } = await import('node:fs');
  const dir = mkdtempSync(join(fixtureRoot(), 'solo-'));
  const appDir = join(dir, 'app');
  md(join(appDir, 'only'), { recursive: true });
  md(join(dir, 'src'), { recursive: true });
  w(join(dir, 'src', 'solo.ts'), "export const solo = 'solo-value';\n");
  w(join(appDir, 'page.vsk'), 'component Page() { <h1>home</h1> }\n');
  w(join(appDir, 'only', 'page.vsk'), "import { solo } from '../../src/solo';\ncomponent Only() { <p>{solo}</p> }\n");
  const routeTree: Array<Record<string, unknown>> = [
    {
      fullPath: '/',
      sourceDir: '',
      page: 'Page',
      children: [{ fullPath: '/only', sourceDir: 'only', page: 'Only', children: [] }],
    },
  ];
  const built = await generateClientBundle(routeTree as never, appDir, new Map(), {
    codeSplit: true,
    importRuntime: true,
  });
  assert(
    !built.main.includes('solo-value'),
    'a single-chunk module must stay in its own chunk, not be hoisted into the entry bundle',
  );
});

await it('the shared bundle does not carry its own copy of the runtime', async () => {
  // A second `@vesk/runtime` inside the shared bundle means a second `Cell`
  // class and a second `currentEffect` variable. A store cell written from a
  // click then notifies subscribers registered against the OTHER copy: the
  // write lands, nothing repaints, no error anywhere.
  const { main, chunks } = await buildTwoRouteApp();
  assert(
    main.includes('__veskShared'),
    'expected the entry bundle to publish the shared modules',
  );
  const sharedMarker = main.indexOf('__veskShared');
  const runtimeGlobals = main.indexOf('globalThis.track = track');
  assert(
    runtimeGlobals !== -1 && runtimeGlobals < sharedMarker,
    'the entry bundle must publish the runtime bindings BEFORE the shared modules run',
  );
  // The shared modules read `track` off the global instead of bundling it.
  const sharedBody = main.slice(sharedMarker - 40_000, sharedMarker + 5_000);
  assert(
    !/class Cell\b/.test(sharedBody),
    'the shared bundle inlined its own Cell class — that is a second runtime instance',
  );
  for (const code of chunks.values()) {
    assert(
      !/class Cell\b/.test(code),
      'a route chunk inlined its own Cell class — that is a second runtime instance',
    );
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);