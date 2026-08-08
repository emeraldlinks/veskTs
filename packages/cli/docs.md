# vesk CLI — Documentation

> The **Vesk command-line interface** and dev server. Lives in `packages/cli/src/`.
> ESM + TypeScript, Node >= 20. The `vesk` binary is `dist/cli.js`.

## Commands

| Command | Flags | What it does |
|---|---|---|
| `vesk build` | `--platform <name>` `--target <node|edge>` `--seo` `--strict` `--skip-split` | Builds `app/` into `.vesk/` via `@vesk/adapter/build()`. Auto-detects platform from CI env if `--platform` omitted. |
| `vesk start` | `-p <port>` `--port <port>` | Starts the production server (`startProdServer`) against `.vesk/`. |
| `vesk dev` | `-p <port>` `--port <port>` | Starts the HMR dev server (`startDevServer`). |
| `vesk typecheck` | `--no-strict` | Typechecks `.vsk`/`.ts` via tsc-in-.vsk (`typecheckProject`, strict by default). Exits non-zero on errors. |
| `vesk seo` | `--strict` | Runs `runSeoAudit(appDir)` and exits non-zero if strict + errors found. |
| `vesk --help` | | Prints usage and exits. |

Scaffolding is separate: `npx create-vesk@latest <project-name>`.

## Config loading

`loadConfig(projectDir)` looks for `vesk.config.js` then `vesk.config.ts` in the project root.

- **`.js`**: imported directly.
- **`.ts`**: transpiled with `typescript.transpileModule`, **stripped of `import { ... } from '@vesk/compiler'`** lines, then injected with a fake `globalThis.__vesk_inject = { defineConfig, definePlugin, preset }` before `await import(tmpFile)`. Written to `.vesk/config.tmp.js` (directory created if missing) and deleted after load.
- `.env` and `.env.local` are loaded first (simple `KEY=VAL` parser, strips quotes, does not override existing `process.env`).
- Result is passed through `validateConfig(config)` if present; security is resolved via `preset(...)`.

## Dev server (`dev-server.ts`)

`startDevServer(port, projectDir, config)` is the hot-reloading dev server. Key behaviors:

- Calls `ensurePackagesBuilt()` first (no-op if `dist/` is fresh).
- Resolves the runtime directory from `node_modules/@vesk/runtime` (preferring `ripple-runtime.js` at the package root, falling back to `dist/`).
- Reads `src/global.css` or `src/app.css`; strips Tailwind directives for dev CSS, keeps raw for Tailwind plugin.
- Watches `app/` + `public/` for changes; recompiles affected routes.
- Serves API routes under `/api/*`, middleware via `collectMiddlewareChain` + `executeMiddlewareChain`, actions via `handleActionRequest`.
- On each page request: `scanRoutes`, `matchUrl`, collect middleware, compile the page (with `compileClient` + `generateClientBundle` for JS, `renderFullPage`/`renderPage` for HTML), inject HMR client script, set `__vesk_ssr_base_url` for `load()`.
- `X-Vesk-Data: 1` requests render the page data phase and respond `application/json`. If the page throws server-side during a data request, the dev server returns `{ "error": <message> }` with status 500 (matching the production adapter's SSR function) so the SPA router renders the route error component.
- HMR: WebSocket server (`ws`) pushes `{ type:'reload'|'hmr', path }` to connected clients.

## Common mistakes + fixes

| Mistake | Fix |
|---|---|
| Running `vesk dev` outside a project root | It expects `app/` in cwd; exits with a message to run `create-vesk`. |
| Editing compiler source and seeing stale behavior | Run `npx tsx packages/cli/src/build-packages.ts` first — dev server resolves compiler through `dist/`. |
| `vesk.config.ts` importing from `@vesk/compiler` | The CLI strips those imports and injects helpers via `globalThis.__vesk_inject`. Do not rely on the TS import being present at runtime. |
| Forgetting `.env` doesn't override existing env | The loader only sets keys not already in `process.env`. |
| Running `scripts/test.js` while iterating | It builds then runs the full suite — slow. Use `npx tsx packages/compiler/src/<file>.test.ts` instead. |

## Testing

There is no unit test suite in `packages/cli/src` itself (only `cli.test.ts` in the compiler package testing CLI-related compiler features). The dev server is exercised by the root `tests/dev-test.mjs` and `tests/prod-test.mjs`.

```bash
cd /root/vesk
npx tsx tests/dev-test.mjs     # dev-server E2E
npx tsx tests/prod-test.mjs    # production build + serve E2E
```
