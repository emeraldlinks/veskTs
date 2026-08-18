# Client Reachability (the client/server boundary in the compiler)

"Client reachability" is the compiler's answer to: does this component
need to exist on the client at all, and which parts of its body belong to
which side? It is decided at compile time by three mechanisms.

## 1. Per-component island flag

`needsClient` decides whether the module produces a client bundle at all:

```ts
const needsClient = ir.components.some((c) => c.isClient || !isStaticComponent(c));
```

- A component marked `client` (island) always needs client code — it
  renders on both server and client.
- A non-client component needs client code only when its body is not
  fully static (reactive content, `on*` handlers, effects, bindings).
- A module where every component is static and non-client compiles to an
  empty client bundle (`compileClient` returns `''` unless
  `forceClient: true`).

## 2. Per-block validation

`validateBlocks(compName, isClient, body)` in the IR generator enforces
the boundary statically, per component kind:

- `client` component containing `{#server}` → `serverBlockInClient` error
- server component containing `{#client}` → `clientBlockInServer` error

The check recurses through `StaticNode`, `ServerBlock`, and `ClientBlock`
children, so the rules apply at any nesting depth.

## 3. Per-target stripping in codegen

The same IR node means opposite things on each side:

| Node | Server codegen | Client codegen |
| --- | --- | --- |
| `ServerBlock` (`{#server}`) | rendered | `null` (dropped) |
| `ClientBlock` (`{#client}`) | `''` (dropped) | rendered |

## What the client bundle contains

`packages/adapter/src/client-bundle.ts` builds the browser bundle from the
runtime's `index-client.js` barrel (tree-shaken to the names actually
used), plus hydration entry points: `hydrate`, `hydrateViewport`,
`hydrateIdle`, `hydrateOnInteraction`, `needsHydration`,
`createHydrateWalker`, `collectVskMarkers`, `reactiveProps`.

In code-split mode, the bundle is split into per-route
`page-<name>.js` chunks (pages, layouts, error/not-found/loading files
compile into their chunk).

## Verified against

- `packages/compiler/src/client-codegen.ts` — `needsClient`,
  `compileClient` options (`forceClient`, `hydrate`, `includeTopLevel`)
- `packages/compiler/src/ir-generator.ts` — `validateBlocks`
- `packages/compiler/src/server-jsgen.ts` / `client-codegen.ts` — block
  stripping
- `packages/adapter/src/client-bundle.ts` — bundle assembly + chunks
- Commit `2a5b19d`