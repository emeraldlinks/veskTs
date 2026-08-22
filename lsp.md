# LSP / VSCode Extension Work — Status

> State as of this session. Goal: fix the Vesk VSCode extension so that
> tag auto-close, HTML element completion (`<div`), emmet abbreviations, and
> correct diagnostics (no false "Cannot find name 'Error'") all work in `.vsk`
> files.

## What was done so far

### 1. Root-cause analysis (verified with probes in `/tmp/opencode/lsp-probe/`)
- **Lib d.ts resolution broken**: `scripts/build-lsp.js` defines module-scope
  `__filename = fileURLToPath(import.meta.url)` (bundle line 29), so bundled
  TS's default lib path resolves to `<repo>/extension/vsk-vscode/lsp-server/lib.*.d.ts`
  which does not exist → no ES/DOM libs → TS2304 for `Error`, `console`, etc.
- **Auto-close dead client-side**: vanilla `vscode-languageclient` never sends
  Volar's custom request `volar/client/autoInsert`. The extension must send it
  itself on `onDidChangeTextDocument`.
- **Old auto-insert plugin broken**: exact-key mapping lookup + a scanner that
  aborted on any `"` (so tags with attributes never closed).
- **Junk completions mid-typing**: `compileVskCodegen` returns `{ errors: [...], code: string }`
  even on parse errors; old update() logic treated "typeof code === 'string'"
  as success and served partial garbage.
- **Competing auto-insert provider**: `volar-service-typescript`'s
  `typescript-syntactic` plugin also answers auto-insert (returns `$0</br>`
  even for void elements).

### 2. Code changes (all uncommitted until this commit)

| File | Change |
|---|---|
| `packages/lsp/src/language-plugin.ts` | `resolveConfig`: always union ES baseline + `lib.dom.d.ts` + `lib.dom.iterable.d.ts`, `types ??= []` (matches `vesk typecheck`). `VeskVirtualCode.update()`: retention of last-good compiled code on transient compile errors (`lastGood`), publishes `fatalErrors` via `vesk-parse-error` diagnostics instead of serving half-broken generated code. Added `generatedOffsetToSourceOffset(genOffset)`: nearest-chunk source-offset mapping so plugin heuristics can work in source space. |
| `packages/lsp/src/server.ts` | `findTypescriptLibDir()` (walks candidate roots for `node_modules/typescript/lib/lib.dom.d.ts`; also probes `<bundle dir>/libs`). Lib fix that actually works: wrap language-service host so `getDefaultLibFileName` returns **basename-joined** path (volar's original returns an absolute `ts.getDefaultLibFilePath` — joining dir + abs produced garbage paths), add `getDefaultLibLocation`, add `readFile`/`fileExists` fs fallbacks, redirect default-lib location, and **inject the full leaf-lib closure** (`lib.es20xx.*.d.ts`, `lib.dom*.d.ts`, … excluding bare era hubs like `lib.es2015.d.ts`) as extra script-file roots via a wrapped `getScriptFileNames`. Injects minimal fallback ambient (`__vesk_lib_fallback.d.ts`) only when no real lib dir found. Captures workspace roots from initialize params. |
| `packages/lsp/src/styleShim.ts` | Connection-level shim (`installStyleShim`) wrapping `onCompletion`/`onHover`: requests whose RAW client position falls inside a `<style>` region are answered by vscode-css-languageservice (real CSS properties/values/hover docs), everything else delegates to volar. Needed because the compiler strips style content from generated code — volar's remapped positions can't address it and its completion dispatcher never descends into the css embedded code. `VeskVirtualCode.update()` pushes live text + regions via `noteStyleState`. | 
| `packages/lsp/src/plugins/autoInsert.ts` | Full rewrite: backward state-machine scan (quote-aware `" ' \` + brace depth, newline/char limits), skips void elements and self-closing `/>`. Component (uppercase) tags close too when the `<` sits at a JSX expression start (`isJsxExpressionStart`: prev non-ws char is punctuation/bracket/`>`/start-of-file, or an expression keyword like `return`) — generic arguments (`make<Card>(1)`), comparisons (`a < Card`) and `<T,>` type-parameter lists are declined. Whitespace-tolerant caret. Disables `typescript-syntactic`'s `provideAutoInsertSnippet` so vesk owns tag insertion. |
| `packages/lsp/src/plugins/completion.ts` | Tag-open position now also offers lowercase `HTML_ELEMENTS` (from `knowledge.ts`) ranked above scope junk via `sortText`, plus intrinsics + scanned components. Attr position offers component props (usage-inferred), event handlers with docs, and for intrinsic (lowercase) tags the global HTML attributes + per-tag attribute lists — already-used attrs are filtered. Expression position offers reactive bindings, used runtime imports, `props`, globals. Context detection via `classifyCompletionContext`: a stack-based forward state machine (`code`/`tag`/`expr`; `<Name` pushes tag from any state, `{` pushes expr, closers pop back to their opener) that correctly handles statement-mode bodies, JSX child expressions like `<p>{count}</p>`, and broken sources. Heuristics run on the ORIGINAL `.vsk` text mapped back from the generated offset via `VeskVirtualCode.generatedOffsetToSourceOffset`. |
| `packages/lsp/src/plugins/hover.ts` | Fixed pre-existing TS2551 compile errors (narrowing on hover contents). |
| `extension/vsk-vscode/src/extension.ts` | Client wiring: sends `volar/client/autoInsert` on typing a trigger char; guards (language, undo/redo, `vesk.autoCloseTags` setting, caret drift, single selection); snippet `$` escaping; reads trigger chars from server capabilities. |
| `extension/vsk-vscode/package.json` | `emmet.includeLanguages: { vsk: html }` configurationDefault; new `vesk.autoCloseTags` setting (default true). |
| `packages/lsp/tests/fixtures/libs-dom/` | New fixture (tsconfig with `lib: ["DOM","DOM.Iterable"]`) whose page actually uses console/Promise/Error so lib coverage is really asserted. |
| `packages/lsp/tests/lsp-language.test.mjs` | New protocol-level test suite (spawns source server via tsx, no bundle needed). |

### 3. Test harness findings (important!)
- LSP `textDocument/didChange` **rejects `rangeOffset`-style changes**
  ("Unknown change event received") — edits must be full-text `{ text }` or
  range-based. Harness now uses full-text. This silently broke several tests
  before (server never saw the edit).
- Server logs arrive as `window/logMessage` notifications, not stderr —
  harness captures both (`SHOW_STDERR=1` prints tails).
- Scenario filter: `SCENARIO=basic|libs-dom|fatal` env var for fast runs.

## Current test results (all green)

- `node --max-old-space-size=1024 packages/lsp/tests/lsp-language.test.mjs` -> **20 passed, 0 failed**
- `node --max-old-space-size=1024 packages/lsp/tests/lsp-smoke.mjs` -> **39 passed, 0 failed**

### Style blocks (`<style>` in .vsk) — real CSS features

`packages/lsp/src/styleShim.ts` installs a connection-level shim BEFORE volar
registers its handlers (`connection.onCompletion`/`onHover` are single-slot;
ours wraps theirs and delegates non-style requests unchanged). Why needed:
the compiler records style regions but SKIPS their content in generated code,
so volar remaps carets inside a `<style>` block to a neighboring chunk and its
completion dispatcher never descends into the css embedded code — plugin-level
providers cannot recover the raw client position. The shim answers using RAW
client coordinates (exact), fed by `VeskVirtualCode.update()` ->
`noteStyleState()` which tracks the live buffer text + regions per URI.
Results come from `vscode-css-languageservice` directly (properties, values,
hover docs); item textEdits are dropped so inserts land at the caret.

### Component-tag auto-close

`autoInsert.ts` closes uppercase component tags when the `<` sits at a JSX
expression start (`isJsxExpressionStart`); generic arguments (`make<Card>(1)`),
comparisons (`a < Card`) and `<T,>` type-param lists are declined.

Gotchas that cost time — do not relearn:
- **lsp-smoke.mjs tests the bundle**, not `src/`. After any `packages/lsp/src` change run
  `NODE_OPTIONS=--max-old-space-size=3072 node scripts/build-lsp.js` (works fine here; the
  earlier OOM was without raised heap), then re-run smoke.
- Bare `<br>` (HTML void syntax without self-close) fails acorn JSX parsing -> compile error +
  raw passthrough. All fixtures use `<br />`.
- LSP `didChange` rejects `rangeOffset` changes; use full-text `{ text }`.
- Server logs are `window/logMessage` notifications and are DEBUG-gated
  (`VESK_LSP_DEBUG=1` + `SHOW_STDERR=1` print tails;
  `SCENARIO=basic|libs-dom|fatal|fatal-retention` filters the language suite).
- TS attr-completion items come back `?`-suffixed (`class?`) when TS sees
  IntrinsicElements-member context instead of JSX-attribute context — our plugin must supply
  the plain labels.
- Volar presents documents under multiple URIs per request (file URI +
  `volar-embedded-content://root/…`) and REMAPS positions per round; never trust
  `document.uri.endsWith('.vsk')` or raw offsets inside providers.

## Pending work
- [x] Fix lib resolution + tag/attr completion (both scenarios green; leaf-lib root injection
      was the fix — `options.lib` entries alone never resolved in the embedded program).
- [x] Stack-based `classifyCompletionContext` wired into completion (statement mode covered:
      bare JSX inside body braces classifies as tag-open/attr correctly).
- [x] Rebuild bundle + both suites green.
- [x] CSS inside `<style>` blocks: real completion + hover via connection shim (validation/formatting still open).
- [ ] Repackage vsix + manual VS Code smoke test (auto-close, `<div` completion,
      emmet, no Error diagnostics).
