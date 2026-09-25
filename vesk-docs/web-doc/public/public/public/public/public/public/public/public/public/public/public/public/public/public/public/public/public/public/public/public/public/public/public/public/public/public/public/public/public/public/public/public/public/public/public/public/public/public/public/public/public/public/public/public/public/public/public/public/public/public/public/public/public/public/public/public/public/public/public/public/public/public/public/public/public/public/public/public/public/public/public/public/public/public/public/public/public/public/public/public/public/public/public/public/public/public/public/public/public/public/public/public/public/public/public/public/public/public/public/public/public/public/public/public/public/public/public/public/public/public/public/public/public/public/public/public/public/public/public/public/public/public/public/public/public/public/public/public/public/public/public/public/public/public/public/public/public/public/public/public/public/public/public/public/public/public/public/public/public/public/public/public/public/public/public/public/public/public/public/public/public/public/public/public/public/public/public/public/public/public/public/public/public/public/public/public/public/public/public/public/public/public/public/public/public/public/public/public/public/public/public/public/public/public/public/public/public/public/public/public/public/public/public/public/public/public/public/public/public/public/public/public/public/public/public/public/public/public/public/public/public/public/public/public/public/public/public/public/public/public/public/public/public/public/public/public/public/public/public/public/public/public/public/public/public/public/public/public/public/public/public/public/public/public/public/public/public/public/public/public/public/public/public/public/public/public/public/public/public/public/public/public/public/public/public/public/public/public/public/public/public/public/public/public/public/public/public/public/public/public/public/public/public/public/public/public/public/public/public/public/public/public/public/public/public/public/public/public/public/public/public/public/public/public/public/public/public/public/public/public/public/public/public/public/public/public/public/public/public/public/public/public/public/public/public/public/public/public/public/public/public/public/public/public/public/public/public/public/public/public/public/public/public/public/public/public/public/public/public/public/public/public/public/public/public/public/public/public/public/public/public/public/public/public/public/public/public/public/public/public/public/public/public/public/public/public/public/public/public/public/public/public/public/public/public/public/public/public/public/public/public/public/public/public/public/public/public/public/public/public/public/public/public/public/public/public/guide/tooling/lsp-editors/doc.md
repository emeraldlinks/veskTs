# Language Server & Editors

`.vsk` is a custom language, but editing it should feel like editing
TypeScript. The Vesk language server (LSP) powers completions, hover
docs, go-to-definition, diagnostics and formatting inside components —
for VS Code via a bundled extension, and for Neovim through a dedicated
plugin or lspconfig.

## VS Code

Install the **Vesk Language Support** extension (`vesk-vscode`, current
0.3.x — prebuilt `.vsix` under `extension/vsk-vscode/`). It activates on
`vsk` files and bundles the Volar-based LSP server.

Extension settings:

| Setting | Default | Description |
| --- | --- | --- |
| `vesk.tailwind.completion` | `true` | Tailwind class completions |
| `vesk.autoCloseTags` | `true` | Quote/brace-aware tag autoclose (closes component tags, declines generics/comparisons) |
| `vesk.emmet` | `true` | Emmet for `.vsk` (via `emmet.includeLanguages`) |
| `vesk.lsp.trace.server` | `off` | LSP communication tracing |

Command: **Vesk: Restart Language Server**.

## What the LSP provides

- **Diagnostics**: parse errors (`vesk-parse-error`, last-good virtual
  code retained), TS diagnostics through the embedded typechecker,
  markdown raw-HTML advisories (`vesk-md-html`)
- **Completions**: context-aware — HTML elements/intrinsics, your
  components, props, event handlers, reactive bindings; real CSS inside
  `<style>` blocks; Tailwind classes
- **Hover**: merged TypeScript + Vesk overlays — reactive-binding markers,
  element docs, event-handler docs, inferred component props, effective
  markdown HTML policy on `<Md`
- **Go-to-definition / find references / rename** across files
- **Document & workspace symbols**
- **Semantic tokens** (8 types, 4 modifiers)
- **Formatting** via the official Prettier plugin
- **Signature help**, folding ranges, document links, CSS color provider,
  code actions (organize imports)

The virtual code is TypeScriptReact, so all vanilla TS tooling gates work
inside `.vsk`.

## Neovim

Two options:

### vesk.nvim plugin

```lua
-- lazy.nvim
{
	dir = "~/path/to/extension/vsk-neovim",
	build = "node scripts/build-lsp.js",
	ft = "vsk",
	config = function()
		require("vesk").setup({
			-- cmd?, capabilities?, settings?, keymaps?
		})
	end,
}
```

Includes syntax highlighting, filetype detection, LSP client with `gd`,
`K`, `gr`, `gR` and leader-keymaps.

### nvim-lspconfig

```lua
require('lspconfig').vesk_ls.setup{}
```

Both share the bundled `lsp-server/index.mjs` built by
`scripts/build-lsp.js`.

## Standalone server

`@vesk/lsp` ships binary `vesk-lsp` and a fully bundled ESM server
(`dist/server.mjs`, ~1 MB, zero runtime deps) usable from any LSP-capable
editor. Debug with `VESK_LSP_DEBUG=1`.
