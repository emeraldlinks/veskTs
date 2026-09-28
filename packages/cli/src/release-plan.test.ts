/**
 * Release-train rules: version math, commit classification, changelog shape.
 *
 * These are the rules that decide what a `npm install` resolves to, so they are
 * asserted directly rather than trusted. The failure they exist to prevent is
 * the state the repo was in: 38 npm releases in 400 commits, `latest` moving
 * on every merge, no changelog, so nobody could pin anything.
 *
 * Run with: npx tsx packages/cli/src/release-plan.test.ts
 */
import {
  CHANNELS,
  STABLE,
  classifyCommit,
  compareVersions,
  formatVersion,
  isChannel,
  maxVersion,
  mergeChangelog,
  nextVersion,
  parseVersion,
  renderChangelog,
} from '../../../scripts/release-plan.mjs';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
    failures.push({ name, message: (e as Error).message });
  }
}

console.log('\n=== Release train ===');

it('parses plain and prerelease versions', () => {
  eq(parseVersion('0.2.48'), { major: 0, minor: 2, patch: 48, pre: null }, 'plain version');
  eq(parseVersion('0.2.48-canary.3'), { major: 0, minor: 2, patch: 48, pre: 'canary.3' }, 'canary');
  eq(parseVersion('nonsense'), null, 'garbage');
});

it('a prerelease sorts below its own base (semver)', () => {
  ok(compareVersions('0.2.48-canary.1', '0.2.48') < 0, 'a canary of 0.2.48 must sort below 0.2.48');
  ok(compareVersions('0.2.48', '0.2.48-canary.9') > 0, 'base above its prerelease');
  ok(compareVersions('0.2.48-canary.2', '0.2.48-canary.10') < 0, 'numeric suffixes, not lexical');
  ok(compareVersions('0.3.0', '0.2.99') > 0, 'minor beats patch');
  eq(maxVersion(['0.2.9', '0.2.10', 'junk', '0.1.99']), '0.2.10', 'max ignores junk');
});

it('a stable release after a plain version bumps the patch', () => {
  eq(nextVersion(STABLE, ['0.2.47']), '0.2.48', 'next stable');
});

it('the first canary of an unpublished base is -canary.1', () => {
  eq(nextVersion('canary', ['0.2.47']), '0.2.48-canary.1', 'first canary');
  eq(nextVersion('beta', ['0.2.47']), '0.2.48-beta.1', 'first beta');
});

it('canary numbering continues and never reuses a version', () => {
  const seen = ['0.2.47', '0.2.48-canary.1', '0.2.48-canary.2'];
  eq(nextVersion('canary', seen), '0.2.48-canary.3', 'next canary');
  eq(nextVersion('beta', seen), '0.2.48-beta.1', 'beta has its own counter');
});

it('a base with canaries on it is promoted, not re-cut', () => {
  // The whole point of the train: `stable` ships the base the canaries tested.
  eq(nextVersion(STABLE, ['0.2.47', '0.2.48-canary.1', '0.2.48-canary.2']), '0.2.48', 'promote the tested base');
});

it('an empty history still produces a version', () => {
  eq(nextVersion(STABLE, []), '0.0.0', 'cold start');
  ok(isChannel('canary') && isChannel(STABLE) && isChannel('beta'), 'channels are declared');
  ok(!isChannel('nightly'), 'unknown channels are rejected');
  ok(CHANNELS.length === 3, 'three channels');
});

it('classifies conventional commits, scopes and breaking changes', () => {
  eq(classifyCommit('fix(ssr): scope the handoff per request'), {
    type: 'fix',
    scope: 'ssr',
    breaking: false,
    subject: 'scope the handoff per request',
  }, 'fix with scope');
  eq(classifyCommit('perf(build): cache the module bundle').type, 'perf', 'perf type');
  eq(classifyCommit('feat!: drop the marker DOM').breaking, true, 'bang = breaking');
  eq(classifyCommit('feat(api)!: rename handle').scope, 'api', 'bang with scope');
  eq(classifyCommit('refactor: tidy', 'BREAKING CHANGE: the head API changed').breaking, true, 'body marker');
  eq(classifyCommit('update deps').type, 'other', 'non-conventional is other');
  eq(classifyCommit('docs(readme): fix typo').subject, 'fix typo', 'subject without the type');
});

it('renders a changelog section grouped by type, breaking first', () => {
  const out = renderChangelog('0.2.48', '2026-09-28', [
    { subject: 'feat(head): resolve imports in the head pass', body: '' },
    { subject: 'fix: decode head escapes', body: '' },
    { subject: 'feat!: remove the marker DOM', body: '' },
    { subject: 'chore: bump deps', body: '' },
  ]);
  ok(out.startsWith('## 0.2.48 — 2026-09-28'), 'versioned header');
  ok(out.indexOf('⚠️') < out.indexOf('### Features'), 'breaking changes come first');
  ok(out.includes('**head:** resolve imports in the head pass'), 'scoped subject, type prefix stripped');
  ok(out.includes('### Fixes') && out.includes('decode head escapes'), 'fixes grouped');
  ok(out.includes('### Chores'), 'chores grouped');
  ok(!out.includes('feat!: remove'), 'a breaking entry is not repeated in Features');
});

it('a release with no commits still renders a section', () => {
  const out = renderChangelog('0.2.48', '2026-09-28', []);
  ok(out.includes('_No user-visible changes._'), 'empty section says so');
});

it('merging keeps the header, prepends the new section, keeps history', () => {
  const first = mergeChangelog('', renderChangelog('0.2.48', '2026-09-28', [{ subject: 'fix: the first thing', body: '' }]));
  ok(first.startsWith('# Changelog'), 'header created');
  const second = mergeChangelog(first, renderChangelog('0.2.49', '2026-10-01', [{ subject: 'fix: the second thing', body: '' }]));
  ok(second.indexOf('## 0.2.49') < second.indexOf('## 0.2.48'), 'newest first');
  ok(second.includes('the first thing') && second.includes('the second thing'), 'history preserved');
  // The conventional prefix is stripped from a changelog line (that is the point
  // of the grouping), and the intro must not be duplicated by the merge.
  ok(!second.includes('- fix: the first thing'), 'the type prefix is stripped from entries');
  eq((second.match(/All notable changes/g) || []).length, 1, 'the intro appears once');
  ok((second.match(/^# Changelog$/gm) || []).length === 1, 'exactly one header');
  ok(second.includes('`latest` only moves on a stable release'), 'the header documents the train');
});

it('a commit body never leaks into another entry', () => {
  // The changelog parser reads fields separated by NUL. With an ASCII separator
  // a body that happened to contain that byte became its own bogus entry, and
  // the previous release showed a diff hunk as a changelog item.
  const out = renderChangelog('0.2.48', '2026-09-28', [
    { subject: 'fix(router): decode head escapes', body: 'before: title="a &amp; b"\nafter: title="a & b"' },
  ]);
  ok(!out.includes('after: title'), 'a body line did not become an entry');
  eq((out.match(/^- /gm) || []).length, 1, 'exactly one entry');
});

it('formatVersion round-trips', () => {
  eq(formatVersion({ major: 1, minor: 2, patch: 3 }), '1.2.3', 'plain');
  eq(formatVersion({ major: 1, minor: 2, patch: 3 }, 'canary.2'), '1.2.3-canary.2', 'prerelease');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All release-plan tests passed!');
