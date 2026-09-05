#!/usr/bin/env node
// Prints the next release version: highest semver across packages/* AND the
// npm registry, patch-bumped. Registry awareness matters because a release
// can publish without its version bump being committed back — local-only
// max would then recompute an already-published version and npm would 403.
// Usage: node scripts/next-version.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

function parseSemver(v) {
	if (typeof v !== 'string') return null;
	const parts = v.split('.');
	if (parts.length !== 3) return null;
	const nums = [];
	for (const part of parts) {
		const n = Number(part);
		if (!Number.isInteger(n) || n < 0) return null;
		nums.push(n);
	}
	return nums;
}

function gt(a, b) {
	return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) || (a[0] === b[0] && a[1] === b[1] && a[2] > b[2]);
}

const names = [];
let max = [0, 0, 0];
for (const dir of readdirSync(packagesDir)) {
	try {
		const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
		if (typeof pkg.name === 'string' && pkg.name) names.push(pkg.name);
		const parsed = parseSemver(pkg.version);
		if (parsed && gt(parsed, max)) max = parsed;
	} catch {
		// skip dirs without a readable package.json
	}
}

// Fold in published versions so we never recompute an already-released
// version. Any failure (offline, unknown package, slow registry) falls
// back to the local max — never fail version resolution for this.
for (const name of names) {
	try {
		const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
			encoding: 'utf-8',
			timeout: 20000,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const listed = JSON.parse(out);
		for (const v of Array.isArray(listed) ? listed : [listed]) {
			const parsed = parseSemver(v);
			if (parsed && gt(parsed, max)) max = parsed;
		}
	} catch {
		// unpublished package or unreachable registry — local max stands
	}
}

console.log(`${max[0]}.${max[1]}.${max[2] + 1}`);
