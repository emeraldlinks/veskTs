#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const PLATFORM_BIN = {
  'linux-x64': '@vesk/haul-linux-x64',
  'linux-arm64': '@vesk/haul-linux-arm64',
  'darwin-x64': '@vesk/haul-darwin-x64',
  'darwin-arm64': '@vesk/haul-darwin-arm64',
  'win32-x64': '@vesk/haul-win32-x64',
};

const key = `${process.platform}-${process.arch}`;
const pkgName = PLATFORM_BIN[key];
if (!pkgName) {
  console.error(`[vesk haul] unsupported platform: ${key}`);
  process.exit(1);
}

let binPath;
try {
  const binFile = `bin/haul${process.platform === 'win32' ? '.exe' : ''}`;
  binPath = require.resolve(`${pkgName}/${binFile}`);
} catch {
  console.error(
    `[vesk haul] ${pkgName} is not installed — haul ships as a platform binary.\n` +
    `  Run \`npm install\` again, or install the matching binary for your platform:\n` +
    `  npm install ${pkgName}@$(node -p "require('vesk/package.json').version")`,
  );
  process.exit(1);
}

const env = { ...process.env };
const sidecar = join(__dirname, '..', 'dist', 'sidecar.js');
if (existsSync(sidecar)) env.VESK_SIDECAR = sidecar;
else delete env.VESK_SIDECAR;

const result = spawnSync(binPath, process.argv.slice(2), {
  stdio: 'inherit',
  env,
  cwd: process.cwd(),
});
process.exit(result.status ?? 1);