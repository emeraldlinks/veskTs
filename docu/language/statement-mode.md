# Statement Mode

Statement mode is a first-class component body style: markup and control
flow appear directly as statements, no `return` wrapper required. Every
feature that works in expression mode also works in statement mode, and
vice versa.

## What statement mode looks like

```vsk
component List(props: { items: string[] }) {
  let &[filter] = track("");

  if (filter !== "") {
    <p>Filtered by: {filter}</p>
  }

  for (const item of props.items; key item) {
    <div>{item}</div>
  } empty {
    <p>No items.</p>
  }
}
```

## Statements the compiler understands

Inside a component body, the IR generator recognizes:

| Statement | IR handling |
| --- | --- |
| Bare JSX element / fragment | rendered, tracked |
| `{expr}` expression container | rendered; `.map()` calls become `MapRegion` |
| `if` / `else` | conditional region |
| `for...of`, `for...in`, classic `for` | loop region (see key/index clauses below) |
| `while` / `do...while` | loop region |
| `switch` | switch region |
| `try` / `catch` | try region (fallback content on error) |
| `return <jsx>` | guard-clause early return — renders and stops |
| labeled statements | their body is processed |
| `{#server}` / `{#client}` blocks | [client-boundary.md](client-boundary.md) |
| Track declarations (`let &[x] = track(0)`) | `TrackDecl` |
| Anything else (function calls, assignments, `const` helpers) | preserved verbatim as a runtime statement |

`class Foo {}` inside a component body is rejected: components cannot
declare classes in their body.

## Bare JSX as a statement

```vsk
component Greeting(props: { name: string }) {
  <div>Hello, {props.name}!</div>   // statement-position JSX — no parentheses
}
```

The parser treats `<` at statement position inside a component body as the
start of a JSX element (`#jsxStartsStatement`), so no wrapping is required.
Adjacent JSX without a wrapper is an error:

```vsk
component Bad {
  <Comp1 />
  <Comp2 />   // ERROR: Adjacent JSX elements must be wrapped in an enclosing tag.
              // Wrap them in a fragment: <><Comp1 /><Comp2 /></> or a single parent element.
}
```

## `for` key/index clauses

Vesk extends `for...of` headers with key and index clauses:

```vsk
for (const item of items; key item.id; index i) {
  <Row data={item} />
}
```

- `; key <expr>` — the key expression used for reconciliation.
- `; index <ident>` — binds the loop index to `ident`.
- Clauses are optional and combinable; only `for...of`/`for...in` headers
  may carry them (classic `for (let i = 0; i < n; i++)` keeps its normal
  semicolons).
- The compiler blanks the clause text before parsing and recovers it from
  annotations (`VeskAnnotation`), preserving all source offsets.

## `empty` blocks as loop alternates

A `for` loop may be followed by an `empty {}` block, which renders when the
iterable is empty:

```vsk
for (const item of items; key item.id) {
  <li>{item}</li>
} empty {
  <li>Nothing here</li>
}
```

`empty {}` is a `VeskBlock` tag; the IR generator attaches its body as the
loop's alternate content.

## Guard-clause early returns

```vsk
component Page(props: { user: User | null }) {
  if (!props.user) return <Login />;
  <h1>Welcome, {props.user.name}</h1>;
}
```

A `return <jsx>` inside statement mode renders the element and exits the
body — the compiler processes the argument as IR and stops there.

## Expression mode equivalent

Everything above also composes in expression mode:

```vsk
component List(props: { items: string[] }) {
  return (
    <div>
      {props.items.map((item) => (
        <div>{item}</div>
      ))}
    </div>
  );
}
```

See [expression-mode.md](expression-mode.md) for the expression-mode rules.

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — statement-position JSX,
  `VeskBlock` (`{#server}`/`{#client}`/`empty`)
- `packages/compiler/src/parser.ts` — `preprocessForClauses` (key/index)
- `packages/compiler/src/ir-generator.ts` — `processStatementModeBody`
  (statement dispatch table)
- Commit `2a5b19d`