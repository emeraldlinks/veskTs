# 001 — IR Format

## Decision

Vesk uses a **plain typed AST of IR node classes** as its intermediate representation, rather than a JSON-serializable format.

## Rationale

The IR is consumed only by the compiler's own codegen stages (server and client). It does not need to be serialized to disk, sent over a network, or consumed by external tools. A typed class hierarchy gives us:
- Direct method dispatch for codegen visitors
- Strong typing for IR node properties
- Easy extensibility for new node types

## IR Node Types

The IR represents the following node kinds:

### Static nodes
```ts
class StaticNode {
  tag: string;           // element tag name
  attributes: Attr[];    // static attributes only
  children: IRNode[];    // child nodes
}
```

### Dynamic bindings
```ts
class DynamicBinding {
  kind: 'text' | 'attribute' | 'class' | 'style';
  target: string;        // attribute name or null for text
  expression: Expression; // reactive expression to evaluate
}
```

### Conditional regions (from statement-mode `if`)
```ts
class ConditionalRegion {
  condition: Expression;
  consequentBranch: IRNode[];
  alternateBranch: IRNode[];  // both branches always present
}
```

### List regions (from statement-mode `for`)
```ts
class ListRegion {
  iterable: Expression;
  keyExpression: Expression;
  indexVariable?: string;
  itemVariable: string;
  bodyTemplate: IRNode[];
}
```

### Opaque dynamic regions (from expression-mode `.map()`/ternary)
```ts
class OpaqueDynamicRegion {
  expression: Expression;
  renderFn: Expression;  // the .map() callback or ternary
  // This region uses runtime diffing, not static codegen
}
```

### Defer boundaries
```ts
class DeferBoundary {
  children: IRNode[];
  asyncBlocks: AsyncBlock[];
}
```

### Style scope metadata
```ts
class StyleScope {
  hash: string;          // per-component scope hash
  css: string;           // raw CSS
}
```

### Expression node (wraps any JS expression)
```ts
class Expression {
  raw: string;           // original source expression
  deps: string[];        // reactive dependencies (tracked variable names)
}
```

## IR Tree Structure

```
IRRoot
├── components: ComponentIR[]
│   ├── ComponentIR
│   │   ├── name: string
│   │   ├── params: Parameter[]
│   │   ├── isClient: boolean
│   │   ├── isAsync: boolean
│   │   ├── mode: 'statement' | 'expression'
│   │   ├── body: IRNode[]
│   │   └── style: StyleScope | null
```

## Why Not JSON-Serializable

- Codegen needs to call methods on IR nodes (e.g., `node.emitHTML()`, `node.emitClientCode()`)
- The IR is ephemeral — created during compilation, consumed immediately, never stored
- Class instances give us runtime type checking and method dispatch
- If serialization is ever needed (debugging, caching), we can add `toJSON()` methods later

## Reference

See also: `/docs/analysis/compiler-pipeline.md` — the analysis of Ripple's lack of IR and why Vesk adds one.
