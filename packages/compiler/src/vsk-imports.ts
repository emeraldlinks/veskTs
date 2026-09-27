import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { parse } from '@vesk/compiler/src/parser';
import { importBindingPairs, resolveImportPath } from '@vesk/compiler/src/module-imports';
import { importModuleTarget, tokenizeCode } from '@vesk/compiler/src/tokens';

/**
 * Resolve `import ... from './path.vsk'` statements so helper components can
 * live in arbitrary `.vsk` files and be imported into any page, layout,
 * component or route file. Bare-alias specifiers (`@/components/Button.vsk`,
 * `@app/...` and anything else mapped by tsconfig `paths`) also resolve, so a
 * shared component in `components/` can be imported with the root `@/` alias
 * exactly like in Next.js.
 */

export function vskImportTarget(importText: string): string | null {
  const spec = importModuleTarget(importText);
  if (spec === null || !spec.endsWith('.vsk')) return null;
  const tokens = tokenizeCode(importText);
  if (tokens === null) return null;
  const hasFrom = tokens.some((t) => t.label === 'name' && t.value === 'from');
  if (!hasFrom) return null;
  return spec;
}

/**
 * Extracts import statements from a `.vsk` source file. The source is parsed
 * with the Vesk parser so imports inside strings, comments or template
 * literals are never mistaken for real imports, and multi-line import lists
 * are handled correctly. Falls back to a tokenizer scan when the file does
 * not parse (e.g. mid-edit content in tooling).
 */
export function extractImportStatements(source: string): string[] {
  try {
    const ast = parse(source, { filename: 'imports.vsk' });
    const out: string[] = [];
    for (const stmt of ast.body as any[]) {
      if (stmt.type === 'ImportDeclaration') {
        out.push(source.slice(stmt.start, stmt.end));
      }
    }
    return out;
  } catch {
    return tokenExtractImportStatements(source);
  }
}

function tokenExtractImportStatements(source: string): string[] {
  const tokens = tokenizeCode(source);
  if (tokens === null) return [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].label !== 'import') continue;
    const start = tokens[i].start;
    let lastStringEnd = -1;
    let end = -1;
    let j = i + 1;
    while (j < tokens.length) {
      if (tokens[j].label === ';') { end = tokens[j].end; break; }
      if (tokens[j].label === 'import') break;
      if (tokens[j].label === 'string') lastStringEnd = tokens[j].end;
      j++;
    }
    if (end === -1) end = lastStringEnd !== -1 ? lastStringEnd : tokens[i].end;
    const stmt = source.slice(start, end).trim();
    if (stmt) out.push(stmt);
    if (tokens[j] && tokens[j].label === ';') i = j;
  }
  return out;
}

export function collectVskImportPaths(imports: string[], sourcePath: string): string[] {
  const out: string[] = [];
  for (const imp of imports) {
    if (stripTypeImport(imp) === null) continue;
    const target = vskImportTarget(imp);
    if (!target) continue;
    const full = resolveVskTarget(target, sourcePath);
    if (full) out.push(full);
  }
  return out;
}

/**
 * Resolves `export ... from './path.vsk'` targets the same way imports resolve,
 * so a `.vsk` barrel re-export is followed and compiled into the importing
 * file's component registry instead of being emitted as a bare re-export.
 */
export function collectVskReexportPaths(reexportSources: string[], sourcePath: string): string[] {
  const out: string[] = [];
  for (const spec of reexportSources) {
    if (!spec.endsWith('.vsk')) continue;
    const full = resolveVskTarget(spec, sourcePath);
    if (full) out.push(full);
  }
  return out;
}

function resolveVskTarget(target: string, sourcePath: string): string | null {
  if (target.startsWith('.')) {
    const full = resolve(dirname(sourcePath), target);
    return existsSync(full) ? full : null;
  }
  const aliased = resolveImportPath(target, dirname(sourcePath));
  return aliased !== target && existsSync(aliased) ? aliased : null;
}

/**
 * Local names bound by *named* value imports from a `.vsk` module.
 *
 * `.vsk` imports are value-less for component resolution (components are
 * registry entries), but a `.vsk` module may still export plain values —
 * `export const MAX = 10`, `export function format(x) {}`. Those live in the
 * sub-file's `__vesk` and are hoisted into the importer, so the importer's
 * component scope must destructure them.
 *
 * Returned separately from `localValueImportNames` because a name bound this
 * way must NOT be treated as a direct-call target at a JSX call site: it may be
 * a component, which resolves through the registry, not through a scope local.
 */
export function vskImportValueNames(imports: string[]): string[] {
  const names: string[] = [];
  for (const imp of imports) {
    if (stripTypeImport(imp) === null) continue;
    if (vskImportTarget(imp) === null) continue;
    for (const pair of importBindingPairs(imp)) {
      if (pair.imported === 'default' || pair.imported === '*') continue;
      names.push(pair.local);
    }
  }
  return names;
}

export function vskImportLines(source: string): string[] {
  return extractImportStatements(source).filter((imp) => vskImportTarget(imp) !== null && stripTypeImport(imp) !== null);
}

/**
 * Registry aliases contributed by one file's export/import statements.
 *
 * `.vsk` modules are not real ES modules — a component is a registry entry
 * keyed by its declared name, not a top-level binding — so neither
 * `export { A as B }` nor `import { A as B } from './x.vsk'` can be satisfied
 * by emitting JS. Both are instead recorded as registry aliases so `<B />`
 * resolves to the same function as `<A />`. Each pair is
 * `{ local: <canonical name>, exported: <name the tag uses> }`.
 *
 * `default` and `*` are deliberately skipped: the registry is keyed by the
 * component's *declared* name, which is unrelated to the `default` specifier.
 */
export function vskRegistryAliases(
  importLines: string[],
  exportAliases: Array<{ local: string; exported: string }>
): Array<{ local: string; exported: string }> {
  const aliases: Array<{ local: string; exported: string }> = [];
  for (const alias of exportAliases) {
    if (alias.local !== alias.exported) aliases.push({ local: alias.local, exported: alias.exported });
  }
  for (const imp of importLines) {
    if (stripTypeImport(imp) === null) continue;
    if (vskImportTarget(imp) === null) continue;
    for (const pair of importBindingPairs(imp)) {
      if (pair.imported === 'default' || pair.imported === '*') continue;
      // `import { A as B }` → the CANONICAL name is `pair.imported` ('A') and
      // the ALIAS the tag actually uses is `pair.local` ('B').
      if (pair.local !== pair.imported) aliases.push({ local: pair.imported, exported: pair.local });
    }
  }
  return aliases;
}

/**
 * Registers every alias in `aliases` against `componentMap`, pointing each
 * exported name at the function its local name already resolves to. Names that
 * do not resolve (a non-component value, or a component from a file that was
 * not compiled) are left untouched so the original "not found" diagnostic
 * still names the real missing component.
 */
export function applyVskRegistryAliases(
  componentMap: Map<string, Function>,
  aliases: Array<{ local: string; exported: string }>
): void {
  for (const { local, exported } of aliases) {
    if (componentMap.has(exported)) continue;
    const fn = componentMap.get(local);
    if (fn) componentMap.set(exported, fn);
  }
}

/**
 * True when an `ImportDeclaration` is type-only: an `import type { ... }`
 * statement, or a value import whose specifiers are all `type` specifiers.
 * Type imports carry no runtime value and must never reach emitted JS.
 */
export function isTypeOnlyImport(stmt: any): boolean {
  if (!stmt || stmt.type !== 'ImportDeclaration') return false;
  if (stmt.importKind === 'type') return true;
  const specs = stmt.specifiers || [];
  return specs.length > 0 && specs.every((s: any) => s.importKind === 'type');
}

/**
 * Returns the import source with `type` specifiers removed, or `null` when the
 * whole statement is type-only (nothing left to import at runtime). The
 * original source is returned untouched when it cannot be parsed or reprinted,
 * so value imports are never dropped or mangled.
 */
export function stripTypeImport(importSrc: string): string | null {
  let ast: any;
  try {
    ast = parse(importSrc, { filename: 'import.mjs' });
  } catch {
    return importSrc;
  }
  const stmt = (ast.body || []).find((n: any) => n.type === 'ImportDeclaration');
  if (!stmt) return importSrc;
  if (isTypeOnlyImport(stmt)) return null;
  const specs: any[] = stmt.specifiers || [];
  const kept = specs.filter((s: any) => s.importKind !== 'type');
  // A side-effect import (`import './x'`) has no specifiers at all — it is NOT
  // type-only and must survive so both bundles run its module-level code.
  if (specs.length > 0 && kept.length === 0) return null;
  if (kept.length === specs.length) return importSrc;
  try {
    const rewritten = { ...stmt, specifiers: kept };
    return print({ type: 'Program', body: [rewritten], sourceType: 'module' } as any, ts()).code.trim();
  } catch {
    return importSrc;
  }
}
