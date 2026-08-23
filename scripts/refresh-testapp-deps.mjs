#!/usr/bin/env node
/**
 * Rebuilds workspace packages and repacks them as uniquely-versioned CI
 * tarballs for test-app, then rewrites test-app's dependency pins and runs
 * npm install. Guarantees every CI run exercises the LATEST source instead
 * of stale checked-in tarballs (npm's same-name+version cache makes reuse
 * of unchanged filenames unsafe).
 *
 * Usage: node scripts/refresh-testapp-deps.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const testAppDir = join(root, 'test-app');
const tarballsDir = join(testAppDir, 'tarballs');

// dir in packages/, and the dependency NAME test-app references.
const TARGETS = [
	{ dir: 'compiler', name: '@vesk/compiler' },
	{ dir: 'runtime', name: '@vesk/runtime' },
	{ dir: 'adapter', name: '@vesk/adapter' },
	{ dir: 'plugin-tailwind', name: '@vesk/plugin-tailwind' },
	{ dir: 'cli', name: 'vesk' },
];

function run(cmd, args, opts = {}) {
	const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
	if (res.status !== 0) {
		console.error(`refresh-testapp-deps: \`${cmd} ${args.join(' ')}\` failed`);
		process.exit(res.status ?? 1);
	}
}

console.log('[refresh] building workspace packages...');
run('npx', ['tsx', 'packages/cli/src/build-packages.ts'], { cwd: root });
run('npm', ['run', 'build'], { cwd: join(root, 'packages', 'plugin-tailwind') });

const epoch = Date.now();
mkdirSync(tarballsDir, { recursive: true });

// Remove previously generated CI tarballs so the directory stays tidy.
for (const f of readdirSync(tarballsDir)) {
	if (/^-ci\.\d+\.tgz$/.test(f.split('/').pop()) || /-ci\.\d+\.tgz$/.test(f)) {
		rmSync(join(tarballsDir, f));
	}
}

const pkg = JSON.parse(readFileSync(join(testAppDir, 'package.json'), 'utf-8'));

for (const target of TARGETS) {
	const srcPkgPath = join(root, 'packages', target.dir, 'package.json');
	const srcPkg = JSON.parse(readFileSync(srcPkgPath, 'utf-8'));
	const baseVersion = srcPkg.version || '0.0.0';
	const ciVersion = `${baseVersion}-ci.${epoch}`;

	const tmp = join(root, '.ci-pack', target.dir.replace(/[\\/]/g, '_'));
	rmSync(tmp, { recursive: true, force: true });
	cpSync(join(root, 'packages', target.dir), tmp, { recursive: true });
	rmSync(join(tmp, 'node_modules'), { recursive: true, force: true });

	const packedName = `${target.name.replace(/^@/, '').replace('/', '-')}-${ciVersion}.tgz`;
	writeFileSync(
		join(tmp, 'package.json'),
		JSON.stringify({ ...srcPkg, name: target.name, version: ciVersion }, null, 2) + '\n',
	);

	console.log(`[refresh] packing ${target.name}@${ciVersion}`);
	run('npm', ['pack', '--pack-destination', tarballsDir], { cwd: tmp });
	if (!existsSync(join(tarballsDir, packedName))) {
		console.error(`refresh-testapp-deps: expected tarball ${packedName} was not produced`);
		process.exit(1);
	}
	pkg.dependencies[target.name] = `file:./tarballs/${packedName}`;
	rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(testAppDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Purge previously installed copies so npm cannot satisfy resolution from
// stale directories, then install fresh.
for (const target of TARGETS) {
	const scopePrefix = target.name.startsWith('@') ? target.name.split('/')[0].replace('@', '') : null;
	const nmPath = scopePrefix
		? join(testAppDir, 'node_modules', scopePrefix, target.name.split('/')[1])
		: join(testAppDir, 'node_modules', target.name);
	rmSync(nmPath, { recursive: true, force: true });
}

console.log('[refresh] installing test-app dependencies...');
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: testAppDir });

console.log('[refresh] done — test-app now pins freshly built CI tarballs.');
