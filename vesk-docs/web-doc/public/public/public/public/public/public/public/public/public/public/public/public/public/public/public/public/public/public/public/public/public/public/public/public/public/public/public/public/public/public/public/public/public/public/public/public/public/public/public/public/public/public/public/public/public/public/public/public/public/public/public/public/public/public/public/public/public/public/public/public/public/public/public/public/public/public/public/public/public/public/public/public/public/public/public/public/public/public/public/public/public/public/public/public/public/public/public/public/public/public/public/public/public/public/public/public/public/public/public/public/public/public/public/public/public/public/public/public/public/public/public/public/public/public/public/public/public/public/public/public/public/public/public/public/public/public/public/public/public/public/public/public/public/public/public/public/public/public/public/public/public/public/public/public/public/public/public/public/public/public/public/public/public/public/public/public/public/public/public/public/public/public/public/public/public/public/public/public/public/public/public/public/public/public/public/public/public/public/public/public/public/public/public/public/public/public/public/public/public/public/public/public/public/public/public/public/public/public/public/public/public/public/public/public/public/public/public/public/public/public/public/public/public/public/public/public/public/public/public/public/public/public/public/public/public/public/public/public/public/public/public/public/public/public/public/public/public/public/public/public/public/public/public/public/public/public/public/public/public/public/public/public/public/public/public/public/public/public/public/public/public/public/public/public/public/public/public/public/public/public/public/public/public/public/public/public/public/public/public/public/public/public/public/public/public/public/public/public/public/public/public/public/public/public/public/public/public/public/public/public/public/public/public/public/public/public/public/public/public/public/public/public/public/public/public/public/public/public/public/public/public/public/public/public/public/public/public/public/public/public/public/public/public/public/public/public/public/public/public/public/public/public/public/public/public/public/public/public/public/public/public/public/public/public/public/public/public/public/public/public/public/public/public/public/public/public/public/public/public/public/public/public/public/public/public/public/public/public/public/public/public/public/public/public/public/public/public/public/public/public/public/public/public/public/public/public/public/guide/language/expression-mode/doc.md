# Expression Mode

Expression mode is the classic JSX style: a component is a function, and
its body **returns** the markup. If you've used React, Preact or Solid,
this is the mode you already know.

## What it is

The body computes values and ends with a single `return <jsx>;`. That
returned tree *is* the component's output:

```vsk
component Greeting(props: { name: string }) {
	return <div>Hello, {props.name}!</div>;
}
```

## What it does

Everything between the braces is ordinary TypeScript. You can compute,
branch and transform — then hand one JSX tree back:

```vsk
component FullName(props: { first: string; last: string }) {
	const display = `${props.first} ${props.last}`.trim();
	return <h1>{display}</h1>;
}
```

Dynamic values go inside `{ }` braces in the markup. Text is
automatically escaped on the server, so user data is safe by default.

## How it differs from statement mode

- **One return, one tree.** Statement mode lets markup sit as bare
  statements anywhere in the body; expression mode always funnels output
  through `return`.
- **Control flow lives inside expressions.** Where statement mode writes
  real `if`/`for` blocks, expression mode uses ternaries, `&&`, and
  `.map()` inside braces.
- **Same result.** Both modes compile to identical HTML and client code —
  this is purely about how you like to write.

## Pros

- Instantly familiar to anyone with JSX experience — most React examples
  translate line-for-line.
- The entire output is one visible value: easy to reason about, extract,
  or wrap.
- Compact for simple components — often a single readable return.

## Cons

- Deeply conditional UI turns into nested ternary pyramids.
- Loops must become `.map()` calls, which gets noisy when you also need
  keys, indexes or empty-state handling.
- No natural place to put markup "between" logic — everything flows
  through the final expression.

If a component starts feeling like a puzzle of ternaries, that's your cue
to try [statement mode](../statement-mode/doc.md).

## Building conditionals

Ternaries for two-way choices, `&&` for "render only when":

```vsk
component Badge(props: { show: boolean; n: number }) {
	return (
		<div>
			{show ? 'on' : 'off'}
			{n > 1 && <b>big</b>}
		</div>
	);
}
```

JSX works directly in ternary branches:

```vsk
component AuthLink(props: { ok: boolean }) {
	return <div>{props.ok ? <a href="/">in</a> : <b>out</b>}</div>;
}
```

## Rendering lists

`.map()` renders collections. Give each item a `key` so the client can
reorder efficiently:

```vsk
component Posts({ xs }: { xs: number[] }) {
	return <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>;
}
```

## Fragments

Return multiple siblings with a fragment — but never leave two elements
loose at the top level without one:

```vsk
component Pair() {
	return (
		<>
			<i>a</i>
			<i>b</i>
		</>
	);
}
```

Adjacent top-level JSX without a wrapper is an error:
*"Adjacent JSX elements must be wrapped in an enclosing tag…"*

## Guard clauses

Early returns handle "not allowed / nothing here" cases before the main
return. When statements follow, brace the guard and parenthesize its
return:

```vsk
component Page(props: { user: User | null }) {
	if (!props.user) {
		return (<a href="/login">Login</a>);
	}

	return <h1>Welcome, {props.user.name}</h1>;
}
```

## Where JSX can appear

| Position | Supported |
| --- | --- |
| After `return`, anywhere in the returned tree | Yes |
| Ternary branches (`cond ? <a/> : <b/>`) | Yes |
| `.map((item) => <Row/>)` callbacks | Yes |
| As component children (`<Md>…</Md>`) | Yes |
| After `=` assignment (`let node = <p/>`) | Not yet |
| Inside object/array literals (`{ el: <p/> }`) | Not yet |

For object-shaped configuration (variant tables, option maps), store
strings or data and branch on them — or move markup into small child
components.
