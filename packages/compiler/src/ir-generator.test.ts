import { render } from './server-render.ts';

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
        throw new Error(`expected to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

function component(body: string): string {
  return `component App {
  return (
    ${body}
  );
}`;
}

test('for-of with nested parens in iterable', () => {
  const source = component(
    `<ul>
      for (const item of props.getChild(props.root, props.index))
      {item}
    </ul>`
  );
  const html = render(source, 'App', { root: ['a', 'b'], index: 0, getChild: (r: string[], i: number) => r[i] }) as string;
  expect(html).toContain('<ul>a</ul>');
});

test('for-of with " of " inside a string literal in iterable', () => {
  const source = component(
    `<ul>
      for (const item of props.choose("of the day"))
      {item}
    </ul>`
  );
  const html = render(source, 'App', { choose: (s: string) => [s] }) as string;
  expect(html).toContain('<ul>of the day</ul>');
});

test('for-of with " in " inside a string literal is not split', () => {
  const source = component(
    `<ul>
      for (const item of props.pick("in the dark"))
      {item}
    </ul>`
  );
  const html = render(source, 'App', { pick: (s: string) => [s] }) as string;
  expect(html).toContain('<ul>in the dark</ul>');
});

test('for-of with nested array literal', () => {
  const source = component(
    `<ul>
      for (const item of [["a"], ["b"]])
      {item}
    </ul>`
  );
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<ul>ab</ul>');
});

test('for-of with JSXElement body', () => {
  const source = component(
    `<ul>
      for (const item of props.items)
      <li>{item}</li>
    </ul>`
  );
  const html = render(source, 'App', { items: ['x', 'y'] }) as string;
  expect(html).toContain('<li>x</li>');
  expect(html).toContain('<li>y</li>');
});

test('for-of with fragment body', () => {
  const source = component(
    `<div>
      for (const item of props.items)
      <>{item}</>
    </div>`
  );
  const html = render(source, 'App', { items: ['a', 'b'] }) as string;
  expect(html).toContain('<div>ab</div>');
});

test('for-in loop over object keys', () => {
  const source = component(
    `<ul>
      for (const k in props.obj)
      {k}
    </ul>`
  );
  const html = render(source, 'App', { obj: { x: 1, y: 2 } }) as string;
  expect(html).toContain('<ul>xy</ul>');
});

test('statement-mode for-of still works', () => {
  const source = component(
    `<ul>
      for (const item of props.items) {
        <li>{item.name}</li>
      }
    </ul>`
  );
  const html = render(source, 'App', { items: [{ name: 'x' }, { name: 'y' }] }) as string;
  expect(html).toContain('<li>x</li>');
  expect(html).toContain('<li>y</li>');
});

test('plain text not starting with for() is untouched', () => {
  const source = component(`<p>fork(3) for (nothing</p>`);
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('fork(3) for (nothing');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
