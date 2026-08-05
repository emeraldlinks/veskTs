import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parse } from '@vesk/compiler/src/parser';

/**
 * Resolve `import ... from './path.vsk'` statements so helper components can
 * live in arbitrary `.vsk` files and be imported into any page, layout,
 * component or route file.
 */

export function vskImportTarget(importText: string): string | null {
  const m = importText.match(/from\s+['"]([^'"]+)['"]\s*;?\s*$/);
  if (!m) return null;
  const spec = m[1];
  if (!spec.endsWith('.vsk')) return null;
  return spec;
}

const LEGACY_IMPORT_RE = /import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g;

/**
 * Extracts import statements from a `.vsk` source file. The source is parsed
 * with the Vesk parser so imports inside strings, comments or template
 * literals are never mistaken for real imports, and multi-line import lists
 * are handled correctly. Falls back to a regex scan when the file does not
 * parse (e.g. mid-edit content in tooling).
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
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = LEGACY_IMPORT_RE.exec(source)) !== null) out.push(m[0]);
    return out;
  }
}

export function collectVskImportPaths(imports: string[], sourcePath: string): string[] {
  const out: string[] = [];
  for (const imp of imports) {
    const target = vskImportTarget(imp);
    if (!target || !target.startsWith('.')) continue;
    const full = resolve(dirname(sourcePath), target);
    if (existsSync(full)) out.push(full);
  }
  return out;
}

export function vskImportLines(source: string): string[] {
  return extractImportStatements(source).filter((imp) => vskImportTarget(imp) !== null);
}
