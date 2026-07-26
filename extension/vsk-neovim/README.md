# vesk.nvim

Vesk language support for Neovim — full syntax highlighting and LSP integration.

## Features

- **Syntax highlighting**: Components, JSX, `<style>` blocks, reactive `&[...]`, imports, type annotations, comments, strings, numbers, Vesk intrinsics (`track`, `effect`, `Link`, `Outlet`, etc.)
- **LSP client**: Completion, hover, go-to-definition, references, rename, document/workspace symbols, code actions, formatting, organize imports, diagnostics, semantic tokens, color picker
- **Filetype detection**: `.vsk` files auto-detected as `vsk`
- **Keymaps**: `gd`, `K`, `gr`, `gR`, `<leader>ca`, `<leader>f`, `<leader>oi`, etc.

## Installation

### lazy.nvim

```lua
-- From the vesk monorepo (development)
{
  dir = "/path/to/vesk/extension/vsk-neovim",
  build = "node scripts/build-lsp.js",
  opts = {},
}

-- Standalone (when cloned directly)
{
  url = "https://github.com/vesk/vesk.nvim",
  build = "node scripts/build-lsp.js",
  opts = {},
}
```

### vim-plug

```vim
Plug '/path/to/vesk/extension/vsk-neovim'
```

## Configuration

```lua
require("vesk").setup({
  -- Optional: point to a custom LSP server path
  cmd = { "node", "/custom/path/to/index.mjs" },

  -- LSP client capabilities (merged with defaults)
  capabilities = {},

  -- LSP settings passed to the server
  settings = {},

  -- Keymaps. Set to false to disable all, or a table to selectively disable:
  -- { definition = false, hover = false }
  keymaps = {},

  -- {none} disables all defaults
  keymaps = false,
})
```

### With nvim-cmp

```lua
require("cmp").setup({
  sources = {
    { name = "nvim_lsp", group_index = 2 },
  },
})
```

## Building the LSP server

The LSP server must be built before use:

```bash
cd /path/to/vesk
node scripts/build-lsp.js
```

This produces `extension/vsk-vscode/lsp-server/index.mjs`.
