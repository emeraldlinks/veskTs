#!/usr/bin/env node
/**
 * Writes/updates CHANGELOG.md for a stable release.
 *
 * Commits are read from git (subject + body) between two refs — the previous
 * release tag and HEAD. Only the stable release job runs this: a canary must
 * never touch the changelog, or the file becomes a wall of noise that nobody
 * reads.
 *
 * Usage:
 *   node scripts/changelog.mjs <version> [--from <ref>] [--to <ref>] [--date YYYY-MM-DD]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeChangelog, renderChangelog } from './release-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('-'));
if (!version) {
  console.error('usage: node scripts/changelog.mjs <version> [--from <ref>] [--to <ref>] [--date YYYY-MM-DD]');
  process.exit(1);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const to = flag('to', 'HEAD');
const date = flag('date', new Date().toISOString().slice(0, 10));

/** The most recent `v*` release tag, or '' when the repo has none. */
function lastReleaseTag() {
  try {
    const out = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    const tags = out.split('\n').map((t) => t.trim()).filter(Boolean);
    return tags[0] || '';
  } catch {
    return '';
  }
}

const from = flag('from', lastReleaseTag());
const range = from ? `${from}..${to}` : to;

// NUL as the field separator: a commit message cannot contain a NUL byte, and
// the earlier ASCII separators DID split inside bodies (a commit whose body
// happened to contain the separator byte produced two bogus changelog entries).
const raw = execFileSync(
  'git',
  ['log', range, '--no-merges', '--pretty=format:%H%x00%s%x00%b%x00'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
);

const fields = raw.split('\x00');
const commits = [];
for (let i = 0; i + 2 < fields.length; i += 3) {
  const [, subject, body] = [fields[i], fields[i + 1], fields[i + 2]];
  if (!subject || !subject.trim()) continue;
  commits.push({ subject: subject.trim(), body: body || '' });
}

const section = renderChangelog(version, date, commits);
const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf-8') : '';
writeFileSync(CHANGELOG, mergeChangelog(existing, section), 'utf-8');
console.log(`changelog: ${commits.length} commits -> CHANGELOG.md (${version}, range ${range})`);
