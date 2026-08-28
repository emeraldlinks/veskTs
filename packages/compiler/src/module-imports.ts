import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { parse } from '@vesk/compiler/src/parser';
import { stripTsTypes, hasTsSyntax, isTypeOnlyStatement } from '@vesk/compiler/src/strip-ts';
import { importModuleTarget } from '@vesk/compiler/src/tokens';

// =============================================================
// SSR module-value imports.
//
// The SSR scope (`__vesk`) is built by `buildComponentMap`/`loadRuntimeImports`
// and only ever contained two kinds of identifiers:
//   - runtime exports (from `@vesk/runtime` / `@vesk/reactivity`)
//   - top-level declarations in the `.vsk` file itself
//
// A `.vsk` component that imported a *value* from a plain `.ts`/`.js` module
// (e.g. `import { GUIDE } from '../lib/guide.ts'`) got those names into the
// client bundle but NEVER into the SSR scope — so the server component threw
// `ReferenceError: GUIDE is not defined` even though the client build was fine.
//
// This module closes that gap with a synchronous, self-contained module loader
// (no esbuild, no native `require(esm)`, works on the repo's supported Node):
//   - resolves local/relative/absolute/bare specifiers with extension probing
//   - strips TS, rewrites ESM `import`/`export` to a CJS `new Function` body
//   - evaluates with a recursive `require` so nested relative imports work
//   - caches per absolute path keyed on mtime so dev edits are picked up on
//     the next compile without a process restart
//
// Scope notes: `@vesk/*` targets stay compiler-controlled (runtime scope),
// `.vsk` targets resolve through the component registry, and `.css`/`.md`
// targets carry no runtime value — none of them are loaded here.
//
// Supported export forms: named/`default`/namespace imports, `export const`/
// `let`/`var`/`function`/`class`, `export { b as a }`, `export { x } from`,
// `export * from`, `export * as ns from`, `export default <expr>`. CJS files
// without import/export statements run verbatim. Everything unsupported falls
// back to native `require()` when available and otherwise warns + skips.
// =============================================================

const RUNTIME_PREFIXES = ['@vesk/runtime/', '@vesk/reactivity/', '@vesk/types', '@vesk/'];

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json'];

/** Marker prefix returned by `resolveSsrModule` for Node builtins. */
const BUILTIN_PREFIX = '\u0000builtin:';

/** Node builtins already loaded (never go stale; no mtime tracking). */
const BUILTIN_CACHE = new Map<string, Record<string, unknown>>();

interface CachedModule {
  mtimeMs: number;
  /** Absolute paths + mtimes resolved anywhere in this module's transitive eval tree. */
  deps: Array<{ path: string; mtimeMs: number }>;
  exports: Record<string, unknown>;
}

const MODULE_CACHE = new Map<string, CachedModule>();

/** Hard cap on cached modules — bounds long dev-session growth (LRU-ish: evicts oldest). */
const MAX_CACHE_ENTRIES = 256;

function cacheModule(p: string, val: CachedModule): void {
  MODULE_CACHE.delete(p);
  MODULE_CACHE.set(p, val);
  if (MODULE_CACHE.size > MAX_CACHE_ENTRIES) {
    MODULE_CACHE.delete(MODULE_CACHE.keys().next().value as string);
  }
}

/**
 * Active evaluation frames — an array (not a single slot) so nested module
 * evaluation keeps each ancestor's closure live. Every resolve performed by
 * `createModuleRequire` is recorded into ALL frames, so a module's invalidation
 * set is its full transitive dependency closure (editing a leaf invalidates
 * every ancestor that transitively depends on it).
 */
const depStack: Set<string>[] = [];

/** True when the import target is owned by the framework (never SSR-loaded). */
function isCompilerOwnedTarget(target: string): boolean {
  if (target === '@vesk/runtime' || target === '@vesk/reactivity') return true;
  for (const prefix of RUNTIME_PREFIXES) {
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

/** True when the target carries no value into the SSR scope. */
function isValueLessTarget(target: string): boolean {
  return (
    target.endsWith('.vsk') ||
    target.endsWith('.css') ||
    target.endsWith('.md') ||
    target.endsWith('.markdown')
  );
}

/**
 * AST-driven extraction of the value bindings introduced by one import
 * statement (`import { a as b } from 'm'` → `[{ local: 'b', imported: 'a' }]`;
 * `import X from 'm'` → `[{ local: 'X', imported: 'default' }]`;
 * `import * as X from 'm'` → `[{ local: 'X', imported: '*' }]`). Type-only
 * specifiers are skipped. Side-effect imports return `[]`.
 */
export function importBindingPairs(imp: string): Array<{ local: string; imported: string }> {
  const pairs: Array<{ local: string; imported: string }> = [];
  let ast: ReturnType<typeof parse> | null = null;
  try {
    ast = parse(imp, { filename: 'import.mjs' });
  } catch {
    ast = null;
  }
  if (!ast) return pairs;
  const stmt = (ast.body || []).find((n) => n.type === 'ImportDeclaration');
  if (!stmt) return pairs;
  const specifiers = (stmt.specifiers || []) as unknown as Array<{
    type: string;
    importKind?: string;
    local?: { name?: string };
    imported?: { name?: string; value?: string };
  }>;
  for (const spec of specifiers) {
    if (spec.importKind === 'type') continue;
    const local = spec.local?.name;
    if (!local) continue;
    if (spec.type === 'ImportDefaultSpecifier') {
      pairs.push({ local, imported: 'default' });
    } else if (spec.type === 'ImportNamespaceSpecifier') {
      pairs.push({ local, imported: '*' });
    } else {
      const importedSpec = (spec.imported || spec.local) as { name?: string; value?: string };
      const imported = importedSpec.name ?? importedSpec.value;
      if (imported) pairs.push({ local, imported });
    }
  }
  return pairs;
}

/** Local binding names imported from non-runtime, non-`.vsk` modules. */
export function localValueImportNames(importStrs: string[]): string[] {
  const names: string[] = [];
  for (const imp of importStrs) {
    const target = importModuleTarget(imp);
    if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
    for (const pair of importBindingPairs(imp)) names.push(pair.local);
  }
  return names;
}

/** True when an import line should be SSR-loaded (non-runtime, non-empty, non-`.vsk`). */
export function isLocalValueImport(imp: string): boolean {
  const target = importModuleTarget(imp);
  if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) return false;
  return importBindingPairs(imp).length > 0;
}

/**
 * Loads every local value import and merges its exports into `__vesk` so SSR
 * component bodies can reference them. Pure side-effect imports (`import './x'`)
 * are also resolved and executed so their module-level setup runs client AND
 * server. Resolution is relative to `sourcePath` (the importing `.vsk` file).
 *
 * Best-effort: unresolvable/unloadable modules warn and are skipped, matching
 * how unresolvable `.vsk` imports are handled. Unsupported ESM constructs
 * (import.meta/top-level await) THROW a specific error — loading them would
 * silently yield `undefined` at render.
 */
export function applyLocalModuleImports(
  __vesk: Record<string, unknown>,
  importStrs: string[],
  sourcePath: string | undefined
): void {
  if (!sourcePath) return;
  const fromDir = dirname(sourcePath);
  for (const imp of importStrs) {
    const target = importModuleTarget(imp);
    if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
    const resolved = resolveSsrModule(target, fromDir);
    if (!resolved) {
      console.warn(`[vesk] SSR: cannot resolve "${target}" imported by ${sourcePath} — the imported name will be undefined during server render.`);
      continue;
    }
    // Load always (a side-effect import runs the module's top-level code);
    // merge values only when the import actually binds names.
    const mod = loadSsrModule(resolved);
    if (!mod || typeof mod !== 'object') continue;
    for (const pair of importBindingPairs(imp)) {
      if (pair.imported === '*') {
        __vesk[pair.local] = mod;
      } else if (pair.imported in mod) {
        __vesk[pair.local] = (mod as Record<string, unknown>)[pair.imported];
      }
    }
  }
}

/** Best-effort: run the module through the native loader when possible. */
function nativeRequireFallback(absPath: string): Record<string, unknown> | null {
  try {
    // resolution is by absolute path so a bare/relative `require()` inside the
    // module is Node-handled (via createRequire ancestry).
    const req = createRequire(absPath) as unknown as (id: string) => unknown;
    const loaded = req(absPath);
    if (loaded && typeof loaded === 'object') return loaded as Record<string, unknown>;
    if (loaded !== null && loaded !== undefined) return { default: loaded };
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads (and caches) a module's export object. Cache entries track both the
 * module's own mtime and the mtimes of everything it transitively resolved,
 * so a change to any dependency invalidates every module that pulls it in.
 * Builtin markers load through Node and are cached separately (never stale).
 */
export function loadSsrModule(absPath: string): Record<string, unknown> | null {
  if (isBuiltinPath(absPath)) {
    return loadBuiltin(absPath.slice(BUILTIN_PREFIX.length));
  }

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
  // A module that is still evaluating links back to live partial exports —
  // the CJS analogue of ESM circular-import tolerance (no infinite recursion).
  const inFlight = EVALUATING.get(absPath);
  if (inFlight !== undefined) return inFlight;
  const cachedVal = MODULE_CACHE.get(absPath);
  if (cachedVal && cachedVal.mtimeMs === mtimeMs && depsFresh(cachedVal)) return cachedVal.exports;

  // Capture the transitive closure of this evaluation into the live frames.
  const frame = new Set<string>();
  depStack.push(frame);

  try {
    let exportsObj: Record<string, unknown> | null = null;
    if (absPath.endsWith('.json')) {
      try {
        exportsObj = JSON.parse(readFileSync(absPath, 'utf-8')) as Record<string, unknown>;
        if (exportsObj && typeof exportsObj === 'object' && !('default' in exportsObj)) {
          exportsObj.default = exportsObj;
        }
      } catch {
        exportsObj = null;
      }
    } else {
      exportsObj = {};
      EVALUATING.set(absPath, exportsObj);
      const ran = evaluateModuleFile(absPath, exportsObj);
      // Runtime evaluation failure (already warned) — give Node's own loader
      // a chance before giving up.
      if (!ran) exportsObj = null;
    }

    if (exportsObj === null) {
      exportsObj = nativeRequireFallback(absPath);
    }
    if (exportsObj === null) return null;

    cacheModule(absPath, { mtimeMs, deps: captureClosure(frame), exports: exportsObj });
    return exportsObj;
  } finally {
    depStack.pop();
    EVALUATING.delete(absPath);
  }
}

/** Snapshots the current stat of every file in a module's closure. */
function captureClosure(frame: Set<string>): Array<{ path: string; mtimeMs: number }> {
  const deps: Array<{ path: string; mtimeMs: number }> = [];
  for (const dep of frame) {
    try {
      deps.push({ path: dep, mtimeMs: statSync(dep).mtimeMs });
    } catch {
      // Missing now, but the parent re-check will hit the missing file and
      // treat it as changed — record it so stale entries get dropped.
      deps.push({ path: dep, mtimeMs: -1 });
    }
  }
  return deps;
}

/** True when every file in the module's dependency closure still matches. */
function depsFresh(cachedVal: CachedModule): boolean {
  for (const dep of cachedVal.deps) {
    try {
      if (statSync(dep.path).mtimeMs !== dep.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Runs one module file. Returns `true` when the body executed, `false` when a
 * runtime failure was already warned about. Unsupported ESM constructs throw —
 * the only honest outcome is a loud, specific error, never silently undefined.
 */
function evaluateModuleFile(absPath: string, exportsObj: Record<string, unknown>): boolean {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch (err) {
    console.warn(`[vesk] SSR: failed to read ${absPath}: ${(err as Error)?.message ?? String(err)}`);
    return false;
  }

  let ast: ReturnType<typeof parse> | null = null;
  try {
    ast = parse(raw, { filename: absPath });
  } catch {
    ast = null;
  }

  if (!ast) {
    // Not parseable as ESM — run verbatim as CJS.
    try {
      const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', raw);
      fn(createModuleRequire(dirname(absPath)), { exports: exportsObj }, exportsObj, dirname(absPath), absPath);
    } catch (err) {
      console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
      return false;
    }
    return true;
  }

  const unsupported = findUnsupportedEsm(ast.body as Array<{ type: string }>);
  if (unsupported) {
    throw new Error(
      `${absPath} uses ${unsupported} — not representable in the SSR module loader. ` +
        `Split it out of the module or avoid ${unsupported} in .vsk-imported code.`
    );
  }

  let stripped = ast;
  if (hasTsSyntax(ast)) stripped = stripTsTypes(ast);
  stripped.body = (stripped.body || []).filter((n: unknown) => {
    if (!n) return false;
    return !isTypeOnlyStatement(n);
  });

  const body = esmToCjs(stripped.body as Array<{ type: string }>);
  // ESM modules are always strict; mirror per-spec `this === undefined`.
  try {
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', "'use strict';\n" + body);
    fn(createModuleRequire(dirname(absPath)), { exports: exportsObj }, exportsObj, dirname(absPath), absPath);
  } catch (err) {
    console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
    return false;
  }
  return true;
}

const EVALUATING = new Map<string, Record<string, unknown>>();

/**
 * Detects ESM constructs the CJS rewrite cannot express, returning a
 * human-readable name (`import.meta`, `top-level await`) or `null`.
 * Nested usage inside function/class bodies is legal ESM and fine here.
 */
function findUnsupportedEsm(body: Array<{ type: string } & Record<string, unknown>>): string | null {
  for (const stmt of body) {
    const hit = scanUnsupportedNode(stmt);
    if (hit) return hit;
  }
  return null;
}

function scanUnsupportedNode(node: unknown, inFunction = false): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  const t = n.type as string | undefined;
  if (t === 'MetaProperty' || (t === 'MetaProperty' && (n.meta as { name?: string })?.name === 'import')) {
    return 'import.meta';
  }
  if (!inFunction && t === 'AwaitExpression') return 'top-level await';
  if (
    t === 'FunctionDeclaration' || t === 'FunctionExpression' ||
    t === 'ArrowFunctionExpression' || t === 'ClassDeclaration' || t === 'ClassExpression'
  ) {
    return null;
  }
  for (const key of Object.keys(n)) {
    const val = n[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          const sub = scanUnsupportedNode(item, inFunction);
          if (sub) return sub;
        }
      }
    } else if (val && typeof val === 'object') {
      const sub = scanUnsupportedNode(val, inFunction);
      if (sub) return sub;
    }
  }
  return null;
}

/** Recursive `require` used inside evaluated modules, rooted at their dir. */
function createModuleRequire(fromDir: string): (specifier: string) => unknown {
  return (specifier: string): unknown => {
    const resolved = resolveSsrModule(specifier, fromDir);
    if (!resolved) throw new Error(`Cannot find module '${specifier}'`);
    // Builtins are handled natively; files join every live evaluation frame so
    // the transitive closure stays fresh.
    for (const frame of depStack) frame.add(resolved);
    const loaded = loadSsrModule(resolved);
    if (loaded === null) throw new Error(`Cannot load module '${specifier}'`);
    return loaded;
  };
}

/**
 * Resolves a specifier to an absolute file path (or a `BUILTIN_PREFIX` marker
 * for Node builtins). Relative/absolute localities use extension probing;
 * bare specifiers (`npm-package`, `pkg/subpath`, `node:fs`, `fs`) prefer
 * Node's own resolver — which understands `exports` maps, conditions, scoped
 * packages and builtins — and fall back to a `node_modules` walk-up.
 *
 * Every resolved file path is normalized through `realpathSync` so two
 * specifiers pointing at the same physical file (e.g. pnpm/yarn symlinked
 * `node_modules`) share one cache entry and one module instance.
 */
export function resolveSsrModule(specifier: string, fromDir: string): string | null {
  let resolved: string | null = null;
  if (specifier === '.' || specifier === '..' || isAbsolute(specifier)) {
    resolved = probeFile(resolve(specifier));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    resolved = probeFile(resolve(fromDir, specifier));
  } else {
    // Bare specifier — prefer the native resolver (exports map, conditions,
    // builtins, symlinks), then fall back to a node_modules walk-up.
    const native = nativeResolve(specifier, fromDir);
    if (native) return native; // realpath'd inside nativeResolve / builtin marker
    let dir = fromDir;
    for (let depth = 0; depth < 64; depth++) {
      const base = join(dir, 'node_modules', specifier);
      const found = probeFile(base);
      if (found) {
        resolved = found;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return resolved ? toRealPath(resolved) : null;
}

/** Normalizes a resolved file path through `realpathSync` (no-op on failure). */
function toRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Native resolution of a bare specifier. `createRequire.resolve` returns an
 * absolute file path for packages; for builtins it returns the bare specifier
 * itself (`'node:fs'` / `'fs'`), which `resolveSsrModule` marks as a builtin.
 */
function nativeResolve(specifier: string, fromDir: string): string | null {
  try {
    const req = createRequire(join(fromDir, '__vesk_resolve__.js'));
    const resolved = req.resolve(specifier);
    if (isAbsolute(resolved)) return toRealPath(resolved);
    return builtinMarker(resolved);
  } catch {
    return null;
  }
}

function builtinMarker(name: string): string {
  return BUILTIN_PREFIX + name;
}

function isBuiltinPath(p: string): boolean {
  return p.startsWith(BUILTIN_PREFIX);
}

/** Loads a Node builtin module (never cached in `MODULE_CACHE`, never stale). */
function loadBuiltin(name: string): Record<string, unknown> | null {
  const id = name.startsWith('node:') ? name : `node:${name}`;
  const cachedVal = BUILTIN_CACHE.get(id);
  if (cachedVal) return cachedVal;
  try {
    const req = createRequire(join('/', '__vesk_builtin__.js'));
    const loaded = req(id);
    let mod: Record<string, unknown> | null = null;
    if (loaded && typeof loaded === 'object') mod = loaded as Record<string, unknown>;
    else if (loaded !== null && loaded !== undefined) mod = { default: loaded };
    if (mod) BUILTIN_CACHE.set(id, mod);
    return mod;
  } catch {
    return null;
  }
}

function statOrNull(p: string): { isFile: () => boolean; isDirectory: () => boolean } | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function probeFile(base: string): string | null {
  const st = statOrNull(base);
  if (st && st.isFile()) return base;
  if (st && st.isDirectory()) {
    const pkgPath = join(base, 'package.json');
    const pkgSt = statOrNull(pkgPath);
    if (pkgSt && pkgSt.isFile()) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { main?: unknown; exports?: unknown };
        if (typeof pkg.main === 'string' && pkg.main.length > 0) {
          const viaMain = probeFile(resolve(base, pkg.main));
          if (viaMain) return viaMain;
        }
      } catch {
        // ignore malformed package.json
      }
    }
    return probeFile(join(base, 'index'));
  }
  const ext = extname(base);
  if (ext.length === 0 || '/\\'.includes(base[base.length - 1] as string)) {
    for (const suffix of EXTENSIONS) {
      const candidate = base + suffix;
      const cst = statOrNull(candidate);
      if (cst && cst.isFile()) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ESM -> CJS rewriting (AST-driven; never regex).
// ---------------------------------------------------------------------------

function astName(node: { type: string; name?: string; value?: unknown } | null | undefined): string {
  if (!node) return 'undefined';
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  return printNode(node);
}

function printNode(node: unknown): string {
  try {
    return print(node as never, ts()).code.trim();
  } catch {
    return '';
  }
}

function memberAccess(obj: string, prop: { type: string; name?: string; value?: unknown }): string {
  if (prop.type === 'Identifier' && typeof prop.name === 'string') return `${obj}.${prop.name}`;
  if ((prop.type === 'Literal' || prop.type === 'StringLiteral') && typeof prop.value === 'string') {
    return `${obj}[${JSON.stringify(prop.value)}]`;
  }
  return `${obj}[${astName(prop)}]`;
}

/**
 * Unquoted string value of an export key node (Identifier name, string literal
 * value, or the printed node with its surrounding quotes stripped).
 */
function exportKeyName(node: { type: string; name?: string; value?: unknown } | null | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') return node.value;
  const printed = printNode(node);
  return stripOuterQuotes(printed);
}

function stripOuterQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'" || first === '`') && first === last) return s.slice(1, -1);
  }
  return s;
}

/**
 * Emits a live-binding getter for an export, so consumers observe mutations
 * the way real ESM live bindings do (a snapshot `exports.x = x` goes stale).
 */
function exportGetter(lines: string[], key: string, valueExpr: string): void {
  lines.push(`Object.defineProperty(exports, ${JSON.stringify(key)}, { get: () => ${valueExpr}, enumerable: true });`);
}

let exportCounter = 0;

/** Rewrites an ESM program body (imports/exports removed) into CJS statements. */
export function esmToCjs(body: Array<{ type: string } & Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const stmt of body) {
    switch (stmt.type) {
      case 'ImportDeclaration': {
        const source = printNode(stmt.source);
        const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
        if (specifiers.length === 0) {
          lines.push(`require(${source});`);
          continue;
        }
        for (const spec of specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') {
            lines.push(`const ${astName(spec.local as { type: string; name?: string })} = require(${source});`);
          } else if (spec.type === 'ImportDefaultSpecifier') {
            lines.push(`const ${astName(spec.local as { type: string; name?: string })} = require(${source}).default;`);
          } else {
            // ImportSpecifier
            const local = astName(spec.local as { type: string; name?: string });
            const imported = spec.imported as { type: string; name?: string } | null;
            if (imported && spec.importKind === 'type') continue;
            lines.push(`const ${local} = ${memberAccess(`require(${source})`, imported || (spec.local as { type: string; name?: string }))};`);
          }
        }
        break;
      }
      case 'ExportNamedDeclaration': {
        if (stmt.exportKind === 'type') continue;
        const declaration = stmt.declaration as Record<string, unknown> | null;
        const source = stmt.source ? printNode(stmt.source) : null;
        if (declaration) {
          const printed = printNode(declaration);
          if (printed) {
            lines.push(printed);
            if (declaration.type === 'VariableDeclaration') {
              const declarators = (declaration.declarations as Array<{ id?: { type: string; name?: string } }>) || [];
              for (const d of declarators) {
                if (d.id && d.id.type === 'Identifier') exportGetter(lines, exportKeyName(d.id), d.id.name ?? '');
              }
            } else if ((declaration as { id?: { type: string; name?: string } }).id) {
              const name = (declaration as { id: { type: string; name?: string } }).id;
              exportGetter(lines, exportKeyName(name), name.name ?? '');
            }
          }
        } else if (source) {
          const modVar = `__veskExport${exportCounter++}`;
          lines.push(`const ${modVar} = require(${source});`);
          const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
          for (const spec of specifiers) {
            if (spec.exportKind === 'type') continue;
            const local = spec.local as { type: string; name?: string };
            const exported = spec.exported as { type: string; name?: string };
            exportGetter(lines, exportKeyName(exported), memberAccess(modVar, local));
          }
        } else {
          const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
          for (const spec of specifiers) {
            if (spec.exportKind === 'type') continue;
            const local = spec.local as { type: string; name?: string };
            const exported = spec.exported as { type: string; name?: string };
            exportGetter(lines, exportKeyName(exported), astName(local));
          }
        }
        break;
      }
      case 'ExportDefaultDeclaration': {
        const declaration = stmt.declaration as Record<string, unknown>;
        if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
          if (declaration.id) {
            const name = (declaration.id as { name: string }).name;
            lines.push(printNode(declaration));
            lines.push(`exports.default = ${name};`);
          } else {
            const expr = { ...declaration, type: declaration.type === 'FunctionDeclaration' ? 'FunctionExpression' : 'ClassExpression' };
            lines.push(`exports.default = ${printNode(expr)};`);
          }
        } else {
          lines.push(`exports.default = ${printNode(declaration)};`);
        }
        break;
      }
      case 'ExportAllDeclaration': {
        const source = printNode(stmt.source);
        const modVar = `__veskExport${exportCounter++}`;
        lines.push(`const ${modVar} = require(${source});`);
        if (stmt.exported) {
          lines.push(`exports[${JSON.stringify(exportKeyName(stmt.exported as { type: string; name?: string; value?: unknown }))}] = ${modVar};`);
        } else {
          lines.push(`for (const __veskKey in ${modVar}) { if (__veskKey !== 'default' && __veskKey !== '__esModule' && !(__veskKey in exports)) exports[__veskKey] = ${modVar}[__veskKey]; }`);
        }
        break;
      }
      default:
        lines.push(printNode(stmt));
    }
  }
  return lines.join('\n');
}