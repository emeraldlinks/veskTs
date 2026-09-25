# Analysis: Reusable vs. Discarded — ripple@0.3.13 for Vesk

## Summary

Vesk is inspired by Ripple but is a fresh project. This document explicitly categorizes what can be reused or adapted, and what must be discarded.

## Reusable (Adapt Directly)

### 1. Scope System (`scope.js`)
- `create_scopes()` function and `Scope`/`ScopeRoot` classes
- Handles binding creation, reference tracking, scope chains, name generation
- Used by both analysis and transform phases
- **Action**: Copy and adapt. No changes needed for v1.

### 2. CSS Analysis and Pruning (`css-analyze.js`, `prune.js`)
- Analyzes `<style>` blocks, resolves selectors against template usage
- Removes unused CSS rules
- Generates component-scoped hash class names
- **Action**: Copy and adapt. Component-level scoping matches Vesk's v1 design.

### 3. Error Reporting (`errors.js`)
- `error()` function with filename, node location, and error collection
- Supports loose mode for IDE tooling (collects errors instead of throwing)
- **Action**: Copy directly.

### 4. AST Walker Patterns
- `zimmerframe` is used throughout for AST walking
- The visitor pattern with state threading is clean and reusable
- **Action**: Use `zimmerframe` directly in Vesk.

### 5. AST Builders (`utils/builders.js`)
- `b.*` utilities for constructing AST nodes (identifiers, calls, vars, etc.)
- **Action**: Copy directly.

### 6. AST Utilities (`utils/ast.js`)
- `extract_identifiers()`, `unwrap_pattern()`, `extract_paths()`, `object()`
- **Action**: Copy directly.

### 7. Event Utilities (`utils/events.js`)
- Event name normalization, delegation checks
- **Action**: Copy and adapt for Vesk's event handling.

### 8. Source Map Utilities (`source-map-utils.js`)
- Converting source maps to Volar-compatible mappings
- **Action**: Copy and adapt for Vesk's language server.

### 9. Comment Utilities (`comment-utils.js`)
- Comment formatting and preservation for Prettier
- **Action**: Copy and adapt if building a Prettier plugin.

### 10. Base Parser Architecture
- Acorn + `@sveltejs/acorn-typescript` + plugin pattern
- The extension mechanism is solid and reusable
- **Action**: Start from this architecture, extend for Vesk-specific grammar.

### 11. Identifier Obfuscation (`identifier-utils.js`)
- `obfuscate_identifier()` for internal names
- `CSS_HASH_IDENTIFIER` for style scoping
- **Action**: Copy and adapt.

## Partially Reusable (Adapt with Changes)

### 1. Parser (`phases/1-parse/index.js`)
- **Keep**: `parseComponent()` structure, `parseBindingAtom()` override for `&[]`
- **Keep**: `isLet()` override for `let &[`
- **Keep**: General Acorn plugin architecture
- **Change**: Remove `@` sigil support in `jsx_parseIdentifier()` — Vesk doesn't use it
- **Change**: Remove `#server`/`#style` token handling (or keep `#style` if scoping needs it)
- **Change**: Remove `try/pending/catch` parsing — Vesk uses `defer`
- **Change**: Remove component methods in objects/classes (`parseProperty()`, `parseClassElement()` overrides)
- **Change**: Remove `{html ...}` and `{text ...}` JSX expression containers
- **Major addition**: Statement-mode bare JSX-as-statement parsing (the hardest problem)
- **Major addition**: `if`/`for` inside JSX children
- **Major addition**: `client` modifier parsing
- **Major addition**: `defer { ... }` block parsing
- **Major addition**: `async` component modifier parsing

### 2. Analysis (`phases/2-analyze/index.js`)
- **Keep**: Scope creation, binding tracking, reference resolution
- **Keep**: CSS analysis and pruning
- **Keep**: HTML nesting validation
- **Change**: Add reactivity analysis for `&[]` bindings
- **Change**: Add `client`/server boundary reachability analysis
- **Change**: Add `async` modifier validation
- **Change**: Remove `#server` block tracking
- **Change**: Remove tracked expression marking for `@` sigil
- **Add**: Statement mode vs expression mode determination per component
- **Add**: Hard error enforcement for bare statements inside `return <jsx>`

### 3. Client Transform (`phases/3-transform/client/index.js`)
- **Keep**: General structure of AST-to-JS transformation
- **Keep**: Template literal generation patterns
- **Keep**: Event delegation setup
- **Keep**: CSS hash injection
- **Change**: Remove `_$_.if()`, `_$_.for()`, `_$_.switch()` runtime calls — replace with static codegen for statement mode
- **Change**: Add IR generation stage before codegen
- **Change**: Add static DOM patch codegen for statement-mode if/for
- **Change**: Keep runtime diffing path for expression-mode `.map()` (opaque dynamic regions)
- **Change**: Remove `@` sigil handling throughout

### 4. Server Transform (`phases/3-transform/server/index.js`)
- **Keep**: String concatenation SSR pattern
- **Keep**: HTML escaping
- **Change**: Add `defer` streaming support
- **Change**: Remove `#server` block execution
- **Change**: Align with Vesk's server-only-by-default model

### 5. Runtime (`runtime/`)
- **Keep core reactivity**: `tracked()`, `derived()`, `get()`, `set()`, dependency tracking, clock-based versioning, batching
- **Keep block system**: `root()`, `branch()`, `effect()`, `render()`, `destroy_block()`
- **Keep DOM operations**: `set_text()`, `set_class()`, `set_style()`, `set_attribute()`
- **Keep template system**: `template()`, `cloneNode()`, `append()`
- **Keep hydration**: `hydrating`, `hydrate_node`, `hydrate_next()`
- **Keep events**: `event()`, `delegate()`
- **Change**: Remove `_$_.if()`, `_$_.for()`, `_$_.switch()` — replace with static patch ops
- **Change**: Remove `trackAsync()` — Vesk uses `defer` blocks instead
- **Change**: Remove `#server` block execution
- **Add**: Direct DOM patch operations for static codegen path

## Discarded (Do Not Carry Into Vesk)

### 1. `@` Sigil for Reactivity
- `jsx_parseIdentifier()` support for `@name`
- All `tracked` flag handling on JSX identifiers
- The entire concept of `@` as a reactivity marker

### 2. TSRX Disambiguation Grammar
- `@if`, `@for`, `@switch`, `@try`
- `@{...}` statement containers
- Any multi-target backend selection

### 3. `#server` Blocks
- `#server` token handling
- `ServerBlock` AST node
- Server block scope tracking
- Server block export analysis

### 4. `try/pending/catch` Syntax
- `parseTryStatement()` override
- `pending` block parsing
- `TRY_BLOCK` flag and boundary system (replaced by `defer`)

### 5. Component Methods in Objects/Classes
- `parseProperty()` override for component methods
- `parseClassElement()` override for component methods
- `RippleProperty` and `RippleMethodDefinition` AST node types

### 6. `{html ...}` and `{text ...}` Expression Containers
- Special JSX expression handling in `jsx_parseExpressionContainer()`

### 7. Reactive Collections
- `RippleArray`, `RippleObject`, `RippleMap`, `RippleSet`, `RippleDate`
- `proxy.js` for reactive proxies
- Not in Vesk's v1 scope

### 8. Context API
- `context.js` in runtime
- Not in Vesk's v1 scope

### 9. Compat/Interop
- `compat.js` for React compatibility
- `compat-react` package

### 10. HMR
- `hmr.js` in runtime
- Not in initial scope

### 11. Language Server, Editor Plugins, Prettier Plugin, ESLint Plugin
- These are tooling packages, not core framework
- Can be built later as separate projects

### 12. `RippleArray` and other reactive collections
- Not part of Vesk's v1 design

## Summary Table

| Component | Reuse? | Notes |
|-----------|--------|-------|
| Scope system | ✅ Direct | Copy as-is |
| CSS analysis/pruning | ✅ Direct | Copy and adapt |
| Error reporting | ✅ Direct | Copy as-is |
| AST builders/utils | ✅ Direct | Copy as-is |
| Base parser (Acorn+TS) | ✅ Adapt | Extend for Vesk grammar |
| `&[]` parsing | ✅ Adapt | Keep, extend for statement mode |
| Analysis phase | 🟡 Adapt | Major changes for Vesk semantics |
| Client transform | 🟡 Major rewrite | Add IR, split static/dynamic paths |
| Server transform | 🟡 Adapt | Add defer streaming |
| Runtime core (track/get/set) | ✅ Direct | Keep reactivity core |
| Runtime blocks | ✅ Adapt | Remove try/suspense, keep rest |
| Runtime DOM ops | ✅ Direct | Keep as-is |
| `@` sigil | ❌ Discard | Not in Vesk |
| `#server` blocks | ❌ Discard | Not in Vesk |
| `try/pending/catch` | ❌ Discard | Replaced by `defer` |
| Component methods | ❌ Discard | Not in Vesk grammar |
| Reactive collections | ❌ Discard | Not in v1 |
| Language server/plugins | ❌ Defer | Build later |
