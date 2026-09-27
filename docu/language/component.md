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

## Cross-file components

A component can live in its own `.vsk` file and be used from any other. Import
it by name, optionally renamed:

```vsk
import { Card } from './card.vsk'
import { Card as Post } from './card.vsk'

<Card />
<Post />
```

A namespace import also works, and resolves the same way:

```vsk
import * as UI from './card.vsk'

<UI.Card />
```

`<UI.Card />` looks the component up in the component registry under its
exported name (`Card`), which is exactly what `<Card />` does. No module object
is ever constructed at runtime — the namespace is a compile-time shorthand, not
a value.

Two forms do **not** work, and raise `V0410`:

- `<UI.Sub.Card />` — a `.vsk` namespace is flat; there is no nested object to
  walk into.
- `UI.max` read as a **value** (e.g. in `{UI.max}`) — only component tags
  resolve. Import the value by name, or keep it in a `.ts` module.

Both apply only to `.vsk` targets. A namespace import from a `.ts`/`.js` module
is a real module object, so `<NS.Icon />` there is an ordinary member
expression.

### `export` and the name registry

Components resolve through **one global registry keyed by declared name**, not
through per-module bindings. Two consequences worth knowing:

- A component is importable whether or not its file writes `export`. `export` is
  meaningful for *renaming* (`export { A as B }`) and for barrels
  (`export * from './x.vsk'`), not for hiding.
- Two files that both declare `component Helper` land on the same registry key,
  and only one of them wins. The build warns:

  ```
  [vesk] client bundle: component "Helper" is declared in 2 files and resolves
  to only one of them — .../a.vsk, .../b.vsk.
  ```

  The warning matters because the client registry keeps the *last* registration
  while SSR keeps the *first*, so a collision can render a different component
  in the browser than in the SSR HTML. Rename one of them.

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
- `packages/compiler/src/ir-generator.ts` — `collectVskNamespaceLocals`,
  `processJSXElement` (namespace tag → registry lookup)
- `packages/compiler/src/vsk-collision.ts` — same-name registry-key warning
- `packages/compiler/src/vsk-exports.test.ts` — `a .vsk namespace import
  resolves component tags` suite
- `packages/compiler/src/vsk-collision.test.ts` — collision detection suite
- `tests/hydration-test.mjs` — namespace component SSR + reactivity
- Commit `2a5b19d`