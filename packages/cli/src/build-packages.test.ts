import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackages, isBuildPackagesSource, isMonorepoRoot } from './build-packages';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const externalDeps = ['typescript', 'ws', 'esbuild', 'sharp', 'zimmerframe', 'esrap', 'puppeteer', 'puppeteer-core'];

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (e) {
    failed++;
    console.log(`  not ok ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

console.log('\n=== CLI package bootstrap ===');

it('recognizes the monorepo root', () => {
  ok(isMonorepoRoot(repoRoot), 'repo root must be detected as a monorepo checkout');
});

it('rejects an installed CLI layout as a monorepo root', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vesk-cli-layout-'));
  const installedRoot = join(tmp, 'node_modules');
  try {
    mkdirSync(join(installedRoot, '@vesk', 'vesk-cli', 'dist'), { recursive: true });
    ok(!isMonorepoRoot(installedRoot), 'node_modules must not be detected as a monorepo checkout');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

it('only treats the build-packages source path as self-executable', () => {
  ok(isBuildPackagesSource('/repo/packages/cli/src/build-packages.ts'), 'unix source path');
  ok(isBuildPackagesSource('C:\\repo\\packages\\cli\\src\\build-packages.ts'), 'windows source path');
  ok(!isBuildPackagesSource('/repo/packages/cli/dist/cli.js'), 'bundled cli path');
});

it('does not bootstrap packages from an installed CLI layout', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vesk-cli-bootstrap-'));
  const installedRoot = join(tmp, 'node_modules');
  try {
    mkdirSync(join(installedRoot, '@vesk', 'vesk-cli', 'dist'), { recursive: true });
    buildPackages(false, installedRoot);
    ok(true, 'installed layout must not bootstrap packages');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

it('bundled CLI starts from an installed layout without Swagger bootstrap', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vesk-cli-installed-'));
  const installedRoot = join(tmp, 'node_modules');
  const cliDir = join(installedRoot, '@vesk', 'vesk-cli', 'dist');
  try {
    mkdirSync(cliDir, { recursive: true });
    copyFileSync(join(repoRoot, 'packages', 'cli', 'dist', 'cli.js'), join(cliDir, 'cli.js'));
    for (const dep of externalDeps) {
      const source = join(repoRoot, 'node_modules', dep);
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      if (existsSync(source)) symlinkSync(source, join(installedRoot, dep), linkType);
    }
    const result = spawnSync(process.execPath, [join(cliDir, 'cli.js'), '--help'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    eq(result.status, 0, 'installed CLI --help exit code');
    ok(!result.stderr.includes('failed to copy Swagger UI assets'), 'no Swagger bootstrap failure');
    ok(!result.stderr.includes('copy-swagger-ui.mjs'), 'no copy-swagger-ui resolution attempt');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
