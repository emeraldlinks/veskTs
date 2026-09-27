/**
 * `.vsk` export/import forms — every variant must behave like plain ESM.
 *
 * A `.vsk` component is a *registry entry* keyed by its declared name, not a
 * top-level binding. So `export { A }` cannot be emitted as JS (acorn rejects a
 * module export that names no binding, and esbuild rejects it for the same
 * reason) and `import { A as B } from './x.vsk'` has no binding to rewrite to a
 * local variable. Both are therefore recorded as *registry aliases*.
 *
 * This suite pins the full matrix, in both body modes (statement and
 * expression) where a component body is involved, and on both the SSR and
 * client paths.
 *
 * Run: npx tsx packages/compiler/src/vsk-exports.test.ts
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { render } from '@vesk/compiler/src/server-render';
import { compileFile } from '@vesk/compiler/src/server-render';
import { compileClientBoth } from '@vesk/compiler/src/client-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { findSpecifierExports, hasTopLevelValueDeclaration } from '@vesk/compiler/src/tokens';
import {
  vskRegistryAliases as vskRegistryAliasesImpl,
  applyVskRegistryAliases,
  collectVskReexportPaths,
} from '@vesk/compiler/src/vsk-imports';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(sub: string) {
      if (!String(actual).includes(sub)) {
        throw new Error(`Expected ${JSON.stringify(String(actual))} to contain ${JSON.stringify(sub)}`);
      }
    },
    toHaveLength(n: number) {
      if (actual.length !== n) throw new Error(`Expected length ${n}, got ${actual.length}: ${JSON.stringify(actual)}`);
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
    },
  };
}

function irOf(source: string, file?: string) {
  return generateIR(parse(source, file ? { filename: file } : {}), source, file);
}

/** Every ComponentCall reachable from a component IR, in source order. */
function collectCalls(comp: any): any[] {
  const out: any[] = [];
  const visit = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (n.constructor?.name === 'ComponentCall') {
      out.push(n);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      visit(n[k]);
    }
  };
  visit(comp.body);
  return out;
}

function renderComponent(source: string, name: string): string {
  return render(source, name, {}, new Map(), {}) as string;
}

// A temp project dir so `.vsk` imports/re-exports resolve against real files.
function withProject(files: Record<string, string>, entry: string, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'vsk-exp-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

describe('parse: specifier exports are extracted, not rejected', () => {
  it('parses `export { A }` for a component (acorn alone would reject it)', () => {
    const src = 'component A { <p>a</p> }\nexport { A }\n';
    const ast = parse(src, { filename: 'lib.vsk' });
    const pairs = (ast as any).__vskSpecifierExports;
    expect(pairs).toEqual([{ local: 'A', exported: 'A' }]);
  });

  it('parses `export { A as B }`', () => {
    const src = 'component A { <p>a</p> }\nexport { A as B }\n';
    const ir = irOf(src, 'lib.vsk');
    expect(ir.exportAliases).toEqual([{ local: 'A', exported: 'B' }]);
  });

  it('parses a multi-name specifier list', () => {
    const src = 'component A { <p>a</p> }\ncomponent B { <p>b</p> }\nexport { A, B as C }\n';
    const ir = irOf(src, 'lib.vsk');
    expect(ir.exportAliases).toEqual([
      { local: 'A', exported: 'A' },
      { local: 'B', exported: 'C' },
    ]);
  });

  it('never leaves the specifier statement in topLevelCode', () => {
    const ir = irOf('component A { <p>a</p> }\nexport { A }\n', 'lib.vsk');
    const emitted = ir.topLevelCode.join('\n');
    expect(emitted.includes('export {')).toBe(false);
  });

  it('preserves source offsets when the statement is blanked out', () => {
    // The strip replaces the statement with spaces, so a component declared
    // AFTER the export keeps its original source slice.
    const src = 'export { A }\ncomponent A { <p>a</p> }\n';
    const ir = irOf(src, 'lib.vsk');
    expect(ir.components).toHaveLength(1);
    expect(ir.components[0].name).toBe('A');
  });

  it('leaves export DECLARATIONS alone', () => {
    const ir = irOf('export component A { <p>a</p> }\n', 'lib.vsk');
    expect(ir.components[0].exported).toBe(true);
    expect(ir.exportAliases).toHaveLength(0);
  });

  it('leaves re-exports alone (they are resolved via reexportSources)', () => {
    const ir = irOf("export { A } from './a.vsk'\n", 'barrel.vsk');
    expect(ir.reexportSources).toEqual(['./a.vsk']);
    expect(ir.topLevelCode.join('').includes('export')).toBe(false);
  });

  it('records `export * from` sources', () => {
    const ir = irOf("export * from './a.vsk'\n", 'barrel.vsk');
    expect(ir.reexportSources).toEqual(['./a.vsk']);
  });

  it('records the alias of `export { A as B } from`', () => {
    const ir = irOf("export { A as B } from './a.vsk'\n", 'barrel.vsk');
    expect(ir.reexportSources).toEqual(['./a.vsk']);
    expect(ir.exportAliases).toEqual([{ local: 'A', exported: 'B' }]);
  });
});

describe('hasTopLevelValueDeclaration', () => {
  it('detects const/let/var/function/class declarations', () => {
    expect(hasTopLevelValueDeclaration('const A = 1', 'A')).toBe(true);
    expect(hasTopLevelValueDeclaration('let A = 1', 'A')).toBe(true);
    expect(hasTopLevelValueDeclaration('var A = 1', 'A')).toBe(true);
    expect(hasTopLevelValueDeclaration('function A() {}', 'A')).toBe(true);
    expect(hasTopLevelValueDeclaration('class A {}', 'A')).toBe(true);
  });

  it('reports a component declaration as NOT a value declaration', () => {
    expect(hasTopLevelValueDeclaration('component A { <p>a</p> }', 'A')).toBe(false);
  });
});

describe('a .ts/.js module keeps native export semantics', () => {
  it('`export { Thing as Renamed }` survives in a .ts file', () => {
    const src = 'class Thing { name = "t" }\nexport { Thing as Renamed };\n';
    const ast = parse(src, { filename: 'guide.ts' });
    // The statement is NOT stripped, so it survives in the AST.
    const exported = (ast.body as any[]).filter((n) => n.type === 'ExportNamedDeclaration');
    expect(exported).toHaveLength(1);
    expect((ast as any).__vskSpecifierExports).toBeUndefined();
  });

  it('`export { Thing as Renamed }` is stripped in a .vsk file (Thing is a component)', () => {
    const src = 'component Thing { <p>t</p> }\nexport { Thing as Renamed };\n';
    const ast = parse(src, { filename: 'lib.vsk' });
    expect((ast as any).__vskSpecifierExports).toEqual([{ local: 'Thing', exported: 'Renamed' }]);
  });
});

describe('a .vsk namespace import resolves component tags', () => {
  // `<ns.Icon />` needs no module object: the tag resolves through the same
  // registry entry `import { Icon }` would, keyed by the EXPORTED name. The
  // namespace object is never built and NO calleeExpr is carried, so both
  // codegen paths take the registry branch and keep their not-found guard.

  it('statement mode: resolves the tag to the exported name', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon label=\"a\" /></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].componentName).toBe('Icon');
    expect(calls[0].calleeExpr).toBe(null);
  });

  it('expression mode: resolves identically', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { return <div><NS.Icon /></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].componentName).toBe('Icon');
    expect(calls[0].calleeExpr).toBe(null);
  });

  it('passes props and children through', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon label=\"a\"><span>kid</span></NS.Icon></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0].props.map((p: any) => p.name)).toEqual(['label']);
    expect(calls[0].children.length).toBe(1);
  });

  it('client codegen emits a registry lookup, not a namespace deref', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon /></div> }\n";
    const code = compileClient(src, 'Page', { sourcePath: 'page.vsk' });
    expect(code).toContain('__components["Icon"]');
    expect(code.includes('(NS.Icon)')).toBe(false);
  });

  it('client hydrate codegen emits a registry lookup plus the not-found guard', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon /></div> }\n";
    const code = compileClient(src, 'Page', { sourcePath: 'page.vsk', hydrate: true });
    expect(code).toContain('__components["Icon"]');
    expect(code).toContain('was not found while rendering');
  });

  it('SSR raises the not-found message for an unregistered namespace tag', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon /></div> }\n";
    let err: any = null;
    try {
      renderComponent(src, 'Page');
    } catch (e) {
      err = e;
    }
    if (!err) throw new Error('Expected SSR to raise the not-found message');
    // Same wording a missing named import produces — proof the tag took the
    // registry path rather than being invoked as a namespace deref.
    expect(err.message).toContain('Component "Icon" was not found');
  });

  it('resolves an ALIASED export name (the target registers the alias getter)', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.PostCard /></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    expect(calls[0].componentName).toBe('PostCard');
    expect(calls[0].calleeExpr).toBe(null);
  });

  it('renders a real cross-file namespace tag on the SSR path', () => {
    withProject(
      {
        'lib.vsk': 'component Icon { <b class="ic">i</b> }\ncomponent Panel { <section><p>p</p></section> }\n',
        'page.vsk': "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Panel /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('<section>');
        expect(out).toContain('<p>p</p>');
      },
    );
  });

  it('rejects the nested form `<ns.Sub.Icon />` — a .vsk namespace is flat', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Sub.Icon /></div> }\n";
    let err: any = null;
    try {
      irOf(src, 'page.vsk');
    } catch (e) {
      err = e;
    }
    if (!err) throw new Error('Expected an error for a nested .vsk namespace tag');
    expect(err.message).toContain('namespace is flat');
    expect(err.suggestions.join(' ')).toContain("import { Icon } from './icons.vsk'");
  });

  it('rejects reading a namespace member as a VALUE (nothing binds ns at runtime)', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><p>{NS.MAX}</p></div> }\n";
    let err: any = null;
    try {
      irOf(src, 'page.vsk');
    } catch (e) {
      err = e;
    }
    if (!err) throw new Error('Expected an error for a .vsk namespace value read');
    expect(err.message).toContain('resolves component tags only');
    expect(err.suggestions.join(' ')).toContain("import { MAX } from './constants.vsk'");
  });

  it('rejects a namespace value read used as a prop', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><NS.Icon label={NS.LABEL} /></div> }\n";
    let threw = false;
    try {
      irOf(src, 'page.vsk');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('allows a namespace import from a .ts module (a real module object)', () => {
    const src = "import * as NS from './lib.ts'\ncomponent Page { <div><NS.Icon /></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    // A real module object: the member expression is carried verbatim.
    expect(calls[0].calleeExpr).toBe('NS.Icon');
  });

  it('does not fire for an unused namespace import', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { <div><p>hi</p></div> }\n";
    const ir = irOf(src, 'page.vsk');
    expect(ir.components).toHaveLength(1);
  });

  it('does not fire for a dotted tag bound to a plain local object', () => {
    const src = 'const ui = { Icon: null }\ncomponent Page { <div><ui.Icon /></div> }\n';
    const ir = irOf(src, 'page.vsk');
    expect(ir.components).toHaveLength(1);
  });

  // A name the file re-binds is not a namespace any more, so the tag is an
  // ordinary member expression and value reads are legitimate.
  it('falls back to the member path when a local shadows the namespace', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { const NS = { Icon: null }\n<div><NS.Icon /></div> }\n";
    const ir = irOf(src, 'page.vsk');
    const calls = collectCalls(ir.components[0]);
    expect(calls[0].calleeExpr).toBe('NS.Icon');
  });

  it('allows a value read off a shadowing local object', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { const NS = { MAX: 3 }\n<div><p>{NS.MAX}</p></div> }\n";
    const ir = irOf(src, 'page.vsk');
    expect(ir.components).toHaveLength(1);
  });

  it('allows a value read when a PARAMETER shadows the namespace', () => {
    const src = "import * as NS from './lib.vsk'\ncomponent Page { const el = (NS: any) => <p>{NS.MAX}</p>\n<div>{el({ MAX: 1 })}</div> }\n";
    const ir = irOf(src, 'page.vsk');
    expect(ir.components).toHaveLength(1);
  });
});

describe('findSpecifierExports', () => {
  it('finds a specifier list with a span', () => {
    const code = 'component A {}\nexport { A }';
    const found = findSpecifierExports(code);
    expect(found).toHaveLength(1);
    expect(found[0].local).toBe('A');
    expect(code.slice(found[0].start, found[0].end)).toBe('export { A }');
  });

  it('ignores `export * from` and `export default`', () => {
    expect(findSpecifierExports("export * from './a.vsk'")).toHaveLength(0);
    expect(findSpecifierExports('export default component A {}')).toHaveLength(0);
    expect(findSpecifierExports('export const X = 1')).toHaveLength(0);
  });

  it('ignores a re-export with a brace list', () => {
    expect(findSpecifierExports("export { A } from './a.vsk'")).toHaveLength(0);
  });
});

describe('vskRegistryAliases', () => {
  it('maps `import { A as B } from ./.vsk` to a registry alias', () => {
    const aliases = vskRegistryAliasesImpl(["import { A as B } from './x.vsk'"], []);
    expect(aliases).toEqual([{ local: 'A', exported: 'B' }]);
  });

  it('maps a same-file `export { A as B }` to a registry alias', () => {
    const aliases = vskRegistryAliasesImpl([], [{ local: 'A', exported: 'B' }]);
    expect(aliases).toEqual([{ local: 'A', exported: 'B' }]);
  });

  it('drops identity pairs (no alias needed)', () => {
    expect(vskRegistryAliasesImpl(["import { A } from './x.vsk'"], [{ local: 'A', exported: 'A' }])).toHaveLength(0);
  });

  it('ignores `default` and namespace specifiers', () => {
    expect(vskRegistryAliasesImpl(["import D from './x.vsk'"], [])).toHaveLength(0);
    expect(vskRegistryAliasesImpl(["import * as NS from './x.vsk'"], [])).toHaveLength(0);
  });

  it('ignores aliases from non-.vsk modules (real bindings exist there)', () => {
    expect(vskRegistryAliasesImpl(["import { A as B } from './x.js'"], [])).toHaveLength(0);
  });
});

describe('applyVskRegistryAliases', () => {
  it('registers the alias against the same function', () => {
    const fn = () => 'x';
    const map = new Map<string, Function>([['A', fn]]);
    applyVskRegistryAliases(map, [{ local: 'A', exported: 'B' }]);
    expect(map.get('B')).toBe(fn);
  });

  it('leaves an unresolvable name alone so the real error still names it', () => {
    const map = new Map<string, Function>();
    applyVskRegistryAliases(map, [{ local: 'Missing', exported: 'Gone' }]);
    expect(map.has('Gone')).toBe(false);
  });

  it('never overwrites an existing registration', () => {
    const own = () => 'own';
    const map = new Map<string, Function>([['A', () => 'a'], ['B', own]]);
    applyVskRegistryAliases(map, [{ local: 'A', exported: 'B' }]);
    expect(map.get('B')).toBe(own);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real files, real SSR + client codegen.
// ---------------------------------------------------------------------------

describe('SSR: export and import variants (statement mode)', () => {
  it('bare `component A {}` imported by name', () => {
    withProject(
      { 'lib.vsk': 'component A { <p class="o">A</p> }\n', 'page.vsk': "import { A } from './lib.vsk'\ncomponent Page { <div><A /></div> }\n" },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('A');
      }
    );
  });

  it('`export { A }` then imported by name', () => {
    withProject(
      { 'lib.vsk': 'component A { <p class="o">A</p> }\nexport { A }\n', 'page.vsk': "import { A } from './lib.vsk'\ncomponent Page { <div><A /></div> }\n" },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('A');
      }
    );
  });

  it('`export { A as B }` makes the ALIAS importable', () => {
    withProject(
      { 'lib.vsk': 'component A { <p class="o">A</p> }\nexport { A as Renamed }\n', 'page.vsk': "import { Renamed } from './lib.vsk'\ncomponent Page { <div><Renamed /></div> }\n" },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('A');
      }
    );
  });

  it('`import { A as B }` makes the LOCAL alias renderable', () => {
    withProject(
      { 'lib.vsk': 'component A { <p class="o">A</p> }\n', 'page.vsk': "import { A as B } from './lib.vsk'\ncomponent Page { <div><B /></div> }\n" },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('A');
      }
    );
  });

  it('`export * from "./x.vsk"` barrel', () => {
    withProject(
      {
        'barrel.vsk': "export * from './inner.vsk'\n",
        'inner.vsk': 'component Inner { <p class="o">IN</p> }\n',
        'page.vsk': "import { Inner } from './barrel.vsk'\ncomponent Page { <div><Inner /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('IN');
      }
    );
  });

  it('`export { A } from "./x.vsk"` named re-export', () => {
    withProject(
      {
        'barrel.vsk': "export { A } from './inner.vsk'\n",
        'inner.vsk': 'component A { <p class="o">RE</p> }\n',
        'page.vsk': "import { A } from './barrel.vsk'\ncomponent Page { <div><A /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('RE');
      }
    );
  });

  it('`export { A as B } from "./x.vsk"` aliased re-export', () => {
    withProject(
      {
        'barrel.vsk': "export { A as B } from './inner.vsk'\n",
        'inner.vsk': 'component A { <p class="o">AR</p> }\n',
        'page.vsk': "import { B } from './barrel.vsk'\ncomponent Page { <div><B /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('AR');
      }
    );
  });

  it('exports only the SECOND of several components', () => {
    withProject(
      {
        'lib.vsk': 'component First { <p class="o">1</p> }\ncomponent Second { <p class="o">2</p> }\nexport { Second }\n',
        'page.vsk': "import { Second } from './lib.vsk'\ncomponent Page { <div><Second /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('2');
      }
    );
  });
});

describe('SSR: export and import variants (expression mode)', () => {
  it('`export { A }` renders an expression-mode consumer', () => {
    withProject(
      { 'lib.vsk': 'component A { return <p class="o">AX</p> }\nexport { A }\n', 'page.vsk': "import { A as B } from './lib.vsk'\ncomponent Page { return <div><B /></div> }\n" },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('AX');
      }
    );
  });

  it('`export * from` barrel renders an expression-mode consumer', () => {
    withProject(
      {
        'barrel.vsk': "export * from './inner.vsk'\n",
        'inner.vsk': 'component Inner { return <p class="o">BX</p> }\n',
        'page.vsk': "import { Inner } from './barrel.vsk'\ncomponent Page { return <div><Inner /></div> }\n",
      },
      'page.vsk',
      (dir) => {
        const out = render(readPage(dir, 'page.vsk'), 'Page', {}, new Map(), { sourcePath: join(dir, 'page.vsk') });
        expect(out).toContain('BX');
      }
    );
  });
});

describe('client: compileClientBoth surfaces aliases and re-export paths', () => {
  it('returns an alias for a same-file specifier export', () => {
    const out = compileClientBoth('component A { <p>a</p> }\nexport { A as B }\n', null, 'lib.vsk', { skipHyd: true });
    expect(out.aliases).toEqual([{ local: 'A', exported: 'B' }]);
  });

  it('returns an alias for an aliased .vsk import', () => {
    const out = compileClientBoth("import { A as B } from './x.vsk'\ncomponent P { <B /> }\n", null, 'page.vsk', { skipHyd: true });
    expect(out.aliases).toEqual([{ local: 'A', exported: 'B' }]);
  });

  it('returns no aliases for a plain import', () => {
    const out = compileClientBoth("import { A } from './x.vsk'\ncomponent P { <A /> }\n", null, 'page.vsk', { skipHyd: true });
    expect(out.aliases).toHaveLength(0);
  });

  it('emits no raw `export {` into the client chunk', () => {
    const out = compileClient('component A { <p>a</p> }\nexport { A }\n', 'A', { sourcePath: 'lib.vsk', forceClient: true });
    expect(out).toContain('__components["A"]');
    expect(out.includes('export { A }')).toBe(false);
  });
});

describe('collectVskReexportPaths', () => {
  it('resolves a relative re-export target that exists', () => {
    withProject({ 'inner.vsk': 'component A {}\n' }, 'barrel.vsk', (dir) => {
      const paths = collectVskReexportPaths(['./inner.vsk'], join(dir, 'barrel.vsk'));
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(join(dir, 'inner.vsk'));
    });
  });

  it('skips a re-export target that does not exist', () => {
    withProject({}, 'barrel.vsk', (dir) => {
      expect(collectVskReexportPaths(['./missing.vsk'], join(dir, 'barrel.vsk'))).toHaveLength(0);
    });
  });

  it('skips non-.vsk re-export sources', () => {
    withProject({ 'x.js': '' }, 'barrel.vsk', (dir) => {
      expect(collectVskReexportPaths(['./x.js'], join(dir, 'barrel.vsk'))).toHaveLength(0);
    });
  });
});

describe('compileFile path', () => {
  it('compileFile keeps a same-file specifier export out of topLevelCode', () => {
    const result = compileFile('component A { <p>a</p> }\nexport { A }\n');
    expect(result.ir.topLevelCode.join('').includes('export {')).toBe(false);
    expect(result.componentMap.has('A')).toBe(true);
  });
});

// helper
function readPage(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf-8');
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passing, ${failed} failing`);
if (failed > 0) process.exit(1);
