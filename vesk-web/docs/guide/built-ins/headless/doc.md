# Show / For / Switch / Match

Sometimes you want `if`/list rendering as plain function calls instead of
template blocks — inside a helper module, a computed value, or shared
render logic. These four primitives do exactly that:

- `<Show>` renders one of two things depending on a condition
- `<For>` renders a list with a fallback for empty
- `<Switch>` + `<Match>` pick the first matching branch

They're called *headless* because they render whatever you give them —
no wrapper markup, no styling opinions. Both runtime barrels export them.

> In `.vsk` components prefer native statement-mode `if`/`for` — they
> compile to live reactive regions automatically. These primitives are
> most useful inside JSX expressions and shared render helpers.

> **In `.vsk` components prefer native statement-mode `if`/`for`** — they
> compile to live reactive regions automatically. These primitives are
> most useful inside JSX expressions and shared render helpers.
>
> Two usage rules matter:
> 1. **Import them explicitly** — `import { Show } from '@vesk/runtime'`
>    (they are not on the auto-import list).
> 2. **Call them as expressions** (inside `{…}` containers or returns) —
>    a bare statement call compiles but its return value renders nothing.
>
> Object-literal props cannot contain literal JSX today (tokenizer
> limitation — see [Expression Mode](../../language/expression-mode/doc.md)),
> so pass strings, numbers, nested arrays, or precomputed values.

```ts
/**
 * Render children when `when` is truthy; otherwise fallback (or null).
 * @example <div>{Show({ when: user, children: 'wb', fallback: 'login' })}</div>
 */
function Show(props: { when: unknown; children?: unknown; fallback?: unknown }): unknown;

/**
 * Map over a list with a render-function child; empty/null list → fallback.
 * @example <ul>{For({ each: tags, children: (t, i) => t, fallback: 'none' })}</ul>
 */
function For<T>(props: {
	each: readonly T[] | null | undefined;
	children: (item: T, index: number) => unknown;
	fallback?: unknown;
}): unknown;

/**
 * Render the first truthy Match child, else fallback.
 */
function Switch(props: { children?: unknown; fallback?: unknown }): unknown;

/** Truthy-conditional child for use inside Switch. */
function Match(props: { when: unknown; children?: unknown }): unknown;
```

## Examples

```vsk
import { Show } from '@vesk/runtime';

component SessionBadge(props: { user: User | null }) {
	<div>{Show({ when: props.user, children: 'Signed in', fallback: 'Guest' })}</div>
}
```

```vsk
import { For } from '@vesk/runtime';

component TagList({ tags }: { tags: string[] }) {
	<ul>{For({ each: tags, children: (t: string): string => t, fallback: 'untagged' })}</ul>
}
```

```vsk
import { Switch, Match } from '@vesk/runtime';

component Tabs() {
	let &[tab] = track("overview")

	return (
		<div>
			{Switch({
				children: [
					Match({ when: tab === "overview", children: 'overview pane' }),
					Match({ when: tab === "team",     children: 'team pane' }),
				],
				fallback: 'no tab',
			})}
		</div>
	)
}
```

## Notes

- These are pure functions: SSR renders directly; on the client,
  reactivity comes from the surrounding tracked reads. For fine-grained
  branch swapping of rich markup, native `if`/`for` statements remain the
  first-class tool.
