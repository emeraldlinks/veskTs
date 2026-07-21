# Component Declarations

> Status: Phase 1 (expression mode only). Statement mode, `client`, and `async` modifiers coming in later phases.

## Syntax

```
component Name(params) {
  // body — expression mode (Phase 1)
}
```

- `component` is a **reserved keyword** in Vesk. It cannot be used as an identifier.
- The component name follows `component` and must be a valid identifier.
- Parameter list is optional: `component App { ... }` and `component App() { ... }` are both valid.
- TypeScript type annotations on parameters are supported: `component Foo(props: { name: string }) { ... }`.

## Examples

### Simple component

```vsk
component App {
  return <div>Hello World</div>;
}
```

### Component with props

```vsk
component Greeting(props: { name: string }) {
  return <div>Hello, {props.name}!</div>;
}
```

### Component with reactive state

```vsk
component Counter(props: { initial: number }) {
  let &[count] = track(props.initial);
  return <button onClick={() => count++}>Count: {count}</button>;
}
```

### Guard-clause early returns

```vsk
component TodoList(props: { todos: Todo[] }) {
  let &[filter] = track("all");

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

## Restrictions (Phase 1)

- `async component` — not yet supported (Phase 7)
- `client component` — not yet supported (Phase 7)
- `export component` — not yet supported
- Generic type parameters (`component List<T>(...)`) — ambiguous with JSX in `.vsk` files; use inline type annotations instead

## Reserved keyword

`component` cannot be used as a variable name, object property key, or in any expression context:

```vsk
const x = component;  // ERROR: `component` is a reserved keyword
```

## AST Node

```
ComponentDeclaration {
  type: 'ComponentDeclaration'
  id: Identifier
  params: Pattern[]
  body: BlockStatement
  async: boolean (false in Phase 1)
}
```
