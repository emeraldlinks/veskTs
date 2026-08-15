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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
