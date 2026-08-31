/**
 * DevTools unified API router — config B1 + capability/permission B2 endpoints.
 *
 * Exercises `createDevApiRouter` directly with fake injectable inputs + a real
 * temp project dir (real `vesk.config.ts` read/write). Verifies:
 *   - GET/POST /__vesk/config (source + toggle), validation never clobbers,
 *   - GET /__vesk/diagnostics (B3 snapshot contract),
 *   - POST /__vesk/build (rebuild hook),
 *   - GET /__vesk/file (containment-checked read-only),
 *   - POST /__vesk/command (allowlist-gated),
 *   - capability enforcement is server-side and cannot be bypassed.
 */
import { createDevApiRouter } from './dev-api';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 DevTools API Router Tests \u2550\u2550\u2550\n');

const base = resolve(tmpdir(), 'vesk-dev-api-test');
let counter = 0;
function freshProject(): { projectDir: string; veskDir: string; appDir: string } {
  counter++;
  const projectDir = resolve(base, String(counter));
  const appDir = resolve(projectDir, 'app');
  const veskDir = resolve(projectDir, '.vesk');
  mkdirSync(veskDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });
  return { projectDir, appDir, veskDir };
}

function readJson(res: { status: number; body: string }) {
  return JSON.parse(res.body) as Record<string, unknown>;
}

async function main() {
  // ── GET /__vesk/config: no file → exists:false, config:{} ───────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('GET', '/__vesk/config');
    assert(res !== null && res.status === 200, 'GET /__vesk/config returns 200');
    const parsed = readJson(res!);
    assert(parsed.exists === false && parsed.config !== undefined, 'missing config → exists:false with empty config object');
    assert(parsed.source === '', 'missing config → empty source');
  }

  // ── GET /__vesk/config: real vesk.config.ts parsed ───────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    writeFileSync(
      resolve(projectDir, 'vesk.config.ts'),
      'import { defineConfig } from "@vesk/compiler";\nexport default defineConfig({ routeDataCache: 2500 });\n',
      'utf-8',
    );
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('GET', '/__vesk/config');
    const parsed = readJson(res!);
    assert(res!.status === 200 && parsed.exists === true, 'existing config → exists:true');
    assert((parsed.config as { routeDataCache: unknown }).routeDataCache === 2500, 'parsed config reflects routeDataCache');
    assert((parsed.source as string).includes('routeDataCache: 2500'), 'source retains raw config text');
  }

  // ── POST /__vesk/config { source }: writes + reflects ───────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('POST', '/__vesk/config', {
      source: 'export default { routeDataCache: 4000 };',
    });
    const parsed = readJson(res!);
    assert(res!.status === 200 && parsed.ok === true, 'POST config { source } returns ok');
    const onDisk = readFileSync(resolve(projectDir, 'vesk.config.ts'), 'utf-8');
    assert(onDisk.includes('routeDataCache: 4000'), 'source written to vesk.config.ts');
  }

  // ── POST /__vesk/config { source }: invalid config never clobbers ────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    writeFileSync(resolve(projectDir, 'vesk.config.ts'), 'export default { routeDataCache: 100 };', 'utf-8');
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('POST', '/__vesk/config', { source: '../this is not valid ts {' });
    assert(res!.status !== 200, 'invalid config source rejected (non-200)');
    const onDisk = readFileSync(resolve(projectDir, 'vesk.config.ts'), 'utf-8');
    assert(onDisk.includes('routeDataCache: 100'), 'invalid config does NOT clobber the existing file');
  }

  // ── POST /__vesk/config { key, value }: toggle keeps other fields ────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const original = '// keep me\nexport default defineConfig({\n  routeDataCache: 100,\n  ssg: true,\n});\n';
    writeFileSync(resolve(projectDir, 'vesk.config.ts'), original, 'utf-8');
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('POST', '/__vesk/config', { key: 'routeDataCache', value: 0 });
    assert(res!.status === 200, 'config toggle returns 200');
    const onDisk = readFileSync(resolve(projectDir, 'vesk.config.ts'), 'utf-8');
    assert(onDisk.includes('routeDataCache: 0'), 'toggle rewrites the targeted key value');
    assert(onDisk.includes('// keep me') && onDisk.includes('ssg: true'), 'toggle preserves comments + untouched keys');
  }

  // ── GET /__vesk/diagnostics: returns injected findings ───────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({
      appDir, veskDir, configPluginNames: [], projectDir,
      getDiagnostics: () => ([{
        severity: 'warning' as const, code: 'BUNDLE_SIZE', file: 'app/page.vsk',
        message: 'large bundle', hint: 'code-split',
      }]),
    });
    const res = await router.route('GET', '/__vesk/diagnostics');
    const parsed = readJson(res!);
    assert(res!.status === 200 && Array.isArray(parsed.diagnostics), 'diagnostics endpoint returns a list');
    assert((parsed.diagnostics as Array<{ code: string }>)[0].code === 'BUNDLE_SIZE', 'diagnostics echo the injected finding');
  }

  // ── POST /__vesk/build: invokes rebuild hook ─────────────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    let called = 0;
    const router = createDevApiRouter({
      appDir, veskDir, configPluginNames: [], projectDir,
      rebuild: async () => { called++; return { ok: true, ms: 5 }; },
    });
    const res = await router.route('POST', '/__vesk/build');
    const parsed = readJson(res!);
    assert(res!.status === 200 && parsed.ok === true && called === 1, 'build endpoint invokes the rebuild hook once');
  }
  // build without hook → 503
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('POST', '/__vesk/build');
    assert(res!.status === 503, 'build without a hook returns 503');
  }

  // ── GET /__vesk/file: read-only + containment ────────────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    writeFileSync(resolve(projectDir, 'README.md'), '# hi\n', 'utf-8');
    mkdirSync(resolve(projectDir, 'src'), { recursive: true });
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const ok = await router.route('GET', '/__vesk/file', undefined, 'path=README.md');
    assert(ok!.status === 200 && (readJson(ok!).content as string).includes('# hi'), 'file.read returns file content within project');
    const esc = await router.route('GET', '/__vesk/file', undefined, 'path=../etc/passwd');
    assert(esc!.status === 403, 'file.read rejects paths escaping the project root');
    const dir = await router.route('GET', '/__vesk/file', undefined, 'path=src');
    const dparsed = readJson(dir!);
    assert(dir!.status === 200 && dparsed.directory === true && Array.isArray(dparsed.entries), 'file.read lists directory entries');
  }

  // ── POST /__vesk/command: allowlist-gated ────────────────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    let ran: string[] | null = null;
    const router = createDevApiRouter({
      appDir, veskDir, configPluginNames: [], projectDir,
      caps: { command: true },
      runCommand: async (argv) => { ran = argv; return { ok: true, code: 0, stdout: '', stderr: '' }; },
    });
    const allowed = await router.route('POST', '/__vesk/command', { argv: ['node', '-v'] });
    assert(allowed!.status === 200 && Array.isArray(ran) && ran[0] === 'node', 'allowlisted command runs through the runner');
    const deniedCmd = await router.route('POST', '/__vesk/command', { argv: ['rm', '-rf', '/'] });
    assert(deniedCmd!.status === 403, 'non-allowlisted command is rejected with 403 (before reaching the runner)');
  }
  // command capability off by default → 403 even for allowlisted commands
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    const res = await router.route('POST', '/__vesk/command', { argv: ['node', '-v'] });
    assert(res!.status === 403 && /capability denied/.test(readJson(res!).error as string), 'command capability denied when not enabled');
  }

  // ── Capability enforcement: config.write denied → 403 ────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir, caps: { 'config.write': false } });
    const res = await router.route('POST', '/__vesk/config', { source: 'export default {};' });
    assert(res!.status === 403 && /config\.write/.test(readJson(res!).error as string), 'config.write capability enforced server-side');
    assert(!existsSync(resolve(projectDir, 'vesk.config.ts')), 'denied config.write never writes a file');
  }

  // ── Unknown /__vesk/* path → 404; non-__vesk → null ─────────────────────
  {
    const { projectDir, veskDir, appDir } = freshProject();
    const router = createDevApiRouter({ appDir, veskDir, configPluginNames: [], projectDir });
    assert((await router.route('GET', '/__vesk/bogus')).status === 404, 'unknown /__vesk/* path → 404');
    assert(await router.route('GET', '/page') === null, 'non-/__vesk/ path → null (dev server falls through)');
  }

  rmSync(base, { recursive: true, force: true });

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed \u2550\u2550\u2550\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
