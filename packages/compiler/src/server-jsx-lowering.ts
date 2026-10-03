/**
 * Lower JSX that appears inside an EXPRESSION, to the string the server would
 * have emitted for the same nodes.
 *
 * Why this exists: the server lowers JSX only for IR-known nodes (via
 * `irNodeToJS`). A component's function-valued child — the body of
 * `<For each={items}>{(item) => <li>{item}</li>}</For>` — is not an IR node: it
 * is an opaque `ArrowFunctionExpression` inside a `DynamicBinding`, so the
 * expression was printed verbatim, JSX and all, and the render threw
 * `Unexpected token '<'` (or, with a string-returning child, silently rendered an
 * empty list).
 *
 * Why template literals rather than calls: the arrow body has to become a
 * *string* of HTML, which is exactly what the static path produces. Rewriting
 * JSX into `TemplateLiteral` nodes and printing with the plain TS printer gives
 * that string, keeps tracked rewrites working (`{count}` still becomes
 * `get(count)`), and needs no new runtime helper.
 *
 * Client output is deliberately untouched: a client chunk is bundled by esbuild
 * with the tsx loader, so JSX in an emitted expression is legitimate there and
 * already printed with esrap's tsx language.
 */
import type { Node as ESTreeNode } from 'estree';

/** True when `node` contains JSX anywhere. */
export function containsJsx(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 40) return false;
  if (Array.isArray(node)) {
    for (const item of node) if (containsJsx(item, depth + 1)) return true;
    return false;
  }
  const type = (node as { type?: unknown }).type;
  if (type === 'JSXElement' || type === 'JSXFragment') return true;
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = (node as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && containsJsx(value, depth + 1)) return true;
  }
  return false;
}

/** The helper names the generated server body already defines. */
const ESCAPE = '__escape';
const ATTR = '__attr';
const RAW = '__raw';

/**
 * JSX text semantics, matching what the compiler emits for StaticNode text:
 * lines are trimmed, blank lines vanish, and interior newlines collapse to a
 * single space. Getting this wrong is visible as stray whitespace in SSR HTML.
 */
export function normalizeJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmpty = i;
  }
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^ +/, '');
    if (i !== lines.length - 1) line = line.replace(/ +$/, '');
    if (line) {
      if (i !== lastNonEmpty) line += ' ';
      out += line;
    }
  }
  return out;
}

interface Ctx { track: boolean }

function lower(node: unknown, ctx: Ctx): unknown {
  if (Array.isArray(node)) return node.map((n) => lower(n, ctx));
  if (!node || typeof node !== 'object') return node;
  const n = node as Record<string, unknown>;

  if (n.type === 'JSXElement') {
    const opening = n.openingElement as Record<string, unknown>;
    const name = jsxTagName(opening.name);
    const attrs = lowerAttributes(opening.attributes as unknown[] | undefined, ctx);
    const children = lowerChildren(n.children as unknown[], ctx);
    // statics[0] opens the tag, attributes interleave, then '>', then children,
    // then the closing tag. Getting the '>' placement wrong silently produced
    // `<lia</li>` — a tag that never closes and swallows the next element.
    const statics = [`<${name}`, ...attrs.statics.slice(1)];
    statics[statics.length - 1] += '>';
    const quasis = [...statics, `</${name}>`];
    const expressions = [...attrs.exprs, ...children];
    return template(quasis, expressions);
  }

  if (n.type === 'JSXFragment') {
    return template(['', ''], lowerChildren(n.children as unknown[], ctx));
  }

  // Any other node: rebuild it with lowered children.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      out[key] = n[key];
      continue;
    }
    const value = n[key];
    out[key] = value && typeof value === 'object' ? lower(value, ctx) : value;
  }
  return out;
}

function jsxTagName(nameNode: unknown): string {
  const n = nameNode as Record<string, unknown>;
  if (!n) return 'div';
  if (n.type === 'JSXIdentifier') return String(n.name);
  if (n.type === 'JSXMemberExpression') {
    const object = jsxTagName(n.object);
    const property = n.property as Record<string, unknown>;
    return `${object}.${String(property?.name)}`;
  }
  if (n.type === 'JSXNamespacedName') {
    const ns = n.namespace as Record<string, unknown>;
    const name = n.name as Record<string, unknown>;
    return `${String(ns?.name)}:${String(name?.name)}`;
  }
  return 'div';
}

/**
 * Attributes come back as alternating static text and expressions, so the
 * element's template literal can be assembled without splicing strings.
 */
interface Attrs { statics: string[]; exprs: unknown[] }

function lowerAttributes(attrs: unknown[] | undefined, ctx: Ctx): Attrs {
  const statics: string[] = [''];
  const exprs: unknown[] = [];
  const push = (text: string, expr?: unknown): void => {
    if (expr === undefined) {
      statics[statics.length - 1] += text;
      return;
    }
    statics[statics.length - 1] += text;
    statics.push('');
    exprs.push(expr);
  };
  for (const attr of attrs || []) {
    const a = attr as Record<string, unknown>;
    if (a.type === 'JSXSpreadAttribute') {
      // A spread inside a function-valued child is not lowered; dropping it
      // would be silently wrong, so it is reported instead.
      console.error('[vesk] a spread attribute in a JSX expression is not supported yet (dropped):', String((a as { argument?: unknown }).argument ?? '').slice(0, 60));
      continue;
    }
    const name = jsxAttrName(a.name);
    const value = a.value as Record<string, unknown> | null | undefined;
    if (value === null || value === undefined) {
      push(` ${name}`);
      continue;
    }
    if (value.type === 'StringLiteral') {
      push(` ${name}="${escapeAttrText(String(value.value))}"`);
      continue;
    }
    if (value.type === 'JSXExpressionContainer') {
      const inner = value.expression as Record<string, unknown>;
      if (!inner || inner.type === 'JSXEmptyExpression') {
        push(` ${name}="true"`);
        continue;
      }
      push(` ${name}="`, callNode(ATTR, [literal(name), coerceString(lower(inner, ctx))]));
      push('"');
      continue;
    }
    push(` ${name}="`, callNode(ATTR, [literal(name), coerceString(lower(value, ctx))]));
    push('"');
  }
  return { statics, exprs };
}

function jsxAttrName(nameNode: unknown): string {
  const n = nameNode as Record<string, unknown>;
  if (!n) return 'data';
  if (n.type === 'JSXIdentifier') return String(n.name);
  return jsxTagName(n);
}

function lowerChildren(children: unknown[], ctx: Ctx): unknown[] {
  const out: unknown[] = [];
  for (const child of children || []) {
    const c = child as Record<string, unknown>;
    if (c.type === 'JSXText') {
      const text = normalizeJsxText(String(c.value ?? ''));
      if (text) out.push(literal(text));
      continue;
    }
    if (c.type === 'JSXExpressionContainer') {
      const inner = c.expression as Record<string, unknown>;
      if (!inner || inner.type === 'JSXEmptyExpression') continue;
      const lowered = lower(inner, ctx);
      out.push(coerceString(lowered));
      continue;
    }
    const lowered = lower(c, ctx);
    out.push(coerceString(lowered));
  }
  return out;
}

/** `{v}` in HTML output must be escaped, exactly as the body emitter does. */
function coerceString(node: unknown): unknown {
  if (!node || typeof node !== 'object') return callNode(ESCAPE, [literal(String(node))]);
  const n = node as Record<string, unknown>;
  // Already a template literal we built: its parts are static text, but any
  // expression inside came from a nested container that escaped itself.
  if (n.type === 'TemplateLiteral') return n;
  if (n.type === 'Literal' || n.type === 'StringLiteral') return callNode(ESCAPE, [node]);
  return callNode(ESCAPE, [callNode('String', [node])]);
}

/** Assemble a template literal: `statics.length === expressions.length + 1`. */
function template(statics: string[], expressions: unknown[]): unknown {
  const quasis = statics.map((raw, i) => ({
    type: 'TemplateElement',
    value: { raw },
    tail: i === statics.length - 1,
  }));
  return { type: 'TemplateLiteral', quasis, expressions } as unknown as ESTreeNode;
}

function literal(value: string): unknown {
  return { type: 'Literal', value } as unknown as ESTreeNode;
}

function callNode(callee: string, args: unknown[]): unknown {
  return {
    type: 'CallExpression',
    callee: { type: 'Identifier', name: callee },
    arguments: args,
    optional: false,
  } as unknown as ESTreeNode;
}

function escapeAttrText(value: string): string {
  return value.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

/**
 * Rewrite every JSX node inside `ast` into the string it would have rendered.
 * Returns the original node when there is no JSX, so the common path is free.
 */
export function lowerJsxInExpression(ast: unknown): unknown {
  if (!containsJsx(ast)) return ast;
  return lower(ast, { track: false });
}

export { RAW as RAW_HELPER };
