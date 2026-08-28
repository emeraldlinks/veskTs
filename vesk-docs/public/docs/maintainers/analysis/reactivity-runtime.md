# Analysis: Ripple Reactivity Runtime at ripple@0.3.13

## Overview

The reactivity system is based on **tracked values** (`Tracked<V>`) and **derived values** (`Derived`), with automatic dependency tracking via a clock-based versioning system. The `&[]` destructure syntax is the user-facing API; the compiler transforms it into getter/setter calls on the underlying `Tracked`/`Derived` objects.

## Core Types

### `TrackedValue` (class in `runtime.js`)
- Properties: `__v` (value), `c` (clock/version), `b` (block), `d` (deferred boundary entries), `f` (flags), `a` (accessors: `{ get?, set? }`)
- Implements `Tracked` interface
- Supports `[0]` for unwrapped access, `[1]` for raw object access, `.value` property, iterator protocol
- The `[0]` getter calls `get_tracked()`, which registers dependency tracking if `tracking` is true

### `DerivedValue` (class in `runtime.js`)
- Properties: `fn` (computation function), `__v` (cached value), `c` (clock), `d` (dependencies), `blocks` (child blocks), `b` (block), `co` (component), `f` (flags), `a` (accessors)
- Lazily recomputed — `update_derived()` checks if dirty via `is_tracking_dirty()`
- The computation function runs with `tracking = true`, so dependencies are automatically registered

## Dependency Tracking Mechanism

### How it works:
1. When `tracking = true`, reading a `Tracked` or `Derived` value calls `register_dependency()`
2. `register_dependency()` creates a `Dependency` node: `{ c (clock), t (tracked), n (next) }` — a linked list
3. The dependency is attached to the `active_reaction` (the block or derived currently executing)
4. When checking if dirty (`is_tracking_dirty()`), the system walks the dependency linked list and compares each tracked's clock to the recorded clock

### Clock-based versioning:
- Every `set()` call increments the clock: `tracked.c = increment_clock()`
- Every `update_derived()` also increments if the value changed
- `is_tracking_dirty()` returns true if any dependency's recorded clock is less than the tracked's current clock

### Dependency recycling:
- `create_dependency()` reuses old `Dependency` nodes from the linked list (optimization to reduce GC)

## `track()` Function

```js
export function track(v, get, set, b) {
  if (is_ripple_object(v)) return v;     // already tracked
  if (typeof v === 'function') return derived(v, b, get, set);  // derived
  return tracked(v, b, get, set);        // basic tracked value
}
```

- If passed a function → creates a `DerivedValue` (computed/derived)
- If passed a value → creates a `TrackedValue`
- The `b` (block) parameter is required — compiler passes it
- The `get`/`set` optional parameters are accessor transforms

## `get()` and `set()`

### `get(tracked)`:
- If not a ripple object, returns as-is
- For `Tracked`: calls `get_tracked()` which reads `__v`, registers dependency if tracking
- For `Derived`: calls `get_derived()` which first `update_derived()`, then registers dependency
- If value is `SUSPENSE_PENDING` or `SUSPENSE_REJECTED`, throws `ASYNC_DERIVED_READ_THROWN`

### `set(tracked, value)`:
- Throws if `is_mutating_allowed` is false (prevents writes during derived computation)
- Compares old and new value — only updates if different
- Calls custom `set` accessor if provided
- Updates `__v` and `c` (clock)
- Calls `schedule_update()` to trigger re-render

## Scheduling and Batching

- `schedule_update(block)` walks up the block tree marking `CONTAINS_UPDATE` flags, then pushes the root block to `queued_root_blocks`
- `queue_microtask()` ensures `flush_microtasks()` runs once per microtask
- `flush_microtasks()` runs all queued root blocks via `flush_updates()`
- **Batching**: multiple `set()` calls in the same synchronous tick produce one flush, because `queueMicrotask` deduplicates

### Flush order (in `flush_updates()`):
1. **Pre-effects** — `PRE_EFFECT_BLOCK` flags (e.g., `trackAsync` setup)
2. **Other blocks** — render blocks, branch blocks
3. **Effects** — `EFFECT_BLOCK` flags (side effects)

## Block System

Blocks are the fundamental unit of the reactive graph. Each block has:
- `f` — flags (ROOT_BLOCK, BRANCH_BLOCK, RENDER_BLOCK, EFFECT_BLOCK, TRY_BLOCK, etc.)
- `fn` — the function that runs when the block executes
- `s` — state (start/end DOM nodes for branch blocks, or custom state)
- `d` — dependencies (linked list of `Dependency` nodes)
- `p` — parent block
- `first`/`last`/`next`/`prev` — child block linked list
- `t` — teardown function
- `co` — component context

### Block types:
- `ROOT_BLOCK` — top-level entry point
- `BRANCH_BLOCK` — conditional branches, list items
- `RENDER_BLOCK` — DOM rendering blocks
- `EFFECT_BLOCK` — side effects
- `PRE_EFFECT_BLOCK` — effects that run before render
- `TRY_BLOCK` — error/suspense boundaries

## Derived Value Recomputation

```js
function update_derived(computed) {
  var value = computed.__v;
  if (value === UNINITIALIZED || is_tracking_dirty(computed.d)) {
    value = run_derived(computed);
    if (value !== computed.__v) {
      computed.__v = value;
      computed.c = increment_clock();
    }
  }
}
```

- Lazy: only recomputed when read and dirty
- `run_derived()` executes the computation function with `tracking = true`, collecting new dependencies
- Old child blocks are destroyed before re-running (`destroy_computed_children`)

## Comparison Against Vesk Spec (§4.1)

| Spec Requirement | Ripple@0.3.13 Implementation | Match? |
|---|---|---|
| `track(value)` returns reactive cell | `tracked(v, block)` returns `TrackedValue` | ✅ |
| `track(() => expr)` returns derived | `derived(fn, block)` returns `DerivedValue` | ✅ |
| Automatic dependency tracking | Clock-based linked list | ✅ |
| Updates batch within sync tick | `queueMicrotask` + `flush_microtasks` | ✅ |
| Derived recomputes when dependency changes | `is_tracking_dirty()` checks clock comparison | ✅ |

### Discrepancies / Notes:
- Ripple's `track()` takes a required `block` parameter (the compiler passes it). Vesk's spec says `track(initialValue)` — the compiler will need to supply the block context.
- Ripple has `trackAsync()` for async suspense. Vesk's spec doesn't mention async tracked values — the `defer` block handles async differently.
- Ripple has custom `get`/`set` accessors on tracked values. Not mentioned in Vesk's spec — may be kept or dropped.
- Ripple's `.value` property and `[0]`/`[1]` iterator protocol are implementation details that Vesk may keep internally.
