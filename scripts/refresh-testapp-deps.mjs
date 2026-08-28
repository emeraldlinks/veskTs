#!/usr/bin/env node
/**
 * Rebuilds workspace packages and repacks them as uniquely-versioned CI
 * tarballs for a Vesk example app (default: test-app), then rewrites the
 * app's dependency pins and runs npm install. Guarantees every run (CI or
 * local) exercises the LATEST source instead of stale checked-in tarballs
 * (npm's same-name+version cache makes reuse of unchanged filenames unsafe).
 *
 * Usage: node scripts/refresh-testapp-deps.mjs [appDir]
 *   appDir defaults to "test-app". Pass another example app dir, e.g.
 *   "vesk-docs", to repack for that app instead. The default TARGETS mirror
 *   test-app's deps; for other apps the target list is derived from the
 *   app's own @vesk/* / vesk dependency names (so vesk-docs's
 *   @vesk/vesk-cli maps to packages/cli automatically).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appArg = process.argv[2];
const appDirName = appArg || 'test-app';
const appDir = join(root, appDirName);
const tarballsDir = join(appDir, 'tarballs');

// name -> directory under packages/ (built from every package.json in packages/)
function buildPackageIndex() {
	const index = new Map();
	for (const dir of readdirSync(join(root, 'packages'))) {
		try {
			const pkgPath = join(root, 'packages', dir, 'package.json');
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (pkg.name) index.set(pkg.name, dir);
		} catch {
			// skip dirs without a readable package.json
		}
	}
	return index;
}

function deriveTargets(index) {
	const appPkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'));
	const names = new Set([
		...Object.keys(appPkg.dependencies || {}),
		...Object.keys(appPkg.devDependencies || {}),
	]);
	const targets = [];
	for (const name of names) {
		const dir = index.get(name);
		if (dir && name.startsWith('@vesk/')) targets.push({ dir, name });
	}
	return targets;
}

// dir in packages/, and the dependency NAME the app references.
const TARGETS = buildDefaultTargets();

function buildDefaultTargets() {
	// test-app: CLI dependency name is `vesk` (not @vesk/vesk-cli like vesk-docs).
	if (appDirName === 'test-app') {
		return [
			{ dir: 'types', name: '@vesk/types' },
			{ dir: 'compiler', name: '@vesk/compiler' },
			{ dir: 'runtime', name: '@vesk/runtime' },
			{ dir: 'adapter', name: '@vesk/adapter' },
			{ dir: 'plugin-tailwind', name: '@vesk/plugin-tailwind' },
			{ dir: 'cli', name: 'vesk' },
		];
	}
	return deriveTargets(buildPackageIndex());
}

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
// The `vesk` CLI bin (test-app's `dev`/`build`/`start` scripts and
// leakage-test.mjs invoke `node_modules/.bin/vesk`) must be compiled before
// packing, or the tarball ships without dist/cli.js and the symlink is dead.
run('npm', ['run', 'build'], { cwd: join(root, 'packages', 'cli') });

const epoch = Date.now();
const ciVersions = new Map();
mkdirSync(tarballsDir, { recursive: true });

// Remove previously generated CI tarballs so the directory stays tidy.
for (const f of readdirSync(tarballsDir)) {
	if (/^-ci\.\d+\.tgz$/.test(f.split('/').pop()) || /-ci\.\d+\.tgz$/.test(f)) {
		rmSync(join(tarballsDir, f));
	}
}

const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'));

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
	let pinned = false;
	for (const fld of ['dependencies', 'devDependencies']) {
		if (pkg[fld] && Object.prototype.hasOwnProperty.call(pkg[fld], target.name)) {
			pkg[fld][target.name] = `file:./tarballs/${packedName}`;
			pinned = true;
			break;
		}
	}
	if (!pinned) pkg.dependencies[target.name] = `file:./tarballs/${packedName}`;
	rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(appDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Purge previously installed copies so npm cannot satisfy resolution from
// stale directories, then install fresh.
for (const target of TARGETS) {
	const scopePrefix = target.name.startsWith('@') ? target.name.split('/')[0].replace('@', '') : null;
	const nmPath = scopePrefix
		? join(appDir, 'node_modules', scopePrefix, target.name.split('/')[1])
		: join(appDir, 'node_modules', target.name);
	rmSync(nmPath, { recursive: true, force: true });
}

console.log(`[refresh] installing ${appDirName} dependencies...`);
run('npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir });

// npm nests @vesk/* copies under the CLI package's node_modules when the
// tarball's dependency range doesn't match the CI version pins — those
// nested copies are pulled from the REGISTRY (stale) and shadow the fresh
// top-level packages during sidecar resolution. Prune them after install.
// The CLI dep is `vesk` in test-app but `@vesk/vesk-cli` in vesk-docs, so
// compute the nested path from the actual CLI target.
const cliTarget = TARGETS.find((t) => t.dir === 'cli');
const nestedScopeBase = cliTarget && cliTarget.name.startsWith('@')
	? join(appDir, 'node_modules', cliTarget.name.split('/')[0], cliTarget.name.split('/')[1])
	: join(appDir, 'node_modules', cliTarget ? cliTarget.name : 'vesk');
const nestedScope = join(nestedScopeBase, 'node_modules', '@vesk');
if (existsSync(nestedScope)) {
	rmSync(nestedScope, { recursive: true, force: true });
	console.log(`[refresh] pruned nested ${nestedScope} (registry shadows)`);
}

// Freshness gate: assert every installed package carries the exact CI
// version we just packed, so npm cache/lock reuse can never silently win.
let stale = false;
for (const target of TARGETS) {
	const nmPkgPath = target.name.startsWith('@')
		? join(appDir, 'node_modules', target.name.split('/')[0], target.name.split('/')[1], 'package.json')
		: join(appDir, 'node_modules', target.name, 'package.json');
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

console.log(`[refresh] done — ${appDirName} now pins freshly built CI tarballs.`);
