export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "native-compiler",
    title: "Native Compiler",
    description:
      "The @vesk/native-compiler surface: compileVsk, compileVskResult, CompileOptions, targets, JS/TS module compilation, and Kotlin codegen behavior.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "`@vesk/native-compiler` translates `.vsk` files into Kotlin/Compose. It walks the same `@vesk/compiler` IR the web compiler produces, so statement mode, expression mode, tracks, and `{#server}`/`{#client}` all share one source of truth.",
      },
      { kind: "h2", text: "Compiler surface" },
      {
        kind: "table",
        head: ["Function", "Returns"],
        rows: [
          ["compileVsk(source, filename, options)", "Generated Kotlin as a string"],
          ["compileVskResult(source, filename, options)", "CompileResult: `{ kt, errors, notes, libraryIds, vskTargets, jsTsTargets, npmTargets }`"],
          ["getCompileErrors(source, filename, options)", "Error list only"],
          ["compileProjectModule(source, fileRel, err, opts)", "`ProjectModuleCompile`: `{ registryEntry, kt }` for a standalone JS/TS module"],
        ],
      },
      { kind: "h2", text: "CompileOptions" },
      {
        kind: "list",
        items: [
          "`packageName` — Kotlin package for the emitted file.",
          "`componentsWithoutProps` / `componentNames` — distinguish real components from unknown tags.",
          "`customClasses` / `scopedCustomClasses` — Tailwind-class extraction results.",
          "`imageResources` / `mediaResources` — bundled asset maps (see below).",
          "`rootName` / `fileRel` — file identity for generator bookkeeping.",
          "`appDir` — project app root.",
          "`moduleRegistry` / `moduleSlugs` / `projectModuleRegistry` / `npmRegistry` — the JS/TS module surfaces.",
          "`vsklibRegistry` — installed library signatures. Libraries resolve ONLY via explicit `import { X } from '@vesk/<id>'` headers — never globally in scope.",
        ],
      },
      { kind: "h2", text: "Targets & portability" },
      {
        kind: "p",
        text: "A `CompileResult` carries four target collections that drive how the build places the compiled code:",
      },
      {
        kind: "list",
        items: [
          "`libraryIds` — `@vesk/<libId>` imports the file makes.",
          "`vskTargets` — project-relative `.vsk` paths the file imports.",
          "`jsTsTargets` — project-relative JS/TS module paths.",
          "`npmTargets` — bare npm specifiers.",
          "`multiplatform` library records decide whether an importing page lands in `commonMain` vs `androidMain`.",
          "A page is portable only when everything it imports is portable too — the target arrays keep that transitive.",
        ],
      },
      { kind: "h2", text: "Asset extraction" },
      {
        kind: "list",
        items: [
          "`collectCustomCss` — `<style>` blocks and extracted CSS.",
          "`extractStylesheetLinks` — `<link rel=\"stylesheet\">` refs for global CSS.",
          "`extractImageSources` — `<img src=\"...\">` references, static vs dynamic.",
          "`extractMediaSources` — `<video>`/`<audio>` sources.",
          "Static sources bundle as `veskBundledImage` resources; runtime file paths use `veskFileImage`.",
        ],
      },
      { kind: "h2", text: "Kotlin codegen" },
      {
        kind: "p",
        text: "The codegen (kotlin-codegen.ts) turns the IR into Compose source:",
      },
      {
        kind: "list",
        items: [
          "Each component becomes a `@Composable` function plus a generated props data class.",
          "Tailwind classes become Compose `Modifier` chains and `TextStyle`s via `classify`/`buildModifier`/`buildTextStyle`.",
          "Tracked state maps to Kotlin: `track(init)` → a cell; `&[]` reads/writes rewrite to `.value` / `.value =`.",
          "`inferTrackCellType` infers the Kotlin storage type (Int/Double/String) from the init source without regex.",
          "Buttons lift padding to `contentPadding`; `{#head}` unsupported; `{#server}` → explicit `error(...)`.",
          "CSS animation classes emit a warning pointing to `motion.animate()`.",
          "The only framework components emitted as named calls are Link, NavLink, Outlet, PullToRefresh, SwipeToDismiss, CardStack — anything else capitalized fails the build.",
        ],
      },
      { kind: "h2", text: "JS/TS module compilation" },
      {
        kind: "p",
        text: "Project `.ts`/`.js` modules are compiled to Kotlin by `compileProjectModule` (the `npm.ts` pipeline compiles whole app module trees):",
      },
      {
        kind: "list",
        items: [
          "`splitVskHeader`, `importSource`, `importSpecifiers` — header parsing.",
          "`resolveVskTarget` / `resolveJsTsTarget` — resolution against project `.vsk` and JS/TS modules.",
          "`sanitizeIdent`, `slugFor` — Kotlin-safe identifier generation.",
          "`transformModuleStatements` — statement-level transformation to Kotlin.",
          "`FRAMEWORK_NPM_SPECIFIERS` — the recognized framework packages."
        ],
      },
      { kind: "h2", text: "Compile pipeline" },
      {
        kind: "p",
        text: "The compiler borrows the web compiler's `parse()` → `generateIR()` and then adds native codegen. The end state is a hand-written, regex-free JS/TS lexer + recursive-descent parser (`lexer.ts`/`parser.ts`) producing its own token stream and AST — the same process, no regex anywhere in parsing.",
      },
      {
        kind: "note",
        tone: "warn",
        text: "Errors are hard build failures, never silent miscompiles: constructs the compiler cannot translate yet raise `TODO(...)` and fail the build. Unsupported web constructs warn; untranslatable ones error.",
      },
    ],
  },
];