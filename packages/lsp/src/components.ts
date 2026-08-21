/** @module components — Component prop name and type inference. */

import { documents, project } from './context';
import { analyzeDocument } from './analysis';
import { typeLiteralMembers, printTypeNode, resolveTypeMembers, buildTypeContext, extractFileTypes } from './type-utils';
import { getJSDoc } from './text-utils';
import { parse } from '@vesk/compiler';
import { TextEdit } from 'vscode-languageserver/node.js';
import { existsSync, readFileSync } from 'node:fs';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ComponentDeclInfo, TypeDeclaration, TSType, TSInterfaceBody } from './types';

/**
 * Get the prop names for a component by name, searching the local document
 * first, then the project component index.
 */
export function getComponentPropNames(
  compName: string,
  currentDocPath: string,
): { props: string[]; source: string } | null {
  const currentSource = documents.get(currentDocPath)?.getText();
  if (currentSource !== undefined) {
    const local = analyzeDocument(currentSource).components.find(c => c.name === compName);
    if (local) {
      return { props: inferPropsFromDecl(local, currentSource), source: currentDocPath };
    }
  }
  const srcPath = project.componentSources.get(compName);
  if (srcPath && existsSync(srcPath)) {
    const source = readFileSync(srcPath, 'utf-8');
    const decl = analyzeDocument(source).components.find(c => c.name === compName);
    if (decl) return { props: inferPropsFromDecl(decl, source), source: srcPath };
  }
  return null;
}

/**
 * Infer prop names from a component declaration. Combines parameter names,
 * `props.xxx` usages in the body, and type annotation members.
 */
export function inferPropsFromDecl(decl: ComponentDeclInfo, source: string): string[] {
  const props = new Set<string>(decl.paramNames);

  // If we already have typed props from analysis, use those
  if (decl.propTypes && decl.propTypes.size > 0) {
    for (const name of decl.propTypes.keys()) props.add(name);
    return Array.from(props);
  }

  // Scan body for `props.xxx` usages
  if (decl.propsName) {
    const body = source.slice(decl.start, decl.end);
    const re = new RegExp(`\\b${escapeRegex(decl.propsName)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      props.add(m[1]);
    }
  }
  return Array.from(props);
}

/** Escape a string for use in a regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract prop types as a `name → type` map from a component's source.
 * Handles `component Foo(props: Props)`, `component Foo({ x, y }: { x: string; y: number })`,
 * and resolves type references against the project type declarations.
 */
export function extractPropTypesFromSource(
  source: string,
  compName: string,
): Map<string, string> | null {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {});
  } catch {
    return null;
  }

  let decl: ComponentDeclInfo | null = null;
  walkForComponent(ast, compName, (d) => { decl = d; });
  if (!decl) return null;

  const map = new Map<string, string>();
  const literalMembers = new Map<string, string>();
  let refName: string | null = null;
  const destructured: { key: string; type?: string }[] = [];

  // Walk the AST to find the component's type-annotated params
  walkAst(ast, (node: Record<string, unknown>) => {
    if (node.type === 'ComponentDeclaration' && (node as { id?: { name: string } }).id?.name === compName) {
      const comp = node as { params: Array<Record<string, unknown>>; typeParameters?: { params?: Array<{ name: { name: string } }> } };
      for (const p of comp.params || []) {
        if (p.type === 'Identifier' && p.typeAnnotation) {
          const ta = p.typeAnnotation as { typeAnnotation?: { type: string; members?: Array<Record<string, unknown>>; typeName?: { name: string } } };
          const inner = ta.typeAnnotation;
          if (inner?.type === 'TSTypeLiteral') {
            const m = typeLiteralMembers(inner as unknown as TSInterfaceBody);
            for (const [k, v] of m) literalMembers.set(k, v);
          } else if (inner?.type === 'TSTypeReference') {
            refName = inner.typeName?.name || null;
          }
        } else if (p.type === 'ObjectPattern') {
          for (const prop of (p.properties || []) as Array<Record<string, unknown>>) {
            if (prop.type === 'Property') {
              const key = (prop.key as { name?: string; value?: string })?.name ?? (prop.key as { name?: string; value?: string })?.value ?? '';
              if (!key) continue;
              const valNode = prop.value as Record<string, unknown> | undefined;
              const propType = valNode?.typeAnnotation
                ? printTypeNode((valNode.typeAnnotation as { typeAnnotation: TSType }).typeAnnotation)
                : undefined;
              destructured.push({ key, type: propType });
            }
          }
          const pTA = (p as { typeAnnotation?: { typeAnnotation?: { type: string; typeName?: { name: string } } } }).typeAnnotation;
          if (pTA?.typeAnnotation?.type === 'TSTypeReference') {
            refName = pTA.typeAnnotation.typeName?.name || null;
          }
        }
      }
    }
  });

  for (const { key, type } of destructured) {
    map.set(key, type || (refName ? refName : 'unknown'));
  }
  for (const [k, v] of literalMembers) {
    map.set(k, v);
  }

  // Resolve type reference against project declarations
  if (refName && map.size === 0) {
    const iface = findInterfaceInSource(source, refName);
    if (iface) {
      for (const [k, v] of typeLiteralMembers(iface)) map.set(k, v);
    } else {
      // Try project-wide type declarations
      const decl = project.typeDeclarations.get(refName);
      if (decl?.members) {
        for (const [k, v] of decl.members) map.set(k, v);
      }
    }
  }

  // Also resolve any unresolved type references in individual members
  const typeContext = buildTypeContext(project.typeDeclarations, extractFileTypes('', ast as unknown as { body: Array<{ type: string; id?: { name: string }; start: number; end: number }> }));
  for (const [key, typeStr] of map) {
    if (!typeStr || typeStr === 'unknown' || typeStr === '') {
      // Try to resolve from the refName interface
      if (refName) {
        const resolved = resolveTypeMembers({ type: 'TSTypeReference', typeName: { type: 'Identifier', name: refName } } as unknown as TSType, typeContext);
        if (resolved?.has(key)) {
          map.set(key, resolved.get(key)!);
        }
      }
    }
  }

  return map;
}

/** Walk the AST looking for a component declaration by name, calling `cb` with it. */
function walkForComponent(
  node: unknown,
  name: string,
  cb: (decl: ComponentDeclInfo) => void,
): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'ComponentDeclaration' && (n as { id?: { name: string } }).id?.name === name) {
    cb({
      name,
      start: n.start as number,
      end: n.end as number,
      line: 0,
      paramNames: [],
      propsName: null,
    });
  }
  for (const key of Object.keys(n)) {
    if (['loc', 'range', 'start', 'end', 'parent', 'tokens', 'comments'].includes(key)) continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) walkForComponent(item, name, cb);
    } else if (v && typeof v === 'object') {
      walkForComponent(v, name, cb);
    }
  }
}

/** Generic AST walker. */
function walkAst(node: unknown, cb: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  cb(node as Record<string, unknown>);
  for (const key of Object.keys(node)) {
    if (['loc', 'range', 'start', 'end', 'parent', 'tokens', 'comments'].includes(key)) continue;
    const v = (node as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) walkAst(item, cb);
    } else if (v && typeof v === 'object') {
      walkAst(v, cb);
    }
  }
}

/** Find a TSInterfaceDeclaration by name in a parsed AST. */
function findInterfaceInSource(source: string, name: string): TSInterfaceBody | null {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {});
  } catch {
    return null;
  }
  let found: TSInterfaceBody | null = null;
  walkAst(ast, (node) => {
    if (found) return;
    if (node.type === 'TSInterfaceDeclaration' && (node as { id?: { name: string } }).id?.name === name && node.body) {
      found = node.body as unknown as TSInterfaceBody;
    }
  });
  return found;
}

/**
 * Get prop types as a `name → type string` map for a component.
 * Searches local document first, then project component sources.
 */
export function getComponentPropsTypes(
  compName: string,
  currentDocPath: string,
): Map<string, string> | null {
  const currentSource = documents.get(currentDocPath)?.getText();
  if (currentSource !== undefined) {
    const types = extractPropTypesFromSource(currentSource, compName);
    if (types && types.size > 0) return types;
  }
  const srcPath = project.componentSources.get(compName);
  if (srcPath && existsSync(srcPath)) {
    const types = extractPropTypesFromSource(readFileSync(srcPath, 'utf-8'), compName);
    if (types && types.size > 0) return types;
  }
  return null;
}
