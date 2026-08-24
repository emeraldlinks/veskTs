#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');

const INTERNAL_NAMES = new Set([
  '@vesk/adapter',
  '@vesk/compiler',
  '@vesk/haul-darwin-arm64',
  '@vesk/haul-darwin-x64',
  '@vesk/haul-linux-arm64',
  '@vesk/haul-linux-x64',
  '@vesk/haul-win32-x64',
  '@vesk/lsp',
  '@vesk/plugin-tailwind',
  '@vesk/prettier-plugin',
  '@vesk/runtime',
  '@vesk/vesk-cli',
  'create-vesk',
]);

const PUBLISH_ORDER = [
  '@vesk/compiler',
  '@vesk/runtime',
  '@vesk/plugin-tailwind',
  '@vesk/prettier-plugin',
  '@vesk/adapter',
  '@vesk/lsp',
  '@vesk/haul-linux-x64',
  '@vesk/haul-linux-arm64',
  '@vesk/haul-darwin-x64',
  '@vesk/haul-darwin-arm64',
  '@vesk/haul-win32-x64',
  '@vesk/vesk-cli',
  'create-vesk',
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(msg) {
  console.error(`\x1b[31mrelease: ${msg}\x1b[0m`);
  process.exit(1);
}

const newVersion = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!newVersion) fail('usage: node scripts/release.mjs <version> [--dry-run]');
if (!SEMVER.test(newVersion)) fail(`"${newVersion}" is not a valid semver version`);
const dryRun = process.argv.includes('--dry-run');

const packages = [];
for (const dir of readdirSync(PACKAGES_DIR)) {
  const pkgPath = join(PACKAGES_DIR, dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  packages.push({ dir, path: pkgPath, pkg: JSON.parse(readFileSync(pkgPath, 'utf8')) });
}

const byName = new Map(packages.map((p) => [p.pkg.name, p]));

function bumpDepFields(pkg) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (INTERNAL_NAMES.has(name) && byName.has(name)) deps[name] = `^${newVersion}`;
    }
  }
}

console.log(`\x1b[2mrelease: bumping all packages to \x1b[1m${newVersion}\x1b[0m`);
for (const { dir, path, pkg } of packages) {
  pkg.version = newVersion;
  bumpDepFields(pkg);
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  \x1b[32m✓\x1b[0m ${pkg.name} \x1b[2m(${dir}/package.json)\x1b[0m`);
}

const scaffold = join(PACKAGES_DIR, 'create-vesk', 'src', 'index.js');
if (existsSync(scaffold)) {
  const src = readFileSync(scaffold, 'utf8');
  const patched = src.replace(
    /(['"]@vesk\/[a-z0-9-]+['"]\s*:\s*['"])\^[^'"]+(['"])/g,
    `$1^${newVersion}$2`
  );
  // Every vesk package reference in the scaffold template must be bumped to
  // the release version; a stale literal (e.g. a dep added with a pinned
  // version instead of the ^0.1.0 placeholder) fails the release.
  const stray = (patched.match(/['"](?:@vesk\/[a-z0-9-]+|vesk)['"]\s*:\s*['"][^'"]+['"]/g) || [])
    .filter((s) => !s.includes(`^${newVersion}`));
  if (stray.length > 0) {
    console.error('\x1b[31mrelease: create-vesk references an unpatched vesk version:\x1b[0m');
    for (const s of stray) console.error(`  ${s}`);
    process.exit(1);
  }
  writeFileSync(scaffold, patched);
  console.log('  \x1b[32m✓\x1b[0m create-vesk scaffold template versions');
}

console.log('\x1b[2mrelease: publish order:\x1b[0m');
for (const name of PUBLISH_ORDER) {
  const p = byName.get(name);
  console.log(`  ${p ? `${name} (${p.dir})` : `${name} \x1b[31m(missing!)\x1b[0m`}`);
}

console.log(`\n\x1b[1mrelease: building all packages\x1b[0m`);
// Build in dependency order — runtime/adapter before compiler/cli — so a
// package's typecheck always sees its dependencies' freshly built dist/.
const BUILD_ORDER = [
  '@vesk/runtime',
  '@vesk/plugin-tailwind',
  '@vesk/adapter',
  '@vesk/compiler',
  '@vesk/prettier-plugin',
  '@vesk/lsp',
  '@vesk/haul-linux-x64',
  '@vesk/haul-linux-arm64',
  '@vesk/haul-darwin-x64',
  '@vesk/haul-darwin-arm64',
  '@vesk/haul-win32-x64',
  '@vesk/vesk-cli',
  'create-vesk',
];
for (const name of BUILD_ORDER) {
  const p = byName.get(name);
  if (!p) continue;
  const build = p.pkg.scripts && p.pkg.scripts.build;
  if (!build) {
    console.log(`  \x1b[2m—\x1b[0m ${name} (no build script)`);
    continue;
  }
  console.log(`  \x1b[1m>\x1b[0m npm run build (${name})`);
  const res = spawnSync('npm', ['run', 'build'], { cwd: dirname(p.path), stdio: 'inherit' });
  if (res.status !== 0) fail(`npm run build failed for ${name}`);
}

if (dryRun) {
  console.log('\n\x1b[2mDry run — versions bumped and builds ran, nothing published.\x1b[0m');
  console.log('\x1b[2mPublish commands:\x1b[0m');
  for (const name of PUBLISH_ORDER) {
    const p = byName.get(name);
    if (p) console.log(`  cd packages/${p.dir} && npm publish`);
  }
  process.exit(0);
}

for (const name of PUBLISH_ORDER) {
  const p = byName.get(name);
  if (!p) fail(`package ${name} not found`);
  console.log(`\n\x1b[1mrelease: publishing ${name}\x1b[0m`);
  const res = spawnSync('npm', ['publish', '--access', 'public'], {
    cwd: dirname(p.path),
    stdio: 'inherit',
  });
  if (res.status !== 0) fail(`npm publish failed for ${name}`);
}

console.log(`\n\x1b[32m✓\x1b[0m Published all packages at \x1b[1m${newVersion}\x1b[0m`);
