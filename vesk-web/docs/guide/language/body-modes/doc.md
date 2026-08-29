# Body Modes: Expression vs Statement

Every Vesk component has a *body* — the code between `{ }` that describes
what the component renders. Vesk gives you two ways to write it, and both
are first-class: they support exactly the same features, compile to the
same server HTML and the same client JavaScript, and you can freely pick
one per component.

## The two modes at a glance

**Expression mode** treats a component like a function that returns its
markup. You compute values, then `return` one JSX tree:

```vsk
component Greeting(props: { name: string }) {
	return <div>Hello, {props.name}!</div>;
}
```

**Statement mode** treats markup as statements in their own right. JSX
sits directly in the body next to your control flow — no `return`, no
wrapping:

```vsk
component Greeting(props: { name: string }) {
	<div>Hello, {props.name}!</div>
}
```

Both render identical HTML.

## How they differ

| | Expression mode | Statement mode |
| --- | --- | --- |
| Mental model | "A function returning UI" (like React) | "A template with superpowers" (like a server template, but reactive) |
| Structure | One root JSX tree per `return` | Many top-level blocks compose the page top-to-bottom |
| Control flow | Inside `{ }`: ternaries, `&&`, `.map()` | Real `if`/`else if`/`else`, `for`, `while`, `switch`, `try/catch` as statements |
| Early exits | Guard clauses with early `return`s | Same guard clauses, plus markup can just stop appearing |
| Best for | Small leaf components, porting React habits | Pages, layouts, anything with lots of branching |

## Pros and cons

### Expression mode

**Pros**

- Familiar if you come from React, Solid or any JSX framework.
- The whole component's output is one visible value — easy to extract,
  memoize mentally, or wrap.
- Ternaries keep tiny conditionals compact.

**Cons**

- Complex pages become deeply nested ternary/map pyramids.
- Every branch must live inside an expression, so large conditionals get
  noisy (`{cond ? (<div>…</div>) : null}`).
- No place for markup between statements — everything funnels through one
  return.

### Statement mode

**Pros**

- Reads like the page it produces: header block, then nav block, then
  content blocks.
- Real `if/for/switch/try` — no expression gymnastics for control flow.
- Loops gain extras: `; key` clauses for reconciliation and an
  [`empty {}`](../statement-mode/doc.md#loops) alternate for empty lists.
- Partial rendering is natural — a failing section can be wrapped in
  try/catch without restructuring the whole tree.

**Cons**

- Slightly unusual at first if you've only used return-based JSX.
- Two sibling elements each need to be their own statement (or one
  fragment) — you can't paste loose adjacent tags inside a single
  expression.
- Most existing JSX tutorials/examples are written in expression mode and
  need light translation.

## Choosing

There is no wrong answer — teams typically mix:

```vsk
// A page benefits from statement mode…
component Dashboard(props: { user: User }) {
	if (!props.user) {
		return (<a href="/login">Please log in</a>);
	}

	for (const widget of props.widgets; key widget.id) {
		<Widget data={widget} />
	} empty {
		<p>No widgets yet.</p>
	}
}
```

```vsk
// …while small pieces stay in expression mode.
component Widget(props: { data: WidgetData }) {
	return <section class="widget">{props.data.title}</section>;
}
```

Rule of thumb: **if you're writing more than one conditional or loop,
statement mode will read better. If the component is one expression,
expression mode is fine.**

## Deep dives

- [Expression Mode](../expression-mode/doc.md)
- [Statement Mode](../statement-mode/doc.md)
