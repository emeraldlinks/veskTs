# Headless Components

Vesk provides headless render helpers for conditional rendering, list
rendering, and pattern matching. These are composable building blocks —
no markup, no styling.

All auto-imported from `@vesk/runtime`.

## Show

Conditional rendering based on a truthy value.

```vsk
component Greeting(props: { name?: string }) {
  return (
    <Show when={props.name} fallback={<p>Hello, stranger</p>}>
      <p>Hello, {props.name}</p>
    </Show>
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `when` | `unknown` | Condition to evaluate |
| `fallback` | content | What to render when `when` is falsy |
| `children` | content | What to render when `when` is truthy |

## For

List rendering with keyed reconciliation.

```vsk
component TodoList(props: { items: string[] }) {
  return (
    <ul>
      <For each={props.items} fallback={<p>No items</p>}>
        {(item, index) => <li>{index}: {item}</li>}
      </For>
    </ul>
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `each` | `T[] \| null \| undefined` | Array to iterate |
| `children` | `(item: T, index: number) => content` | Render function |
| `fallback` | content | What to render when array is empty |

### Keyed reconciliation

The `For` component uses keyed reconciliation under the hood. The
compiler generates efficient DOM updates that add, remove, and reorder
elements without re-rendering the entire list.

### Statement-mode alternative

In statement mode, you can use `for` loops directly:

```vsk
component TodoList(props: { items: string[] }) {
  <ul>
    for (const item of props.items) {
      <li>{item}</li>
    }
    if (props.items.length === 0) {
      <p>No items</p>
    }
  </ul>
}
```

## Switch / Match

Pattern matching with exhaustive coverage.

```vsk
component StatusBadge(props: { status: string }) {
  return (
    <Switch>
      <Match when={props.status === 'active'}>
        <span class="bg-green-100 text-green-800">Active</span>
      </Match>
      <Match when={props.status === 'pending'}>
        <span class="bg-yellow-100 text-yellow-800">Pending</span>
      </Match>
      <Match when={props.status === 'error'}>
        <span class="bg-red-100 text-red-800">Error</span>
      </Match>
      <Match fallback>
        <span class="bg-gray-100 text-gray-800">Unknown</span>
      </Match>
    </Switch>
  );
}
```

### Switch props

| Prop | Type | Description |
|------|------|-------------|
| `fallback` | content | Default when no `Match` matches |
| `children` | `Match` elements | Cases to evaluate |

### Match props

| Prop | Type | Description |
|------|------|-------------|
| `when` | `unknown` | Condition for this case |
| `fallback` | `boolean` | If `true`, this is the default case |
| `children` | content | What to render |

## Verified against

- `packages/runtime/src/headless.ts` — `Show`, `For`, `Switch`, `Match`
- `packages/runtime/src/index-client.ts` — headless exports
