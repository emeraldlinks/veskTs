import { readFileSync, statSync } from 'node:fs';
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

interface CachedModule {
  mtimeMs: number;
  exports: Record<string, unknown>;
}

const MODULE_CACHE = new Map<string, CachedModule>();

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
 * component bodies can reference them. Resolution is relative to `sourcePath`
 * (the importing `.vsk` file). Best-effort: unresolvable/unloadable modules
 * warn and are skipped, matching how unresolvable `.vsk` imports are handled.
 */
export function applyLocalModuleImports(
  __vesk: Record<string, unknown>,
  importStrs: string[],
  sourcePath: string | undefined
): void {
  if (!sourcePath) return;
  const fromDir = dirname(sourcePath);
  for (const imp of importStrs) {
    if (!isLocalValueImport(imp)) continue;
    const target = importModuleTarget(imp) as string;
    const resolved = resolveSsrModule(target, fromDir);
    if (!resolved) {
      console.warn(`[vesk] SSR: cannot resolve "${target}" imported by ${sourcePath} — the imported name will be undefined during server render.`);
      continue;
    }
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

/** Loads (and caches, keyed by mtime) a module's export object. */
export function loadSsrModule(absPath: string): Record<string, unknown> | null {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
  const cachedVal = MODULE_CACHE.get(absPath);
  if (cachedVal && cachedVal.mtimeMs === mtimeMs) return cachedVal.exports;

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
    exportsObj = evaluateModuleFile(absPath);
  }

  if (exportsObj === null) {
    // Fall back to Node's own loader (works on Node >= 22.12 with TS
    // stripping) before giving up.
    exportsObj = nativeRequireFallback(absPath);
  }
  if (exportsObj === null) return null;

  MODULE_CACHE.set(absPath, { mtimeMs, exports: exportsObj });
  return exportsObj;
}

function evaluateModuleFile(absPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }

  let ast: ReturnType<typeof parse> | null = null;
  try {
    ast = parse(raw, { filename: absPath });
  } catch {
    ast = null;
  }

  const mod = { exports: {} as Record<string, unknown> };
  const dir = dirname(absPath);

  if (ast) {
    let stripped = ast;
    if (hasTsSyntax(ast)) stripped = stripTsTypes(ast);
    stripped.body = (stripped.body || []).filter((n: unknown) => {
      if (!n) return false;
      return !isTypeOnlyStatement(n);
    });
    try {
      const body = esmToCjs(stripped.body as Array<{ type: string }>);
      const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', body);
      fn(createModuleRequire(dir), mod, mod.exports, dir, absPath);
    } catch (err) {
      console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
      return null;
    }
  } else {
    // Not parseable as ESM — run verbatim as CJS.
    try {
      const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', raw);
      fn(createModuleRequire(dir), mod, mod.exports, dir, absPath);
    } catch (err) {
      console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
      return null;
    }
  }
  return mod.exports;
}

/** Recursive `require` used inside evaluated modules, rooted at their dir. */
function createModuleRequire(fromDir: string): (specifier: string) => unknown {
  return (specifier: string): unknown => {
    const resolved = resolveSsrModule(specifier, fromDir);
    if (!resolved) throw new Error(`Cannot find module '${specifier}'`);
    const loaded = loadSsrModule(resolved);
    if (loaded === null) throw new Error(`Cannot load module '${specifier}'`);
    return loaded;
  };
}

/**
 * Resolves a specifier to an absolute file path with extension probing:
 * relative/absolute localities, plus bare specifiers via node_modules walk-up.
 */
export function resolveSsrModule(specifier: string, fromDir: string): string | null {
  if (specifier === '.' || specifier === '..' || isAbsolute(specifier)) {
    return probeFile(resolve(specifier));
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return probeFile(resolve(fromDir, specifier));
  }
  // Bare specifier — walk up looking for a matching node_modules entry.
  let dir = fromDir;
  for (let depth = 0; depth < 64; depth++) {
    const base = join(dir, 'node_modules', specifier);
    const found = probeFile(base);
    if (found) return found;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
                if (d.id && d.id.type === 'Identifier') lines.push(`exports[${JSON.stringify(d.id.name)}] = ${d.id.name};`);
              }
            } else if ((declaration as { id?: { type: string; name?: string } }).id) {
              const name = (declaration as { id: { type: string; name?: string } }).id;
              lines.push(`exports[${JSON.stringify(name.name)}] = ${name.name};`);
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
            lines.push(`exports[${JSON.stringify(exportKeyName(exported))}] = ${memberAccess(modVar, local)};`);
          }
        } else {
          const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
          for (const spec of specifiers) {
            if (spec.exportKind === 'type') continue;
            const local = spec.local as { type: string; name?: string };
            const exported = spec.exported as { type: string; name?: string };
            lines.push(`exports[${JSON.stringify(exportKeyName(exported))}] = ${astName(local)};`);
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