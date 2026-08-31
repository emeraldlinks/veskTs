import {
  readPluginState,
  writePluginState,
  getPluginRecords,
  setPluginActive,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  enrichPluginRecords,
  searchPlugins,
  introspectPlugin,
  parseDtsExports,
  findPluginIcon,
  filterActivePlugins,
  PLUGIN_STATE_FILENAME,
  __internals,
} from './plugins';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

function assertRejects(p: Promise<unknown>, msg: string): Promise<void> {
  return p.then(
    () => { failed++; console.log(`  \u2717 ${msg} (expected rejection)`); },
    () => { passed++; console.log(`  \u2713 ${msg}`); },
  );
}

const base = resolve(process.cwd(), 'tmp-plugin-test');
// tmp dirs are derived from an incrementing counter so each test run starts fresh
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

console.log('\n\u2550\u2550\u2550 Vesk Plugin Manager Tests \u2550\u2550\u2550\n');

const origRunNpm = __internals.runNpm;

try {
  // ── readPluginState: default when missing ────────────────────────────────
  {
    const { veskDir } = freshDirs();
    const state = readPluginState(veskDir);
    assert(state.version === 1, 'readPluginState default version is 1 when file missing');
    assert(Array.isArray(state.plugins) && state.plugins.length === 0, 'readPluginState default plugins empty when file missing');
  }

  // ── readPluginState: reseed on corrupt JSON / wrong version ─────────────
  {
    const { veskDir } = freshDirs();
    writeFileSync(resolve(veskDir, PLUGIN_STATE_FILENAME), '{ not valid json !!', 'utf-8');
    const state = readPluginState(veskDir);
    assert(state.version === 1 && state.plugins.length === 0, 'readPluginState reseeds on corrupt JSON');
  }
  {
    const { veskDir } = freshDirs();
    writeFileSync(resolve(veskDir, PLUGIN_STATE_FILENAME), JSON.stringify({ version: 99, plugins: [{ name: 'x', package: 'x', active: true }] }), 'utf-8');
    const state = readPluginState(veskDir);
    assert(state.version === 1 && state.plugins.length === 0, 'readPluginState reseeds on wrong version');
  }

  // ── write then read round-trip ───────────────────────────────────────────
  {
    const { veskDir } = freshDirs();
    const toWrite = { version: 1 as const, plugins: [{ name: 'A', package: '@vesk/plugin-a', active: true }] };
    writePluginState(veskDir, toWrite);
    const read = readPluginState(veskDir);
    assert(
      read.version === 1 &&
      read.plugins.length === 1 &&
      read.plugins[0].name === 'A' &&
      read.plugins[0].package === '@vesk/plugin-a' &&
      read.plugins[0].active === true,
      'writePluginState then readPluginState round-trips the state',
    );
    assert(existsSync(resolve(veskDir, PLUGIN_STATE_FILENAME)), 'plugins.json file exists after write');
  }

  // ── getPluginRecords: config-only plugin defaults active (when installed) ─
  {
    const { appDir, veskDir } = freshDirs();
    // simulate an installed tailwindcss so the config default "active" resolves
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '2.2.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    const records = getPluginRecords(appDir, veskDir, ['tailwindcss', 'not-installed-plugin']);
    const rec = records.find((r) => r.name === 'tailwindcss');
    assert(!!rec, 'config-only plugin appears in records');
    assert(rec!.source === 'config', 'config-only plugin has source "config"');
    assert(rec!.active === true, 'config-only plugin defaults active when installed');
    assert(rec!.installed === true, 'config-only installed plugin reports installed=true');
    const un = records.find((r) => r.name === 'not-installed-plugin');
    assert(!!un, 'non-installed config plugin appears in records');
    assert(un!.installed === false, 'non-installed config plugin reports installed=false');
    assert(un!.active === false, 'non-installed config plugin is NEVER active');
    assert(un!.error === 'not installed', 'non-installed config plugin reports "not installed" error');
  }

  // ── getPluginRecords: installed at PROJECT root (outside appDir) + exports map ─
  // Mirrors the real layout (vesk-web): appDir = <root>/app, node_modules lives
  // at <root>/node_modules. Packages whose `exports` map blocks `<pkg>/package.json`
  // must still resolve their package.json via the entry walk-up, or they'd be
  // (incorrectly) reported "not installed".
  {
    const dir = resolve(base, 'proj-root-' + (++counter));
    const appDir = resolve(dir, 'app');
    const veskDir = resolve(appDir, '.vesk');
    mkdirSync(veskDir, { recursive: true });
    // node_modules is OUTSIDE appDir (at the project root) — the real layout.
    const pkgRoot = resolve(dir, 'node_modules', '@vesk', 'plugin-tailwind');
    mkdirSync(resolve(pkgRoot, 'dist'), { recursive: true });
    writeFileSync(
      resolve(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@vesk/plugin-tailwind',
        version: '1.0.0',
        main: 'dist/index.js',
        exports: { '.': './dist/index.js' }, // blocks `@vesk/plugin-tailwind/package.json`
      }),
      'utf-8',
    );
    writeFileSync(resolve(pkgRoot, 'dist', 'index.js'), 'export default function(){}', 'utf-8');
    const records = getPluginRecords(appDir, veskDir, ['@vesk/plugin-tailwind']);
    const rec = records.find((r) => r.name === '@vesk/plugin-tailwind');
    assert(!!rec, 'out-of-appDir exports-mapped config plugin appears in records');
    assert(rec!.installed === true, 'out-of-appDir exports-mapped plugin reports installed=true');
    assert(rec!.active === true, 'out-of-appDir installed plugin resolves to active');
    assert(rec!.version === '1.0.0', 'out-of-appDir plugin reads version from resolved package.json');
    assert(rec!.error !== 'not installed', 'out-of-appDir installed plugin has no "not installed" error');
  }

  // ── state entry can deactivate a config plugin by name ──────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '2.2.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    writePluginState(veskDir, { version: 1, plugins: [{ name: 'tailwindcss', package: 'tailwindcss', active: false }] });
    const records = getPluginRecords(appDir, veskDir, ['tailwindcss']);
    const rec = records.find((r) => r.name === 'tailwindcss');
    assert(rec!.active === false, 'state entry deactivates a config plugin by name');
    assert(rec!.source === 'config', 'deactivated config plugin still reports source "config"');
  }

  // ── state-only plugin appears as source "state" ─────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-mdx');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-mdx', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    writePluginState(veskDir, { version: 1, plugins: [{ name: 'mdx', package: '@vesk/plugin-mdx', active: true }] });
    const records = getPluginRecords(appDir, veskDir, []);
    const rec = records.find((r) => r.name === 'mdx');
    assert(!!rec, 'state-only plugin appears in records');
    assert(rec!.source === 'state', 'state-only plugin has source "state"');
    assert(rec!.active === true, 'state-only installed plugin active flag preserved');
  }

  // ── filterActivePlugins: inactive never ships, unregistered kept ────────
  {
    const configPlugins = [
      { name: 'tailwindcss' },
      { name: 'mdx' },
      { name: 'unregistered' },
    ];
    const records = [
      { name: 'tailwindcss', active: true },
      { name: 'mdx', active: false },
      { name: 'somestate', active: true },
    ] as { name: string; active: boolean }[];
    const filtered = filterActivePlugins(configPlugins, records as any);
    assert(filtered.length === 2, 'filterActivePlugins drops the inactive config plugin');
    assert(
      filtered.some((p: any) => p.name === 'tailwindcss') &&
      filtered.some((p: any) => p.name === 'unregistered'),
      'filterActivePlugins keeps active + unregistered config plugins',
    );
    assert(
      !filtered.some((p: any) => p.name === 'mdx'),
      'filterActivePlugins drops the INACTIVE config plugin (never ships)',
    );
  }

  // ── setPluginActive: set + clear ─────────────────────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '2.2.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    setPluginActive(veskDir, 'tailwindcss', true);
    let rec = getPluginRecords(appDir, veskDir, ['tailwindcss'])[0];
    assert(rec.active === true, 'setPluginActive(true) activates an installed plugin');
    setPluginActive(veskDir, 'tailwindcss', false);
    rec = getPluginRecords(appDir, veskDir, ['tailwindcss'])[0];
    assert(rec.active === false, 'setPluginActive(false) deactivates an existing plugin');
    // even when the state entry says active, a non-installed plugin is NEVER active
    setPluginActive(veskDir, 'phantom', true);
    const records = getPluginRecords(appDir, veskDir, []);
    const withState = records.find((r) => r.name === 'phantom');
    assert(withState !== undefined && withState.active === false, 'non-installed plugin is inactive even when the state entry is active');
    assert(withState !== undefined && withState.error === 'not installed', 'non-installed plugin carries "not installed" error');
  }

  // ── installPlugin: input validation (no network) ────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    await assertRejects(installPlugin(appDir, veskDir, ''), 'installPlugin rejects empty package spec');
    await assertRejects(installPlugin(appDir, veskDir, 'has space'), 'installPlugin rejects package spec with spaces');
    await assertRejects(installPlugin(appDir, veskDir, '..'), 'installPlugin rejects ".." package spec');
    await assertRejects(installPlugin(appDir, veskDir, 'pkg@1.0.0 more'), 'installPlugin rejects multi-token spec');
  }

  // ── installPlugin: registers active + calls runNpm(['install', pkg]) ────
  {
    const { appDir, veskDir } = freshDirs();
    const calls: string[][] = [];
    __internals.runNpm = async (dir, args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    // simulate an installed package resolvable in node_modules with a vesk marker
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-fake');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      resolve(pkgDir, 'package.json'),
      JSON.stringify({ name: '@vesk/plugin-fake', version: '1.0.0', main: 'index.js' }),
      'utf-8',
    );
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const record = await installPlugin(appDir, veskDir, '@vesk/plugin-fake');
    assert(calls.length === 1 && calls[0][0] === 'install' && calls[0][1] === '@vesk/plugin-fake', 'installPlugin runs npm install <pkg>');
    assert(record.active === true, 'installPlugin registers the plugin as active by default');
    assert(record.installed === true, 'installPlugin reports installed=true for resolvable package');
    assert(record.error === null, 'installPlugin sets no error for a vesk-marked package');
    assert(record.source === 'state', 'installed plugin has source "state"');
    const state = readPluginState(veskDir);
    assert(state.plugins.length === 1 && state.plugins[0].active === true, 'installPlugin writes active entry to state');
  }

  // ── installPlugin: unmarked package gets an error but registers ─────────
  {
    const { appDir, veskDir } = freshDirs();
    __internals.runNpm = async () => ({ code: 0, stdout: '', stderr: '' });
    const pkgDir = resolve(appDir, 'node_modules', 'not-a-vesk');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'not-a-vesk', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const record = await installPlugin(appDir, veskDir, 'not-a-vesk');
    assert(record.error !== null && /may not be a Vesk plugin/.test(record.error!), 'installPlugin flags unmarked package with an error');
    assert(record.active === true, 'unmarked plugin still registers active');
  }

  // ── installPlugin: npm non-zero exit rejects with stderr ────────────────
  {
    const { appDir, veskDir } = freshDirs();
    __internals.runNpm = async () => ({ code: 1, stdout: '', stderr: 'ENOENT: no such thing' });
    await assertRejects(
      installPlugin(appDir, veskDir, 'whatever').then(() => {
        throw new Error('should have rejected');
      }),
      'installPlugin rejects on non-zero npm exit',
    );
    installPlugin(appDir, veskDir, 'whatever').catch((e) => {
      assert(String(e?.message).includes('ENOENT'), 'installPlugin error embeds npm stderr');
    });
    await new Promise((r) => setTimeout(r, 0));
  }

  // ── uninstallPlugin: calls runNpm(['uninstall', pkg]) + clears state ────
  {
    const { appDir, veskDir } = freshDirs();
    const calls: string[][] = [];
    __internals.runNpm = async (_d, args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    writePluginState(veskDir, {
      version: 1,
      plugins: [
        { name: '@vesk/plugin-a', package: '@vesk/plugin-a', active: true },
        { name: 'keepme', package: 'keepme', active: true },
      ],
    });
    await uninstallPlugin(appDir, veskDir, '@vesk/plugin-a');
    assert(calls.length === 1 && calls[0][0] === 'uninstall' && calls[0][1] === '@vesk/plugin-a', 'uninstallPlugin runs npm uninstall <pkg>');
    const state = readPluginState(veskDir);
    assert(state.plugins.length === 1 && state.plugins[0].name === 'keepme', 'uninstallPlugin clears the matching state entry, keeps others');
  }

  // ── uninstallPlugin: input validation ───────────────────────────────────
  {
    const { appDir, veskDir } = freshDirs();
    await assertRejects(uninstallPlugin(appDir, veskDir, ''), 'uninstallPlugin rejects empty package spec');
    await assertRejects(uninstallPlugin(appDir, veskDir, 'x x'), 'uninstallPlugin rejects package spec with spaces');
  }

  // ── metadata precedence: vesk.meta.json wins over package.json ──────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-meta');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      resolve(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@vesk/plugin-meta', version: '1.2.3', main: 'index.js',
        description: 'pkg desc', author: 'pkg-author', license: 'MIT',
        homepage: 'https://pkg.example', repository: 'https://github.com/pkg', keywords: ['vesk', 'pkg-word'],
      }),
      'utf-8',
    );
    writeFileSync(
      resolve(pkgDir, 'vesk.meta.json'),
      JSON.stringify({
        description: 'meta desc', author: 'Meta Author', license: 'Apache-2.0',
        homepage: 'https://meta.example', repository: 'https://github.com/meta', keywords: ['vesk', 'meta-word'],
      }),
      'utf-8',
    );
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const records = getPluginRecords(appDir, veskDir, ['@vesk/plugin-meta']);
    const rec = records.find((r) => r.name === '@vesk/plugin-meta')!;
    assert(rec.metaSource === 'vesk.meta.json', 'metaSource flags vesk.meta.json when present');
    assert(rec.description === 'meta desc', 'vesk.meta.json description wins over package.json');
    assert(rec.author === 'Meta Author', 'vesk.meta.json author wins over package.json');
    assert(rec.license === 'Apache-2.0', 'vesk.meta.json license wins over package.json');
    assert(rec.homepage === 'https://meta.example', 'vesk.meta.json homepage wins over package.json');
    assert(rec.repository === 'https://github.com/meta', 'vesk.meta.json repository wins over package.json');
    assert(rec.version === '1.2.3', 'version still comes from package.json (meta has none)');
    assert(rec.keywords.includes('meta-word') && rec.keywords.includes('vesk'), 'vesk.meta.json keywords override package.json');
  }

  // ── metadata precedence: package.json fills when no vesk.meta.json ───────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      resolve(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'tailwindcss', version: '3.0.0', main: 'index.js',
        description: 'A utility-first CSS framework', author: 'Tailwind', license: 'MIT',
      }),
      'utf-8',
    );
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    const rec = getPluginRecords(appDir, veskDir, ['tailwindcss'])[0];
    assert(rec.metaSource === 'package.json', 'metaSource is package.json when no vesk.meta.json');
    assert(rec.description === 'A utility-first CSS framework', 'package.json description used when no meta');
    assert(rec.author === 'Tailwind' && rec.license === 'MIT', 'package.json author+license used when no meta');
    assert(rec.iconUrl === null, 'no icon declared → iconUrl null');
  }

  // ── metadata: conventional icon.png / icon.ico (no explicit field) ──────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-icon');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-icon', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    // conventional icon.png, no vesk.meta.json icon field declared
    writeFileSync(resolve(pkgDir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf-8');
    writeFileSync(resolve(pkgDir, 'vesk.meta.json'), JSON.stringify({ description: 'icon plugin' }), 'utf-8');

    const rec = getPluginRecords(appDir, veskDir, ['@vesk/plugin-icon'])[0];
    assert(rec.iconUrl === '/__vesk/plugins/%40vesk%2Fplugin-icon/icon', 'iconUrl points at the /icon endpoint when conventional icon.png exists');
    const found = findPluginIcon(appDir, '@vesk/plugin-icon');
    assert(found !== null && found.mime === 'image/png', 'findPluginIcon resolves conventional icon.png with PNG mime');
  }
  // conventional icon.ico
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-ico');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-ico', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    writeFileSync(resolve(pkgDir, 'icon.ico'), Buffer.from([0x00, 0x00, 0x01, 0x00]), 'utf-8');
    writeFileSync(resolve(pkgDir, 'vesk.meta.json'), JSON.stringify({}), 'utf-8');
    const found = findPluginIcon(appDir, '@vesk/plugin-ico');
    assert(found !== null && found.mime === 'image/x-icon', 'findPluginIcon resolves conventional icon.ico with ICO mime');
  }
  // explicit vesk.meta.json icon field beats the conventional filename
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-xicon');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-xicon', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    writeFileSync(resolve(pkgDir, 'brand.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf-8');
    writeFileSync(resolve(pkgDir, 'vesk.meta.json'), JSON.stringify({ icon: 'brand.png' }), 'utf-8');
    const found = findPluginIcon(appDir, '@vesk/plugin-xicon');
    assert(found !== null && found.file.endsWith('brand.png'), 'explicit vesk.meta.json icon field is honored');
  }
  // no icon at all → findPluginIcon null
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-noicon');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-noicon', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    writeFileSync(resolve(pkgDir, 'vesk.meta.json'), JSON.stringify({}), 'utf-8');
    assert(findPluginIcon(appDir, '@vesk/plugin-noicon') === null, 'findPluginIcon is null when no icon present');
  }

  // ── registry enrichment: mocked fetch fills latest/updatedAt/etc. ────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '2.2.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const origFetch = __internals.fetch;
    __internals.fetch = async (url) => new Response(JSON.stringify({
      'dist-tags': { latest: '3.4.0' },
      time: { modified: '2024-01-01T00:00:00.000Z' },
      author: 'Reg Author <reg@example.com>',
      repository: { url: 'https://github.com/reg/repo' },
      license: 'ISC',
      description: 'reg desc',
    }), { status: 200 });
    try {
      const records = await enrichPluginRecords(getPluginRecords(appDir, veskDir, ['tailwindcss']));
      const rec = records[0];
      assert(rec.latest === '3.4.0', 'enrichment fills latest from dist-tags');
      assert(rec.updatedAt === '2024-01-01T00:00:00.000Z', 'enrichment fills updatedAt from time.modified');
      assert(rec.author === 'Reg Author <reg@example.com>', 'enrichment fills author from registry');
      assert(rec.license === 'ISC', 'enrichment fills license from registry');
      assert(rec.repository === 'https://github.com/reg/repo', 'enrichment fills repository from registry');
    } finally {
      __internals.fetch = origFetch;
      __internals.clearRegistryCache();
    }
  }
  // registry unreachable → enrichment is non-fatal, records stay readable
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'tailwindcss');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '2.2.0', main: 'index.js', description: 'local desc' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    const origFetch = __internals.fetch;
    __internals.fetch = async () => { throw new Error('network down'); };
    try {
      const records = await enrichPluginRecords(getPluginRecords(appDir, veskDir, ['tailwindcss']));
      assert(records[0].installed === true, 'offline enrichment keeps installed=true (non-fatal)');
      assert(records[0].latest === null && records[0].description !== null, 'offline enrichment leaves latest null, keeps local metadata');
    } finally {
      __internals.fetch = origFetch;
      __internals.clearRegistryCache();
    }
  }

  // ── exports introspection: entry, packageJsonExports, dtsExports ─────────
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-ex');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      resolve(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@vesk/plugin-ex', version: '1.0.0', main: './dist/index.js', module: './dist/index.mjs',
        types: './dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' }, './style.css': './style.css' },
      }),
      'utf-8',
    );
    mkdirSync(resolve(pkgDir, 'dist'), { recursive: true });
    writeFileSync(resolve(pkgDir, 'dist', 'index.js'), '', 'utf-8');
    writeFileSync(resolve(pkgDir, 'dist', 'index.mjs'), '', 'utf-8');
    writeFileSync(resolve(pkgDir, 'style.css'), '', 'utf-8');
    writeFileSync(
      resolve(pkgDir, 'dist', 'index.d.ts'),
      [
        'export interface PluginOptions { enabled: boolean }',
        'export function start(opts?: PluginOptions): void;',
        'export const VERSION: string;',
        'export type Callback = () => void;',
        'export { something as renamed } from "./other";',
        'export default class Plugin {}',
      ].join('\n'),
      'utf-8',
    );
    const info = introspectPlugin(appDir, '@vesk/plugin-ex');
    assert(info.ok === true, 'introspectPlugin reports ok for an installed plugin');
    assert(info.entry !== null && info.entry.includes('dist/index.js'), 'entry resolves to package main');
    assert(
      info.packageJsonExports !== null && info.packageJsonExports['./style.css'] === './style.css' && info.packageJsonExports['.'] !== undefined,
      'packageJsonExports flattens the exports map',
    );
    assert(info.dtsPath !== null && info.dtsPath.endsWith('index.d.ts'), 'dtsPath resolves via package.json types');
    const names = info.dtsExports;
    assert(names.includes('PluginOptions'), 'dtsExports includes an exported interface');
    assert(names.includes('start'), 'dtsExports includes an exported function');
    assert(names.includes('VERSION'), 'dtsExports includes an exported const');
    assert(names.includes('Callback'), 'dtsExports includes an exported type alias');
    assert(names.includes('renamed'), 'dtsExports renames export-as (local name wins)');
    assert(names.includes('default'), 'dtsExports includes the default export');
  }

  // ── exports introspection: no exports / no .d.ts → ok:false safe fallback ─
  {
    const { appDir, veskDir } = freshDirs();
    const pkgDir = resolve(appDir, 'node_modules', 'plain-pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'plain-pkg', version: '1.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');
    const info = introspectPlugin(appDir, 'plain-pkg');
    assert(info.ok === true && info.dtsPath === null, 'plugin without .d.ts yields null dtsPath (not a crash)');
  }
  {
    const { appDir, veskDir } = freshDirs();
    const info = introspectPlugin(appDir, 'missing-pkg');
    assert(info.ok === false, 'introspectPlugin ok:false for a non-installed package');
  }

  // ── searchPlugins: mocks registry, maps result shape ────────────────────
  {
    const origFetch = __internals.fetch;
    __internals.fetch = async (url) => new Response(JSON.stringify({
      objects: [
        { package: {
          name: '@vesk/plugin-demo', version: '1.0.0', description: 'a demo',
          author: { name: 'Demo', email: 'd@example.com' }, date: '2024-02-01T00:00:00.000Z',
          keywords: ['vesk'], links: { homepage: 'https://demo.example' },
        } },
        { package: {
          name: 'not-vesk', version: '0.9.0', description: null,
          author: null, date: null, keywords: [], links: null,
        } },
      ],
    }), { status: 200 });
    try {
      const results = await searchPlugins('');
      assert(Array.isArray(results) && results.length === 2, 'searchPlugins maps the registry objects array');
      assert(results[0].name === '@vesk/plugin-demo' && results[0].version === '1.0.0', 'searchPlugins maps name+version');
      assert(results[0].description === 'a demo' && results[0].author === 'Demo <d@example.com>', 'searchPlugins maps description + author object');
      assert(results[0].date === '2024-02-01T00:00:00.000Z' && results[0].keywords.includes('vesk'), 'searchPlugins maps date + keywords');
      assert(results[0].links !== null && results[0].links.homepage === 'https://demo.example', 'searchPlugins maps links');
      assert(results[1].author === null && results[1].links === null && results[1].keywords.length === 0, 'sparse package fields map to null/empty');
    } finally {
      __internals.fetch = origFetch;
      __internals.clearRegistryCache();
    }
  }
  // search offline → empty array (non-fatal)
  {
    const origFetch = __internals.fetch;
    __internals.fetch = async () => { throw new Error('offline'); };
    try {
      const results = await searchPlugins('anything');
      assert(results.length === 0, 'searchPlugins returns [] when the registry is unreachable');
    } finally {
      __internals.fetch = origFetch;
      __internals.clearRegistryCache();
    }
  }
  // a failed registry fetch must NOT be cached: the same query can succeed on
  // a later retry instead of returning a stale empty result ("won't search again")
  {
    const origFetch = __internals.fetch;
    let calls = 0;
    __internals.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('registry down on first attempt');
      return new Response(JSON.stringify({
        objects: [{ package: { name: '@vesk/plugin-demo', version: '1.0.0' } }],
      }), { status: 200 });
    };
    try {
      const first = await searchPlugins('@vesk');
      assert(first.length === 0, 'first search attempt fails gracefully when the registry is down');
      const second = await searchPlugins('@vesk');
      assert(second.length === 1 && second[0].name === '@vesk/plugin-demo', 'a retry on the same query returns results (failure is not cached)');
    } finally {
      __internals.fetch = origFetch;
      __internals.clearRegistryCache();
    }
  }

  // ── updatePlugin: runs npm install <pkg>@latest + refreshes state ───────
  {
    const { appDir, veskDir } = freshDirs();
    const calls: string[][] = [];
    __internals.runNpm = async (_d, args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    writePluginState(veskDir, { version: 1, plugins: [{ name: 'mdx', package: '@vesk/plugin-mdx', active: true }] });
    const pkgDir = resolve(appDir, 'node_modules', '@vesk', 'plugin-mdx');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({ name: '@vesk/plugin-mdx', version: '2.0.0', main: 'index.js' }), 'utf-8');
    writeFileSync(resolve(pkgDir, 'index.js'), '', 'utf-8');

    const record = await updatePlugin(appDir, veskDir, '@vesk/plugin-mdx');
    assert(calls.length === 1 && calls[0][0] === 'install' && calls[0][1] === '@vesk/plugin-mdx@latest', 'updatePlugin runs npm install <pkg>@latest');
    assert(record.version === '2.0.0', 'updatePlugin re-resolves the freshly installed version');
    assert(record.name === '@vesk/plugin-mdx' && record.active === true, 'updatePlugin keeps state activation + name');
    const state = readPluginState(veskDir);
    assert(state.plugins.length === 1 && state.plugins[0].active === true, 'updatePlugin refreshes (keeps) the state entry');
  }
  // updatePlugin: npm failure rejects
  {
    const { appDir, veskDir } = freshDirs();
    __internals.runNpm = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    await assertRejects(
      updatePlugin(appDir, veskDir, 'x').then(() => { throw new Error('should reject'); }),
      'updatePlugin rejects on non-zero npm exit',
    );
  }
  // updatePlugin: input validation
  {
    const { appDir, veskDir } = freshDirs();
    await assertRejects(updatePlugin(appDir, veskDir, ''), 'updatePlugin rejects empty package spec');
    await assertRejects(updatePlugin(appDir, veskDir, 'a b'), 'updatePlugin rejects package spec with spaces');
  }
} finally {
  __internals.runNpm = origRunNpm;
  rmSync(base, { recursive: true, force: true });
}

console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed \u2550\u2550\u2550\n`);
process.exit(failed > 0 ? 1 : 0);
