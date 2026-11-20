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
import { bumpFromCommits, isBump, isChannel, nextVersion, PATCH, STABLE } from './release-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
};
const channel = args.find((a) => !a.startsWith('--')) || STABLE;
const offline = args.includes('--offline');
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
if (!offline) {
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
}

let bump = flag('bump') || PATCH;
if (!isBump(bump)) {
  console.error(`unknown bump "${bump}" (minor|patch)`);
  process.exit(1);
}

const from = flag('from');
if (from) {
  const to = flag('to') || 'HEAD';
  const raw = execFileSync('git', ['log', `${from}..${to}`, '--no-merges', '--pretty=format:%s%x00%b%x00'], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const fields = raw.split('\x00');
  const commits = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (!fields[i] || !fields[i].trim()) continue;
    commits.push({ subject: fields[i].trim(), body: fields[i + 1] || '' });
  }
  bump = bumpFromCommits(commits);
}

console.log(nextVersion(channel, known, bump));
