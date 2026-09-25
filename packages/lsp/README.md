# @vesk/lsp

Vesk Language Server Protocol server for `.vsk` files. Provides completions, diagnostics, hover, go-to-definition, rename, semantic tokens, and formatting.

## Install

```sh
npm install @vesk/lsp
```

## Editor Setup

### VS Code

Install the `vesk-vscode` extension from the marketplace.

### Neovim

Use the bundled `vesk.nvim` plugin:

```lua
require('vesk').setup({})
```

The plugin starts `lsp-server/index.mjs` with `--stdio`, registers `.vsk`
filetype detection, and maps the standard LSP actions. It does not require a
separate `nvim-lspconfig` server definition.

## License

MIT
