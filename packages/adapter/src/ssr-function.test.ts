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
write('store/layout.vsk', `export const standalone = true;\ncomponent StoreLayout(props: { children?: any }) { return <div class="store">{props.children}</div>; }`);
write('store/page.vsk', `component StorePage() { return <div>Store Home</div>; }`);
// Nested boundaries. `docs/` owns both, so a NotFoundError or a throw under
// /docs must answer with the DOCS boundary and not the root one — the deepest
// match the client router already performs.
write('not-found.vsk', `component RootNotFound() { return <h1>ROOT NOT FOUND</h1>; }`);
write('docs/not-found.vsk', `component DocsNotFound() { return <h1>DOCS NOT FOUND</h1>; }`);
write('docs/error.vsk', `component DocsError(props: { error: string }) { return <h1>DOCS ERROR: {props.error}</h1>; }`);
// sourceDir is relative to the app root — generateSsrFunction resolves
// `resolve(appDir, sourceDir, ...)`, so files live under appRoot/app.
for (const f of [
  'layout.vsk', 'page.vsk', 'error.vsk', 'not-found.vsk',
  'docs/layout.vsk', 'docs/page.vsk', 'docs/[slug]/page.vsk', 'docs/not-found.vsk', 'docs/error.vsk',
  'store/layout.vsk', 'store/page.vsk',
]) {
  const from = join(appDir, f);
  const dest = join(appDir, 'app', f);
  mkdirSync(join(appDir, 'app', ...f.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(dest, readFileSync(from, 'utf-8'), 'utf-8');
  rmSync(from, { force: true });
}

const appRoot = { sourceDir: 'app', layoutCompName: 'Layout' };
const docsNode = { sourceDir: 'app/docs' };

function runFor(node, ancestorLayouts) {
  // `sourceDir` is ABSOLUTE in a real build — `scanDirectory` starts from the
  // resolved app dir and joins relative entries. `resolveBoundaryFile` walks it
  // with `relative(appDir, sourceDir)`, so a relative path would silently resolve
  // to no boundary at all. Passing the real shape here is what makes these
  // assertions about boundary selection mean anything.
  const absolutize = (n) => (n && n.sourceDir && !n.sourceDir.startsWith('/')
    ? { ...n, sourceDir: join(appDir, n.sourceDir) }
    : n);
  return generateSsrFunction(
    absolutize(node),
    appDir,
    outDir,
    new Map(),
    { ancestorLayouts: (ancestorLayouts || []).map(absolutize) },
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

{ // standalone layout — ancestor chain is cleared, only own layout in the list
  const code = runFor(
    { sourceDir: 'app/store', fullPath: '/store', layout: 'StoreLayout' },
    [],
  );
  assert(code.includes('_layoutCompList'), 'standalone route still emits a layout list');
  assert(code.includes('"StoreLayout"'), 'layout list contains only the standalone layout');
  assert(!code.includes('"Layout"'), 'root layout is NOT included for standalone routes');
  const layoutIdx = code.indexOf('"StoreLayout"');
  assert(layoutIdx !== -1, 'StoreLayout is present');
  assert(code.includes("renderFullPage('', _layoutCompList[0]"), 'standalone layout drives renderFullPage');
  assert(!code.includes('compileFile('), 'AOT: no runtime compile left in the function');
}

{ // standalone layout with ancestor passed (edge case: caller forgot to clear) —
  // still only uses what's in the list, but the scenario validates the SSR fn
  // respects whatever ancestorLayouts the caller provides.
  // When standalone clears ancestors upstream, ancestorLayouts is [].
  const code = runFor(
    { sourceDir: 'app/store', fullPath: '/store', layout: 'StoreLayout' },
    [{ sourceDir: 'app', layoutCompName: 'Layout' }],
  );
  assert(code.includes('"Layout", "StoreLayout"'), 'SSR fn uses whatever ancestors are passed (caller responsibility)');
}

console.log('\n\u2550\u2550\u2550 Request-scoped SSR token (data-nav) \u2550\u2550\u2550\n');

{ // `__vsk_ssr_token` is an AsyncLocalStorage-backed accessor (ssr-store.ts).
  // `delete globalThis.__vsk_ssr_token` removes a configurable property
  // definition outright — it does NOT route through the setter — so a single
  // SPA data-nav request would strip the accessor process-wide and every
  // later request would fall back to a shared, racy token.
  const withLayout = runFor({ sourceDir: 'app', fullPath: '/', layout: 'Layout' }, []);
  assert(
    !/delete\s+globalThis\.__vsk_ssr_token/.test(withLayout),
    'layout route must never `delete globalThis.__vsk_ssr_token` (it would destroy the request-scoped accessor)',
  );
  assert(
    withLayout.includes('delete globalThis[`__vsk_ssr_data_${__dnToken}`]'),
    'data-nav still clears its own per-token data slot',
  );
  const pageOnly = runFor({ sourceDir: 'app', fullPath: '/', layout: null }, []);
  assert(
    !/delete\s+globalThis\.__vsk_ssr_token/.test(pageOnly),
    'page-only route must never `delete globalThis.__vsk_ssr_token`',
  );
  // The data-nav branch renders through renderPage only, so it needs its own
  // request scope or its token is still live when the full-page render starts.
  const navIdx = withLayout.indexOf("x-vesk-data");
  const navBody = withLayout.slice(navIdx, withLayout.indexOf('return __renderHtml', navIdx));
  assert(navBody.includes('withSsrStore('), 'data-nav branch runs in its own withSsrStore scope');
}

{
  // A body that throws is not testable from source strings, so the nested
  // boundary behaviour is pinned here at the generation level and end-to-end in
  // nested-boundaries.test.ts. What is pinned here is the decision: which
  // boundary each route compiles in, and that a NotFoundError has a path that
  // renders it with a 404 instead of being re-thrown.
  const docsCode = runFor(
    { sourceDir: 'app/docs', fullPath: '/docs', layout: 'DocsLayout' },
    [appRoot],
  );
  assert(docsCode.includes('_notFoundComp'), 'a not-found boundary is compiled into the function');
  assert(docsCode.includes('__renderNotFoundBody'), 'not-found render path exists');
  assert(
    docsCode.includes('status: notFound ? 404 : (caughtError ? 500 : 200)'),
    'a not-found render answers 404, not 200',
  );
  assert(
    docsCode.includes('if (nfBody !== null)') && docsCode.includes('throw err;'),
    'with no boundary the original NotFoundError is re-thrown, so the server still answers 404',
  );
  assert(
    docsCode.includes("renderPage('', _notFoundComp"),
    'the boundary is rendered through renderPage',
  );
  assert(
    docsCode.includes('__wrapLayouts(params, _body'),
    'the not-found body goes through the shared layout wrap, so it keeps the app chrome',
  );

  // Deepest match: docs/not-found.vsk wins for /docs, the root one for /.
  assert(
    docsCode.includes('const _notFoundComp = "DocsNotFound"'),
    '/docs compiles the NESTED not-found boundary',
  );
  const rootCode = runFor({ sourceDir: 'app', fullPath: '/', layout: 'Layout' }, []);
  assert(
    rootCode.includes('const _notFoundComp = "RootNotFound"'),
    '/ compiles the root not-found boundary',
  );

  // No boundary anywhere on the route's path: the feature must degrade to
  // "re-throw and let the server answer", not to a broken render.
  const bareCode = runFor({ sourceDir: 'app/docs/[slug]', fullPath: '/docs/[slug]', layout: null }, []);
  assert(
    bareCode.includes('_notFoundComp'),
    'the not-found declarations are emitted for every route',
  );
}

{
  // The error boundary is a deepest match too, and predates this work — pinned
  // so a regression in resolveErrorFile is caught here rather than in a 500.
  const docsCode = runFor({ sourceDir: 'app/docs', fullPath: '/docs', layout: 'DocsLayout' }, [appRoot]);
  assert(docsCode.includes('const _errorComp = "DocsError"'), 'error boundary resolved for /docs');
  assert(docsCode.includes('__renderErrorBody'), 'error render path exists');
  const rootCode = runFor({ sourceDir: 'app', fullPath: '/', layout: 'Layout' }, []);
  assert(rootCode.includes('const _errorComp = "Error"'), 'root error boundary for /');
}

rmSync(appDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);