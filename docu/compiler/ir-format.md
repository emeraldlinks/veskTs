# IR Format

The compiler IR is a typed class hierarchy in
`packages/compiler/src/ir.ts`. It is ephemeral: created per compilation
by `ir-generator.ts`, consumed immediately by the server and client
codegen visitors. Nodes dispatch via `instanceof`.

## Root

```
IRRoot
├── components: ComponentIR[]
├── imports: string[]
├── importedNames: Set<string>
├── staticProps: string | null      # static `export const props = {...}`
├── loadFn: string | null
└── topLevelCode: string[]          # module-level statements preserved
```

```
ComponentIR
├── name, paramNames, propsType
├── isClient: boolean               # `client` island modifier
├── isAsync: boolean                # `async component`
├── ssrAwait: boolean               # component body uses fetch()
├── mode: 'expression' | 'statement'
├── body: IRNode[]
├── style: string | null            # hoisted <style> CSS text
├── exported, defaultExport
```

## Node types

| Class | Meaning | Key fields |
| --- | --- | --- |
| `Expression` | A source-text expression | `raw`, `deps`, `ast`, `source` |
| `StaticNode` | HTML element with static attrs | `tag`, `attributes`, `children`, `selfClosing`, `keyExpr` |
| `TextNode` | Literal text | `value` |
| `DynamicBinding` | Interpolated expression | `kind: 'text' \| 'attribute'`, `target`, `expression` |
| `OpaqueDynamicRegion` | Conditional region | `condition`, `consequentNodes`, `alternateNodes` |
| `MapRegion` | List rendering (`for...of` or `.map()`) | `expression`, `itemVariable`, `indexVariable`, `bodyTemplate`, `keyExpr`, `alternateNodes` |
| `ForLoop` | Classic `for` / `for...in` | `init`, `condition`, `update`, `bodyTemplate`, `kind: 'for' \| 'for-in'` |
| `WhileLoop` | `while` / `do...while` | `condition`, `bodyTemplate`, `isDoWhile` |
| `SwitchBlock` | `switch` | `discriminant`, `cases: { test, body }[]` |
| `TryCatch` | `try` / `catch` fallback | `bodyTemplate`, `catchBody`, `catchParamName` |
| `TrackDecl` | Tracked declaration | `name`, `rawName`, `init` (init source text) |
| `ComponentRef` | Reference to a child component name | `componentName` |
| `ComponentCall` | Child component invocation | `componentName`, `props`, `spreadProps`, `children`, `start` |
| `SlotNode` | Child slot rendering (`props.children`) | — |
| `ServerBlock` | `{#server}` block | `children` |
| `ClientBlock` | `{#client}` block | `children` |
| `HeadBlock` | Head content block | `children` |
| `RuntimeStatement` | Unrecognized statement, kept verbatim | `raw`, `ast`, `source` |

## Source mapping

- `Expression.raw` holds the original source text of an expression; codegen
  evaluates/re-emits it (server-side evaluation, client-side reprint via
  AST visitors + `esrap`).
- `for...of` key/index clauses survive preprocessing: the IR generator
  reads `VeskAnnotation` ranges and rebuilds `keyExpr` / `indexVariable`.
- `start` offsets on `ComponentCall` map back to source for error reporting.

## Codegen contract

- Server (`server-jsgen.ts`): walks nodes, pushes HTML string chunks to an
  `__out` array. `ServerBlock` renders; `ClientBlock` returns `''`.
- Client (`client-codegen.ts`): walks nodes, creates real DOM. `ServerBlock`
  returns `null`; `ClientBlock` renders. In hydrate mode,
  `<!--vsk-->` claim markers precede subtrees that need client JS
  (`!isStaticIR(...)`), and static-only components get no effect wiring.

## Verified against

- `packages/compiler/src/ir.ts` — full node inventory
- `packages/compiler/src/ir-generator.ts` — node construction
- Commit `2a5b19d`