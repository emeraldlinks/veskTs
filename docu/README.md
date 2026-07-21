# Vesk Documentation

Reference documentation for the Vesk framework — language, compiler, runtime, and CLI.

## Language

- [component.md](language/component.md) — component declarations, async/client modifiers
- [reactivity.md](language/reactivity.md) — `track()`, `&[]` destructure
- [statement-mode.md](language/statement-mode.md) — bare if/for/JSX-as-statement rules
- [expression-mode.md](language/expression-mode.md) — `return <jsx>`, .map()/ternary rules
- [client-boundary.md](language/client-boundary.md) — `client` keyword, server-only-by-default
- [defer.md](language/defer.md) — streaming boundaries
- [styles.md](language/styles.md) — component-level style scoping
- [not-in-the-grammar.md](language/not-in-the-grammar.md) — explicit non-features

## Compiler

- [pipeline-overview.md](compiler/pipeline-overview.md) — lexer → parser → semantic → IR → codegen
- [ir-format.md](compiler/ir-format.md) — the actual IR shape
- [static-codegen.md](compiler/static-codegen.md) — how Future-A static DOM patching works
- [client-reachability.md](compiler/client-reachability.md) — how the compiler traces client/server boundary

## Runtime

- [reactive-core.md](runtime/reactive-core.md) — track() runtime semantics, batching, derived values
- [hydration.md](runtime/hydration.md) — server-to-client handoff
- [deployment-targets.md](runtime/deployment-targets.md) — Node-standard server by default

## CLI

- [commands.md](cli/commands.md) — every `vesk` CLI command
- [vite-adapter.md](cli/vite-adapter.md) — how vite-plugin-vesk works
