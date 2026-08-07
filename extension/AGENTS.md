# AGENTS.md — extension/

Module-specific rules for `extension/vsk-vscode` and `extension/vsk-neovim`. Extends repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **Keep the LSP bundle in sync.** Both extensions consume the same `vesk-lsp` server. After changing `packages/lsp/src/server.ts`, rebuild with `node scripts/build-lsp.js` and update BOTH `extension/vsk-vscode/lsp-server/index.mjs` AND `extension/vsk-neovim/lsp-server/index.mjs`.
2. **The LSP server is the single source of truth for language features.** Do not implement language logic (diagnostics, completions) in the editor extensions — delegate to the LSP server.
3. **TextMate grammar (`vsk.tmLanguage.json`) and Vim syntax (`syntax/vsk.vim`) must stay in sync** with the actual `.vsk` grammar (`component`, `&[]`, `client`, `{#client}`, etc.). If parser adds new syntax, update both grammars.

## Commands

```bash
# rebuild LSP bundle
node scripts/build-lsp.js

# package VS Code extension (requires vsce)
cd extension/vsk-vscode && npx vsce package
```

## File responsibility map

| File | Responsibility |
|---|---|
| `vsk-vscode/package.json` | VS Code manifest (languages, grammars, activation). |
| `vsk-vscode/src/extension.ts` | VS Code extension entry (LSP client activation). |
| `vsk-vscode/syntaxes/vsk.tmLanguage.json` | TextMate grammar for syntax highlighting. |
| `vsk-vscode/language-configuration.json` | Bracket pairs, comments, folding, auto-closing. |
| `vsk-vscode/lsp-server/index.mjs` | Prebuilt LSP client/server bundle. |
| `vsk-neovim/ftdetect/vsk.vim` | Filetype detection. |
| `vsk-neovim/ftplugin/vsk.lua` | LSP client attach + keymaps. |
| `vsk-neovim/plugin/vsk.vim` | Global autocmds/commands. |
| `vsk-neovim/syntax/vsk.vim` | Vim syntax highlighting. |
| `vsk-neovim/lsp-server/index.mjs` | Neovim LSP bridge. |
| `scripts/build-lsp.js` | Rollup bundle builder. |

## Do / Don't

**Do**
- Test both extensions against the latest LSP capabilities after any LSP change.
- Keep the bundled `index.mjs` files up to date.

**Don't**
- Don't add new editor-specific logic that duplicates LSP server behavior.
- Don't break the prebuilt `.vsix` without rebuilding.
