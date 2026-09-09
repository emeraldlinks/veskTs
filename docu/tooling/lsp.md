# Language Server

`@vesk/lsp` provides Language Server Protocol support for `.vsk` files,
enabling editor features like autocomplete, diagnostics, and go-to-definition.

## Features

- **Syntax highlighting** — `.vsk` files are recognized as TypeScript
  superset with JSX/TSX grammar
- **Diagnostics** — compiler errors reported inline in the editor
- **Autocomplete** — context-aware completions for:
  - Component names
  - Auto-imported runtime APIs (`track`, `effect`, `derived`, etc.)
  - Props on known components
  - CSS class names (with Tailwind plugin)
- **Go to definition** — navigate to component/function definitions
- **Hover** — type information and documentation on hover
- **Find references** — locate all usages of a component or function

## Setup

### VS Code

The LSP is designed to work with the `.vsk` file extension. Add to your
`settings.json`:

```json
{
  "files.associations": {
    "*.vsk": "typescriptreact"
  }
}
```

### Neovim

A Neovim extension is available at `extension/vsk-neovim/`. See its
README for installation instructions.

### Other editors

Any editor with LSP support can connect to the `@vesk/lsp` server. The
server communicates via stdio using the standard LSP protocol.

## How it works

1. The LSP wraps the Vesk compiler's `vskToTsx` transform to convert
   `.vsk` files to standard TypeScript for editor consumption.
2. Diagnostics come from the same compiler pipeline used by
   `vesk typecheck`.
3. Auto-import suggestions come from the `VESK_BUILTINS` list in the
   compiler.
4. The LSP uses the same `tsconfig.json` resolution as `tsc`.

## Verified against

- `packages/lsp/` — language server implementation
- `packages/compiler/src/vsk-tsx.ts` — `.vsk` to TSX transform
