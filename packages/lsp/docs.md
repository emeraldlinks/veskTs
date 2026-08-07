# @vesk/lsp — Documentation

> **Vesk Language Server Protocol server** for `.vsk` files. Lives in `packages/lsp/src/server.ts`
> (1,998 LOC). Bundled to a single ESM file (~1MB) for the VS Code and Neovim extensions.

- **Language:** TypeScript (ESM)
- **Dependencies:** `@vesk/compiler`, `vscode-languageserver`, `vscode-languageserver-textdocument`
- **Version:** 0.1.0
- **Binary:** `vesk-lsp` → `dist/server.js`

## Architecture

The server maintains a **project index** (`ProjectIndex`) of all workspace files:

```ts
interface ProjectIndex {
  workspaceRoot: string;
  appDir: string | null;
  baseUrl: string;
  pathAliases: PathAlias[];
  files: Map<string, ProjectFile>;          // uri → { exports, components, declarations, lastModified }
  componentSources: Map<string, string>;    // componentName → sourcePath
  tailwindClasses: Set<string>;
}
```

On `initialize`, it scans the workspace root via `scanProject` (uses `@vesk/compiler`'s `scanRoutes`, `scanComponents`, `collectSources`). On file change/create/delete, the index is updated incrementally.

All LSP handlers read from this index + the live `TextDocument` (via `vscode-languageserver-textdocument`).

## Implemented capabilities (verbatim from `onInitialize`)

| Capability | Value |
|---|---|
| `textDocumentSync` | `Incremental` |
| `completionProvider` | `{ triggerCharacters: ['<','{','/','.',' ','"',"'",'`','c','e','i','l','f','w','t','s','&',':','-'], resolveProvider: true }` |
| `hoverProvider` | `true` |
| `documentSymbolProvider` | `true` |
| `workspaceSymbolProvider` | `true` |
| `semanticTokensProvider` | `{ legend: { tokenTypes: ['component','reactive','keyword','function','variable','property','type','event'], tokenModifiers: ['declaration','definition','readonly','async'] }, full: true }` |
| `foldingRangeProvider` | `true` |
| `definitionProvider` | `true` |
| `referencesProvider` | `true` |
| `renameProvider` | `{ prepareProvider: true }` |
| `documentHighlightProvider` | `true` |
| `signatureHelpProvider` | `{ triggerCharacters: ['(', ','] }` |
| `documentFormattingProvider` | `true` |
| `documentRangeFormattingProvider` | `true` |
| `documentOnTypeFormattingProvider` | `{ firstTriggerCharacter: '>', moreTriggerCharacter: ['/', '\n'] }` |
| `colorProvider` | `true` |
| `documentLinkProvider` | `{ resolveProvider: false }` |
| `codeActionProvider` | `{ codeActionKinds: [CodeActionKind.QuickFix] }` |
| `workspace.fileOperations.didCreate` | `**/*.{vsk,ts,tsx,js,jsx}` |
| `workspace.fileOperations.didDelete` | `**/*.{vsk,ts,tsx,js,jsx}` |

## Registered handlers

| Handler | Line | What it does |
|---|---|---|
| `onInitialize` | 809 | Scans workspace, returns capabilities above. |
| `onDidChangeWatchedFiles` | 861 | Incremental project index update on file create/delete/change. |
| `onDidChangeContent` | 884 | Triggers `validateDocument` → parse errors + Vesk-specific diagnostics. |
| `onCompletion` | 1028 | Context-aware completions (imports, components, props, keywords, Tailwind classes). |
| `onCompletionResolve` | 1201 | Resolves completion item details (doc strings, kind). |
| `onHover` | 1207 | Hover info for components, tracked vars, imports. |
| `onDefinition` | 1275 | Go-to-definition for components, imports, exports. |
| `onReferences` | 1352 | Find references for components, imports. |
| `onDocumentHighlight` | 1383 | Highlights symbol occurrences. |
| `onPrepareRename` | 1416 | Validates rename range. |
| `onRenameRequest` | 1424 | Renames components/exports across the project. |
| `onDocumentSymbol` | 1471 | Document symbols (components, functions, imports). |
| `onWorkspaceSymbol` | 1518 | Workspace-wide symbol search. |
| `onFoldingRanges` | 1551 | Folding ranges (components, blocks, imports). |
| `onDocumentLinks` | 1595 | Import path links. |
| `onSignatureHelp` | 1717 | Signature help for function calls + component props. |
| `onCodeAction` | 1760 | Quick fixes for parse errors, undefined components, etc. |
| `onDocumentFormatting` | 1860 | Formatting (basic indent fix). |
| `onDocumentRangeFormatting` | 1869 | Range formatting. |
| `onDocumentColor` | 1917 | Color provider for `<style>` blocks (hex, rgb, rgba, hsl + named colors). |
| `onColorPresentation` | 1960 | Color format conversions. |
| `onDocumentOnTypeFormatting` | 1973 | Auto-close JSX tags when typing `>`. |
| `semanticTokens.on` | 1637 | Semantic token highlighting (component, reactive, keyword, etc.). |

## Usage

The LSP server is consumed by:
- `extension/vsk-vscode/lsp-server/index.mjs` — VS Code extension (prebuilt bundle + source mode).
- `extension/vsk-neovim/lsp-server/index.mjs` — Neovim LSP bridge.

Build the bundle:
```bash
node scripts/build-lsp.js   # rollup → single ESM file
```

Run standalone:
```bash
node packages/lsp/dist/server.js   # stdio LSP server
```

## Testing

There is no unit test suite in `packages/lsp/src/`. Validation is manual via the editor extensions or by running the bundled server against a test workspace.

```bash
npx tsc --noEmit -p packages/lsp/tsconfig.json
```
