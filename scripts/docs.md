# scripts/ — Documentation

> Repo-level tooling scripts in `/root/vesk/scripts/`. Not a package; run directly with `node` or `npx tsx`.

## Files

| File | Purpose |
|---|---|
| `test.js` | Full test runner: builds packages, runs all compiler/runtime/adapter/plugin-tailwind unit tests, then E2E tests (`code-split.test.ts`, `hmr.test.ts`, `hydration.test.ts`), then `tests/production-hydration-test.mjs` and `tests/edge-test.mjs`. Exits non-zero on failure. |
| `e2e-setup.js` | Spins up the E2E environment: builds `test-app/` with code-split, starts prod server on `3099`, starts dev server on `3002`, prints `E2E_SERVERS_READY`, then hangs. Kills both on SIGTERM. |
| `build-lsp.js` | Rollup bundle for `packages/lsp/src/server.ts` → a single ESM server file for the editor extensions. Uses `@rollup/wasm-node` with `node-resolve`, `commonjs`, `json`, `typescript` plugins. |
| `release.mjs` | Release automation: bumps all package versions + internal dep refs to `<version>`, runs `npm run build` per package in publish order, then `npm publish --access public` (or `--dry-run`). |

## Usage

```bash
# full test suite (builds first, slow)
node scripts/test.js

# E2E setup only (used by test.js internally)
npx tsx scripts/e2e-setup.js

# build the LSP server bundle
node scripts/build-lsp.js

# release
node scripts/release.mjs 0.1.7            # real publish
node scripts/release.mjs 0.1.7 --dry-run  # dry run
```

## Common mistakes

| Mistake | Fix |
|---|---|
| Running `scripts/test.js` while iterating on a single compiler test | Use `npx tsx packages/compiler/src/<file>.test.ts` instead — `test.js` builds then runs everything. |
| E2E ports already in use | `test.js`/`e2e-setup.js` try `lsof -ti:PORT | xargs kill`; if ports `3002`/`3099` are stuck, kill manually. |
| `release.mjs` forgetting to bump `create-vesk` template versions | It patches `packages/create-vesk/src/index.js` for `^0.1.0` refs; verify after a version bump. |
