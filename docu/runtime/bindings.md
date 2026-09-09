# Two-Way Bindings

Vesk provides utilities for two-way data binding between reactive cells
and DOM form elements.

All auto-imported from `@vesk/runtime`.

## bindValue

Binds a tracked cell to an input or select element's value.

```vsk
component NameInput() {
  let &[name] = track('');

  return <input value={name} ref={bindValue(name)} />;
}
```

### How it works

- Reads the cell value and sets it as the element's `value`.
- On `input`/`change` events, writes the new value back to the cell.
- Handles `<select>` (including `multiple`) and `<input>` elements.
- Number coercion: inputs with `type="number"` or `type="range"` coerce
  values to numbers automatically.
- Returns a cleanup function.

### Custom setter

```vsk
let &[count] = track(0);

<input
  type="number"
  ref={bindValue(count, (val) => Math.max(0, Number(val)))}
/>
```

The second argument is an optional setter function that transforms the
value before writing to the cell.

## bindChecked

Binds a tracked cell to a checkbox element's `checked` state.

```vsk
component RememberMe() {
  let &[checked] = track(false);

  return (
    <label>
      <input type="checkbox" ref={bindChecked(checked)} />
      Remember me
    </label>
  );
}
```

## bindGroup

Binds a tracked cell to a radio button or checkbox group value.

```vsk
component ColorPicker() {
  let &[color] = track('blue');

  return (
    <div>
      <label><input type="radio" value="red" ref={bindGroup(color)} /> Red</label>
      <label><input type="radio" value="blue" ref={bindGroup(color)} /> Blue</label>
      <label><input type="radio" value="green" ref={bindGroup(color)} /> Green</label>
    </div>
  );
}
```

## Using with ref

All binding functions work with the `ref` attribute. When the element is
mounted, the binding is attached; when unmounted, the cleanup function
runs.

```vsk
<input ref={bindValue(myCell)} />
<select ref={bindValue(selectedOption)} />
<input type="checkbox" ref={bindChecked(isActive)} />
```

## API summary

| Function | Target elements | Binds |
|----------|----------------|-------|
| `bindValue(cell, setFn?)` | `<input>`, `<select>` | `value` property |
| `bindChecked(cell, setFn?)` | `<input type="checkbox">` | `checked` property |
| `bindGroup(cell, setFn?)` | `<input type="radio">`, `<input type="checkbox">` | group value |

## Verified against

- `packages/runtime/src/bindings.ts` — `bindValue`, `bindChecked`,
  `bindGroup`
- `packages/runtime/src/index-client.ts` — binding exports
