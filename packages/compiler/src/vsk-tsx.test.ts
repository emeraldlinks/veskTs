import { readFileSync } from 'node:fs';
import { vskToTsx, generateVskDts } from '@vesk/compiler/src/vsk-tsx';

const expect = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  }
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

const has = (hay: string, needle: string, msg: string) => {
  if (!hay.includes(needle)) throw new Error(`${msg}\n  expected to contain: ${needle}\n  got: ${hay}`);
};
const notHas = (hay: string, needle: string, msg: string) => {
  if (hay.includes(needle)) throw new Error(`${msg}\n  expected NOT to contain: ${needle}`);
};

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}.vsk`, import.meta.url), 'utf-8');

test('statement mode: component → function', () => {
  const tsx = vskToTsx(`component Greeting { <div>Hello World</div> }`);
  has(tsx, 'function Greeting() { <div>Hello World</div> }', 'header transform');
  notHas(tsx, 'component Greeting', 'component keyword removed');
});

test('export component with typed props', () => {
  const tsx = vskToTsx(fixture('with-props'));
  has(tsx, 'function Card(props: { title: string })', 'typed props kept');
});

test('export default component', () => {
  const tsx = vskToTsx(fixture('export-default'));
  has(tsx, 'export default function App', 'default export');
});

test('export named component', () => {
  const tsx = vskToTsx(fixture('export-named'));
  has(tsx, 'export function App', 'named export');
});

test('client island keyword stripped', () => {
  const tsx = vskToTsx(`component Counter(props: { initial: number }) client { <p>{props.initial}</p> }`);
  has(tsx, 'function Counter(props: { initial: number }) {', 'client stripped');
});

test('async component', () => {
  const tsx = vskToTsx(`async component Lazy { <div>hi</div> }`);
  has(tsx, 'async function Lazy() {', 'async function');
});

test('expression mode preserved', () => {
  const src = `component X(props: { a: number }) { return (<div>{props.a}</div>); }`;
  const tsx = vskToTsx(src);
  has(tsx, 'function X(props: { a: number }) { return (<div>{props.a}</div>); }', 'expression body kept');
});

test('track decl rewritten to typed aliases', () => {
  const tsx = vskToTsx(`component C { let &[count, c] = track(0); <p>{count.get()}</p> }`);
  has(tsx, 'let count: any = track(0); let c: any = count', 'two-name track');
  const single = vskToTsx(`component C { let &[n] = track(5); <p>{n}</p> }`);
  has(single, 'let n: any = track(5)', 'single-name track');
});

test('typed track decl keeps annotation', () => {
  const tsx = vskToTsx(`component C { let &[count]: number = track(0); <p>{count}</p> }`);
  has(tsx, 'let count: number = (track(0) as unknown as number);', 'annotation preserved');
});

test('track<T> type arg becomes value annotation', () => {
  const tsx = vskToTsx(`component C { let &[count] = track<number>(0); <p>{count}</p> }`);
  has(tsx, 'let count: number = (track<number>(0) as unknown as number);', 'type arg used');
});

test('untyped track decl falls back to any', () => {
  const tsx = vskToTsx(`component C { let &[count] = track(0); <p>{count}</p> }`);
  has(tsx, 'let count: any = track(0);', 'any fallback');
});

test('style block stripped', () => {
  const tsx = vskToTsx(`component C { <style>.x { color: red }</style> <div class="x">hi</div> }`);
  notHas(tsx, '<style>', 'style block gone');
  has(tsx, '<div class="x">hi</div>', 'jsx kept');
});

test('Head ambient injected when used in a module', () => {
  const tsx = vskToTsx(`import { track } from '@vesk/runtime'\ncomponent C { <Head><title>T</title></Head> <div>hi</div> }`);
  has(tsx, 'declare const Head: (props: { children?: unknown }) => unknown;', 'Head ambient');
});

test('no Head ambient for script files (global ambient covers it)', () => {
  const tsx = vskToTsx(`component C { <Head><title>T</title></Head> <div>hi</div> }`);
  notHas(tsx, 'declare const Head', 'no per-file ambient');
});

test('runtime imports and top-level code untouched', () => {
  const tsx = vskToTsx(`import { createContext } from '@vesk/runtime';\nexport async function load() { return { props: {} } }\ncomponent C { <div>hi</div> }`);
  has(tsx, `import { createContext } from '@vesk/runtime';`, 'import kept');
  has(tsx, `export async function load() { return { props: {} } }`, 'top-level fn kept');
});

test('vsk import kept', () => {
  const tsx = vskToTsx(`import { Helper } from './helper.vsk';\ncomponent C { <Helper base={5} /> }`);
  has(tsx, `import { Helper } from './helper.vsk';`, 'vsk import kept');
  has(tsx, `<Helper base={5} />`, 'jsx call kept');
});

// ---------------- d.ts ----------------

test('dts: typed single props param', () => {
  const dts = generateVskDts(fixture('with-props'));
  has(dts, 'export type CardProps = { title: string };', 'props alias');
  has(dts, 'export declare function Card(props: CardProps & { children?: unknown }): unknown;', 'card signature');
});

test('dts: positional params synthesized', () => {
  const dts = generateVskDts(`export component Greeting(name: string, age: number) { <p>{name} {age}</p> }`);
  has(dts, 'export type GreetingProps = { "name": string; "age": number };', 'synthesized object type');
});

test('dts: untyped props → any', () => {
  const dts = generateVskDts(fixture('simple'));
  has(dts, 'export type AppProps = any;', 'any props');
  has(dts, 'export declare function App(props: any): unknown;', 'app signature');
  has(dts, `import { Button } from './Button.vsk';`, 'imported component kept');
});

test('dts: default export', () => {
  const dts = generateVskDts(fixture('export-default'));
  has(dts, 'export default function App(props: any): unknown;', 'default function');
});

test('dts: interface declarations included', () => {
  const dts = generateVskDts(`interface Post { title: string }\nexport component Feed(props: { posts: Post[] }) { <p>x</p> }`);
  has(dts, 'interface Post { title: string }', 'interface slice');
  has(dts, 'export type FeedProps = { posts: Post[] };', 'props alias');
});

test('dts: collision with user Props type inlines instead', () => {
  const dts = generateVskDts(`type AppProps = { custom: boolean }\nexport component App(props: { label: string }) { <p>x</p> }`);
  has(dts, 'type AppProps = { custom: boolean }', 'user type kept');
  notHas(dts, 'export type AppProps', 'no duplicate alias');
  has(dts, 'export declare function App(props: { label: string } & { children?: unknown }): unknown;', 'inlined type');
});

test('dts: css imports filtered, js imports kept', () => {
  const dts = generateVskDts(`import './global.css';\nimport { Helper } from './helper.vsk';\nexport component App { <p>x</p> }`);
  notHas(dts, 'global.css', 'css import dropped');
  has(dts, `import { Helper } from './helper.vsk';`, 'vsk import kept');
});

test('dts: destructured params type from annotation', () => {
  const dts = generateVskDts(`interface Props { name: string }\nexport component Foo({ name, age }: Props) { <p>{name}</p> }`);
  has(dts, 'export type FooProps = Props;', 'annotation type used');
});

console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${failed === 0 ? 'All tests passed!' : 'Some tests failed!'}`);
process.exit(failed > 0 ? 1 : 0);
