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
    if (!existsSync(join(pkgDir, 'src'))) continue;
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
  buildSidecar(force);
}

// The haul sidecar (`packages/haul/internal/sidecar/server.ts`) is bundled into
// `packages/cli/dist/sidecar.js` — the copy the `vesk` package ships and the Go
// haul engine spawns. A stale sidecar silently re-introduces fixed bugs into
// dev/prod servers built from tarballs, so it is part of every build.
export function buildSidecar(force = false): void {
  const cliDir = resolve(root, 'packages', 'cli');
  const sidecarSrc = resolve(root, 'packages', 'haul', 'internal', 'sidecar');
  const outPath = join(cliDir, 'dist', 'sidecar.js');

  let newest = 0;
  const scan = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) scan(p);
      else if (st.isFile() && /\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
        newest = Math.max(newest, st.mtimeMs);
      }
    }
  };
  scan(sidecarSrc);

  if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= newest) return;

  // esbuild is a dependency of packages/cli, not the repo root — resolve
  // relative to this file so the script works from any cwd.
  const esbuild = createRequire(import.meta.url)('esbuild') as typeof import('esbuild');
  console.log('[build] @vesk/vesk-cli sidecar -> esbuild');
  const res = esbuild.buildSync({
    entryPoints: [join(sidecarSrc, 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: outPath,
    format: 'esm',
    sourcemap: false,
    external: ['typescript', '@vesk/compiler', '@vesk/compiler/*', '@vesk/runtime', '@vesk/runtime/*', 'esbuild', 'esbuild-wasm'],
  });
  if (res.errors.length > 0) {
    throw new Error(`esbuild failed for haul sidecar: ${res.errors.map(e => e.text).join('; ')}`);
  }
}

export function ensurePackagesBuilt(): void {
  buildPackages(false);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPackages(process.argv.includes('--force'));
}
