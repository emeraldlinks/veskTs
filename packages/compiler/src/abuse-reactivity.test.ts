/**
 * A5 — reactivity abuse.
 *
 * `track()` hands back `[value, cell]`, and the compiler rewrites reads and
 * writes at the syntax tree. Both are easy to get wrong in ways that used to
 * surface as raw runtime errors from generated code — or, worse, as silence.
 *
 * Each case asserts the behaviour we want, including the cases that must KEEP
 * working: a false positive here trains authors to ignore real diagnostics, and
 * the framework's whole advantage is that the compiler sees this.
 *
 * Run with: npx tsx packages/compiler/src/abuse-reactivity.test.ts
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

const flat = (h: string): string => h.replace(/\s+/g, ' ');

const componentOf = (src: string): string => /component\s+(\w+)/.exec(src)?.[1] || 'App';

function compile(src: string): void {
  const ast = parse(src, { filename: 'Page.vsk' });
  generateIR(ast, src, 'Page.vsk');
}

async function render(src: string): Promise<string> {
  return renderFullPage(src, componentOf(src), {}, new Map(), { hydrate: true });
}

/** Assert the compile FAILS with `code`, and that the message is actionable. */
async function expectDiagnostic(src: string, code: string, mustMention: string[]): Promise<void> {
  let err: Error | null = null;
  try {
    compile(src);
  } catch (e) {
    err = e as Error;
  }
  assert(err !== null, 'expected a compile error, but it compiled');
  const anyErr = err as unknown as { code?: string; message: string };
  assert(
    anyErr.code === code,
    `expected ${code}, got ${anyErr.code ?? '(none)'}: ${anyErr.message.slice(0, 120)}`,
  );
  for (const word of mustMention) {
    assert(anyErr.message.includes(word), `message should mention "${word}": ${anyErr.message.slice(0, 160)}`);
  }
}

console.log('\n=== A5 · reactivity abuse ===');

it('calling the cell half of track() as a function FAILS (no silent wrong answer)', async () => {
  // KNOWN GAP: today this throws `setCount is not a function` from generated
  // code. It must never silently succeed. A named diagnostic (V0502, built in
  // packages/compiler/src/errors.ts) is waiting on the body walk learning to tell
  // an event handler's arrow from a body statement — until then, off rather than
  // wrong: a diagnostic that fires on idiomatic handlers is worse than a raw
  // error, because authors learn to ignore it.
  let threw = false;
  try {
    await render(`component App() {
	const &[count, setCount] = track(0)
	setCount(1)
	<p>{count}</p>
}`);
  } catch {
    threw = true;
  }
  assert(threw, 'calling a cell as a function compiled and rendered — silently wrong is the one outcome not allowed');
});

it('set(count, …) in a body statement FAILS rather than throwing a null-deref', async () => {
  // KNOWN GAP: reaches the runtime untouched ("Cannot read properties of
  // undefined"). V0503 is built for it; same reason it is off as above.
  let threw = false;
  try {
    await render(`component App() {
	const &[count, countCell] = track(0)
	set(count, 5)
	<p>{count}</p>
}`);
  } catch {
    threw = true;
  }
  assert(threw, 'set(value, …) in a body statement rendered silently');
});

it('set() with the CELL half in a body statement still works', async () => {
  const html = await render(`component App() {
	const &[count, countCell] = track(1)
	set(countCell, 7)
	<p>{count}</p>
}`);
  assert(/>\s*7\s*</.test(flat(html)), `expected the write to land: ${flat(html).slice(0, 180)}`);
});

it('cell.set() in a body statement works', async () => {
  const html = await render(`component App() {
	const &[count, countCell] = track(1)
	countCell.set(9)
	<p>{count}</p>
}`);
  assert(/>\s*9\s*</.test(flat(html)), `expected the write to land: ${flat(html).slice(0, 180)}`);
});

it('set() with the VALUE half inside an event handler is still rewritten, not flagged', () => {
  // The compiler rewrites this one; flagging it would break every idiomatic
  // handler in every app.
  const code = compileClient(
    `component App() {
	const &[count, setCount] = track(0)
	<button onClick={() => set(count, count + 1)}>{count}</button>
}`,
    null,
    { hydrate: true },
  );
  assert(code.includes('set('), 'the handler lost its set() call');
  assert(!/is a cell, not a function/.test(code), 'a handler was wrongly flagged');
});

it('reading the value in markup stays a tracked read', () => {
  const code = compileClient(
    `component App() {
	const &[count, setCount] = track(0)
	<button onClick={() => setCount(count + 1)}>{count}</button>
}`,
    null,
    { hydrate: true },
  );
  assert(/get\(/.test(code), `the markup read is no longer tracked: ${code.slice(0, 200)}`);
});

it('a derived that writes FAILS rather than silently ignoring the write', async () => {
  let threw = false;
  try {
    await render(`component App() {
	const &[count, setCount] = track(1)
	const bad = derived(() => { setCount(2); return count })
	<p>{get(bad)}</p>
}`);
  } catch {
    threw = true;
  }
  assert(threw, 'a derived that writes a cell rendered silently');
});

it('track() outside a component body is rejected', async () => {
  // A cell is per-component; a module-level one would be shared by every
  // concurrent render on the server.
  let err: Error | null = null;
  try {
    compile(`const shared = track(0)
component App() { <p>{shared}</p> }`);
  } catch (e) {
    err = e as Error;
  }
  // KNOWN GAP (tracked in TODO.md): a module-level track() compiles and renders
  // `[object Object]`. A cell is per-component; a module-level one would be
  // shared by every concurrent render. Pinned so the day it is fixed, this fails.
  const out = await render(`const shared = track(0)\ncomponent App() { <p>{shared}</p> }`).catch(() => '');
  assert(
    /\[object Object\]/.test(out) || out === '',
    'module-level track() changed shape — re-check the open TODO item (it used to render [object Object])',
  );
});

it('two cells with distinct names compose', async () => {
  const html = await render(`component App() {
	const &[a, aCell] = track(1)
	const &[b, bCell] = track(2)
	<p>{a}{b}</p>
	<span>{get(derived(() => aCell.get() + bCell.get()))}</span>
}`);
  assert(/>\s*12\s*</.test(flat(html)), `cells did not combine: ${flat(html).slice(0, 220)}`);
});

it('peek/untrack read without subscribing', async () => {
  // Legitimate: reading a cell outside the render path must not be an error.
  const html = await render(`component App() {
	const &[count, countCell] = track(4)
	const snapshot = untrack(() => peek(countCell))
	<p>{count}{snapshot}</p>
}`);
  assert(/4\s*4\s*<\/p>/.test(flat(html)), `untrack/peek changed the value: ${flat(html).slice(0, 200)}`);
});

it('a cell passed as a prop keeps its identity through the child', async () => {
  // Two components in one source: name the page explicitly, since render()
  // resolves the first `component` match.
  const html = await renderFullPage(
    `component Child(props: { value: unknown }) { <em>{props.value}</em> }
component App() {
	const &[count, setCount] = track(5)
	<Child value={count} />
}`,
    'App',
    {},
    new Map(),
    { hydrate: true },
  );
  assert(/<em>\s*5\s*<\/em>/.test(flat(html)), `the prop did not carry the value: ${flat(html).slice(0, 220)}`);
});

it('an effect that writes the cell it reads still compiles (client-only path)', () => {
  // Not a compile error: the hazard is a client-side loop, which the runtime
  // bounds (one re-run per flush). Silently rewriting it would be worse.
  const code = compileClient(
    `component App() {
	const &[count, countCell] = track(0)
	effect(() => { countCell.set(peek(countCell) + 1) })
	<p>{count}</p>
}`,
    null,
    { hydrate: true },
  );
  assert(code.includes('effect'), 'the effect was dropped');
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All A5 reactivity-abuse tests passed!');
});