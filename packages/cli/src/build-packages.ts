import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');

interface PackageBuild {
  name: string;
  entry: string;
  serverEntry?: string;
  copy?: Array<{ from: string; to: string }>;
}

const PACKAGES: Record<string, PackageBuild> = {
  runtime: { name: '@vesk/runtime', entry: 'index-client', serverEntry: 'index-server' },
  compiler: {
    name: '@vesk/compiler',
    entry: 'index',
    copy: [{ from: 'src/acorn-ts-plugin', to: 'acorn-ts-plugin' }],
  },
  adapter: { name: '@vesk/adapter', entry: 'index' },
};

function newestSourceMtime(srcDir: string): number {
  let newest = 0;
  for (const name of readdirSync(srcDir)) {
    const p = join(srcDir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(p));
    } else if (st.isFile() && /\.ts$/.test(name) && !name.endsWith('.test.ts')) {
      newest = Math.max(newest, st.mtimeMs);
    }
  }
  return newest;
}

function distStale(pkgDir: string, entry: string): boolean {
  const distIndex = join(pkgDir, 'dist', `${entry}.js`);
  if (!existsSync(distIndex)) return true;
  const distPkg = join(pkgDir, 'dist', 'package.json');
  const distStamp = Math.max(statSync(distIndex).mtimeMs, existsSync(distPkg) ? statSync(distPkg).mtimeMs : 0);
  return newestSourceMtime(join(pkgDir, 'src')) > distStamp;
}

function distPackageJson(pkgName: string, entry: string, serverEntry: string | undefined, version: string): string {
  const exports: Record<string, unknown> = {
    '.': { types: `./${entry}.d.ts`, default: `./${entry}.js` },
  };
  if (serverEntry) {
    exports['./client'] = { types: `./${entry}.d.ts`, default: `./${entry}.js` };
    exports['./server'] = { types: `./${serverEntry}.d.ts`, default: `./${serverEntry}.js` };
  }
  exports['./src/*'] = './*.js';
  exports['./package.json'] = './package.json';
  return JSON.stringify({
    name: pkgName,
    version,
    type: 'module',
    main: `./${entry}.js`,
    types: `./${entry}.d.ts`,
    exports,
  }, null, 2) + '\n';
}

export function buildPackages(force = false): void {
  for (const [pkg, cfg] of Object.entries(PACKAGES)) {
    const pkgDir = resolve(root, 'packages', pkg);
    if (!force && !distStale(pkgDir, cfg.entry)) continue;

    console.log(`[build] ${cfg.name} -> tsc`);
    const tscBin = require.resolve('typescript/bin/tsc');
    const result = spawnSync(process.execPath, [tscBin, '-p', join(pkgDir, 'tsconfig.build.json')], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`tsc failed for ${cfg.name}`);
    }

    const distDir = join(pkgDir, 'dist');
    for (const c of cfg.copy || []) {
      const to = join(distDir, c.to);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(pkgDir, c.from), to, { recursive: true });
    }

    const srcPkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    writeFileSync(join(distDir, 'package.json'), distPackageJson(cfg.name, cfg.entry, cfg.serverEntry, srcPkg.version || '1.0.0'));
    console.log(`[build] ${cfg.name} -> dist`);
  }
}

export function ensurePackagesBuilt(): void {
  buildPackages(false);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPackages(process.argv.includes('--force'));
}
