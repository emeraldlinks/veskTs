/**
 * Statement-mode tests — exercise control-flow and expression handling in
 * statement-mode component bodies (bare JSX, `for`/`if`/`try`, guard-clause
 * early returns) plus the loop-body rendering paths that statement mode
 * routes through. Every body-level feature must work in statement mode.
 *
 * Run with: npx tsx packages/compiler/src/statement-mode.test.ts
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

// Statement mode: control flow at top level of the body (no `return`).
function stmt(body: string): string {
  return `component App {
  ${body}
}`;
}

// Expression mode: `return <jsx>`.
function expr(body: string): string {
  return `component App {
  return (
    ${body}
  );
}`;
}

// ── for-of loops with a bare expression body `{item}` ─────────────

test('stmt for-of bare expression body renders', () => {
  const html = render(stmt(`
    for (const item of props.items) {
      {item}
    }
  `), 'App', { items: ['x', 'y'] });
  expect(html).toEqual('xy');
});

test('stmt for-of bare expression body via expression mode renders', () => {
  const html = render(expr(`
    <div>
      for (const item of props.items)
      {item}
    </div>
  `), 'App', { items: ['a', 'b'] });
  expect(html).toEqual('<div>ab</div>');
});

test('stmt for-of with nested parens iterable', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.getChild(props.root, props.index))
      {item}
    </ul>
  `), 'App', { root: ['a', 'b'], index: 0, getChild: (r: string[], i: number) => r[i] });
  expect(html).toEqual('<ul>a</ul>');
});

test('stmt for-of with " of " inside a string literal', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.choose("of the day"))
      {item}
    </ul>
  `), 'App', { choose: (s: string) => [s] });
  expect(html).toEqual('<ul>of the day</ul>');
});

test('stmt for-of with " in " inside a string literal is not split', () => {
  const html = render(expr(`
    <ul>
      for (const item of props.pick("in the dark"))
      {item}
    </ul>
  `), 'App', { pick: (s: string) => [s] });
  expect(html).toEqual('<ul>in the dark</ul>');
});

test('stmt for-of with nested array literal', () => {
  const html = render(expr(`
    <ul>
      for (const item of [["a"], ["b"]])
      {item}
    </ul>
  `), 'App', {});
  expect(html).toEqual('<ul>ab</ul>');
});

test('stmt for-in loop over object keys', () => {
  const html = render(expr(`
    <ul>
      for (const k in props.obj)
      {k}
    </ul>
  `), 'App', { obj: { x: 1, y: 2 } });
  expect(html).toEqual('<ul>xy</ul>');
});

// ── side-effect guard: statement mode keeps calls as statements ───

test('stmt bare expression of a member call stays a side-effect statement', () => {
  // `log(item)` is a call — it must NOT be treated as renderable output.
  const html = render(stmt(`
    for (const item of props.items) {
      props.log(item)
      {item}
    }
  `), 'App', { items: ['a', 'b'], log: () => {} });
  // The side-effect call renders nothing; only the bare `{item}` renders.
  expect(html).toEqual('ab');
});

test('stmt bare assignment statement stays a side-effect statement', () => {
  const html = render(stmt(`
    let out = ''
    for (const item of props.items) {
      out += item
      {item}
    }
  `), 'App', { items: ['a', 'b'] });
  expect(html).toEqual('ab');
});

// ── statement mode keeps other statement kinds working ────────────

test('stmt classic for-loop still renders', () => {
  const html = render(stmt(`
    for (let i = 0; i < 3; i++) {
      <span>{i}</span>
    }
  `), 'App', {});
  expect(html).toEqual('<span>0</span><span>1</span><span>2</span>');
});

test('stmt if/else renders both branches', () => {
  const html = render(stmt(`
    if (props.ok) {
      <p>yes</p>
    } else {
      <p>no</p>
    }
  `), 'App', { ok: true });
  expect(html).toEqual('<p>yes</p>');
});

test('stmt guard-clause early return (brace form) short-circuits', () => {
  const early = render(stmt(`
    if (!props.ok) {
      return <p>early</p>
    }
    return <p>late</p>
  `), 'App', { ok: false });
  expect(early).toEqual('<p>early</p>');
  const late = render(stmt(`
    if (!props.ok) {
      return <p>early</p>
    }
    return <p>late</p>
  `), 'App', { ok: true });
  expect(late).toEqual('<p>late</p>');
});

test('stmt guard-clause early return (no-brace form) short-circuits', () => {
  const early = render(stmt(`
    if (!props.ok) return <p>early</p>
    return <p>late</p>
  `), 'App', { ok: false });
  expect(early).toEqual('<p>early</p>');
  const late = render(stmt(`
    if (!props.ok) return <p>early</p>
    return <p>late</p>
  `), 'App', { ok: true });
  expect(late).toEqual('<p>late</p>');
});

test('stmt guard-clause with return null renders nothing on guard', () => {
  const hidden = render(stmt(`
    if (!props.show) {
      return null
    }
    return <p>shown</p>
  `), 'App', { show: false });
  expect(hidden).toEqual('');
  const shown = render(stmt(`
    if (!props.show) {
      return null
    }
    return <p>shown</p>
  `), 'App', { show: true });
  expect(shown).toEqual('<p>shown</p>');
});

test('stmt bare return guard (brace form) renders nothing on guard', () => {
  // `if (c) return` (no argument) must still short-circuit: unlike `return
  // null` the bare form carries no argument, so guard detection must not
  // fall through and swallow the return.
  const hidden = render(stmt(`
    if (!props.show) {
      return
    }
    return <p>shown</p>
  `), 'App', { show: false });
  expect(hidden).toEqual('');
  const shown = render(stmt(`
    if (!props.show) {
      return
    }
    return <p>shown</p>
  `), 'App', { show: true });
  expect(shown).toEqual('<p>shown</p>');
});

test('stmt bare return guard (no-brace form) scopes following roots to the alternate', () => {
  // The VersionBadge shape: a bare-return guard in front of more roots. The
  // root must render only when the guard is not taken.
  const source = `
    if (!props.show) return
    <span>v{props.ver}</span>
  `;
  const hidden = render(stmt(source), 'App', { show: false, ver: '0.2.33' });
  expect(hidden).toEqual('');
  const shown = render(stmt(source), 'App', { show: true, ver: '0.2.33' });
  expect(shown).toEqual('<span>v0.2.33</span>');
});

test('stmt multiple guard clauses short-circuit in order', () => {
  const html = render(stmt(`
    if (props.a) {
      return <p>A</p>
    }
    if (props.b) {
      return <p>B</p>
    }
    return <p>C</p>
  `), 'App', { a: false, b: true });
  expect(html).toEqual('<p>B</p>');
});

test('stmt if/else with returns on each branch is not a guard clause', () => {
  // An if/else returning on both branches is a plain conditional, not an
  // early-return guard — it must render exactly one branch.
  const yes = render(stmt(`
    if (props.ok) {
      return <p>yes</p>
    } else {
      return <p>no</p>
    }
  `), 'App', { ok: true });
  expect(yes).toEqual('<p>yes</p>');
  const no = render(stmt(`
    if (props.ok) {
      return <p>yes</p>
    } else {
      return <p>no</p>
    }
  `), 'App', { ok: false });
  expect(no).toEqual('<p>no</p>');
});

test('stmt bare expression statement not in a loop still renders', () => {
  const html = render(stmt(`
    {props.title}
  `), 'App', { title: 'Hello' });
  expect(html).toEqual('Hello');
});

// ── `//` commented-out lines must not render or run (issue #1/#2) ──

test('stmt commented-out JSX element does not render', () => {
  const html = render(stmt(`
    <div>
      //<span class="old">OLD</span>
      <span>new</span>
    </div>
  `), 'App', {});
  expect(html).toEqual('<div><span>new</span></div>');
});

test('stmt commented-out expression does not render', () => {
  const html = render(stmt(`
    <div>
      <span>{props.count}</span>
      //{props.count + 100}
    </div>
  `), 'App', { count: 5 });
  expect(html).toEqual('<div><span>5</span></div>');
});

test('stmt multi-line commented-out if block compiles and renders nothing', () => {
  const html = render(stmt(`
    <div>
      //if (props.on) {
      //  <span>hidden</span>
      //}
      <span>shown</span>
    </div>
  `), 'App', { on: true });
  expect(html).toEqual('<div><span>shown</span></div>');
});

test('stmt commented-out statement is skipped', () => {
  const html = render(stmt(`
    const n = props.count
    //const n = 999
    <p>{n}</p>
  `), 'App', { count: 7 });
  expect(html).toEqual('<p>7</p>');
});

test('stmt block comment in JSX children does not leak markup', () => {
  const html = render(stmt(`
    <div>
      /* <span class="old">OLD</span> */
      <span>new</span>
    </div>
  `), 'App', {});
  expect(html).toEqual('<div><span>new</span></div>');
});

test('stmt block comment in JSX children does not evaluate its expression', () => {
  const html = render(stmt(`
    <div>
      <span>{props.count}</span>
      /* {props.count + 100} */
    </div>
  `), 'App', { count: 5 });
  expect(html).toEqual('<div><span>5</span></div>');
});

test('stmt multi-line block comment in JSX children renders nothing', () => {
  const html = render(stmt(`
    <div>
      /* <span>a</span>
         <span>b</span> */
      <span>new</span>
    </div>
  `), 'App', {});
  expect(html).toEqual('<div><span>new</span></div>');
});

test('stmt a string containing a block-comment marker is preserved', () => {
  const html = render(stmt(`
    <p>{props.s}</p>
  `), 'App', { s: '/* not a comment */' });
  expect(html).toEqual('<p>/* not a comment */</p>');
});

test('stmt MULTI-LINE {/* */} idiom renders nothing', () => {
  const html = render(stmt(`
    <div>
      {/* gone
          still gone */}
      <span>x</span>
    </div>
  `), 'App', {});
  expect(html).toEqual('<div><span>x</span></div>');
});

test('stmt both /* */ and {/* */} forms work together', () => {
  const html = render(stmt(`
    <div>
      {/* a */}
      /* b */
      <span>x</span>
    </div>
  `), 'App', {});
  expect(html).toEqual('<div><span>x</span></div>');
});

test('stmt a /*-looking run in JSX text is preserved (app/api/**/route.ts)', () => {
  // Regression: a scanner hunting for a missing `*/` blanked the rest of the
  // document and the build failed with "Unterminated JSX contents".
  const html = render(stmt(`
    <p>File <code>app/api/**/route.ts</code> at <code>/api/**</code>.</p>
  `), 'App', {});
  expect(html).toContain('app/api/**/route.ts');
  expect(html).toContain('/api/**');
});

test('stmt a props parameter may be named anything (React-style)', () => {
  expect(render(stmt(`
    <span>{p.title}</span>
  `).replace('component App {', 'component App(p) {'), 'App', { title: 'Hi' })).toEqual('<span>Hi</span>');
});

test('stmt a destructured props parameter still destructures', () => {
  const html = render(`component App({ title, body = 'd' }) {
	<span>{title}{body}</span>
}`, 'App', { title: 'T' });
  expect(html).toEqual('<span>Td</span>');
});

test('stmt a URL in JSX text is not treated as a comment', () => {
  const html = render(stmt(`
    <p>see https://vesk.dev/a//b now</p>
  `), 'App', {});
  expect(html).toEqual('<p>see https://vesk.dev/a//b now</p>');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
