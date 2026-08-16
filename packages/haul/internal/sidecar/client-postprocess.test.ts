/**
 * Unit tests for the sidecar's compiled-client postprocessor.
 *
 * postprocessClientCode replaces the regex-based scaffolding stripping the Go
 * bundler used to do (collectRuntimeImports / stripRuntimeImport /
 * stripVskImports / stripExports). It must:
 *   - strip the generated `@vesk/runtime` import and collect its names,
 *   - strip `.vsk` imports,
 *   - strip the `const __components = {};` / `const __hydrators = {};`
 *     declarations, the `__cleanup`/`__place` helper definitions and the
 *     trailing `export ... __components[...]` lines,
 *   - leave user code bytes untouched, and
 *   - work on compiler output that redeclares imported bindings (a generated
 *     runtime import plus a user import of the same names), which a strict
 *     AST parse rejects — hence the tokenizer. Raw JSX in top-level code
 *     defeats the tokenizer, so a full-parse fallback covers that.
 *
 * The primary case is generated through the real `compileClient`, so both
 * statement-mode and expression-mode component bodies are exercised.
 */
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { postprocessClientCode, rewriteRuntimeImportSources } from './client-postprocess';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function assertNoScaffold(code: string, msg: string) {
  assert(!/^\s*import\s/m.test(code), `${msg}: imports stripped`);
  assert(!code.includes('const __components = {};'), `${msg}: __components decl stripped`);
  assert(!code.includes('const __hydrators = {};'), `${msg}: __hydrators decl stripped`);
  assert(!/function __cleanup\(/.test(code), `${msg}: __cleanup definition stripped`);
  assert(!/function __place\(/.test(code), `${msg}: __place definition stripped`);
  assert(!/export\s+default\s+__components/.test(code), `${msg}: default export stripped`);
  assert(!/export\s+const\s+\w+\s*=\s*__components/.test(code), `${msg}: named exports stripped`);
}

function main() {
  console.log('--- real compiled output (duplicate runtime imports) ---');
  const statementSrc = `import { track } from "@vesk/runtime"

component Counter() {
	const &[count] = track(1)
	<p>{count}</p>
	if (count() > 1) { <p>big</p> }
	<button onClick={() => count++}>+</button>
}
`;
  const compiled = compileClient(statementSrc, null, { forceClient: true });
  assert(compiled.includes("from '@vesk/runtime'"), 'generated runtime import present in compiled output');
  assert(compiled.includes('const __components = {};'), 'components decl present in compiled output');

  const r = postprocessClientCode(compiled);
  assertNoScaffold(r.code, 'statement mode');
  for (const name of ['track', 'get', 'set', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'reactiveProps', 'effect']) {
    assert(r.runtimeImports.includes(name), `runtimeImports includes ${name}`);
  }
  assert(r.runtimeImports.filter((n) => n === 'track').length === 1, 'duplicate user/generated imports deduped');
  assert(r.code.includes('const count = track(1);'), 'user code preserved');
  assert(r.code.includes('__components["Counter"] = (props) => {'), 'component body preserved');
  assert(!r.code.includes('__cleanup(') || /__cleanup\(/.test(r.code), 'helper call sites may remain, definitions are gone');

  const hydrated = compileClient(statementSrc, null, { forceClient: true, hydrate: true });
  const rh = postprocessClientCode(hydrated);
  assertNoScaffold(rh.code, 'hydrate mode');
  assert(rh.runtimeImports.includes('hydrate'), 'hydrate names collected');
  assert(rh.runtimeImports.includes('collectVskMarkers'), 'hydrate walker names collected');

  console.log('--- hand-written edge cases ---');
  const expSrc = [
    "import { foo as bar } from '@vesk/runtime';",
    "import { type TypeOnly, get as g, set } from '@vesk/runtime';",
    "import Default from './comp.vsk';",
    "import * as ns from './other.vsk';",
    '',
    'const __components = {};',
    '',
    '__components["A"] = (props) => { return null; };',
    '',
    'function __cleanup(start, end) { let n = start.nextSibling; }',
    'function __place(start, end, nodes, fallback) { fallback.appendChild(start); }',
    '',
    'export default __components["A"];',
    'export const Named = __components["Named"];',
    'export const NotAComponent = 42;',
  ].join('\n');
  const re = postprocessClientCode(expSrc);
  assertNoScaffold(re.code, 'edge cases');
  assert(re.runtimeImports.includes('foo'), 'import name collected before `as` alias');
  assert(re.runtimeImports.includes('get'), 'aliased specifier collected by imported name');
  assert(re.runtimeImports.includes('set'), 'plain specifier collected');
  assert(!re.runtimeImports.includes('TypeOnly'), 'type-only specifier skipped');
  assert(!re.runtimeImports.includes('bar'), 'alias target not collected');
  assert(!re.code.includes('.vsk'), 'default and namespace .vsk imports stripped');
  assert(re.code.includes('export const NotAComponent = 42;'), 'non-component export preserved');
  assert(re.code.includes('__components["A"] = (props) => { return null; };'), 'component assignment preserved');

  console.log('--- JSX-in-top-level fallback (AST parse) ---');
  const jsxSrc = [
    "import { track, get, set } from '@vesk/runtime';",
    "const layout = <div class=\"x\">hi</div>;",
    'const __components = {};',
    '__components["A"] = (props) => { return layout; };',
    'function __cleanup(start, end) { let n = start.nextSibling; }',
    'export default __components["A"];',
    'export const Named = __components["Named"];',
  ].join('\n');
  const rj = postprocessClientCode(jsxSrc);
  assertNoScaffold(rj.code, 'JSX fallback');
  assert(rj.runtimeImports.join(',') === 'track,get,set', 'JSX fallback collects runtime names');
  assert(rj.code.includes('const layout = <div class="x">hi</div>;'), 'JSX top-level code preserved');

  console.log('--- semicolon-less imports must not overrun into the next statement ---');
  const noSemiSrc = [
    "import { track } from '@vesk/runtime'",
    "const signup = {",
    '\t__veskAction: true,',
    "\tid: '-sickcy',",
    "\turl: '/_vesk/action/-sickcy'",
    '};',
    'const __components = {};',
    '__components["Actions"] = (props) => { return signup; };',
    'export default __components["Actions"];',
  ].join('\n');
  const rn = postprocessClientCode(noSemiSrc);
  assertNoScaffold(rn.code, 'no-semicolon imports');
  assert(rn.runtimeImports.join(',') === 'track', 'no-semicolon import collects only its specifiers');
  assert(rn.code.includes('const signup = {'), 'following statement preserved after semicolon-less import');
  assert(rn.code.includes('__veskAction: true'), 'block body preserved after semicolon-less import');
  assert(rn.code.includes('id: \'-sickcy\''), 'block keys not treated as import specifiers');
  assert(rn.code.includes('__components["Actions"] = (props) => { return signup; };'), 'component assignment preserved');

  console.log('--- rewriteRuntimeImportSources ---');
  const rw = rewriteRuntimeImportSources(
    [
      "import { foo } from '@vesk/runtime';",
      "import { bar } from '@vesk/runtime/server-utils';",
      "import { x } from './local';",
      "export { baz } from '@vesk/runtime/actions';",
      "export * from '@vesk/runtime/ssr';",
      "export const keep = 1;",
    ].join('\n')
  );
  assert(rw.includes("from '../runtime.js'"), 'bare runtime import rewritten');
  assert(rw.includes("from '../runtime.js'"), 'subpath runtime import rewritten');
  assert(rw.includes("from './local'"), 'local import untouched');
  assert(!rw.includes('@vesk/runtime'), 'no @vesk/runtime specifier remains');
  assert(rw.includes('export const keep = 1;'), 'plain export untouched');

  const rwJsx = rewriteRuntimeImportSources("import { a } from '@vesk/runtime';\nconst x = <div/>;\nexport * from '@vesk/runtime/ssr';\n");
  assert(!rwJsx.includes('@vesk/runtime'), 'JSX route sources rewritten via AST fallback');

  console.log('--- unchanged passthrough ---');
  const plain = postprocessClientCode('const x = 1;\nexport const y = 2;\n');
  assert(plain.code === 'const x = 1;\nexport const y = 2;\n', 'no scaffolding -> unchanged');
  assert(plain.runtimeImports.length === 0, 'no runtime names collected');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main();
