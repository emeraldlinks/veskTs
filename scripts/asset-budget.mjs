#!/usr/bin/env node
/**
 * Client-bundle size budget — a ratchet, not a suggestion.
 *
 * Nothing stopped the build from quietly getting 8x slower (or a dependency
 * from quietly adding 200 KB) because nobody measured the output. This reads
 * the emitted asset map from a build and fails when the total grows.
 *
 * Ratchet semantics: the budget only ever TIGHTENS. A change that reduces
 * sizes rewrites the budget automatically. A change that grows them fails the
 * gate with the exact delta, and raising the number is a deliberate act in a
 * commit message (`--update` writes it, with the caller owning the why).
 *
 * Usage:
 *   node scripts/asset-budget.mjs <buildDir>          # check
 *   node scripts/asset-budget.mjs <buildDir> --update # adopt the current sizes
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'perf-budget.json');

const buildDir = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const update = process.argv.includes('--update');
if (!buildDir) {
  console.error('usage: node scripts/asset-budget.mjs <buildDir> [--update]');
  process.exit(1);
}

const configPath = join(buildDir, 'config.json');
if (!existsSync(configPath)) {
  console.error(`asset-budget: no build at ${buildDir} (no config.json)`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const assets = config.assets;
if (!assets || !Array.isArray(assets.chunks)) {
  console.error('asset-budget: this build has no asset map (built without content hashing)');
  process.exit(1);
}

const chunks = assets.chunks.map((c) => ({ name: c.file, bytes: c.bytes }));
const clientBytes = assets.client.bytes;
const totalBytes = clientBytes + chunks.reduce((n, c) => n + c.bytes, 0);
const largest = [...chunks].sort((a, b) => b.bytes - a.bytes)[0] || { name: '(none)', bytes: 0 };

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const measured = {
  note: 'Client JavaScript emitted by a production build. Lower is better; this gate ratchets.',
  clientBytes,
  totalBytes,
  largestChunkBytes: largest.bytes,
  largestChunk: largest.name,
  chunkCount: chunks.length,
};

console.log('asset-budget: measured');
console.log(`  client runtime : ${kb(clientBytes)}  (${assets.client.file})`);
console.log(`  route chunks   : ${chunks.length} files, ${kb(totalBytes - clientBytes)} total`);
console.log(`  largest chunk  : ${kb(largest.bytes)}  (${largest.name})`);
console.log(`  TOTAL client JS: ${kb(totalBytes)}`);

if (update) {
  writeFileSync(BUDGET_FILE, JSON.stringify(measured, null, 2) + '\n', 'utf-8');
  console.log(`asset-budget: budget updated -> ${BUDGET_FILE}`);
  console.log('asset-budget: if this got BIGGER, say why in the commit message.');
  process.exit(0);
}

if (!existsSync(BUDGET_FILE)) {
  // First run: adopt whatever the build produced, loudly.
  writeFileSync(BUDGET_FILE, JSON.stringify(measured, null, 2) + '\n', 'utf-8');
  console.log(`asset-budget: no budget yet — adopted the current build as the baseline (${BUDGET_FILE})`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf-8'));
const checks = [
  ['total client JS', measured.totalBytes, budget.totalBytes, 0],
  ['client runtime', measured.clientBytes, budget.clientBytes, 0],
  ['largest chunk', measured.largestChunkBytes, budget.largestChunkBytes, 0],
];
let failed = 0;
for (const [label, actual, allowed, slack] of checks) {
  const delta = actual - allowed;
  if (delta > slack) {
    failed++;
    console.error(`asset-budget: FAIL ${label} grew by ${kb(delta)} (${kb(allowed)} -> ${kb(actual)})`);
    console.error('  Re-run with --update only if the growth is deliberate, and say why in the commit.');
  }
}

if (failed > 0) {
  console.error(`asset-budget: ${failed} budget(s) exceeded — the client payload got bigger.`);
  process.exit(1);
}

// Sizes shrank: tighten the ratchet so the improvement cannot be given back.
if (measured.totalBytes < budget.totalBytes || measured.largestChunkBytes < budget.largestChunkBytes) {
  writeFileSync(BUDGET_FILE, JSON.stringify(measured, null, 2) + '\n', 'utf-8');
  console.log('asset-budget: within budget, and smaller than the recorded one — ratchet tightened.');
}
console.log('asset-budget: OK');
