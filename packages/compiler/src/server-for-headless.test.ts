/**
 * `<For>` on the server: JSX inside a function-valued child, and arrays coming
 * back from a component.
 *
 * Three separate defects lived behind "For renders an empty list":
 *
 *   1. a function-valued child is not an IR node, so the JSX in its body was
 *      emitted verbatim and the render threw `Unexpected token '<'`;
 *   2. even once it compiled, the child was wrapped in the text emitter
 *      (`(() => { const __out = []; … })()`), so `For` called something that
 *      returned undefined and rendered nothing;
 *   3. `For` returns an ARRAY of strings, and pushing it into the output array
 *      went through `Array#toString`, joining the rows with commas.
 *
 * Run with: npx tsx packages/compiler/src/server-for-headless.test.ts
 */
import { renderPage, renderFullPage } from '@vesk/compiler/src/server-codegen';
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

const root = (html: string): string =>
  (html.match(/<div id="root">([\s\S]*?)<\/div>\n/) || [])[1]?.replace(/\s+/g, ' ').trim() || '';

async function body(source: string): Promise<string> {
  const html = await renderFullPage(source, 'App', {}, new Map(), { hydrate: true });
  return root(html);
}

console.log('\n=== For on the server ===');

it('renders rows from a JSX function child', async () => {
  const src = `component App() {
  const items = ['a', 'b']
  <ul>
    <For each={items}>{(item) => <li>{item}</li>}</For>
  </ul>
}`;
  assert(await body(src) === '<ul> <li> a </li> <li> b </li> </ul>', `got ${await body(src)}`);
});

it('renders rows when the list is a tracked cell', async () => {
  const src = `component App() {
  const &[items] = track(['x', 'y'])
  <ul>
    <For each={items}>{(item) => <li>{item}</li>}</For>
  </ul>
}`;
  assert((await body(src)).includes('<li> x </li>'), `got ${await body(src)}`);
});

it('For and the native for loop agree', async () => {
  const viaFor = await body(`component App() {
  const items = ['a', 'b']
  <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>
}`);
  const viaLoop = await body(`component App() {
  const items = ['a', 'b']
  <ul>
    for (const item of items) {
      <li>{item}</li>
    }
  </ul>
}`);
  assert(viaFor === viaLoop, `For gave ${viaFor} but the native loop gave ${viaLoop}`);
});

it('a row with attributes and a tracked read', async () => {
  const src = `component App() {
  const &[n, nCell] = track(7)
  <ul>
    <For each={['a']}>{(item) => <li class="row" data-n={get(nCell)}>{item}</li>}</For>
  </ul>
}`;
  const out = await body(src);
  assert(out.includes('class="row"'), `attribute lost: ${out}`);
  assert(out.includes('data-n="7"'), `dynamic attribute lost: ${out}`);
});

it('no commas between rows (an array result is concatenated, not stringified)', async () => {
  const out = await body(`component App() {
  const items = ['a', 'b', 'c']
  <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>
}`);
  assert(!out.includes('</li>,'), `rows were comma-joined: ${out}`);
  assert((out.match(/<li>/g) || []).length === 3, `expected 3 rows: ${out}`);
});

it('empty list renders the fallback', async () => {
  const out = await body(`component App() {
  const items: string[] = []
  <ul><For each={items} fallback={<li>none</li>}>{(item) => <li>{item}</li>}</For></ul>
}`);
  assert(out.includes('none'), `fallback not rendered: ${out}`);
});

it('nested JSX inside the child', async () => {
  const out = await body(`component App() {
  const rows = [{ title: 'A', tags: ['x'] }]
  <ul><For each={rows}>{(row) => <li><strong>{row.title}</strong></li>}</For></ul>
}`);
  assert(out.includes('<strong> A </strong>'), `nested JSX lost: ${out}`);
});

it('the client still compiles the same source (chunk output unchanged in kind)', () => {
  const src = `component App() {
  const items = ['a']
  <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>
}`;
  const code = compileClient(src, null, { hydrate: true });
  assert(code.includes('For'), 'the client bundle no longer references For');
  // The client bundle is bundled with esbuild's tsx loader, so JSX there is
  // legal — the fix must not have degraded it to a pre-rendered string.
  assert(/<li>/.test(code), 'the client lost its JSX child (it should still be JSX)');
});

it('SSR emits no raw JSX for a function child', async () => {
  const src = `component App() {
  const items = ['a']
  <ul><For each={items}>{(item) => <li>{item}</li>}</For></ul>
}`;
  const html = await renderFullPage(src, 'App', {}, new Map(), { hydrate: true });
  const bodyOnly = html.slice(html.indexOf('<div id="root">'));
  assert(!/>\s*<li>\{/.test(bodyOnly), 'JSX leaked into the served document');
});

console.log(`\n${'='.repeat(50)}`);
void chain.then(() => {
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All server For tests passed!');
});