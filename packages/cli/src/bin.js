#!/usr/bin/env node
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const distPath = resolve(__dirname, '../dist/cli.js');
const srcPath = resolve(__dirname, 'index.ts');
const hasDist = existsSync(distPath);

const { spawnSync } = await import('child_process');
const nodeArgs = hasDist ? [distPath, ...args] : ['--import', 'tsx', srcPath, ...args];
const result = spawnSync('node', nodeArgs, {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd(),
});
process.exit(result.status ?? 1);
