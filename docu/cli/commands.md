# CLI Commands

The `vesk` CLI (`packages/cli/src/index.ts`) orchestrates the compiler,
adapter, and runtime. Scaffolding is separate: `npx create-vesk@latest <project-name>`.

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

> **Note:** the native Go engine ("haul") is parked on the `haul-parked`
> branch and is not part of the shipped framework.

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

## Server events (`app/_events.ts`)

The app can export lifecycle hooks from a private `app/_events.ts` (or
`.js`) file. The `_` prefix keeps it out of routing and bundling as a page.

```ts
import type { ServerEventContext } from '@vesk/types';

export async function onStart(ctx: ServerEventContext) {
  await ctx.set('db', await createDb());
}
export async function onRequest(ctx: ServerEventContext) {
  ctx.set('lastVisit', Date.now());
}
export async function onStop(ctx: ServerEventContext) {
  const db = ctx.get('db') as Db;
  await db?.close();
}
```

- `onStart` — Node: runs once before the server listens; edge: runs lazily
  on the first request in the isolate (`ctx.server` is `null` on edge).
- `onRequest` — runs for every app request, before middleware/actions. The
  context is request-scoped: `ctx.set`/`ctx.get` write the process-wide store,
  `ctx.locals` is a per-request snapshot seeded from it.
- `onStop` — runs on graceful shutdown (SIGINT/SIGTERM) and on dev events HMR.
- `ctx.set(key, value)` / `ctx.get(key)` / `ctx.serverLocals` mirror the
  `@vesk/runtime/server` helpers `setServerContext` / `getServerContext` /
  `serverLocals`, which read the same store via `globalThis.__vesk_server_ctx`.
  Middleware `locals` and SSR pages see the boot values.
- Dev: the handlers are reloaded and re-run when the events file changes
  (onStart/onStop re-fire with the reload). Prod/edge: `_events.ts` is bundled
  to `server/events.js` at build time and driven by `executeStart` /
  `executeRequest` / `executeStop`.
- Example: `test-app/app/_events.ts` (verified in `tests/dev-test.mjs` and
  `tests/prod-test.mjs` via `test-app/app/api/events/route.ts`).

## Verified against

- `packages/cli/src/index.ts` — command dispatch, flags, config loading
- `packages/cli/docs.md` — dev server behaviors
- `packages/cli/src/dev-server.ts` — server events wiring, events HMR
- `packages/adapter/src/events.ts` — prod/edge `_events.ts` bundling
- ~~`docs/haul.md`~~ — haul is parked on the `haul-parked` branch
- Commit `2a5b19d`