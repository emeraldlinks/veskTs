import { typecheckProject, formatTypecheckErrors } from '@vesk/compiler/src/typecheck';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}

const RUNTIME_DTS = `import type { VeskLocals } from '@vesk/types';
export interface Tracked<T> { get(): T; set(value: T): void; }
export interface Derived<T> { get(): T; set(value: T): void; }
export declare function track<T>(initialValue: T): Tracked<T>;
export declare function track<T>(fn: () => T): Derived<T>;
export declare function derived<T>(fn: () => T): Derived<T>;
export declare function effect(fn: () => void): unknown;
export declare function untrack<T>(fn: () => T): T;
export declare function peek<T>(fn: () => T): T;
export declare function tick(): Promise<void>;
export declare function flushSync(fn: () => void): void;
export declare function on_destroy(fn: () => void): void;
export interface VeskContext<T> { readonly id: symbol; get(): T; set(value: T): void; }
export declare function createContext<const T>(defaultValue: T): VeskContext<T>;
export interface VeskLocals<T extends object> {
  set<K extends keyof T>(key: K, value: T[K]): void;
  get<K extends keyof T>(key: K): T[K];
  has<K extends keyof T>(key: K): boolean;
  delete<K extends keyof T>(key: K): void;
  all(): T;
}
export declare function createLocals<T extends object = Record<string, unknown>>(): VeskLocals<T>;
export declare function locals<L extends object = VeskLocals>(): L;
`;

const CLEAN_PAGE = `component Page() {\n  const ok: string = 'fine'\n  <p>{ok}</p>\n}\n`;

interface Fixture {
  root: string;
  files: Record<string, string>;
  cleanup: () => void;
}

function fixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'vesk-tc-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(join(root, 'node_modules', '@vesk', 'runtime'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '@vesk', 'runtime', 'index.d.ts'), RUNTIME_DTS);
  return {
    root,
    files,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('typecheck: context value type flows from createContext through get()', () => {
  const f = fixture({
    'app/page.vsk': `import { createContext } from '@vesk/runtime';

const Theme = createContext<'light' | 'dark'>('light');

export component Page() {
	Theme.set('dark');
	const theme: 'light' | 'dark' = Theme.get();
	<p>{theme}</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean typecheck, got:\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: createContext infers the literal type of the default', () => {
  const f = fixture({
    'app/page.vsk': `import { createContext } from '@vesk/runtime';

const Theme = createContext('light');

export component Page() {
	// 'light' is the inferred literal type, so 'dark' must be rejected.
	Theme.set('dark');
	<p>ok</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('page.vsk')) {
      throw new Error(`expected an error for setting an unlisted literal, got:\n${msgs || '(no errors)'}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: context rejects a wrong-typed value', () => {
  const f = fixture({
    'app/page.vsk': `import { createContext } from '@vesk/runtime';

interface User { name: string }
const CurrentUser = createContext<User | null>(null);

export component Page() {
	CurrentUser.set({ name: 42 });
	<p>ok</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('page.vsk')) {
      throw new Error(`expected an error for a wrong-typed context value, got:\n${msgs || '(no errors)'}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: createLocals links keys to their value types', () => {
  const f = fixture({
    'app/page.vsk': `import { createLocals } from '@vesk/runtime';

interface User { name: string }
const appLocals = createLocals<{ user: User | null; requestId: string }>();

export component Page() {
	appLocals.set('requestId', 'abc');
	const id: string = appLocals.get('requestId');
	const user: User | null = appLocals.get('user');
	<p>{id}{user?.name}</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean typecheck, got:\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: diagnostics map generated TSX positions back to .vsk source lines', () => {
  const f = fixture({
    'app/page.vsk': `component Page() {
  const count: number = 'wrong'
  <p>{count}</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('app/page.vsk(2,9): TS2322')) {
      throw new Error(`expected source-mapped .vsk diagnostic, got:\\n${msgs || '(no errors)'}`);
    }
    if (msgs.includes('__vesk_ambient.d.ts')) {
      throw new Error(`ambient shim leaked into diagnostic output:\\n${msgs}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: augmented VeskLocals types ambient locals globally', () => {
  const f = fixture({
    'app/types.d.ts': `declare module '@vesk/types' {
  interface VeskLocals {
    user: { name: string } | null
    requestId: string
  }
  interface MiddlewareContext<L extends Record<string, unknown> = VeskLocals> {
    set<T extends Record<string, unknown> = L, K extends keyof T & string = keyof T & string>(key: K, value: T[K]): void
    set<K extends keyof L & string>(key: K, value: L[K]): void
    get<K extends keyof L & string>(key: K): L[K]
  }
}
`,
    'app/middleware.ts': `import type { MiddlewareContext } from '@vesk/types'

export async function middleware(ctx: MiddlewareContext, next: () => Promise<Response>) {
	ctx.set('requestId', 'abc')
	const id: string = ctx.get('requestId')
	type AppLocals = { user: { name: string } | null }
	ctx.set<AppLocals>('user', { name: 'Ada' })
	const user: { name: string } | null = ctx.get('user')
	return next()
}
`,
    'app/page.vsk': `import { locals } from '@vesk/runtime'

export component Page() {
	const requestLocals = locals()
	const id: string = requestLocals.requestId
	const user: { name: string } | null = requestLocals.user
	<p>{id}{user?.name}</p>
}
`,
  });
  mkdirSync(join(f.root, 'node_modules', '@vesk', 'types'), { recursive: true });
  writeFileSync(join(f.root, 'node_modules', '@vesk', 'types', 'index.d.ts'), `export interface VeskLocals extends Record<string, unknown> {}
export interface MiddlewareContext<L extends Record<string, unknown> = VeskLocals> {
  set<T extends Record<string, unknown> = L, K extends keyof T & string = keyof T & string>(key: K, value: T[K]): void
  set<K extends keyof L & string>(key: K, value: L[K]): void
  get<K extends keyof L & string>(key: K): L[K]
}
`);
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean augmented typecheck, got:\\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: createLocals rejects a wrong value type for a known key', () => {
  const f = fixture({
    'app/page.vsk': `import { createLocals } from '@vesk/runtime';

const appLocals = createLocals<{ requestId: string }>();

export component Page() {
	appLocals.set('requestId', 123);
	<p>ok</p>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('page.vsk')) {
      throw new Error(`expected an error for a wrong locals value type, got:\n${msgs || '(no errors)'}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: a bare for-of loop variable is treated as a declaration', () => {
  // `for (p of xs)` declares nothing in TypeScript, so passing it straight
  // through made every use of `p` an error ("Cannot find name 'p'").
  const f = fixture({
    'app/page.vsk': `interface Post { title: string }
export component Home() {
	const posts: Post[] = []
	for (p of posts) {
		<span>{p.title}</span>
	}
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean typecheck, got:\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: a bare for-in loop variable is treated as a declaration', () => {
  const f = fixture({
    'app/page.vsk': `export component Home() {
	const bag: Record<string, number> = {}
	for (k in bag) {
		<span>{bag[k]}</span>
	}
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean typecheck, got:\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: an explicit const/let loop variable is preserved', () => {
  const f = fixture({
    'app/page.vsk': `export component Home() {
	const xs: number[] = [1, 2]
	for (const x of xs) {
		<span>{x}</span>
	}
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') throw new Error(`expected a clean typecheck, got:\n${msgs}`);
  } finally { f.cleanup(); }
});

test('typecheck: same-named components in different files do not collide', () => {
  // Without module identity each generated file is a *script*, so two
  // components named the same became duplicate globals.
  const f = fixture({
    'app/a/page.vsk': `export component Dup() { <p>a</p> }\n`,
    'app/b/page.vsk': `export component Dup() { <p>b</p> }\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs.includes('Duplicate function implementation')) {
      throw new Error(`same-named components collided:\n${msgs}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: an unannotated track() keeps its element type for callbacks', () => {
  // `let items: any = track([...])` erased the type, so `items.map(n => ...)`
  // failed under strict with an implicit-any parameter.
  const f = fixture({
    'app/page.vsk': `export component Home() {
	let &[items] = track([10, 20, 30])
	<div>{items.map(n => <span key={n}>{n}</span>)}</div>
}
`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs.includes("implicitly has an 'any' type")) {
      throw new Error(`track() lost its element type:\n${msgs}`);
    }
  } finally { f.cleanup(); }
});

test('typecheck: reports errors in .ts files outside app/ (components, src, anywhere)', () => {
  const f = fixture({
    'app/page.vsk': CLEAN_PAGE,
    'components/card.ts': `export function label(n: number): string { return n; }\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('components/card.ts')) {
      throw new Error(`expected error in components/card.ts, got:\n${msgs}`);
    }
    if (errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error(`app/page.vsk should be clean, got errors:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: catches type errors in brand-new .vsk files (no git dependency)', () => {
  const f = fixture({
    'app/page.vsk': CLEAN_PAGE,
    'app/new.vsk': `<script>\n  const n: number = 'bad'\n</script>\n<p>{n}</p>\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('app/new.vsk')) {
      throw new Error(`expected error in new app/new.vsk, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: walks the full project tree, not just app/', () => {
  const f = fixture({
    'app/page.vsk': CLEAN_PAGE,
    'src/deep/nested/util.ts': `export const bad: number = 'nope';\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('src/deep/nested/util.ts')) {
      throw new Error(`expected error in src/deep/nested/util.ts, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: structure warning for middleware.vsk (must be .ts)', () => {
  const f = fixture({
    'app/middleware.vsk': `<script>\n  const x = 1\n</script>\n`,
  });
  try {
    const { warnings, errors } = typecheckProject(f.root);
    if (errors.length > 0) {
      throw new Error(`expected no type errors, got:\n${formatTypecheckErrors(errors)}`);
    }
    const w = warnings.find((x) => x.code === 'vesk-structure' && x.file.includes('middleware.vsk'));
    if (!w) {
      throw new Error(`expected vesk-structure warning for middleware.vsk, got:\n${warnings.map((x) => x.file).join(', ')}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: parses every .vsk and reports vesk-parse failures', () => {
  const f = fixture({
    'app/broken.vsk': `<script>\n  const ok = 1\n</script>\n<p>{ok}</p>\n<p>extra root</p>\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (!msgs.includes('vesk-parse')) {
      throw new Error(`expected vesk-parse error, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: skips node_modules, dist and generated virtual files', () => {
  const f = fixture({
    'app/page.vsk': CLEAN_PAGE,
    'dist/bundle.ts': `export const bad: number = 'skip me';\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs.includes('dist/')) {
      throw new Error(`dist/ should be skipped, got:\n${msgs}`);
    }
    if (msgs !== '') {
      throw new Error(`expected clean typecheck, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: auto-imported names (useFetch etc.) resolve without an import', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const posts = await useFetch<{ id: number }[]>('/api/posts')\n  <Link href="/">home</Link>\n  <p>{posts.length}</p>\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for auto-imported names, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: LoadingIndicator + useLoadingIndicator typecheck (statement mode)', () => {
  const f = fixture({
    'app/page.vsk': `component Page() {\n  <LoadingIndicator color="#f00" height={4} position="bottom" />\n}\n`,
    'app/custom.vsk': `component Custom() {\n  const li = useLoadingIndicator({ duration: 900 })\n  effect(() => {\n    if (li.isLoading.get()) {\n      console.log(li.progress.get())\n    }\n  })\n  <div class={li.error.get() ? 'err' : 'ok'}>state</div>\n}\n`,
    'app/bad.vsk': `component Bad() {\n  <LoadingIndicator height={true} />\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const inPageOrCustom = errors.filter((e) => e.file.includes('page.vsk') || e.file.includes('custom.vsk'));
    if (inPageOrCustom.length > 0) {
      throw new Error(`expected clean typecheck for loading-indicator usage, got:\n${formatTypecheckErrors(inPageOrCustom)}`);
    }
    if (!errors.some((e) => e.file.includes('bad.vsk'))) {
      throw new Error('expected tsc error for height={true} on LoadingIndicator');
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: const track decl typechecks (no "const let" regression)', () => {
  const f = fixture({
    'app/page.vsk': `component Page() {\n  const &[count] = track<number>(10)\n  <p>{count}</p>\n}\n`,
    'app/multi.vsk': `component Multi() {\n  const &[posts, cell] = track<number[]>([])\n  <p>{posts.length}</p>\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for track decls, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: un-awaited useFetch is not the data — direct member access errors', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const posts = useFetch<{ id: number }[]>('/api/posts')\n  for (const p of posts) {\n    <p>{p.id}</p>\n  }\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    if (!errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error('expected tsc errors for iterating an un-awaited useFetch resource');
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: awaited useFetch yields T', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const posts = await useFetch<{ id: number }[]>('/api/posts')\n  for (const p of posts) {\n    <p>{p.id}</p>\n  }\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for awaited useFetch, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: useFetch.text/json/arrayBuffer resolve via the ambient namespace', () => {
  const f = fixture({
    'app/page.vsk': [
      'async component Page() {',
      "  const doc = await useFetch.text<string>('/docs/readme.md')",
      "  const data = await useFetch.json<{ ok: boolean }>('/api/status')",
      "  const buf = await useFetch.arrayBuffer('/assets/blob.bin')",
      '  <p>{doc.length + (data.ok ? 1 : 0) + buf.byteLength}</p>',
      '}',
    ].join('\n'),
    'app/stmt.vsk': [
      'async component DocView() {',
      "  const res = useFetch.text('/docs/readme.md', { key: 'doc' })",
      '  if (res.loading) {',
      "    <p>Loading…</p>",
      '  }',
      '  const doc = await res',
      '  if (doc) {',
      '    <p>{doc.slice(0, 80)}</p>',
      '  }',
      '}',
    ].join('\n'),
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for useFetch statics, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: useFetch.text rejects body (Omit<..., "body"> works)', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const doc = await useFetch.text('/docs/readme.md', { body: 'x' })\n  <p>{doc}</p>\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    if (!errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error('expected tsc error for body on useFetch.text');
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: useFetch into a tracked cell needs no await and stays clean', () => {
  const f = fixture({
    'app/page.vsk': `component Page() {\n  const &[posts, postsCell] = track<{ id: number }[]>([])\n  const res = useFetch('/api/posts', { key: 'posts', into: postsCell })\n  <span>{res.loading ? 'Loading' : 'Fresh'}</span>\n  <button onClick={() => res.refresh()}>r</button>\n  for (const p of posts) {\n    <p>{p.id}</p>\n  }\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for useFetch-into-cell, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: unknown useFetch option keys error (options are typed)', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const posts = await useFetch<{ id: number }[]>('/api/posts', { kye: 'posts' })\n  <p>{posts.length}</p>\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    if (!errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error('expected tsc error for misspelled useFetch option key');
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: into must be a tracked cell (wrong type errors)', () => {
  const f = fixture({
    'app/page.vsk': `async component Page() {\n  const posts = await useFetch<{ id: number }[]>('/api/posts', { into: 42 })\n  <p>{posts.length}</p>\n}\n`,
  });
  try {
    const { errors } = typecheckProject(f.root);
    if (!errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error('expected tsc error for non-cell into value');
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: full typed useFetch options set stays clean', () => {
  const f = fixture({
    'app/page.vsk': [
      'component Page() {',
      '  const &[posts, cell] = track<string[]>([])',
      "  useFetch('/api/posts', {",
      "    key: 'posts',",
      '    into: cell,',
      '    staleTime: 30000,',
      '    keepPreviousData: true,',
      '    retry: 2,',
      '    retryDelay: 400,',
      '    timeout: 8000,',
      '    enabled: true,',
      '    dedupe: true,',
      "    method: 'GET',",
      "    headers: { accept: 'application/json' },",
      '  })',
      '  <p>{posts.length}</p>',
      '}',
    ].join('\n'),
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (msgs !== '') {
      throw new Error(`expected clean typecheck for fully-typed options, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: typed JSX intrinsics accept known attributes (AMBIENT IntrinsicElements)', () => {
  const f = fixture({
    'app/page.vsk': [
      'component Page() {',
      "  <a href=\"/about\" target=\"_blank\">About</a>",
      "  <img src=\"/logo.png\" alt=\"Logo\" width={120} />",
      '  <input type="text" value={42} placeholder="Type..." />',
      "  <button onClick={() => {}} disabled={false}>Go</button>",
      '}',
    ].join('\n'),
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error(`typed intrinsic attrs should typecheck clean, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

test('typecheck: unknown/custom tags still permissive via IntrinsicElements index fallback', () => {
  const f = fixture({
    'app/page.vsk': [
      'component Page() {',
      '  <my-web-component someunknownattr="1">hi</my-web-component>',
      '  <Head><title>T</title></Head>',
      '}',
    ].join('\n'),
  });
  try {
    const { errors } = typecheckProject(f.root);
    const msgs = formatTypecheckErrors(errors);
    if (errors.some((e) => e.file.includes('page.vsk'))) {
      throw new Error(`custom tags must stay permissive, got:\n${msgs}`);
    }
  } finally {
    f.cleanup();
  }
});

const results = () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
};
results();
