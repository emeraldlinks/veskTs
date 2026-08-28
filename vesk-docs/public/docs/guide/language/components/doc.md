# Components

Components are how you build with Vesk. Each one is a self-contained
piece of UI — its markup, its state and its behavior living together in
one place. You declare them with the `component` keyword, drop them in
the `app/` directory, and the framework takes care of rendering them on
the server and making them interactive in the browser.

```vsk
component Greeting {
	return <h1>Hello!</h1>;
}
```

This page covers declarations, props, children, attributes, events and
refs. How you *write* the body is up to [Body Modes](../body-modes/doc.md);
state and effects are covered in [Reactivity](../../reactivity/doc.md).

## The `component` keyword

## Syntax

```vsk
component Name(params) { }              // basic
component Name { }                      // params optional — same as Name()
component Island(params) client { }     // island (see client-boundary page)
export component Exported(params) { }
export default component App(params) { }
export async component Loader() { }
export default async component App() { }
```

Rules:

- `component` is a **reserved keyword** — using it as an identifier is a
  compile error.
- Params are optional and fully TypeScript-typed.
- Generic type parameters are supported: `component List<T>(…) { … }`.
- `async` goes **before** `component`; `component X() async` is not in the
  grammar. Async components are awaited during SSR and on hydration.
- The `client` island modifier goes after the params (or right after
  `component`) and composes with `export`/`async`.

## Props

Props arrive via the first parameter — plain TypeScript:

```vsk
component Greeting(props: { name: string }) {
	return <div>Hello, {props.name}!</div>;
}
```

Destructuring with optional props and defaults works:

```vsk
component Card({ title, body = '', featured }: {
	title: string; body?: string; featured?: boolean;
}) {
	return <article class="card"><h2>{title}</h2><p>{body}</p></article>;
}
```

Layouts receive children through the shared `Component` type and render
them where `{props.children}` appears:

```vsk
import type { Component } from '@vesk/types';

interface LayoutProps {
	children?: Component;
}

component Layout(props: LayoutProps) {
	<html>
		<body>
			{props.children}
		</body>
	</html>
}
```

> There is no `<slot/>` mechanism — children flow exclusively through
> `{props.children}`.

## Attributes

- Dynamic values: `class={expr}`, `` id={`item-${id}`} `` — text is
  escaped on SSR.
- Boolean attributes render when truthy: `disabled={on}`.
- **Spread attributes**: `<button {...rest}>` merges dynamic prop objects.
- **Form-element values are property bindings**: `value`, `checked`,
  `selected`, `indeterminate` on input/textarea/select/option/progress
  compile to property assignment (`el.value = x`), not attributes.
- **Event handlers** (`onClick`, `onInput`, …) are excluded from SSR HTML
  entirely and attach during hydration.
- **Refs**: `ref={fn}` invokes `fn(element)` after creation on the client
  (stripped from SSR). This is also the attach point for two-way binding
  helpers — see [Bindings](../../bindings/doc.md).

```vsk
component Fld() client {
	let el: any = null
	return <input ref={(n: any) => { el = n }} />;
}
```

## Importing & exporting components

`.vsk` files import each other like ES modules; child components resolve
through the compiler's registry on both server and client:

```vsk
import { TodoItem } from './TodoItem.vsk';
import type { Todo } from '../types';
```

Type-only imports (`import type { X }`, inline `{ type A }`) are dropped
from both bundles and never resolved as components.

## Auto-imported identifiers

Inside `.vsk` components you can use these **without importing them**
(the compiler injects them): `useFetch`, `createResource`,
`useRouter`, `useParams`, `usePathname`, `useSearchParams`,
`useNavigate`, `defineAction`, `getAction`, `validateActionInput`,
`issuesToFieldMap`, `isFormAction`, `Form`, `Field`, `required`,
`email`, `minLength`, `maxLength`, `pattern`, `custom`, `Link`,
`NavLink`, `Outlet`, `Redirect`, `redirect`, `permanentRedirect`,
`notFound`, `NotFoundError`, `Image`, `Portal`, `Experiment`,
`LoadingIndicator`, `useLoadingIndicator`, `JsonLd`, all SEO schema
helpers (`ArticleSchema`, `ProductSchema`, `FAQPageSchema`,
`BreadcrumbListSchema`, `OrganizationSchema`, `LocalBusinessSchema`,
`VideoSchema`), plus the reactivity core: `effect`, `derived`,
`untrack`, `peek`, `tick`, `flushSync`, `on_destroy`, `createContext`.

Everything else (`Show`/`For`/`Switch`/`Match`, `Md`, `bindValue`/
`bindChecked`/`bindGroup`, `track`, …) needs an explicit import from
`@vesk/runtime`.

## Events

Any `on*` attribute attaches a handler on the client after hydration;
handlers are **excluded from SSR HTML entirely**. Handlers receive the
native DOM event:

```vsk
component SearchBox() {
	let &[q] = track("")

	return (
		<div>
			<input value={q} onInput={(e: any) => q.set(e.currentTarget.value)} />
			<button onClick={() => console.log('search', q)}>Go</button>
		</div>
	);
}
```

- Bubbling events use delegation; non-bubbling ones bind directly — both
  are automatic.
- Handler attributes never execute during SSR.

## Refs & direct DOM access

`ref={fn}` invokes `fn(element)` after the element is created on the
client; it is stripped from SSR:

```vsk
component Fld() client {
	let el: any = null
	return <input ref={(n: any) => { el = n }} />;
}
```

For browser-only APIs (`window`, timers, observers) combine islands with
effects and cleanups — see
[Client Boundary](../client-boundary/doc.md) and
[Reactivity](../../reactivity/doc.md).

## Composition

Components nest through normal imports; parents pass children explicitly,
and layouts receive them as `{props.children}`:

```vsk
import { TodoItem } from './TodoItem.vsk';
import type { Todo } from '../types';

component TodoList(props: { todos: Todo[] }) {
	if (props.todos.length === 0) {
		return <EmptyState />;
	}

	return (
		<div class="todo-list">
			{props.todos.map((todo) => (
				<TodoItem key={todo.id} todo={todo} />
			))}
		</div>
	);
}
```

Passing elements as props works in expression positions (ternaries,
`.map()` callbacks, component children). Literal JSX cannot appear inside
object literals or array literals — see
[Expression Mode](../expression-mode/doc.md).

## Async components

`async component` awaits during SSR and resolves on hydration (data
persists through reload):

```vsk
export async component Profile() {
	const user = await fetchUser();
	return <ProfileCard user={user} />;
}
```

Async children inside sync parents are supported — the compiler awaits
the subtree on both sides.

## Per-component styles + head

Components carry `<style>` CSS ([Styles](../styles/doc.md)) and declare
document metadata with `<Head>` ([Head](../head-metadata/doc.md)).

## Where to next

- [Body Modes](../body-modes/doc.md) — how to write bodies
- [Reactivity](../../reactivity/doc.md) — state, effects, context
- [Client Boundary](../client-boundary/doc.md) — islands
- [TypeScript](../typescript/doc.md) — typing `.vsk`

