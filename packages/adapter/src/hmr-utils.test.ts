/**
 * Unit tests for the shareable HMR helpers in `hmr-utils.ts` (factored out of
 * `hmr.ts`): `extractComponentAssignments`, `extractSourceDir`, `escapeSource`.
 *
 * Runs pre-rebuild via the relative-source import; the same helpers will be
 * exercised end-to-end once `hmr.ts` imports from this module.
 */
import { extractComponentAssignments, extractSourceDir, escapeSource } from './hmr-utils';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

console.log('\n=== HMR utils ===');

// --- extractComponentAssignments: single assignment ---
{
  const code = [
    'const __components = {};',
    '__components["Hero"] = (props) => {',
    '  return { html: `<h1>${props.title}</h1>` };',
    '};',
    'export { __components };',
  ].join('\n');
  const out = extractComponentAssignments(code);
  assert(out.length === 1, 'single component assignment extracted');
  if (out[0]) {
    assert(out[0].name === 'Hero', 'assignment name captured');
    assert(out[0].raw.startsWith('__components["Hero"] = '), 'raw starts at the assignment');
    assert(out[0].raw.trimEnd().endsWith('};'), 'raw ends at the balanced closing brace');
    assert(out[0].raw.includes('return { html: `<h1>${props.title}</h1>` }'), 'raw keeps the full body');
    assert(out[0].raw === '__components["Hero"] = (props) => {\n  return { html: `<h1>${props.title}</h1>` };\n};', 'raw is the exact full assignment');
  }
}

// --- extractComponentAssignments: multiple components in one file ---
{
  const code = [
    'const __components = {};',
    '__components["A"] = (x) => { return { v: x }; };',
    'function other() {}',
    '__components["B"] = (y) => {',
    '  const doubled = y * 2;',
    '  return { w: doubled };',
    '};',
    'export { __components };',
  ].join('\n');
  const out = extractComponentAssignments(code);
  assert(out.length === 2, 'two component assignments extracted');
  assert(out[0] && out[0].name === 'A' && out[0].raw.includes('return { v: x }'), 'first assignment name + raw');
  assert(out[1] && out[1].name === 'B', 'second assignment name captured');
  assert(
    out[1] && out[1].raw === '__components["B"] = (y) => {\n  const doubled = y * 2;\n  return { w: doubled };\n};',
    'second assignment raw is balanced (nested inner braces did not truncate it)'
  );
}

// --- extractComponentAssignments: nested braces (object literal + inner fn) ---
{
  const code = [
    '__components["Card"] = (props) => {',
    "  const meta = { icon: 'x', badge: { text: props.label, color: props.hot ? 'red' : 'gray' } };",
    '  function pick(items) {',
    '    return items.map((it) => { return { id: it.id }; });',
    '  }',
    '  return { meta, pickTag: pick([{ id: 1 }])[0].id };',
    '};',
  ].join('\n');
  const out = extractComponentAssignments(code);
  assert(out.length === 1, 'single assignment extracted');
  assert(out[0] && out[0].name === 'Card', 'name captured');
  assert(
    out[0] && out[0].raw === code,
    'nested object-literal / inner-function braces stay balanced across the whole assignment'
  );
}

// --- extractComponentAssignments: error-style body with braces across lines ---
{
  const code = [
    '__components["Broken"] = (props) => {',
    '  try {',
    '    if (!props.ok) {',
    '      throw new Error("boom " + props.code);',
    '    }',
    "    return { ok: true, html: '<p>fine</p>' };",
    '  } catch (e) {',
    '    return { ok: false, message: e.message };',
    '  }',
    '};',
  ].join('\n');
  const out = extractComponentAssignments(code);
  assert(out.length === 1, 'error-body assignment extracted');
  assert(out[0] && out[0].name === 'Broken', 'name captured');
  assert(
    out[0] && out[0].raw === code,
    'braces spanning many lines (try/if/throw/catch) capture the full balanced assignment'
  );
}

// --- extractSourceDir ---
{
  assert(extractSourceDir('page.vsk') === '', 'page.vsk → empty sourceDir');
  assert(extractSourceDir('docs/page.vsk') === 'docs', 'docs/page.vsk → docs');
  assert(extractSourceDir('layout.vsk') === '', 'layout.vsk → empty sourceDir');
  assert(extractSourceDir('docs/layout.vsk') === 'docs', 'docs/layout.vsk → docs');
  assert(extractSourceDir('a/b/page.vsk') === 'a/b', 'a/b/page.vsk → a/b');
  assert(extractSourceDir('somepage.vsk') === null, 'somepage.vsk → null (no route)');
  assert(extractSourceDir('page.notvsk') === null, 'page.notvsk → null');
  assert(extractSourceDir('something/page.vskx') === null, 'something/page.vskx → null');
}

// --- escapeSource ---
{
  const input = 'const x = `a\\b ${name}$`;';
  const expected = 'const x = \\`a\\\\b \\${name}\\$\\`;';
  assert(escapeSource(input) === expected, 'backslashes, backticks and $ are all escaped');
  assert(escapeSource('no escaping needed') === 'no escaping needed', 'plain source passes through unchanged');
  assert(escapeSource('$`\\') === '\\$\\`\\\\', 'each special char maps to one escaped form');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);