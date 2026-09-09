# Track Declarations

The `&[]` track-declaration syntax is Vesk's sugar for creating reactive
cells. It combines cell creation with variable binding in a single
statement.

## Syntax

### Single binding (auto-tracked)

```vsk
let &[count] = track(0);
```

`count` is the reactive name. Reads of `count` inside effects or
component bodies subscribe to changes. Writes (`count++`,
`count = count + 1`) compile to `set()` calls automatically.

### Dual binding (auto-tracked + raw cell)

```vsk
let &[count, rawCell] = track(0);
```

`count` is the auto-tracked name (same as above). `rawCell` is the raw
`Tracked<number>` object — useful for passing to `untrack()`,
`peek()`, or functions that need the cell reference.

### With `const`

```vsk
const &[items] = track<string[]>([]);
```

Works with both `let` and `const`. The `const` is conventional when the
cell reference never changes (only its contents do).

### Destructuring multiple cells

```vsk
let &[firstName] = track('Alice');
let &[lastName] = track('Smith');
```

Each `&[]` creates its own cell. There is no multi-cell shorthand.

## How the compiler transforms it

The `&[]` syntax is parsed by the Vesk acorn plugin as a binding with
`lazy: true`. The compiler:

1. Creates a `track(initialValue)` call.
2. Binds the first name as an auto-tracked read/write alias.
3. Binds the optional second name as the raw cell reference.

Inside component bodies, all references to the first name are
transformed:

| User code | Compiled output |
|-----------|----------------|
| `count` | `get(count)` |
| `count = 5` | `set(count, 5)` |
| `count++` | `set(count, get(count) + 1)` |
| `count + 1` | `get(count) + 1` |

This means you never need to call `get()` or `set()` manually when
using `&[]` bindings — the compiler inserts them for you.

## Derived cells

`derived()` creates a computed cell that re-evaluates when its
dependencies change:

```vsk
let &[total] = derived(() => props.price * props.qty);
```

`total` is read-only. Writing to it throws. The function re-runs
whenever `props.price` or `props.qty` changes.

## Examples

### Counter

```vsk
component Counter() {
  let &[count] = track(0);

  return (
    <button onClick={() => count++}>
      Count: {count}
    </button>
  );
}
```

### Two-way input binding

```vsk
component NameInput() {
  let &[name] = track('');

  return <input value={name} onInput={(e) => name = e.target.value} />;
}
```

### Conditional effect

```vsk
component Logger() {
  let &[count] = track(0);
  let &[enabled] = track(true);

  effect(() => {
    if (enabled) console.log('count changed:', count);
  });

  return <button onClick={() => count++}>log</button>;
}
```

## Rules

- `&[]` can only appear at the top level of a component body or
  inside a `block()`/`effect()`/`root()` call.
- The first name becomes a `let` or `const` binding in the enclosing
  scope.
- Do not reassign the cell reference itself (`count = track(0)` is
  an error if `count` was declared with `&[]`).

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — `&[]` binding atom parsing
- `packages/runtime/src/ripple-runtime.ts` — `track`, `get`, `set`,
  `increment`, `decrement`
- `packages/compiler/src/client-codegen.ts` — `get`/`set` insertion
- `packages/compiler/src/ir.ts` — `TrackDecl` IR node
