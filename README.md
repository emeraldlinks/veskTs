# Vesk

Compiler-first framework for the post-VDOM web.

## Quick Start

```sh
npx create-vesk my-app
cd my-app
npm install
npm run dev
```

## Packages

| Package | Description |
|---------|-------------|
| [`vesk`](packages/cli) | CLI — `vesk dev`, `vesk build`, `vesk start`, `haul dev`, `haul build` |
| [`@vesk/compiler`](packages/compiler) | Lexer, parser, semantic analysis, IR, codegen for `.vsk` |
| [`@vesk/runtime`](packages/runtime) | Reactivity, blocks, DOM, hydration, routing, server APIs |
| [`@vesk/adapter`](packages/adapter) | Build output for Deno/Node, dev server, HMR, SSR |
| [`@vesk/lsp`](packages/lsp) | Language server for `.vsk` files |
| [`@vesk/prettier-plugin`](packages/prettier-plugin) | Prettier formatter for `.vsk` |
| [`@vesk/plugin-tailwind`](packages/plugin-tailwind) | Tailwind CSS v4 integration |
| [`create-vesk`](packages/create-vesk) | Project scaffolding |

## Architecture

```
User runs "vesk dev"  →  packages/cli (pure JS, uses @vesk/adapter + @vesk/compiler + @vesk/runtime)
User runs "haul dev"  →  packages/cli/bin/haul.js (Node shim) → Go native binary → Node.js sidecar (JSON-RPC to @vesk/compiler)
```

## Development

```sh
npm install                    # Install all workspace dependencies
npx tsx packages/cli/src/build-packages.ts   # Build compiler + runtime
node scripts/test.js           # Full test suite
```

## License

MIT
