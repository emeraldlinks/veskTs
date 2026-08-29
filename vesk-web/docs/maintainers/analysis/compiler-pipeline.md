# Analysis: Ripple Compiler Pipeline at ripple@0.3.13

## Pipeline Overview

```
.vsk source
   │
   ▼
[1] Lexer/Tokenizer (Acorn + tsPlugin + RipplePlugin)
   │
   ▼
[2] Parser → ESTree AST with Ripple extensions
   │
   ▼
[3] Semantic Analysis (scope creation, validation, CSS analysis)
   │
   ▼
[4] Transform → Client JS or Server JS (no intermediate IR)
```

**Key difference from Vesk spec**: Ripple does NOT have a separate IR stage. The transform phase walks the AST directly and emits JS code. Vesk's spec (§3) calls for a separate IR stage between analysis and codegen.

## Stage 1: Parse

**File**: `packages/ripple/src/compiler/phases/1-parse/index.js`

- Acorn parser with TypeScript + JSX + Ripple plugins
- Produces ESTree-compatible AST with custom node types
- Entry point: `parse_module(source, filename, options)`
- Also handles CSS parsing via `parse_style()` for `<style>` blocks

## Stage 2: Analyze

**File**: `packages/ripple/src/compiler/phases/2-analyze/index.js`

Takes the AST and produces an `AnalysisResult` containing:
- **Scope tree**: `create_scopes()` builds scope chains with bindings
- **Component metadata**: tracks which components exist, their params, body type
- **Reactivity analysis**: marks which expressions are tracked, derives tracking metadata
- **CSS analysis**: `analyze_css()` processes `<style>` blocks, resolves selectors
- **CSS pruning**: `prune_css()` removes unused CSS rules based on template usage
- **Validation**: `validate_nesting()` checks HTML nesting rules
- **Server block tracking**: identifies `#server` block exports

### Analysis State
The analysis walks the AST with `zimmerframe`, maintaining state that includes:
- Current scope
- Current component
- Whether we're inside a component body
- Template expressions (for CSS pruning)
- Tracked expressions

## Stage 3: Transform

Two separate transform paths, selected by `options.mode`:

### Client Transform (`phases/3-transform/client/index.js`)
- ~5200 lines
- Walks the AST and generates JS code as ESTree nodes
- Uses `esrap` (a printer) to convert ESTree to source code
- Generates runtime calls: `_$_.render()`, `_$_.if()`, `_$_.for()`, `_$_.switch()`, etc.
- Creates template strings for static HTML
- Sets up event delegation via `_$_.delegate()`
- Injects CSS hash for scoped styles

### Server Transform (`phases/3-transform/server/index.js`)
- Generates string concatenation for SSR output
- Handles `#server` block code execution
- Registers CSS for hydration
- Wraps control flow blocks with hydration comment markers (`<!--[-->`, `<!--]-->`)

## Output Format

The compiler's `compile()` function returns:
```js
{
  js: { code: string, map: SourceMap },
  css: { code: string } | null,
  errors: RippleCompileError[]
}
```

The JS output is a self-contained module that imports from `ripple` (the runtime).

## Key Utilities

- `packages/ripple/src/compiler/scope.js` — Scope and binding management
- `packages/ripple/src/compiler/utils.js` — Shared utilities (template checks, event handling, etc.)
- `packages/ripple/src/compiler/errors.js` — Error reporting
- `packages/ripple/src/compiler/identifier-utils.js` — Identifier obfuscation, CSS hash
- `packages/ripple/src/compiler/source-map-utils.js` — Source map generation

## Source Map Support

The transform phase tracks source locations carefully:
- `set_location()` utility sets `start`/`end`/`loc` on AST nodes
- The `segments.js` module converts source maps to Volar-compatible mappings
- Used by the language server for editor integration

## What's Relevant to Vesk

### Can be reused directly:
- **Scope system** (`scope.js`) — well-designed, handles all the cases Vesk needs
- **Analysis patterns** — scope creation, binding tracking, reference resolution
- **CSS analysis and pruning** — directly applicable to Vesk's component-level scoping
- **Error reporting** — the `error()` utility and error collection pattern

### Must be changed:
- **No separate IR** — Ripple goes straight from AST to codegen. Vesk needs an explicit IR stage (§3 stage 4) for:
  - Representing static vs dynamic nodes
  - Conditional regions with both branches known
  - List regions with key expressions
  - Opaque dynamic regions (for expression-mode `.map()`)
  - Defer boundaries
  - Style scope metadata

- **Client transform is monolithic** — the 5200-line client transform handles everything from template generation to event setup. Vesk should split this into:
  - IR generation (from analyzed AST)
  - Static codegen (from IR, for statement-mode if/for)
  - Dynamic codegen (from IR, for expression-mode .map())
  - Server codegen (from IR, for SSR)

- **No static codegen path** — Ripple's client transform always generates runtime calls (`_$_.if()`, `_$_.for()`) that do runtime diffing. Vesk's statement-mode path needs to emit direct DOM patch instructions (`insertNode`, `removeNode`, `updateText`, etc.) with no runtime diffing.

- **No server-only-by-default** — Ripple compiles everything for both client and server. Vesk needs to:
  - Track which components are `client`-marked
  - Do reachability analysis from `client` nodes
  - Only ship JS for `client` subtrees
  - Generate zero JS for server-only components

- **No `defer` streaming** — Ripple has `try/pending/catch` for suspense. Vesk uses `defer { ... }` blocks instead. The streaming codegen is new.

- **Runtime calls are different** — Ripple generates `_$_.render()`, `_$_.if()`, etc. Vesk will generate different runtime calls or, for static codegen, no runtime calls at all.
