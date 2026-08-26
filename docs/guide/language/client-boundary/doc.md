# Client Boundary & Islands

Vesk is server-first by default: components render to HTML on the server
and interactivity is attached on the client through hydration. The `client`
keyword and `{#client}` / `{#server}` blocks define the boundary
explicitly.

## Server-only by default

A plain component renders on the server; its event handlers and tracked
state hydrate on the client:

```vsk
component Counter {
	let &[count] = track(0);
	return <button onClick={() => count++}>{count}</button>;
}
```

Event-handler attributes (`on*`) are **excluded from SSR HTML entirely** —
the server output carries markup only; the client bundle attaches behavior.

## Islands: the `client` keyword

Marking a component `client` makes it an **island**: it renders on *both*
server and client, and is always included in the client bundle.

```vsk
component Clock() client {
	let &[now] = track(new Date());
	effect(() => {
		const t = setInterval(() => now.set(new Date()), 1000);
		return () => clearInterval(t);   // cleanup via returned fn / on_destroy
	});
	return <time>{now.toLocaleTimeString()}</time>;
}
```

- Modifier position: after params (`component X() client { … }`) or right
  after `component`.
- Composes with `export`/`async`:
  `export default async component X() client { … }`.

## `{#client}` / `{#server}` blocks

Inside any component body, scoped blocks split server vs client markup:

| Block | Server SSR | Client bundle |
| --- | --- | --- |
| `{#server} … {/server}` | rendered | stripped |
| `{#client} … {/client}` | stripped (SSR emits nothing) | rendered |

Which blocks a component may use depends on its own kind — the compiler
validates this:

| Component kind | `{#server}` | `{#client}` |
| --- | --- | --- |
| Server component (default) | allowed | **error** |
| `client` island | **error** | allowed |

```vsk
component Robots() {
	{#server}
		<meta name="robots" content="noindex" />
	{/server}

	<p>Always rendered.</p>
}

component ClientOnly() client {
	{#client}
		<p>This markup only exists in the browser.</p>
	{/client}

	<p>Also always rendered.</p>
}
```

Blocks nest and accept full statement-mode bodies (loops, conditionals,
etc.). A `#server { … }` / `#client { … }` statement form parses to the
identical node.

## Typical patterns

### Browser-only APIs

Wrap `window`/`document` access in an island or effect — never at the top
level of a server-rendered body:

```vsk
component ThemeToggle() client {
	let &[dark] = track(false)
	effect(() => {
		dark.set(document.documentElement.classList.contains('dark'))
	})
	<button onClick={() => {
		document.documentElement.classList.toggle('dark')
		dark.set(!dark.get())
	}}>Toggle theme</button>
}
```

### SSR-only content

Analytics snippets, request-time data, big static trees you never want in
the client bundle:

```vsk
component Footer(props: { year: number }) {
	{#server}
		<small>Built with Vesk · {props.year}</small>
	{/server}
}
```
