/**
 * Regression test: code-split chunk self-containment.
 *
 * A standalone layout resets the runtime match chain (`flattenLayoutChain`),
 * so the client loads only the standalone + page chunks — never the index
 * chunk. If a shared `.vsk` component (e.g. a Footer imported by both the root
 * and the standalone layout) was deduped into the index chunk by a single
 * global compile cache, the standalone chunk emits `__components["Footer"]`
 * references WITHOUT registering them → `TypeError: __components.Footer is
 * not a function` on first render.
 *
 * Asserts (root layout + standalone layout -> root node compiled first, docs
 * node second; both body modes covered by the statement-mode fixture):
 *   - both the index chunk and the standalone chunk register the shared
 *     component (`__components["Badge"] = ` and `__hydrators["Badge"] = `)
 *   - no chunk references the shared component without also registering it
 *   - all emitted chunk assets still parse as modules
 */
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { parse } from '@vesk/compiler/src/parser';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0;
let failed = 0;

async function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function codeOf(bundle: any, name: string): string {
  const entry = (bundle.chunks ?? []).find((c: any) => c.name === name);
  return entry ? String((entry as any).code ?? entry) : '';
}

async function main() {
  console.log('\n=== Code-split chunk self-containment (standalone shared component) ===');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-cs-'));
  const appDir = join(dir, 'app');
  const docsDir = join(appDir, 'docs');
  const compDir = join(appDir, 'components');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(compDir, { recursive: true });

  writeFileSync(join(compDir, 'Badge.vsk'), `component Badge {
\t<span class="shared-badge">Shared Badge</span>
}
`);
  writeFileSync(join(appDir, 'page.vsk'), `component Index {
\t<h1>Index</h1>
}
`);
  writeFileSync(join(appDir, 'layout.vsk'), `import { Badge } from './components/Badge.vsk'
export const standalone = false
component RootLayout(props: { children: any }) {
\t<main>{props.children}</main>
\t<footer><Badge /></footer>
}
`);
  writeFileSync(join(docsDir, 'page.vsk'), `component Docs {
\t<div class="docs-page">Docs</div>
}
`);
  writeFileSync(join(docsDir, 'layout.vsk'), `import { Badge } from '../components/Badge.vsk'
export const standalone = true
component DocsLayout(props: { children: any }) {
\t<main class="docs-shell">{props.children}</main>
\t<footer><Badge /></footer>
}
`);

  const tree = [{
    path: '', fullPath: '/', isGroup: false, isDynamic: false, isCatchAll: false,
    page: 'Page_Index', layout: 'Layout_Root', loading: null, error: null,
    notFound: null, offline: null, network: null, hasMiddleware: false,
    children: [{
      path: 'docs', fullPath: '/docs', isGroup: false, isDynamic: false,
      isCatchAll: false, page: 'Page_Docs', layout: 'Layout_Docs', loading: null,
      error: null, notFound: null, offline: null, network: null,
      hasMiddleware: false, children: [], sourceDir: docsDir, segmentCount: 1,
      standalone: true,
    }], sourceDir: appDir, segmentCount: 0,
  }];
  const bundle = await generateClientBundle(tree as any, appDir, new Map(), {
    importRuntime: true,
    codeSplit: true,
  } as any);

  const names = (bundle.chunks ?? []).map((c: any) => c.name);
  const indexCode = codeOf(bundle, 'page-index.js');
  const docsCode = codeOf(bundle, 'page-docs.js');

  await assert(names.length >= 2, `two chunks emitted − ${names.join(', ')}`);

  // Root node is compiled first, so with a global dedupe cache the shared
  // component lands ONLY in the index chunk and the standalone chunk would
  // reference it without registering. Both must register it.
  await assert(indexCode.includes('__components["Badge"] = '), 'index chunk registers __components["Badge"]');
  await assert(docsCode.includes('__components["Badge"] = '), 'standalone chunk registers __components["Badge"]');
  await assert(docsCode.includes('__hydrators["Badge"] = '), 'standalone chunk registers __hydrators["Badge"]');

  // Every chunk that references the shared component must also register it.
  let bucketsWithRefButNoReg = 0;
  for (const c of bundle.chunks ?? []) {
    const code = String((c as any).code ?? c);
    if (code.includes('__components["Badge"]') && !code.includes('__components["Badge"] = ')) {
      bucketsWithRefButNoReg++;
    }
  }
  await assert(bucketsWithRefButNoReg === 0, 'no chunk references __components["Badge"] without registering it');

  // Chunks execute as classic scripts — they must stay import-free and parse.
  let strayImport = false;
  let unparseable = 0;
  for (const c of bundle.chunks ?? []) {
    const code = String((c as any).code ?? c);
    try {
      const ast = parse(code) as { body?: Array<any> };
      for (const node of ast.body ?? []) {
        if (node.type === 'ImportDeclaration') { strayImport = true; break; }
      }
    } catch { unparseable++; }
  }
  await assert(!strayImport, 'no import statements survive in classic-script chunks');
  await assert(unparseable === 0, 'all chunk assets parse as modules');

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });