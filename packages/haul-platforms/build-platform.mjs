#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const suffix = process.argv[2];
if (!suffix) {
  console.error('usage: node build-platform.mjs <linux-x64|linux-arm64|darwin-x64|darwin-arm64|win32-x64>');
  process.exit(1);
}

const TARGETS = {
  'linux-x64': { os: 'linux', cpu: 'x64', goos: 'linux', goarch: 'amd64', exe: '' },
  'linux-arm64': { os: 'linux', cpu: 'arm64', goos: 'linux', goarch: 'arm64', exe: '' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', goos: 'darwin', goarch: 'amd64', exe: '' },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', goos: 'darwin', goarch: 'arm64', exe: '' },
  'win32-x64': { os: 'win32', cpu: 'x64', goos: 'windows', goarch: 'amd64', exe: '.exe' },
};

const t = TARGETS[suffix];
if (!t) {
  console.error(`unknown platform: ${suffix}`);
  process.exit(1);
}

const pkgDir = resolve(root, 'packages', `haul-${suffix}`);
const version = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8')).version;

writeFileSync(
  resolve(pkgDir, 'package.json'),
  JSON.stringify(
    {
      name: `@vesk/haul-${suffix}`,
      version,
      description: `Vesk native engine (haul) for ${t.os}-${t.cpu}`,
      os: [t.os],
      cpu: [t.cpu],
      license: 'MIT',
      files: ['bin'],
      scripts: {
        build: `node ../haul-platforms/build-platform.mjs ${suffix}`,
      },
    },
    null,
    2,
  ) + '\n',
);

const binDir = join(pkgDir, 'bin');
mkdirSync(binDir, { recursive: true });
rmSync(join(binDir, 'haul'), { force: true });
rmSync(join(binDir, 'haul.exe'), { force: true });
const out = join(binDir, `haul${t.exe}`);

// Bundle the compiler sidecar (server.ts) into internal/sidecar/sidecar.js so
// the Go binary can go:embed it — no external sidecar.js or VESK_SIDECAR env
// var is required at runtime.
await esbuild.build({
  entryPoints: [resolve(root, 'packages', 'haul', 'internal', 'sidecar', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: resolve(root, 'packages', 'haul', 'internal', 'sidecar', 'sidecar.js'),
  format: 'esm',
  sourcemap: false,
  external: ['typescript', '@vesk/compiler', '@vesk/compiler/*', '@vesk/runtime', '@vesk/runtime/*', 'esbuild', 'esbuild-wasm'],
  logOverride: { 'direct-eval': 'silent' },
});
console.log(`[build] sidecar bundle -> internal/sidecar/sidecar.js`);

const res = spawnSync('go', ['build', '-o', out, './cmd/haul'], {
  cwd: resolve(root, 'packages', 'haul'),
  env: { ...process.env, GOOS: t.goos, GOARCH: t.goarch, CGO_ENABLED: '0' },
  stdio: 'inherit',
});
if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`[build] @vesk/haul-${suffix} v${version} -> ${out}`);