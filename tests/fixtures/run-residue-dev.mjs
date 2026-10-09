#!/usr/bin/env node
/**
 * Runs a `vesk dev` server for the residue fixture app, in its own process.
 *
 * Why a child process: `startDevServer()` returns void — there is no handle to
 * shut it down — so driving it in-process would leave a listening server and a
 * hung test run. It also patches process-wide state (md read hook, HMR), which
 * must not overlap the production server this suite also starts. Two isolated
 * processes, each torn down by a signal, keeps prod and dev from interfering.
 *
 * Started by tests/residue-hydration-test.mjs as:
 *   npx tsx tests/fixtures/run-residue-dev.mjs <port>
 * with cwd = repo root (so tsx and the @vesk/* workspace links resolve); the
 * fixture app needs no node_modules of its own — the CLI resolves the runtime
 * through its monorepo fallback.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const projectDir = resolve(__dirname, 'residue-app');
const port = Number(process.argv[2] || 3002);

// The CLI treats process.cwd() as the project dir, and the fixture has no
// package.json / vesk.config.ts — an empty config is the whole contract.
process.chdir(projectDir);

const { startDevServer } = await import(resolve(root, 'packages/cli/src/dev-server.ts'));

await startDevServer(port, projectDir, {}, '127.0.0.1');

console.log(`[residue-dev] listening on http://127.0.0.1:${port}`);

const shutdown = () => process.exit(0);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
