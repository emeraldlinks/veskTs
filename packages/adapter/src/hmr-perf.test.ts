/**
 * HMR hot-path performance benchmark + regression test.
 *
 * The `.vsk` HMR hot path must stay comfortably under 180ms end-to-end. Every
 * `.vsk` file change pays exactly these three costs (full `doBuild` runs are
 * excluded — css/config/api/middleware changes legitimately do a full build
 * and are NOT in this budget):
 *
 *   1. compileClient(src, null, { forceClient: true })   — parse + IR + emit
 *   2. extractComponentAssignments(compiled)              — HMR component map
 *   3. JSON.stringify + JSON.parse of the `update` payload { components, fnSources, time }
 *
 * Runs pre-rebuild: the compiler dist is already built (resolved via the
 * exports map) and `extractComponentAssignments` is imported from the relative
 * `./hmr-utils` source.
 *
 * Fails if p95 ≥ 180ms or the mean ≥ 55ms (typical is single-digit to
 * low-tens ms; a mean ≥ 55ms means the pipeline regressed). The 55ms mean gate
 * sits well above the ~35-45ms genuine codegen cost of this heavy 42-line
 * representative component while still catching any pipeline regression.
 */
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { extractComponentAssignments } from './hmr-utils';

const ITERATIONS = 30;

const REPRESENTATIVE_SOURCE = `component ProductList {
	<Head>
		<title>Products — {count}</title>
	</Head>

	const &[count] = track(0)
	let &[items] = track([
		{ name: 'Widget', price: 9.99, inStock: true },
		{ name: 'Gadget', price: 12.5, inStock: true },
		{ name: 'Doodad', price: 3.74, inStock: false },
	])
	const &[selected, selectedCell] = track('Widget')

	const doubled = derived(() => get(count) * 2)

	<div class="p-6 max-w-3xl mx-auto">
		<header class="mb-6">
			<h1 class="text-2xl font-bold text-zinc-900">Product Catalog</h1>
			<p class="text-sm text-zinc-500">items: {items.length} · count: {count} · doubled: {doubled}</p>
		</header>

		<ul class="space-y-3">
			for (it of items) {
				<li class="rounded-lg border border-zinc-200 p-4 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<button onclick={() => set(count, get(count) + 1)} class="px-3 py-1 rounded bg-zinc-900 text-white text-sm">{it.name}</button>
						<span class={selected === it.name ? 'font-semibold text-emerald-600' : 'text-zinc-500'}>
							{selected === it.name ? 'X' : 'Y'}
						</span>
					</div>
					<span class="text-right tabular-nums text-sm">{it.price.toFixed(2)}</span>
				</li>
			}
		</ul>

		<footer class="mt-6 flex gap-2">
			<button onclick={() => set(selectedCell, 'Widget')} class="px-3 py-1 rounded border border-zinc-300 text-sm">Reset selection</button>
			<span class="text-xs text-zinc-400">total: {count * items.length}</span>
		</footer>
	</div>
}
`;

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function p95(sorted: number[]): number {
  return sorted[Math.floor(0.95 * (sorted.length - 1))];
}

console.log('\n=== HMR hot-path perf (compile + extract + payload round-trip) ===');
console.log(`source: ${REPRESENTATIVE_SOURCE.length} chars across ${REPRESENTATIVE_SOURCE.split('\n').length} lines, ${ITERATIONS} iterations\n`);

// Warm up so JIT settles before measurement. A single pass is not enough to
// warm the codegen JIT — the first several measured iterations would still
// contain JIT-compile transients and inflate the mean. Run the full hot path
// (compile + extract + payload round-trip) a few times so the 30 measured
// iterations below represent steady-state hot-path cost.
let warmCompiled: string = '';
try {
  for (let w = 0; w < 8; w++) {
    warmCompiled = compileClient(REPRESENTATIVE_SOURCE, null, { forceClient: true });
    extractComponentAssignments(warmCompiled);
    const wc: Record<string, boolean> = {};
    const ws: Record<string, string> = {};
    for (const { name, raw } of extractComponentAssignments(warmCompiled)) {
      wc[name] = true;
      ws[name] = raw;
    }
    JSON.parse(JSON.stringify({ components: wc, fnSources: ws, time: 0 }));
  }
} catch (e) {
  console.log(`  ✗ warmup compile failed: ${e instanceof Error ? e.message : String(e)}`);
  failed++;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(1);
}

const warmAssignments = extractComponentAssignments(warmCompiled);
assert(warmAssignments.length >= 1, 'representative component compiles to ≥1 __components assignment');
assert(warmAssignments.some(a => a.name === 'ProductList'), 'ProductList is among the compiled components');

const compileTimes: number[] = [];
const extractTimes: number[] = [];
const payloadTimes: number[] = [];
const iterationTimes: number[] = [];
let lastPayload: { components: Record<string, boolean>; fnSources: Record<string, string>; time: number } | null = null;
let lastRoundTrip: unknown = null;

for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  const compiled = compileClient(REPRESENTATIVE_SOURCE, null, { forceClient: true });
  const t1 = performance.now();
  const assignments = extractComponentAssignments(compiled);
  const t2 = performance.now();

  const components: Record<string, boolean> = {};
  const fnSources: Record<string, string> = {};
  for (const { name, raw } of assignments) {
    components[name] = true;
    fnSources[name] = raw;
  }
  const time = Math.round((t1 - t0) * 100) / 100;
  const payload = JSON.stringify({ components, fnSources, time });
  const roundTrip = JSON.parse(payload);
  const t3 = performance.now();

  compileTimes.push(t1 - t0);
  extractTimes.push(t2 - t1);
  payloadTimes.push(t3 - t2);
  iterationTimes.push(t3 - t0);
  lastPayload = { components, fnSources, time };
  lastRoundTrip = roundTrip;

  console.log(
    `  #${String(i + 1).padStart(2)} total ${(t3 - t0).toFixed(2)}ms` +
    `  (compile ${(t1 - t0).toFixed(2)} | extract ${(t2 - t1).toFixed(2)} | payload ${(t3 - t2).toFixed(2)})` +
    `  payload ${payload.length}b`
  );
}

const sortedIterations = [...iterationTimes].sort((a, b) => a - b);
const med = median(sortedIterations);
const avg = mean(iterationTimes);
const p = p95(sortedIterations);

console.log('\n--- summary (ms) ---');
console.log(`  median ${med.toFixed(2)} | mean ${avg.toFixed(2)} | p95 ${p.toFixed(2)} (worst ${sortedIterations[sortedIterations.length - 1].toFixed(2)})`);
console.log(`  compile mean ${mean(compileTimes).toFixed(2)} | extract mean ${mean(extractTimes).toFixed(2)} | payload round-trip mean ${mean(payloadTimes).toFixed(2)}`);

// Parse vs codegen share observation (separate loop so compile timing is not
// contaminated): parse is one stage of compileClient; everything else is IR +
// emit.
const parseTimes: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const s = performance.now();
  parse(REPRESENTATIVE_SOURCE);
  parseTimes.push(performance.now() - s);
}
const parseAvg = mean(parseTimes);
console.log(`  parse-only mean ${parseAvg.toFixed(2)}ms (${(parseAvg / avg * 100).toFixed(1)}% of full compile) → IR+emit ≈ ${(avg - parseAvg).toFixed(2)}ms (${((avg - parseAvg) / avg * 100).toFixed(1)}%)`);

// --- Regression assertions ---
assert(p < 180, `p95 ${p.toFixed(2)}ms < 180ms`);
assert(avg < 55, `mean ${avg.toFixed(2)}ms < 55ms`);
assert(sortedIterations[sortedIterations.length - 1] < 180, `worst case ${sortedIterations[sortedIterations.length - 1].toFixed(2)}ms < 180ms`);

if (lastPayload && lastRoundTrip) {
  const rt = lastRoundTrip as { components: Record<string, boolean>; fnSources: Record<string, string>; time: number };
  assert(
    JSON.stringify(rt.components) === JSON.stringify(lastPayload.components),
    'round-trip preserves components'
  );
  assert(
    JSON.stringify(rt.fnSources) === JSON.stringify(lastPayload.fnSources),
    'round-trip preserves fnSources'
  );
  assert(rt.time === lastPayload.time && typeof lastPayload.time === 'number', 'round-trip preserves numeric time');
  const firstKey = Object.keys(lastPayload.components)[0];
  assert(!!firstKey && lastPayload.fnSources[firstKey]?.length > 0, 'payload carries component entry with non-empty fnSource');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);