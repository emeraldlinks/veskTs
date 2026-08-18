# Reactive Core

The runtime reactivity engine lives in `packages/runtime/src/ripple-runtime.ts`
and `ripple-blocks.ts`. It implements tracked cells, derived values,
effects, and a block-tree scheduler. (Note: `packages/runtime/src/track.ts`
is a deprecated, unused module with its own API — it is not in the runtime
barrels and must not be imported.)

## Cells

`track(value)` creates a tracked cell. Reads register a dependency on the
active reaction (component block or effect); writes mark the owning block
dirty and schedule it.

- `get(tracked)` / `set(tracked, value)` — imperative accessors.
- `untrack(fn)` — run `fn` with tracking disabled.
- `peek(cell)` — read without registering a dependency.
- `derived(fn)` — a computed cell: `fn` runs under an effect, and its
  result is written to the derived cell. Mutating tracked state inside a
  derived evaluation is forbidden.

## Scheduler

- Default mode `FLUSH_MICROTASK`: `schedule_update(block)` marks the block
  chain (`UPDATE_SOURCE`, `CONTAINS_UPDATE`) and enqueues the root block;
  `queue_microtask()` registers a single `queueMicrotask(flush_microtasks)`.
- `flush_microtasks()` runs queued microtasks, then flushes all queued
  root blocks, then clears `old_values`. More than 1001 consecutive flush
  rounds throw "Maximum update depth exceeded" (effect read-write loops).
- `flush_sync(fn)` (exported as `flushSync`) temporarily switches the
  scheduler to `FLUSH_SYNC`, flushes pending root blocks, runs `fn` with
  immediate updates, recursively flushes anything queued inside `fn`, and
  restores the previous mode.
- `tick()` resolves on the next `requestAnimationFrame`.
- `schedule_update` and `queue_microtask` are exported for low-level
  control.

## Blocks

Every component body and effect compiles to a **block** in a doubly-linked
tree (`ripple-blocks.ts`):

| Function | Block kind |
| --- | --- |
| `render(fn, state)` | render block |
| `branch(fn, flags, state)` | branch block (conditionals, loops) |
| `block(flags, fn, state)` | generic block |
| `effect(fn)` | effect block — scheduled, runs on dep change |
| `user_effect(fn)` | effect attached to the active component (`component.e`) |
| `pre_effect(fn)` | pre-render effect block |
| `root(fn)` | root block (with a fresh component context) |
| `create_try_block(fn, state)` | try block (fallback content) |

Block lifecycle:

- `destroy_block(block, remove_dom)` — tears down children and teardown
  callbacks, unlinks from the parent.
- `pause_block(block)` / `resume_block(block)` — suspend/resume a subtree
  (paused blocks run teardowns; resuming re-schedules dirty blocks).
- `is_destroyed(block)` — walks up to the root looking for `DESTROYED`.
- `destroy_block_children(parent, remove_dom)` /
  `destroy_non_branch_children(parent, remove_dom)` — subtree teardown
  helpers (non-branch children are skipped when the parent has no
  teardown).
- `on_destroy(fn)` registers a teardown callback on the active block;
  teardowns run through `run_teardown(block)`.

## Scoped flushing

The runtime tracks which block owns each cell (`Tracked.b`). When a block
reads a cell owned by another block, the dependency is registered and the
flush is scoped unless the owner is not an ancestor (`disable_scoped_flush`
guard). `disable_scoped_flush` / `tracking` / `teardown` / `is_block_dirty`
are exported state for the codegen to control.

## Verified against

- `packages/runtime/src/ripple-runtime.ts` — `track`, `get`, `set`,
  `untrack`, `peek_tracked`, `derived`, `flush_sync`, `tick`,
  `queue_microtask`, `schedule_update`, `register_dependency`
- `packages/runtime/src/ripple-blocks.ts` — block constructors + lifecycle
- Commit `2a5b19d`