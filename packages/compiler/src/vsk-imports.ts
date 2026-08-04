import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Resolve `import ... from './path.vsk'` statements so helper components can
 * live in arbitrary `.vsk` files and be imported into any page, layout,
 * component or route file.
 */

export function vskImportTarget(importText: string): string | null {
  const m = importText.match(/from\s+['"]([^'"]+)['"]/);
  if (!m) return null;
  const spec = m[1];
  if (!spec.endsWith('.vsk')) return null;
  return spec;
}

export function extractImportStatements(source: string): string[] {
  const out: string[] = [];
  const re = /import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
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
