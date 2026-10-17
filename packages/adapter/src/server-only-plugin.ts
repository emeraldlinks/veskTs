/**
 * esbuild plugin that keeps server-only packages out of a browser bundle.
 *
 * Why a plugin and not a filter on the chunk's own import list: by the time the
 * bundler runs, the chunk's direct imports have already been merged, and the
 * offender is almost never one of them. The shape that actually leaks is
 * `page.vsk → app/db.ts → slintorm → pg`, and only the bundler's transitive
 * resolution sees `pg` at all. Filtering the import list would have caught
 * nothing.
 *
 * A resolved server-only package is replaced with a generated module whose
 * every export is a Proxy that throws. A stub and not a deletion, because the
 * binding is referenced by code that survives into the chunk: dropping it would
 * produce `X is not defined` at hydration, pointing nowhere near the import that
 * caused it. The export names come from the importing statement, read off the
 * importer's own source, so the generated module declares exactly what the
 * importer asked for and nothing is silently undefined.
 *
 * TCP drivers are NOT stubbed. A browser bundle cannot contain one under any
 * circumstances, so a stub would ship a page that looks fine and fails at the
 * first query; they are reported and left for esbuild to reject.
 *
 * ## Shape
 *
 * ```ts
 * serverOnlyPlugin({
 *   onStub?:  (hit: { specifier, binding, importer }) => void,   // stubbed
 *   onDriver?:(hit: { specifier, importer }) => void,           // refused
 *   onEager?: (hit: { specifier, bindings: string[], importer }) => void, // module-scope: build error
 * })
 *
 * // helpers, exported for testing
 * importedNamesFor(code, specifier): string[]      // what the importer asks for
 * referencedAtTopLevel(code, name): boolean       // module-scope use?
 * stubFactorySource(specifier): string             // the shared throwing proxy
 * ```
 *
 * `onEager` returning null (rather than a stub) is deliberate: the browser would
 * evaluate that statement while loading the chunk, so there is no call site to
 * throw at.
 */
import { readFileSync } from 'node:fs';
import { parse } from '@vesk/compiler/src/parser';
import { classifySpecifier, type ServerOnlyKind } from '@vesk/adapter/src/server-only';

export interface ServerOnlyHit {
  specifier: string;
  binding: string;
  importer: string;
}

export interface ServerOnlyPluginOptions {
  /** One call per (specifier, binding) replaced by a throwing stub. */
  onStub?: (hit: ServerOnlyHit) => void;
  /** One call per TCP driver seen while bundling. Never stubbed. */
  onDriver?: (hit: { specifier: string; importer: string }) => void;
  /**
   * One call per binding used at module-evaluation position, where a stub would
   * throw while the chunk loads rather than at a call site. Reported, never
   * stubbed — this is a build error.
   */
  onEager?: (hit: { specifier: string; bindings: string[]; importer: string }) => void;
}

/** The slice of esbuild's plugin API this uses, declared so the module needs no esbuild types. */
export interface EsbuildPluginLike {
  name: string;
  setup: (build: {
    onResolve: (
      opts: { filter: RegExp; namespace?: string },
      cb: (args: { path: string; importer: string }) => unknown,
    ) => void;
    onLoad: (
      opts: { filter: RegExp; namespace: string },
      cb: (args: { path: string }) => { contents: string; loader: string },
    ) => void;
  }) => void;
}

const STUB_NAMESPACE = 'vesk-server-only';

let stubCounter = 0;

/**
 * The export names one file asks for from `specifier`.
 *
 * Read from the importer's own source rather than guessed: a stub declaring the
 * wrong set of names is either an unresolvable-import build failure or, worse,
 * a silently undefined binding.
 */
export function importedNamesFor(code: string, specifier: string): string[] {
  let ast: {
    body?: Array<{
      type?: string;
      source?: unknown;
      specifiers?: Array<{ type?: string; local?: { name?: string }; imported?: { name?: string; value?: string } }>;
    }>;
  };
  try {
    ast = parse(code) as typeof ast;
  } catch {
    return [];
  }
  const names: string[] = [];
  // The vsk parser flattens a module specifier to a bare string, while the TS
  // parser keeps it as `{ value }`. Both shapes occur in practice.
  const sourceOf = (node: { source?: unknown }): string | null => {
    const src = node.source;
    if (typeof src === 'string') return src;
    const v = (src as { value?: unknown } | undefined)?.value;
    return typeof v === 'string' ? v : null;
  };
  for (const node of ast.body ?? []) {
    if (node?.type === 'ImportDeclaration') {
      if (sourceOf(node) !== specifier) continue;
      for (const spec of node.specifiers ?? []) {
        // `import * as x` has no names to declare — the namespace is made of
        // whatever the importer reaches for, and each of those reads is what
        // throws. Declaring guesses would be worse than declaring none.
        if (spec.type === 'ImportNamespaceSpecifier') continue;
        const local = spec.local?.name;
        if (typeof local === 'string' && !names.includes(local)) names.push(local);
      }
      continue;
    }
    if (node?.type === 'ExportAllDeclaration' || node?.type === 'ExportNamedDeclaration') {
      if (sourceOf(node) !== specifier) continue;
      // `export * from 'pg'` names nothing at all, and `export { Client } from
      // 'pg'` names only what this barrel happens to forward. Either way the
      // honest stub declares what is written here.
      for (const spec of node.specifiers ?? []) {
        const imported = spec.imported?.name ?? spec.imported?.value ?? spec.local?.name;
        if (typeof imported === 'string' && !names.includes(imported)) names.push(imported);
      }
    }
  }
  return names;
}

/** The shared throwing-proxy factory, emitted once per stubbed package. */
export function stubFactorySource(specifier: string): string {
  const template =
    '"$1" comes from "$0", which is server-only. It reached the browser bundle because a ' +
    'component (or a module one imports) imported it — component code runs in the browser, ' +
    'where this module cannot work. Move the server-only work into an API route ' +
    '(app/api/**/route.ts) or a server action and call it over HTTP, or import the ' +
    'edge/browser-safe entry if the package ships one.';
  return [
    'function __vesk_stub(binding) {',
    '  var message = ' + JSON.stringify(template) + ';',
    '  message = message.replace("$0", ' + JSON.stringify(specifier) + ').replace("$1", String(binding));',
    '  var thrower = function () { throw Object.assign(new Error(message), { __veskServerOnly: ' + JSON.stringify(specifier) + ' }); };',
    '  return new Proxy(function () {}, {',
    '    get: thrower,',
    '    apply: thrower,',
    '    construct: thrower',
    '  });',
    '}',
  ].join('\n');
}

/**
 * Is `name` used at module-evaluation position — i.e. NOT inside a function?
 *
 * This is the difference between a stub that is fine and one that is a trap.
 *
 *   export function allRows() { return orm.getAll(); }   // never runs in the
 *                                                      // browser → stub is fine
 *   export const orm = createORM({});                   // runs the moment the
 *                                                      // chunk evaluates
 *
 * The second form cannot be rescued by any amount of stubbing: the browser
 * evaluates it while loading the chunk, so the page dies before a single
 * component exists. A build error is the honest answer there, and it is
 * decidable from the source alone — no types, no dataflow.
 *
 * Non-computed member keys (`obj.orm`) and object/class property keys are not
 * references, for the same reason the reactivity diagnostics skip them.
 */
export function referencedAtTopLevel(code: string, name: string): boolean {
  let ast: { body?: unknown[] };
  try {
    ast = parse(code) as typeof ast;
  } catch {
    // Cannot prove it either way; assume the dangerous case so the build is
    // never softened by an unparseable file.
    return true;
  }
  let found = false;
  const FUNCTION_TYPES = new Set([
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
    'ClassMethod', 'ObjectMethod', 'ClassDeclaration', 'ClassExpression',
  ]);
  /** Never carries a reference: AST bookkeeping and source offsets. */
  const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw', 'regex']);
  /** A re-export's module specifier and specifier list name bindings, not use them. */
  const SKIP_EXPORT_NAMED_KEYS = new Set([...SKIP_KEYS, 'source', 'specifiers', 'exportKind', 'attributes']);

  const visit = (node: unknown, parentKey: string | undefined, fnDepth: number): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parentKey, fnDepth);
      return;
    }
    const n = node as Record<string, unknown>;

    if (n.type === 'MemberExpression' || n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'MethodDefinition') {
      const prop = (n.property ?? n.key) as { name?: unknown } | undefined;
      // `obj.orm` and `{ orm: 1 }` name a field, not the binding. `[orm]` does.
      if (prop && typeof prop === 'object' && prop.name === name && n.computed !== true) return;
    }
    // An import NAMES the binding without USING it. Walking into the specifiers
    // made every imported name look top-level-referenced, which would have
    // turned every server-only import into a build error.
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ImportExpression') return;
    if (n.type === 'Identifier' && n.name === name) {
      if (parentKey === 'local' || parentKey === 'id' || parentKey === 'params' || parentKey === 'key') return;
      if (fnDepth === 0) found = true;
      return;
    }
    // `export const orm = createORM({})` carries its USE inside the export
    // declaration, so only the specifier list and module specifier are skipped.
    const skip = n.type === 'ExportNamedDeclaration' ? SKIP_EXPORT_NAMED_KEYS : SKIP_KEYS;
    const nextDepth = FUNCTION_TYPES.has(String(n.type)) ? fnDepth + 1 : fnDepth;
    for (const [key, value] of Object.entries(n)) {
      if (skip.has(key)) continue;
      visit(value, key, nextDepth);
    }
  };
  visit(ast.body, undefined, 0);
  return found;
}

export function serverOnlyPlugin(options: ServerOnlyPluginOptions = {}): EsbuildPluginLike {
  /** Generated stub id -> module source. */
  const stubs = new Map<string, string>();

  return {
    name: 'vesk-server-only',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        const kind: ServerOnlyKind | null = classifySpecifier(args.path);
        if (!kind) return null;
        if (kind === 'tcp-driver') {
          options.onDriver?.({ specifier: args.path, importer: args.importer });
          // Returning null lets esbuild resolve it normally, which in a browser
          // bundle fails with its own "Could not resolve" error. Substituting a
          // stub here would ship a page that looks fine and dies on first use.
          return null;
        }
        let names: string[] = [];
        let importerCode = '';
        try {
          importerCode = readFileSync(args.importer, 'utf-8');
          names = importedNamesFor(importerCode, args.path);
        } catch {
          /* importer unreadable — emit a default-only stub rather than crash */
        }
        // A stub only works if the browser never reaches the binding. A
        // module-evaluation-position use means the browser reaches it while
        // loading the chunk, before any component exists, so no stub can help
        // and the build has to say so rather than ship a page that dies on load.
        const eager = names.filter(n => referencedAtTopLevel(importerCode, n));
        if (eager.length > 0) {
          options.onEager?.({ specifier: args.path, bindings: eager, importer: args.importer });
          return null;
        }
        const id = `vesk-stub-${stubCounter++}`;
        stubs.set(id, [
          stubFactorySource(args.path),
          'export default __vesk_stub("default");',
          ...names.map(n => `export const ${n} = __vesk_stub(${JSON.stringify(n)});`),
        ].join('\n'));
        for (const binding of names) {
          options.onStub?.({ specifier: args.path, binding, importer: args.importer });
        }
        return { path: id, namespace: STUB_NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: STUB_NAMESPACE }, args => ({
        contents: stubs.get(args.path) ?? stubFactorySource('unknown'),
        loader: 'js',
      }));
    },
  };
}