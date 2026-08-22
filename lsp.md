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
| `packages/lsp/src/language-plugin.ts` | `resolveConfig`: always union ES baseline + `lib.dom.d.ts` + `lib.dom.iterable.d.ts`, `types ??= []` (matches `vesk typecheck`). `VeskVirtualCode.update()`: retention of last-good compiled code on transient compile errors (`lastGood`), publishes `fatalErrors` via `vesk-parse-error` diagnostics instead of serving half-broken generated code. |
| `packages/lsp/src/server.ts` | `findTypescriptLibDir()` (walks candidate roots for `node_modules/typescript/lib/lib.dom.d.ts`; also probes `<bundle dir>/libs`). Wraps language-service host `getDefaultLibFileName` → join(effective lib dir). Injects minimal fallback ambient (`__vesk_lib_fallback.d.ts`) only when no real lib dir found. Captures workspace roots from initialize params. |
| `packages/lsp/src/plugins/autoInsert.ts` | Full rewrite: backward state-machine scan (quote-aware `" ' \` + brace depth, newline/char limits), skips void elements, self-closing `/>`, uppercase component tags. Whitespace-tolerant caret. Disables `typescript-syntactic`'s `provideAutoInsertSnippet` so vesk owns tag insertion. |
| `packages/lsp/src/plugins/completion.ts` | Tag-open position now also offers lowercase `HTML_ELEMENTS` (from `knowledge.ts`) ranked above scope junk via `sortText`, plus intrinsics + scanned components. |
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

## Current test results (`node --max-old-space-size=1024 packages/lsp/tests/lsp-language.test.mjs`)

PASSING:
- auto-close after `<div class="wrap">` → `</div>` ✓
- multi-line tag with quoted attributes → `</div>` ✓ (fixed by full-text didChange)
- void `<br>` → null ✓ (typescript-syntactic disable works)
- component tag / self-closing / `>` inside JSX expression → null ✓
- expression completion has reactive bindings, no Node globals ✓
- intrinsic `Head` offered at tag position ✓

FAILING (2 known issues):
1. **Scenario A globals**: still `2583/2584` ("change your target library") +
   `2304 Error` ×2 when the doc compiles CLEANLY. Evidence says the wrapped
   `getCompilationSettings` may not be reaching the program that checks the
   file, OR lib entries in options aren't resolved because the volar host lacks
   `getDefaultLibLocation`. Earlier "pass" was an illusion (raw passthrough of
   invalid `.vsk` syntax produced parse errors which suppress semantic diags).
   NEXT STEP: add `VESK_LSP_DEBUG=1` logging around effectiveLibDir +
   getDefaultLibFileName wrap; verify what compilerOptions the semantic
   program actually uses; possibly need to patch `getDefaultLibLocation` too.
2. **Tag completion missing plain `div`**: response is TS-only junk
   (`a?`, `abbr?` = IntrinsicElements member-style items) — our completion
   plugin's items don't appear. Suspect `getVirtualCode()` fails for the ROOT
   embedded doc URI (`embeddedCodes.get('root')` misses; root lives at
   `generated.root`). Fix `utils.getVirtualCode` decoded branch to fall back to
   root. Also verify plugin firing with debug logs.

Also noted (pre-existing, out of scope): bare `<br>` (HTML void syntax without
self-close) fails acorn JSX parsing → compile error + raw passthrough. All
fixtures use `<br />`.

## Pending work
- [ ] Fix the two failing scenarios above.
- [ ] Re-run full test file green + `npx tsc --noEmit -p packages/lsp/tsconfig.json`.
- [ ] `npx tsx packages/cli/src/build-packages.ts` to rebuild @vesk dists.
- [ ] **User must run** `node scripts/build-lsp.js` themselves (OOM-kills opencode here).
      Consider extending build-lsp.js to copy `typescript/lib/*.d.ts` next to
      bundle (`lsp-server/libs/`) — server already probes that location.
- [ ] Repackage vsix + manual VS Code smoke test (auto-close, `<div` completion,
      emmet, no Error diagnostics).
- [ ] Delete scratch files `packages/lsp/tests/tmp-mappings.mjs`,
      `tmp-probe-codegen.mjs`.
