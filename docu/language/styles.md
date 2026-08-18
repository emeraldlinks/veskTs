# Styles

Components carry their own CSS in a `<style>` element. The compiler
extracts the element from the body and hoists it to component level.

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

The `<style>` element may appear anywhere in the body, in either body mode.
Its raw text content (between `<style>` and `</style>`) is captured as the
component's CSS.

## How it is compiled

- The IR generator removes `<style>` nodes from the render body and stores
  their text as the component's `style` property (`extractStyle` in
  `ir-generator.ts`).
- Server output emits a literal `<style>...</style>` block with the raw CSS.
- Client output creates a `<style>` element keyed by the component's
  identifier and appends it to `document.head`.
- An unclosed `<style>` is a parse error: "Unclosed `<style>` element:
  missing `</style>`".

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — `parseStyleElement`
- `packages/compiler/src/ir-generator.ts` — `extractStyle`
- `packages/compiler/src/server-jsgen.ts` — `<style>` SSR emission
- `packages/compiler/src/client-codegen.ts` — client `<style>` creation
- Commit `2a5b19d`