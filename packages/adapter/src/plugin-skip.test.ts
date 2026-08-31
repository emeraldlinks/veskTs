/**
 * Build-time plugin-activation enforcement.
 *
 * An INACTIVE plugin must NEVER ship: it must not have any hook invoked and
 * must not influence CSS / transformed JS / platform output. Enforcement lives
 * in `index.ts` `build()`:
 *
 *   - the state read goes through `@vesk/adapter/src/plugins` (getPluginRecords
 *     → PluginRecord[]; else readPluginState → .vesk/plugins.json entries);
 *   - the live gate calls plugins.ts `filterActivePlugins` (record `name`
 *     matched case-insensitively, like the manager writes state);
 *   - if the module is missing the local `filterPluginsForBuild` fallback runs;
 *   - both produce `pluginsPipelines`, the ONLY array the three plugin loops
 *     iterate, and the skip log fires exactly once per dropped plugin.
 *
 * This test (1) unit-tests the pure filters with fake state and (2) statically
 * asserts the build() wiring.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterActivePlugins,
  filterPluginsForBuild,
  type PluginStateFile,
} from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function mkPlugin(name: string, hooks: Partial<Record<string, unknown>> = {}) {
  return { name, ...hooks } as { name: string; [k: string]: unknown };
}

async function main() {
  console.log('\n=== Build-time plugin activation enforcement ===');

  const active = mkPlugin('active-plugin', { onBuildEnd: () => {} });
  const inactive = mkPlugin('inactive-plugin', { onBuildEnd: () => {} });
  const noState = mkPlugin('no-state-plugin', { onBuildStart: () => {} });
  const plugins = [active, inactive, noState];

  const fakeState: PluginStateFile = {
    version: 1,
    plugins: [
      { name: 'active-plugin', active: true },
      { name: 'inactive-plugin', active: false },
    ],
  };

  const filtered = filterPluginsForBuild(plugins, fakeState);
  assert(filtered.length === 2, `keeps exactly the active + no-state plugins (got ${filtered.length})`);
  assert(filtered.includes(active), 'active plugin kept');
  assert(!filtered.includes(inactive), 'inactive plugin dropped');
  assert(filtered.includes(noState), 'plugin with no state record kept');

  assert(filterPluginsForBuild(plugins, null) === plugins, 'null state degrades to all-active (identity)');
  assert(filterPluginsForBuild(plugins, undefined) === plugins, 'undefined state degrades to all-active (identity)');

  const emptyState: PluginStateFile = { version: 1, plugins: [] };
  assert(filterPluginsForBuild(plugins, emptyState) === plugins, 'empty records keeps every plugin');

  assert(filterActivePlugins(plugins, [{ name: 'inactive-plugin', active: false }]).length === 2,
    'filterActivePlugins drops only the named inactive plugin');
  assert(filterActivePlugins(plugins, []).length === plugins.length,
    'filterActivePlugins with no records keeps all');

  // plugin-manager matching is case-insensitive (setPluginActive / getPluginRecords
  // use eqIgnoreCase) — the fallback must agree so a recased plugin still resolves.
  const recased = mkPlugin('MIXED-Case-Plugin', {});
  assert(filterActivePlugins([recased], [{ name: 'mixed-case-plugin', active: false }]).length === 0,
    'case-insensitive name match drops a recased inactive plugin');
  assert(filterActivePlugins([recased], [{ name: 'MIXED-CASE-PLUGIN', active: true }]).length === 1,
    'case-insensitive name match keeps a recased active plugin');
  assert(filterActivePlugins([recased], [{ name: 'unrelated-plugin', active: false }]).length === 1,
    'non-matching record does not drop a plugin');

  // Full PluginRecord[] (the shape getPluginRecords returns) must filter
  // identically to the minimal {name, active} view — only name + active count.
  const fullRecords: Array<PluginStateFile['plugins'][number] & Record<string, unknown>> = [
    { name: 'active-plugin', active: true, package: 'active-plugin', path: '/x', installed: true, source: 'config', error: null },
    { name: 'inactive-plugin', active: false, package: 'inactive-plugin', path: '/x', installed: true, source: 'config', error: null },
    { name: 'state-only-plugin', active: false, package: 'no-config', path: null, installed: false, source: 'state', error: null },
  ];
  const viaFull = filterPluginsForBuild(plugins, { version: 1, plugins: fullRecords });
  assert(viaFull.length === 2 && !viaFull.includes(inactive) && viaFull.includes(noState),
    'full PluginRecord-shaped records filter identically (extras ignored)');

  // Filtered arrays share object references, so build()'s skip log
  // (plugins not in pluginsPipelines) can detect every dropped plugin.
  const dropped = plugins.filter(p => !filtered.includes(p));
  assert(dropped.length === 1 && dropped[0] === inactive, 'skipped set references the same inactive object');

  console.log('\n=== Static wiring check of index.ts build() ===');

  const src = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');

  const pipelineLoops = (src.match(/for \(const plugin of pluginsPipelines\)/g) || []).length;
  assert(pipelineLoops === 3, `all three plugin hook loops iterate pluginsPipelines (got ${pipelineLoops})`);

  const hookLoops = ['onBuildStart', 'onCSS', 'onBuildEnd'].filter(hook =>
    new RegExp(`for \\(const plugin of pluginsPipelines\\)[\\s\\S]{0,120}${hook}`).test(src),
  );
  assert(hookLoops.length === 3, `each hook has its own pluginsPipelines loop (got: ${hookLoops.join(', ') || 'none'})`);

  const rawLoops = (src.match(/for \(const plugin of plugins\)/g) || []).length;
  assert(rawLoops === 1, `the only raw-plugins loop is the skip log (got ${rawLoops})`);
  const includesGates = (src.match(/pluginsPipelines\.includes\(plugin\)/g) || []).length;
  assert(includesGates === 1, `the skip log gates every raw plugin on pluginsPipelines.includes (got ${includesGates})`);

  const fallbackGateCalls = (src.match(/filterPluginsForBuild\(plugins/g) || []).length;
  assert(fallbackGateCalls === 1, `local filterPluginsForBuild is the single fallback gate (got ${fallbackGateCalls} call sites)`);
  const liveGateCalls = (src.match(/filterActivePlugins\(plugins, records\)/g) || []).length;
  assert(liveGateCalls === 1, `the live gate calls plugins.ts filterActivePlugins once (got ${liveGateCalls})`);
  assert(/import type \{ PluginRecord \} from '@vesk\/adapter\/src\/plugins'/.test(src),
    'index.ts types the plugin-manager module via its own PluginRecord type');
  assert(/vesk build: skipping inactive plugin/.test(src), 'the per-skipped-plugin log line exists');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main();