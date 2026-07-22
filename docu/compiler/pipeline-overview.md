# Compiler Pipeline Overview

> Status: Phase 2 complete (server codegen for expression mode).

## Pipeline Stages

```
.vsk source
   │
   ▼
[1] Lexer/Tokenizer
   │  Acorn + @sveltejs/acorn-typescript + VeskPlugin()
   │  Tokenizes: TS, JSX, component, let, &, track
   ▼
[2] Parser → AST
   │  ESTree-compatible with Vesk extensions:
   │  - ComponentDeclaration (not FunctionDeclaration)
   │  - VariableDeclaration with lazy: true on patterns
   │  - Standard JSX elements and expressions
   ▼
[3] Semantic Analysis (Phase 3+)
   │  - Resolve track() bindings and dependency graphs
   │  - Resolve client/server boundary reachability
   │  - Reject track() inside non-client components
   │  - Reject top-level await inside non-async components
   ▼
[4] IR Generation
   │  Walks AST → produces typed IR node tree:
   │  - StaticNode (HTML elements)
   │  - DynamicBinding (expression interpolation)
   │  - OpaqueDynamicRegion (conditionals, ternaries)
   │  - MapRegion (.map() list rendering)
   │  - ComponentCall (child component references)
   │  - TextNode (literal text)
   ▼
[5] Codegen — two targets consume the same IR:
   ├─ [5a] Server codegen → function that walks IR, emits HTML string
   └─ [5b] Client codegen → creates real DOM, wires reactive bindings
```

## Current State (Phase 2)

| Stage | Status |
|-------|--------|
| [1] Lexer | ✅ Complete |
| [2] Parser | ✅ Complete (expression mode) |
| [3] Semantic | ⬜ Phase 3 |
| [4] IR | ✅ Complete (expression mode) |
| [5a] Server | ✅ Complete (non-reactive, expression mode) |
| [5b] Client | ⬜ Phase 3 |

## Usage

```js
import { render } from '@vesk/compiler';

const source = `
  component Greeting(props: { name: string }) {
    return <div>Hello, {props.name}!</div>;
  }
`;

const html = render(source, 'Greeting', { name: 'World' });
// → '<div>Hello, World!</div>'
```

## Output Format

The server codegen produces an **HTML string** by walking the IR tree at runtime. Each IR node type maps to HTML:

| IR Node | Server Output |
|---------|---------------|
| `StaticNode` | `<tag attrs>children</tag>` |
| `TextNode` | literal text (preserved as-is) |
| `DynamicBinding` | `escapeHtml(evaluate(expr, scope))` |
| `OpaqueDynamicRegion` | evaluate condition, render consequent or alternate |
| `MapRegion` | evaluate array, render bodyTemplate per item |
| `ComponentCall` | look up component, call with props |

## Key Design Decisions

### IR is typed class hierarchy (not JSON)
- Direct method dispatch for codegen visitors
- Ephemeral — created during compilation, consumed immediately
- See `/docs/decisions/001-ir-format.md`

### Guard clauses → nested OpaqueDynamicRegion
Guard clauses (`if (cond) return <X />`) are compiled as nested conditionals with short-circuiting. If a guard fires, subsequent guards and the main return are not evaluated.

### Expression evaluation via `new Function()`
Server codegen evaluates expressions by constructing functions from source text. Safe for server-side (trusted code), avoids complex AST-walking expression evaluator.

### HTML escaping
All dynamic text content is escaped via `escapeHtml()` to prevent XSS. Static attribute values from source are not escaped (trusted).
