/**
 * A8 — runtime/DOM abuse: browser globals in code the server evaluates.
 *
 * This suite is the DELIVERABLE of the abuse matrix: every case measured, with
 * the legitimate positions asserted to keep working. The behaviour it pins
 * today:
 *
 *   window / document / localStorage / addEventListener
 *     → a bare `ReferenceError` from GENERATED code, naming no component and no
 *       line of user code, at request time.
 *   navigator / location / setTimeout / setInterval
 *     → WORSE: no error. Modern Node ships `navigator`, so `navigator.onLine`
 *       silently reads undefined and the page renders as if the visitor were
 *       offline; a timer started in a body statement never gets cleaned up.
 *
 * A compile-time diagnostic for these was BUILT and then switched off, because
 * a walk that cannot distinguish a body statement from a hoisted `effect` or a
 * `typeof`-guarded branch fires on correct code — including this repo's own
 * `error.vsk` (`typeof document !== 'undefined' && !!document.querySelector(…)`).
 * The factories (`VeskError.ssrUnsafeGlobal`, code `V0501`) and the walk
 * (`abuse-checks.ts`) are still there; turning them on needs statement-hoisting
 * and guard analysis, which is real compiler work — see the TODO item.
 *
 * Run with: npx tsx packages/compiler/src/abuse-ssr-globals.test.ts
 */
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { renderFullPage } from '@vesk/compiler/src/server-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let chain: Promise<void> = Promise.resolve();
function it(name: string, fn: () => unknown): void {
  chain = chain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
      failures.push({ name, message: (e as Error).message });
    }
  });
}

function compile(src: string): void {
  const ast = parse(src, { filename: 'Page.vsk' });
  generateIR(ast, src, 'Page.vsk');
}

/** SSR must fail — or, for the silent ones, must fail to be observable. */
async function render(src: string, comp = 'App'): Promise<{ ok: boolean; html: string; err: string }> {
  try {
    const html = await renderFullPage(src, comp, {}, new Map(), { hydrate: true });
    return { ok: true, html, err: '' };
  } catch (e) {
    return { ok: false, html: '', err: (e as Error).message };
  }
}

console.log('\n=== A8 · runtime/DOM abuse ===');

it('window/document/localStorage in a body statement break the SSR render', async () => {
  for (const [label, src] of [
    ['window', `component App() {\n\tconst w = window.innerWidth\n\t<p>{w}</p>\n}`],
    ['document', `component App() {\n\tdocument.title = 'x'\n\t<p>hi</p>\n}`],
    ['localStorage', `component App() {\n\tconst v = localStorage.getItem('k')\n\t<p>{v}</p>\n}`],
  ] as const) {
    const r = await render(src);
    assert(!r.ok, `${label} in a body statement rendered on the server: ${r.html.slice(0, 160)}`);
    // Every one of these fails with a message that names neither the component
    // nor the line — which is exactly why a diagnostic was wanted.
    assert(/is not defined|of undefined/.test(r.err), `${label} failed unexpectedly: ${r.err.slice(0, 100)}`);
    assert(!/App|Page\.vsk/.test(r.err), `${label} leaked a component name into the raw error: ${r.err.slice(0, 100)}`);
  }
});

it('navigator is the SILENT one: modern Node ships it, so the page renders wrong', async () => {
  // This is the case that made a build-time check worth writing: no error, no
  // stack, just a page that thinks the visitor is offline.
  const r = await render(`component App() {\n\tconst on = navigator.onLine\n\t<p>{String(on)}</p>\n}`);
  assert(r.ok, 'expected the silent path: navigator exists on the server');
  assert(
    /undefined/.test(r.html),
    `expected an undefined read rendered into the page: ${r.html.slice(0, 200)}`,
  );
});

it('a timer started in a body statement is never cleaned up (SSR leak)', async () => {
  const r = await render(`component App() {\n\tsetTimeout(() => {}, 10)\n\t<p>hi</p>\n}`);
  assert(r.ok, 'a body-level setTimeout should render (and leak) rather than throw');
});

it('a {#client} block may use the DOM — it only runs in the browser', () => {
  compile(`component App client {
	<p>server part</p>
	{#client}
		const w = window.innerWidth
		<p>{w}</p>
	{/client}
}`);
});

it('a {#server} block runs during SSR, so a DOM read inside it breaks the render', async () => {
  const r = await render(`component App() {
	{#server}
		const w = window.innerWidth
		<p>{w}</p>
	{/server}
}`);
  assert(!r.ok, 'a {#server} block reading the DOM rendered — that block DOES run on the server');
});

it('an event handler may use the DOM — handlers never run on the server', () => {
  compileClient(
    `component App() {
	<button onClick={() => { document.title = 'clicked' }}>go</button>
}`,
    null,
    { hydrate: true },
  );
});

it('on_destroy may touch the DOM — it is only emitted on the client', () => {
  compileClient(
    `component App() {
	on_destroy(() => { window.addEventListener('resize', () => {}) })
	<p>hi</p>
}`,
    null,
    { hydrate: true },
  );
});

it('a property named like a global is not flagged (foo.window is a field)', () => {
  compile(`component App(props: { win: { innerWidth: number } }) {
	<p>{props.win.innerWidth}</p>
}`);
});

it('the word "window" in a string or comment is not flagged', () => {
  compile(`component App() {
	// we used to read window.innerWidth here
	const label = 'window.innerWidth is not available on the server'
	<p>{label}</p>
}`);
});

it('a plain component with no browser access is untouched', async () => {
  const html = await renderFullPage(
    `component App() {
	const n = 2 * 21
	<p>{n}</p>
}`,
    'App',
    {},
    new Map(),
    { hydrate: true },
  );
  assert(/42/.test(html), `a plain component stopped rendering: ${html.slice(0, 160)}`);
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All A8 SSR-globals tests passed!');
});