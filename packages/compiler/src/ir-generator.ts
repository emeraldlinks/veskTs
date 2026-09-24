import type { Node as ESTreeNode } from 'estree';
import {
  IRRoot,
  ComponentIR,
  StaticNode,
  TextNode,
  DynamicBinding,
  OpaqueDynamicRegion,
  MapRegion,
  WhileLoop,
  SwitchBlock,
  TryCatch,
  RuntimeStatement,
  ForLoop,
  TrackDecl,
  ComponentRef,
  ComponentCall,
  ServerBlock,
  ClientBlock,
  HeadBlock,
  Expression,
  SlotNode,
  PropSlot,
  PropSlotRender,
} from '@vesk/compiler/src/ir';
import type { IRNode } from '@vesk/compiler/src/ir';
import { VeskError, codeFrame } from '@vesk/compiler/src/errors';
import { createBaseParser } from '@vesk/compiler/src/parser';
import { skipWhitespace, findBalancedEnd, splitTopLevel, startsWithIdentifier, stripDeclKeyword, isWhitespaceChar, collapseNewlineWhitespace } from '@vesk/compiler/src/scan';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import { stripTypeImport } from '@vesk/compiler/src/vsk-imports';
import { importBindingPairs } from '@vesk/compiler/src/module-imports';
import { extractImportNames, importModuleTarget } from '@vesk/compiler/src/tokens';
import type { VeskAnnotation } from '@vesk/compiler/src/parser';

let __vskAnnotations: VeskAnnotation[] = [];

/**
 * Prop names of the component currently being processed that are declared as
 * renderable content (`*: Component`) and are therefore threaded through the
 * slot channel. A content read `{props.<name>}` of such a prop compiles to
 * {@link PropSlotRender} instead of a value binding, so the child can render a
 * slot handed to it by a caller that wrote `name={<div/>}`.
 */
let __slotProps: Set<string> | null = null;

/**
 * The identifier a component binds its props to (`props` by convention, but
 * any first-parameter name is legal). Slot detection used to hardcode the
 * literal `props`, so a `Component`-typed prop read through a differently
 * named parameter was treated as a plain value and stringified.
 */
let __propsParam: string | null = null;

function parseExprNode(text: string): ESTreeNode | null {
  try {
    const ParserClass = createBaseParser();
    const ast = (ParserClass as unknown as { parse(input: string, opts: unknown): { body: Array<{ expression?: ESTreeNode }> } }).parse(
      `(${text})`,
      { ecmaVersion: 'latest', sourceType: 'module' }
    );
    return (ast.body[0]?.expression as ESTreeNode) ?? null;
  } catch {
    return null;
  }
}

function getForClauseAnnotation(forStart: number): VeskAnnotation | null {
  let keyRange: [number, number] | undefined;
  let indexName: string | undefined;
  let clauseStart = -1;
  let clauseEnd = -1;
  for (const ann of __vskAnnotations) {
    if (ann.kind !== 'for-clause' || ann.forStart !== forStart) continue;
    if (ann.keyRange) keyRange = ann.keyRange;
    if (ann.indexName) indexName = ann.indexName;
    clauseStart = ann.clauseStart;
    clauseEnd = ann.clauseEnd;
  }
  if (clauseStart === -1) return null;
  return { kind: 'for-clause', forStart, clauseStart, clauseEnd, ...(keyRange ? { keyRange } : {}), ...(indexName !== undefined ? { indexName } : {}) };
}

function getSource(source: string, node: { start: number; end: number }): string {
  return source.slice(node.start, node.end);
}

/**
 * Returns the source text for a loop/map binding pattern, preserving
 * destructuring (`[a, b]`, `{x, y}`, defaults, rest) while stripping a
 * top-level TS type annotation (`[a, b]: T` → `[a, b]`). Plain identifiers
 * return their name directly so `const x: T` still yields `x`.
 */
function patternSource(source: string, node: any): string {
  if (!node) return 'item';
  if (node.type === 'Identifier') return node.name ?? 'item';
  const end = node.typeAnnotation ? node.typeAnnotation.start : node.end;
  const text = source.slice(node.start, end).trim();
  return text || 'item';
}

function mapParamSource(source: string, param: any): string {
  if (!param) return 'item';
  if (param.type === 'Identifier') return param.name ?? 'item';
  const end = param.typeAnnotation ? param.typeAnnotation.start : param.end;
  if (typeof param.start === 'number' && typeof end === 'number') {
    const text = source.slice(param.start, end).trim();
    if (text) return text;
  }
  return 'item';
}

function collectComponentCalls(nodes: IRNode[], out: Map<string, number>): void {
  for (const n of nodes) {
    if (n instanceof ComponentCall) {
      out.set(n.componentName, n.start);
      collectComponentCalls(n.children, out);
    } else if (n instanceof StaticNode || n instanceof ServerBlock || n instanceof ClientBlock || n instanceof HeadBlock) {
      collectComponentCalls(n.children, out);
    } else if (n instanceof PropSlot) {
      collectComponentCalls(n.body, out);
    } else if (n instanceof MapRegion) {
      collectComponentCalls(n.bodyTemplate, out);
      collectComponentCalls(n.alternateNodes, out);
    } else if (n instanceof OpaqueDynamicRegion) {
      collectComponentCalls(n.consequentNodes, out);
      collectComponentCalls(n.alternateNodes, out);
    } else if (n instanceof WhileLoop || n instanceof ForLoop) {
      collectComponentCalls(n.bodyTemplate, out);
    } else if (n instanceof TryCatch) {
      collectComponentCalls(n.bodyTemplate, out);
      collectComponentCalls(n.catchBody, out);
    } else if (n instanceof SwitchBlock) {
      for (const c of n.cases) collectComponentCalls(c.body, out);
    }
  }
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function calleeIsFetch(callee: unknown): boolean {
  if (!callee || typeof callee !== 'object') return false;
  const c = callee as Record<string, unknown>;
  if (c.type === 'Identifier') return c.name === 'useFetch';
  if (c.type === 'MemberExpression') {
    const object = c.object as Record<string, unknown> | null | undefined;
    if (object && object.type === 'Identifier') return object.name === 'useFetch';
  }
  return false;
}

/**
 * Walks an ESTree subtree looking for a real `useFetch(...)` / `useFetch.stream(...)`
 * call. String and template-literal *content* is not part of the expression tree,
 * so `const md = \`useFetch.stream(...)\`` no longer counts as a fetch usage.
 */
function estreeCallsFetch(ast: ESTreeNode | null): boolean {
  if (!ast) return false;
  const stack: unknown[] = [ast];
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (!candidate || typeof candidate !== 'object') continue;
    const node = candidate as Record<string, unknown>;
    if (
      (node.type === 'CallExpression' || node.type === 'NewExpression') &&
      calleeIsFetch(node.callee)
    ) {
      return true;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) stack.push(item);
      } else {
        stack.push(value);
      }
    }
  }
  return false;
}

/**
 * The simple identifier a member chain *ends* in (`a.b.c` → `c`), or null when
 * the object doesn't end in a bare name token — mirrors the tokenizer's "name
 * two tokens before the call paren" rule so `a.b(` and `a?.b(` surface `a`,
 * `a.b.c(` surfaces `b`, while `this.b(`, `a[0].b(` and `a(x).b(` surface
 * nothing.
 */
function memberReceiverName(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (rec.type === 'Identifier' && typeof rec.name === 'string') return rec.name;
  const prop = rec.type === 'MemberExpression' && !rec.computed ? rec.property : null;
  if (prop && typeof prop === 'object' && (prop as Record<string, unknown>).type === 'Identifier') {
    const propName = (prop as Record<string, unknown>).name;
    if (typeof propName === 'string') return propName;
  }
  return null;
}

/**
 * Single-pass ESTree walk collecting every simple call target in `ast` —
 * identifiers invoked directly (`fn(` / `fn<T>(`, constructor calls included)
 * and the receiver name of a bare member call (`a.b(` → `a`, `a.b?.c(` → `b`)
 * — plus every JSX element tag name. Mirrors the semantics of
 * `collectCalledIdentifiers` over the equivalent text, so one walk of the
 * already-parsed tree replaces re-tokenizing each IR raw fragment.
 */
function collectCallAndJsxTargets(ast: unknown): Set<string> {
  const targets = new Set<string>();
  const stack: unknown[] = [ast];
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (!candidate || typeof candidate !== 'object') continue;
    const node = candidate as Record<string, unknown>;
    if (typeof node.type === 'string') {
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const callee = node.callee;
        if (callee && typeof callee === 'object') {
          const c = callee as Record<string, unknown>;
          if (c.type === 'Identifier' && typeof c.name === 'string' && node.optional !== true) {
            targets.add(c.name);
          } else if (c.type === 'MemberExpression' && !c.computed && node.optional !== true) {
            const receiverName = memberReceiverName(c.object);
            if (receiverName) targets.add(receiverName);
          }
        }
      } else if (node.type === 'JSXElement') {
        const opening = node.openingElement;
        const tag = opening && typeof opening === 'object' ? (opening as Record<string, unknown>).name : null;
        if (tag && typeof tag === 'object') {
          const t = tag as Record<string, unknown>;
          if (t.type === 'JSXIdentifier' && typeof t.name === 'string') {
            targets.add(t.name);
          } else if (t.type === 'JSXMemberExpression') {
            const prop = t.property;
            if (prop && typeof prop === 'object' && (prop as Record<string, unknown>).type === 'JSXIdentifier') {
              const propName = (prop as Record<string, unknown>).name;
              if (typeof propName === 'string') targets.add(propName);
            }
          }
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) stack.push(item);
        } else {
          stack.push(value);
        }
      }
    }
  }
  return targets;
}

function componentUsesFetch(nodes: IRNode[]): boolean {
  for (const node of nodes) {
    if (node instanceof ServerBlock || node instanceof ClientBlock) {
      if (componentUsesFetch(node.children)) return true;
    } else if (node instanceof RuntimeStatement) {
      if (estreeCallsFetch(node.ast)) return true;
    } else if (node instanceof DynamicBinding) {
      if (estreeCallsFetch(node.expression.ast)) return true;
    } else if (node instanceof MapRegion) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
      if (componentUsesFetch(node.alternateNodes)) return true;
    } else if (node instanceof OpaqueDynamicRegion) {
      if (componentUsesFetch(node.consequentNodes) || componentUsesFetch(node.alternateNodes)) return true;
    } else if (node instanceof WhileLoop) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
    } else if (node instanceof ForLoop) {
      if (componentUsesFetch(node.bodyTemplate)) return true;
    } else if (node instanceof TryCatch) {
      if (componentUsesFetch(node.bodyTemplate) || componentUsesFetch(node.catchBody)) return true;
    } else if (node instanceof SwitchBlock) {
      for (const c of node.cases) {
        if (componentUsesFetch(c.body)) return true;
      }
    }
  }
  return false;
}

function extractKeyExpr(nodes: IRNode[]): Expression | null {
  for (const n of nodes) {
    if (n instanceof StaticNode && n.keyExpr) return n.keyExpr;
    // `<ItemRow key={item.id} …/>` carries the key as a regular prop on the
    // component call. Honor it so component-rooted maps get the same keyed
    // (claim-by-key / reconcile) treatment as element-rooted maps instead of
    // falling back to the positional `__place` region — which stranding fresh
    // surplus items and cannot reorder adopted ones.
    if (n instanceof ComponentCall) {
      const k = n.props.find((p) => p.name === 'key');
      if (k) return k.value;
    }
  }
  return null;
}

function isTrackDeclaration(decl: ESTreeNode & { type: string; declarations?: Array<{ id: { type: string; lazy?: boolean; elements?: Array<{ name?: string } | null> } }> }): boolean {
  return (
    (decl as any).type === 'VariableDeclaration' &&
    (decl as any).declarations.length === 1 &&
    (decl as any).declarations[0].id.type === 'ArrayPattern' &&
    (decl as any).declarations[0].id.lazy === true
  );
}

function getParamNames(params: Array<{ type: string; name?: string; properties?: Array<{ key: { name?: string; value?: string }; value: { type: string; right?: { start: number; end: number } } }>; elements?: Array<{ name?: string } | null> }>, source: string): string[] {
  return params.map((p) => {
    if (p.type === 'Identifier') return [p.name!];
    if (p.type === 'ObjectPattern') return p.properties!.map((prop) => {
      const name = prop.key.name || prop.key.value;
      if (prop.value.type === 'AssignmentPattern') {
        const defaultSrc = source.slice(prop.value.right!.start, prop.value.right!.end);
        return `${name} = ${defaultSrc}`;
      }
      return name!;
    });
    if (p.type === 'ArrayPattern') return p.elements!.map((el) => el?.name ?? '_');
    return ['_'];
  }).flat();
}

export function getPropsType(params: Array<{ type: string; name?: string; left?: any; typeAnnotation?: any; properties?: any[] }> | undefined | null, source: string): string | null {
  if (!params || params.length === 0) return null;
  if (params.length === 1) {
    const p = params[0];
    const inner = p.typeAnnotation?.typeAnnotation;
    if (inner) return source.slice(inner.start, inner.end).trim();
    const left = p.type === 'AssignmentPattern' ? p.left : null;
    const innerLeft = left?.typeAnnotation?.typeAnnotation;
    if (innerLeft) return source.slice(innerLeft.start, innerLeft.end).trim();
    return null;
  }
  const members: string[] = [];
  for (const p of params) {
    let name: string | null = null;
    let optional = false;
    let type = 'any';
    if (p.type === 'Identifier') {
      name = p.name ?? null;
      const inner = p.typeAnnotation?.typeAnnotation;
      if (inner) type = source.slice(inner.start, inner.end).trim();
    } else if (p.type === 'AssignmentPattern') {
      optional = true;
      name = p.left?.name ?? null;
      const inner = p.left?.typeAnnotation?.typeAnnotation;
      if (inner) type = source.slice(inner.start, inner.end).trim();
    } else if (p.type === 'ObjectPattern') {
      const inner = p.typeAnnotation?.typeAnnotation;
      if (inner) return source.slice(inner.start, inner.end).trim();
      continue;
    }
    if (name) members.push(`${JSON.stringify(name)}${optional ? '?' : ''}: ${type}`);
  }
  if (members.length === 0) return null;
  return `{ ${members.join('; ')} }`;
}

function getJSXTagName(nameNode: { type: string; name?: string; object?: any; property?: any }): string {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name!;
  if (nameNode.type === 'JSXMemberExpression') {
    return getJSXTagName(nameNode.object) + '.' + getJSXTagName(nameNode.property);
  }
  return 'unknown';
}

function isHTMLTag(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toLowerCase();
}

function isMapCall(expr: any): boolean {
  return (
    expr.type === 'CallExpression' &&
    expr.callee.type === 'MemberExpression' &&
    expr.callee.property.name === 'map' &&
    expr.arguments.length === 1 &&
    expr.arguments[0].type === 'ArrowFunctionExpression'
  );
}

function toExpression(source: string, expr: { start: number; end: number }): Expression {
  return new Expression(getSource(source, expr), [], expr as unknown as ESTreeNode, source);
}

function processAttribute(source: string, attr: any): { name: string; value: string | Expression } {
  const name = attr.name.type === 'JSXIdentifier' ? attr.name.name : getSource(source, attr.name);
  if (attr.value === null) return { name, value: '' };
  if (attr.value.type === 'Literal') return { name, value: String(attr.value.value) };
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr.type === 'Literal') return { name, value: String(expr.value) };
    // A JSX element can never be a DOM attribute value — elements belong to
    // content/slots, not to an attribute slot on an HTML tag. Surfacing a real
    // error here beats a raw `(<div/>)` leaking into compiled JS (the previous
    // behavior crashed with a runtime SyntaxError deep inside codegen).
    if (containsJSX(expr)) {
      throw VeskError.attrJsxElement({ attr: name });
    }
    return { name, value: toExpression(source, expr) };
  }
  return { name, value: '' };
}

/**
 * True when `node` (an expression AST) contains a JSX element or fragment
 * anywhere in its subtree — used to distinguish slot-bearing prop values
 * (`trigger={<Button/>}`, `trigger={open ? <A/> : <B/>}`) from plain ones
 * (`align={'end'}`, `count={n + 1}`).
 */
function containsJSX(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  if (node.type === 'JSXExpressionContainer') return containsJSX(node.expression);
  // TS-only position holders (type annotations, parameter names) never contain
  // JSX — skipping them avoids walking TS structure.
  for (const key of [
    'expression', 'object', 'property', 'callee', 'arguments', 'test',
    'consequent', 'alternate', 'left', 'right', 'init', 'elements', 'params', 'body',
  ]) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (containsJSX(c)) return true;
    } else if (child && containsJSX(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the prop name when `expr` is a bare `props.<name>` read, else null.
 */
function slotReadPropName(expr: any): string | null {
  if (
    expr.type === 'MemberExpression' && !expr.computed &&
    expr.object.type === 'Identifier' && expr.object.name === (__propsParam || 'props') &&
    expr.property.type === 'Identifier'
  ) {
    return expr.property.name;
  }
  return null;
}

/**
 * Parses an inline component props type (`{ trigger: Component; ... }`) and
 * returns the set of prop names declared as renderable content — any member
 * whose type text mentions `Component`. Those props may be handed a JSX
 * element at the call site and are read back with `{props.<name>}` as slots.
 */
function slotPropNamesFromType(propsType: string | null): Set<string> {
  const out = new Set<string>();
  if (!propsType) return out;
  const trimmed = propsType.trim();
  if (trimmed.startsWith('{')) {
    const inner = findBalancedEnd(trimmed, 0) === trimmed.length - 1
      ? trimmed.slice(1, -1)
      : trimmed;
    for (const part of splitTopLevel(inner, ';')) {
      const colon = findTopLevelColon(part);
      if (colon === -1) continue;
      const namePart = part.slice(0, colon).trim().replace(/^\$/, '').replace(/\?$/, '').trim();
      const typePart = part.slice(colon + 1).trim();
      if (namePart && typePart.includes('Component')) out.add(namePart);
    }
  }
  return out;
}

function findTopLevelColon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Recognizes a statement-mode `if (cond)` opening among JSX children.
 * Returns the condition source, or null when `text` does not open an if
 * header (keyword + balanced parens).
 */
function extractIfHeader(text: string): string | null {
  if (!startsWithIdentifier(text, 'if')) return null;
  let i = skipWhitespace(text, 2);
  if (text[i] !== '(') return null;
  const end = findBalancedEnd(text, i);
  return text.slice(i + 1, end).trim();
}

function extractForHeader(text: string): string | null {
  if (!startsWithIdentifier(text, 'for')) return null;
  let i = skipWhitespace(text, 3);
  if (text[i] !== '(') return null;
  const end = findBalancedEnd(text, i);
  return text.slice(i + 1, end);
}

/**
 * Returns the offset of the `for` keyword in a JSXText value (ignoring
 * leading whitespace), or -1 when the value does not begin with a `for`.
 */
function hasForPrefix(text: string): number {
  if (!startsWithIdentifier(text, 'for')) return -1;
  let i = 0;
  while (i < text.length && isWhitespaceChar(text[i])) i++;
  return i;
}

function processJSXChildren(source: string, children: any[]): IRNode[] {
  const result: IRNode[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === 'JSXText') {
      const text = collapseNewlineWhitespace(child.value);
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//')) { i++; continue; }

      // ── statement-mode if / else-if / else among element children ──
      const ifCond = extractIfHeader(trimmed);
      const seqNext = children[i + 1];
      if (
        ifCond !== null &&
        seqNext !== undefined &&
        seqNext.type === 'JSXExpressionContainer' &&
        seqNext.expression.type !== 'JSXEmptyExpression'
      ) {
        interface ChainLink { cond: Expression; nodes: IRNode[] }
        const links: ChainLink[] = [];
        let alternate: IRNode[] | null = null;

        const containerToNodes = (container: any): IRNode[] => {
          const exprNode = container.expression;
          if (exprNode.type === 'JSXFragment') {
            const inner: IRNode[] = [];
            for (const c of exprNode.children) inner.push(...processJSXChildren(source, [c]));
            return inner;
          }
          if (exprNode.type === 'JSXElement') return processJSXElement(source, exprNode);
          return exprToIR(source, exprNode);
        };

        links.push({
          cond: new Expression(ifCond, [], parseExprNode(ifCond), null),
          nodes: containerToNodes(seqNext),
        });

        let j = i + 2;
        while (j < children.length) {
          const sep = children[j];
          if (sep === undefined || sep.type !== 'JSXText') break;
          const sv = sep.value.trim();
          const cont = children[j + 1];
          if (sv.startsWith('} else if') || sv.startsWith('else if')) {
            const ifIdx = sv.indexOf('if');
            const header = extractIfHeader(sv.slice(ifIdx));
            if (header === null || cont === undefined || cont.type !== 'JSXExpressionContainer') break;
            links.push({
              cond: new Expression(header, [], parseExprNode(header), null),
              nodes: containerToNodes(cont),
            });
            j += 2;
            continue;
          }
          if (sv.startsWith('} else') || sv === 'else') {
            if (cont === undefined || cont.type !== 'JSXExpressionContainer') break;
            alternate = containerToNodes(cont);
            j += 2;
          }
          break;
        }

        // Fold right-to-left: earlier conditions wrap later ones as alternate.
        let tail: IRNode[] = alternate || [];
        for (let k = links.length - 1; k >= 0; k--) {
          tail = [new OpaqueDynamicRegion(links[k].cond, links[k].nodes, tail)];
        }
        result.push(...tail);
        i = j;
        continue;
      }

      const forDecl = extractForHeader(trimmed);
      const nextChild = children[i + 1];
      if (
        forDecl !== null && nextChild !== undefined && (
          nextChild.type === 'JSXExpressionContainer' ||
          nextChild.type === 'JSXElement' ||
          nextChild.type === 'JSXFragment'
        )
      ) {
        const decl = forDecl;
        let bodyNodes: IRNode[];
        if (nextChild.type === 'JSXExpressionContainer') {
          const exprNode = nextChild.expression;
          if (exprNode.type === 'JSXEmptyExpression') {
            result.push(new TextNode(text));
            i++;
            continue;
          }
          if (exprNode.type === 'JSXFragment') {
            bodyNodes = [];
            for (const c of exprNode.children) bodyNodes.push(...processJSXChildren(source, [c]));
          } else if (exprNode.type === 'JSXElement') {
            bodyNodes = processJSXElement(source, exprNode);
          } else {
            bodyNodes = exprToIR(source, exprNode);
          }
        } else if (nextChild.type === 'JSXFragment') {
          bodyNodes = [];
          for (const c of nextChild.children) bodyNodes.push(...processJSXChildren(source, [c]));
        } else {
          bodyNodes = processJSXElement(source, nextChild);
        }

        const ofParts = splitTopLevel(decl, 'of');
        if (ofParts.length === 2) {
          const itemVar = stripDeclKeyword(ofParts[0]).trim();
          const exprText = ofParts[1].trim();
          const arrExpr = new Expression(exprText, [], parseExprNode(exprText), null);
          const rawFor = hasForPrefix(child.value);
          const ann = rawFor !== -1 ? getForClauseAnnotation(child.start + rawFor) : null;
          const keyExpr = ann?.keyRange ? new Expression(source.slice(ann.keyRange[0], ann.keyRange[1])) : null;
          const indexVar = ann?.indexName ?? null;
          let alternate: IRNode[] = [];
          let consumed = 2;
          const emptyText = children[i + 2];
          const emptyContainer = children[i + 3];
          if (
            emptyText && emptyText.type === 'JSXText' && ['#empty', 'empty'].includes(emptyText.value.trim()) &&
            emptyContainer && emptyContainer.type === 'JSXExpressionContainer' &&
            emptyContainer.expression.type !== 'JSXEmptyExpression'
          ) {
            alternate = exprToIR(source, emptyContainer.expression);
            consumed = 4;
          }
          result.push(new MapRegion(arrExpr, itemVar, bodyNodes, keyExpr, indexVar, alternate));
          i += consumed;
          continue;
        }

        const inParts = splitTopLevel(decl, 'in');
        if (inParts.length === 2) {
          const itemVar = inParts[0].trim();
          const arrExpr = new Expression(inParts[1].trim());
          result.push(new ForLoop(itemVar, arrExpr, '', bodyNodes, 'for-in'));
          i += 2;
          continue;
        }
      }

      result.push(new TextNode(text));
      i++;
    } else if (child.type === 'JSXExpressionContainer') {
      const expr = child.expression;
      if (expr.type === 'JSXEmptyExpression') { i++; continue; }

      if (isMapCall(expr)) {
        const arrowFn = expr.arguments[0];
        const itemVar = mapParamSource(source, arrowFn.params[0]);
        const indexVar = arrowFn.params[1]?.name ?? null;
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, expr.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        result.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr, indexVar));
        i++;
        continue;
      }

      if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
        const condExpr = toExpression(source, expr.left);
        const consequent = exprToIR(source, expr.right);
        result.push(new OpaqueDynamicRegion(condExpr, consequent));
        i++;
        continue;
      }

      if (expr.type === 'ConditionalExpression') {
        const condExpr = toExpression(source, expr.test);
        const consequent = exprToIR(source, expr.consequent);
        const alternate = exprToIR(source, expr.alternate);
        result.push(new OpaqueDynamicRegion(condExpr, consequent, alternate));
        i++;
        continue;
      }

      if (
        (expr.type === 'MemberExpression' && !expr.computed &&
          expr.object.type === 'Identifier' && expr.object.name === (__propsParam || 'props') &&
          expr.property.type === 'Identifier' && expr.property.name === 'children')
        || (expr.type === 'Identifier' && expr.name === 'children')
      ) {
        result.push(new SlotNode());
        i++;
        continue;
      }

      // A content read of a component-declared slot prop (`{props.trigger}`)
      // must render the threaded content — not stringify a fragment.
      {
        const slotName = slotReadPropName(expr);
        if (slotName !== null && __slotProps !== null && __slotProps.has(slotName)) {
          result.push(new PropSlotRender(slotName));
          i++;
          continue;
        }
      }

      result.push(new DynamicBinding(toExpression(source, expr)));
      i++;
    } else if (child.type === 'JSXElement') {
      result.push(...processJSXElement(source, child));
      i++;
    } else if (child.type === 'JSXFragment') {
      for (const c of child.children) result.push(...processJSXChildren(source, [c]));
      i++;
    } else if (child.type === 'ForOfStatement') {
      let alternate: IRNode[] = [];
      let consumed = 1;
      const emptyText = children[i + 1];
      const emptyContainer = children[i + 2];
      if (
        emptyText && emptyText.type === 'JSXText' &&
        ['#empty', 'empty'].includes(emptyText.value.trim()) &&
        emptyContainer && emptyContainer.type === 'JSXExpressionContainer' &&
        emptyContainer.expression.type !== 'JSXEmptyExpression'
      ) {
        alternate = exprToIR(source, emptyContainer.expression);
        consumed = 3;
      }
      result.push(...processForStatement(source, child, alternate));
      i += consumed;
      continue;
    } else if (
      child.type === 'IfStatement' || child.type === 'ForStatement' ||
      child.type === 'ForInStatement' ||
      child.type === 'WhileStatement' || child.type === 'DoWhileStatement' ||
      child.type === 'SwitchStatement' || child.type === 'TryStatement' ||
      child.type === 'VariableDeclaration' || child.type === 'ExpressionStatement' ||
      child.type === 'ReturnStatement' || child.type === 'WithStatement' ||
      child.type === 'LabeledStatement'
    ) {
      result.push(...processStatementModeBody(source, [child]));
      i++;
    } else {
      i++;
    }
  }
  return result;
}

function exprToIR(source: string, expr: any): IRNode[] {
  if (expr.type === 'JSXElement') return processJSXElement(source, expr);
  if (expr.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of expr.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (isMapCall(expr)) {
    const arrowFn = expr.arguments[0];
    const itemVar = mapParamSource(source, arrowFn.params[0]);
    const indexVar = arrowFn.params[1]?.name ?? null;
    const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
    const arrayExpr = toExpression(source, expr.callee.object);
    const keyExpr = extractKeyExpr(bodyNodes);
    return [new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr, indexVar)];
  }
  if (expr.type === 'ParenthesizedExpression') return exprToIR(source, expr.expression);
  // Nested conditionals/`&&` with JSX branches become nested dynamic regions
  // so `a ? <X/> : b ? <Y/> : <Z/>` compiles recursively instead of degrading
  // to a raw text binding.
  if (expr.type === 'ConditionalExpression') {
    const condExpr = toExpression(source, expr.test);
    const consequent = exprToIR(source, expr.consequent);
    const alternate = exprToIR(source, expr.alternate);
    return [new OpaqueDynamicRegion(condExpr, consequent, alternate)];
  }
  if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
    const condExpr = toExpression(source, expr.left);
    const consequent = exprToIR(source, expr.right);
    return [new OpaqueDynamicRegion(condExpr, consequent)];
  }
  // `props.children` (or bare `children`) inside an expression branch must
  // insert the slot nodes — not degrade to a text binding that stringifies
  // the fragment (`String(props.children)` → "[object DocumentFragment]").
  if (
    (expr.type === 'MemberExpression' && !expr.computed &&
      expr.object.type === 'Identifier' && expr.object.name === (__propsParam || 'props') &&
      expr.property.type === 'Identifier' && expr.property.name === 'children')
    || (expr.type === 'Identifier' && expr.name === 'children')
  ) {
    return [new SlotNode()];
  }
  const slotName = slotReadPropName(expr);
  if (slotName !== null && __slotProps !== null && __slotProps.has(slotName)) {
    return [new PropSlotRender(slotName)];
  }
  return [new DynamicBinding(toExpression(source, expr))];
}

/**
 * True when an `ExpressionStatement` expression is a pure value that should
 * render as output (a bare reference, member access, literal, template,
 * conditional, etc.) rather than a side-effecting statement (call, assignment,
 * update, `new`, `await`, `yield`, tagged template, `delete`/`void`). Side
 * effects stay as runtime statements; pure values become dynamic bindings.
 */
function isRenderableExpression(expr: any): boolean {
  const t = expr.type;
  if (
    t === 'CallExpression' || t === 'NewExpression' ||
    t === 'AssignmentExpression' || t === 'UpdateExpression' ||
    t === 'AwaitExpression' || t === 'YieldExpression' ||
    t === 'TaggedTemplateExpression' || t === 'ImportExpression' ||
    t === 'MetaProperty'
  ) {
    return false;
  }
  if (t === 'UnaryExpression') {
    return expr.operator !== 'delete' && expr.operator !== 'void';
  }
  if (t === 'SequenceExpression') {
    return isRenderableExpression(expr.expressions[expr.expressions.length - 1]);
  }
  return true;
}

function processJSXCallbackBody(source: string, body: any): IRNode[] {
  if (body.type === 'JSXElement') return processJSXElement(source, body);
  if (body.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of body.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (body.type === 'ParenthesizedExpression') return exprToIR(source, body.expression);
  return exprToIR(source, body);
}

function processJSXElement(source: string, element: any): IRNode[] {
  const nameNode = element.openingElement.name;
  const tagName = getJSXTagName(nameNode);
  const selfClosing = element.openingElement.selfClosing;

  if (tagName === 'Head') {
    const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
    return [new HeadBlock(children)];
  }

  // A dotted JSX tag (`<it.icon>`, `<Foo.Bar>`) is a component-valued member
  // expression — never an HTML element (dots are not valid in tag names) and
  // never a registry key. Carry the raw expression so codegen invokes the
  // actual in-scope value instead of `document.createElement("it.icon")` or a
  // registry lookup by dotted string.
  if (nameNode && nameNode.type === 'JSXMemberExpression') {
    const { props, spreadProps, slots } = extractProps(source, element);
    const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
    return [new ComponentCall(tagName, props, [...children, ...slots.map((s) => new PropSlot(s.name, s.nodes))], spreadProps, element.start, getSource(source, nameNode))];
  }

  if (!isHTMLTag(tagName) && selfClosing) {
    const { props, spreadProps, slots } = extractProps(source, element);
    return [new ComponentCall(tagName, props, slots.map((s) => new PropSlot(s.name, s.nodes)), spreadProps, element.start)];
  }

  if (!isHTMLTag(tagName)) {
    const { props, spreadProps, slots } = extractProps(source, element);
    const children = processJSXChildren(source, element.children || []);
    return [new ComponentCall(tagName, props, [...children, ...slots.map((s) => new PropSlot(s.name, s.nodes))], spreadProps, element.start)];
  }

  const attributes = element.openingElement.attributes
    .filter((attr: any) => attr.type !== 'JSXSpreadAttribute')
    .map((attr: any) => processAttribute(source, attr));
  const staticAttrs: { name: string; value: string }[] = [];
  const attrBindings: IRNode[] = [];
  let keyExpr: Expression | null = null;

  for (const attr of attributes) {
    if (attr.name === 'key') {
      keyExpr = typeof attr.value === 'string' ? new Expression(JSON.stringify(attr.value)) : attr.value;
      continue;
    }
    if (attr.name === 'ref') {
      attrBindings.push(new DynamicBinding(attr.value as Expression, 'attribute', attr.name));
      continue;
    }
    if (typeof attr.value === 'string') {
      staticAttrs.push({ name: attr.name, value: attr.value });
    } else {
      staticAttrs.push({ name: attr.name, value: '' });
      attrBindings.push(new DynamicBinding(attr.value as Expression, 'attribute', attr.name));
    }
  }

  const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
  const node = new StaticNode(tagName, staticAttrs, [...attrBindings, ...children], keyExpr);
  node.selfClosing = selfClosing;
  return [node];
}

function extractProps(source: string, element: any): { props: { name: string; value: Expression }[]; spreadProps: Expression[]; slots: { name: string; nodes: IRNode[] }[] } {
  const props: { name: string; value: Expression }[] = [];
  const spreadProps: Expression[] = [];
  const slots: { name: string; nodes: IRNode[] }[] = [];
  for (const attr of element.openingElement.attributes) {
    if (attr.type === 'JSXSpreadAttribute') {
      spreadProps.push(toExpression(source, attr.argument));
    } else {
      const name = attr.name.type === 'JSXIdentifier' ? attr.name.name : getSource(source, attr.name);
      let value: Expression;
      if (attr.value === null) {
        value = new Expression('true');
      } else if (attr.value.type === 'JSXExpressionContainer') {
        const expr = attr.value.expression;
        // JSX elements as prop values are named content slots (`trigger={<Button/>}`),
        // not scalar values — the call site hoists them into the slot channel.
        if (containsJSX(expr)) {
          slots.push({ name, nodes: exprToIR(source, expr) });
          continue;
        }
        value = toExpression(source, expr);
      } else {
        value = new Expression(JSON.stringify(attr.value.value));
      }
      props.push({ name, value });
    }
  }
  return { props, spreadProps, slots };
}

function buildGuardChain(source: string, guardClauses: any[], mainReturn: any): IRNode[] {
  const mainBody: IRNode[] = [];
  if (mainReturn && mainReturn.argument) {
    if (mainReturn.argument.type === 'JSXElement') {
      mainBody.push(...processJSXElement(source, mainReturn.argument));
    } else if (mainReturn.argument.type === 'JSXFragment') {
      for (const c of mainReturn.argument.children) {
        mainBody.push(...processJSXChildren(source, [c]));
      }
    } else {
      mainBody.push(new DynamicBinding(toExpression(source, mainReturn.argument)));
    }
  }

  let currentAlternate: IRNode[] = mainBody;
  for (let i = guardClauses.length - 1; i >= 0; i--) {
    const guard = guardClauses[i];
    const condExpr = toExpression(source, guard.test);
    const consequent: IRNode[] = [];
    const guardReturn = getReturnArgument(guard.consequent);
    if (guardReturn) {
      if (guardReturn.type === 'JSXElement') {
        consequent.push(...processJSXElement(source, guardReturn));
      } else if (guardReturn.type === 'JSXFragment') {
        for (const c of guardReturn.children) consequent.push(...processJSXChildren(source, [c]));
      } else {
        consequent.push(new DynamicBinding(toExpression(source, guardReturn)));
      }
    }
    currentAlternate = [new OpaqueDynamicRegion(condExpr, consequent, currentAlternate)];
  }

  return currentAlternate;
}

function getComponentRefName(decl: any): string | null {
  if (!isTrackDeclaration(decl)) return null;
  const pattern = decl.declarations[0].id;
  if (pattern.type === 'ArrayPattern' && pattern.elements.length === 1) {
    const name = pattern.elements[0]?.name;
    if (name && name[0] === name[0].toUpperCase()) return name;
  }
  return null;
}

function hasJSXInSubtree(node: any): boolean {
  if (!node) return false;
  if (node.type === 'JSXElement' || node.type === 'JSXExpressionContainer' || node.type === 'JSXFragment') return true;
  if (node.type === 'BlockStatement') return node.body.some(hasJSXInSubtree);
  if (node.type === 'IfStatement') return hasJSXInSubtree(node.consequent) || hasJSXInSubtree(node.alternate);
  if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'WhileStatement' || node.type === 'DoWhileStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'SwitchStatement') return node.cases.some((c: any) => c.consequent?.some(hasJSXInSubtree));
  if (node.type === 'TryStatement') return hasJSXInSubtree(node.block) || hasJSXInSubtree(node.handler) || hasJSXInSubtree(node.finalizer);
  if (node.type === 'CatchClause') return hasJSXInSubtree(node.body);
  if (node.type === 'LabeledStatement') return hasJSXInSubtree(node.body);
  if (node.type === 'ReturnStatement') return hasJSXInSubtree(node.argument);
  return false;
}

function isGuardClause(node: any): boolean {
  return (
    node.type === 'IfStatement' &&
    !node.alternate &&
    getReturnArgument(node.consequent) !== null &&
    hasJSXInSubtree(node.consequent)
  );
}

/**
 * Returns the `return` argument of a statement that represents an early
 * return — either a bare `ReturnStatement` or a `BlockStatement` wrapping a
 * single `ReturnStatement`. Returns `null` when the statement is not such a
 * return (including `return null` / `return;`, whose argument is absent).
 */
function getReturnArgument(node: any): any {
  if (node.type === 'ReturnStatement') return node.argument ?? null;
  if (node.type === 'BlockStatement' && node.body.length === 1 && node.body[0].type === 'ReturnStatement') {
    return node.body[0].argument ?? null;
  }
  return null;
}

/**
 * Returns the `return` statement of an early-return statement — either a bare
 * `ReturnStatement` or a `BlockStatement` wrapping a single `ReturnStatement` —
 * regardless of whether it has an argument. Returns `null` when the statement
 * is not such a return. Unlike `getReturnArgument`, a *bare* `return` (no
 * argument) is recognized: `if (c) return` must still short-circuit the rest
 * of the body with an empty consequent.
 */
function getReturnStatement(node: any): any {
  if (node.type === 'ReturnStatement') return node;
  if (node.type === 'BlockStatement' && node.body.length === 1 && node.body[0].type === 'ReturnStatement') {
    return node.body[0];
  }
  return null;
}

function isStatementMode(bodyStmts: any[]): boolean {
  if (bodyStmts.some((s) => s.type === 'JSXElement' || s.type === 'JSXExpressionContainer' || s.type === 'JSXFragment')) return true;
  for (const stmt of bodyStmts) {
    if (stmt.type === 'IfStatement' && !isGuardClause(stmt) && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForOfStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'ForInStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'WhileStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'DoWhileStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'SwitchStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'TryStatement' && hasJSXInSubtree(stmt)) return true;
    if (stmt.type === 'LabeledStatement' && hasJSXInSubtree(stmt)) return true;
  }
  return false;
}

function processBlockBody(source: string, block: any): IRNode[] {
  if (block.type === 'BlockStatement') return processStatementModeBody(source, block.body);
  if (block.type === 'JSXElement') return processJSXElement(source, block);
  if (block.type === 'JSXFragment') {
    const nodes: IRNode[] = [];
    for (const c of block.children) nodes.push(...processJSXChildren(source, [c]));
    return nodes;
  }
  if (block.type === 'IfStatement') return processIfStatement(source, block);
  if (block.type === 'JSXExpressionContainer') {
    return exprToIR(source, block.expression);
  }
  const raw = getSource(source, block);
  if (raw) return [new RuntimeStatement(raw, block, source)];
  return [];
}

function processIfStatement(source: string, stmt: any): IRNode[] {
  const condExpr = toExpression(source, stmt.test);
  const consequent = processBlockBody(source, stmt.consequent);
  const alternate = stmt.alternate ? processBlockBody(source, stmt.alternate) : [];
  return [new OpaqueDynamicRegion(condExpr, consequent, alternate)];
}

function processForStatement(source: string, stmt: any, alternate: IRNode[] = []): IRNode[] {
  if (stmt.type === 'ForOfStatement') {
    const left = stmt.left;
    let itemVar = 'item';
    if (left.type === 'VariableDeclaration') {
      itemVar = patternSource(source, left.declarations[0]?.id);
    } else if (left.type === 'Identifier') {
      itemVar = left.name ?? 'item';
    } else if (typeof left.start === 'number' && typeof left.end === 'number') {
      itemVar = source.slice(left.start, left.end).trim() || 'item';
    }
    const arrayExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    const ann = getForClauseAnnotation(stmt.start);
    const keyExpr = ann?.keyRange ? new Expression(source.slice(ann.keyRange[0], ann.keyRange[1])) : null;
    const indexVar = ann?.indexName ?? null;
    return [new MapRegion(arrayExpr, itemVar, bodyTemplate, keyExpr, indexVar, alternate)];
  }
  if (stmt.type === 'ForInStatement') {
    const left = getSource(source, stmt.left);
    const objExpr = toExpression(source, stmt.right);
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(left, objExpr, '', bodyTemplate, 'for-in')];
  }
  if (stmt.type === 'ForStatement') {
    const init = stmt.init ? getSource(source, stmt.init) : '';
    const test = stmt.test ? toExpression(source, stmt.test) : new Expression('true');
    const update = stmt.update ? getSource(source, stmt.update) : '';
    const bodyTemplate = processBlockBody(source, stmt.body);
    return [new ForLoop(init, test, update, bodyTemplate, 'for')];
  }
  return [];
}

function processWhileStatement(source: string, stmt: any): IRNode[] {
  const condition = toExpression(source, stmt.test);
  const bodyTemplate = processBlockBody(source, stmt.body);
  const isDoWhile = stmt.type === 'DoWhileStatement';
  return [new WhileLoop(condition, bodyTemplate, isDoWhile)];
}

function processSwitchStatement(source: string, stmt: any): IRNode[] {
  const discriminant = toExpression(source, stmt.discriminant);
  const cases = stmt.cases.map((c: any) => ({
    test: c.test ? toExpression(source, c.test) : null,
    body: processStatementModeBody(source, c.consequent),
  }));
  return [new SwitchBlock(discriminant, cases)];
}

function processTryStatement(source: string, stmt: any): IRNode[] {
  const bodyTemplate = processBlockBody(source, stmt.block);
  const catchBody = stmt.handler ? processBlockBody(source, stmt.handler.body) : [];
  const catchParamName = stmt.handler?.param?.name ?? null;
  return [new TryCatch(bodyTemplate, catchBody, catchParamName)];
}

function processStatementModeBody(source: string, bodyStmts: any[], filename?: string): IRNode[] {
  const nodes: IRNode[] = [];
  for (let i = 0; i < bodyStmts.length; i++) {
    const stmt = bodyStmts[i];
    if (stmt.type === 'JSXElement') {
      nodes.push(...processJSXElement(source, stmt));
    } else if (stmt.type === 'JSXExpressionContainer') {
      if (stmt.expression.type === 'JSXEmptyExpression') continue;
      if (isMapCall(stmt.expression)) {
        const arrowFn = stmt.expression.arguments[0];
        const itemVar = arrowFn.params[0]?.name ?? 'item';
        const bodyNodes = processJSXCallbackBody(source, arrowFn.body);
        const arrayExpr = toExpression(source, stmt.expression.callee.object);
        const keyExpr = extractKeyExpr(bodyNodes);
        nodes.push(new MapRegion(arrayExpr, itemVar, bodyNodes, keyExpr));
        continue;
      }
      nodes.push(...exprToIR(source, stmt.expression));
    } else if (stmt.type === 'JSXFragment') {
      for (const c of stmt.children) {
        nodes.push(...processJSXChildren(source, [c]));
      }
    } else if (stmt.type === 'VeskBlock') {
      if (stmt.tag === 'empty') continue;
      const inner = processStatementModeBody(source, stmt.body, filename);
      if (stmt.tag === 'server') {
        nodes.push(new ServerBlock(inner));
      } else if (stmt.tag === 'client') {
        nodes.push(new ClientBlock(inner));
      }
    } else if (isTrackDeclaration(stmt)) {
      const elements = stmt.declarations[0].id.elements;
      const name = elements[0]?.name;
      const rawName = elements.length > 1 ? elements[1]?.name : null;
      const init = getSource(source, stmt.declarations[0].init);
      if (name) nodes.push(new TrackDecl(name, init, rawName));
      const refName = getComponentRefName(stmt);
      if (refName) nodes.push(new ComponentRef(refName));
    } else if (stmt.type === 'IfStatement') {
      // Guard-clause early return (`if (c) return X` with no else): everything
      // after this statement becomes the alternate branch, mirroring
      // expression-mode `buildGuardChain`. Without this the `return` is
      // silently swallowed and execution falls through into code that
      // assumes the guard held.
      const guardReturn = !stmt.alternate ? getReturnStatement(stmt.consequent) : null;
      if (guardReturn) {
        // A bare `return` (no argument) is a guard that renders nothing, like
        // expression-mode's empty consequent for argument-less returns.
        const consequent = guardReturn.argument ? exprToIR(source, guardReturn.argument) : [];
        const alternate = processStatementModeBody(source, bodyStmts.slice(i + 1), filename);
        nodes.push(new OpaqueDynamicRegion(toExpression(source, stmt.test), consequent, alternate));
        break;
      }
      nodes.push(...processIfStatement(source, stmt));
    } else if (stmt.type === 'ForOfStatement') {
      let alternate: IRNode[] = [];
      let consumed = 1;
      const next = bodyStmts[i + 1];
      if (next && next.type === 'VeskBlock' && next.tag === 'empty') {
        alternate = processStatementModeBody(source, next.body, filename);
        consumed = 2;
      }
      nodes.push(...processForStatement(source, stmt, alternate));
      i += consumed - 1;
    } else if (stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement') {
      nodes.push(...processWhileStatement(source, stmt));
    } else if (stmt.type === 'SwitchStatement') {
      nodes.push(...processSwitchStatement(source, stmt));
    } else if (stmt.type === 'TryStatement') {
      nodes.push(...processTryStatement(source, stmt));
    } else if (stmt.type === 'ReturnStatement') {
      if (stmt.argument) {
        nodes.push(...exprToIR(source, stmt.argument));
      }
    } else if (stmt.type === 'LabeledStatement') {
      nodes.push(...processBlockBody(source, stmt.body));
    } else if (stmt.type === 'ForInStatement') {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === 'ForStatement') {
      nodes.push(...processForStatement(source, stmt));
    } else if (stmt.type === 'ExpressionStatement') {
      if (isRenderableExpression(stmt.expression)) {
        nodes.push(...exprToIR(source, stmt.expression));
      } else {
        const raw = getSource(source, stmt);
        if (raw) nodes.push(new RuntimeStatement(raw, stmt, source));
      }
    } else if (stmt.type === 'ClassDeclaration') {
      const { line, column } = offsetToLineCol(source, (stmt as unknown as { start: number }).start ?? 0);
      throw VeskError.classDecl({ file: filename || '', line, column, code: codeFrame(source, line, column) });
    } else {
      const raw = getSource(source, stmt);
      if (raw) nodes.push(new RuntimeStatement(raw, stmt, source));
    }
  }
  return nodes;
}

function extractStyle(body: IRNode[]): { body: IRNode[]; css: string | null } {
  const cssParts: string[] = [];
  const filtered: IRNode[] = [];
  for (const node of body) {
    if (node instanceof StaticNode && node.tag === 'style') {
      for (const child of node.children) {
        if (child instanceof TextNode) {
          cssParts.push(child.value);
        }
      }
    } else {
      filtered.push(node);
    }
  }
  return { body: filtered, css: cssParts.join('\n') || null };
}

function validateBlocks(compName: string, isClient: boolean, body: IRNode[], file?: string, source?: string): void {
  for (const node of body) {
    if (isClient) {
      if (node instanceof ServerBlock) {
        const opts: Record<string, unknown> = file ? { file } : {};
        if (source && (node as unknown as { start?: number }).start !== undefined) {
          const pos = (node as unknown as { start: number }).start;
          const { line, column } = offsetToLineCol(source, pos);
          (opts as { line: number; column: number; code: string }).line = line;
          (opts as { line: number; column: number; code: string }).column = column;
          (opts as { code: string }).code = codeFrame(source, line, column);
        }
        throw VeskError.serverBlockInClient(compName, opts as { file?: string });
      }
    } else {
      if (node instanceof ClientBlock) {
        const opts: Record<string, unknown> = file ? { file } : {};
        if (source && (node as unknown as { start?: number }).start !== undefined) {
          const pos = (node as unknown as { start: number }).start;
          const { line, column } = offsetToLineCol(source, pos);
          (opts as { line: number; column: number; code: string }).line = line;
          (opts as { line: number; column: number; code: string }).column = column;
          (opts as { code: string }).code = codeFrame(source, line, column);
        }
        throw VeskError.clientBlockInServer(compName, opts as { file?: string });
      }
    }
    if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock) {
      validateBlocks(compName, isClient, (node as any).children || [], file, source);
    }
  }
}

function processEnum(node: any, source: string, exported: boolean): string {
  const name = node.id.name;
  const pairs: string[] = [];
  const reversePairs: string[] = [];
  let autoVal = 0;
  for (const member of node.members) {
    const key = member.id.name;
    let val: string;
    if (member.initializer) {
      val = getSource(source, member.initializer);
    } else {
      val = String(autoVal);
    }
    pairs.push(`${JSON.stringify(key)}: ${val}`);
    reversePairs.push(`${val}: ${JSON.stringify(key)}`);
    if (!member.initializer) autoVal++;
  }
  const allPairs = [...reversePairs, ...pairs].join(', ');
  const prefix = exported ? `export const ${name}` : `const ${name}`;
  return `${prefix} = { ${allPairs} };`;
}


/**
 * Normalizes any `@vesk/runtime/<subpath>` import specifier to the bare
 * `'@vesk/runtime'` form. The runtime resolves all subpaths onto the same
 * module graph, and downstream consumers (client scope injection, chunk
 * stripping) key off the canonical bare specifier. Char-scan based — no
 * regex, per repo rule.
 */
function normalizeRuntimeSpecifier(stmt: string): string {
  const fromIdx = stmt.indexOf(' from ');
  if (fromIdx === -1) return stmt;
  const q1 = idxOfQuote(stmt, fromIdx);
  if (q1 === -1) return stmt;
  const quote = stmt[q1];
  const q2 = stmt.indexOf(quote, q1 + 1);
  if (q2 === -1) return stmt;
  const spec = stmt.slice(q1 + 1, q2);
  if (spec === '@vesk/runtime' || !spec.startsWith('@vesk/runtime/')) return stmt;
  return stmt.slice(0, q1 + 1) + '@vesk/runtime' + stmt.slice(q2);
}

function idxOfQuote(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') return i;
  }
  return -1;
}

export function generateIR(ast: any, source: string, filename?: string): IRRoot {
  __vskAnnotations = (ast as { __vskAnnotations?: VeskAnnotation[] }).__vskAnnotations ?? [];
  __slotProps = null;
  const file = filename || '';
  const components: ComponentIR[] = [];
  const imports: string[] = [];
  const importedNames = new Set<string>();
  let staticProps: string | null = null;
  let loadFn: string | null = null;
  const topLevelCode: string[] = [];

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const raw = getSource(source, node);
      let cleaned = stripTypeImport(raw);
      if (cleaned === null) continue;
      cleaned = normalizeRuntimeSpecifier(cleaned);
      imports.push(cleaned);
      for (const spec of node.specifiers) {
        if (spec.importKind === 'type') continue;
        if (spec.type === 'ImportSpecifier') {
          importedNames.add(spec.local.name);
        }
      }
      continue;
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration && !staticProps) {
      const decl = node.declaration;
      const fnName = decl.type === 'FunctionDeclaration'
        ? decl.id?.name
        : decl.type === 'VariableDeclaration'
          ? decl.declarations[0]?.id?.name
          : null;
      if (fnName === 'getStaticProps') {
        staticProps = stripCodeTypes(getSource(source, decl));
        continue;
      }
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration && !loadFn) {
      const decl = node.declaration;
      const fnName = decl.type === 'FunctionDeclaration'
        ? decl.id?.name
        : decl.type === 'VariableDeclaration'
          ? decl.declarations[0]?.id?.name
          : null;
      if (fnName === 'load') {
        loadFn = stripCodeTypes(getSource(source, decl));
        continue;
      }
    }

    // `export const standalone = true` / `export let standalone = true` is a
    // compile-time routing directive (isStandaloneLayoutFile), not runtime
    // code — drop it so it never reaches emitted JS (client chunks are
    // IIFE-wrapped where a bare `export` is a syntax error).
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'VariableDeclaration') {
        const declName = decl.declarations[0]?.id?.name;
        if (declName === 'standalone') {
          continue;
        }
      }
    }

    let inner = node;
    let exported = false;
    let defaultExport = false;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      inner = node.declaration;
      exported = true;
    } else if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      inner = node.declaration;
      exported = true;
      defaultExport = true;
    }

    if (inner.type === 'ComponentDeclaration') {
      // handled below
    } else if (inner.type === 'ClassDeclaration') {
      const { line, column } = offsetToLineCol(source, (inner as unknown as { start: number }).start ?? 0);
      throw VeskError.classDecl({ file, line, column, code: codeFrame(source, line, column) });
    } else if (inner.type === 'TSEnumDeclaration') {
      const code = processEnum(inner, source, exported);
      topLevelCode.push(code);
      continue;
    } else {
      topLevelCode.push(getSource(source, node));
      continue;
    }

    const name = inner.id.name;
    const paramNames = getParamNames(inner.params, source);
    // A plain-identifier first parameter receives the whole props object under
    // its own name (React-style); a destructuring pattern receives the fields.
    const firstParam = inner.params?.[0];
    const propsAlias = firstParam && firstParam.type === 'Identifier' ? firstParam.name : null;
    const propsType = getPropsType(inner.params, source);
    const bodyStmts = inner.body.body;
    const isClientComp = !!inner.client;

    // Slot props are declared at the component boundary (`trigger: Component`),
    // so content reads of `props.<name>` compile to slot renders instead of
    // value bindings for THIS component only.
    const prevSlotProps: Set<string> | null = __slotProps;
    __slotProps = slotPropNamesFromType(propsType);
    __propsParam = propsAlias || null;

    if (isStatementMode(bodyStmts)) {
      const raw = processStatementModeBody(source, bodyStmts, file);
      const { body, css } = extractStyle(raw);
      validateBlocks(name, isClientComp, body, file, source);
      const comp = new ComponentIR(name, paramNames, body, { mode: 'statement', exported, defaultExport, isClient: inner.client, isAsync: inner.async, ssrAwait: componentUsesFetch(body), propsType, propsAlias });
      comp.style = css;
      components.push(comp);
      __slotProps = prevSlotProps;
    } else {
      const guardClauses: any[] = [];
      let mainReturn: any = null;
      const preamble: IRNode[] = [];

      for (const stmt of bodyStmts) {
        if (stmt.type === 'VeskBlock') {
          const innerBody = processStatementModeBody(source, stmt.body, file);
          if (stmt.tag === 'server') {
            preamble.push(new ServerBlock(innerBody));
          } else if (stmt.tag === 'client') {
            preamble.push(new ClientBlock(innerBody));
          }
        } else if (stmt.type === 'ReturnStatement') {
          mainReturn = stmt;
        } else if (isTrackDeclaration(stmt)) {
          const elements = stmt.declarations[0].id.elements;
          const trackName = elements[0]?.name;
          const rawName = elements.length > 1 ? elements[1]?.name : null;
          const init = getSource(source, stmt.declarations[0].init);
          if (trackName) preamble.push(new TrackDecl(trackName, init, rawName));
          const refName = getComponentRefName(stmt);
          if (refName) preamble.push(new ComponentRef(refName));
        } else if (stmt.type === 'IfStatement' && !mainReturn && stmt.consequent.type !== 'ThrowStatement') {
          guardClauses.push(stmt);
        } else if (stmt.type === 'ClassDeclaration') {
          const { line, column } = offsetToLineCol(source, (stmt as unknown as { start: number }).start ?? 0);
          throw VeskError.classDecl({ file, line, column, code: codeFrame(source, line, column) });
        } else {
          const raw = getSource(source, stmt);
          if (raw) preamble.push(new RuntimeStatement(raw, stmt, source));
        }
      }

      const guardBody = buildGuardChain(source, guardClauses, mainReturn);
      const { body, css } = extractStyle([...preamble, ...guardBody]);
      validateBlocks(name, isClientComp, body, file, source);
      const comp = new ComponentIR(name, paramNames, body, { exported, defaultExport, isClient: inner.client, isAsync: inner.async, ssrAwait: componentUsesFetch(body), propsType, propsAlias });
      comp.style = css;
      components.push(comp);
      __slotProps = prevSlotProps;
    }
  }

  const asyncNames = new Set(components.filter((c) => c.isAsync || c.ssrAwait).map((c) => c.name));
  for (const comp of components) {
    if (asyncNames.has(comp.name)) continue;
    const called = new Map<string, number>();
    collectComponentCalls(comp.body, called);
    for (const [childName, start] of called) {
      if (!asyncNames.has(childName)) continue;
      const { line, column } = offsetToLineCol(source, start >= 0 ? start : 0);
      throw VeskError.asyncChildInSyncParent(comp.name, childName, { file, line, column, code: codeFrame(source, line, column) });
    }
  }

  const autoImportable = [
    'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams', 'useNavigate',
    'defineAction',
    'Form', 'Field', 'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom',
    'Link', 'NavLink', 'Outlet', 'Redirect',
    'Image', 'Portal',
    'Experiment',
    'LoadingIndicator', 'useLoadingIndicator',
    'JsonLd', 'ArticleSchema', 'ProductSchema', 'FAQPageSchema', 'BreadcrumbListSchema',
    'OrganizationSchema', 'LocalBusinessSchema', 'VideoSchema',
    'effect', 'derived', 'untrack', 'peek', 'tick', 'flushSync', 'on_destroy',
    'createContext',
    'redirect', 'permanentRedirect', 'notFound', 'NotFoundError',
    'createResource', 'getAction', 'validateActionInput', 'issuesToFieldMap', 'isFormAction',
    'Show', 'For', 'Switch', 'Match',
  ];
  // One walk of the already-parsed tree finds every auto-importable call
  // target and JSX element name. Every IR raw the old per-fragment scan
  // re-tokenized ("addUsedFrom" over ~15 text slices) is a subtree of this
  // very same `ast` — nothing is lost, but the acorn tokenizer is invoked once
  // per file instead of once per fragment.
  const called = collectCallAndJsxTargets(ast);
  const usedFunctions = new Set<string>();
  for (const fn of autoImportable) {
    if (called.has(fn)) usedFunctions.add(fn);
  }

  if (usedFunctions.size > 0) {
    const existing = new Set<string>();
    for (const imp of imports) {
      if (importModuleTarget(imp) !== '@vesk/runtime') continue;
      for (const n of extractImportNames(imp)) existing.add(n);
    }
    // A name already bound by the file's own imports (any target — including a
    // local module with the same export) wins; never auto-import a duplicate
    // binding. Mirrors client shadowing so SSR and client agree.
    const boundLocally = new Set<string>();
    for (const imp of imports) {
      for (const pair of importBindingPairs(imp)) boundLocally.add(pair.local);
    }
    const missing = [...usedFunctions].filter(f => !existing.has(f) && !boundLocally.has(f));
    if (missing.length > 0) {
      imports.push(`import { ${missing.join(', ')} } from '@vesk/runtime';`);
    }
  }

  return new IRRoot(components, imports, importedNames, staticProps, loadFn, topLevelCode);
}