# AGENTS.md — @vesk/compiler

Instructions for AI agents working in this package. Read at session start, alongside the
repo-root `/root/vesk/AGENTS.md` (these rules extend — never contradict — the root rules).

## Hard rules

- **NEVER use regex in the compiler or codegen.** All source-text manipulation and syntax analysis
  must go through `acorn` + `acorn-ts-plugin` + `vesk-plugin`, or the character/token scanners in
  `scan.ts` / `tokens.ts`. If you find a regex doing source parsing in `src`, replace it with an
  AST/token equivalent. The escaping/redaction regexes in `server-utils.ts`/`server-jsgen.ts`/
  `client-codegen.ts` are NOT source-parsing and are fine.
- **Every `src` edit must be followed by**
  `npx tsx packages/cli/src/build-packages.ts` — tests and probes resolve the package `dist/` via
  the exports map, so source changes are invisible until rebuilt.
- **Run compiler tests individually:** `npx tsx packages/compiler/src/<file>.test.ts`. Do not run
  `scripts/test.js` (full suite) while iterating.
- **Statement mode is first-class.** Component bodies support expression mode (`return <jsx>`) and
  statement mode (bare JSX, `if`/`for`/`while`/`switch`/`try`, guard-clause early returns). Every
  body-level feature AND every test suite exercising bodies must cover **both** modes.
- **Every job completes with tests** — including the production-hydration path via
  `node tests/hydration-test.mjs` (repo root) for reactivity/hydration changes. Unit tests alone are not
  sufficient.
- `.vsk` is a superset of TS: every TS construct must parse, survive codegen, and pass through
  `vskToTsx` for `tsc`.
- **Never import `batch`** — it does not exist in the runtime.
- TrackDecl syntax is `const &[count] = track(0)` / `const &[count, rawCell] = track(0)`.
- Islands (`client`/`#client`) render on both server and client; `{#client}` is SSR-stripped but
  kept in the client bundle; `{#server}` is the inverse.
- Event-handler attributes (`on*`) are excluded from SSR HTML entirely.

## Commands

```bash
# rebuild dist after any source change (REQUIRED before testing)
npx tsx packages/cli/src/build-packages.ts

# run a single compiler test suite
npx tsx packages/compiler/src/parser.test.ts
npx tsx packages/compiler/src/server-codegen.test.ts
npx tsx packages/compiler/src/client-codegen.test.ts
npx tsx packages/compiler/src/integration.test.ts

# typecheck this package
npx tsc --noEmit -p packages/compiler/tsconfig.json

# closest full validation (slow — not while iterating)
npm run test   # = test:unit (scripts/test.js) + test:dev
```

## File responsibility map (what to touch for what)

| If you change… | also update/look at… |
|---|---|
| Parser/grammar (`vesk-plugin.ts`, `parser.ts`) | `parser.test.ts`, `scan.ts`, `tokens.ts`, `acorn-ts-plugin/` |
| IR shape (`ir.ts`) | `ir-generator.ts`, `server-jsgen.ts`, `client-codegen.ts`, `isStaticIR`, integration tests |
| Tracked-variable semantics | `ir-generator.ts`, `client-codegen.ts` (`transformTracked`), `track-codegen.test.ts`, hydration test |
| SSR output | `server-jsgen.ts`, `server-render.ts`, `server-head.ts`, `server-codegen.test.ts` |
| Client DOM/hydration | `client-codegen.ts`, `client-codegen.test.ts`, `tests/hydration-test.mjs` |
| Routes/scans | `router.ts`, `api-routes.ts`, `scan.ts`, `scan.test.ts`, `router.test.ts`, `components-scan.test.ts` |
| Middleware | `middleware.ts` |
| Config/security | `config.ts`, `server-utils.ts`, `config.test.ts`, `server-utils.test.ts` |
| Server actions | `actions.ts`, `server-jsgen.ts`, `client-codegen.ts` |
| tsc-in-.vsk | `vsk-tsx.ts`, `typecheck.ts`, `strip-ts.ts`, `ts-support.test.ts`, `vsk-tsx.test.ts`, `typecheck.test.ts` |
| Errors | `errors.ts` (VeskError factories + suggestions) |

## Do / Don't

**Do**
- Follow existing style: statement-mode bodies keep user code raw; transformations happen on the IR
  with AST visitors (`zimmerframe`) and `esrap` for reprinting.
- Keep the `./src/*` exports subpath working — `@vesk/adapter`, `packages/cli`, and `@vesk/runtime`
  import compiler source through it.
- Reuse `scan.ts`/`tokens.ts` helpers for any new text analysis instead of writing regex.
- Add error suggestions/next-steps/tips to `VeskError` when raising new user-facing errors.

**Don't**
- Don't add regex-based parsing to any module under `src`.
- Don't import `batch` (runtime doesn't export it).
- Don't emit `export default` twice in a client bundle (manifest/cli strips it — keep single-default).
- Don't change `resolveComponentName` precedence casually (defaultExport → first → exported).
- Don't skip the hydration path test for reactivity/hydration work.

## Current focus (see /root/vesk/TODO.md)

Full TypeScript support in `.vsk` (tsc-in-.vsk), `generateVskDts` correctness, `vesk typecheck`,
hydrate-mode loop claiming, async page 500.
