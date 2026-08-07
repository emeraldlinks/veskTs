# extension/ — Documentation

> Editor extensions for `.vsk` files: VS Code (`vsk-vscode`) and Neovim (`vsk-neovim`).
> Both consume the bundled `@vesk/lsp` server.

## vsk-vscode

| File | Responsibility |
|---|---|
| `package.json` | Extension manifest: contributes `languages` (`.vsk`), `grammars`, `configuration`, `keybindings`; activation on `onLanguage:vsk`. |
| `src/extension.ts` | Extension entry: activates the LSP client, points at `lsp-server/index.mjs`. |
| `syntaxes/vsk.tmLanguage.json` | TextMate grammar for syntax highlighting. |
| `language-configuration.json` | Brackets, comments, folding, auto-closing for `.vsk`. |
| `lsp-server/index.mjs` | Prebuilt LSP client that spawns `vesk-lsp` (or uses the bundled server). |
| `.vscodeignore` | Packaging ignore rules. |
| `vesk-vscode-0.1.0.vsix` | Prebuilt extension package. |

## vsk-neovim

| File | Responsibility |
|---|---|
| `README.md` | Neovim plugin setup instructions. |
| `ftdetect/vsk.vim` | Filetype detection (`*.vsk` → `vsk`). |
| `ftplugin/vsk.lua` | Filetype plugin: LSP client attach, keymaps. |
| `plugin/vsk.vim` | Global plugin setup (LSP auto-attach, commands). |
| `syntax/vsk.vim` | Vim syntax file for `.vsk`. |
| `lsp-server/index.mjs` | Neovim LSP bridge (spawns/communicates with `vesk-lsp`). |
| `scripts/build-lsp.cjs` | Script to rebuild the LSP bundle for Neovim. |

## Common mistakes + fixes

| Mistake | Fix |
|---|---|
| LSP server not starting in VS Code | Ensure `vesk-lsp` is on PATH or the bundled `lsp-server/index.mjs` can resolve it. The prebuilt `.vsix` includes the bundled server. |
| No syntax highlighting | Check that `vsk.tmLanguage.json` is registered in the extension's `contributes.grammars`. |
| Neovim LSP not attaching | Verify `ftdetect/vsk.vim` is loaded and `lsp-server/index.mjs` points at a valid `vesk-lsp` binary. |

## Testing

Manual only — open a `.vsk` file in the editor and verify diagnostics, completions, hover, and formatting.
