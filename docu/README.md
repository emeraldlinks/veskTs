# Vesk Documentation

Reference documentation for the Vesk framework — language, compiler,
runtime, and CLI. Written for three audiences: humans, AI agents, and
search engines. Every page carries a "Verified against:" footer naming
the source files and commit used to verify its claims.

## Language

- [component.md](language/component.md) — `component` declarations, `async`/`client` modifiers, generics
- [reactivity.md](language/reactivity.md) — `track()`, `&[]` destructure, derived/effect/untrack/peek, scheduler
- [statement-mode.md](language/statement-mode.md) — bare if/for/JSX-as-statement, key/index clauses, `empty {}`
- [expression-mode.md](language/expression-mode.md) — `return <jsx>`, `.map()`/ternary rules
- [client-boundary.md](language/client-boundary.md) — `client` islands, `{#client}`/`{#server}` blocks, block validation
- [styles.md](language/styles.md) — component-level `<style>` handling
- [not-in-the-grammar.md](language/not-in-the-grammar.md) — explicit non-features (no `batch`, no VDOM, no `suspense`, …)

## Compiler

- [pipeline-overview.md](compiler/pipeline-overview.md) — preprocess → parse → IR → dual codegen
- [ir-format.md](compiler/ir-format.md) — the IR node shape (`ir.ts`)
- [static-codegen.md](compiler/static-codegen.md) — `isStaticIR`, hydrate claim markers, static DOM
- [client-reachability.md](compiler/client-reachability.md) — `needsClient`, block validation, per-target stripping

## Runtime

- [reactive-core.md](runtime/reactive-core.md) — cell/effect semantics, microtask scheduler, block lifecycle
- [hydration.md](runtime/hydration.md) — `<!--vsk-->` markers, walker claiming, viewport/idle/interaction strategies
- [deployment-targets.md](runtime/deployment-targets.md) — node default, `--platform`, SSR output contract

## CLI

- [commands.md](cli/commands.md) — every `vesk` command, flags, config loading
- [plugin-api.md](cli/plugin-api.md) — the plugin contract and `@vesk/plugin-tailwind`

## Supporting docs

- `packages/cli/llms.txt` — machine-oriented reference for LLM agents
- ~~`docs/haul.md`~~ — native Go engine (parked on the `haul-parked` branch)
- `FEATURES.md` — internal feature inventory vs React/Qwik/Astro (not public docs)

## Glossary

- **Component** — `component Name() {}` unit of markup/state; body in
  expression or statement mode ([component.md](language/component.md)).
- **Island** — a `client` component that renders on both server and client
  ([client-boundary.md](language/client-boundary.md)).
- **Cell** — a `track()`-created reactive value
  ([reactivity.md](language/reactivity.md)).
- **Block** — runtime tree node for a component body/effect; unit of
  scheduling and teardown ([reactive-core.md](runtime/reactive-core.md)).
- **Statement mode / expression mode** — the two component body styles
  ([statement-mode.md](language/statement-mode.md),
  [expression-mode.md](language/expression-mode.md)).
- **Hydration** — attaching client behavior to server HTML via `vsk`
  markers ([hydration.md](runtime/hydration.md)).