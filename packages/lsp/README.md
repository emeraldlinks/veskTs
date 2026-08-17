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

Use `nvim-lspconfig`:

```lua
require('lspconfig').vesk_ls.setup{}
```

## License

MIT
