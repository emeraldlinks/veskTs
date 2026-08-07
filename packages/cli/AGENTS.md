# AGENTS.md — vesk CLI (`packages/cli`)

Module-specific agent rules. Extends the repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **After every `packages/compiler/src` edit, run `npx tsx packages/cli/src/build-packages.ts`.** The dev server and tests resolve compiler source through `dist/` via the `@vesk/compiler/src/*` exports map; source changes are invisible until rebuilt.
2. **Do not run `scripts/test.js` while iterating.** It builds then runs the full suite. Use targeted tests: `npx tsx packages/compiler/src/<file>.test.ts`.
3. **Statement mode is first-class.** Any body-level feature/fix and any test suite exercising component bodies must cover both expression and statement mode.
4. **Every reactivity/hydration change ships with `node hydration-test.mjs`** (repo root), not just unit tests.
5. **ESM-only.** All source is ESM; no CJS.
6. **`batch` does not exist in the runtime** — never import it.

## Commands

```bash
# rebuild dist (REQUIRED after compiler src edits)
npx tsx packages/cli/src/build-packages.ts

# run the CLI itself
node packages/cli/dist/cli.js build --platform vercel --seo
node packages/cli/dist/cli.js dev -p 3002
node packages/cli/dist/cli.js start -p 3000
node packages/cli/dist/cli.js seo --strict

# dev / prod E2E (slow)
npx tsx tests/dev-test.mjs
npx tsx tests/prod-test.mjs

# typecheck
npx tsc --noEmit -p packages/cli/tsconfig.json
```

## File responsibility map

| File | Responsibility |
|---|---|
| `src/index.ts` | CLI entry: arg parsing, env/config loading, command dispatch (`build`/`start`/`dev`/`seo`). |
| `src/dev-server.ts` | HMR dev server: HTTP + WebSocket, file watching, per-request compile, middleware/API/action routing, CSS injection. |
| `src/action-handler.ts` | Server action HTTP handler. |
| `src/build-packages.ts` | Incremental monorepo build for runtime/compiler/adapter. |
| `bin.js` | ESM bin shim. |

## Do / Don't

**Do**
- Keep the `vesk.config.ts` transpile+inject trick working (it strips `@vesk/compiler` imports and injects helpers via `globalThis.__vesk_inject`).
- Strip duplicate `export default __components[...]` from client bundles (see `client-bundle.ts` and the historical duplicate-default bug).
- Rebuild packages before testing after compiler edits.

**Don't**
- Don't run `scripts/test.js` while iterating.
- Don't import `batch`.
- Don't put server-only APIs into the client bundle.
- Don't break the `exports` map (`./src/*` → `./dist/*.js`) — the dev server resolves compiler/adapter/runtime source through it.
