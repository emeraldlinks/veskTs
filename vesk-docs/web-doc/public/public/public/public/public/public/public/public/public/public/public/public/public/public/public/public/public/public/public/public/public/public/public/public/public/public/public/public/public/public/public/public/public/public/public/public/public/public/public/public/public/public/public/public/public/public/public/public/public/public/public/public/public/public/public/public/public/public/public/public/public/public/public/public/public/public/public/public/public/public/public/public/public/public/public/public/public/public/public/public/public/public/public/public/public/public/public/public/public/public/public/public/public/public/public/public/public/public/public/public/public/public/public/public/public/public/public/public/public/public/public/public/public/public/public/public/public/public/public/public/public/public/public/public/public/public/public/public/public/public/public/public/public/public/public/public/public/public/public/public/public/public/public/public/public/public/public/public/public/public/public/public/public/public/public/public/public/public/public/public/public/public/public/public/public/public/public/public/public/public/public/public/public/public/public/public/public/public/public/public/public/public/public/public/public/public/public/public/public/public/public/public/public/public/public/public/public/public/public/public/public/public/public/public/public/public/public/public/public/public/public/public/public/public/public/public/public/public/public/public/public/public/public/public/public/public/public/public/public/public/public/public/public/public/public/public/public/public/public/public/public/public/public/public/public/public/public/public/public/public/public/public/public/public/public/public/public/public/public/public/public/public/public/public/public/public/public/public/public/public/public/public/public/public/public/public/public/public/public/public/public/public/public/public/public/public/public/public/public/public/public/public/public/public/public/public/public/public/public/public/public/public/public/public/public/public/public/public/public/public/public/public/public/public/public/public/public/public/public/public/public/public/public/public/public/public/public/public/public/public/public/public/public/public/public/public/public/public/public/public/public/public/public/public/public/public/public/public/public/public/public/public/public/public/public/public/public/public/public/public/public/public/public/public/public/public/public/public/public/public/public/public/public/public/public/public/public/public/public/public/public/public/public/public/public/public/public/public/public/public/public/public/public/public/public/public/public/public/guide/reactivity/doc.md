# Reactivity

State in Vesk is refreshingly small-scale: a piece of state is a *cell*,
you read it like a normal variable, write it like a normal variable, and
exactly the parts of the screen that depend on it update. No setters to
call from templates, no virtual DOM diffing the whole tree — updates are
surgical because the compiler already knows which DOM nodes read which
cell.

Under the hood, reactivity is built on **tracked cells** created with
`track()`. Reading a cell inside a component body or `effect()`
subscribes; writing schedules an update. There is no virtual DOM: the compiler emits per-cell
DOM update code, so updates touch exactly the text nodes and attributes
that depend on the changed cell.

## Declaring tracked state

```vsk
let &[count] = track(0);            // reactive binding: count auto-unwraps
const &[count] = track(0);          // const works too

let &[count, rawCell] = track(0);   // also bind the raw cell itself
```

- The `&[]` destructure is Vesk track-declaration sugar. It works with
  `let` or `const`.
- The first name is the value — reads and writes are plain (`count++`
  compiles to a cell write).
- The optional second name binds the raw cell object — pass it to APIs
  that need it (e.g. `bindValue(cell)`, `untrack`, `peek`).

## Core API

All of these are **auto-imported** from `@vesk/runtime` inside components —
no import statement needed.

| Function | Purpose |
| --- | --- |
| `track(initial)` | Create a reactive cell (or a computed when given a function) |
| `get(cell)` | Read a value (subscribes inside effects) |
| `set(cell, v)` | Write a value; strict-equality guarded; schedules subscribers |
| `derived(fn)` | Computed cell re-running `fn` lazily when deps change |
| `effect(fn)` | Run now and on every dependency change; return cleanup from `fn` |
| `pre_effect(fn)` | Effect flushed *before* ordinary effects in a flush cycle (advanced/client use — not auto-imported) |
| `untrack(fn)` | Run `fn` without subscribing to anything it reads |
| `peek(cell)` | Read a cell without subscribing |
| `flushSync(fn)` | Switch scheduler to synchronous mode; pending updates flush first |
| `tick()` | Promise resolving on the next animation frame |
| `on_destroy(fn)` | Register teardown for the current block/component |
| `createContext(v)` / `Context` | Typed context with `.get()` / `.set()` (see below) |

> ⚠️ `batch` does **not** exist. For synchronous multi-write flushing use
> `flushSync(fn)`.

```ts
/**
 * Create reactive state. Polymorphic:
 *   track(value)            → Tracked cell
 *   track(() => expr)       → Derived computation
 *   track(value, get?, set?)→ cell with read/write transform hooks
 * Passing an existing tracked/derived object returns it unchanged.
 */
function track<T>(value: T): Tracked<T>;
function track<T>(fn: () => T): Derived<T>;
function track<T>(value: T, get?: (v: unknown) => unknown, set?: (next: unknown, prev: unknown) => unknown): Tracked<T>;

/**
 * Read a tracked/derived value, registering a dependency when called
 * inside an effect/derived. Non-tracked values pass through.
 */
function get<T>(cell: Tracked<T> | Derived<T> | T): T;

/** Write a cell. No-op if `Object.is(next, prev)`. Schedules one microtask flush. */
function set<T>(cell: Tracked<T>, value: T): void;

/**
 * Run `fn` immediately, then re-run whenever any cell read inside changes.
 * Return a function from `fn` to register cleanup on re-run/destroy.
 * Throws outside a component/effect context.
 */
function effect(fn: () => void | (() => void)): void;

/** Like effect(), but its block flushes before ordinary effects. */
function pre_effect(fn: () => void | (() => void)): void;

/** Computed cell: lazy, memoized, re-runs only when dependency clocks moved. */
function derived<T>(fn: () => T): Derived<T>;

/** Execute fn with dependency tracking disabled. Returns fn's result. */
function untrack<T>(fn: () => T): T;

/** Read a cell WITHOUT subscribing. */
function peek<T>(cell: Tracked<T> | Derived<T>): T;

/**
 * Flush pending updates, run fn synchronously (writes apply immediately),
 * keep draining queued roots until settled. Restores batched mode after.
 */
function flushSync<T>(fn?: () => T): T | undefined;

/** Resolves via requestAnimationFrame — waits for the painted frame. */
function tick(): Promise<void>;

/** Register cleanup for the current component/block scope. */
function on_destroy(fn: () => void): void;
```

## Examples

### Counter

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

### Derived values

```vsk
component Price(props: { qty: number; unit: number }) {
	let &[total] = derived(() => props.qty * props.unit);
	return <p>Total: {total}</p>;
}
```

Deriveds chain automatically:

```vsk
let &[a] = track(1);
let &[b] = derived(() => a + 1);
let &[c] = derived(() => b + 1);   // reading c recomputes b then c as needed
```

Writing to tracked state **inside** a derived evaluation throws:
*"Assignments or updates to tracked values are not allowed during computed
evaluation"*.

### untrack / peek

```vsk
component Notifier {
	let &[count] = track(0);
	let &[loud] = track(false);

	effect(() => {
		const msg = untrack(() => loud ? "!!!" : "!");
		console.log(count + msg);   // re-runs ONLY when count changes
	});

	return <button onClick={() => peek(loud) ? count++ : loud = true}>go</button>;
}
```

### Cleanup

```vsk
component Timer() client {
	let &[ms] = track(0);
	effect(() => {
		const id = setInterval(() => ms.set(Date.now()), 1000);
		return () => clearInterval(id);   // or on_destroy(() => clearInterval(id))
	});
	return <time>{new Date(ms).toISOString()}</time>;
}
```

## Scheduler semantics

- `set()` does **not** update the DOM synchronously. Updates are
  **microtask-batched**: N writes in one turn produce exactly one flush.
- Reads right after `set()` see fresh cell values but stale DOM — use
  `flushSync` when you need immediate application.
- Within a flush: `pre_effect`s run first, then render blocks,
  then `effect`s last.
- `await tick()` resolves on the next animation frame (after paint), not
  merely after microtasks.
- Infinite loops are guarded — after ~1001 flush rounds you get:
  *"Maximum update depth exceeded. This typically indicates that an effect
  reads and writes the same piece of state."*
- Effects created during initial component setup are deferred until setup
  completes, so they never observe half-constructed state.

## Context

Typed context flows down the component tree; children read the nearest
provider's value.

```vsk
import { createContext } from '@vesk/runtime';

const Theme = createContext('light');

// provider side (inside a component body)
Theme.set('dark');

// consumer side (any descendant)
const theme = Theme.get();   // 'light' default if no ancestor set it
```

```ts
/**
 * Create a typed context. `get()` walks the active component's parent
 * chain and falls back to the default value. `set()` stores on the
 * nearest active component; throws outside a component context.
 */
function createContext<T>(value: T): Context<T>;

class Context<T> {
	constructor(defaultValue: T);
	get(): T;
	set(value: T): void;
}
```

## Rules of thumb

- Never import `batch` — it doesn't exist.
- Don't mutate tracked state during `derived()` evaluation.
- Reach for `untrack`/`peek` instead of restructuring effects to avoid
  over-subscription.
- Register timers/listeners cleanup with a returned function or
  `on_destroy`.
