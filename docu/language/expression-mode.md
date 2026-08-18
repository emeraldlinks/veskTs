# Expression Mode

Expression mode is the classic component body style: the body computes a
single `return <jsx>;` expression. It is the simplest way to write a
component and the default for one-liners.

## Syntax

```vsk
component Greeting(props: { name: string }) {
  return <div>Hello, {props.name}!</div>;
}
```

## Rules

- The body must end with `return <jsx>;`.
- Guard-clause early returns are allowed before the final return:

```vsk
component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;

  return (
    <div class="todo-list">
      {props.todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}
```

- `.map()` callbacks render collections; a `key` prop is recommended for
  reconciliation (the compiler extracts the key expression from the JSX
  child).
- Ternary and `&&` expressions work inside `{}`:

```vsk
component Badge(props: { show: boolean }) {
  return <span>{props.show ? "on" : "off"}</span>;
}
```

- Fragments are supported; adjacent top-level JSX is not:

```vsk
component Pair {
  return (
    <>
      <Comp1 />
      <Comp2 />
    </>
  );
}
```

## Relationship to statement mode

Statement mode is the statement-level equivalent — bare JSX, `if`, `for`,
`switch`, `try`, and guard clauses without a wrapper return:

```vsk
component TodoList(props: { todos: Todo[] }) {
  if (props.todos.length === 0) return <EmptyState />;
  for (const todo of props.todos; key todo.id) {
    <TodoItem todo={todo} />
  }
}
```

Every body feature available in expression mode is available in statement
mode and vice versa. See [statement-mode.md](statement-mode.md).

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — adjacent-JSX error, statement
  position JSX
- `packages/compiler/src/ir-generator.ts` — `isMapCall` → `MapRegion`,
  `extractKeyExpr`
- Commit `2a5b19d`