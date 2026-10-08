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

/** Root identifier of a dotted JSX tag: `NS.Icon` -> `NS`. */
function jsxTagRootName(nameNode: any): string {
  let node = nameNode;
  while (node && node.type === 'JSXMemberExpression') node = node.object;
  return node && node.type === 'JSXIdentifier' ? node.name! : '';
}

/** The final property of a dotted JSX tag: `NS.A.B` → `B`. */
function jsxTagMemberName(nameNode: any): string {
  let node = nameNode;
  while (node && node.type === 'JSXMemberExpression') {
    node = node.property;
    if (node && node.type === 'JSXIdentifier') return node.name!;
  }
  return '';
}

/** How many member hops a dotted tag has: `NS.A` → 1, `NS.A.B` → 2. */
function jsxTagDepth(nameNode: any): number {
  let depth = 0;
  let node = nameNode;
  while (node && node.type === 'JSXMemberExpression') {
    depth++;
    node = node.object;
  }
  return depth;
}

// Set for the duration of one `generateIR` call so `processJSXElement` — which
// is reached from eleven call sites and would otherwise need a context
// parameter threaded through all of them — can reject `<ns.Tag />` for a
// `import * as ns from './x.vsk'`.
let currentVskNamespaceLocals: Set<string> | null = null;
let currentSourceFile: string | undefined;

/**
 * Names bound to a component VALUE in the component's OWN body (a parameter or
 * a `const`/`let`/`var`/function declared inside it) that a JSX tag may
 * legally resolve to.
 *
 * A JSX tag was historically registry-only: `<Icon />` looked the name up in
 * the component registry and threw "was not found" when it missed, even though
 * `const Icon = item.icon` had bound a perfectly good component value one line
 * above. That made the single most natural way to write a dynamic-icon nav
 * list (`const Icon = item.icon; <li><Icon size={14} /></li>`) a 500 for the
 * WHOLE route — and the error text ("declare it with the `component` keyword")
 * named the one thing the author had already done correctly.
 *
 * Such a name is emitted with a `calleeExpr`, routing it through the SAME code
 * path that already works for `<it.icon />` — the callee is invoked directly
 * instead of resolved as a name.
 *
 * Deliberately EXCLUDES imported names and top-level file values: those
 * already resolve through the `importedNames` path in both codegens, and
 * giving them a callee there would take self-claiming runtime components
 * (`Link`, `Form`, `Md`) off the path that reserves the caller's walker
 * correctly. Registry resolution also keeps precedence: a name that is a
 * declared `component` still wins.
 */
let currentComponentValues: Set<string> | null = null;

/** File-wide name sets backing `isComponentValueName`. */
let currentFileComponentNames: Set<string> | null = null;
let currentFileValueBindings: Set<string> | null = null;
let currentImportedNames: Set<string> | null = null;

/**
 * Module-scope helpers whose body IS a component call — the module-scope
 * equivalent of the previous problem:
 *
 *   const renderIcon = (n: number) => Terminal({ size: n });
 *   <div>{renderIcon(14)}</div>
 *
 * The callee here is the helper, not the component, so resolving names finds
 * nothing to fix. Inlining it is exact and lossless in the one shape that is
 * unambiguously a component render: a helper whose ENTIRE body is a single
 * component-call-shaped expression, with plain identifier parameters. The
 * argument is substituted into the props object by identifier match, so no
 * general (and unsound) alpha-renaming is needed.
 *
 * Anything more complicated — a helper with statements, a component call whose
 * props reference the parameter several times, a non-identifier argument — is
 * deliberately NOT inlined. It stays an ordinary call, which is the historical
 * (and correct for non-component helpers) behavior.
 */
interface ComponentCallHelper {
  /** Props of the component call the helper returns. */
  props: Array<{ name: string; value: any }>;
  spreadProps: any[];
  slots: Array<{ name: string; nodes: IRNode[] }>;
  /** Helper parameter names, in declaration order. */
  paramNames: string[];
  /** The component the helper body invokes. */
  componentName: string;
}

let currentComponentCallHelpers: Map<string, ComponentCallHelper> | null = null;

/** A helper body expression that is exactly one component call, or null. */
function unwrapHelperBody(node: any): any | null {
  let body = node;
  if (body?.type === 'ArrowFunctionExpression' || body?.type === 'FunctionExpression') body = body.body;
  if (body?.type === 'BlockStatement') {
    const stmts = (body.body || []).filter((s: any) => s.type !== 'EmptyStatement');
    if (stmts.length !== 1) return null;
    body = stmts[0];
  }
  if (body?.type === 'ReturnStatement') body = body.argument;
  if (!body) return null;
  // Shape check only — deliberately NOT `componentCallInExpression`, which
  // consults the per-component name sets. Helpers are collected once for the
  // whole file, before any component's sets are installed, and whether a
  // callee resolves to a component is settled at the call site instead.
  if (body.type !== 'CallExpression') return null;
  if (body.callee?.type !== 'Identifier') return null;
  const args = body.arguments || [];
  if (args.length === 0 || args[0]?.type !== 'ObjectExpression') return null;
  return body;
}

/**
 * Local names bound by `import * as ns from './x.vsk'` that are NOT shadowed by
 * any other binding in the file. A `.vsk` namespace is only special when the
 * name still refers to the import: if a parameter or a local shadows it, the
 * tag is an ordinary member expression on a real object and must keep the
 * `calleeExpr` path. Names the file re-binds are therefore dropped here, which
 * also keeps the value-position check from rejecting valid shadowed code.
 */
function collectVskNamespaceLocals(ast: any): Set<string> {
  const namespaceLocals = new Map<string, { path: string; shadowed: boolean }>();
  for (const node of (ast.body || []) as any[]) {
    if (node.type !== 'ImportDeclaration') continue;
    if (typeof node.source?.value !== 'string' || !node.source.value.endsWith('.vsk')) continue;
    for (const spec of node.specifiers || []) {
      if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.name) {
        namespaceLocals.set(spec.local.name, { path: node.source.value, shadowed: false });
      }
    }
  }
  if (namespaceLocals.size === 0) return new Set();
  markShadowedBindings(ast, namespaceLocals);
  return new Set([...namespaceLocals].filter(([, v]) => !v.shadowed).map(([k]) => k));
}

/**
 * Flags every namespace local that the file also binds by some other means.
 * The namespace import itself is the only declaration that does NOT shadow —
 * everything else (var/let/const, function and class declarations, any
 * parameter list, catch bindings) means the name is a plain local from here on.
 */
function markShadowedBindings(node: any, namespaceLocals: Map<string, { path: string; shadowed: boolean }>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) markShadowedBindings(child, namespaceLocals);
    return;
  }
  if (typeof node.type === 'string') {
    if (node.type === 'ImportNamespaceSpecifier') return; // the import itself
    for (const name of declaredBindingNames(node)) {
      const entry = namespaceLocals.get(name);
      if (entry) entry.shadowed = true;
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    markShadowedBindings(node[key], namespaceLocals);
  }
}

/** Names a single binding-bearing node introduces. */
/**
 * Every top-level VALUE binding in the file (excluding `component`
 * declarations — those are registry entries, not values, and resolve by name).
 * Pre-scanned rather than read out of `topLevelCode`, which fills in as the
 * top-level loop runs and would therefore miss a binding declared after the
 * component currently being compiled.
 */
function collectFileValueBindings(ast: any): Set<string> {
  const names = new Set<string>();
  for (const node of (ast.body || []) as any[]) {
    if (node.type === 'ComponentDeclaration') continue;
    if (node.type === 'ImportDeclaration') continue;
    const target = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? node.declaration
      : node;
    if (!target) continue;
    if (target.type === 'VariableDeclaration') {
      for (const d of target.declarations || []) for (const n of declaredBindingNames(d)) names.add(n);
      continue;
    }
    for (const n of declaredBindingNames(target)) names.add(n);
  }
  return names;
}

/**
 * Every value binding a tag inside one component body could resolve to —
 * the component's own parameters and body-local declarations only.
 */
function collectComponentValueNames(compNode: any): Set<string> {
  const names = new Set<string>();
  if (!compNode) return names;
  for (const p of compNode.params || []) for (const n of declaredBindingNames(p)) names.add(n);
  for (const stmt of (compNode.body?.body || []) as any[]) {
    // A body statement is the DECLARATION (`const Icon = …`), and
    // `declaredBindingNames` reads declarators, so unwrap first.
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations || []) for (const n of declaredBindingNames(d)) names.add(n);
      continue;
    }
    for (const n of declaredBindingNames(stmt)) names.add(n);
  }
  return names;
}

function declaredBindingNames(node: any): string[] {
  const out: string[] = [];
  const pushPattern = (id: any): void => {
    if (!id) return;
    if (id.type === 'Identifier') { out.push(id.name); return; }
    if (id.type === 'ObjectPattern') {
      for (const prop of id.properties || []) {
        if (prop.type === 'RestElement') pushPattern(prop.argument);
        else pushPattern(prop.value);
      }
      return;
    }
    if (id.type === 'ArrayPattern') {
      for (const el of id.elements || []) if (el) pushPattern(el.type === 'RestElement' ? el.argument : el);
      return;
    }
    if (id.type === 'AssignmentPattern') pushPattern(id.left);
    if (id.type === 'RestElement') pushPattern(id.argument);
  };
  switch (node.type) {
    case 'VariableDeclarator':
      pushPattern(node.id);
      break;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      if (node.id) pushPattern(node.id);
      for (const param of node.params || []) pushPattern(param);
      break;
    case 'ClassDeclaration':
    case 'ClassExpression':
      if (node.id) pushPattern(node.id);
      break;
    case 'CatchClause':
      pushPattern(node.param);
      break;
    default:
      break;
  }
  return out;
}

/**
 * Rejects reading a member off a `.vsk` namespace in *value* position. A
 * namespace is resolved only for component tags, so `ns.max` in an expression
 * has nothing bound to it at runtime — say so here instead of failing later
 * with a bare `ReferenceError: ns is not defined`.
 */
function assertNoVskNamespaceValue(source: string, expr: { start?: number } | null | undefined): void {
  if (!currentVskNamespaceLocals || currentVskNamespaceLocals.size === 0) return;
  const hit = findNamespaceValueUse(expr, currentVskNamespaceLocals);
  if (!hit) return;
  const { line, column } = offsetToLineCol(source, hit.start ?? 0);
  throw VeskError.vskNamespaceMember({ file: currentSourceFile, line, column, code: codeFrame(source, line, column), form: 'value' });
}

function findNamespaceValueUse(node: any, locals: Set<string>): any | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNamespaceValueUse(child, locals);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node.type !== 'string') return null;
  if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && locals.has(node.object.name)) return node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const hit = findNamespaceValueUse(node[key], locals);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build the helper table from the file's top-level const/function bindings.
 * Only single-expression component-call bodies with plain identifier params
 * are recorded — see `ComponentCallHelper` for why the rest are excluded.
 */
function collectComponentCallHelpers(source: string, ast: any): Map<string, ComponentCallHelper> {
  const out = new Map<string, ComponentCallHelper>();
  for (const node of (ast.body || []) as any[]) {
    const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? node.declaration
      : node;
    if (!decl) continue;
    let name: string | null = null;
    let fn: any = null;
    if (decl.type === 'VariableDeclaration' && decl.declarations?.length === 1) {
      const d = decl.declarations[0];
      if (d.id?.type === 'Identifier') { name = d.id.name; fn = d.init; }
    } else if (decl.type === 'FunctionDeclaration' && decl.id?.name) {
      name = decl.id.name;
      fn = decl;
    }
    if (!name || !fn) continue;
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression' && fn.type !== 'FunctionDeclaration') continue;
    // A rest/default/destructured parameter cannot be substituted by a simple
    // identifier match, so such helpers are left as ordinary calls.
    const params = fn.params || [];
    if (params.some((p: any) => p.type !== 'Identifier')) continue;
    const body = unwrapHelperBody(fn);
    if (body === null) continue;
    const args = body.arguments || [];
    const propsObj = args[0];
    const props: Array<{ name: string; value: any }> = [];
    const spreadProps: any[] = [];
    const slots: Array<{ name: string; nodes: IRNode[] }> = [];
    for (const prop of (propsObj.properties || []) as any[]) {
      if (prop.type === 'SpreadElement') { spreadProps.push(prop.argument); continue; }
      const pname = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
      if (prop.value.type === 'JSXElement' || prop.value.type === 'JSXFragment') {
        slots.push({ name: pname, nodes: exprToIR(source, prop.value) });
        continue;
      }
      props.push({ name: pname, value: prop.value });
    }
    const paramNames: string[] = params.map((p: any) => p.name as string);
    out.set(name, { props, spreadProps, slots, paramNames, componentName: body.callee.name });
  }
  return out;
}

/**
 * Replace every identifier in `node` that matches a helper parameter with the
 * argument passed at the call site. Identifier-only and AST-level (the compiler
 * never rewrites source by pattern), and it returns null if the tree holds
 * anything it cannot prove is a value — e.g. a nested function that closes over
 * the parameter, where substituting would change what runs.
 */
function substituteHelperParams(node: any, bindings: Map<string, any>): any | null {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    const out: any[] = [];
    for (const child of node) {
      const next = substituteHelperParams(child, bindings);
      if (next === null) return null;
      out.push(next);
    }
    return out;
  }
  if (typeof node.type !== 'string') return node;
  // A nested function body runs later and may capture the parameter; leave the
  // whole helper alone rather than risk changing its meaning.
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return null;
  if (node.type === 'Identifier' && bindings.has(node.name)) {
    const bound = bindings.get(node.name);
    return bound === null ? null : bound;
  }
  const out: Record<string, any> = {};
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
      out[key] = node[key];
      continue;
    }
    const next = substituteHelperParams(node[key], bindings);
    if (next === null) return null;
    out[key] = next;
  }
  return out;
}

/** Lower a call to a `ComponentCallHelper` into a real `ComponentCall`. */
function helperCallToIR(source: string, helper: ComponentCallHelper, args: any[]): IRNode[] | null {
  // The rendered component is the one INSIDE the helper, not the helper itself.
  const compName = helper.componentName;
  // First argument is the props object INSIDE the helper; the caller's
  // arguments fill the helper's parameters from index 0.
  const bindings = new Map<string, any>();
  helper.paramNames.forEach((param, i) => bindings.set(param, args[i] ?? null));
  for (const bound of bindings.values()) if (bound === null) return null;
  const props: { name: string; value: Expression }[] = [];
  for (const p of helper.props) {
    const substituted = substituteHelperParams(p.value, bindings);
    if (substituted === null) return null;
    props.push({ name: p.name, value: toExpression(source, substituted) });
  }
  const spreadProps: Expression[] = [];
  for (const sp of helper.spreadProps) {
    const substituted = substituteHelperParams(sp, bindings);
    if (substituted === null) return null;
    spreadProps.push(toExpression(source, substituted));
  }
  return [new ComponentCall(compName, props, helper.slots.flatMap((s) => [new PropSlot(s.name, s.nodes)]), spreadProps, -1, componentValueCallee(compName))];
}

function isHTMLTag(name: string): boolean {
  return name.length > 0 && name[0] === name[0].toLowerCase();
}

/**
 * The `calleeExpr` for a bare-identifier JSX tag, or null when the name must
 * resolve through the component registry.
 *
 * Null is the default and the reason every existing tag is untouched: only a
 * name bound to a value in this component's scope gets a callee, so
 * `component Icon {}` / imported components keep registry semantics (with
 * their "not found" diagnostic), while `const Icon = item.icon` — which used to
 * throw and take the whole route down with it — resolves to the value it is.
 */
function componentValueCallee(tagName: string): string | null {
  if (!currentComponentValues || !currentComponentValues.has(tagName)) return null;
  return tagName;
}

/**
 * A component invoked as a function in expression position, or null.
 *
 * The callee must be a plain identifier that names a component — an import, a
 * top-level file value, a body-local binding, or a declared `component` — and
 * the first argument an object literal, the shape `Terminal({ size: 14 })` has.
 *
 * This is a WIDER name test than `componentValueCallee`, and deliberately so:
 * a tag only needs a callee for names nothing else can resolve, but a CALL has
 * no other lowering at all. The first argument must be an object literal
 * because that is what distinguishes a component invocation from an ordinary
 * call on a same-named helper, and the callee must be a known component name
 * for the same reason — `doThing(x)` on a local helper stays an ordinary call.
 */
function componentCallInExpression(expr: any): any | null {
  if (!expr || expr.type !== 'CallExpression') return null;
  const callee = expr.callee;
  if (!callee || callee.type !== 'Identifier') return null;
  if (!isComponentValueName(callee.name)) return null;
  const args = expr.arguments || [];
  if (args.length === 0 || !args[0] || args[0].type !== 'ObjectExpression') return null;
  return expr;
}

/**
 * Every name in the file that denotes a component: declared `component`s,
 * imports, top-level file values, and the current component's body-local
 * bindings. Used only to recognize a component call — never to give a tag a
 * callee (that is `componentValueCallee`'s narrower job).
 */
function isComponentValueName(name: string): boolean {
  if (currentFileComponentNames?.has(name)) return true;
  if (currentComponentValues?.has(name)) return true;
  return currentFileValueBindings?.has(name) || currentImportedNames?.has(name) || false;
}

/**
 * Lower `Comp({ a: 1, ...rest })` to a `ComponentCall`. Props/spreads map
 * straight onto the component-call channels; a slot-shaped value (`children`)
 * is routed through `PropSlot` so named content keeps working when a component
 * is invoked as a function rather than used as a tag.
 */
function componentCallToIR(source: string, expr: any): IRNode[] {
  const calleeName = (expr.callee as { name: string }).name;
  const args = expr.arguments || [];
  const propsArg = args[0];
  const props: { name: string; value: Expression }[] = [];
  const spreadProps: Expression[] = [];
  const slots: PropSlot[] = [];
  for (const prop of (propsArg.properties || []) as any[]) {
    if (prop.type === 'SpreadElement') {
      spreadProps.push(toExpression(source, prop.argument));
      continue;
    }
    const name = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    if (prop.value.type === 'JSXElement' || prop.value.type === 'JSXFragment') {
      slots.push(new PropSlot(name, exprToIR(source, prop.value)));
      continue;
    }
    props.push({ name, value: toExpression(source, prop.value) });
  }
  // Extra positional arguments are the component ABI (`props`, registry,
  // walker) that only the compiler emits; a caller's own extra args are not
  // something to forward, and silently dropping them would hide a mistake.
  const children = args.length > 1
    ? [new RuntimeStatement(`/* [vesk] extra arguments to a component call are ignored */ ${getSource(source, args[1])}`)]
    : [];
  return [new ComponentCall(
    calleeName,
    props,
    [...children, ...slots],
    spreadProps,
    expr.start ?? -1,
    componentValueCallee(calleeName),
  )];
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
  assertNoVskNamespaceValue(source, expr);
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

      // Routed through exprToIR so a component invoked as a function (and a
      // module-scope helper returning one) becomes a real component render
      // rather than text that gets escaped into visible markup.
      result.push(...exprToIR(source, expr));
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
  // A component INVOKED as a function in expression position
  // (`{Terminal({ size: 14 })}`, or any branch of a ternary/`&&`) used to
  // degrade to a text binding, and the server escaped the component's HTML
  // string into visible page text — the worst failure mode of the three,
  // because it looks like content. `{cond ? Terminal({ size: 14 }) : null}`
  // was worse still: the escaped markup rendered as nothing at all, so a
  // missing icon shipped silently.
  //
  // A component's return value is markup, not text, so the call must be a real
  // component render. It is lowered to the SAME `ComponentCall` node a `<Tag />`
  // would produce, which means it inherits the hydration marker, the claim
  // path, and the fragment flattening that the tag form already relies on —
  // rather than needing a second, parallel implementation.
  if (componentCallInExpression(expr) !== null) return componentCallToIR(source, expr);
  // A module-scope helper that just returns a component call is the same
  // component render one level removed — inline it (see
  // `ComponentCallHelper`) rather than let its HTML be escaped into the page.
  if (expr?.type === 'CallExpression' && currentComponentCallHelpers?.has((expr.callee as any)?.name)) {
    const helper = currentComponentCallHelpers.get((expr.callee as any).name)!;
    const inlined = helperCallToIR(source, helper, expr.arguments || []);
    if (inlined !== null) return inlined;
  }
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
    const root = jsxTagRootName(nameNode);
    const isVskNamespace = !!currentVskNamespaceLocals && currentVskNamespaceLocals.has(root);
    if (isVskNamespace && jsxTagDepth(nameNode) > 1) {
      // A `.vsk` module's exports are flat component names, so there is no
      // nested namespace object to walk into.
      const { line, column } = offsetToLineCol(source, (nameNode as unknown as { start: number }).start ?? 0);
      throw VeskError.vskNamespaceMember({ file: currentSourceFile, line, column, code: codeFrame(source, line, column), form: 'nested' });
    }
    const { props, spreadProps, slots } = extractProps(source, element);
    const children = selfClosing ? [] : processJSXChildren(source, element.children || []);
    if (isVskNamespace) {
      // `<ns.Icon />` after `import * as ns from './lib.vsk'` resolves to the
      // same registry entry `import { Icon }` would, keyed by the EXPORTED name.
      // Deliberately carries no `calleeExpr`: both codegen paths must take the
      // registry branch so `<ns.Icon />` keeps the "component was not found"
      // guard and hydrates like any other compiled component. The namespace
      // object itself is never built.
      return [new ComponentCall(jsxTagMemberName(nameNode), props, [...children, ...slots.map((s) => new PropSlot(s.name, s.nodes))], spreadProps, element.start)];
    }
    return [new ComponentCall(tagName, props, [...children, ...slots.map((s) => new PropSlot(s.name, s.nodes))], spreadProps, element.start, getSource(source, nameNode))];
  }

  if (!isHTMLTag(tagName) && selfClosing) {
    const { props, spreadProps, slots } = extractProps(source, element);
    return [new ComponentCall(tagName, props, slots.map((s) => new PropSlot(s.name, s.nodes)), spreadProps, element.start, componentValueCallee(tagName))];
  }

  if (!isHTMLTag(tagName)) {
    const { props, spreadProps, slots } = extractProps(source, element);
    const children = processJSXChildren(source, element.children || []);
    return [new ComponentCall(tagName, props, [...children, ...slots.map((s) => new PropSlot(s.name, s.nodes))], spreadProps, element.start, componentValueCallee(tagName))];
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
          (opts as { frame: string }).frame = codeFrame(source, line, column);
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
          (opts as { frame: string }).frame = codeFrame(source, line, column);
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

/**
 * Warn when a body-level `const` that READS a tracked value is then used in a
 * reactive binding.
 *
 * A body-level `const x = <expr>` is evaluated ONCE per render. When `<expr>`
 * reads a cell, the binding captures a snapshot, so any later re-evaluation of
 * that binding re-reads the SAME stale value and the UI silently stops
 * updating — the effect runs, the class/attribute effect runs, and nothing
 * changes. This has bitten real code twice in one app:
 *
 *   const isSelected = selectedProgram.id === prog.id;   // never re-evaluates
 *   class={`... ${isSelected ? 'a' : 'b'}`}              // stuck on 'b'
 *
 * The framework cannot fix this silently — hoisting is legitimate when the
 * value really is constant, and auto-inlining every such const would change
 * semantics. So it is reported at build time, naming the binding and the
 * tracked value it snapshotted.
 *
 * AST-only (no regex over source), and gated so a component with no such const
 * costs nothing: the binding scan only runs when a stale candidate exists.
 */
function warnStaleConstBindings(comp: ComponentIR, file: string): void {
  // Pass 1: every tracked/derived name, at ANY depth.
  const reactive = new Set<string>();
  const eachNode = (nodes: IRNode[], fn: (n: IRNode) => void): void => {
    for (const n of nodes) {
      fn(n);
      if (n instanceof ComponentCall) eachNode(n.children, fn);
      if (n instanceof OpaqueDynamicRegion) { eachNode(n.consequentNodes, fn); eachNode(n.alternateNodes, fn); }
      if (n instanceof MapRegion) eachNode(n.bodyTemplate, fn);
      if (n instanceof ForLoop) eachNode(n.bodyTemplate, fn);
      if (n instanceof WhileLoop) eachNode(n.bodyTemplate, fn);
      if (n instanceof SwitchBlock) for (const c of n.cases) eachNode(c.body, fn);
      if (n instanceof TryCatch) { eachNode(n.bodyTemplate, fn); eachNode(n.catchBody, fn); }
      if (n instanceof StaticNode) eachNode(n.children, fn);
    }
  };
  eachNode(comp.body, (n) => {
    if (!(n instanceof TrackDecl)) return;
    reactive.add(n.name);
    if (n.rawName) reactive.add(n.rawName);
  });
  if (reactive.size === 0) return;

  // Pass 2: any `const X = <expr>` (at any depth) whose expr reads a tracked value.
  // Skips aliases of the cell itself (`const &[v, c] = track()` then `const v2 = v`
  // is still a snapshot, but `const c2 = c` is not) and anything named like a cell.
  const stale = new Map<string, string>();
  eachNode(comp.body, (n) => {
    if (!(n instanceof RuntimeStatement)) return;
    const st: any = (n as unknown as { ast: any }).ast;
    if (st?.type !== 'VariableDeclaration') return;
    for (const d of st.declarations || []) {
      if (d.id?.type !== 'Identifier' || !d.init) continue;
      if (reactive.has(d.id.name)) continue;
      // A bare identifier initializer is an ALIAS, not a read: `const copy =
      // selCell` re-binds the cell and stays live. Only a read snapshots.
      if (d.init.type === 'Identifier' && reactive.has(d.init.name)) continue;
      const seen = new Set<string>();
      collectIdentifiers(d.init, seen);
      for (const name of seen) {
        if (!reactive.has(name)) continue;
        stale.set(d.id.name, name);
        break;
      }
    }
  });
  if (stale.size === 0) return;

  // Pass 3: report only when such a name reaches a REACTIVE BINDING. Event
  // handler attributes are deliberately excluded: `onClick={handler}` where the
  // handler reads a cell is correct — the read happens when the handler runs,
  // and the binding is not expected to re-run.
  const reported = new Set<string>();
  const report = (name: string): void => {
    if (reported.has(name)) return;
    const src = stale.get(name);
    if (!src) return;
    reported.add(name);
    console.warn(
      `[vesk] ${comp.name}: \`const ${name} = ...\` is computed once and reads the tracked value ` +
        `\`${src}\`, so bindings that use \`${name}\` never update. ` +
        `Inline the expression in the binding, or wrap the value in derived().`
    );
  };
  const isEventAttr = (target: string | null): boolean => !!target && /^on./.test(target);
  eachNode(comp.body, (n) => {
    if (n instanceof DynamicBinding) {
      if (!isEventAttr(n.target)) {
        const seen = new Set<string>();
        collectIdentifiers(n.expression.ast, seen);
        for (const name of seen) if (stale.has(name)) report(name);
      }
      return;
    }
    if (n instanceof ComponentCall) {
      for (const pr of n.props) {
        const seen = new Set<string>();
        collectIdentifiers(pr.value.ast, seen);
        for (const name of seen) if (stale.has(name)) report(name);
      }
    }
  });
}

/** Every identifier name appearing anywhere in an expression (AST walk). */
function collectIdentifiers(node: any, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectIdentifiers(child, into);
    return;
  }
  if (typeof node.type !== 'string') return;
  if (node.type === 'Identifier' && typeof node.name === 'string') into.add(node.name);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    collectIdentifiers(node[key], into);
  }
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
  // `export const metadata = defineMetadata({...})` — the SOURCE of the
  // expression, captured like `load`/`getStaticProps`. It is evaluated in a
  // sandbox with nothing in scope but `defineMetadata`, so a static head can
  // never depend on the component's frame evaluating correctly (the class of
  // bug the `<Head>` interpolation path is prone to) and can never be
  // non-deterministic.
  let metadataSource: string | null = null;
  const topLevelCode: string[] = [];
  const exportAliases: Array<{ local: string; exported: string }> = [];
  const reexportSources: string[] = [];

  // `export { A }` / `export { A as B }` are stripped by the parser (acorn
  // rejects a module export that names no top-level binding, and a `.vsk`
  // component is a registry entry, not a binding). The pairs ride along on the
  // AST and become registry aliases below.
  for (const pair of ((ast as unknown as { __vskSpecifierExports?: Array<{ local: string; exported: string }> })
    .__vskSpecifierExports) || []) {
    exportAliases.push({ local: pair.local, exported: pair.exported });
  }

  // `import * as ns from './x.vsk'` has no runtime binding: a `.vsk` component
  // is a registry entry, not a module namespace object. Pre-scan the import
  // declarations so a `<ns.Tag />` can be reported clearly instead of failing
  // later as an opaque "ns is not defined".
  const vskNamespaceLocals = collectVskNamespaceLocals(ast);
  const prevNamespaceLocals = currentVskNamespaceLocals;
  const prevSourceFile = currentSourceFile;
  // Pre-scan the two name sets the per-component value resolution needs, so
  // order in the file does not matter.
  const fileValueBindings = collectFileValueBindings(ast);
  currentComponentCallHelpers = collectComponentCallHelpers(source, ast);
  const prevFileComponentNames = currentFileComponentNames;
  const prevFileValueBindings = currentFileValueBindings;
  const prevImportedNames = currentImportedNames;
  const fileComponentNames = new Set<string>(
    ((ast.body || []) as any[])
      .map((n) => (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration' ? n.declaration : n))
      .filter((n) => n?.type === 'ComponentDeclaration')
      .map((n) => n.id.name as string),
  );
  currentFileComponentNames = fileComponentNames;
  currentFileValueBindings = fileValueBindings;
  currentImportedNames = importedNames;
  currentVskNamespaceLocals = vskNamespaceLocals;
  currentSourceFile = file;
  try {
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

    if (node.type === 'ExportNamedDeclaration' && node.declaration && !metadataSource) {
      const decl = node.declaration;
      const first = decl.type === 'VariableDeclaration' ? decl.declarations[0] : null;
      if (first?.id?.name === 'metadata') {
        // The INITIALIZER, not the declaration: the sandbox evaluates this as
        // an expression (`return ( … )`), so a `const metadata = …` wrapper
        // would be a syntax error.
        metadataSource = first.init ? stripCodeTypes(getSource(source, first.init)) : null;
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

    if (node.type === 'ExportNamedDeclaration' && !node.declaration) {
      // A specifier-only export (`export { A }`, `export { A as B }`) or a
      // re-export (`export { A } from './x.vsk'`, `export { default as A } from …`).
      // Never emit the raw statement: components are registry entries, not
      // top-level bindings, so emitting it yields `Export 'A' is not defined`.
      if (node.source) {
        if (typeof node.source.value === 'string') reexportSources.push(node.source.value);
        // `export { A as B } from './x.vsk'`: the target's components merge into
        // this file's registry under their own names, so the specifier is the
        // same canonical -> alias mapping a same-file export would produce.
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ExportSpecifier') {
            const localName = spec.local && (spec.local as unknown as { name?: string }).name;
            const exportedName = spec.exported && (spec.exported as unknown as { name?: string }).name;
            if (typeof localName === 'string' && typeof exportedName === 'string') {
              exportAliases.push({ local: localName, exported: exportedName });
            }
          }
        }
        continue;
      }
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ExportSpecifier') {
          const localName = spec.local && (spec.local as any).name;
          const exportedName = spec.exported && (spec.exported as any).name;
          if (typeof localName === 'string' && typeof exportedName === 'string') {
            exportAliases.push({ local: localName, exported: exportedName });
          }
        }
      }
      continue;
    }

    if (node.type === 'ExportAllDeclaration') {
      // `export * from './x.vsk'` / `export * as ns from './x.vsk'`: resolve the
      // target into this file's component registry instead of emitting a bare
      // re-export that no bundler can satisfy for `.vsk` modules.
      if (node.source && typeof node.source.value === 'string') reexportSources.push(node.source.value);
      continue;
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
    // Value bindings a tag/call in THIS body may resolve to (see
    // `currentComponentValues`). Registry components are excluded so a declared
    // `component Icon` keeps winning over any same-named value binding.
    const valueNames = collectComponentValueNames(inner);
    const prevComponentValues = currentComponentValues;
    currentComponentValues = new Set([...valueNames].filter((n) => !fileComponentNames.has(n)));
    try {
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
    } finally {
      currentComponentValues = prevComponentValues;
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
    'primitive', 'leaf',
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

  for (const comp of components) warnStaleConstBindings(comp, file);

  const irRoot = new IRRoot(components, imports, importedNames, staticProps, loadFn, topLevelCode, exportAliases, reexportSources);
  irRoot.metadataSource = metadataSource;
  return irRoot;
  } finally {
    currentVskNamespaceLocals = prevNamespaceLocals;
    currentSourceFile = prevSourceFile;
    currentFileComponentNames = prevFileComponentNames;
    currentFileValueBindings = prevFileValueBindings;
    currentImportedNames = prevImportedNames;
    currentComponentCallHelpers = null;
  }
}