/**
 * @vesk/agentic — checkpoints.test.ts
 *
 * Zero-deps, no vitest. Runnable via: npx tsx packages/agentic/src/checkpoints.test.ts
 * Throws on failure. Validates transaction checkpoint lifecycle:
 * Preview → Approve → Execute → Validate → Checkpoint → Rollback / Replay
 */
import { CheckpointManager } from './checkpoints.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

console.log('\n═══ @vesk/agentic — Checkpoint tests ═══\n');

// ── create generates id + createdAt ─────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  const cp = mgr.create();
  assert(typeof cp.id === 'string' && cp.id.length > 0, 'create generates id');
  assert(typeof cp.createdAt === 'string' && !isNaN(Date.parse(cp.createdAt)), 'create generates ISO createdAt');
  assert(Array.isArray(cp.files) && cp.files.length === 0, 'default files empty');
  assert(Array.isArray(cp.commands) && cp.commands.length === 0, 'default commands empty');
  assert(cp.deps.installed.length === 0 && cp.deps.removed.length === 0, 'default deps empty');
  assert(cp.build === null, 'default build null');
  assert(cp.test === null, 'default test null');
}

// ── create with explicit id/label/files/commands/deps/build/test ────────────
{
  const mgr = new CheckpointManager();
  const cp = mgr.create({
    id: 'chk-1',
    label: 'before-refactor',
    prompt: 'refactor Foo',
    files: [
      { path: 'app/page.vsk', before: 'old', after: 'new' },
      { path: 'app/new.vsk', before: null, after: 'created' },
    ],
    commands: [['npm', 'install', 'foo']],
    deps: { installed: ['foo@1.0.0'], removed: [] },
    build: { ok: true, ms: 42 },
    test: { ok: true },
  });
  assert(cp.id === 'chk-1', 'explicit id preserved');
  assert(cp.label === 'before-refactor', 'label preserved');
  assert(cp.prompt === 'refactor Foo', 'prompt preserved');
  assert(cp.files.length === 2, 'files stored');
  assert(cp.files[0].before === 'old' && cp.files[0].after === 'new', 'file before/after preserved');
  assert(cp.files[1].before === null, 'created file before=null');
  assert(cp.commands[0][1] === 'install', 'commands stored');
  assert(cp.deps.installed[0] === 'foo@1.0.0', 'deps installed preserved');
  assert(cp.build?.ok === true && cp.build?.ms === 42, 'build preserved');
  assert(cp.test?.ok === true, 'test preserved');
}

// ── createdAt override ─────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  const iso = '2026-08-31T00:00:00.000Z';
  const cp = mgr.create({ createdAt: iso });
  assert(cp.createdAt === iso, 'explicit createdAt preserved');
}

// ── partial deps fills defaults ─────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  const cp = mgr.create({ deps: { installed: ['a'] } });
  assert(cp.deps.installed.length === 1, 'partial deps installed kept');
  assert(cp.deps.removed.length === 0, 'partial deps removed defaults to empty');
}

// ── get / has / size ────────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({ id: 'x' });
  assert(mgr.has('x'), 'has true for existing');
  assert(!mgr.has('missing'), 'has false for missing');
  assert(mgr.get('x')?.id === 'x', 'get returns checkpoint');
  assert(mgr.get('missing') === undefined, 'get undefined for missing');
  assert(mgr.size() === 1, 'size 1');
}

// ── list ordering (oldest-first) ────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({ id: 'a' });
  mgr.create({ id: 'b' });
  mgr.create({ id: 'c' });
  const ids = mgr.list().map((c) => c.id);
  assert(ids[0] === 'a' && ids[1] === 'b' && ids[2] === 'c', 'list is oldest-first insertion order');
  const newest = mgr.listNewestFirst().map((c) => c.id);
  assert(newest[0] === 'c' && newest[2] === 'a', 'listNewestFirst reverses');
}

// ── delete ──────────────────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({ id: 'del' });
  assert(mgr.delete('del') === true, 'delete existing returns true');
  assert(mgr.size() === 0, 'size 0 after delete');
  assert(!mgr.has('del'), 'has false after delete');
  assert(mgr.delete('del') === false, 'delete missing returns false');
}

// ── clear ───────────────────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({ id: '1' });
  mgr.create({ id: '2' });
  mgr.clear();
  assert(mgr.size() === 0, 'clear empties store');
  assert(mgr.list().length === 0, 'list empty after clear');
}

// ── idempotent create (replace existing id) ────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({ id: 'same', label: 'first' });
  mgr.create({ id: 'same', label: 'second' });
  assert(mgr.size() === 1, 'duplicate id does not grow size');
  assert(mgr.get('same')?.label === 'second', 'duplicate id overwrites');
}

// ── rollback success ────────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  mgr.create({
    id: 'r1',
    files: [
      { path: 'a.txt', before: 'old', after: 'new' },
      { path: 'b.txt', before: null, after: 'created' },
      { path: 'c.txt', before: 'deleted', after: null },
    ],
  });
  const plan = mgr.rollback('r1');
  assert(plan !== null, 'rollback returns plan for existing checkpoint');
  assert(plan!.id === 'r1', 'rollback id matches');
  assert(plan!.filesToRestore.length === 3, 'rollback preserves all file entries');
  assert(plan!.filesToRestore[0].before === 'old', 'rollback before value correct');
  assert(plan!.filesToRestore[1].before === null, 'rollback created-file before=null (delete on restore)');
  assert(plan!.filesToRestore[2].before === 'deleted', 'rollback deleted-file before preserved');
}

// ── rollback missing ───────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager();
  assert(mgr.rollback('missing') === null, 'rollback null for missing checkpoint');
}

// ── describeRollback helper ─────────────────────────────────────────────────
{
  const files = [
    { path: 'mod.txt', before: 'old', after: 'new' },
    { path: 'new.txt', before: null, after: 'x' },
    { path: 'del.txt', before: 'y', after: null },
  ];
  const s = CheckpointManager.describeRollback(files);
  assert(s.writes === 1, 'describe writes count');
  assert(s.deletes === 1, 'describe deletes count (created → delete)');
  assert(s.creates === 1, 'describe creates count (deleted → recreate)');
}

// ── maxKeep pruning ────────────────────────────────────────────────────────
{
  const mgr = new CheckpointManager({ maxKeep: 2 });
  mgr.create({ id: '1' });
  mgr.create({ id: '2' });
  mgr.create({ id: '3' });
  assert(mgr.size() === 2, 'maxKeep prunes to limit');
  assert(!mgr.has('1'), 'oldest pruned');
  assert(mgr.has('2') && mgr.has('3'), 'newest kept');
  assert(mgr.list().map((c) => c.id).join(',') === '2,3', 'order after prune');
}

// ── defensive copy: mutating input after create does not affect stored ──────
{
  const mgr = new CheckpointManager();
  const files = [{ path: 'a.txt', before: 'old', after: 'new' }];
  const cp = mgr.create({ id: 'def', files });
  files[0].before = 'mutated';
  assert(mgr.get('def')?.files[0].before === 'old', 'stored files are defensive copy');
}

// ── build/test null vs object handling ──────────────────────────────────────
{
  const mgr = new CheckpointManager();
  const ok = mgr.create({ id: 'b1', build: { ok: true }, test: { ok: false, error: 'fail' } });
  assert(ok.build?.ok === true, 'build ok stored');
  assert(ok.test?.ok === false && ok.test?.error === 'fail', 'test failure stored');

  const failBuild = mgr.create({ id: 'b2', build: { ok: false, error: 'compile error' } });
  assert(failBuild.build?.ok === false && failBuild.build?.error === 'compile error', 'build failure with error');
}

// ── history records commands/deps/build-test outcome for every checkpoint ────
{
  const mgr = new CheckpointManager();
  const cp = mgr.create({
    id: 'hist',
    commands: [
      ['npm', 'install', 'pkg'],
      ['npm', 'run', 'build'],
    ],
    deps: { installed: ['pkg@1.0.0'], removed: ['old@0.1.0'] },
    build: { ok: true, ms: 120 },
    test: { ok: true },
    files: [{ path: 'x', before: 'a', after: 'b' }],
  });
  assert(cp.commands.length === 2, 'history records commands');
  assert(cp.deps.installed[0] === 'pkg@1.0.0' && cp.deps.removed[0] === 'old@0.1.0', 'history records deps');
  assert(cp.build?.ok === true && cp.test?.ok === true, 'history records build/test outcome');
}

// ── checkpoint file before/after null semantics (rollback interpretation) ────
{
  const mgr = new CheckpointManager();
  // file created: before=null → rollback should delete it
  // file deleted: after=null → rollback should recreate it
  // file modified: both non-null → rollback should overwrite
  mgr.create({
    id: 'sem',
    files: [
      { path: 'created.txt', before: null, after: 'hello' },
      { path: 'deleted.txt', before: 'bye', after: null },
      { path: 'modified.txt', before: 'old', after: 'new' },
    ],
  });
  const plan = mgr.rollback('sem')!;
  const created = plan.filesToRestore.find((f) => f.path === 'created.txt')!;
  const deleted = plan.filesToRestore.find((f) => f.path === 'deleted.txt')!;
  const modified = plan.filesToRestore.find((f) => f.path === 'modified.txt')!;
  assert(created.before === null && created.after === 'hello', 'created file: null→content');
  assert(deleted.before === 'bye' && deleted.after === null, 'deleted file: content→null');
  assert(modified.before === 'old' && modified.after === 'new', 'modified file: old→new');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) throw new Error(`${failed} tests failed`);
