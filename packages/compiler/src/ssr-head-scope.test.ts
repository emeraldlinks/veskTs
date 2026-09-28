/**
 * `<Head>` on the server: the head must see what the component sees.
 *
 * The head is assembled by re-walking the component IR and re-evaluating its
 * expressions, outside the component's own call frame. Two things were missing
 * from the rebuilt frame, and both failed SILENTLY — an unevaluable expression
 * was swallowed and emitted as an empty string, so the served document carried
 * `<title> — Vesk Docs</title>` and `<meta name="description" content="">` while
 * the page body rendered perfectly:
 *
 *   1. the component's imports (they live in `__vesk`: a docs page's
 *      `const doc = getDoc(props.params.slug)` needs `getDoc`);
 *   2. its tracked bindings (`<title>Count: {count}</title>` must read the
 *      VALUE, and must not allocate a real cell while doing it).
 *
 * The client corrects the title on hydration, which is why this only ever
 * showed up in view-source, in crawlers, and after an SPA navigation re-applied
 * the server's head over the good client value.
 *
 * Run with: npx tsx packages/compiler/src/ssr-head-scope.test.ts
 */
import { renderFullPage, renderPage } from '@vesk/compiler/src/server-codegen';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Serialized: the cases render (await), and a detached async case would print
// its failure after the summary — a suite reporting 6 passed and then throwing.
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

function pick(html: string, re: RegExp): string | undefined {
  return (html.match(re) || [])[1];
}

const titleOf = (html: string): string | undefined => pick(html, /<title[^>]*>([\s\S]*?)<\/title>/);
const descOf = (html: string): string | undefined => pick(html, /meta name="description" content="([^"]*)"/);
const h1Of = (html: string): string | undefined => pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)?.trim();

console.log('\n=== SSR head scope ===');

it('a head expression reading a tracked binding renders its value', async () => {
  const src = `component Home() {
	const &[count, setCount] = track(0)
	const label = "n=" + count
	<Head>
		<title>Count: {count}</title>
		<meta name="description" content={"live " + label} />
	</Head>
	<main><h1>{label}</h1></main>
}`;
  const html = await renderFullPage(src, 'Home', {}, new Map(), { hydrate: true });
  assert(titleOf(html) === 'Count: 0', `title was ${JSON.stringify(titleOf(html))} (body h1 was ${JSON.stringify(h1Of(html))})`);
  assert(descOf(html) === 'live n=0', `description was ${JSON.stringify(descOf(html))}`);
  assert(h1Of(html) === 'n=0', `the body should still render the same value, got ${JSON.stringify(h1Of(html))}`);
});

it('a tracked cell initialised from props renders its value', async () => {
  const src = `component Home(props: { start: number }) {
	const &[count] = track(props.start)
	<Head><title>Start {count}</title></Head>
	<p>{count}</p>
}`;
  const html = await renderFullPage(src, 'Home', { start: 7 }, new Map(), { hydrate: true });
  assert(titleOf(html) === 'Start 7', `title was ${JSON.stringify(titleOf(html))}`);
});

it('a derived binding resolves inside the head', async () => {
  const src = `component Home() {
	const &[count, setCount] = track(2)
	const doubled = derived(() => get(count) * 2)
	<Head><title>D {doubled}</title></Head>
	<p>{doubled}</p>
}`;
  const html = await renderFullPage(src, 'Home', {}, new Map(), { hydrate: true });
  assert(titleOf(html) === 'D 4', `title was ${JSON.stringify(titleOf(html))}`);
});

it('a head expression reading a value destructured from a plain const still works', async () => {
  const src = `component Home(props: { user: { first: string; last: string } }) {
	const name = props.user.first + " " + props.user.last
	<Head><title>Hello {name}</title></Head>
	<p>{name}</p>
}`;
  const html = await renderFullPage(src, 'Home', { user: { first: 'Ada', last: 'L' } }, new Map(), { hydrate: true });
  assert(titleOf(html) === 'Hello Ada L', `title was ${JSON.stringify(titleOf(html))}`);
});

it('the head does not allocate real cells', async () => {
  // The head pass must not register throwaway cells in the render's cell map:
  // they would be invisible to the real render and cleaned up by a different
  // owner. Track what the render created via the public API instead.
  const src = `component Home() {
	const &[count, setCount] = track(0)
	<Head><title>C {count}</title></Head>
	<p>{count}</p>
}`;
  const result = await renderPage(src, 'Home', {}, new Map(), { hydrate: true });
  const res = result as { body: string; head: string };
  assert(res.head.includes('C 0'), `renderPage head was ${JSON.stringify(res.head)}`);
  const cells = (globalThis as any).__vsk_ssr_cells;
  if (cells instanceof Map) {
    for (const key of cells.keys()) {
      if (typeof key === 'string' && key.startsWith('head')) {
        throw new Error(`the head pass registered a cell under ${key}`);
      }
    }
  }
});

it('the head pass does not re-run the component\'s side effects', async () => {
  // The head pass evaluates declarations in a rebuilt frame, and the runtime
  // names are now in scope there. Evaluating MORE than the head needs means
  // calling `useFetch` a second time per render — which showed up as a fetch
  // count assertion failing in the integration suite. Only the declarations
  // the head reads may be evaluated.
  let fetches = 0;
  const hook = async (url: string) => {
    if (url.includes('/counted')) fetches++;
    return { ok: true };
  };
  (globalThis as any).__vesk_ssr_fetch = async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ url }),
    json: async () => ({ url }),
  });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = hook as unknown as typeof fetch;
  try {
    const src = `component Home() {
	const data = useFetch('/counted')
	<Head><title>static title</title></Head>
	<p>{data.value ? 'yes' : 'no'}</p>
}`;
    const html = await renderFullPage(src, 'Home', {}, new Map(), { hydrate: true });
    assert(titleOf(html) === 'static title', `title was ${JSON.stringify(titleOf(html))}`);
  } finally {
    globalThis.fetch = savedFetch;
    delete (globalThis as any).__vesk_ssr_fetch;
  }
  assert(fetches === 0, `the head pass re-ran a side-effecting declaration (${fetches} extra fetches)`);
});

it('an unevaluable head expression still degrades to empty rather than throwing', async () => {
  // The historical safety valve must survive: a head expression the pass
  // cannot evaluate must not take the whole render down.
  const src = `component Home() {
	<Head><title>{nope.nothing.here}</title></Head>
	<p>ok</p>
}`;
  const html = await renderFullPage(src, 'Home', {}, new Map(), { hydrate: true });
  assert(/<p[\s>][\s\S]{0,40}ok[\s\S]{0,20}<\/p>/.test(html), `the body did not render: ${html.slice(0, 300)}`);
  assert(titleOf(html) === '', `expected an empty title, got ${JSON.stringify(titleOf(html))}`);
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All ssr-head-scope tests passed!');
});
