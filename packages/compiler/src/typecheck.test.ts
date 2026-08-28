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

const RUNTIME_DTS = `export interface Tracked<T> { get(): T; set(value: T): void; }
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
export declare function createContext<T>(defaultValue?: T): { id: symbol; defaultValue: T | undefined };
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
