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
const ciVersions = new Map();
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
	const outPkg = { ...srcPkg, name: target.name, version: ciVersion };
	// CI/local installs resolve @vesk/* via the exact `file:` pins in
	// test-app/package.json. Intra-workspace ranges like ^0.2.0 would make
	// npm hit the REGISTRY for a non-prerelease version that doesn't exist
	// yet (ENOTARGET), so relax every internal range to '*' in the packed
	// tarball.
	for (const fld of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		if (!outPkg[fld]) continue;
		for (const depName of Object.keys(outPkg[fld])) {
			if (/^@vesk\//.test(depName) || depName === 'vesk') outPkg[fld][depName] = '*';
		}
	}
	writeFileSync(
		join(tmp, 'package.json'),
		JSON.stringify(outPkg, null, 2) + '\n',
	);

	ciVersions.set(target.name, ciVersion);
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

// npm nests @vesk/* copies under vesk/node_modules when the tarball's
// dependency range doesn't match the CI version pins — those nested copies
// are pulled from the REGISTRY (stale) and shadow the fresh top-level
// packages during sidecar resolution. Prune them after install.
const nestedScope = join(testAppDir, 'node_modules', 'vesk', 'node_modules', '@vesk');
if (existsSync(nestedScope)) {
	rmSync(nestedScope, { recursive: true, force: true });
	console.log('[refresh] pruned nested node_modules/vesk/node_modules/@vesk (registry shadows)');
}

// Freshness gate: assert every installed package carries the exact CI
// version we just packed, so npm cache/lock reuse can never silently win.
let stale = false;
for (const target of TARGETS) {
	const nmPkgPath = target.name.startsWith('@')
		? join(testAppDir, 'node_modules', target.name.split('/')[0], target.name.split('/')[1], 'package.json')
		: join(testAppDir, 'node_modules', target.name, 'package.json');
	if (!existsSync(nmPkgPath)) {
		console.error(`[refresh] MISSING installed package ${target.name}`);
		stale = true;
		continue;
	}
	const inst = JSON.parse(readFileSync(nmPkgPath, 'utf-8'));
	const want = ciVersions.get(target.name);
	if (inst.version !== want) {
		console.error(`[refresh] STALE ${target.name}: installed ${inst.version}, expected ${want}`);
		stale = true;
	}
}
if (stale) process.exit(1);
console.log('[refresh] all installed versions match freshly packed CI tarballs');

console.log('[refresh] done — test-app now pins freshly built CI tarballs.');
