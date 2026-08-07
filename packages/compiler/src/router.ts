import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative, basename, dirname, resolve as resolvePath } from 'path';
import type { RouteNode } from '@vesk/compiler/src/types';
import { parse } from '@vesk/compiler/src/parser';
import { tokenizeCode } from '@vesk/compiler/src/tokens';
import { skipWhitespace, findBalancedEnd } from '@vesk/compiler/src/scan';
import { hasTsSyntax, stripCodeTypes } from '@vesk/compiler/src/strip-ts';

export interface ScanOptions {
  layoutCompName?: string;
  pageCompName?: string;
  compName?: string;
}

export interface MatchResult {
  nodes: RouteNode[];
  params: Record<string, string>;
}

/**
 * Extracts `export (async) function middleware(params) { body }` from
 * middleware source text. Parses with acorn (via the Vesk parser) so
 * default params, nested parens and strings in the parameter list are
 * handled correctly; falls back to the old regex + brace balance when the
 * source does not parse.
 */
export function extractMiddlewareParts(src: string): { params: string; body: string } | null {
  try {
    let ast = parse(src, { filename: 'middleware.ts' });
    let target = findMiddlewareFn(ast);
    if (!target) return null;
    if (hasTsSyntax(ast)) {
      const stripped = stripCodeTypes(src);
      if (stripped !== src) {
        src = stripped;
        ast = parse(src, { filename: 'middleware.ts' });
        target = findMiddlewareFn(ast);
        if (!target) return null;
      }
    }
    const params = target.params.length
      ? src.slice(target.params[0].start, target.params[target.params.length - 1].end)
      : '';
    const body = src.slice(target.body.start + 1, target.body.end - 1);
    return { params, body: body.trim() };
  } catch {
    return fallbackExtractMiddleware(src);
  }
}

function findMiddlewareFn(ast: any): any {
  for (const stmt of ast.body) {
    const target = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (!target || target.type !== 'FunctionDeclaration') continue;
    if (!(target.id && target.id.name === 'middleware')) continue;
    return target;
  }
  return null;
}

/**
 * Token-based fallback for `export (async) function middleware(params) { body }`
 * used when the source does not parse. Identifies the `middleware` function by
 * its token neighbours, then extracts the parameter list and body with balanced
 * delimiter scans (so nested parens/braces and strings stay intact).
 */
function fallbackExtractMiddleware(src: string): { params: string; body: string } | null {
  const tokens = tokenizeCode(src);
  if (tokens === null) return null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.label !== 'name' || t.value !== 'middleware') continue;
    const fnTok = tokens[i - 1];
    if (!fnTok || fnTok.label !== 'name' || fnTok.value !== 'function') continue;
    let prevIdx = i - 2;
    if (tokens[prevIdx] && tokens[prevIdx].label === 'name' && tokens[prevIdx].value === 'async') prevIdx--;
    const exportTok = tokens[prevIdx];
    if (!exportTok || exportTok.label !== 'export') continue;
    let k = i + 1;
    while (k < tokens.length && tokens[k].label !== '(') k++;
    if (k >= tokens.length) continue;
    const paramsEnd = findBalancedEnd(src, tokens[k].start);
    const params = src.slice(tokens[k].start + 1, paramsEnd);
    let b = skipWhitespace(src, paramsEnd + 1);
    if (src[b] !== '{') continue;
    let depth = 1;
    let m = b + 1;
    while (m < src.length && depth > 0) {
      if (src[m] === '{') depth++;
      else if (src[m] === '}') depth--;
      m++;
    }
    const body = src.slice(b + 1, m - 1);
    return { params, body: body.trim() };
  }
  return null;
}

export function extractMiddleware(sourcePath: string): string | null {
  try {
    if (!existsSync(sourcePath)) return null;
    const src = readFileSync(sourcePath, 'utf-8');
    const parts = extractMiddlewareParts(src);
    if (!parts) return null;
    return `async function middleware(${parts.params}) {\n${parts.body}\n}`;
  } catch {
    return null;
  }
}

export function scanRoutes(appDir: string, options: ScanOptions = {}): RouteNode[] {
  if (!existsSync(appDir)) {
    return [];
  }
  return scanDirectory(appDir, appDir, '/', options);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function scanComponents(componentsDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(componentsDir)) return map;

  function walk(dir: string, prefix: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (!entry.startsWith('_')) {
          walk(full, prefix ? prefix + capitalize(entry) : capitalize(entry));
        }
      } else if (entry.endsWith('.vsk')) {
        const name = prefix
          ? prefix + capitalize(entry.slice(0, -4))
          : entry.slice(0, -4);
        if (!map.has(name)) {
          map.set(name, full);
        }
      }
    }
  }
  walk(componentsDir, '');
  return map;
}

function scanDirectory(rootDir: string, dir: string, parentPath: string, options: ScanOptions): RouteNode[] {
  const nodes: RouteNode[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return nodes;
  }

  entries.sort((a, b) => {
    const aIsSpecial = a === 'page.vsk' || a === 'layout.vsk' || a === 'not-found.vsk';
    const bIsSpecial = b === 'page.vsk' || b === 'layout.vsk' || b === 'not-found.vsk';
    if (aIsSpecial && !bIsSpecial) return -1;
    if (!aIsSpecial && bIsSpecial) return 1;
    return a.localeCompare(b);
  });

  let hasLayout = false;
  let hasPage = false;
  let hasLoading = false;
  let hasError = false;
  let hasNotFound = false;
  let hasMiddleware = false;

  for (const entry of entries) {
    if (entry === 'layout.vsk') { hasLayout = true; continue; }
    if (entry === 'page.vsk') { hasPage = true; continue; }
    if (entry === 'loading.vsk') { hasLoading = true; continue; }
    if (entry === 'error.vsk') { hasError = true; continue; }
    if (entry === 'not-found.vsk') { hasNotFound = true; continue; }
    if (entry === 'middleware.ts') { hasMiddleware = true; continue; }
  }

  let segName = basename(dir);
  let isGroup = segName.startsWith('(') && segName.endsWith(')');
  let isDynamic = segName.startsWith('[') && segName.endsWith(']') && !segName.startsWith('[...');
  let isCatchAll = segName.startsWith('[...') && segName.endsWith(']');
  let isPrivate = segName.startsWith('_');

  if (isPrivate && dir !== rootDir) return nodes;

  let seg = '';
  if (dir === rootDir) {
    seg = '';
  } else if (isGroup) {
    seg = '';
  } else if (isDynamic) {
    seg = ':' + segName.slice(1, -1);
  } else if (isCatchAll) {
    seg = ':' + segName.slice(4, -1);
  } else {
    seg = segName;
  }

  const fullPath = seg
    ? (parentPath === '/' ? '/' : parentPath + '/') + seg
    : (parentPath || '/');

  const node: RouteNode = {
    path: seg,
    fullPath: fullPath.replace(/\/+/g, '/') || '/',
    isGroup,
    isDynamic,
    isCatchAll,
    page: hasPage ? extractComponentName(dir, 'page', rootDir) : null,
    layout: hasLayout ? extractComponentName(dir, 'layout', rootDir) : null,
    loading: hasLoading ? extractComponentName(dir, 'loading', rootDir) : null,
    error: hasError ? extractComponentName(dir, 'error', rootDir) : null,
    notFound: hasNotFound ? extractComponentName(dir, 'not-found', rootDir) : null,
    hasMiddleware,
    children: [],
    sourceDir: dir,
    segmentCount: isGroup || dir === rootDir ? 0 : 1,
  };

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let entryStat;
    try { entryStat = statSync(entryPath); } catch { continue; }
    if (entryStat.isDirectory()) {
      const childNodes = scanDirectory(rootDir, entryPath, fullPath, options);
      node.children.push(...childNodes);
    }
  }

  if (node.page || node.layout || node.children.length > 0) {
    nodes.push(node);
  }

  return nodes;
}

function extractComponentName(dir: string, type: string, rootDir: string): string {
  const rel = relative(rootDir, dir);
  const parts = rel.split('/').filter(Boolean);
  const clean = parts.map(p => {
    let out = '';
    for (const ch of p) {
      if (ch === '[' || ch === ']' || ch === '(' || ch === ')' || ch === '.') continue;
      out += ch;
    }
    return out;
  });
  const suffix = clean.length > 0 ? clean.join('_') : 'index';
  const capitalized = suffix.charAt(0).toUpperCase() + suffix.slice(1);
  if (type === 'page') return 'Page_' + capitalized;
  if (type === 'layout') return 'Layout_' + capitalized;
  if (type === 'loading') return 'Loading_' + capitalized;
  if (type === 'error') return 'Error_' + capitalized;
  if (type === 'not-found') return 'NotFound_' + capitalized;
  return type + '_' + capitalized;
}

export function collectSources(tree: RouteNode[]): Map<string, string> {
  const map = new Map<string, string>();
  function walk(nodes: RouteNode[]): void {
    for (const node of nodes) {
      if (node.page) map.set(node.page, join(node.sourceDir, 'page.vsk'));
      if (node.layout) map.set(node.layout, join(node.sourceDir, 'layout.vsk'));
      if (node.loading) map.set(node.loading, join(node.sourceDir, 'loading.vsk'));
      if (node.error) map.set(node.error, join(node.sourceDir, 'error.vsk'));
      if (node.notFound) map.set(node.notFound, join(node.sourceDir, 'not-found.vsk'));
      walk(node.children);
    }
  }
  walk(tree);
  return map;
}

export interface RouteManifestOptions {
  importPrefix?: string;
}

export function generateRouteManifest(tree: RouteNode[], options: RouteManifestOptions = {}): string {
  const prefix = options.importPrefix || './';

  function genNode(node: RouteNode, _isRoot = false): string {
    const parts: string[] = [];
    if (node.page) parts.push(`page: ${node.page}`);
    if (node.layout) parts.push(`layout: ${node.layout}`);
    if (node.loading) parts.push(`loading: ${node.loading}`);
    if (node.error) parts.push(`error: ${node.error}`);
    if (node.notFound) parts.push(`notFound: ${node.notFound}`);
    if (node.children.length > 0) {
      const childCodes = node.children.map(c => genNode(c));
      parts.push(`children: [\n${childCodes.map(c => '\t\t' + c).join(',\n')}\n\t]`);
    }
    const pathStr = JSON.stringify(node.fullPath);
    const groupStr = node.isGroup ? `, isGroup: true` : '';
    return `{ path: ${pathStr}${groupStr}, ${parts.join(', ')} }`;
  }

  const nodeCodes = tree.map(n => genNode(n));
  const components = flattenSources(tree);

  let code = `// Auto-generated route manifest — do not edit\n\n`;
  for (const [name, sourcePath] of components) {
    code += `import { ${name} } from '${prefix}${sourcePath}';\n`;
  }
  code += `\n`;
  code += `const __routeTree = [\n`;
  code += nodeCodes.map(c => '\t' + c).join(',\n');
  code += `\n];\n\n`;
  code += `export default __routeTree;\n`;
  return code;
}

function flattenSources(tree: RouteNode[]): Map<string, string> {
  const map = new Map<string, string>();
  function walk(nodes: RouteNode[]): void {
    for (const node of nodes) {
      if (node.page) map.set(node.page, node.sourceDir + '/page.vsk');
      if (node.layout) map.set(node.layout, node.sourceDir + '/layout.vsk');
      if (node.loading) map.set(node.loading, node.sourceDir + '/loading.vsk');
      if (node.error) map.set(node.error, node.sourceDir + '/error.vsk');
      if (node.notFound) map.set(node.notFound, node.sourceDir + '/not-found.vsk');
      walk(node.children);
    }
  }
  walk(tree);
  return map;
}

export function matchUrl(tree: RouteNode[], pathname: string): MatchResult | null {
  const parts = pathname.split('/').filter(Boolean);
  const chain: RouteNode[] = [];
  const params: Record<string, string> = {};

  const rootNode = tree.find(n => n.fullPath === '/');
  if (rootNode) {
    chain.push(rootNode);
  }

  function matchNodes(nodes: RouteNode[], partIndex: number): boolean {
    for (const node of nodes) {
      if (node.isGroup) {
        if (matchNodes(node.children, partIndex)) {
          if (node.layout) chain.push(node);
          return true;
        }
        continue;
      }

      if (node.fullPath === '/') {
        return matchNodes(node.children, partIndex);
      }

      if (partIndex >= parts.length) {
        if (node.page) {
          chain.push(node);
          return true;
        }
        continue;
      }

      const part = parts[partIndex];

      if (node.isCatchAll) {
        const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
        params[paramName] = parts.slice(partIndex).map(decodeURIComponent).join('/');
        chain.push(node);
        return true;
      }

      if (node.isDynamic) {
        const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
        params[paramName] = decodeURIComponent(part);
        chain.push(node);
        if (node.children.length > 0) {
          if (matchNodes(node.children, partIndex + 1)) return true;
        } else if (node.page) {
          return true;
        }
        chain.pop();
        delete params[paramName];
        continue;
      }

      if (node.path === part) {
        chain.push(node);
        if (node.children.length > 0) {
          if (matchNodes(node.children, partIndex + 1)) return true;
        } else if (node.page) {
          return true;
        }
        chain.pop();
        continue;
      }
    }
    return false;
  }

  if (rootNode) {
    const matched = matchNodes(rootNode.children, 0);
    if (!matched && parts.length === 0) {
      return { nodes: chain, params };
    }
    if (!matched) return null;
  } else {
    const matched = matchNodes(tree, 0);
    if (!matched) return null;
  }

  return { nodes: chain, params };
}
