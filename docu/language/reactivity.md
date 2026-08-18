# Reactivity

Vesk reactivity is built on tracked cells created with `track()`. Reading a
cell inside a component body or `effect()` subscribes; writing a cell
schedules an update. There is no virtual DOM: the compiler emits per-cell
DOM update code.

## Declaring tracked state

```vsk
let &[count] = track(0);            // reactive binding: count is the cell
```

```vsk
let &[count, rawCell] = track(0);   // also bind the raw cell itself
```

- The `&[]` destructure is Vesk track-declaration sugar (acorn `&` binding
  atom, `lazy: true`). It works with `let` or `const`.
- The first name is the cell (auto-unwrapped when read).
- The optional second name is the raw `Cell` object — needed for
  `untrack()`/`peek()` or passing the cell around.

## Cell API

| Function | Purpose |
| --- | --- |
| `track(initial)` | Create a reactive cell |
| `get(cell)` / `cell.get()` | Read a value (subscribes inside effects) |
| `set(cell, v)` / `cell.set(v)` | Write a value; `Object.is`-guarded, schedules subscribers |
| `update(cell, fn)` / `cell.update(fn)` | `set(cell, fn(get(cell)))` |
| `untrack(fn)` | Run `fn` without subscribing |
| `peek(cell)` | Read a cell value without subscribing |
| `derived(fn)` | Computed cell that re-runs `fn` when its deps change |
| `effect(fn)` | Run `fn` now and on every dependency change |
| `flushSync(fn)` | Run `fn` with the scheduler in synchronous mode; flushes pending updates first, then returns `fn`'s result |
| `tick()` | Resolve after the next animation frame (`requestAnimationFrame`) — use to wait for a painted update |
| `on_destroy(fn)` | Register teardown cleanup for the current block/component |

All of these are auto-imported from `@vesk/runtime` when used inside
components — no import statement needed.

## Scheduler semantics

- `set()` does **not** update the DOM synchronously. Updates are
  microtask-batched: multiple `set()` calls in one turn produce one flush
  (`queueMicrotask(flush_microtasks)`).
- `effect()` runs immediately on creation, then on dependency change.
- `flushSync(fn)` switches the scheduler to synchronous mode: pending
  updates flush, `fn` runs with immediate DOM writes, and the mode is
  restored afterwards.
- `await tick()` resolves after the next animation frame — the frame after
  the flush has painted.
- The scheduler guards against effect loops: "Maximum update depth
  exceeded. This typically indicates that an effect reads and writes the
  same piece of state." (after 1001 flush rounds).
- `batch` does **not** exist. For synchronous multi-write flushes use
  `flushSync`.

## Example: counter

```vsk
component Counter {
  let &[count] = track(0);

  effect(() => {
    console.log("count is", count);
  });

  return (
    <button onClick={() => count++}>
      Count: {count}
    </button>
  );
}
```

## Example: derived

```vsk
component Price(props: { qty: number, unit: number }) {
  let &[total] = derived(() => props.qty * props.unit);
  return <p>Total: {total}</p>;
}
```

## Example: untrack / peek

```vsk
component Notifier {
  let &[count] = track(0);
  let &[loud] = track(false);

  effect(() => {
    const msg = untrack(() => loud ? "!!!" : "!");
    console.log(count + msg);          // re-runs only when count changes
  });

  return <button onClick={() => peek(loud) ? count++ : loud = true}>go</button>;
}
```

## Rules

- Do not mutate tracked state inside `derived()` evaluation (throws).
- `untrack(fn)` and `peek(cell)` are the escape hatches for reading without
  subscribing; prefer them over restructuring effects.
- Component teardown: register cleanup with `on_destroy(fn)`.

## Verified against

- `packages/runtime/src/ripple-runtime.ts` — `track`, `derived`, `untrack`,
  `peek_tracked`, `flush_sync`, `tick`, `on_destroy`
- `packages/runtime/src/ripple-blocks.ts` — `effect`
- `packages/runtime/src/index-client.ts` — public export surface
- `packages/compiler/src/vesk-plugin.ts` — `&[]` binding atom
- Commit `2a5b19d`

Note: `packages/runtime/src/track.ts` is a deprecated, unused module with a
separate `Cell`/`Effect` API. It is not in the runtime barrels — never import
it, and do not document it as public API.