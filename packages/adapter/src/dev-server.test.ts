import {
  createPluginStateRouter,
  injectDevScripts,
  devBootstrapScript,
  defaultDevHmrState,
} from './dev-server';
import {
  writePluginState,
  readPluginState,
  __internals,
} from './plugins';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerSrcPath = resolve(__dirname, 'dev-server.ts');
const clientBundleSrcPath = resolve(__dirname, 'client-bundle.ts');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk Dev Server Panel Tests \u2550\u2550\u2550\n');

const base = resolve(process.cwd(), 'tmp-dev-server-test');
let counter = 0;
function freshDirs(): { appDir: string; veskDir: string } {
  counter++;
  const dir = resolve(base, String(counter));
  const appDir = resolve(dir, 'app');
  const veskDir = resolve(appDir, '.vesk');
  mkdirSync(veskDir, { recursive: true });
  mkdirSync(resolve(appDir, 'node_modules'), { recursive: true });
  return { appDir, veskDir };
}

const origRunNpm = __internals.runNpm;

try {
  // ── GET /__vesk/hmr/state: 200 + shape ──────────────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const injected = { status: 'error' as const, lastCompileMs: 12, error: { message: 'boom' }, hasError: true, componentCount: 3 };
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [], getHmrState: () => injected });
    const res = await router.route('GET', '/__vesk/hmr/state');
    assert(res !== null, 'state endpoint routes (non-null)');
    assert(res!.status === 200, 'state endpoint returns 200');
    assert(res!.headers['Content-Type'] === 'application/json', 'state endpoint sets application/json');
    const parsed = JSON.parse(res!.body);
    assert(parsed.status === 'error' && parsed.hasError === true, 'state endpoint echoes injected status + hasError');
    assert(parsed.error && parsed.error.message === 'boom', 'state endpoint echoes injected error');
    assert(parsed.componentCount === 3 && parsed.lastCompileMs === 12, 'state endpoint echoes componentCount + lastCompileMs');
  }
  // GET without injected provider falls back to a no-server default.
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('GET', '/__vesk/hmr/state');
    const parsed = JSON.parse(res!.body);
    assert(parsed.status === 'up' && parsed.error === null && parsed.hasError === false, 'state without provider defaults to up/no-error');
  }
  // defaultDevHmrState
  {
    const s = defaultDevHmrState();
    assert(s.status === 'up' && s.error === null && s.hasError === false && s.componentCount === 0, 'defaultDevHmrState shape');
  }

  // ── GET /__vesk/plugins: 200 + plugin list ──────────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    writePluginState(veskDir, { version: 1, plugins: [{ name: 'mdx', package: '@vesk/plugin-mdx', active: true }] });
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: ['tailwindcss'] });
    const res = await router.route('GET', '/__vesk/plugins');
    assert(res!.status === 200, 'plugins endpoint returns 200');
    assert(res!.headers['Content-Type'] === 'application/json', 'plugins endpoint sets application/json');
    const parsed = JSON.parse(res!.body);
    assert(Array.isArray(parsed.plugins), 'plugins endpoint body has a plugins array');
    const names = parsed.plugins.map((p: { name: string }) => p.name);
    assert(names.includes('tailwindcss'), 'plugins list includes config-declared plugin');
    assert(names.includes('mdx'), 'plugins list includes state-registered plugin');
  }

  // ── POST activate/deactivate round-trip flips active ────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    let res = await router.route('POST', '/__vesk/plugins/activate', { name: 'echo' });
    assert(res!.status === 200, 'activate returns 200');
    let state = readPluginState(veskDir);
    assert(state.plugins.length === 1 && state.plugins[0].active === true, 'activate flips plugin active=true in state');

    res = await router.route('POST', '/__vesk/plugins/deactivate', { name: 'echo' });
    assert(res!.status === 200, 'deactivate returns 200');
    state = readPluginState(veskDir);
    assert(state.plugins.length === 1 && state.plugins[0].active === false, 'deactivate flips plugin active=false in state');

    res = await router.route('POST', '/__vesk/plugins/activate', { name: 'echo' });
    state = readPluginState(veskDir);
    assert(state.plugins[0].active === true, 'activate after deactivate flips back to true (round-trip)');
  }
  // activate/deactivate without name → 400
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('POST', '/__vesk/plugins/activate', {});
    assert(res!.status === 400 && /name/.test(JSON.parse(res!.body).error), 'activate without name returns 400 with "name" error');
    const res2 = await router.route('POST', '/__vesk/plugins/deactivate', {});
    assert(res2!.status === 400, 'deactivate without name returns 400');
  }

  // ── POST install / uninstall: present + validation ──────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    __internals.runNpm = async () => ({ code: 0, stdout: '', stderr: '' });
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-instd');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-instd', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('POST', '/__vesk/plugins/install', { package: '@vesk/plugin-instd' });
    assert(res!.status === 200, 'install returns 200');
    const parsed = JSON.parse(res!.body);
    assert(parsed.ok === true && parsed.record && parsed.record.active === true, 'install returns ok + active record');
    assert(readPluginState(veskDir).plugins.some((p) => p.package === '@vesk/plugin-instd'), 'install registers package in state');

    const un = await router.route('POST', '/__vesk/plugins/uninstall', { package: '@vesk/plugin-instd' });
    assert(un!.status === 200, 'uninstall returns 200');
    assert(!readPluginState(veskDir).plugins.some((p) => p.package === '@vesk/plugin-instd'), 'uninstall clears the package from state');
  }
  // install/uninstall without package → 400
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('POST', '/__vesk/plugins/install', {});
    assert(res!.status === 400 && /package/.test(JSON.parse(res!.body).error), 'install without package returns 400 with "package" error');
    const res2 = await router.route('POST', '/__vesk/plugins/uninstall', {});
    assert(res2!.status === 400, 'uninstall without package returns 400');
  }

  // ── 404 for unknown /__vesk/* path ──────────────────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('GET', '/__vesk/plugins/nope');
    assert(res!.status === 404, 'unknown /__vesk/* path returns 404');
    assert(/not found/i.test(JSON.parse(res!.body).error), '404 body includes an error message');
  }
  // non-__vesk path → null (caller falls through)
  {
    const { appDir, veskDir } = freshDirs();
    const router = createPluginStateRouter({ appDir, veskDir, configPluginNames: [] });
    const res = await router.route('GET', '/some/page');
    assert(res === null, 'non-/__vesk/ path routes to null (fall through)');
  }

  // ── injectDevScripts: scripts at each </body> site ──────────────────────
  {
    assert(injectDevScripts('<html><head></head><body><h1>x</h1></body></html>').includes('</body>'), 'injectDevScripts keeps a closing body tag');
    const once = injectDevScripts('<html><body>hi</body></html>');
    assert(once.includes('/_vesk/hmr.js'), 'injectDevScripts adds the hmr client script');
    assert(once.includes('/__vesk/hmr/state'), 'injectDevScripts adds the state bootstrap script');
    assert(once.includes('__vesk_hmr_show'), 'injectDevScripts bootstrap references __vesk_hmr_show');
    const count = (once.match(/\/_vesk\/hmr\.js/g) || []).length;
    assert(count === 1, 'injectDevScripts injects the hmr client exactly once per page');
    // devBootstrapScript guard makes it idempotent even when injected twice.
    assert(devBootstrapScript().includes('__vesk_hmr_bootstrap'), 'bootstrap script has a run-once guard flag');
  }
  // no double-injection when HTML has no </body>
  {
    assert(injectDevScripts('<html><body>no close</body-of-text>') === '<html><body>no close</body-of-text>', 'injectDevScripts returns HTML unchanged when no </body>');
    assert(!injectDevScripts('<p>hello</p>').includes('/_vesk/hmr.js'), 'no /_vesk/hmr.js injected when no </body>');
  }

  // ── source: injectDevScripts used at every former </body> site ──────────
  const devSrc = readFileSync(devServerSrcPath, 'utf-8');
  {
    const callSites = (devSrc.match(/injectDevScripts\(body\)/g) || []).length;
    assert(callSites === 3, `dev-server.ts calls injectDevScripts at exactly 3 </body> sites (got ${callSites})`);
    // The only `</body>` replace left is the one inside injectDevScripts itself.
    const rawBodyReplaces = (devSrc.match(/\.replace\(\s*'<\/body>'/g) || []).length;
    assert(rawBodyReplaces === 1, `only the injectDevScripts helper does a </body> replace (got ${rawBodyReplaces})`);
    // The old inline handler pattern (a </body> replace carrying the hmr.js script) is gone.
    assert(!devSrc.includes("'</body>',\n\t\t\t\t\t'\\t<script type=\"module\" src=\"/_vesk/hmr.js\""), 'no legacy inline hmr.js </body> replace in request handlers');
    assert(devSrc.includes('/__vesk/hmr/state'), 'dev-server.ts serves the HMR state endpoint');
    assert(devSrc.includes('/__vesk/plugins'), 'dev-server.ts serves the plugins endpoints');
  }

  // ── client-bundle.ts appendHmrGlobals untouched ──────────────────────────
  {
    const cbSrc = readFileSync(clientBundleSrcPath, 'utf-8');
    assert(cbSrc.includes('function appendHmrGlobals'), 'appendHmrGlobals still present in client-bundle');
    assert(cbSrc.includes('__vesk_hmr_eval'), 'appendHmrGlobals eval hook intact');
    assert(existsSync(clientBundleSrcPath), 'client-bundle.ts exists (not deleted/renamed)');
  }
} finally {
  __internals.runNpm = origRunNpm;
  rmSync(base, { recursive: true, force: true });
}

console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550\n`);
process.exit(failed > 0 ? 1 : 0);
