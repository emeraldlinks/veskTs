import type { IRNode, Expression } from '@vesk/compiler/src/ir';
import { StaticNode, TextNode, DynamicBinding, HeadBlock, RuntimeStatement, TrackDecl } from '@vesk/compiler/src/ir';
import type { ComponentIR } from '@vesk/compiler/src/ir';
import { tryEvalExpr, escapeHtml } from '@vesk/compiler/src/server-utils';
import { isWhitespaceChar } from '@vesk/compiler/src/scan';
import { parse } from '@vesk/compiler/src/parser';
import { collectTrackedNames, transformTracked, transformTrackedInit, type TrackedInfo } from '@vesk/compiler/src/client-codegen';
import { walk } from 'zimmerframe';
import type { Node as ESTreeNode } from 'estree';

function isHtmlNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === '-'
  );
}

function isAttrBoundaryChar(ch: string): boolean {
  return isWhitespaceChar(ch) || ch === '=' || ch === '/' || ch === '>';
}

function isValueBoundaryChar(ch: string): boolean {
  return isWhitespaceChar(ch) || ch === '/' || ch === '>';
}

/**
 * Value stand-ins for the reactivity primitives, so the head pass can read a
 * tracked binding without creating a real cell.
 *
 * The head pass must not allocate cells: the component already ran and its
 * cells are registered per render token in `__vsk_ssr_cells`; a second,
 * throwaway cell would be invisible to the real render and to its cleanup. So
 * `track`/`derived` here produce a plain holder of the value and `get` unwraps
 * it — which is all a head expression can observe. `toString` covers a head
 * expression that interpolates the cell itself instead of reading `get(x)`.
 */
interface HeadCell { __vskHeadValue: unknown }

function headCell(value: unknown): HeadCell {
  const cell = {
    __vskHeadValue: value,
    toString() { return String(cell.__vskHeadValue); },
    // Present so `+count` / `String(count)` on the cell itself still yields the
    // value; the return type is widened because `valueOf` must return `this`.
    valueOf() { return cell as unknown; },
  };
  return cell as unknown as HeadCell;
}

const headRuntimeShims = (): Record<string, unknown> => ({
  track: (init: unknown) => headCell(init),
  derived: (fn: unknown) => headCell(typeof fn === 'function' ? (fn as () => unknown)() : fn),
  get: (cell: unknown) =>
    cell && typeof cell === 'object' && '__vskHeadValue' in (cell as Record<string, unknown>)
      ? (cell as unknown as HeadCell).__vskHeadValue
      : cell,
  peek: (cell: unknown) =>
    cell && typeof cell === 'object' && '__vskHeadValue' in (cell as Record<string, unknown>)
      ? (cell as unknown as HeadCell).__vskHeadValue
      : cell,
  untrack: (fn: unknown) => (typeof fn === 'function' ? (fn as () => unknown)() : fn),
});

/**
 * Everything one head-expression evaluation needs: props, the component's
 * imports, the locals evaluated so far, and the tracked names so a read is
 * rewritten to `get(x)` exactly as the client codegen rewrites it.
 */
interface HeadEvalCtx {
  props: Record<string, unknown>;
  locals: Record<string, unknown>;
  tracked: Map<string, TrackedInfo>;
  scope: Record<string, unknown>;
}

function headEvalScope(ctx: HeadEvalCtx): Record<string, unknown> {
  // The shims come LAST: they must win over the component's real `track`/`get`
  // from `__vesk`, which would otherwise allocate real cells.
  return { ...ctx.scope, ...ctx.locals, ...headRuntimeShims() };
}

function evalHeadExpression(expression: Expression, ctx: HeadEvalCtx): unknown {
  // `{count}` must resolve to the VALUE, not the cell: rewrite tracked reads the
  // same way the client codegen does, then evaluate with the shims bound.
  const code = transformTracked(expression, ctx.tracked);
  return tryEvalExpr(code, ctx.props, headEvalScope(ctx));
}

/**
 * Evaluate `raw` with `props` plus every name in `scope` bound to its value.
 *
 * The head pass re-evaluates a component's top-level declarations outside the
 * component's own call frame, so it has to rebuild that frame. Passing the
 * component's `__vesk` bindings as named parameters is what makes imports
 * visible: a docs page's `const doc = getDoc(props.params.slug)` needs
 * `getDoc`, which lives in `__vesk` (the generated body destructures it from
 * there), and without it the head silently degraded to empty strings.
 */
function evalWithScope(raw: string, props: Record<string, unknown>, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope);
  const fn = new Function('props', ...names, 'return (' + raw + ')') as (...a: unknown[]) => unknown;
  return fn(props, ...names.map((n) => scope[n]));
}

/** Identifier reads of an ESTree expression (not property keys, not `obj.prop`). */
function identifiersOf(ast: unknown, into: Set<string>): void {
  if (!ast || typeof ast !== 'object') return;
  walk(ast as ESTreeNode, null, {
    Identifier(n: any, context: any) {
      const parent = context.path.at(-1);
      if (parent) {
        if (parent.type === 'MemberExpression' && !parent.computed && parent.property === n) return context.next();
        if (parent.type === 'Property' && parent.key === n) return context.next();
      }
      into.add(n.name);
      return context.next();
    },
  } as any);
}

/** Every interpolated/attribute expression inside a `<Head>` subtree. */
function collectHeadExprs(node: IRNode, out: Expression[]): void {
  if (node instanceof StaticNode) {
    for (const child of node.children) {
      if (child instanceof DynamicBinding) out.push(child.expression);
      else collectHeadExprs(child, out);
    }
  }
}

interface DeclEntry {
  kind: 'track' | 'const';
  initSrc: string;
  initAst: unknown;
  names: string[];
}

/** Top-level declarations of a component: tracked cells and `const` locals. */
function declaredNames(comp: ComponentIR): Map<string, DeclEntry> {
  const out = new Map<string, DeclEntry>();
  for (const node of comp.body) {
    if (node instanceof TrackDecl) {
      const cellName = node.rawName || node.name;
      let initAst: unknown = null;
      try {
        initAst = parse(node.init);
      } catch { /* unparsable init: no deps to follow */ }
      const entry: DeclEntry = { kind: 'track', initSrc: node.init, initAst, names: [cellName] };
      out.set(cellName, entry);
      if (node.name !== cellName) {
        out.set(node.name, entry);
        entry.names.push(node.name);
      }
    } else if (node instanceof RuntimeStatement && node.ast) {
      const stmt = node.ast as any;
      if (stmt.type !== 'VariableDeclaration') continue;
      for (const decl of stmt.declarations) {
        if (decl.id.type !== 'Identifier' || !decl.init || !node.source) continue;
        out.set(decl.id.name, {
          kind: 'const',
          initSrc: node.source.slice(decl.init.start, decl.init.end),
          initAst: decl.init,
          names: [decl.id.name],
        });
      }
    }
  }
  return out;
}

/**
 * The transitive closure of top-level names the `<Head>` block reads.
 *
 * THE head pass must evaluate only what the head uses. Evaluating every
 * top-level declaration (which is what it used to do) means re-running the
 * component's SIDE EFFECTS in the rebuilt frame: a page whose body does
 * `const data = useFetch('/api/fail')` fetched twice per render, because the
 * head pass called `useFetch` a second time now that the runtime names are in
 * scope. Imports and tracked reads are still resolved — just the declarations
 * the head actually needs, plus the ones those depend on.
 */
function headNeededNames(comp: ComponentIR): Set<string> {
  const wanted = new Set<string>();
  for (const node of comp.body) {
    if (!(node instanceof HeadBlock)) continue;
    const exprs: Expression[] = [];
    for (const child of node.children) collectHeadExprs(child, exprs);
    for (const e of exprs) identifiersOf(e.ast, wanted);
  }
  const declared = declaredNames(comp);
  const needed = new Set<string>();
  const queue = [...wanted].filter((n) => declared.has(n));
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (needed.has(name)) continue;
    needed.add(name);
    const entry = declared.get(name);
    if (!entry) continue;
    const deps = new Set<string>();
    identifiersOf(entry.initAst, deps);
    for (const d of deps) {
      // A tracked init reads other cells through the runtime, so follow the
      // tracked names the init mentions.
      if (declared.has(d) && !needed.has(d)) queue.push(d);
    }
  }
  return needed;
}

function evaluateLocals(
  comp: ComponentIR,
  props: Record<string, unknown>,
  scope: Record<string, unknown> = {},
  tracked: Map<string, TrackedInfo> = new Map(),
  needed: Set<string> | null = null,
): Record<string, unknown> {
  const locals: Record<string, unknown> = {};
  const wanted = (name: string): boolean => needed === null || needed.has(name);
  for (const node of comp.body) {
    if (node instanceof TrackDecl) {
      // `const [count, setCount] = track(0)`: bind every name the declaration
      // introduces to a head cell, so a later local or head expression that
      // reads it sees the current value through the shims.
      const cellName = node.rawName || node.name;
      if (!wanted(cellName) && !wanted(node.name)) continue;
      const init = transformTrackedInit(node.init, tracked);
      let value: unknown;
      try {
        value = evalWithScope(init, props, { ...scope, ...locals, ...headRuntimeShims() });
      } catch {
        value = undefined;
      }
      const cell = headCell(value);
      if (node.name !== cellName) locals[node.name] = cell;
      locals[cellName] = cell;
      continue;
    }
    if (node instanceof RuntimeStatement && node.ast) {
      const stmt = node.ast as any;
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) {
          if (decl.id.type === 'Identifier' && decl.init && node.source) {
            const name = decl.id.name;
            if (!wanted(name)) continue;
            const initSrc = node.source.slice(decl.init.start, decl.init.end);
            try {
              locals[name] = evalWithScope(initSrc, props, {
                ...scope,
                ...locals,
                ...headRuntimeShims(),
              });
            } catch {
              // expression can't be evaluated — skip (its dependents degrade
              // to empty, exactly as they did before the scope was passed)
            }
          }
        }
      }
    }
  }
  return locals;
}

function headElementKey(node: IRNode, ctx: HeadEvalCtx): string | null {
  if (!(node instanceof StaticNode)) return null;
  const tag = node.tag;
  if (tag === 'title') return 'title';
  if (tag === 'base') return 'base';

  const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target && child.target !== 'ref') {
      try {
        attrMap.set(child.target, String(evalHeadExpression(child.expression, ctx)));
      } catch { /* skip */ }
    }
  }

  if (tag === 'meta') {
    if (attrMap.has('name')) return `meta[name=${attrMap.get('name')}]`;
    if (attrMap.has('property')) return `meta[property=${attrMap.get('property')}]`;
    if (attrMap.has('charset')) return 'meta[charset]';
    if (attrMap.has('http-equiv')) return `meta[http-equiv=${attrMap.get('http-equiv')}]`;
    return null;
  }
  if (tag === 'link') {
    if (attrMap.has('href')) return `link[href=${attrMap.get('href')}]`;
    if (attrMap.has('id')) return `link[id=${attrMap.get('id')}]`;
    return null;
  }
  if (tag === 'script') {
    if (attrMap.has('src')) return `script[src=${attrMap.get('src')}]`;
    return null;
  }
  if (tag === 'style') return null;
  return null;
}

const HEAD_RECONCILE_MARKER = 'data-vesk-head';
const HEAD_RECONCILE_TAGS = new Set(['title', 'meta', 'link', 'base', 'style']);

function headIsReconcilable(tag: string, attrMap: Map<string, string>): boolean {
  if (!HEAD_RECONCILE_TAGS.has(tag)) return false;
  if (tag === 'meta' && attrMap.has('charset')) return false;
  return true;
}

function irNodeToHeadHtml(node: IRNode, ctx: HeadEvalCtx, reconcileable = false): string {
  if (node instanceof StaticNode) {
    const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
    for (const child of node.children) {
      if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target && child.target !== 'ref') {
        try {
          attrMap.set(child.target, String(evalHeadExpression(child.expression, ctx)));
        } catch { /* skip */ }
      }
    }    const marker = reconcileable && headIsReconcilable(node.tag, attrMap) ? ` ${HEAD_RECONCILE_MARKER}` : '';
    const attrs = [...attrMap.entries()]
      .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
      .join('');
    if (node.selfClosing) return `<${node.tag}${attrs}${marker} />`;
    const inner = node.children
      .filter((c) => !(c instanceof DynamicBinding && c.kind === 'attribute' && c.target !== 'ref'))
      .map((c) => irNodeToHeadHtml(c, ctx, false))
      .join('');
    return `<${node.tag}${attrs}${marker}>${inner}</${node.tag}>`;
  }
  if (node instanceof TextNode) return node.value;
  if (node instanceof DynamicBinding) {
    try {
      return escapeHtml(String(evalHeadExpression(node.expression, ctx)));
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Serialize one component's `<Head>` block.
 *
 * `scope` is the component's `__vesk` bindings (imports, runtime names, the
 * sub-components its body destructures). The head is assembled by re-walking
 * the IR and re-evaluating the expressions rather than by capturing the real
 * render, so the re-evaluation needs the same bindings the component had —
 * without them every expression that touched an import threw and was swallowed,
 * and the served document shipped an empty `<title>`/`<meta>` while the page
 * body rendered fine (and the client corrected it on hydration, which is why
 * this only ever showed up in view-source, in crawlers, and after an SPA nav
 * re-applied the server head).
 */
export function renderHeadHtml(
  comp: ComponentIR,
  props: Record<string, unknown> = {},
  scope: Record<string, unknown> = {},
): string {
  const tracked = collectTrackedNames(comp.body);
  const needed = headNeededNames(comp);
  const locals = evaluateLocals(comp, props, scope, tracked, needed);
  const ctx: HeadEvalCtx = { props, locals, tracked, scope };
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const node of comp.body) {
    if (node instanceof HeadBlock) {
      for (const child of node.children) {
        const key = headElementKey(child, ctx);
        if (key !== null && seen.has(key)) continue;
        if (key !== null) seen.add(key);
        parts.push(irNodeToHeadHtml(child, ctx, true));
      }
    }
  }
  return parts.join('\n');
}

interface HeadTagEntry {
  raw: string;
  tag: string;
  attrs: Map<string, string>;
  selfClosing: boolean;
  end: number;
}

function scanHeadTag(html: string, lt: number): HeadTagEntry | null {
  let i = lt + 1;
  if (html[i] === '/') i++;
  const nameStart = i;
  while (i < html.length && isHtmlNameChar(html[i])) i++;
  const tag = html.slice(nameStart, i).toLowerCase();
  if (!tag) return null;

  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (i < html.length) {
    while (i < html.length && isWhitespaceChar(html[i])) i++;
    if (html[i] === '>') { i++; break; }
    if (html[i] === '/' && html[i + 1] === '>') { selfClosing = true; i += 2; break; }
    if (i >= html.length || html[i] === '>' || html[i] === '/') continue;

    const aStart = i;
    while (i < html.length && !isAttrBoundaryChar(html[i])) i++;
    const aName = html.slice(aStart, i).toLowerCase();
    while (i < html.length && isWhitespaceChar(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && isWhitespaceChar(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        i++;
        const vStart = i;
        while (i < html.length && html[i] !== q) i++;
        value = html.slice(vStart, i);
        if (i < html.length) i++;
      } else {
        const vStart = i;
        while (i < html.length && !isValueBoundaryChar(html[i])) i++;
        value = html.slice(vStart, i);
      }
    }
    if (aName) attrs.set(aName, value);
  }

  let raw = html.slice(lt, i);
  const nonVoidTags = new Set(['title', 'script', 'style', 'noscript']);
  if (!selfClosing && nonVoidTags.has(tag)) {
    const closeTag = html.indexOf('</' + tag, i);
    if (closeTag !== -1) {
      const end = html.indexOf('>', closeTag);
      if (end !== -1) {
        raw = html.slice(lt, end + 1);
        i = end + 1;
      }
    }
  }
  return { raw, tag, attrs, selfClosing, end: i };
}

function parseHeadTags(html: string): HeadTagEntry[] {
  const entries: HeadTagEntry[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const entry = scanHeadTag(html, lt);
    if (!entry) break;
    entries.push(entry);
    i = entry.end;
  }
  return entries;
}

export function mergeHeadHtml(pageHead: string, layoutHead: string): { html: string; conflicts: Array<{ key: string; message: string }> } {
  const extractKey = (entry: HeadTagEntry): string | null => {
    if (entry.tag === 'title') return 'title';
    if (entry.tag === 'base') {
      const h = entry.attrs.get('href');
      return h !== undefined ? `base[href=${h}]` : 'base';
    }
    if (entry.tag === 'meta') {
      const n = entry.attrs.get('name');
      if (n !== undefined) return `meta[name=${n}]`;
      const p = entry.attrs.get('property');
      if (p !== undefined) return `meta[property=${p}]`;
      if (entry.attrs.has('charset')) return 'meta[charset]';
      return null;
    }
    if (entry.tag === 'link') {
      const h = entry.attrs.get('href');
      if (h !== undefined) return `link[href=${h}]`;
      return null;
    }
    if (entry.tag === 'script') {
      const s = entry.attrs.get('src');
      if (s !== undefined) return `script[src=${s}]`;
      return null;
    }
    return null;
  };

  const layoutEntries = parseHeadTags(layoutHead);
  const pageEntries = parseHeadTags(pageHead);

  const merged = new Map<string, { html: string; source: string }>();
  for (const tag of layoutEntries) {
    const key = extractKey(tag);
    if (key) merged.set(key, { html: tag.raw, source: 'layout' });
  }

  const conflicts: Array<{ key: string; message: string }> = [];
  for (const tag of pageEntries) {
    const key = extractKey(tag);
    if (key) {
      if (merged.has(key) && merged.get(key)!.source === 'page') {
        conflicts.push({ key, message: `Sibling conflict for <head> key "${key}":\n  ${merged.get(key)!.html}\n  ${tag.raw}` });
      }
      merged.set(key, { html: tag.raw, source: 'page' });
    }
  }

  const order = ['title', 'base', 'meta', 'link', 'script', 'style'];
  const sorted = [...merged.values()].sort((a, b) => {
    const ak = [...merged.entries()].find(e => e[1] === a)?.[0] || '';
    const bk = [...merged.entries()].find(e => e[1] === b)?.[0] || '';
    const ai = order.findIndex(o => ak.startsWith(o));
    const bi = order.findIndex(o => bk.startsWith(o));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const unkeyed: string[] = [];
  for (const e of [...layoutEntries, ...pageEntries]) {
    if (extractKey(e) === null && !unkeyed.includes(e.raw)) unkeyed.push(e.raw);
  }

  return {
    html: [...sorted.map(e => e.html), ...unkeyed].join('\n'),
    conflicts,
  };
}
