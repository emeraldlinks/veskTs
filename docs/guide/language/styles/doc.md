# Styles

Styling in Vesk stays next to the markup it styles. Drop a `<style>`
element inside a component and its CSS ships with that component —
included in the server HTML and injected into the page when the component
appears during client-side navigation. App-wide styles live in one global
file, and Tailwind works out of the box.

Components carry their own CSS in a `<style>` element; the compiler
extracts it and hoists it to component level.

## Syntax

```vsk
component Card(props: { title: string }) {
	<div class="card">
		<h2>{props.title}</h2>
	</div>

	<style>
		.card { border: 1px solid #ccc; padding: 8px; }
		.card h2 { margin: 0; }
	</style>
}
```

- The `<style>` element may appear anywhere in the body, in either body
  mode.
- An unclosed `<style>` is a parse error:
  *"Unclosed `<style>` element: missing `</style>`"*.

## How it compiles

1. The IR generator removes `<style>` nodes from the render body and
   stores their raw text as the component's `style` property.
2. **Server output** emits a literal `<style>…</style>` block with the CSS.
3. **Client output** creates a `<style>` element keyed by the component's
   identifier and appends it to `document.head` — so SPA-navigated
   components bring their styles with them.

## Global CSS

For app-wide styles use `src/global.css` (created by `vesk init`). It is:

- copied into the build as `static/global.css` and linked from SSR HTML,
- watched and rebuilt by the dev server,
- processed by `@vesk/plugin-tailwind` when configured (see
  [Plugins](../../plugins/doc.md)).

## Tailwind

The official Tailwind v4 integration compiles your entry CSS against class
candidates scanned from `.vsk`/`.js`/`.ts`/`.jsx`/`.tsx` files:

```ts
// vesk.config.ts
import tailwindcss from '@vesk/plugin-tailwind';

export default defineConfig({
	plugins: [tailwindcss({ entry: 'src/global.css', appDir: 'app' })],
});
```

```css
/* src/global.css */
@import 'tailwindcss';
```

```vsk
component Badge {
	<span class="rounded-full bg-indigo-500 px-2 py-0.5 text-xs">new</span>
}
```

Note: dynamic class bindings (`class={expr}`) are not scanned — keep a
static occurrence of any conditionally used class somewhere in source, or
use Tailwind's `safelist`.
