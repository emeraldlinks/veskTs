/** @module analysis — Full-document AST analysis: symbols, components, tags, scopes. */

import { parse } from '@vesk/compiler';
import { inferTypeFromDeclarator, printTypeNode } from './type-utils';
import type {
  DocAnalysis, SymbolInfo, SymbolKind, ComponentDeclInfo, OpeningTagInfo,
  UsedIdentifier, AttrInfo, Program, Statement, Expression, Pattern,
  ImportDeclaration, VariableDeclaration, VariableDeclarator,
  FunctionDeclaration, ClassDeclaration, ComponentDeclaration,
  TSInterfaceDeclaration, TSTypeAliasDeclaration, TSEnumDeclaration,
  JSXOpeningElement, JSXIdentifier, JSXMemberExpression, JSXAttribute,
  BaseNode, TSType,
} from './types';

// ── AST walking ──────────────────────────────────────────────

/** Walk every node in the AST, calling `cb` for each. */
export function walkNode(node: unknown, cb: (n: BaseNode & Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  cb(node as BaseNode & Record<string, unknown>);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const v = (node as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') walkNode(item, cb);
      }
    } else if (v && typeof v === 'object') {
      walkNode(v, cb);
    }
  }
}

// ── Pattern analysis ─────────────────────────────────────────

/** Collect all identifier names from a destructuring pattern. */
export function addPatternNames(pattern: Pattern | undefined, names: string[]): void {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    names.push((pattern as { name: string }).name);
  } else if (pattern.type === 'ArrayPattern') {
    for (const el of (pattern as { elements: (Pattern | null)[] }).elements) {
      if (el) addPatternNames(el, names);
    }
  } else if (pattern.type === 'ObjectPattern') {
    for (const prop of (pattern as { properties: Array<{ type: string; argument?: Pattern; value?: Pattern }> }).properties) {
      if (prop.type === 'RestElement') addPatternNames(prop.argument, names);
      else addPatternNames(prop.value, names);
    }
  } else if (pattern.type === 'RestElement') {
    addPatternNames((pattern as { argument: Pattern }).argument, names);
  } else if (pattern.type === 'AssignmentPattern') {
    addPatternNames((pattern as { left: Pattern }).left, names);
  }
}

/** Collect declared names from a statement (for scope tracking). */
function collectDeclaredNames(stmt: Statement | undefined, out: string[]): void {
  if (!stmt) return;
  if (stmt.type === 'VariableDeclaration') {
    for (const d of (stmt as VariableDeclaration).declarations) {
      addPatternNames(d.id, out);
    }
  } else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
    const s = stmt as { id?: { name: string } };
    if (s.id?.name) out.push(s.id.name);
  } else if (stmt.type === 'ComponentDeclaration') {
    const s = stmt as unknown as ComponentDeclaration;
    if (s.id?.name) out.push(s.id.name);
    for (const p of s.params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const n of names) out.push(n);
    }
  } else if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const s = stmt as { declaration?: Statement };
    if (s.declaration) collectDeclaredNames(s.declaration, out);
  }
}

// ── Used identifier collection ───────────────────────────────

/** Collect identifiers that are referenced but not bound in the current scope. */
export function collectUsedIdentifiers(
  node: unknown,
  bound: Set<string>,
  out: UsedIdentifier[],
  parent: unknown,
): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;

  if (n.type === 'Identifier') {
    if (bound.has(n.name as string)) return;
    if (parent && (parent as Record<string, unknown>).type === 'MemberExpression' && (parent as Record<string, unknown>).property === node && !(parent as Record<string, unknown>).computed) return;
    if (parent && (parent as Record<string, unknown>).type === 'Property' && (parent as Record<string, unknown>).value === node && (parent as Record<string, unknown>).shorthand) return;
    if (parent && (parent as Record<string, unknown>).type === 'Property' && (parent as Record<string, unknown>).key === node) return;
    if (parent && (parent as Record<string, unknown>).type === 'JSXAttribute' && (parent as Record<string, unknown>).name === node) return;
    out.push({ name: n.name as string, start: n.start as number });
    return;
  }

  if (n.type === 'Program' || n.type === 'BlockStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    for (const stmt of (n.body as Statement[])) collectDeclaredNames(stmt, names);
    for (const name of names) sub.add(name);
    for (const stmt of (n.body as Statement[])) collectUsedIdentifiers(stmt, sub, out, node);
    return;
  }

  if (n.type === 'ComponentDeclaration') {
    const sub = new Set(bound);
    if ((n as { id?: { name: string } }).id?.name) sub.add((n as { id: { name: string } }).id.name);
    for (const p of (n as unknown as ComponentDeclaration).params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const name of names) sub.add(name);
    }
    collectUsedIdentifiers(n.body, sub, out, node);
    return;
  }

  if (n.type === 'ImportDeclaration') {
    for (const spec of (n as unknown as ImportDeclaration).specifiers || []) {
      if (spec.local?.name) bound.add(spec.local.name);
    }
    return;
  }

  if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') {
    const sub = new Set(bound);
    for (const p of (n as { params: Pattern[] }).params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const name of names) sub.add(name);
    }
    if (n.type === 'FunctionDeclaration' && (n as { id?: { name: string } }).id) {
      sub.add((n as { id: { name: string } }).id.name);
    }
    collectUsedIdentifiers(n.body, sub, out, node);
    return;
  }

  if (n.type === 'CatchClause') {
    const sub = new Set(bound);
    const names: string[] = [];
    addPatternNames((n as { param: Pattern }).param, names);
    for (const name of names) sub.add(name);
    collectUsedIdentifiers((n as { body: unknown }).body, sub, out, node);
    return;
  }

  if (n.type === 'VariableDeclaration') {
    const sub = new Set(bound);
    for (const d of (n as unknown as VariableDeclaration).declarations) {
      const names: string[] = [];
      addPatternNames(d.id, names);
      for (const name of names) sub.add(name);
      collectUsedIdentifiers(d.init, sub, out, node);
    }
    return;
  }

  if (n.type === 'ClassDeclaration') {
    const sub = new Set(bound);
    if ((n as { id?: { name: string } }).id) sub.add((n as { id: { name: string } }).id.name);
    collectUsedIdentifiers((n as { body: unknown }).body, sub, out, node);
    return;
  }

  if (n.type === 'ForOfStatement' || n.type === 'ForInStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    const left = (n as { left: unknown }).left;
    if (left && typeof left === 'object' && (left as Record<string, unknown>).type === 'VariableDeclaration') {
      for (const d of (left as VariableDeclaration).declarations) addPatternNames(d.id, names);
    } else {
      addPatternNames(left as Pattern, names);
    }
    for (const name of names) sub.add(name);
    collectUsedIdentifiers((n as { right: unknown }).right, sub, out, node);
    collectUsedIdentifiers((n as { body: unknown }).body, sub, out, node);
    return;
  }

  if (n.type === 'ForStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    const init = (n as { init: unknown }).init;
    if (init && typeof init === 'object' && (init as Record<string, unknown>).type === 'VariableDeclaration') {
      for (const d of (init as VariableDeclaration).declarations) addPatternNames(d.id, names);
    }
    for (const name of names) sub.add(name);
    collectUsedIdentifiers((n as { init: unknown }).init, sub, out, node);
    collectUsedIdentifiers((n as { test: unknown }).test, sub, out, node);
    collectUsedIdentifiers((n as { update: unknown }).update, sub, out, node);
    collectUsedIdentifiers((n as { body: unknown }).body, sub, out, node);
    return;
  }

  if (n.type === 'LabeledStatement') {
    collectUsedIdentifiers((n as { body: unknown }).body, bound, out, node);
    return;
  }

  if (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion' || n.type === 'TSNonNullExpression') {
    collectUsedIdentifiers((n as { expression: unknown }).expression, bound, out, node);
    return;
  }

  // Skip TS-only nodes (type annotations, declarations, etc.)
  if (typeof n.type === 'string' && (n.type as string).startsWith('TS')) return;

  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'parent') continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') collectUsedIdentifiers(item, bound, out, node);
      }
    } else if (v && typeof v === 'object') {
      collectUsedIdentifiers(v, bound, out, node);
    }
  }
}

/**
 * Heuristic: `for (const tag in/of ...)` inside JSX is parsed as JSXText by
 * the JS parser, so the loop binding never reaches the AST. If the usage is
 * preceded by such a header, the name is in scope — don't flag it.
 */
export function isLoopBoundInJsxText(source: string, usageOffset: number, name: string): boolean {
  const window = source.slice(Math.max(0, usageOffset - 300), usageOffset);
  const re = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${name}\\s+(?:in|of)\\b`);
  return re.test(window);
}

// ── Symbol tracking ──────────────────────────────────────────

/** Add a symbol entry to the analysis result. */
export function pushSymbol(
  analysis: DocAnalysis,
  name: string,
  start: number,
  end: number,
  kind: SymbolKind,
  extra?: { type?: string; declStart?: number; declEnd?: number; jsdoc?: string },
): void {
  if (!name) return;
  const list = analysis.symbols.get(name) || [];
  list.push({ name, start, end, kind, type: extra?.type, declStart: extra?.declStart, declEnd: extra?.declEnd, jsdoc: extra?.jsdoc });
  analysis.symbols.set(name, list);
}

/** Collect (name, start, end) triples from a destructuring pattern. */
export function patternEntries(pattern: Pattern | undefined): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  if (!pattern) return out;
  const collect = (p: Pattern | undefined): void => {
    if (!p) return;
    if (p.type === 'Identifier') {
      const id = p as { name: string; start: number; end: number };
      if (typeof id.name === 'string' && typeof id.start === 'number') out.push({ name: id.name, start: id.start, end: id.end });
    } else if (p.type === 'ArrayPattern') {
      for (const el of (p as { elements: (Pattern | null)[] }).elements) collect(el ?? undefined);
    } else if (p.type === 'ObjectPattern') {
      for (const prop of (p as { properties: Array<{ type: string; value?: Pattern }> }).properties) {
        if (prop.type === 'Property') collect(prop.value);
        else collect(prop as unknown as Pattern);
      }
    } else if (p.type === 'RestElement') {
      collect((p as { argument: Pattern }).argument);
    } else if (p.type === 'AssignmentPattern') {
      collect((p as { left: Pattern }).left);
    }
  };
  collect(pattern);
  return out;
}

// ── Full document analysis ───────────────────────────────────

/**
 * Parse and analyze a `.vsk` source string. Returns symbol tables,
 * component declarations, JSX tags, and unbound identifiers.
 */
export function analyzeDocument(source: string): DocAnalysis {
  const analysis: DocAnalysis = {
    symbols: new Map(),
    components: [],
    expressions: [],
    tags: [],
    used: [],
    imports: new Set(),
    ok: false,
  };

  let ast: Program;
  try {
    ast = parse(source, {}) as unknown as Program;
  } catch {
    return analysis;
  }
  analysis.ok = true;

  // First pass: component params (for prop inference)
  const componentParams = new Map<string, { params: string[]; propsName: string | null; propTypes: Map<string, string>; typeParams: string[] }>();

  walkNode(ast, (node) => {
    if (node.type === 'ComponentDeclaration') {
      const comp = node as unknown as ComponentDeclaration;
      const name = comp.id?.name;
      if (!name) return;
      const paramNames: string[] = [];
      let propsName: string | null = null;
      const propTypes = new Map<string, string>();
      const typeParams: string[] = [];

      // Collect generic type parameter names
      if (comp.typeParameters?.params) {
        for (const tp of comp.typeParameters.params) {
          if (tp.name?.name) typeParams.push(tp.name.name);
        }
      }

      for (const p of comp.params || []) {
        const names: string[] = [];
        addPatternNames(p, names);
        if (p.type === 'Identifier') {
          propsName = (p as { name: string }).name;
          // Extract type annotation from the props parameter
          const ta = (p as { typeAnnotation?: { typeAnnotation: { type: string; members?: unknown[]; typeName?: unknown } } }).typeAnnotation;
          if (ta?.typeAnnotation) {
            const inner = ta.typeAnnotation;
            if (inner.type === 'TSTypeLiteral') {
              for (const m of (inner.members || []) as Array<{ type: string; key?: { name?: string }; optional?: boolean; typeAnnotation?: { typeAnnotation: TSType } }>) {
                if (m.type === 'TSPropertySignature' && m.key?.name) {
                  propTypes.set(m.key.name, printTypeNode(m.typeAnnotation?.typeAnnotation as TSType | undefined));
                }
              }
            } else if (inner.type === 'TSTypeReference') {
              // Will be resolved later via type declarations
            }
          }
        } else if (p.type === 'ObjectPattern') {
          for (const prop of (p as { properties: Array<{ type: string; key?: { name?: string; value?: string }; value?: { typeAnnotation?: { typeAnnotation: TSType } } }> }).properties) {
            if (prop.type === 'Property') {
              const key = prop.key?.name ?? prop.key?.value;
              if (key) {
                const valTA = prop.value?.typeAnnotation?.typeAnnotation;
                propTypes.set(key, valTA ? printTypeNode(valTA as TSType) : '');
              }
            }
          }
        }
        for (const n of names) paramNames.push(n);
      }
      componentParams.set(name, { params: paramNames, propsName, propTypes, typeParams });
    }
  });

  // Collect used identifiers across the whole document with lexical scope awareness
  collectUsedIdentifiers(ast, new Set(), analysis.used, null);

  // Second pass: collect all symbols and tags
  walkNode(ast, (node) => {
    switch (node.type) {
      case 'ComponentDeclaration': {
        const comp = node as unknown as ComponentDeclaration;
        const name = comp.id?.name;
        if (!name) break;
        const info = componentParams.get(name) || { params: [], propsName: null, propTypes: new Map<string, string>(), typeParams: [] };
        analysis.components.push({
          name,
          start: comp.start,
          end: comp.end,
          line: source.substring(0, comp.start).split('\n').length - 1,
          paramNames: info.params,
          propsName: info.propsName,
          async: comp.async,
          propTypes: info.propTypes.size > 0 ? info.propTypes : undefined,
          typeParams: info.typeParams.length > 0 ? info.typeParams : undefined,
        });
        for (const p of info.params) {
          pushSymbol(analysis, p, comp.start, comp.start + p.length, 'param');
        }
        break;
      }
      case 'ImportDeclaration': {
        const imp = node as unknown as ImportDeclaration;
        for (const spec of imp.specifiers || []) {
          const local = spec.local?.name;
          if (local) {
            analysis.imports.add(local);
            pushSymbol(analysis, local, spec.start, spec.end, 'import');
          }
        }
        break;
      }
      case 'VariableDeclaration': {
        const vd = node as unknown as VariableDeclaration;
        for (const d of vd.declarations) {
          const entries = patternEntries(d.id);
          const kind: SymbolKind = (d.id as { lazy?: boolean })?.lazy ? 'reactive' : 'variable';
          const type = inferTypeFromDeclarator(d, analysis);
          const jsdoc = findPrecedingJSDoc(source, d.start);
          for (const e of entries) {
            pushSymbol(analysis, e.name, e.start, e.end, kind, { type, declStart: d.start, declEnd: d.end, jsdoc });
          }
        }
        break;
      }
      case 'FunctionDeclaration': {
        const fn = node as unknown as FunctionDeclaration;
        if (fn.id?.name) {
          const returnType = fn.returnType ? printTypeNode(fn.returnType.typeAnnotation) : undefined;
          const jsdoc = findPrecedingJSDoc(source, fn.start);
          pushSymbol(analysis, fn.id.name, fn.id.start, fn.id.end, 'function', { type: returnType, declStart: fn.start, declEnd: fn.end, jsdoc });
        }
        break;
      }
      case 'ClassDeclaration': {
        const cls = node as unknown as ClassDeclaration;
        if (cls.id?.name) {
          const jsdoc = findPrecedingJSDoc(source, cls.start);
          pushSymbol(analysis, cls.id.name, cls.id.start, cls.id.end, 'class', { declStart: cls.start, declEnd: cls.end, jsdoc });
        }
        break;
      }
      case 'TSInterfaceDeclaration': {
        const iface = node as unknown as TSInterfaceDeclaration;
        if (iface.id?.name) {
          const jsdoc = findPrecedingJSDoc(source, iface.start);
          pushSymbol(analysis, iface.id.name, iface.id.start, iface.id.end, 'interface', { declStart: iface.start, declEnd: iface.end, jsdoc });
        }
        break;
      }
      case 'TSTypeAliasDeclaration': {
        const alias = node as unknown as TSTypeAliasDeclaration;
        if (alias.id?.name) {
          const jsdoc = findPrecedingJSDoc(source, alias.start);
          pushSymbol(analysis, alias.id.name, alias.id.start, alias.id.end, 'type', { declStart: alias.start, declEnd: alias.end, jsdoc });
        }
        break;
      }
      case 'TSEnumDeclaration': {
        const enm = node as unknown as TSEnumDeclaration;
        if (enm.id?.name) {
          const jsdoc = findPrecedingJSDoc(source, enm.start);
          pushSymbol(analysis, enm.id.name, enm.id.start, enm.id.end, 'enum', { declStart: enm.start, declEnd: enm.end, jsdoc });
        }
        break;
      }
      case 'JSXExpressionContainer': {
        if (typeof node.start === 'number' && typeof node.end === 'number') {
          analysis.expressions.push({ start: node.start, end: node.end });
        }
        break;
      }
      case 'JSXOpeningElement': {
        const jsxEl = node as unknown as JSXOpeningElement;
        const nameNode = jsxEl.name;
        if (!nameNode) break;
        let name = '';
        let nameStart = nameNode.start;
        let nameEnd = nameNode.end;
        if (nameNode.type === 'JSXIdentifier') {
          name = (nameNode as JSXIdentifier).name;
        } else if (nameNode.type === 'JSXMemberExpression') {
          const parts: string[] = [];
          let cur: JSXIdentifier | JSXMemberExpression | null = nameNode as JSXMemberExpression;
          while (cur) {
            if (cur.type === 'JSXMemberExpression') { parts.unshift(cur.property?.name || ''); cur = cur.object; }
            else if (cur.type === 'JSXIdentifier') { parts.unshift(cur.name); cur = null; }
            else cur = null;
          }
          name = parts.join('.');
        }
        if (!name) break;
        const attrs: AttrInfo[] = [];
        for (const attr of jsxEl.attributes || []) {
          if (!attr || attr.type !== 'JSXAttribute' || !attr.name) continue;
          const aName = attr.name.type === 'JSXIdentifier' ? (attr.name as JSXIdentifier).name : '';
          if (!aName) continue;
          const valueStart = attr.value?.start ?? (attr.end - 1);
          const valueEnd = attr.value?.end ?? attr.end;
          const isExpression = attr.value?.type === 'JSXExpressionContainer';
          attrs.push({
            name: aName,
            nameStart: attr.name.start,
            nameEnd: attr.name.end,
            valueStart,
            valueEnd,
            isExpression,
          });
        }
        analysis.tags.push({
          name,
          start: jsxEl.start,
          end: jsxEl.end,
          nameStart,
          nameEnd,
          isComponent: /^[A-Z]/.test(name),
          attrs,
        });
        break;
      }
    }
  });

  return analysis;
}

/** Find the JSDoc comment preceding a declaration at the given offset. */
function findPrecedingJSDoc(source: string, offset: number): string | undefined {
  const before = source.substring(0, offset);
  const lines = before.split('\n');
  const commentLines: string[] = [];
  let i = lines.length - 1;
  // Walk backwards past blank lines
  while (i >= 0 && lines[i].trim() === '') i--;
  // Collect JSDoc lines
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('*')) {
      commentLines.unshift(trimmed.replace(/^\s*\*\s?/, ''));
    } else if (trimmed.startsWith('/**')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\*\*\s?/, ''));
      break;
    } else if (trimmed.startsWith('//')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\/\s?/, ''));
      i--;
      continue;
    } else {
      break;
    }
    i--;
  }
  if (commentLines.length === 0) return undefined;
  return commentLines.join('\n').replace(/\*\/$/g, '').trim() || undefined;
}

// ── Enclosing position queries ───────────────────────────────

/** Find the JSX expression container that encloses the given offset. */
export function findEnclosingExpression(
  analysis: DocAnalysis,
  offset: number,
): { start: number; end: number } | null {
  for (const e of analysis.expressions) {
    if (offset >= e.start && offset <= e.end) return e;
  }
  return null;
}

/** Find the JSX opening tag that encloses the given offset (in its attributes region). */
export function findEnclosingTag(
  analysis: DocAnalysis,
  offset: number,
): OpeningTagInfo | null {
  for (const tag of analysis.tags) {
    if (offset > tag.nameEnd && offset < tag.end) return tag;
  }
  return null;
}
