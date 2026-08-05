import { documents, project } from './context';
import { analyzeDocument } from './analysis';
import { typeLiteralMembers, printTypeNode } from './type-utils';
import { getJSDoc } from './text-utils';
import { parse } from '@vesk/compiler';
import { TextEdit } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function getComponentPropNames(compName: string, currentDocPath: string): { props: string[]; source: string } | null {
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

export function inferPropsFromDecl(decl: any, source: string): string[] {
  const props = new Set<string>(decl.paramNames);
  if (decl.propsName) {
    const body = source.slice(decl.start, decl.end);
    const re = new RegExp(`\\b${decl.propsName}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      props.add(m[1]);
    }
  }
  return Array.from(props);
}

export function extractPropTypesFromSource(source: string, compName: string): Map<string, string> | null {
  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return null;
  }
  let decl: any = null;
  analyzeDocumentWalk(ast, (node: any) => {
    if (!decl && node.type === 'ComponentDeclaration' && node.id?.name === compName) decl = node;
  });
  if (!decl) return null;

  const map = new Map<string, string>();
  const literalMembers: Map<string, string> = new Map();
  let refName: string | null = null;
  const destructured: { key: string; type?: string }[] = [];

  for (const p of decl.params || []) {
    if (p.type === 'Identifier' && p.typeAnnotation) {
      const inner = p.typeAnnotation.typeAnnotation;
      if (inner?.type === 'TSTypeLiteral') {
        const m = typeLiteralMembers(inner);
        for (const [k, v] of m) literalMembers.set(k, v);
      } else if (inner?.type === 'TSTypeReference') {
        refName = inner.typeName?.name || null;
      }
    } else if (p.type === 'ObjectPattern') {
      for (const prop of p.properties || []) {
        if (prop.type === 'Property') {
          const key = prop.key?.name ?? prop.key?.value ?? '';
          if (!key) continue;
          const propType = prop.value?.typeAnnotation
            ? printTypeNode(prop.value.typeAnnotation.typeAnnotation)
            : undefined;
          destructured.push({ key, type: propType });
        }
      }
      if (p.typeAnnotation?.typeAnnotation?.type === 'TSTypeReference') {
        refName = p.typeAnnotation.typeAnnotation.typeName?.name || null;
      }
    }
  }

  for (const { key, type } of destructured) {
    map.set(key, type || (refName ? refName : 'unknown'));
  }
  for (const [k, v] of literalMembers) {
    map.set(k, v);
  }

  if (refName && map.size === 0) {
    const iface = findInterfaceDeclaration(source, refName);
    if (iface) {
      for (const [k, v] of typeLiteralMembers(iface.body)) map.set(k, v);
    }
  }
  return map;
}

function analyzeDocumentWalk(node: any, cb: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') analyzeDocumentWalk(item, cb);
      }
    } else if (v && typeof v === 'object') {
      analyzeDocumentWalk(v, cb);
    }
  }
}

function findInterfaceDeclaration(source: string, name: string): any | null {
  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return null;
  }
  let found: any = null;
  analyzeDocumentWalk(ast, (node: any) => {
    if (found) return;
    if (node.type === 'TSInterfaceDeclaration' && node.id?.name === name && node.body) {
      found = node.body;
    }
  });
  return found;
}

export function getComponentPropsTypes(compName: string, currentDocPath: string): Map<string, string> | null {
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

import { existsSync, readFileSync } from 'node:fs';