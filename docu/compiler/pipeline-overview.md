# Compiler Pipeline Overview

The compiler turns `.vsk` source into two JavaScript targets from one
intermediate representation: server codegen (SSR HTML) and client codegen
(real DOM construction + hydration wiring).

## Pipeline stages

```
.vsk source
   │
   ▼
[1] Preprocess (parser.ts)
   │  preprocessForClauses(): blanks `; key <expr>` / `; index <ident>`
   │  clauses in for-of headers, preserving source offsets; records
   │  VeskAnnotation[] so the IR generator can recover them
   ▼
[2] Parse (acorn + acorn-ts-plugin + VeskPlugin)
   │  ESTree-compatible AST with Vesk extensions:
   │  - ComponentDeclaration (async / client flags)
   │  - &[...] track-declaration binding atoms (lazy: true)
   │  - JSX in statement position (bare <div> as a statement)
   │  - VeskBlock: {#server}, {#client}, empty {}
   │  - <style> elements captured raw
   ▼
[3] IR generation (ir-generator.ts)
   │  Walks the AST → typed IR node tree (see ir-format.md)
   │  - statement-mode dispatch: if/for/while/switch/try/JSX/runtime code
   │  - validateBlocks: rejects {#server} in client components and
   │    {#client} in server components
   │  - extractStyle: hoists <style> content out of the body
   ▼
[4] Codegen — two targets consume the same IR
   ├─ [4a] Server codegen (server-jsgen.ts) → function emitting HTML
   │       string chunks; event attrs stripped; dynamic attrs rendered
   │       with placeholder then replaced
   └─ [4b] Client codegen (client-codegen.ts) → code that creates real
           DOM nodes and wires tracked bindings, effects, hydration
```

## Verified stage behavior

- **Parser**: `acorn` `ecmaVersion: 'latest'`, `sourceType: 'module'`, with
  `locations` and `ranges`. Entry: `parse(source, { filename })`.
- **IR**: statement mode and expression mode produce the same IR node
  types. For example both `{items.map((i) => <X />)}` (expression mode)
  and `for (const i of items; key i.id) { <X /> }` (statement mode)
  become `MapRegion`.
- **Static analysis**: `isStaticIR(body)` decides whether a subtree is
  fully static (only `StaticNode`/`TextNode`, no dynamic attrs, no `on*`).
  Static components skip runtime effect wiring; `<!--vsk-->` claim markers
  are emitted in hydrate mode for subtrees that need client JS.
- **Validation errors** come from `VeskError` factories
  (`errors.ts`): e.g. `classDecl`, `serverBlockInClient`,
  `clientBlockInServer`, `notFound` with candidate suggestions.

## Design decisions

- IR is a typed class hierarchy (`ir.ts`), not JSON — codegen visitors
  dispatch on `instanceof`, and the IR is ephemeral per compilation.
- User code in statement-mode bodies stays raw: unrecognized statements
  are preserved as `RuntimeStatement` and re-emitted verbatim; all
  transformations happen on the IR with AST visitors and `esrap` reprinting.
- Expression evaluation on the server uses the expression's source text
  (`Expression.raw`); dynamic text is escaped with `escapeHtml()`.
- No regex anywhere in parsing or codegen — tokenizer/character scans only.

## Verified against

- `packages/compiler/src/parser.ts`, `vesk-plugin.ts`, `ir-generator.ts`,
  `ir.ts`, `server-jsgen.ts`, `client-codegen.ts`, `errors.ts`
- Commit `2a5b19d`