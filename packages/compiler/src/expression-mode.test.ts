/**
 * Expression-mode tests — exercise the same body-level features as
 * statement-mode.test.ts but written as `return (<jsx>)` expression-mode
 * component bodies. Every body-level feature must work in both modes; this
 * file is the expression-mode counterpart.
 *
 * Run with: npx tsx packages/compiler/src/expression-mode.test.ts
 */
import { render } from './server-render.ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e) { failed++; console.log(`  \u2717 ${name} \u2014 ${(e as Error).message}`); }
}

function expect(actual: unknown) {
  return {
    toEqual(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(sub: string) {
      if (typeof actual !== 'string' || !actual.includes(sub)) {
        throw new Error(`expected to contain ${JSON.stringify(sub)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

// Expression mode: `return <jsx>` / `return (<jsx>)`.
function expr(body: string): string {
  return `component App {
  return (
    ${body}
  );
}`;
}

test('expr renders simple div', () => {
  const html = render('component App { return <div>Hello</div>; }', 'App');
  expect(html).toEqual('<div>Hello</div>');
});

test('expr renders dynamic prop text', () => {
  const html = render('component App(props) { return <h1>{props.title}</h1>; }', 'App', { title: 'Vesk' });
  expect(html).toEqual('<h1>Vesk</h1>');
});

test('expr for-of bare expression body renders', () => {
  const html = render(expr(`
    <div>
      for (const item of props.items)
      {item}
    </div>
  `), 'App', { items: ['a', 'b'] });
  expect(html).toEqual('<div>ab</div>');
});

test('expr for-of with nested parens iterable', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.getChild(props.root, props.index))
      {item}
    </ul>
  `), 'App', { root: ['a', 'b'], index: 0, getChild: (r: string[], i: number) => r[i] });
  expect(html).toEqual('<ul>a</ul>');
});

test('expr for-of with " of " inside a string literal', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.choose("of the day"))
      {item}
    </ul>
  `), 'App', { choose: (s: string) => [s] });
  expect(html).toEqual('<ul>of the day</ul>');
});

test('expr for-of with " in " inside a string literal is not split', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.pick("in the dark"))
      {item}
    </ul>
  `), 'App', { pick: (s: string) => [s] });
  expect(html).toEqual('<ul>in the dark</ul>');
});

test('expr for-of with nested array literal', () => {
  const html = render(expr(`
    <ul>
      for (const item of [["a"], ["b"]])
      {item}
    </ul>
  `), 'App', {});
  expect(html).toEqual('<ul>ab</ul>');
});

test('expr for-of with JSXElement body', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.items)
      <li>{item}</li>
    </ul>
  `), 'App', { items: ['x', 'y'] });
  expect(html).toEqual('<ul><li>x</li><li>y</li></ul>');
});

test('expr for-of with fragment body', () => {
  const html = render(expr(`
    <div>
      for (const item of props.items)
      <>{item}</>
    </div>
  `), 'App', { items: ['a', 'b'] });
  expect(html).toEqual('<div>ab</div>');
});

test('expr for-in loop over object keys', () => {
  const html = render(expr(`
    <ul>
      for (const k in props.obj)
      {k}
    </ul>
  `), 'App', { obj: { x: 1, y: 2 } });
  expect(html).toEqual('<ul>xy</ul>');
});

test('expr conditional && renders conditionally', () => {
  const html = render(expr(`
    <div>{props.ok && <span>yes</span>}</div>
  `), 'App', { ok: true });
  expect(html).toEqual('<div><span>yes</span></div>');
});

test('expr ternary renders correct branch', () => {
  const html = render(expr(`
    <div>{props.ok ? <p>yes</p> : <p>no</p>}</div>
  `), 'App', { ok: false });
  expect(html).toEqual('<div><p>no</p></div>');
});

test('expr guard-clause early return (brace form) short-circuits', () => {
  const early = render(`component App(props) {
    if (!props.ok) {
      return <p>early</p>
    }
    return <p>late</p>
  }`, 'App', { ok: false });
  expect(early).toEqual('<p>early</p>');
  const late = render(`component App(props) {
    if (!props.ok) {
      return <p>early</p>
    }
    return <p>late</p>
  }`, 'App', { ok: true });
  expect(late).toEqual('<p>late</p>');
});

test('expr guard-clause early return (no-brace form) short-circuits', () => {
  const early = render(`component App(props) {
    if (!props.ok) return <p>early</p>
    return <p>late</p>
  }`, 'App', { ok: false });
  expect(early).toEqual('<p>early</p>');
  const late = render(`component App(props) {
    if (!props.ok) return <p>early</p>
    return <p>late</p>
  }`, 'App', { ok: true });
  expect(late).toEqual('<p>late</p>');
});

test('expr multiple guard clauses short-circuit in order', () => {
  const html = render(`component App(props) {
    if (props.a) {
      return <p>A</p>
    }
    if (props.b) {
      return <p>B</p>
    }
    return <p>C</p>
  }`, 'App', { a: false, b: true });
  expect(html).toEqual('<p>B</p>');
});

test('expr guard-clause with return null renders nothing on guard', () => {
  const hidden = render(`component App(props) {
    if (!props.show) {
      return null
    }
    return <p>shown</p>
  }`, 'App', { show: false });
  expect(hidden).toEqual('');
  const shown = render(`component App(props) {
    if (!props.show) {
      return null
    }
    return <p>shown</p>
  }`, 'App', { show: true });
  expect(shown).toEqual('<p>shown</p>');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
