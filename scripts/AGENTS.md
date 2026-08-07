# AGENTS.md — scripts/

Rules for the repo-level tooling scripts in `/root/vesk/scripts/`.

## Hard rules

1. **Do not run `scripts/test.js` while iterating on a single compiler test.** It builds all packages then runs the full suite (unit + E2E + hydration + edge). Use `npx tsx packages/compiler/src/<file>.test.ts` for fast iteration.
2. **E2E scripts require available ports 3002 and 3099.** `scripts/e2e-setup.js` kills existing listeners on those ports; if you see binding errors, free them manually.
3. **`scripts/build-lsp.js` uses a hardcoded absolute path** (`/home/joe/vesk/packages/lsp/src/server.ts`). If the repo is checked out elsewhere, update the input path before running.
4. **`scripts/release.mjs` publishes to npm.** Use `--dry-run` first. The publish order is: `@vesk/compiler` → `@vesk/runtime` → `@vesk/plugin-tailwind` → `@vesk/adapter` → `@vesk/lsp` → `vesk` → `create-vesk`.
5. All scripts are ESM (`.mjs`/`.js` with `import`). Do not convert to CJS.

## Commands

```bash
node scripts/test.js                        # full suite
npx tsx scripts/e2e-setup.js               # E2E servers only
node scripts/build-lsp.js                   # bundle LSP server
node scripts/release.mjs <version> --dry-run
```

## Do / Don't

**Do**
- Run `node hydration-test.mjs` after reactivity/hydration changes.
- Verify port availability before running `test.js`.

**Don't**
- Don't modify `scripts/test.js` output format — `scripts/test.js` parses `Results: N passed, M failed` lines; changing the format breaks the runner.
- Don't remove the `E2E_SERVERS_READY` sentinel from `e2e-setup.js` — `test.js` waits for it.
