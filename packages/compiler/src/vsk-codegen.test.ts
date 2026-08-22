import { readFileSync } from 'node:fs';
import {
  compileVskCodegen,
  vskToTsx,
  type VskCodegenResult,
} from './vsk-tsx.ts';

const expect = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e: any) {
    failed++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}.vsk`, import.meta.url), 'utf-8');

const CODE = {
  stmt: `component Counter(props: { initial: number }) {
  let &[count, cell] = track(props.initial);
  <div class="counter">
    <p>Count: {count.get()}</p>
    <button onClick={() => count.set(count.get() + 1)}>+1</button>
  </div>
}`,
  expr: `component Expr(props: { name: string }) {
  return <div class="expr"><h1>Hello {props.name}</h1><span>{props.children}</span></div>
}`,
  iffor: `component List(props: { items: string[] }) {
  if (props.items.length === 0) {
    <p>Empty</p>
  } else {
    <ul>for (const item of props.items)<li>{item}</li></ul>
  }
}`,
  style: `component Styled {
  <style>.box { color: red; }</style>
  <div class="box">Colored</div>
}`,
  exprstyle: `component ExprStyled {
  <style>.eapp { padding: 30px; }</style>
  return <div class="eapp"><p>Hello</p></div>
}`,
  head: `import { createContext } from '@vesk/runtime';
component Doc {
  <Head><title>T</title></Head>
  <div>hi</div>
}`,
  headImported: `import { Head } from '@vesk/runtime';
component Doc {
  <Head><title>T</title></Head>
  <div>hi</div>
}`,
  empty: `component Empty { }`,
  client: `component Client island client {
  <p>client island</p>
}`,
  switch: `component Sw(props: { x: number }) {
  switch (props.x) {
    case 1: <p>one</p> break;
    default: <p>many</p>
  }
}`,
  trycatch: `component Tc {
  try {
    <p>ok</p>
  } catch (e) {
    <p>{String(e)}</p>
  }
}`,
  forclause: `component Posts(props: { posts: string[] }) {
  <ul>for (const post of props.posts)<li>{post}</li></ul>
}`,
  forempty: `component Posts(props: { posts: string[] }) {
  <ul>for (const post of props.posts)<li>{post}</li>#empty <li>none</li></ul>
}`,
  forin: `component Obj(props: { data: Record<string, string> }) {
  <ul>for (const k in props.data)<li>{k}</li></ul>
}`,
  multi: `component A { <div>a</div> }
component B(props: { n: number }) { <p>{props.n}</p> }
export default component C { <span>c</span> }`,
  typed: `interface Post { title: string }
component Feed(props: { posts: Post[] }) {
  const len: number = props.posts.length;
  const first: Post | undefined = props.posts[0];
  return <p>{len}{first?.title}</p>;
}`,
};

const SAMPLES: Array<[string, string]> = [
  ['stmt', CODE.stmt],
  ['expr', CODE.expr],
  ['iffor', CODE.iffor],
  ['style', CODE.style],
  ['exprstyle', CODE.exprstyle],
  ['head', CODE.head],
  ['headImported', CODE.headImported],
  ['empty', CODE.empty],
  ['client', CODE.client],
  ['switch', CODE.switch],
  ['trycatch', CODE.trycatch],
  ['forclause', CODE.forclause],
  ['forempty', CODE.forempty],
  ['forin', CODE.forin],
  ['multi', CODE.multi],
  ['typed', CODE.typed],
  ['fixture:with-props', fixture('with-props')],
  ['fixture:simple', fixture('simple')],
  ['fixture:export-default', fixture('export-default')],
  ['fixture:export-named', fixture('export-named')],
  ['fixture:expr-app', fixture('expr-app')],
  ['fixture:deep-all', fixture('deep-all')],
  ['fixture:with-style', fixture('with-style')],
  ['fixture:app-with-card', fixture('app-with-card')],
  ['fixture:reactive', fixture('reactive')],
];

test('codegen is byte-identical to vskToTsx across statement+expression mode samples', () => {
  for (const [name, src] of SAMPLES) {
    const r = compileVskCodegen(src);
    const expected = vskToTsx(src);
    if (r.code !== expected) {
      throw new Error(`${name}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(r.code)}`);
    }
  }
});

test('mappings are sorted, in-bounds and map generated text to the right source slice', () => {
  for (const [name, src] of SAMPLES) {
    const r = compileVskCodegen(src);
    let prevGen = -1;
    for (const m of r.mappings) {
      if (m.generatedOffsets[0] < prevGen) throw new Error(`${name}: mappings out of order`);
      prevGen = m.generatedOffsets[0];
      if (m.generatedOffsets[0] < 0 || m.generatedOffsets[0] > r.code.length) {
        throw new Error(`${name}: generated offset out of bounds`);
      }
      if (m.sourceOffsets[0] < 0 || m.sourceOffsets[0] + m.lengths[0] > src.length) {
        throw new Error(`${name}: source offset out of bounds`);
      }
      const genLen = m.generatedLengths?.[0] ?? m.lengths[0];
      if (m.generatedOffsets[0] + genLen > r.code.length) throw new Error(`${name}: generated range out of bounds`);
    }
  }
});

test('component name maps back to its source position', () => {
  const src = `component Greeting { <div>Hello</div> }`;
  const r = compileVskCodegen(src);
  const nameStart = src.indexOf('Greeting');
  const m = r.mappings.find((x) => x.sourceOffsets[0] === nameStart);
  expect(m !== undefined, 'mapping starts at component name');
  if (m) {
    const slice = r.code.slice(m.generatedOffsets[0], m.generatedOffsets[0] + 'Greeting'.length);
    expect(slice === 'Greeting', `generated slice at name mapping is the name (got ${JSON.stringify(slice)})`);
  }
});

test('expression container maps exactly onto its expression', () => {
  const src = `component C { <p>Count: {count}</p> }`;
  const r = compileVskCodegen(src);
  const exprStart = src.indexOf('count', src.indexOf('{count}'));
  const m = r.mappings.find((x) => x.sourceOffsets[0] === exprStart);
  expect(m !== undefined, 'mapping starts at {count} expression');
  if (m) {
    const slice = r.code.slice(m.generatedOffsets[0], m.generatedOffsets[0] + 'count'.length);
    expect(slice === 'count', `generated slice at expression mapping is the identifier (got ${JSON.stringify(slice)})`);
  }
});

test('track decl name carries a reactive mapping to the source pattern name', () => {
  const src = `component C { const &[count, rawCell] = track(0); <p>{count}</p> }`;
  const r = compileVskCodegen(src);
  const countStart = src.indexOf('count');
  const rawStart = src.indexOf('rawCell');
  const reactives = r.mappings.filter((x) => (x.data.customData as any)?.vesk?.reactive);
  expect(reactives.length >= 2, 'first name and raw cell both carry reactive customData');
  const first = reactives.find((x) => x.sourceOffsets[0] === countStart);
  const raw = reactives.find((x) => x.sourceOffsets[0] === rawStart);
  expect(first !== undefined, 'first name maps to its source position');
  expect(raw !== undefined, 'raw cell maps to its source position');
  if (first) {
    const slice = r.code.slice(first.generatedOffsets[0], first.generatedOffsets[0] + 'count'.length);
    expect(slice === 'count', `generated slice at reactive mapping is the first name (got ${JSON.stringify(slice)})`);
  }
});

test('track decl rewrite text is identical to vskToTsx', () => {
  const src = `component C { let &[count, c] = track(0); <p>{count.get()}</p> }`;
  const r = compileVskCodegen(src);
  expect(r.code.includes('let count: any = track(0);'), 'plain rewrite keeps let + any');
  expect(r.code.includes('let c: any = count;'), 'extra name aliases the first');
});

test('typedCells emits inferred Tracked cells with unique cell names', () => {
  const src = `component C {
  const &[count] = track(0);
  const &[posts] = track<number[]>([]);
  const &[map, rawMap] = track<Map<string, number>>(new Map());
  <p>{count}{posts.length}{map.size}{rawMap.size}</p>
}`;
  const r = compileVskCodegen(src, { typedCells: true });
  expect(r.code.includes('const __cell = track(0);'), 'first cell is __cell');
  expect(r.code.includes('const __cell1 = track<number[]>([]);'), 'second cell is __cell1 (inferred Tracked)');
  expect(r.code.includes('const __cell2 = track<Map<string, number>>(new Map());'), 'third cell is __cell2 (inferred Tracked)');
  expect(r.code.includes('let count = __cell.get();'), 'count infers from get()');
  expect(r.code.includes('let posts: number[] = __cell1.get();'), 'posts infers from get()');
  expect(r.code.includes('let map: Map<string, number> = __cell2.get();'), 'map infers from get()');
  expect(r.code.includes('let rawMap = __cell2;'), 'raw cell aliases the cell as Tracked<T>');
  expect(!r.code.includes('let count: any'), 'typedCells drops the any fallback');
});

test('typedCells keeps value annotations on bindings only', () => {
  const src = `component C { let &[count]: number = track(0); <p>{count}</p> }`;
  const r = compileVskCodegen(src, { typedCells: true });
  expect(r.code.includes('let count: number = __cell.get();'), 'annotated binding keeps its type');
});

test('raw cell alias infers Tracked<T> so it satisfies into-like APIs', () => {
  const src = `component C { const &[posts, postsCell] = track<Post[]>([]); <p>{posts.length}</p> }`;
  const r = compileVskCodegen(src, { typedCells: true });
  expect(r.code.includes('let posts: Post[] = __cell.get();'), 'value binding annotated');
  expect(!r.code.includes(': Post[]>'), 'cell never annotated with the value type');
  expect(!r.code.includes('let postsCell: Post[] ='), 'raw binding never value-annotated');
});

test('style regions are recorded in statement and expression modes', () => {
  const stmt = compileVskCodegen(CODE.style);
  expect(stmt.styleRegions.length === 1, 'statement-mode style recorded');
  if (stmt.styleRegions[0]) {
    const s = stmt.styleRegions[0];
    expect(CODE.style.slice(s.start, s.end).startsWith('<style>'), 'region covers the whole element');
    expect(CODE.style.slice(s.start, s.end).endsWith('</style>'), 'region ends at the close tag');
    expect(s.content.includes('.box { color: red; }'), 'region content is the CSS');
  }
  expect(!stmt.code.includes('<style>'), 'statement-mode style stripped from output');

  const expr = compileVskCodegen(CODE.exprstyle);
  expect(expr.styleRegions.length === 1, 'expression-mode style recorded');
  if (expr.styleRegions[0]) {
    expect(expr.styleRegions[0].content.includes('.eapp { padding: 30px; }'), 'expression-mode CSS content');
  }
  expect(!expr.code.includes('<style>'), 'expression-mode style stripped from output');
});

test('for-clause array expression maps to its source position', () => {
  const src = `component C { <ul>for (const post of posts)<li>{post}</li></ul> }`;
  const r = compileVskCodegen(src);
  const postsStart = src.indexOf('posts');
  const m = r.mappings.find((x) => x.sourceOffsets[0] === postsStart);
  expect(m !== undefined, 'for-clause arrExpr mapped');
  if (m) {
    const slice = r.code.slice(m.generatedOffsets[0], m.generatedOffsets[0] + 'posts'.length);
    expect(slice === 'posts', `generated slice is the array expr (got ${JSON.stringify(slice)})`);
  }
  expect(r.code.includes('.map(('), 'for-clause rewritten to .map');
});

test('Head is prepended without an import and shifts mappings', () => {
  const r = compileVskCodegen(CODE.head);
  expect(r.code.startsWith('declare const Head'), 'Head declaration prepended');
  const minGen = Math.min(...r.mappings.map((m) => m.generatedOffsets[0]));
  expect(minGen > 0, 'mappings shifted past the prepended header');
});

test('parse errors are reported with a position', () => {
  const bad = `component C { <div> }`;
  const r = compileVskCodegen(bad);
  expect(r.errors.length === 1, 'one parse error');
  if (r.errors[0]) {
    expect(typeof r.errors[0].start === 'number', 'error has a start offset');
    expect(r.errors[0].end > r.errors[0].start, 'error has an end offset');
  }
  expect(r.code === bad, 'parse-failure codegen falls back to the raw source');
});

test('identity fallback maps 1:1 on parse failure', () => {
  const bad = `component { broken`;
  const r = compileVskCodegen(bad);
  expect(r.mappings.length === 1, 'single identity mapping on parse failure');
  if (r.mappings[0]) {
    expect(r.mappings[0].sourceOffsets[0] === 0, 'identity starts at 0');
    expect(r.mappings[0].lengths[0] === bad.length, 'identity covers the full source');
  }
});

test('empty component body emits `{  }` and stays valid', () => {
  const r = compileVskCodegen(CODE.empty);
  expect(r.code.includes('function Empty() {  }'), 'empty body emits braces with inner spaces');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);