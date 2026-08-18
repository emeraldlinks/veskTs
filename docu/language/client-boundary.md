# Client Boundary & Islands

Vesk is server-first by default: components render to HTML on the server,
and interactivity is attached on the client through hydration. The
`client` keyword and `{#client}`/`{#server}` blocks define the boundary
explicitly.

## Server-only by default

A plain component renders on the server. Its event handlers and tracked
state hydrate on the client:

```vsk
component Counter {
  let &[count] = track(0);
  return <button onClick={() => count++}>{count}</button>;
}
```

Event-handler attributes (`on*`) are **excluded from the SSR HTML entirely**
— the server output carries the markup, the client bundle attaches behavior.

## Islands: the `client` keyword

Marking a component `client` makes it an island: it renders on **both**
server and client.

```vsk
component Clock() client {
  let &[now] = track(new Date());
  effect(() => { /* interval etc. */ });
  return <time>{now.toLocaleTimeString()}</time>;
}
```

- The modifier goes after the params: `component X() client { ... }`
  (also accepted directly after `component`).
- `client` composes with `export` and `async`:
  `export component X() client`, `export default async component X() client`.
- Non-client components have `client: false` — the island flag is part of
  the `ComponentDeclaration` AST node.

## `{#client}` / `{#server}` blocks

Inside a component body, scoped blocks split server vs client markup.
**Which blocks a component may use depends on its own kind** (the compiler
validates this per component):

| Component kind | `{#server}` | `{#client}` |
| --- | --- | --- |
| Server component (default) | allowed | **error** (`clientBlockInServer`) |
| `client` island | **error** (`serverBlockInClient`) | allowed |

| Block | Server SSR | Client bundle |
| --- | --- | --- |
| `{#server}` | rendered | stripped |
| `{#client}` | stripped | rendered |

```vsk
component Robots() {
  {#server}
    <meta name="robots" content="noindex" />
  {/server}

  <p>Always rendered.</p>
}

component ClientOnly() client {
  {#client}
    <p>This markup only hydrates on the client.</p>
  {/client}

  <p>Also always rendered.</p>
}
```

- `ServerBlock` IR renders in SSR and returns nothing in the client bundle.
- `ClientBlock` IR returns `''` in SSR and renders in the client bundle.
- Blocks nest and accept full statement-mode bodies (bare JSX, loops, etc.).

## The `#` form

The same blocks are also accepted with the `#` prefix as statements:
`#server { ... }` and `#client { ... }` parse to the identical `VeskBlock`
node.

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — `client` modifier,
  `VeskBlock` parsing (`{#server}`/`{#client}`/`#server`/`#client`)
- `packages/compiler/src/ir-generator.ts` — `ServerBlock`/`ClientBlock` IR,
  `validateBlocks` (per-kind block validation)
- `packages/compiler/src/server-jsgen.ts` — `ClientBlock` → `''`
- `packages/compiler/src/client-codegen.ts` — `ServerBlock` → `null`
- Commit `2a5b19d`