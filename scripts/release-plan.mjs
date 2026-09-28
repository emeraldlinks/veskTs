/**
 * Release-train version math and changelog rendering.
 *
 * Plain ESM with no imports on purpose: `scripts/release.mjs` runs under bare
 * node (no tsx) in the publish job, and this file is imported by both that
 * script and the test suite, so the rules live in exactly one place.
 *
 * The train:
 *   canary  — published on every merge to main, prerelease version, npm
 *             dist-tag `canary`. Never touches `latest`, never bumps the
 *             version committed in the repo, so merging does not produce a
 *             commit per merge.
 *   beta    — opt-in, dist-tag `beta`, same prerelease mechanics.
 *   stable  — human-triggered. Bumps the repo to a plain semver, publishes
 *             `latest`, writes CHANGELOG.md, tags the release.
 */

export const STABLE = 'stable';
const PRERELEASE = /^(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z.-]+)$/;
const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

/** Split a version into its numeric core and optional prerelease label. */
export function parseVersion(version) {
	if (typeof version !== 'string') return null;
	const plain = PLAIN.exec(version);
	if (plain) return { major: Number(plain[1]), minor: Number(plain[2]), patch: Number(plain[3]), pre: null };
	const pre = PRERELEASE.exec(version);
	if (pre) {
		return {
			major: Number(pre[1]),
			minor: Number(pre[2]),
			patch: Number(pre[3]),
			pre: pre[4],
		};
	}
	return null;
}

export function formatVersion({ major, minor, patch }, pre = null) {
	const base = `${major}.${minor}.${patch}`;
	return pre ? `${base}-${pre}` : base;
}

/** Compare two prerelease labels the way semver does: numeric parts numerically. */
function comparePrerelease(a, b) {
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Numeric comparison; a prerelease sorts BELOW its own base (semver rule). */
export function compareVersions(a, b) {
	const va = parseVersion(a);
	const vb = parseVersion(b);
	if (!va || !vb) return 0;
	for (const key of ['major', 'minor', 'patch']) {
		if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
	}
	if (va.pre === vb.pre) return 0;
	if (va.pre === null) return 1;
	if (vb.pre === null) return -1;
	return comparePrerelease(va.pre, vb.pre);
}

/** The highest version in a list, ignoring anything unparsable. */
export function maxVersion(versions) {
	let best = null;
	for (const v of versions) {
		const parsed = parseVersion(v);
		if (!parsed) continue;
		if (best === null || compareVersions(v, best) > 0) best = v;
	}
	return best;
}

/**
 * The next version to publish for a channel.
 *
 * `seen` is every version known to exist (the repo's packages plus whatever the
 * registry already has), so a canary is never republished and a stable version
 * is never skipped. Prerelease counters of a DIFFERENT label (`beta` when we're
 * about to cut a `canary`) do not consume a number, so the two channels stay
 * independent.
 */
export function nextVersion(channel, seen) {
	const versions = seen.filter((v) => typeof v === 'string' && parseVersion(v));
	const highest = maxVersion(versions);
	const base = highest ? parseVersion(highest) : { major: 0, minor: 0, patch: 0 };
  // Never reuse a base that is already published in ANY form.
	let core = { major: base.major, minor: base.minor, patch: base.patch };
	if (highest && parseVersion(highest).pre === null) {
		core = { major: base.major, minor: base.minor, patch: base.patch + 1 };
	} else if (highest && parseVersion(highest).pre !== null) {
		// The highest known version is itself a prerelease of this base: the base
		// is unpublished, so the next release (of any channel) is that base.
		core = { major: base.major, minor: base.minor, patch: base.patch };
	}
	if (channel === STABLE) return formatVersion(core);
	const label = channel;
	let n = 1;
	for (const v of versions) {
		const parsed = parseVersion(v);
		if (!parsed || parsed.pre === null) continue;
		if (parsed.major !== core.major || parsed.minor !== core.minor || parsed.patch !== core.patch) continue;
		const counter = /^([0-9A-Za-z-]+)\.(\d+)$/.exec(parsed.pre);
		if (counter && counter[1] === label) n = Math.max(n, Number(counter[2]) + 1);
	}
	return formatVersion(core, `${label}.${n}`);
}

const TYPE_ORDER = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'build', 'ci', 'chore'];
const TYPE_TITLES = {
	feat: 'Features',
	fix: 'Fixes',
	perf: 'Performance',
	refactor: 'Refactors',
	test: 'Tests',
	docs: 'Docs',
	build: 'Build',
	ci: 'CI',
	chore: 'Chores',
};

/**
 * One commit line -> { type, scope, breaking, subject }.
 * Conventional Commits, with `!` after the type/scope and a `BREAKING CHANGE:`
 * body both meaning breaking.
 */
export function classifyCommit(subject, body = '') {
	const breaking = /(^|\n)BREAKING[ -]CHANGE:/.test(body) || /^[a-z]+(\([^)]*\))?!:/.test(subject);
	const match = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/.exec(subject);
	if (!match) return { type: 'other', scope: '', breaking, subject };
	const type = match[1];
	return {
		type: TYPE_ORDER.includes(type) ? type : 'other',
		scope: match[2] || '',
		breaking: breaking || Boolean(match[3]),
		subject: match[4] || subject,
	};
}

/** Render a changelog section for a list of { subject, body } commits. */
export function renderChangelog(version, date, commits) {
	const parsed = commits.map((c) => ({ ...classifyCommit(c.subject, c.body), raw: c.subject }));
	const breaking = parsed.filter((c) => c.breaking);
	const lines = [];
	lines.push(`## ${version} — ${date}`);
	lines.push('');
	if (breaking.length === 0) {
		lines.push('_No breaking changes._');
		lines.push('');
	}
	for (const c of breaking) {
		const scope = c.scope ? `**${c.scope}:** ` : '';
		lines.push(`- \u26a0\ufe0f ${scope}${c.subject}`);
	}
	if (breaking.length > 0) lines.push('');
	for (const type of TYPE_ORDER) {
		const group = parsed.filter((c) => c.type === type && !c.breaking);
		if (group.length === 0) continue;
		lines.push(`### ${TYPE_TITLES[type]}`);
		lines.push('');
		for (const c of group) {
			const scope = c.scope ? `**${c.scope}:** ` : '';
			lines.push(`- ${scope}${c.subject}`);
		}
		lines.push('');
	}
	const other = parsed.filter((c) => c.type === 'other' && !c.breaking);
	if (other.length > 0) {
		lines.push('### Other');
		lines.push('');
		for (const c of other) lines.push(`- ${c.subject}`);
		lines.push('');
	}
	if (parsed.length === 0) lines.push('_No user-visible changes._\n');
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Prepend a new section to CHANGELOG.md, keeping the file's shape stable. */
export function mergeChangelog(existing, section) {
	const header = '# Changelog\n\nAll notable changes to Vesk. Versions follow [semver](https://semver.org/); `latest` only moves on a stable release, and `canary` tracks `main`.\n\n';
	if (!existing || !existing.trim()) return header + section;
	// Drop the existing preamble (title + intro) and keep only the released
	// sections — slicing after the first blank line would duplicate the intro.
	const firstSection = existing.search(/^## /m);
	const body = firstSection === -1 ? '' : existing.slice(firstSection);
	return header + section + '\n' + body;
}

export const CHANNELS = ['canary', 'beta', STABLE];
export function isChannel(value) {
	return CHANNELS.includes(value);
}
