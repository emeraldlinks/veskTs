import { render } from './server-render.ts';
import { compileClient } from '@vesk/compiler/src/client-codegen';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}

function expect(actual: unknown) {
  return {
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`expected to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 300)}`);
      }
    },
    notToContain(expected: string) {
      if (typeof actual === 'string' && actual.includes(expected)) {
        throw new Error(`expected NOT to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual).slice(0, 300)}`);
      }
    },
  };
}

test('server: track with object-type generic renders property', () => {
  const source = `component App {
    let &[userCell] = track<{ id: number, name: string }>({ id: 7, name: 'ada' })
    <p>{userCell.name}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>ada</p>');
});

test('server: track with nested array generic renders nested value', () => {
  const source = `component App {
    let &[postCell] = track<{ tags: string[] }>({ tags: ['x', 'y'] })
    <p>{postCell.tags[1]}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>y</p>');
});

test('server: track with array-of-object generic renders', () => {
  const source = `component App {
    let &[listCell] = track<{ list: number[] }[]>([{ list: [5] }])
    <p>{listCell[0].list[0]}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>5</p>');
});

test('server: track with function init is invoked', () => {
  const source = `component App {
    let &[fnCell] = track(() => [1, 2])
    <p>{fnCell[0]}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>1</p>');
});

test('server: plain init without track call passes through', () => {
  const source = `component App {
    let &[plainCell] = [3, 4]
    <p>{plainCell[1]}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>4</p>');
});

test('client: object-type generic clause is stripped from track call', () => {
  const source = `component App {
    let &[userCell] = track<{ id: number, name: string }>({ id: 7, name: 'ada' })
    <p>{userCell.name}</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).toContain('const userCell = track({ id: 7, name: \'ada\' });');
  expect(code).notToContain('track<{');
});

test('client: array-of-object generic clause is stripped', () => {
  const source = `component App {
    let &[listCell] = track<{ list: number[] }[]>([{ list: [5] }])
    <p>x</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).notToContain('track<{');
  expect(code).toContain('const listCell = track([{ list: [5] }]);');
});

test('client: plain init without track is unchanged', () => {
  const source = `component App {
    let &[plainCell] = [3, 4]
    <p>{plainCell[1]}</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).toContain('const plainCell = [3, 4];');
});

test('server stmt-mode: track(v, get, set) shorthand renders initial value', () => {
  const source = `component App {
    let &[count] = track(0, (current) => current, (next, prev) => typeof next === 'string' ? Number(next) : next)
    <p>{count}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>0</p>');
});

test('server expr-mode: track(v, get, set) shorthand renders initial value', () => {
  const source = `component App {
    let &[count] = track(0, (current) => current, (next, prev) => typeof next === 'string' ? Number(next) : next)
    return <p>{count}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>0</p>');
});

test('server: get hook is applied during SSR, matching client display', () => {
  const source = `component App {
    let &[count] = track(0, (current) => current.toFixed(2))
    <p>{count}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>0.00</p>');
});

test('client stmt-mode: track(v, get, set) shorthand hooks are preserved verbatim', () => {
  const source = `component App {
    let &[count] = track(0, (current) => current.toFixed(2), (next, prev) => typeof next === 'string' ? Number(next) : next)
    <p>{count}</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).toContain("const count = track(0, (current) => current.toFixed(2), (next, prev) => typeof next === 'string' ? Number(next) : next);");
  expect(code).notToContain('track(0);');
});

test('client expr-mode: track(v, get, set) shorthand hooks are preserved verbatim', () => {
  const source = `component App {
    let &[count] = track(0, (current) => current.toFixed(2), (next, prev) => typeof next === 'string' ? Number(next) : next)
    return <p>{count}</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).toContain("const count = track(0, (current) => current.toFixed(2), (next, prev) => typeof next === 'string' ? Number(next) : next);");
  expect(code).notToContain('track(0);');
});

test('client: shorthand works with destructured raw cell', () => {
  const source = `component App {
    let &[count, rawCell] = track(0, (current) => current * 2, (next, prev) => typeof next === 'string' ? Number(next) : next)
    <p>{count}</p>
  }`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).toContain("const rawCell = track(0, (current) => current * 2, (next, prev) => typeof next === 'string' ? Number(next) : next);");
});

// ============================================================
// Plain (non-&) track must reach the server renderer bound.
//
// `const &[n] = track(0)` lowers to a TrackDecl, which has always pulled
// `get`/`set`/`track` into the component's `__vesk` scope. The PLAIN form
// stays a raw RuntimeStatement that still calls `track(`, and it used to
// render with `track` unbound — the whole page failed with
// "track is not defined". Regression cover for that, plus the false-positive
// guards that keep the detection from injecting on a mere mention.
// ============================================================
test('server: plain track (no &) is bound in the SSR scope', () => {
  const source = `component App {
    const n = track(0)
    const bump = () => { set(n, get(n) + 1) }
    <p>{get(n)}</p>
    <button onClick={bump}>go</button>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>0</p>');
});

test('server: plain track with a generic argument is bound', () => {
  const source = `component App {
    const items = track<string[]>([])
    const add = () => set(items, [...get(items), 'x'])
    <p>{get(items).length}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>0</p>');
});

test('server: plain track inside a for-init is bound', () => {
  const source = `component App {
    const seed = track(3)
    const out: number[] = []
    for (let i = 0; i < get(seed); i++) { out.push(i) }
    <p>{out.length}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>3</p>');
});

test('server: plain track in statement-mode control flow is bound', () => {
  const source = `component App {
    const n = track(0)
    if (get(n) === 0) {
      <p>zero</p>
    } else {
      <p>other</p>
    }
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>zero</p>');
});

test('server: plain track inside a component prop expression is bound', () => {
  const source = `component App {
    const seed = track(2)
    <Panel value={get(seed)} />
  }
  component Panel(props: { value: number }) {
    <span>{props.value}</span>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<span>2</span>');
});

test('server: a plain track() mentioned in a string does NOT bind it', () => {
  const source = `component App {
    const label = 'call track(0) to make a cell'
    <p>{label}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('call track(0) to make a cell');
});

test('server: a plain track() mentioned in a comment does NOT bind it', () => {
  const source = `component App {
    // remember: track(0) makes a cell
    <p>hi</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>hi</p>');
});

test('server: a member access .track() does NOT bind it', () => {
  const source = `component App {
    const api = { track: () => 7 }
    <p>{api.track()}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>7</p>');
});

test('server: a local binding named track does not collide with the runtime', () => {
  const source = `component App {
    const api = { track: () => 7 }
    const track = 'a local string named track'
    <p>{api.track()}{track}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>7a local string named track</p>');
});

test('server expr-mode: plain track (no &) is bound in the SSR scope', () => {
  const source = `component App {
    const n = track(5)
    const bump = () => set(n, get(n) + 1)
    return <div><p>{get(n)}</p><button onClick={bump}>go</button></div>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>5</p>');
});

test('server expr-mode: plain track with a generic is bound', () => {
  const source = `component App {
    const items = track<string[]>(['a'])
    const add = () => set(items, [...get(items), 'b'])
    return <p>{get(items).join(',')}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>a</p>');
});

test('server expr-mode: a plain track() in a string does NOT bind it', () => {
  const source = `component App {
    const label = 'track(0)'
    return <p>{label}</p>
  }`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>track(0)</p>');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
