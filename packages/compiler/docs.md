# @vesk/compiler — Documentation

> The **heart of Vesk**: a from-scratch, compiler-first pipeline that turns `.vsk` source into
> server-rendered HTML and client JavaScript. This package contains the lexer/parser, semantic
> analysis, the IR, and both server & client codegen, plus the scanner, router, and `tsc`-in-`.vsk`
> tooling.

- **Language:** TypeScript (ESM, Node >= 20)
- **Dependencies:** `acorn`, `@sveltejs/acorn-typescript`, `zimmerframe` (AST walker), `esrap`
  (printer), `is-reference`, `source-map`
- **Version:** 0.1.6

---

## Table of contents

1. [Overview](#overview)
2. [Module layout (file map)](#module-layout)
3. [Core concepts](#core-concepts)
4. [The pipeline](#the-pipeline)
5. [Public API](#public-api)
6. [Usage patterns](#usage-patterns)
7. [Common mistakes & fixes](#common-mistakes--fixes)
8. [Testing](#testing)
9. [Also see](#also-see)

---

## Overview

`.vsk` is a superset of TypeScript. Vesk adds three syntactic extensions on top of TS/JSX:

1. The **`component`** keyword (`component Name(props) { ... }`), optionally `export component`,
   `export default component`, `async component ...`, and the **`client`** island modifier
   (`component Name() client { ... }`).
2. **Tracked declarations** — `const &[count] = track(0)` / `const &[count, rawCell] = track(0)`
   (the `&[...]` lazy-destructure) plus reactive auto-rewriting of tracked variables into
   `cell.get()`.
3. **Statement-mode component bodies** — bare `<div>` as a statement, real `if`/`for`/`while`/
   `switch`/`try`/`do-while`, guard-clause early returns, labeled blocks.

The compiler produces two independent outputs from the same IR:
- **Server code** — a JS function per component that emits SSR HTML (string concat, escaping,

---

## Module layout

| File | Responsibility |
|---|---|
| `parser.ts` | Assembles the Acorn parser (`tsPlugin` + `VeskParserPlugin`); `preprocessForClauses()` blanks the `; key X` / `; index i` for-clauses and records annotations. |
| `vesk-plugin.ts` | The Acorn plugin extension: `component`, `&[...]`, statement-mode JSX, `client`/`#client`/`#server`/`#style` tokens, JSX-vs-generic disambiguation. |
| `acorn-ts-plugin/` | Fork of `@sveltejs/acorn-typescript` providing TS + JSX for Acorn. |
| `ir.ts` | The IR: typed node classes (`IRRoot`, `ComponentIR`, `StaticNode`, `TextNode`, `DynamicBinding`, `OpaqueDynamicRegion`, `MapRegion`, `WhileLoop`, `SwitchBlock`, `TryCatch`, `ForLoop`, `TrackDecl`, `RuntimeStatement`, `ComponentCall`, `ServerBlock`, `ClientBlock`, `HeadBlock`, `SlotNode`). |
| `ir-generator.ts` | AST → IR; also `getPropsType()` extraction from component params. |
| `server-jsgen.ts` | IR → server JS per component (`irNodeToJS`, `generateFunctionBody`, `buildComponentMap`). |
| `server-render.ts` | High-level SSR: `compileFile`, `render`, `renderPage`, `ssg`, `renderFullPage`, `renderPageStream`. |
| `server-head.ts` | Compile-time `<head>` collection + merging (`renderHeadHtml`, `mergeHeadHtml`). |
| `server-utils.ts` | Escaping, `raw`, `exprJS`, `tryEvalExpr`, hydration id state, cookies/CSRF/CORS/security headers, rate limiting, redaction. |
| `server-cookies.ts` | Legacy cookie helpers. |
| `client-codegen.ts` | IR → client JS: DOM creation, effects, hydration, `compileClient`. |
| `scan.ts` | **No-regex** character-level scanners (whitespace, idents, strings, comments, balanced ends, css/html tag ends). |
| `tokens.ts` | Tokenizer-based syntax analysis (called identifiers, imports) built on the acorn tokenizer with char-scan fallback. |
| `strip-ts.ts` | AST-based TypeScript syntax removal via `zimmerframe` + `esrap` reprint. |
| `actions.ts` | Server-action rewriting: `defineAction(...)` → stable-id + endpoint; client side stubbed. |
| `router.ts` | File-based route scan (`scanRoutes`, `scanComponents`, `matchUrl`, route manifest) + middleware parts extraction. |
| `api-routes.ts` | API route scan + execution (`scanApiRoutes`, `matchApiUrl`, `buildWebRequest`, `executeApiRoute`). |
| `middleware.ts` | Middleware chain collection/execution (`collectMiddlewareChain`, `loadMiddleware`, `executeMiddlewareChain`). |
| `config.ts` | `defineConfig`, `definePlugin`, `preset`, `validateConfig` (security presets). |
| `errors.ts` | `VeskError` with `didYouMean` suggestions, contextual static factories. |
| `typecheck.ts` | `typecheckProject` — runs real `tsc` over `.vsk` via generated `.d.ts` virtual files. |
| `vsk-tsx.ts` | `.vsk` → `.tsx` transpile (`vskToTsx`) + `generateVskDts`. |
| `index.ts` | Public barrel exports. |
| `*.test.ts` | Unit test suites (see [Testing](#testing)). |

---

## Core concepts

- **IR (Intermediate Representation)** — a plain typed class tree, not JSON. Ephemeral: created
  during compilation, consumed immediately. Method-dispatch friendly for codegen visitors.
- **Statement mode vs expression mode** — a `ComponentIR.mode`. Statement mode keeps user code raw
  and transforms on the IR with AST visitors; expression mode uses `return <jsx>`.
- **Tracked variables** — `&[name] = track(...)`. On the server, the initializer is evaluated and
  reactivity is skipped. On the client, the name is auto-rewritten to `cell.get()` and assignments
  to `cell.set(...)`.
- **`__registry`** — a `Map<string, Function>` resolved at render time; imported child components
  resolve via this rather than static imports, enabling cross-file component resolution.
- **`__vesk`** — the runtime object (`{ track, set, ... }`) destructured into generated scope.
- **Hydration markers** — `data-vsk="N"` attributes / `<!--vsk-->` comments that the client walker
  claims; exactly what `__vskHydrate`/`__vskId` control.

---

## The pipeline

```
.vsk source
  └─ preprocessForClauses()        ← blank `; key`/`; index` clauses (char scan, no regex)
      └─ acorn.Parser.extend(tsPlugin, VeskParserPlugin).parse()  → ESTree AST (+ __vskAnnotations)
          └─ generateIR(ast, source)                              → IRRoot
              ├─ irNodeToJS / generateFunctionBody / buildComponentMap
              │      └─ evalTopLevelCode(transformTopLevelForActions(topLevel,'server'), __vesk)
              │             → server component functions (SSR HTML)
              ├─ compileClient(source, name, {forceClient, hydrate}) → client JS bundle
              └─ vskToTsx(source) / typecheckProject()
```

Key entry behaviors:

- `compileFile(source)` parses, generates IR, builds the server component map, **recursively** pulls
  in imported `.vsk` components (via `collectVskImportPaths`), evaluates top-level code with
  server-action transforms, and returns `{ ir, componentMap, __vesk }`.
- `render(source, comp, props, registry, options)` — SSR a single component to a string. Sets
  `globalThis.__vsk_ssr` + a per-call token, clears SSR cells afterward. Async components return a
  `Promise<string>`.
- `renderPage(...)` — SSR a page component; runs `loadFn` (if any) first and merges its
  `{ props }` into the render props.
- `ssg(...)` — static site generation (feeds `getStaticProps`).
- `renderPageStream(...)` — async generator streaming SSR.

  hydration markers `data-vsk="N"` / comments).
- **Client code** — DOM-construction + `effect()` reactivity code that either hydrates the
  server-rendered HTML or builds the tree from scratch.

These two outputs are generated by `server-jsgen` and `client-codegen` respectively, driven by the
same `IRRoot` from `ir-generator`.

---

## Public API (index.ts)

```ts
// Parser
parse(source, options)                          → Program (ESTree)
createBaseParser()                              → acorn.Parser subclass
VeskParserPlugin(config?)                       → acorn plugin

// IR generation
generateIR(ast, source)                         → IRRoot

// Server
render(source, comp, props?, registry?, options?)   → string | Promise<string>
compileFile(source, options?)                       → CompileFileResult

// Client
compile(source, name, {forceClient, hydrate, includeTopLevel}?)  → string  (= compileClient)
compileClient(...)                                          → string

// IR classes (exported): IRRoot, ComponentIR, StaticNode, TextNode, DynamicBinding,
//   OpaqueDynamicRegion, MapRegion, ComponentCall, Expression  +  type IRNode

// Types: VeskPlugin, MiddlewareContext, VeskConfig, VeskSecurity, VeskCors, VeskRateLimit

// Config
defineConfig, validateConfig, preset, definePlugin

// Router
scanRoutes(appDir, options?)    → RouteNode[]
scanComponents(componentsDir)   → Map<string,string>
collectSources(tree)            → Map<string,string>
matchUrl(tree, pathname)        → MatchResult | null
```

---

## Usage patterns

### Programmatically render a component to HTML

```ts
import { render } from '@vesk/compiler';
const html = await render(source, 'Home', { name: 'Ada' });
```

### Compile to client JS

```ts
import { compile } from '@vesk/compiler';
const js = compile(source, 'Home', { hydrate: true });
```

### Scan an app directory for routes

```ts
import { scanRoutes } from '@vesk/compiler';
const tree = scanRoutes('app'); // RouteNode[] with page/layout/loading/error/notFound
```

### tsc-in-.vsk tooling

```ts
import { vskToTsx, generateVskDts } from '@vesk/compiler/src/vsk-tsx';
import { typecheckProject } from '@vesk/compiler/src/typecheck';

const tsx = vskToTsx(vskSource);              // .vsk → .tsx for tsc
const dts = generateVskDts(vskSource);        // .vsk → .d.ts ambient types
const result = typecheckProject('.', { strict: true }); // { errors, warnings }
```

### Config

```ts
import { defineConfig, definePlugin, preset } from '@vesk/compiler';

export default defineConfig({
  appDir: './app',
  security: preset('production', { trustProxy: true }),
  plugins: [definePlugin({ name: 'x', onCSS: (css) => css })],
});
```


---

## Common mistakes & fixes

| Mistake | Fix |
|---|---|
| Using **regex** in compiler/codegen for source manipulation or syntax analysis | **Hard rule (AGENTS.md): never.** Use the tokenizer/AST (`acorn` + `vesk-plugin`) or the char-scan helpers in `scan.ts`/`tokens.ts`. The only exception is compile-time-inert tooling (e.g. error-message matching in tests). |
| Editing `packages/compiler/src` and testing against stale output | **Always rebuild:** `npx tsx packages/cli/src/build-packages.ts`. Tests/probes resolve the package's `dist/` via the exports map. |
| Running `scripts/test.js` while iterating | It builds then runs the **full** suite — slow. Run individual files: `npx tsx packages/compiler/src/<file>.test.ts`. |
| Adding a body-level feature in only expression mode | **Statement mode is first-class.** Every body-level feature and every test suite must cover **both** expression and statement mode. |
| Calling a feature done without a hydration test | Reactivity/hydration work requires the production path via `node hydration-test.mjs` at the repo root — unit tests alone are insufficient. |
| Importing `batch` | **`batch` does not exist in the runtime** — never import it. Effects/derived/untrack/peek/tick/flushSync/on_destroy/createContext are auto-imported from `@vesk/runtime`. |
| Forgetting `on*` handlers are SSR-stripped | Event handler attributes are excluded from SSR HTML entirely by design. |
| `resolveComponentName` picks the wrong component | Home/about/blog pages should declare their page as the **first** component (or `export default`); precedence is `defaultExport` → first → exported. |
| Adding a new IR node but not wiring it in both codegens | New `IRNode` types must be handled in `server-jsgen.irNodeToJS` **and** `client-codegen` (and `isStaticIR`). |
| Breaking the `exports` map (`@vesk/compiler/src/*` → `./dist/*.js`) | Keep the `./src/*` subpath export working; the adapter/dev-server/CLI resolve compiler source through it in the monorepo. |

---

## Testing

All compiler unit tests live in `packages/compiler/src/*.test.ts`. Run individually:

```bash
# rebuild first if you touched source
npx tsx packages/cli/src/build-packages.ts
# then run one suite
npx tsx packages/compiler/src/parser.test.ts
```

Current suites (totals ~685 tests): `api-routes (13)`, `cli (14)`, `components-scan (6)`,
`config (14)`, `head-merge (14)`, `scan (31)`, `server-utils (90)`, `ssg (8)`, `track-codegen (8)`,
`vsk-imports (15)`, `vsk-tsx (22)`, `parser (79)`, `server-codegen (86)`, `integration (98)`,
`client-codegen (134)`, `ir-generator (9)`, `router (19)`, `ts-support (25)`.

Test convention: files print `Results: N passed, M failed` — `scripts/test.js` parses this.

---

## Also see

- `/root/vesk/AGENTS.md` — repo-wide hard rules (especially the **no-regex** and **statement-mode** rules).
- `/root/vesk/docs/analysis/compiler-pipeline.md`, `docs/analysis/parser.md` — design analysis.
- `/root/vesk/docs/decisions/001-ir-format.md` — why the IR is a typed class tree.
- `llms.txt` (this directory) — machine-oriented, unusually comprehensive reference.

