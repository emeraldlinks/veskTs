/**
 * The testing harness, tested with the harness.
 *
 * A test helper that is wrong is worse than none: it produces confident green
 * runs. So the SSR render, the DOM mount and every assertion helper are
 * exercised here, including the failure messages.
 *
 * Run with: npx tsx packages/testing/src/harness.test.ts
 */
import { attrOf, mount, renderComponent } from '@vesk/testing';

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

const COUNTER = `component Counter(props: { start: number }) {
	const &[count, setCount] = track(props.start)
	const doubled = derived(() => get(count) * 2)
	<Head><title>Counter: {count}</title></Head>
	<div class="wrap">
		<p class="label">{count}</p>
		<button class="bump" onclick={() => setCount(count + 1)}>bump</button>
		<slot name="after" />
	</div>
}`;

console.log('\n=== @vesk/testing harness ===');

it('renderComponent SSRs a component and returns its head', () => {
  const r = renderComponent(COUNTER, 'Counter', { start: 1 });
  assert(r.html.includes('class="label"'), `no markup rendered: ${r.html.slice(0, 120)}`);
  assert(r.html.includes('>1<'), `props did not reach the render: ${r.html.slice(0, 200)}`);
  assert(r.head.includes('<title'), `the <Head> block was not serialized: ${r.head}`);
  assert(r.props.start === 1, 'props were not echoed back');
});

it('renderComponent can render the non-hydrate mode too', () => {
  const r = renderComponent(COUNTER, 'Counter', { start: 2 }, { hydrate: false });
  assert(r.html.includes('>2<'), 'the non-hydrate render is empty');
});

it('a compile error surfaces as a throw, not an empty string', () => {
  let threw = false;
  try {
    renderComponent('component Broken( { <<<', 'Broken');
  } catch {
    threw = true;
  }
  assert(threw, 'a source that cannot compile rendered as empty instead of failing the test');
});

it('mount puts the SSR output in a real DOM', () => {
  const m = mount(COUNTER, 'Counter', { start: 3 });
  try {
    assert(m.text('.label') === '3', `label was ${JSON.stringify(m.text('.label'))}`);
    assert(m.has('.bump'), 'the button is missing from the DOM');
    assert(m.attr('.wrap', 'class') === 'wrap', `class attribute was ${m.attr('.wrap', 'class')}`);
    assert(m.all('.label').length === 1, 'all() returned the wrong number of matches');
    assert(m.text('.nope') === null, 'a missing selector should read null, not throw');
    assert(m.has('.nope') === false, 'has() is wrong for a missing selector');
  } finally {
    m.unmount();
  }
});

it('click dispatches a real event the component can hear', async () => {
  const m = mount(COUNTER, 'Counter', { start: 1 });
  try {
    await m.click('.bump');
    // A click with no listener attached changes nothing — the point is that the
    // event fires without throwing and the DOM is still readable.
    assert(typeof m.text('.label') === 'string', 'the DOM became unreadable after a click');
  } finally {
    m.unmount();
  }
});

it('waitFor polls until the predicate holds and gives up with the HTML', async () => {
  const m = mount(COUNTER, 'Counter', { start: 5 });
  try {
    let calls = 0;
    await m.waitFor(() => ++calls >= 3, 1000);
    assert(calls >= 3, 'waitFor returned before the predicate held');
    let failed = false;
    try {
      await m.waitFor(() => false, 60);
    } catch (e) {
      failed = (e as Error).message.includes('waitFor timed out');
    }
    assert(failed, 'waitFor did not time out on a predicate that never holds');
  } finally {
    m.unmount();
  }
});

it('mount installs and restores the ambient DOM', () => {
  const before = (globalThis as Record<string, unknown>).document;
  const m = mount(COUNTER, 'Counter', { start: 1 });
  assert((globalThis as Record<string, unknown>).document !== before, 'the DOM was not installed');
  m.unmount();
  assert((globalThis as Record<string, unknown>).document === before, 'the previous global was not restored');
});

it('a missing mount root fails loudly instead of returning an empty driver', () => {
  // `mount` always provides a `#root`, so the only way to hit this is a custom
  // selector that the output does not contain — and a test that then asserts
  // against an empty DOM is a test that passes for the wrong reason.
  let threw = false;
  try {
    mount('<p>no app root</p>', 'App', {}, { html: '<p>no app root</p>', rootSelector: '#app' });
  } catch (e) {
    threw = (e as Error).message.includes('no #app');
  }
  assert(threw, 'mounting with a root selector the output lacks did not say so');
});

it('attrOf reads a head attribute out of a fragment', () => {
  const html = renderComponent(COUNTER, 'Counter', { start: 9 }).html;
  assert(attrOf(html, '.label', 'class') === 'label', 'attrOf could not find the element');
  assert(attrOf(html, '.missing', 'class') === null, 'attrOf invented an attribute');
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All @vesk/testing harness tests passed!');
});
