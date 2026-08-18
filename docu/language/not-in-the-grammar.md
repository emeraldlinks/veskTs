# Not in the Grammar

Explicit non-features. Vesk is a TypeScript superset — everything listed
here is intentionally absent today, and the absence is a contract: code
relying on any of these will not compile.

## Language

- **No `defer` / streaming boundaries.** There is no deferred-rendering or
  streaming-boundary directive in the grammar or IR. SSR output is
  generated as a static template per component; only HMR internals use an
  async page render.
- **No `class` declarations in component bodies.** `class Foo {}` inside a
  component body raises a compiler error; components are markup/state units,
  not class containers.
- **No adjacent top-level JSX.** Two sibling elements at the top of a
  component body must be wrapped in a fragment (`<><A /><B /></>`) or a
  parent element. The parser raises:
  "Adjacent JSX elements must be wrapped in an enclosing tag. Wrap them in
  a fragment: `<>...` or a single parent element."
- **`component` is reserved.** It cannot be used as an identifier anywhere
  in a `.vsk` file.
- **No `suspense` implementation.** The runtime's `suspense.ts` exports
  nothing; use the `if (loading)` + `createResource` pattern instead.

## Reactivity

- **No `batch`.** `batch` does not exist in the runtime. Synchronous
  multi-write flushes use `flushSync(fn)`; the default scheduler is
  microtask-batched.
- **No React hooks.** `useState`, `useEffect`, `useMemo` are not part of
  the runtime; the equivalents are `track()`, `effect()`, `derived()`.
- **No virtual DOM.** Updates compile to per-cell DOM mutations; there is
  no reconciliation tree at runtime.

## Runtime surface

- **`packages/runtime/src/track.ts` is dead code.** It ships a legacy
  `Cell`/`Effect` API and is not part of the runtime barrels. Never import
  it; the active API lives in `ripple-runtime.ts` / `ripple-blocks.ts`.
- **Server vs client exports are split.** Server-only APIs (`cookies`,
  `headers`, `isr`, request/response types) are not in the client bundle;
  client-only APIs (`hydrate`, `bindings`, `reconcile`) are not in the
  server bundle.

## Tooling

- **No `vite-plugin-vesk`.** There is no Vite adapter; `vesk dev` /
  `vesk build` are the build entry points. Tailwind integration ships as
  `@vesk/plugin-tailwind`.
- **No `batch` import from `@vesk/runtime`** (see above) — the barrel does
  not export it.

## Verified against

- `packages/compiler/src/vesk-plugin.ts` — adjacent-JSX error, reserved
  `component`
- `packages/compiler/src/ir-generator.ts` — `classDecl` error
- `packages/runtime/src/ripple-runtime.ts`, `ripple-blocks.ts`,
  `index-client.ts`, `index-server.ts` — export surface
- `packages/runtime/src/suspense.ts` — no exports
- Commit `2a5b19d`