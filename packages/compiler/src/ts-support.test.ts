import { render } from './server-render.ts';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { generateFunctionBody } from '@vesk/compiler/src/server-jsgen';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { vskToTsx, generateVskDts } from './vsk-tsx.ts';
import { rewriteTopLevelActions } from './actions.ts';

function serverBody(source: string): string {
  const ir = generateIR(parse(source, { filename: 'x.vsk' }), source);
  const comp = ir.components[0];
  return generateFunctionBody(comp, new Set<string>());
}

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
    toEqual(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

test('parse: typed statements and TS expression wrappers survive parsing', () => {
  const src = `component App {
  const len: number = props.posts.length;
  const first: Post | undefined = props.posts[0];
  const title: string = first!.title;
  const casted: unknown = first as unknown;
  const s = casted satisfies unknown;
  const gen = helper<string>('x');
  const tuple = [1, 2] as const;
  const status = Status.Published as number;
  <p>{len}{gen}</p>
}`;
  const ast = parse(src, { filename: 'x.vsk' });
  expect(ast.body.length).toEqual(1);
});

test('ssr: typed runtime statements render without TS syntax in generated JS', () => {
  const source = `component App {
  const len: number = props.posts.length;
  const first: Post | undefined = props.posts[0];
  const title: string = first!.title;
  const casted: unknown = first as unknown;
  const safe = first?.title ?? 'none';
  const gen = helper<string>('x');
  const status = Status.Published as number;
  const tuple = [1, 2] as const;
  const [head, ...rest] = props.posts;
  const { title: t = 'T' } = props.posts[0] ?? {};
  return <p>{len}:{title}:{safe}:{gen}:{status}:{tuple[0]}:{head}:{t}</p>;
}`;
  const code = serverBody(source);
  expect(code).notToContain(': number');
  expect(code).notToContain(': unknown');
  expect(code).notToContain('first!.title');
  expect(code).notToContain(' as ');
  expect(code).notToContain('satisfies');
  expect(code).notToContain('helper<');
});

test('ssr: plain init without track call renders tracked reads', () => {
  const source = `component App {
  let &[plainCell] = [3, 4]
  <p>{plainCell[1]}</p>
}`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>4</p>');
});

test('ssr: typed statement body renders values via render()', () => {
  const source = `component App {
  const len: number = props.posts.length;
  const first = props.posts[0];
  const title: string = first!.title;
  const tuple = [1, 2] as const;
  return <p>{len}:{title}:{tuple[1]}</p>;
}`;
  const html = render(source, 'App', { posts: [{ title: 'Hello' }, { title: 'World' }] }) as string;
  expect(html).toContain('<p>2:Hello:2</p>');
});

test('ssr: JSX interpolation after a previous statement parses and renders', () => {
  const source = `component App {
  const x = [3, 4]
  <p>{x[1]}</p>
}`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>4</p>');
});

test('ssr: JSX after any expression-ending statement renders', () => {
  const source = `component App {
  const x = 2 + 2
  <p>{x}</p>
  const y = 'hi'
  <span>{y}</span>
}`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>4</p>');
  expect(html).toContain('<span>hi</span>');
});

test('client: typed runtime statements are stripped in hydrated output', () => {
  const source = `component App {
  const len: number = props.posts.length;
  const first: Post | undefined = props.posts[0];
  const title: string = first!.title;
  const casted: unknown = first as unknown;
  const gen = helper<string>('x');
  const tuple = [1, 2] as const;
  return <p>{len}{title}{tuple[0]}</p>;
}`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).notToContain(': number');
  expect(code).notToContain(': unknown');
  expect(code).notToContain('first!.title');
  expect(code).notToContain(' as ');
  expect(code).notToContain('satisfies');
  expect(code).notToContain('helper<');
});

test('client: tracked variable with TS wrapper rewrites to get() call', () => {
  const source = `component App {
  const &[count] = track(0);
  const value: number = count as number;
  return <button onclick={() => count += 1}>{value}</button>;
}`;
  const code = compileClient(source, 'App', { hydrate: true });
  expect(code).notToContain(' as ');
  expect(code).toContain('get(count)');
});

test('top-level: interface/type/enum are dropped from server eval and client bundle', () => {
  const source = `interface Post { title: string; tags?: string[] }
type Id = string | number;
const prefix: string = 'P';
function greet(name: string): string { return 'hi ' + name; }
component App {
  return <p>{prefix}{greet('a')}</p>;
}`;
  const serverCode = serverBody(source);
  expect(serverCode).notToContain('interface');
  expect(serverCode).notToContain('type Id');
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>Phi a</p>');
  const clientCode = compileClient(source, 'App', { hydrate: true });
  expect(clientCode).notToContain('interface');
  expect(clientCode).notToContain('type Id');
  expect(clientCode).notToContain('prefix: string');
});

test('top-level: generic helper call in component body uses stripped top-level fn', () => {
  const source = `function pick<T>(arr: T[], i: number): T { return arr[i]; }
component App {
  const v = pick<string>(['a', 'b'], 1);
  return <p>{v}</p>;
}`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>b</p>');
});

test('vskToTsx + dts: typed statements stay intact for tsc', () => {
  const source = `interface Post { title: string }
component App(props: { posts: Post[] }) {
  const len: number = props.posts.length;
  const first: Post | undefined = props.posts[0];
  return <p>{len}{first?.title}</p>;
}`;
  const tsx = vskToTsx(source);
  expect(tsx).toContain('interface Post');
  expect(tsx).toContain('const len: number');
  expect(tsx).toContain(': Post | undefined');
  const dts = generateVskDts(source);
  expect(dts).toContain('posts');
  expect(dts).toContain('export declare function App');
});

test('imports: type imports are dropped from ir.imports and client bundle, kept for tsc', () => {
  const source = `import type { User } from './types.ts';
import type { Theme } from './types.vsk';
import { type A, helper } from './mixed.ts';
component App(props: { user: User }) {
  const label: string = props.user.name;
  return <p>{label}</p>;
}`;
  const ir = generateIR(parse(source, { filename: 'x.vsk' }), source);
  const irImports = ir.imports.join('\n');
  expect(irImports).notToContain('import type');
  expect(irImports).toContain("import { helper } from './mixed.ts';");
  expect(ir.importedNames.has('User')).toEqual(false);
  expect(ir.importedNames.has('Theme')).toEqual(false);
  expect(ir.importedNames.has('A')).toEqual(false);
  expect(ir.importedNames.has('helper')).toEqual(true);

  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('import type');
  expect(client).notToContain('type A');
  expect(client).toContain("import { helper } from './mixed.ts';");

  const tsx = vskToTsx(source);
  expect(tsx).toContain("import type { User } from './types.ts';");
  expect(tsx).toContain("import type { Theme } from './types.vsk';");
});

test('imports: type-only .vsk imports are not resolved as component imports', () => {
  const source = `import type { Foo } from './foo.vsk';
component App {
  return <p>hi</p>;
}`;
  const ir = generateIR(parse(source, { filename: 'x.vsk' }), source);
  expect(ir.imports.length).toEqual(0);
  expect(ir.importedNames.has('Foo')).toEqual(false);
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>hi</p>');
});

test('imports: render works with type imports from .ts and .vsk present', () => {
  const source = `import type { User } from './types.ts';
import type { Theme } from './types.vsk';
import { type A, type B } from './types.vsk';
component App(props: { name: string }) {
  return <p>{props.name}</p>;
}`;
  const html = render(source, 'App', { name: 'ok' }) as string;
  expect(html).toContain('<p>ok</p>');
});

test('imports: statement-mode body with type imports renders', () => {
  const source = `import type { User } from './types.ts';
import type { Theme } from './types.vsk';
component App(props: { name: string }) {
  const label: string = props.name;
  <p>{label}</p>
  <p>always</p>
}`;
  const html = render(source, 'App', { name: 'ok' }) as string;
  expect(html).toContain('<p>ok</p>');
  expect(html).toContain('<p>always</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('import type');
});

test('casts: nested as chains strip fully on server and client', () => {
  const source = `component App(props: { n: unknown; arr: number[] }) {
  const a = props.n as unknown as string;
  const b = props.arr as const as readonly number[];
  const c = String(props.n as number as string);
  return <p>{a}{b[0]}{c}</p>;
}`;
  const html = render(source, 'App', { n: 7, arr: [3, 4] }) as string;
  expect(html).toContain('<p>737</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain(' as ');
  expect(client).notToContain('readonly');
});

test('casts: non-null chains, method calls and satisfies combos', () => {
  const source = `component App(props: { a?: { b?: { c?: number } }; maybe?: string }) {
  const v = props.a!.b!.c;
  const w = props.maybe!.toUpperCase() satisfies string;
  return <p>{v}{w}</p>;
}`;
  const html = render(source, 'App', { a: { b: { c: 7 } }, maybe: 'abc' }) as string;
  expect(html).toContain('<p>7ABC</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('!.');
  expect(client).notToContain('satisfies');
});

test('casts: statement-mode as chains and non-null asserts', () => {
  const source = `component App(props: { n: unknown; maybe?: string }) {
  const a = props.n as unknown as string
  const v = props.maybe!.toUpperCase() satisfies string
  <p>{a}{v}</p>
}`;
  const html = render(source, 'App', { n: 1, maybe: 'x' }) as string;
  expect(html).toContain('<p>1X</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain(' as ');
});

test('types: utility, mapped and index-signature types in annotations', () => {
  const source = `type Maybe<T> = T | null;
type Opt<T> = { [K in keyof T]?: T[K] };
type Dict = { [k: string]: number };
component App(props: { posts: { title: string }[]; e: { id: number; name: string } }) {
  const first: Maybe<string> = props.posts[0]?.title ?? 'none';
  const rec: Record<string, number> = { a: 1 };
  const t: [string, number] = ['x', 1];
  const d: Dict = { x: 2 };
  const o: Opt<{ k: number }> = {};
  return <p>{first}{rec.a}{t[1]}{d.x}{props.e.id}</p>;
}`;
  const html = render(source, 'App', { posts: [{ title: 'Hello' }], e: { id: 9, name: 'N' } }) as string;
  expect(html).toContain('<p>Hello1129</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('Record<');
  expect(client).notToContain('keyof');
});

test('types: keyof typeof, template literal types and enums', () => {
  const source = `const cfg = { level: 1 } as const;
type Key = keyof typeof cfg;
type Http = \`\${string}://\${string}\`;
enum Status { Draft = 1, Published = 2 }
component App() {
  const k: Key = 'level';
  const url: Http = 'https://x.com';
  const s: Status = Status.Published;
  return <p>{k}{url}{s}</p>;
}`;
  const html = render(source, 'App', {}) as string;
  expect(html).toContain('<p>levelhttps://x.com2</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('keyof');
  expect(client).notToContain('enum Status');
});

test('types: generics, union/intersection/conditional narrowing', () => {
  const source = `function first<T>(arr: T[]): T | undefined { return arr[0]; }
type WithId = { id: number };
type Shape = { kind: 'sq'; side: number } | { kind: 'ci'; r: number };
type Entity = WithId & { name: string };
type IsStr<T> = T extends string ? 'yes' : 'no';
component App(props: { ids: number[]; shape: Shape; e: Entity }) {
  const id = first<number>(props.ids);
  const area = props.shape.kind === 'sq' ? props.shape.side ** 2 : 3;
  const s: IsStr<string> = 'yes';
  return <p>{id}{area}{props.e.id}{props.e.name}{s}</p>;
}`;
  const html = render(source, 'App', { ids: [5], shape: { kind: 'sq', side: 4 }, e: { id: 1, name: 'N' } }) as string;
  expect(html).toContain('<p>5161Nyes</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('IsStr');
});

test('types: optional chaining, destructuring and satisfies as const', () => {
  const source = `component App(props: { u?: { addr?: { city?: string } }; arr: number[] }) {
  const city = props.u?.addr?.city ?? 'unknown';
  const { name: n = 'x', ...rest } = { name: 'z', extra: 1 };
  const v = props.arr as const satisfies readonly number[];
  return <p>{city}{n}{rest.extra}{v[0]}</p>;
}`;
  const html = render(source, 'App', { arr: [8, 9] }) as string;
  expect(html).toContain('<p>unknownz18</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain('satisfies');
});

test('types: statement-mode advanced annotations and casts', () => {
  const source = `type Maybe<T> = T | null;
component App(props: { s?: string; n: unknown }) {
  const first: Maybe<string> = props.s ?? 'none'
  const a = props.n as unknown as number
  <p>{first}{a}</p>
}`;
  const html = render(source, 'App', { s: 'ok', n: 3 }) as string;
  expect(html).toContain('<p>ok3</p>');
  const client = compileClient(source, 'App', { hydrate: true });
  expect(client).notToContain(' as ');
});

test('actions: typed defineAction execute is stripped from client and kept on server', () => {
  const source = `const signup = defineAction({
  input: { name: required('Name is required') },
  execute: async ({ name, email }: { name: string; email: string }): Promise<{ received: string }> => {
    return { received: \`\${name} <\${email}>\` }
  },
})`;
  const client = rewriteTopLevelActions(source, 'client');
  expect(client).notToContain(': string');
  expect(client).notToContain('Promise<');
  expect(client).toContain('__veskAction');
  const server = rewriteTopLevelActions(source, 'server');
  expect(server).notToContain(': string');
  expect(server).notToContain('Promise<');
  expect(server).toContain('defineAction');
});

test('actions: untyped defineAction passes through client rewrite without TS changes', () => {
  const source = `const signup = defineAction({
  input: { name: required('Name is required') },
  execute: async ({ name, email }) => {
    return { received: \`\${name} <\${email}>\` }
  },
})`;
  const client = rewriteTopLevelActions(source, 'client');
  expect(client).toContain('defineAction(');
  expect(client).notToContain(': string');
});

const results = () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
};
results();
