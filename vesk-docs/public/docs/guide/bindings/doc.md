# Two-Way Bindings

Form inputs and state want to stay in sync: typing updates your data, and
programmatic changes update the screen. Vesk's binding helpers do both
directions with one line — no change events to wire, no values to push
back by hand.

`bindValue`, `bindChecked` and `bindGroup` wire form inputs to tracked
cells. They are **ref-style callbacks**: attach with `ref={…}`.

> Import explicitly — `import { bindValue } from '@vesk/runtime'` — they
> are **not** on the compiler's auto-import list. Always destructure the
> raw cell (`&[v, cell]`) and pass the cell itself.

## bindValue — text inputs & selects

```vsk
component NameField() {
	let &[name, nameCell] = track("")

	<input ref={bindValue(nameCell)} />
	<p>Hello, {name}</p>
}
```

- Listens to `input` (or `change` on `<select>`; multi-select writes an
  array of checked option values).
- `type="number"` / `type="range"` coerce `'' → null`, else numeric.
- State → DOM sync skips redundant writes to avoid cursor fights.

## bindChecked — checkboxes

```vsk
component Toggle() {
	let &[dark, darkCell] = track(false)

	<label>
		<input type="checkbox" ref={bindChecked(darkCell)} />
		Dark mode: {dark ? 'on' : 'off'}
	</label>
}
```

Listens to `change`; writes booleans both directions.

## bindGroup — radios & checkbox groups

```vsk
component Picker() {
	let &[flavor, flavorCell] = track("vanilla")
	let &[toppings, toppingsCell] = track<string[]>([])

	<label><input type="radio" value="vanilla" ref={bindGroup(flavorCell)} /> Vanilla</label>
	<label><input type="radio" value="choco" ref={bindGroup(flavorCell)} /> Choco</label>

	<label><input type="checkbox" value="fudge" ref={bindGroup(toppingsCell)} /> Fudge</label>
	<label><input type="checkbox" value="nuts" ref={bindGroup(toppingsCell)} /> Nuts</label>

	<p>{flavor} + {toppings.join(', ')}</p>
}
```

- Checkbox groups toggle their `value` inside the tracked array.
- Radios write the selected value string; checked state syncs from state.

## API reference

```ts
/**
 * Two-way bind an input/select value to a cell. Accepts either a raw
 * Tracked/Derived object OR a (getter, setter) function pair.
 * Returns a ref callback returning its own unsubscribe fn.
 * @throws TypeError when arguments are not a tracked object / set fn pair.
 */
function bindValue(maybe_tracked: unknown, set_func?: (value: unknown) => void):
	(node: HTMLElement) => () => void;

/** Same protocol for checkboxes (boolean binding). */
function bindChecked(maybe_tracked: unknown, set_func?: (value: unknown) => void):
	(input: HTMLInputElement) => () => void;

/** Radio/checkbox-group binding: string value or array membership. */
function bindGroup(maybe_tracked: unknown, set_func?: (value: unknown) => void):
	(input: HTMLInputElement) => () => void;
```

> Pass the **raw cell** (`&[v, cell]`) — passing a plain value throws the
> "not a tracked object" TypeError.
