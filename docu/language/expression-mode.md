# Expression Mode

> Status: Phase 1. Statement mode documented separately.

## Overview

Expression mode is the default (and currently only) body mode for Vesk components. The component's output is defined by a single `return (<jsx>)` statement, with reactive declarations and guard clauses above it.

## Rules

1. **Main output**: A single top-level `return (<jsx>)` that contains the JSX tree.
2. **Setup code**: Reactive declarations (`let &[name] = track(...)`) and guard-clause early returns appear above the main return.
3. **JSX-only inside the returned tree**: Inside the returned JSX, only JSX expression syntax is legal:
   - Tags: `<div>`, `<Component />`
   - Text: `Hello world`
   - Interpolation: `{expr}`
   - Conditionals: `{cond && <X />}`
   - Lists: `{items.map(item => <X key={...} />)}`
4. **No bare statements inside JSX**: `if`, `for`, `const` etc. inside the returned JSX tree are **hard compiler errors**. (In Phase 1, this is enforced by JSX syntax — bare statements aren't valid JSX content.)

## Pattern

```vsk
component TodoList(props: { todos: Todo[] }) {
  // 1. Reactive declarations
  let &[filter] = track("all");
  let &[count] = track(0);

  // 2. Guard-clause early returns
  if (props.todos.length === 0) return <EmptyState />;

  // 3. Main return with JSX tree
  return (
    <div class="todo-list">
      <h2>Todos ({count})</h2>
      {filter === "all" && <p>Showing all</p>}
      {props.todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}
```

## Guard Clauses

Guard-clause early returns are regular `return` statements that appear before the main return. They follow standard JavaScript semantics:

```vsk
component Data(props: { loading: boolean; error: string | null; data: any }) {
  if (props.loading) return <Spinner />;
  if (props.error) return <Error message={props.error} />;
  return <div>{props.data}</div>;
}
```

The compiler identifies the **last** `return (<jsx>)` as the main output. All `return` statements above it are treated as guard clauses.

## List Rendering

Lists use `.map()` which compiles to **runtime keyed diffing** (not static DOM patching):

```vsk
component List(props: { items: Item[] }) {
  return (
    <ul>
      {props.items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

The `key` prop is required for each item in a mapped list.

## Reactive Bindings

Reactive state uses the `let &[name] = track(initialValue)` syntax:

```vsk
component App() {
  let &[count] = track(0);
  let &[double] = track(() => count * 2);

  return <div>{count} doubled is {double}</div>;
}
```

- `track(value)` creates a reactive cell
- `track(() => expr)` creates a derived/computed value
- After declaration, use the name as a plain variable (no sigil)

## Contrast with Statement Mode (Future)

| Feature | Expression Mode | Statement Mode (Phase 4+) |
|---------|----------------|---------------------------|
| Output | `return (<jsx>)` | Bare JSX-as-statement |
| Conditionals | `{cond && <X />}` | `if (cond) { <X /> }` |
| Lists | `.map()` → runtime diffing | `for` → static DOM patching |
| Complexity | Simple, standard JSX | Custom parser extensions |

See [statement-mode.md](./statement-mode.md) for the statement mode spec.
