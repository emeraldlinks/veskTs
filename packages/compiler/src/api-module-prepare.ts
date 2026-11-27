import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import {
  isCompilerOwnedTarget,
  isValueLessTarget,
  resolveAliasModule,
  resolveImportPath,
} from '@vesk/compiler/src/module-imports';
import { parseGeneratedJs } from '@vesk/compiler/src/parser';
import { loaderForPath, transformTsModule } from '@vesk/compiler/src/ts-transform';

export interface PreparedApiRoute {
  code: string;
  modulePath: string;
  cacheKey: string;
  dependencies: string[];
}

interface SpecifierNode {
  start: number;
  end: number;
  value: string;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 20);
}

function posixSpecifier(fromDir: string, target: string): string {
  let spec = relative(fromDir, target).split(sep).join('/');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return spec;
}

function collectSpecifiers(body: unknown[]): SpecifierNode[] {
  const found: SpecifierNode[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, any>;
    const type = n.type as string | undefined;
    const isModuleSource =
      type === 'ImportDeclaration' ||
      type === 'ExportNamedDeclaration' ||
      type === 'ExportAllDeclaration' ||
      type === 'ImportExpression';
    if (isModuleSource && n.source && typeof n.source.value === 'string' &&
        typeof n.source.start === 'number' && typeof n.source.end === 'number' &&
        n.importKind !== 'type' && n.exportKind !== 'type') {
      found.push(n.source as SpecifierNode);
    }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range') continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  for (const stmt of body) visit(stmt);
  return found;
}

/**
 * Rewrites a route's local module graph once and uses it from both dev and prod.
 *
 * Node's ESM loader does not probe extensions or apply tsconfig aliases, while
 * Vesk's build resolver does. Every local specifier is therefore resolved with
 * the compiler resolver and emitted as a portable relative path into a flat
 * module directory. Bare npm imports and framework-owned packages are left for
 * Node (dev) or esbuild (platform builds) to resolve normally.
 */
export async function prepareApiRouteGraph(
  routeFile: string,
  outputDir: string,
  importerDir: string = dirname(routeFile),
): Promise<PreparedApiRoute> {
  mkdirSync(outputDir, { recursive: true });

  const prepared = new Map<string, string>();
  const rawSources = new Map<string, string>();

  const routeAbsPath = resolve(routeFile);
  const prepare = async (sourcePath: string): Promise<string> => {
    const absPath = resolve(sourcePath);
    const existing = prepared.get(absPath);
    if (existing) return existing;

    const raw = readFileSync(absPath, 'utf-8');
    rawSources.set(absPath, raw);
    const preparedPath = resolve(outputDir, `${hash(`${absPath}\0${raw}`)}.mjs`);
    prepared.set(absPath, preparedPath);
    const specifierDir = absPath === routeAbsPath ? importerDir : dirname(preparedPath);

    const transformed = await transformTsModule(raw, {
      filename: absPath,
      loader: loaderForPath(absPath),
      format: 'esm',
      target: 'node20',
      sourcemap: false,
    });
    const ast = parseGeneratedJs(transformed);
    let code = transformed;
    if (ast) {
      const specifiers = collectSpecifiers(ast.body as unknown[]);
      for (let i = specifiers.length - 1; i >= 0; i--) {
        const spec = specifiers[i];
        const target = spec.value;
        if (!target.startsWith('./') && !target.startsWith('../')) {
          const aliased = resolveAliasModule(target, dirname(absPath));
          if (!aliased) continue;
        }
        if (isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
        let resolved: string;
        try {
          resolved = resolveImportPath(target, dirname(absPath));
        } catch {
          continue;
        }
        if (!existsSync(resolved) || resolved.endsWith('.vsk')) continue;
        const dependency = await prepare(resolved);
        const rewritten = posixSpecifier(specifierDir, dependency);
        code = code.slice(0, spec.start) + JSON.stringify(rewritten) + code.slice(spec.end);
      }
    }

    if (!existsSync(preparedPath) || readFileSync(preparedPath, 'utf-8') !== code) {
      writeFileSync(preparedPath, code, 'utf-8');
    }
    return preparedPath;
  };

  const modulePath = await prepare(routeFile);
  const cacheKey = hash(
    [...rawSources.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, raw]) => `${path}\0${raw}`)
      .join('\n'),
  );
  return {
    code: readFileSync(modulePath, 'utf-8'),
    modulePath,
    cacheKey,
    dependencies: [...prepared.keys()],
  };
}
