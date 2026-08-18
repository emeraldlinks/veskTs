# Vesk

Compiler-first framework for the post-VDOM web. `.vsk` is a TypeScript
superset with `component` declarations, `track()` reactivity, islands,
and compile-time static DOM — no virtual DOM, no hydration runtime for
static subtrees.

## Quick Start

```sh
npx create-vesk my-app
cd my-app
npm install
npm run dev
```

## Documentation

- [docu/](docu/) — language, compiler, runtime, and CLI reference
  (human + agent + SEO oriented, each page verified against source)
- [packages/cli/llms.txt](packages/cli/llms.txt) — machine-oriented CLI reference
- [docs/haul.md](docs/haul.md) — the native Go haul engine

## Packages

| Package | Description |
|---------|-------------|
| [`vesk`](packages/cli) | CLI — `vesk dev`, `vesk build`, `vesk start`, `vesk typecheck`, `vesk seo` |
| [`@vesk/compiler`](packages/compiler) | Preprocess, parser, IR, server/client codegen for `.vsk` |
| [`@vesk/runtime`](packages/runtime) | Reactivity (tracked cells), blocks, DOM, hydration, router, server APIs |
| [`@vesk/adapter`](packages/adapter) | Build output for Node/Deno/etc., dev server, HMR, SSR function |
| [`@vesk/lsp`](packages/lsp) | Language server for `.vsk` files |
| [`@vesk/prettier-plugin`](packages/prettier-plugin) | Prettier formatter for `.vsk` |
| [`@vesk/plugin-tailwind`](packages/plugin-tailwind) | Tailwind CSS v4 integration |
| [`create-vesk`](packages/create-vesk) | Project scaffolding |

## Architecture

```
User runs "vesk dev"  →  packages/cli (pure JS, uses @vesk/adapter + @vesk/compiler + @vesk/runtime)
User runs "haul dev"  →  packages/cli/bin/haul.js (Node shim) → Go native binary → Node.js sidecar (JSON-RPC to @vesk/compiler)
```

The compiler pipeline: `preprocessForClauses` → acorn + acorn-ts-plugin +
VeskPlugin parse → IR (`ir.ts`) → server codegen (SSR HTML) and client
codegen (real DOM + hydration), from one shared IR.

## Development

```sh
npm install                    # Install all workspace dependencies
npx tsx packages/cli/src/build-packages.ts   # Build compiler + runtime
node scripts/test.js           # Full test suite
```

## License

MIT