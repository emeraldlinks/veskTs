# Component Declarations

`component` is the Vesk component keyword. Components are the unit of markup,
state, and effects: the compiler transforms a component body into IR and
generates server (SSR) and client (hydration) code from it.

## Syntax

```vsk
component Name(params) { }
component Name { }            // params optional — same as Name()
component Island(params) client { }
export component Exported(params) { }
export default component App(params) { }
export async component Loader() { }
export default async component App() { }
```

- `component` is a **reserved keyword**. Using it as an identifier raises
  "`component` is a reserved keyword and cannot be used as an identifier".
- `Name` must be a valid identifier.
- Params are optional and fully TypeScript-typed:
  `component Foo(props: { name: string }) { ... }`.
- Generic type parameters are supported:
  `component List<T>(props: { items: T[] }) { ... }` — the compiler parses
  `typeParameters` like a TS function declaration.
- `async` may appear before `component` — directly (`async component
  X()`) or after `export` (`export default async component X()`) — with
  arbitrary whitespace. `async` after the params (`component X() async`)
  is not part of the grammar.
- `client` (the island modifier) may appear after the closing paren or after
  `component` — both positions parse to the same `client: true` flag.
  See [client-boundary.md](client-boundary.md).

## Body modes

A component body is either:

- **Expression mode** — ends with `return <jsx>;`. See
  [expression-mode.md](expression-mode.md).
- **Statement mode** — markup and control flow as statements (bare JSX,
  `if`, `for`, `switch`, `try`, guard-clause returns). See
  [statement-mode.md](statement-mode.md).

## Examples

```vsk
component App {
  return <div>Hello World</div>;
}
```

```vsk
component Greeting(props: { name: string }) {
  return <div>Hello, {props.name}!</div>;
}
```

```vsk
component Counter(props: { initial: number }) {
  let &[count] = track(props.initial);
  return <button onClick={() => count++}>Count: {count}</button>;
}
```

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

## AST Node

The parser emits `ComponentDeclaration`:

```
ComponentDeclaration {
  type: 'ComponentDeclaration'
  id: Identifier
  params: Pattern[]          // [] when omitted
  body: BlockStatement
  async: boolean
  client: boolean
  typeParameters?: TypeParameterDeclaration[]
}
```

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — `parseComponentDeclaration`
- `packages/compiler/src/parser.test.ts` — `client keyword`, generics,
  `export [default] [async] component` suites
- Commit `2a5b19d`