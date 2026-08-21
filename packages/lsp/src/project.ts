/** @module project — Project model: file scanning, export/declaration parsing, type indexing, symbol lookup. */

import { parse, scanRoutes, scanComponents, collectSources, matchUrl } from '@vesk/compiler';
import { project } from './context';
import { TAILWIND_CLASSES } from './knowledge';
import { extractFileTypes, typeLiteralMembers, printTypeNode } from './type-utils';
import type { ProjectIndex, PathAlias, ExportInfo, ComponentInfo, DeclInfo, ProjectFile, TypeDeclaration } from './types';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, extname, relative, join } from 'node:path';

// ── Path alias resolution ───────────────────────────────

function loadTsconfig(root: string): { baseUrl: string; pathAliases: PathAlias[] } {
  const candidates = [join(root, 'tsconfig.json'), join(root, 'jsconfig.json')];
  for (const tsconfigPath of candidates) {
    if (!existsSync(tsconfigPath)) continue;
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const config = JSON.parse(raw);
      const compilerOptions = config.compilerOptions || {};
      const baseUrl = compilerOptions.baseUrl ? resolve(root, compilerOptions.baseUrl) : root;
      const paths = compilerOptions.paths || {};
      const pathAliases: PathAlias[] = [];
      for (const [key, targets] of Object.entries(paths)) {
        if (key.endsWith('/*') && Array.isArray(targets)) {
          pathAliases.push({
            prefix: key.slice(0, -2),
            targets: targets.map((t: string) => resolve(baseUrl, t.replace(/\/\*$/, ''))),
          });
        }
      }
      return { baseUrl, pathAliases };
    } catch {}
  }
  return { baseUrl: root, pathAliases: [] };
}

function resolveAlias(importPath: string, proj: ProjectIndex): string | null {
  for (const alias of proj.pathAliases) {
    if (importPath === alias.prefix) {
      return alias.targets[0] || null;
    }
    if (importPath.startsWith(alias.prefix + '/')) {
      const suffix = importPath.slice(alias.prefix.length + 1);
      for (const target of alias.targets) {
        const resolved = join(target, suffix);
        const candidates = [resolved, `${resolved}.vsk`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`];
        for (const c of candidates) {
          if (existsSync(c)) return c;
        }
        for (const ext of ['.vsk', '.ts', '.tsx', '.js', '.jsx']) {
          const idx = join(resolved, `index${ext}`);
          if (existsSync(idx)) return idx;
        }
      }
    }
  }
  return null;
}

/** Resolve a Vesk/TS import specifier to an absolute file path, trying aliases, relative, and node_modules. */
export function resolveImportPath(importPath: string, fromFile: string, proj: ProjectIndex): string | null {
  if (importPath.startsWith('@')) {
    const aliased = resolveAlias(importPath, proj);
    if (aliased) return aliased;
  }
  if (importPath.startsWith('.')) {
    const dir = dirname(fromFile);
    const resolved = resolve(dir, importPath);
    const candidates = [resolved, `${resolved}.vsk`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    for (const ext of ['.vsk', '.ts', '.tsx', '.js', '.jsx']) {
      const idx = join(resolved, `index${ext}`);
      if (existsSync(idx)) return idx;
    }
  }
  const pkgRoot = resolveNodeModule(importPath, fromFile);
  if (pkgRoot) {
    const entry = getPackageEntry(pkgRoot);
    if (entry && existsSync(entry)) return entry;
    return pkgRoot;
  }
  return null;
}

/** Walk up directories to find `node_modules/<importPath>` resolution. */
export function resolveNodeModule(importPath: string, fromFile: string): string | null {
  let dir = dirname(fromFile);
  while (true) {
    const candidate = join(dir, 'node_modules', importPath);
    if (existsSync(candidate)) {
      try {
        return resolve(candidate);
      } catch {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function getPackageEntry(pkgRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
    const candidates: string[] = [];
    const dot = pkg.exports && pkg.exports['.'];
    if (dot) {
      if (typeof dot === 'string') candidates.push(dot);
      else if (typeof dot === 'object' && dot !== null) {
        if (typeof dot.types === 'string') candidates.push(dot.types);
        if (typeof dot.default === 'string') candidates.push(dot.default);
      }
    }
    if (typeof pkg.types === 'string') candidates.push(pkg.types);
    if (typeof pkg.module === 'string') candidates.push(pkg.module);
    if (typeof pkg.main === 'string') candidates.push(pkg.main);
    if (typeof pkg.source === 'string') candidates.push(pkg.source);
    for (const c of candidates) {
      const p = resolve(pkgRoot, c);
      if (existsSync(p)) return p;
    }
  } catch {}
  return null;
}

const packageSymbolCache = new Map<string, string | null>();

/** Search a package's src/lib/dist for the file that declares a given symbol. */
export function findSymbolInPackage(pkgRoot: string, name: string): string | null {
  const cacheKey = `${pkgRoot}:${name}`;
  if (packageSymbolCache.has(cacheKey)) return packageSymbolCache.get(cacheKey) ?? null;
  let result: string | null = null;
  const searchDirs = [join(pkgRoot, 'src'), join(pkgRoot, 'lib'), join(pkgRoot, 'dist')];
  outer: for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    for (const filePath of walkDir(dir)) {
      if (findDeclarationInFile(filePath, name)) {
        result = filePath;
        break outer;
      }
    }
  }
  if (!result) {
    const entry = getPackageEntry(pkgRoot);
    if (entry && findDeclarationInFile(entry, name)) result = entry;
  }
  packageSymbolCache.set(cacheKey, result);
  return result;
}

/** Check whether a given name is exported from a specific project file. */
export function isExportedFromFile(name: string, filePath: string): boolean {
  const file = project.files.get(filePath);
  if (!file) return false;
  return file.exports.some(e => e.name === name);
}

/** Return all exported symbol names from a project file. */
export function getExportNames(filePath: string): string[] {
  const file = project.files.get(filePath);
  if (!file) return [];
  return file.exports.map(e => e.name);
}

// ── Project scanning ──────────────────────────────────

function findAppDir(root: string): string | null {
  const candidates = [resolve(root, 'app'), resolve(root, 'src', 'app')];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/** Recursively list all `.vsk`/`.ts`/`.tsx`/`.js`/`.jsx` files under a directory (excluding node_modules). */
export function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue;
      if (entry === 'node_modules' || entry === '.vesk') continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          results.push(...walkDir(full));
        } else if (s.isFile() && /\.(vsk|ts|tsx|js|jsx|d\.ts)$/.test(entry)) {
          results.push(full);
        }
      } catch {}
    }
  } catch {}
  return results;
}

/** Parse export declarations from source text, returning `ExportInfo[]`. */
export function parseExports(source: string, language: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = source.split('\n');
  const namedRe = /^export\s+(?:async\s+)?(?:default\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    const isDefault = m[0].includes('default');
    exports.push({ name: m[1], isDefault, isReExport: false, line, column: col + m[0].indexOf(m[1]) });
  }
  const exportListRe = /export\s*\{([^}]+)\}/g;
  while ((m = exportListRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/)[0].trim();
      if (name) exports.push({ name, isDefault: false, isReExport: true, line, column: col + m[0].indexOf(name) });
    }
  }
  const vskCompRe = /(?:export\s+)(?:default\s+)?(?:async\s+)?component\s+(\w+)/g;
  while ((m = vskCompRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    const isDefault = m[0].includes('default');
    exports.push({ name: m[1], isDefault, isReExport: false, line, column: col + m[0].indexOf(m[1]) });
  }
  return exports;
}

/** Parse top-level declarations (function, component, const, class, interface, type) from source. */
export function parseDeclarations(source: string, language: string): DeclInfo[] {
  const decls: DeclInfo[] = [];
  const lines = source.split('\n');
  const patterns = [
    [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, 'function'],
    [/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/, 'component'],
    [/^(?:export\s+)?const\s+(\w+)/, 'variable'],
    [/^(?:export\s+)?let\s+(\w+)/, 'variable'],
    [/^(?:export\s+)?class\s+(\w+)/, 'class'],
    [/^(?:export\s+)?interface\s+(\w+)/, 'interface'],
    [/^(?:export\s+)?type\s+(\w+)/, 'type'],
  ] as const;
  for (let i = 0; i < lines.length; i++) {
    for (const [re, kind] of patterns) {
      const match = lines[i].match(re);
      if (match) {
        decls.push({ name: match[1], line: i, column: lines[i].indexOf(match[1]), kind: kind as DeclInfo['kind'] });
      }
    }
  }
  return decls;
}

/** Extract Vesk `component` declarations from source text, including async variants. */
export function getVskComponents(source: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];
  const lines = source.split('\n');
  const compRe = /(?:export\s+)?(?:default\s+)?(?:async\s+)?component\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(compRe);
    if (match) {
      const exported = /^export\s+/.test(lines[i].trim());
      const defaultExport = /^export\s+default\s+/.test(lines[i].trim());
      components.push({ name: match[1], line: i, column: lines[i].indexOf(match[1]), exported, defaultExport });
    }
  }
  return components;
}

/** Full project scan: walks files, builds the ProjectIndex with exports, components, type declarations, and tailwind classes. */
export function scanProject(root: string): ProjectIndex {
  const appDir = findAppDir(root);
  const files = new Map<string, ProjectFile>();
  const componentSources = new Map<string, string>();
  const typeDeclarations = new Map<string, TypeDeclaration>();
  const dtsSources = new Map<string, string>();
  const { baseUrl, pathAliases } = loadTsconfig(root);

  if (appDir) {
    try {
      const routeTree = scanRoutes(appDir);
      const sources = collectSources(routeTree);
      for (const [name, srcPath] of sources) {
        componentSources.set(name, srcPath);
      }
    } catch {}
  }

  const componentsDir = resolve(root, 'components');
  if (existsSync(componentsDir)) {
    try {
      const compMap = scanComponents(componentsDir);
      for (const [name, srcPath] of compMap) {
        componentSources.set(name, srcPath);
      }
    } catch {}
  }

  const allFiles = appDir ? walkDir(appDir) : [];
  allFiles.push(...walkDir(resolve(root, 'components')));
  allFiles.push(...walkDir(resolve(root, 'lib')));
  allFiles.push(...walkDir(resolve(root, 'src')));

  for (const filePath of allFiles) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const ext = extname(filePath);

      if (ext === '.ts' && filePath.endsWith('.d.ts')) {
        dtsSources.set(filePath, source);
        try {
          const ast = parse(source, {}) as unknown as { body: unknown[] };
          const types = extractFileTypes(filePath, ast as { body: Array<{ type: string; id?: { name: string }; start: number; end: number }> });
          for (const td of types) typeDeclarations.set(td.name, td);
        } catch {}
        continue;
      }

      const lang = ext === '.vsk' ? 'vsk' : ext;
      const exports = parseExports(source, lang);
      const components = lang === 'vsk' ? getVskComponents(source) : [];
      const declarations = parseDeclarations(source, lang);

      if (ext === '.vsk' || ext === '.ts') {
        try {
          const ast = parse(source, {}) as unknown as { body: unknown[] };
          const types = extractFileTypes(filePath, ast as { body: Array<{ type: string; id?: { name: string }; start: number; end: number }> });
          for (const td of types) typeDeclarations.set(td.name, td);
        } catch {}
      }

      files.set(filePath, {
        uri: '',
        path: filePath,
        exports,
        components,
        declarations,
        lastModified: Date.now(),
      });
    } catch {}
  }

  scanNodeModuleTypes(root, typeDeclarations, dtsSources);

  return { workspaceRoot: root, appDir, baseUrl, pathAliases, files, componentSources, tailwindClasses: new Set(TAILWIND_CLASSES), typeDeclarations, dtsSources };
}

function scanNodeModuleTypes(
  root: string,
  typeDeclarations: Map<string, TypeDeclaration>,
  dtsSources: Map<string, string>,
): void {
  const nmDir = join(root, 'node_modules');
  if (!existsSync(nmDir)) return;
  try {
    for (const entry of readdirSync(nmDir)) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        const scopeDir = join(nmDir, entry);
        if (!statSync(scopeDir).isDirectory()) continue;
        for (const pkg of readdirSync(scopeDir)) {
          const pkgDir = join(scopeDir, pkg);
          if (!statSync(pkgDir).isDirectory()) continue;
          indexPackageTypes(pkgDir, `${entry}/${pkg}`, typeDeclarations, dtsSources);
        }
      } else {
        const pkgDir = join(nmDir, entry);
        if (!statSync(pkgDir).isDirectory()) continue;
        indexPackageTypes(pkgDir, entry, typeDeclarations, dtsSources);
      }
    }
  } catch {}
}

function indexPackageTypes(
  pkgDir: string,
  pkgName: string,
  typeDeclarations: Map<string, TypeDeclaration>,
  dtsSources: Map<string, string>,
): void {
  try {
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) return;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const candidates: string[] = [];

    const typings = pkgJson.types || pkgJson.typings;
    if (typings) candidates.push(resolve(pkgDir, typings));

    if (pkgJson.exports && typeof pkgJson.exports === 'object') {
      const dot = pkgJson.exports['.'];
      if (dot && typeof dot === 'object') {
        const t = (dot as Record<string, string>).types;
        if (t) candidates.push(resolve(pkgDir, t));
      }
    }

    candidates.push(join(pkgDir, 'index.d.ts'));
    candidates.push(join(pkgDir, 'dist', 'index.d.ts'));

    for (const dtsPath of candidates) {
      if (!existsSync(dtsPath)) continue;
      const source = readFileSync(dtsPath, 'utf-8');
      dtsSources.set(dtsPath, source);
      try {
        const ast = parse(source, {}) as unknown as { body: unknown[] };
        const types = extractFileTypes(dtsPath, ast as { body: Array<{ type: string; id?: { name: string }; start: number; end: number }> });
        for (const td of types) {
          typeDeclarations.set(td.name, td);
          typeDeclarations.set(`${pkgName}.${td.name}`, td);
        }
      } catch {}
      break;
    }
  } catch {}
}

/** Find the first project file whose exports contain the given name. */
export function findFileByExportName(name: string): ProjectFile | undefined {
  for (const file of project.files.values()) {
    if (file.exports.some(e => e.name === name)) return file;
  }
  return undefined;
}

/** Resolve a component name to its source file path and line number. */
export function findComponentSource(name: string): { path: string; line: number } | undefined {
  const srcPath = project.componentSources.get(name);
  if (srcPath && existsSync(srcPath)) {
    const source = readFileSync(srcPath, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`component ${name}`)) {
        return { path: srcPath, line: i };
      }
    }
  }
  return undefined;
}

/** Locate a named declaration (function, component, class, etc.) within a file, returning line and column. */
export function findDeclarationInFile(filePath: string, name: string): { line: number; column: number } | null {
  const source = readFileSync(filePath, 'utf-8');
  const exported = project.files.get(filePath)?.exports.find(e => e.name === name);
  if (exported) return { line: exported.line, column: exported.column };
  const decl = parseDeclarations(source, 'vsk').find(d => d.name === name);
  if (decl) return { line: decl.line, column: decl.column };
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:component|function|class|interface|type|const|let|var)\\s+${name}\\b`));
    if (m) {
      return { line: i, column: lines[i].indexOf(name) };
    }
  }
  return null;
}