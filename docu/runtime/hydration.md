# Hydration

Hydration attaches client behavior (event handlers, effects, tracked
bindings) to server-rendered HTML. The server marks the parts of the DOM
that need client JS; the client hydrator walks those markers and claims
the existing DOM instead of rebuilding it.

## Server side

The server codegen emits `<!--vsk-->` comment markers before any subtree
that needs client JS:

```js
subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children))
```

- Fully static subtrees (only `StaticNode`/`TextNode`, no dynamic
  attributes, no `on*`) get no marker and no client-side reconstruction.
- Reactive subtrees get a marker; the hydrator claims them in place.
- Event-handler attributes are excluded from the SSR HTML entirely — the
  client bundle attaches them.

## Client side

All hydration entry points live in `packages/runtime/src/hydrate.ts` and
share a common shape:

```
componentFn(props, registry, walker) -> unknown
```

`componentFn` is the compiled client component code; the `HydrateWalker`
iterates the server DOM and **claims** elements — `nextElement(tag?)`
returns the next matching server-rendered element (removing stray text
nodes), or `document.createElement(tag)` when the server didn't render
one (e.g. inside `{#client}` blocks).

| Entry | Behavior |
| --- | --- |
| `hydrate(container, fn, props)` | Hydrate everything immediately |
| `hydrateViewport(container, fn, props, rootMargin=500)` | Hydrate visible markers now; mark the rest `vsk-hold` and hydrate via `IntersectionObserver` as they scroll into view (waits for `window.load` if the document isn't complete) |
| `hydrateIdle(container, fn, props, {chunkSize=10, timeout=3000})` | Hydrate in chunks via `requestIdleCallback`; returns `{ cancel() }` |
| `hydrateOnInteraction(container, fn, props, {events=['click','touchstart','focus','mouseenter']})` | Hydrate on the first listed event; returns `{ cancel(), hydrateNow() }` |
| `hydrateInitial(container, fn, props)` | Hydrate with a fresh walker (no marker list) |
| `needsHydration(container)` | `true` when the container still contains `vsk` markers |
| `hydrationCount(container)` | Number of unhydrated `vsk` markers |

Markers use comment text: `vsk` (needs hydration), `vsk-hold`
(deferred by viewport hydration). `collectVskMarkers(container)` returns
the `vsk` comments in document order; `createHydrateWalker(container,
markerList?)` walks from those markers or from the container.

## Props

`reactiveProps(props)` returns a proxy that makes server-rendered prop
values reactive on the client, so mutations propagate through the same
tracked-cell machinery.

## Verified against

- `packages/runtime/src/hydrate.ts` — all exported entry points
- `packages/compiler/src/server-jsgen.ts` — `<!--vsk-->` marker emission
- `packages/compiler/src/client-codegen.ts` — `isStaticIR`, hydrate mode
- Commit `2a5b19d`