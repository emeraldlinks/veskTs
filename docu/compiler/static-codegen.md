# Static Code Generation

The client codegen distinguishes fully-static subtrees from reactive ones
at compile time. Static subtrees are constructed once and never touched by
effects; reactive subtrees get per-cell DOM update wiring.

## `isStaticIR`

`isStaticIR(body)` (in `client-codegen.ts`) returns `true` only when every
node is a `StaticNode` or `TextNode` and no attribute binding is dynamic —
including event handlers:

```ts
function isStaticIR(body: IRNode[]): boolean {
  for (const node of body) {
    if (node instanceof StaticNode) {
      for (const child of node.children) {
        if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target) {
          return false;   // any dynamic attr, incl. on* handlers
        }
      }
      if (!isStaticIR(node.children)) return false;
    } else if (!(node instanceof TextNode)) {
      return false;
    }
  }
  return true;
}
```

- A component whose whole body is static (`isStaticComponent`) gets no
  effect wiring at all: its DOM is built once, synchronously.
- A component with a `<style>` block is never static.
- `MapRegion` counts as static only when both its template and alternate
  are static (checked in `server-render.ts`).

## Hydrate-mode markers

In hydrate mode the server emits `<!--vsk-->` markers before any subtree
that needs client JS:

```
subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children))
```

- Static subtrees: no marker, no client-side reconstruction — the server
  HTML is claimed as-is.
- Reactive subtrees: marker tells the client hydrator where to attach
  effects and per-cell update code.
- `forceClaim` forces a claim marker for a subtree even when it looks
  static (used for components that attach behavior elsewhere, e.g. event
  delegation).

## Server-side dynamic attributes

Because event attributes are stripped from SSR HTML, dynamic
non-event attributes are emitted as placeholders and rewritten at render
time:

```js
__out.push(openTag)   // <div class="">
// replaced per dynamic attr:
expr = expr.replace(' class=""', ' class="' + __escape(String(value)) + '"')
```

## Static props

Module-level `export const props = { ... }` (static data) is hoisted into
`IRRoot.staticProps` and re-emitted once, shared by server and client
outputs instead of being re-evaluated per component.

## Verified against

- `packages/compiler/src/client-codegen.ts` — `isStaticIR`,
  `isStaticComponent`, hydrate marker logic
- `packages/compiler/src/server-jsgen.ts` — `subtreeNeedsJS`, dynamic attr
  replacement
- `packages/compiler/src/server-render.ts` — MapRegion static check
- Commit `2a5b19d`