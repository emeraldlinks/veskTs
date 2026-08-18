# CLI Commands

The `vesk` CLI (`packages/cli/src/index.ts`) orchestrates the compiler,
adapter, and runtime. `haul` is the native Go engine with equivalent
commands. Scaffolding is separate: `npx create-vesk@latest <project-name>`.

## vesk commands

| Command | Flags | Behavior |
| --- | --- | --- |
| `vesk dev` | `-p <port>` / `--port <port>` (default 3000) | HMR dev server (`startDevServer`) on `app/` in cwd. Exits with a create-vesk hint when `app/` is missing |
| `vesk build` | `--platform <name>` `--target <node\|edge>` `--seo` `--strict` `--skip-split` | Builds `app/` into `.vesk/` via `@vesk/adapter/build()`. Platform auto-detected from CI env when `--platform` omitted; defaults to `node`. `--strict` makes SEO errors fail the build; `--skip-split` disables route code splitting |
| `vesk start` | `-p <port>` / `--port <port>` (default 3000) | Production server (`startProdServer`) serving `.vesk/` |
| `vesk typecheck` | `--no-strict` | Typechecks `.vsk`/`.ts` in `app/` via tsc-in-.vsk (`typecheckProject`); strict by default; exits non-zero on errors |
| `vesk seo` | `--strict` | Runs `runSeoAudit(appDir)`; exits non-zero when `--strict` and errors exist |
| `vesk --help` / `-h` | | Prints usage; exits 0 with `--help`, 1 with no args |

Port parsing accepts `-p 3000`, `--port 3000`, and `--port=3000`; invalid
values fall back to 3000.

## haul (native engine)

`haul` is a single static Go binary that replaces esbuild and the JS
dev-server orchestration:

| Command | Replaces |
| --- | --- |
| `haul build` | `vesk build` orchestration (esbuild) — native |
| `haul dev` | `vesk dev` — native HTTP server, watcher, HMR |
| `haul start` | `vesk start` — native static+server preview |
| `haul seo` | `vesk seo` — native |
| `haul typecheck` | `vesk typecheck` — runs via the **sidecar** (TS semantics are a JS/TS problem) |

- The npm bin shim (`bin/haul.js`) resolves the platform package
  `@vesk/haul-<os>-<cpu>` and spawns it with `VESK_SIDECAR` pointing at
  the bundled sidecar.
- The sidecar is a Node process speaking JSON-RPC to `@vesk/compiler` and
  `@vesk/runtime` (acorn AST/tokenizer, route scans, client bundles).
- See `docs/haul.md` for the engine architecture.

## Config loading

`loadConfig(projectDir)` reads `vesk.config.js` then `vesk.config.ts`:

- `.js` — imported directly.
- `.ts` — transpiled with `typescript.transpileModule`, stripped of
  `import { ... } from '@vesk/compiler'` lines, prefixed with
  `const { defineConfig, definePlugin, preset } = globalThis.__vesk_inject;`,
  written to `.vesk/config.tmp.js`, imported, then deleted.
- `.env` then `.env.local` are loaded first: `KEY=VAL` lines, quotes
  stripped, existing `process.env` keys never overridden.
- The result is validated by `validateConfig(config)` and passed through
  `preset(...)` for security defaults.

## Dev server behaviors

- Ensures packages are built (`ensurePackagesBuilt()`).
- Watches `app/` and `public/`; recompiles affected routes.
- Serves `/api/*` routes, middleware chains, and server actions.
- `X-Vesk-Data: 1` requests render the page data phase as JSON; server
  errors during data requests return `{ "error": <message> }` with status
  500 so the SPA router can show the route error component.
- HMR over WebSocket (`ws`): pushes `{ type: 'reload' | 'hmr', path }`.

## Verified against

- `packages/cli/src/index.ts` — command dispatch, flags, config loading
- `packages/cli/docs.md` — dev server behaviors
- `docs/haul.md`, `packages/haul/internal/cli/` — haul commands
- Commit `2a5b19d`