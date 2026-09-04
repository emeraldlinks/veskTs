/**
 * Regression test: per-file top-level bindings must not collide in the client
 * chunk. Two `.vsk` files declaring the same top-level name (e.g. both define
 * `const stages`) used to be concatenated into one module scope, so the whole
 * chunk threw `SyntaxError: Identifier 'stages' has already been declared` at
 * load and the page never hydrated.
 *
 * Asserts (statement-mode Alpha, expression-mode Beta — both body modes):
 *   - every emitted JS asset still parses as a module (no SyntaxError)
 *   - both files' `stages` bindings survive, block-scoped per file
 */
import { generateClientBundle, buildHmrEvalSnippet } from '@vesk/adapter/src/client-bundle';
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

function countTopLevel(code: string, kind: string, name: string): number {
  let n = 0;
  try {
    const ast = parse(code) as { body?: Array<any> };
    for (const node of ast.body ?? []) {
      if (node.type === kind && node.declarations?.some((d: any) => d.id?.name === name)) n++;
    }
  } catch { n = -1; }
  return n;
}

async function main() {
  console.log('\n=== Client chunk per-file scope isolation ===');

  const dir = mkdtempSync(join(tmpdir(), 'vesk-cb-scope-'));
  const appDir = join(dir, 'app');
  const compDir = join(appDir, 'components');
  mkdirSync(compDir, { recursive: true });

  writeFileSync(join(compDir, 'Alpha.vsk'), `import { Search } from 'lucide-vesk'
import { fmt } from '../lib/fmt.ts'
const stages = ['alpha-one', 'alpha-two'];
component Alpha client {
	let &[i] = track(1);
	<span>{stages[i]}</span>
}
`);
  writeFileSync(join(compDir, 'Beta.vsk'), `const stages = ['beta-one', 'beta-two'];
component Beta {
	return <span>{stages[1]}</span>;
}
`);
  writeFileSync(join(appDir, 'page.vsk'), `import { Alpha } from './components/Alpha.vsk'
import { Beta } from './components/Beta.vsk'
component Home {
	return <div><Alpha /><Beta /></div>;
}
`);

  const tree = [{
    path: '', fullPath: '/', isGroup: false, isDynamic: false, isCatchAll: false,
    page: 'Page_Index', layout: null, loading: null, error: null, notFound: null,
    hasMiddleware: false, children: [], sourceDir: appDir, segmentCount: 0,
  }];
  const bundle = await generateClientBundle(tree as any, appDir, new Map(), {
    importRuntime: true,
    codeSplit: true,
  } as any);

  const assets: string[] = [bundle.main, ...(bundle.chunks ?? []).map((c: any) => c.code ?? c)];
  let parseable = 0;
  let unparseable = 0;
  for (const code of assets) {
    if (typeof code !== 'string' || code.length === 0) continue;
    try { parse(code); parseable++; }
    catch { unparseable++; }
  }
  await assert(parseable > 0 && unparseable === 0, `all emitted assets parse as modules (${parseable} ok, ${unparseable} failed)`);

  const all = assets.filter((c) => typeof c === 'string').join('\n');
  await assert(all.includes('alpha-one') && all.includes('beta-one'), 'both files’ bindings survive in the bundle');
  let topStages = 0;
  let saw = false;
  for (const code of assets) {
    if (typeof code !== 'string' || !code.includes('stages')) continue;
    saw = true;
    topStages += countTopLevel(code, 'VariableDeclaration', 'stages');
  }
  await assert(saw && topStages === 0, 'no top-level `const stages` remains in chunk scope (block-scoped per file)');

  let strayImport = false;
  // Main is a real module (its `/_vesk/runtime.js` preamble import is
  // legal); code-split chunks execute as classic scripts, so THEY must be
  // import-free.
  for (const c of bundle.chunks ?? []) {
    const code = (c as any).code ?? c;
    if (typeof code !== 'string') continue;
    try {
      const ast = parse(code) as { body?: Array<any> };
      for (const node of ast.body ?? []) {
        if (node.type === 'ImportDeclaration') { strayImport = true; break; }
      }
    } catch { /* unparseable already reported above */ }
    if (strayImport) break;
  }
  await assert(!strayImport, 'no import statements survive in classic-script chunks');

  // The island's component and hydrator must share one file block so the
  // hydrator still sees the file's top-level bindings (e.g. `stages`).
  // scopeFileContribution closes its block with a `}` at column 0, so any
  // such line between the two registrations means they were split apart.
  const chunkText = (bundle.chunks ?? []).map((c: any) => String((c as any).code ?? c)).join('\n');
  const compAt = chunkText.indexOf('__components["Alpha"]');
  const hydAt = chunkText.indexOf('__hydrators["Alpha"]');
  const between = compAt >= 0 && hydAt > compAt ? chunkText.slice(compAt, hydAt) : '';
  await assert(
    compAt >= 0 && hydAt > compAt && !/^}$/m.test(between),
    'component and hydrator share one file block',
  );

  // HMR eval snippets must carry the file's top-level scope without the
  // registry preamble, and survive repeated evals. A sliced per-component
  // assignment closes over file bindings (const navItems, …) missing from
  // the eval context, so the swapped component throws ReferenceError at
  // render and the swap fails silently (no reload, stale DOM, zero page
  // errors). A preamble `const __components = {}` shadows the live map.
  console.log('\n=== HMR eval snippet scope ===');
  {
    const fileCode = `import { Link } from '@vesk/runtime/router';
const __components = {};
const navItems = [{ label: 'Home', href: '/' }];
function helper() { return navItems.length; }
__components["Layout"] = (props) => {
  return helper() + navItems[0].label;
};
export default __components["Layout"];`;
    const snippet = buildHmrEvalSnippet(fileCode);

    let parses = true;
    try { parse(snippet); } catch { parses = false; }
    await assert(parses, 'snippet parses');

    await assert(!/^import\s/m.test(snippet), 'no imports survive in snippet');
    await assert(!/^export\s/m.test(snippet), 'no exports survive in snippet');
    await assert(!/const __components\s*=/.test(snippet), 'no registry preamble shadows the live map');
    await assert(snippet.includes('const navItems'), 'file top-level bindings travel with the snippet');
    await assert(snippet.includes('__components["Layout"]'), 'component registration travels with the snippet');

    // Eval twice against a live registry map (simulating two HMR updates
    // to the same file in one page lifetime): both evals must succeed and
    // both registrations must land on the live map.
    const live: Record<string, unknown> = {};
    (globalThis as Record<string, unknown>).__components = live;
    let firstThrow: unknown = null;
    let secondThrow: unknown = null;
    try { (0, eval)(snippet); } catch (e) { firstThrow = e; }
    await assert(firstThrow === null, 'first eval applies cleanly');
    await assert(typeof live['Layout'] === 'function', 'registration lands on the live map');
    let rendered = '';
    try { rendered = String((live['Layout'] as () => unknown)()); } catch (e) { rendered = 'THREW:' + String(e); }
    await assert(rendered === '1Home', 'rendered closure sees file bindings (got ' + rendered + ')');
    try { (0, eval)(snippet); } catch (e) { secondThrow = e; }
    await assert(secondThrow === null, 'second eval of the same file does not redeclare');
    delete (globalThis as Record<string, unknown>).__components;
  }

  rmSync(dir, { recursive: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
