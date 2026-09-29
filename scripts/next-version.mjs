#!/usr/bin/env node
// Prints the next version to publish, for a release channel.
//
//   node scripts/next-version.mjs              # next stable base (0.2.48)
//   node scripts/next-version.mjs canary       # 0.2.48-canary.<n>
//
// Registry awareness matters: a release can publish without its version bump
// being committed back, and a canary must never be republished. Prerelease
// versions of the SAME base also count — cutting a canary for 0.2.48 consumes
// that base, and the next stable is 0.2.49, not a second 0.2.48.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChannel, nextVersion, STABLE } from './release-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const channel = process.argv[2] || STABLE;
if (!isChannel(channel)) {
  console.error(`unknown channel "${channel}" (canary|beta|stable)`);
  process.exit(1);
}

const known = [];
const names = [];
for (const dir of readdirSync(packagesDir)) {
	try {
		const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
		if (typeof pkg.name === 'string' && pkg.name) names.push(pkg.name);
		if (typeof pkg.version === 'string') known.push(pkg.version);
	} catch {
		// skip dirs without a readable package.json
	}
}

// Fold in published versions so we never recompute an already-released one.
// Any failure (offline, unknown package, slow registry) falls back to the local
// max — never fail version resolution for this.
for (const name of names) {
	try {
		const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
			encoding: 'utf-8',
			timeout: 20000,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const listed = JSON.parse(out);
		for (const v of Array.isArray(listed) ? listed : [listed]) known.push(v);
	} catch {
		// unpublished package or unreachable registry — local versions stand
	}
}

console.log(nextVersion(channel, known));
