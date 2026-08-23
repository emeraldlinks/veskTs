#!/usr/bin/env node
// Prints the next release version: highest semver across packages/*, patch-bumped.
// Usage: node scripts/next-version.mjs
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

let max = [0, 0, 0];
for (const dir of readdirSync(packagesDir)) {
	try {
		const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
		const parsed = parseSemver(pkg.version);
		if (parsed && gt(parsed, max)) max = parsed;
	} catch {
		// skip dirs without a readable package.json
	}
}

console.log(`${max[0]}.${max[1]}.${max[2] + 1}`);
