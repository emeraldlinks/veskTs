# AGENTS.md — @vesk/lsp

Module-specific agent rules for `packages/lsp/src/server.ts`. Extends repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **Keep the `onInitialize` capabilities array in sync with implemented handlers.** Clients (VS Code, Neovim) enable features based on this object; registering a handler without declaring the capability means the client will never call it.
2. **The bundled server input path is hardcoded.** `scripts/build-lsp.js` points at `/home/joe/vesk/packages/lsp/src/server.ts`. If the repo is checked out elsewhere, update that path before bundling.
3. **The LSP server does not import `@vesk/runtime`.** It depends only on `@vesk/compiler` for parsing and scanning. Do not add runtime imports — the server runs in a Node process, not in the browser, and must stay lightweight.
4. **Diagnostics must not crash the server.** `validateDocument` wraps `parse(source)` in try/catch; any new validation must also guard against unparsable input.
5. **Keep the `./src/*` exports alias working** if you add new source files that tests or tooling import by path.

## Commands

```bash
cd /root/vesk/packages/lsp
npx tsc --noEmit                            # typecheck
npm run build                               # tsc → dist/
node scripts/build-lsp.js                   # rollup bundle for editor extensions
node packages/lsp/dist/server.js            # run stdio LSP server manually
```

## File responsibility map

| File | Responsibility |
|---|---|
| `src/server.ts` | **Everything** — LSP handlers, project index, diagnostics, completions, hover, definitions, references, rename, folding, formatting, color, semantic tokens, code actions, on-type formatting. |
| `scripts/build-lsp.js` | Rollup bundle for editor extensions. |
| `package.json` | Dependencies (`vscode-languageserver`, `vscode-languageserver-textdocument`, `@vesk/compiler`). |

## Do / Don't

**Do**
- Register every new capability in `onInitialize`.
- Use the `ProjectIndex` (not re-scanning on every request) for performance.
- Guard regex/text analysis against unparsable documents.

**Don't**
- Don't import `@vesk/runtime` into the LSP server.
- Don't change the `textDocumentSync` kind without coordinating with the editor extensions.
- Don't add heavy computation to hover/completion without caching — these are called on every keystroke.
