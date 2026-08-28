import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { parse } from '@vesk/compiler/src/parser';
import { importModuleTarget, tokenizeCode } from '@vesk/compiler/src/tokens';

/**
 * Resolve `import ... from './path.vsk'` statements so helper components can
 * live in arbitrary `.vsk` files and be imported into any page, layout,
 * component or route file.
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
    if (!target || !target.startsWith('.')) continue;
    const full = resolve(dirname(sourcePath), target);
    if (existsSync(full)) out.push(full);
  }
  return out;
}

export function vskImportLines(source: string): string[] {
  return extractImportStatements(source).filter((imp) => vskImportTarget(imp) !== null && stripTypeImport(imp) !== null);
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
