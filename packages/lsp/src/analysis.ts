import { parse } from '@vesk/compiler';
import { inferTypeFromInitializer } from './type-utils';
import type { DocAnalysis, OpeningTagInfo, SymbolInfo, UsedIdentifier } from './types';

export function walkNode(node: any, cb: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') walkNode(item, cb);
      }
    } else if (v && typeof v === 'object') {
      walkNode(v, cb);
    }
  }
}

export function addPatternNames(pattern: any, names: string[]): void {
  if (!pattern) return;
  if (pattern.type === 'Identifier') {
    names.push(pattern.name);
  } else if (pattern.type === 'ArrayPattern' || pattern.type === 'ObjectPattern') {
    for (const el of pattern.elements || []) {
      if (el) addPatternNames(el, names);
    }
    for (const prop of pattern.properties || []) {
      if (prop.type === 'RestElement') addPatternNames(prop.argument, names);
      else addPatternNames(prop.value, names);
    }
  } else if (pattern.type === 'RestElement') {
    addPatternNames(pattern.argument, names);
  } else if (pattern.type === 'AssignmentPattern') {
    addPatternNames(pattern.left, names);
  }
}

function collectDeclaredNames(stmt: any, out: string[]): void {
  if (!stmt) return;
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations || []) addPatternNames(d.id, out);
  } else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
    if (stmt.id?.name) out.push(stmt.id.name);
  } else if (stmt.type === 'ComponentDeclaration') {
    if (stmt.id?.name) out.push(stmt.id.name);
    for (const p of stmt.params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const n of names) out.push(n);
    }
  } else if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    if (stmt.declaration) collectDeclaredNames(stmt.declaration, out);
  }
}

export function collectUsedIdentifiers(node: any, bound: Set<string>, out: UsedIdentifier[], parent: any): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier') {
    if (bound.has(node.name)) return;
    if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
    if (parent && parent.type === 'Property' && parent.value === node && parent.shorthand) return;
    if (parent && parent.type === 'Property' && parent.key === node) return;
    if (parent && parent.type === 'JSXAttribute' && parent.name === node) return;
    out.push({ name: node.name, start: node.start });
    return;
  }
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    for (const stmt of node.body || []) collectDeclaredNames(stmt, names);
    for (const n of names) sub.add(n);
    for (const stmt of node.body || []) collectUsedIdentifiers(stmt, sub, out, node);
    return;
  }
  if (node.type === 'ComponentDeclaration') {
    const sub = new Set(bound);
    if (node.id?.name) sub.add(node.id.name);
    for (const p of node.params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const n of names) sub.add(n);
    }
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'ImportDeclaration') {
    for (const spec of node.specifiers || []) {
      if (spec.local?.name) bound.add(spec.local.name);
    }
    return;
  }
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
    const sub = new Set(bound);
    for (const p of node.params || []) {
      const names: string[] = [];
      addPatternNames(p, names);
      for (const n of names) sub.add(n);
    }
    if (node.type === 'FunctionDeclaration' && node.id) sub.add(node.id.name);
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'CatchClause') {
    const sub = new Set(bound);
    const names: string[] = [];
    addPatternNames(node.param, names);
    for (const n of names) sub.add(n);
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'VariableDeclaration') {
    const sub = new Set(bound);
    for (const d of node.declarations || []) {
      const names: string[] = [];
      addPatternNames(d.id, names);
      for (const n of names) sub.add(n);
      collectUsedIdentifiers(d.init, sub, out, node);
    }
    return;
  }
  if (node.type === 'ClassDeclaration') {
    const sub = new Set(bound);
    if (node.id) sub.add(node.id.name);
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    if (node.left?.type === 'VariableDeclaration') {
      for (const d of node.left.declarations || []) addPatternNames(d.id, names);
    } else {
      addPatternNames(node.left, names);
    }
    for (const n of names) sub.add(n);
    collectUsedIdentifiers(node.right, sub, out, node);
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'ForStatement') {
    const sub = new Set(bound);
    const names: string[] = [];
    if (node.init?.type === 'VariableDeclaration') {
      for (const d of node.init.declarations || []) addPatternNames(d.id, names);
    }
    for (const n of names) sub.add(n);
    collectUsedIdentifiers(node.init, sub, out, node);
    collectUsedIdentifiers(node.test, sub, out, node);
    collectUsedIdentifiers(node.update, sub, out, node);
    collectUsedIdentifiers(node.body, sub, out, node);
    return;
  }
  if (node.type === 'LabeledStatement') {
    collectUsedIdentifiers(node.body, bound, out, node);
    return;
  }
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
    collectUsedIdentifiers(node.expression, bound, out, node);
    return;
  }
  if (typeof node.type === 'string' && node.type.startsWith('TS')) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'parent') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') collectUsedIdentifiers(item, bound, out, node);
      }
    } else if (v && typeof v === 'object') {
      collectUsedIdentifiers(v, bound, out, node);
    }
  }
}

// Heuristic: `for (const tag in/of ...)` inside JSX is parsed as JSXText by
// the JS parser, so the loop binding never reaches the AST. If the usage is
// preceded by such a header, the name is in scope — don't flag it.
export function isLoopBoundInJsxText(source: string, usageOffset: number, name: string): boolean {
  const window = source.slice(Math.max(0, usageOffset - 300), usageOffset);
  const re = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${name}\\s+(?:in|of)\\b`);
  return re.test(window);
}

export function pushSymbol(
  analysis: DocAnalysis,
  name: string,
  start: number,
  end: number,
  kind: SymbolInfo['kind'],
  extra?: { type?: string; declStart?: number; declEnd?: number },
): void {
  if (!name) return;
  const list = analysis.symbols.get(name) || [];
  list.push({ name, start, end, kind, type: extra?.type, declStart: extra?.declStart, declEnd: extra?.declEnd });
  analysis.symbols.set(name, list);
}

// Collect (name, start, end) triples from a destructuring pattern, preserving
// the identifier offsets so hover/definition can point at the exact token.
export function patternEntries(pattern: any): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  if (!pattern) return out;
  const collect = (p: any): void => {
    if (!p) return;
    if (p.type === 'Identifier') {
      if (typeof p.name === 'string' && typeof p.start === 'number') out.push({ name: p.name, start: p.start, end: p.end });
    } else if (p.type === 'ArrayPattern') {
      for (const el of p.elements || []) collect(el);
    } else if (p.type === 'ObjectPattern') {
      for (const prop of p.properties || []) collect(prop);
    } else if (p.type === 'RestElement') {
      collect(p.argument);
    } else if (p.type === 'AssignmentPattern') {
      collect(p.left);
    } else if (p.type === 'Property') {
      collect(p.value);
    }
  };
  collect(pattern);
  return out;
}

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

  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return analysis;
  }
  analysis.ok = true;

  // First pass: component params (for prop inference)
  const componentParams: Map<string, { params: string[]; propsName: string | null }> = new Map();

  walkNode(ast, (node) => {
    if (node.type === 'ComponentDeclaration') {
      const name = node.id?.name;
      if (!name) return;
      const paramNames: string[] = [];
      let propsName: string | null = null;
      for (const p of node.params || []) {
        const names: string[] = [];
        addPatternNames(p, names);
        if (p.type === 'Identifier') propsName = p.name;
        for (const n of names) paramNames.push(n);
      }
      componentParams.set(name, { params: paramNames, propsName });
    }
  });

  // Collect used identifiers across the whole document with lexical scope awareness
  collectUsedIdentifiers(ast, new Set(), analysis.used, null);

  walkNode(ast, (node) => {
    switch (node.type) {
      case 'ComponentDeclaration': {
        const name = node.id?.name;
        if (!name) break;
        const info = componentParams.get(name) || { params: [], propsName: null };
        analysis.components.push({
          name,
          start: node.start,
          end: node.end,
          line: source.substring(0, node.start).split('\n').length - 1,
          paramNames: info.params,
          propsName: info.propsName,
        });
        for (const p of info.params) {
          pushSymbol(analysis, p, node.start, node.start + p.length, 'param');
        }
        break;
      }
      case 'ImportDeclaration': {
        for (const spec of node.specifiers || []) {
          const local = spec.local?.name;
          if (local) {
            analysis.imports.add(local);
            pushSymbol(analysis, local, spec.start, spec.end, 'import');
          }
        }
        break;
      }
      case 'VariableDeclaration': {
        for (const d of node.declarations || []) {
          const entries = patternEntries(d.id);
          const kind: SymbolInfo['kind'] = d.id?.lazy ? 'reactive' : 'variable';
          const type = d.init ? inferTypeFromInitializer(d.init, analysis) : undefined;
          for (const e of entries) {
            pushSymbol(analysis, e.name, e.start, e.end, kind, { type, declStart: d.start, declEnd: d.end });
          }
        }
        break;
      }
      case 'FunctionDeclaration': {
        if (node.id?.name) pushSymbol(analysis, node.id.name, node.id.start, node.id.end, 'function');
        break;
      }
      case 'ClassDeclaration': {
        if (node.id?.name) pushSymbol(analysis, node.id.name, node.id.start, node.id.end, 'class');
        break;
      }
      case 'TSInterfaceDeclaration': {
        if (node.id?.name) pushSymbol(analysis, node.id.name, node.id.start, node.id.end, 'interface', { declStart: node.start, declEnd: node.end });
        break;
      }
      case 'TSTypeAliasDeclaration': {
        if (node.id?.name) pushSymbol(analysis, node.id.name, node.id.start, node.id.end, 'type', { declStart: node.start, declEnd: node.end });
        break;
      }
      case 'TSEnumDeclaration': {
        if (node.id?.name) pushSymbol(analysis, node.id.name, node.id.start, node.id.end, 'enum', { declStart: node.start, declEnd: node.end });
        break;
      }
      case 'JSXExpressionContainer': {
        if (typeof node.start === 'number' && typeof node.end === 'number') {
          analysis.expressions.push({ start: node.start, end: node.end });
        }
        break;
      }
      case 'JSXOpeningElement': {
        const nameNode = node.name;
        if (!nameNode) break;
        let name = '';
        let nameStart = nameNode.start;
        let nameEnd = nameNode.end;
        if (nameNode.type === 'JSXIdentifier') {
          name = nameNode.name;
        } else if (nameNode.type === 'JSXMemberExpression') {
          // e.g. <Foo.Bar> — flatten names
          const parts: string[] = [];
          let cur = nameNode;
          while (cur) {
            if (cur.type === 'JSXMemberExpression') { parts.unshift(cur.property?.name || ''); cur = cur.object; }
            else if (cur.type === 'JSXIdentifier') { parts.unshift(cur.name); cur = null; }
            else cur = null;
          }
          name = parts.join('.');
        }
        if (!name) break;
        const attrs: OpeningTagInfo['attrs'] = [];
        for (const attr of node.attributes || []) {
          if (!attr || attr.type !== 'JSXAttribute' || !attr.name) continue;
          const aName = attr.name.type === 'JSXIdentifier' ? attr.name.name : '';
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
          start: node.start,
          end: node.end,
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

export function findEnclosingExpression(analysis: DocAnalysis, offset: number): { start: number; end: number } | null {
  for (const e of analysis.expressions) {
    if (offset >= e.start && offset <= e.end) return e;
  }
  return null;
}

export function findEnclosingTag(analysis: DocAnalysis, offset: number): OpeningTagInfo | null {
  for (const tag of analysis.tags) {
    if (offset > tag.nameEnd && offset < tag.end) return tag;
  }
  return null;
}
