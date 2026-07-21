# Analysis: Ripple Parser at ripple@0.3.13

## Overview

The parser is built on **Acorn** extended with two plugins:
1. `@sveltejs/acorn-typescript` — TypeScript + JSX parsing
2. `RipplePlugin()` — custom Ripple-specific grammar extensions

The combined parser produces an **ESTree-compatible AST** with Ripple-specific extensions (Component, Element, ServerBlock, etc.).

## Parser Construction

```js
// packages/ripple/src/compiler/phases/1-parse/index.js
const parser = acorn.Parser.extend(
  tsPlugin({ jsx: true }),
  RipplePlugin()
);
```

The `RipplePlugin` is a function returning an Acorn plugin. It creates a `RippleParser` class that extends the base parser, overriding specific methods to handle Ripple-specific syntax.

## Key Parser Overrides

### `component` keyword parsing
- `parseComponent()` is the central method — handles `component Name(params) { body }`
- Called from `parseExprAtom()` when encountering `component` as a keyword
- Also called from `parseExportDefaultDeclaration()`, `parseProperty()`, `parseClassElement()`
- Component body is parsed via `parseTemplateBody()` — a custom method that handles bare JSX-as-statement

### `&[]` / `&{}` lazy destructuring
- `parseBindingAtom()` is overridden to detect `&[` or `&{` after `let`/`const`
- When found, parses the pattern normally but sets `pattern.lazy = true`
- `isLet()` is also overridden so Acorn recognizes `let &[` and `let &{` as variable declarations (Acorn's `isLet` only checks for `{`, `[`, or identifiers after `let`)

### JSX-in-statement-position (the hardest problem)
- `getTokenFromCode()` handles `<` (code 60) to decide between JSX tag start vs relational operator
- Inside components, it checks: is this at the start of a line with only whitespace before it? If so, treat as JSX
- Inside nested functions (arrow functions etc.), treats `<` as relational/generic operator, not JSX
- This is the single hardest parser problem — the heuristic for distinguishing JSX from generics relies on positional context

### `#server` and `#style` identifiers
- `getTokenFromCode()` handles `#` (code 35) to produce `#server` and `#style` tokens
- These are parsed as `ServerIdentifier` and `StyleIdentifier` AST nodes

### `key` and `index` in for-of loops
- `parseForInWithIndex()` extends standard for-of parsing with optional `; index varName ; key expr` syntax
- This is Ripple's mechanism for keyed list rendering

### `try/pending/catch`
- `parseTryStatement()` is overridden to add a `pending` block between `try` and `catch`
- The `pending` block is for async suspense handling

## AST Node Types (Ripple-specific extensions)

| Node | Description |
|------|-------------|
| `Component` | `component Name(params) { body }` with `css`, `default` fields |
| `Element` | HTML/SVG element with `attributes`, `children` |
| `Text` | Text node wrapping an expression |
| `ServerBlock` | `#server { ... }` block |
| `Attribute` | Element attribute with `name`, `value`, `shorthand` |
| `RefAttribute` | `{ref fn}` reference binding |
| `SpreadAttribute` | `{...props}` spread |
| `StyleIdentifier` | `#style` compile-time identifier |
| `ServerIdentifier` | `#server` compile-time identifier |

## Key Libraries Used

- **acorn** — base JavaScript parser
- **@sveltejs/acorn-typescript** — TypeScript + JSX support for Acorn
- **zimmerframe** — AST walker (used in analysis, not parser itself)
- **is-reference** — reference detection for scope analysis

## What's Relevant to Vesk

### Can be adapted:
- The Acorn + plugin architecture is solid and reusable
- The `parseComponent()` method structure is directly relevant
- The `parseBindingAtom()` override for `&[]` is exactly what Vesk needs
- The scope system (`scope.js`) is well-designed and reusable

### Must be changed:
- **No statement-mode bare JSX-as-statement** — Ripple at this commit doesn't have it. The parser parses JSX inside components via `parseTemplateBody()`, but this is still expression-position JSX wrapped in component bodies. Vesk's statement mode (bare `<div>` as a statement, real `if`/`for` inside JSX children) is a new grammar extension that doesn't exist here.
- **No `client` modifier** — Ripple at this commit doesn't have it
- **No `defer` blocks** — not present at this commit
- **`@` sigil for tracked JSX identifiers** — the parser supports `@name` in JSX (see `jsx_parseIdentifier()`), but Vesk drops this entirely
- **`#server` and `#style` identifiers** — Vesk doesn't need `#server`; `#style` handling may change
- **`try/pending/catch`** — Vesk uses `defer` instead; this syntax is not needed
- **Component methods in objects/classes** — `parseProperty()` and `parseClassElement()` overrides for component methods are Ripple-specific, not in Vesk's grammar
- **`html` and `text` expression containers** — `{html ...}` and `{text ...}` in JSX are Ripple-specific

### The critical gap:
The **single hardest problem** for Vesk's parser is making bare JSX work as a statement (not just expression-position). At ripple@0.3.13, JSX is always in expression position. Vesk needs:

```vsk
component Foo() {
  <div>        // JSX as statement, not expression
    if (x) {   // real if inside JSX children
      <p>hi</p>
    }
  </div>
}
```

This requires extending the Acorn parser to recognize:
1. Bare JSX elements as valid statements (not just expressions)
2. `if` and `for` statements inside JSX children
3. The `component` body as a special parsing context where this is legal

The existing `parseTemplateBody()` method is the entry point for this, but it will need significant extension.
