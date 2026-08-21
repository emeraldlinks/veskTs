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

const RUNTIME_DTS = `export declare class Cell<T> { get(): T; set(v: T): void; peek(): T; update(f: (c: T) => T): boolean; unsubscribe(e: unknown): void; }
export declare function track<T>(initialValue: T): Cell<T>;
export declare function derived<T>(fn: () => T): Cell<T>;
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

const results = () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
};
results();
