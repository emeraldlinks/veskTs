# Statement Mode

Statement mode is Vesk's native template style: markup appears as
statements in the component body, right next to your logic — no `return`
wrapper, no expression gymnastics. It reads top-to-bottom like the page
it produces.

## What it is

In statement mode the body is a sequence of statements: plain TypeScript
declarations interleaved with bare JSX and real control flow.

```vsk
component Profile(props: { user: User }) {
	const initials = props.user.name.split(' ').map((p) => p[0]).join('');

	<h1>{props.user.name}</h1>
	<p class="avatar">{initials}</p>
}
```

Each JSX line renders where it appears. There is no single return value —
the body *is* the template.

## What it does

Statement mode turns JavaScript's control flow into rendering flow. An
`if` renders its block when true; a `for` renders its block per item;
`switch` and `try/catch` work exactly as you expect — all as live,
reactive regions on the client:

```vsk
component Cart(props: { items: Item[] }) {
	if (props.items.length === 0) {
		<p>Your cart is empty.</p>
	}

	for (const item of props.items; key item.id) {
		<Row item={item} />
	}
}
```

## How it differs from expression mode

| | Statement mode | [Expression mode](../expression-mode/doc.md) |
| --- | --- | --- |
| Output | The body itself, block by block | One returned JSX tree |
| Conditionals | Real `if / else if / else` statements | Ternaries and `&&` inside `{ }` |
| Loops | `for`, `for…of` (with key/index), `while` | `.map()` callbacks |
| Empty states | Built-in `empty { }` alternate | Manual length check |
| Errors per region | Wrap any section in `try / catch` | Not available inline |
| Feel | A reactive HTML template | A function returning UI |

Both compile to the same output — choose whichever reads better for each
component.

## Pros

- **Reads like the page**: chrome, sections and lists appear in visual
  order.
- **Real control flow** keeps deeply branched pages flat instead of
  ternary pyramids.
- **Less boilerplate for lists**: key clauses and empty states are part of
  the loop syntax.
- **Localized error handling** with try/catch around just one region.

## Cons

- Unfamiliar at first if you've only used return-based JSX.
- Adjacent elements must be separate statements (or one fragment) — you
  can't paste loose sibling tags inside a single expression.
- Most JSX material online is written in expression style and needs light
  translation.

## Statements the compiler understands

| Statement | What it becomes |
| --- | --- |
| Bare JSX element / fragment | rendered markup, tracked for hydration |
| `{expr}` container | dynamic region (a `.map()` inside becomes a list region) |
| `if` / `else if` / `else` | conditional region |
| `for…of`, `for…in`, classic `for`, `while`, `do…while` | loop region |
| `switch` (+ `break`, `default`) | switch region |
| `try` / `catch` | error region; the catch variable is usable inside |
| `return (<jsx>)` | guard-clause early exit |
| `let &[x] = track(v)` | reactive state declaration |
| other declarations and calls | preserved as-is |

Declaring a `class` inside a component body isn't allowed.

## Bare JSX

No parentheses needed at statement position:

```vsk
component Greeting(props: { name: string }) {
	<div>Hello, {props.name}!</div>
}
```

Multiple top-level blocks are fine — they're separate statements:

```vsk
component Multi() {
	<div>first</div>
	<div>second</div>
}
```

But two siblings *inside one expression* still need a wrapper.

## Conditionals

Plain JavaScript, including chained else-ifs:

```vsk
component Score({ score }: { score: number }) {
	if (score > 90) {
		<p>A</p>
	} else if (score > 70) {
		<p>B</p>
	} else {
		<p>C</p>
	}
}
```

## Loops

All loop forms work. `for…of`/`for…in` accept two extra clauses, and an
`empty { }` block handles the nothing-to-show case:

```vsk
for (const item of items; key item.id; index i) {
	<Row data={item} index={i} />
} empty {
	<p>Nothing here</p>
}
```

- `; key <expr>` — identity used to reconcile DOM when the list changes.
- `; index <name>` — binds the position.
- Classic `for` and `while` keep their normal syntax.

```vsk
switch (score) {
	case 1:
		<p>One</p>
		break
	default:
		<p>Something else</p>
}
```

## Guard-clause early exits

Stop rendering when a precondition fails. Brace the guard and
parenthesize the return so the parser keeps reading the rest of the body
afterwards:

```vsk
component Page(props: { user: User | null }) {
	if (!props.user) {
		return (<a href="/login">Login</a>);
	}

	<h1>Welcome, {props.user.name}</h1>
}
```

Everything after a taken guard return is skipped.

## Local error boundaries

Wrap a fragile region; if it throws, the catch content renders instead —
and only that region is affected:

```vsk
try {
	<RiskyWidget />
}
catch (e) {
	<p>Widget failed: {String(e?.message ?? e)}</p>
}
```


Route-level failures belong in [`error.vsk`](../../routing/error-handling/doc.md).

## Text vs. code in element children

Everything inside an element is a chance to run code or to print text. By
default Vesk treats a child as **code** when it looks like a line of code,
and as **text** otherwise. The rule of thumb:

> If it looks like a line of code — `name(...)` with no spaces, ending the
> line or followed by `;` — we run it. If it looks like a sentence, we
> print it. When in doubt, wrap it in `{}` — braces always mean *evaluate*.

A bare call on its own line inside an element executes as a statement:

```vsk
component Trace(props: { id: number }) {
	<div>
		console.log("loading", props.id)
		<p>Loaded</p>
	</div>
}
```

This runs `console.log(...)` and otherwise renders `<p>Loaded</p>`.

Text that merely *resembles* a call stays text — because a word follows the
closing paren, or the paren is spaced off, or there's no `;</newline`
terminator:

```vsk
<p>call me (maybe); ok</p>      {/* text */}
<p>the(cat) sat</p>             {/* text */}
<p>doSomething(x) then more</p> {/* text */}
```

Anything else that starts like code but doesn't fit the pattern — a bare
identifier with no call parens, or a call that doesn't close the line — is
treated as text too.

To force a line to be code even when it looks like prose, wrap it in braces:

```vsk
<div>{"print this literally"}</div>
```

`const`/`let`/`var` declarations and `if`/`for`/etc. keep working inside any
element in both modes.
