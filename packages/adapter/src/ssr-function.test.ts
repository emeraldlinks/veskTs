/**
 * SSR Function Generation Tests — nested layout chain composition.
 *
 * Run with: npx tsx packages/adapter/src/ssr-function.test.ts
 */
import { generateSsrFunction } from '@vesk/adapter/src/ssr-function';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk SSR Function (nested layout) Tests \u2550\u2550\u2550\n');

const appDir = mkdtempSync(join(tmpdir(), 'vesk-ssr-fn-'));
const outDir = mkdtempSync(join(tmpdir(), 'vesk-ssr-out-'));

function write(rel, content) {
  const parts = rel.split('/');
  const file = join(appDir, ...parts);
  mkdirSync(join(appDir, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(file, content, 'utf-8');
}

write('layout.vsk', `component Layout(props: { children?: any }) { return <div class="root">{props.children}</div>; }`);
write('page.vsk', `component Page() { return <div>Home</div>; }`);
write('error.vsk', `component Error(props: { error: string }) { return <h1>{props.error}</h1>; }`);
write('docs/layout.vsk', `component DocsLayout(props: { children?: any }) { return <aside class="docs">{props.children}</aside>; }`);
write('docs/page.vsk', `component DocsPage() { return <div>Docs Index</div>; }`);
write('docs/[slug]/page.vsk', `component DocPage() { return <article>Doc Body</article>; }`);
// sourceDir is relative to the app root — generateSsrFunction resolves
// `resolve(appDir, sourceDir, ...)`, so files live under appRoot/app.
for (const f of ['layout.vsk', 'page.vsk', 'error.vsk', 'docs/layout.vsk', 'docs/page.vsk', 'docs/[slug]/page.vsk']) {
  const from = join(appDir, f);
  const dest = join(appDir, 'app', f);
  mkdirSync(join(appDir, 'app', ...f.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(dest, readFileSync(from, 'utf-8'), 'utf-8');
  rmSync(from, { force: true });
}

const appRoot = { sourceDir: 'app', layoutCompName: 'Layout' };
const docsNode = { sourceDir: 'app/docs' };

function runFor(node, ancestorLayouts) {
  return generateSsrFunction(
    node,
    appDir,
    outDir,
    new Map(),
    { ancestorLayouts },
  ).funcCode;
}

{ // [slug] page: nearest-only ancestor previously — must now compose full chain
  const code = runFor(
    { sourceDir: 'app/docs/[slug]', fullPath: '/docs/[slug]', layout: null },
    [appRoot, { sourceDir: 'app/docs', layoutCompName: 'DocsLayout' }],
  );
  assert(!code.includes('compileFile('), 'AOT: no runtime compile left in the function');
  assert(!code.includes('_pageSrc') && !code.includes('_layoutSrc'), 'AOT: no embedded .vsk source/paths');
  assert(code.includes('hydratePrecompile('), 'page/layout plans hydrate at load via hydratePrecompile');
  assert(code.includes('_layoutCompList'), 'dynamic page emits a layout list');
  assert((code.match(/_layoutCompList = \[/g) || []).length === 1, 'single layout list declared');
  assert(code.includes('"Layout", "DocsLayout"'), 'chain declares root then docs layout comps');
  const rootIdx = code.indexOf('"Layout"');
  const docsIdx = code.indexOf('"DocsLayout"');
  assert(rootIdx !== -1 && docsIdx !== -1 && rootIdx < docsIdx, 'root layout precedes docs layout in comp list');
  assert(code.includes('for (let _i = _layoutCompList.length - 1; _i > 0; _i--)'), 'server wraps page with inner layout first');
  assert(code.includes('for (let _i = _layoutCompList.length - 1; _i >= 0; _i--)'), 'data path collects head top-down');
  assert(code.includes("renderFullPage('', _layoutCompList[0]"), 'outermost layout drives renderFullPage');
  assert(!code.includes('const _layoutSrc = '), 'no stale single-layout binding remains');
  assert(!code.includes('const _layoutComp = '), 'no stale single-layout comp binding remains');
}

{ // docs/pages.vsk with OWN layout — chain includes own layout after ancestor
  const code = runFor(
    { sourceDir: 'app/docs', fullPath: '/docs', layout: 'DocsLayout' },
    [appRoot],
  );
  assert(code.includes('"Layout", "DocsLayout"'), 'own layout chained after ancestor');
  const rootIdx = code.indexOf('"Layout"');
  const docsIdx = code.indexOf('"DocsLayout"');
  assert(rootIdx !== -1 && docsIdx !== -1 && rootIdx < docsIdx, 'root layout precedes own docs layout');
  assert(code.includes("renderFullPage('', _layoutCompList[0]"), 'own nested layout composes over root');
  assert(!code.includes('compileFile('), 'AOT: no runtime compile left in the function');
}

{ // root page with NO ancestor layout — unchanged page-only stream path
  const code = runFor(
    { sourceDir: 'app', fullPath: '/', layout: null },
    [],
  );
  assert(!code.includes('_layoutCompList'), 'root page without layout keeps stream path');
  assert(code.includes("renderPageStream('', _comp"), 'page-only render uses renderPageStream');
  assert(!code.includes('compileFile('), 'AOT: no runtime compile left in the function');
}

rmSync(appDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);