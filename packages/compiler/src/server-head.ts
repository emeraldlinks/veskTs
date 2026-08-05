import type { IRNode } from '@vesk/compiler/src/ir';
import { StaticNode, TextNode, DynamicBinding, HeadBlock, RuntimeStatement } from '@vesk/compiler/src/ir';
import type { ComponentIR } from '@vesk/compiler/src/ir';
import { tryEvalExpr, escapeHtml } from '@vesk/compiler/src/server-utils';

function evaluateLocals(comp: ComponentIR, props: Record<string, unknown>): Record<string, unknown> {
  const locals: Record<string, unknown> = {};
  for (const node of comp.body) {
    if (node instanceof RuntimeStatement && node.ast) {
      const stmt = node.ast as any;
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) {
          if (decl.id.type === 'Identifier' && decl.init && node.source) {
            const name = decl.id.name;
            const initSrc = node.source.slice(decl.init.start, decl.init.end);
            try {
              const fn = new Function('props', 'return (' + initSrc + ')');
              locals[name] = fn(props);
            } catch {
              // expression can't be evaluated — skip
            }
          }
        }
      }
    }
  }
  return locals;
}

function headElementKey(node: IRNode, props: Record<string, unknown>, locals: Record<string, unknown>): string | null {
  if (!(node instanceof StaticNode)) return null;
  const tag = node.tag;
  if (tag === 'title') return 'title';
  if (tag === 'base') return 'base';

  const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target && child.target !== 'ref') {
      try {
        attrMap.set(child.target, String(tryEvalExpr(child.expression.raw, props, locals)));
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

function irNodeToHeadHtml(node: IRNode, props: Record<string, unknown>, locals: Record<string, unknown> = {}): string {
  if (node instanceof StaticNode) {
    const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
    for (const child of node.children) {
      if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target && child.target !== 'ref') {
        try {
          const val = tryEvalExpr(child.expression.raw, props, locals);
          attrMap.set(child.target, String(val));
        } catch { /* skip */ }
      }
    }
    const attrs = [...attrMap.entries()]
      .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
      .join('');
    if (node.selfClosing) return `<${node.tag}${attrs} />`;
    const inner = node.children
      .filter((c) => !(c instanceof DynamicBinding && c.kind === 'attribute' && c.target !== 'ref'))
      .map((c) => irNodeToHeadHtml(c, props, locals))
      .join('');
    return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
  }
  if (node instanceof TextNode) return node.value;
  if (node instanceof DynamicBinding) {
    try {
      const val = tryEvalExpr(node.expression.raw, props, locals);
      return escapeHtml(String(val));
    } catch {
      return '';
    }
  }
  return '';
}

export function renderHeadHtml(comp: ComponentIR, props: Record<string, unknown> = {}): string {
  const locals = evaluateLocals(comp, props);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const node of comp.body) {
    if (node instanceof HeadBlock) {
      for (const child of node.children) {
        const key = headElementKey(child, props, locals);
        if (key !== null && seen.has(key)) continue;
        if (key !== null) seen.add(key);
        parts.push(irNodeToHeadHtml(child, props, locals));
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
  while (i < html.length && /[a-zA-Z0-9-]/.test(html[i])) i++;
  const tag = html.slice(nameStart, i).toLowerCase();
  if (!tag) return null;

  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] === '>') { i++; break; }
    if (html[i] === '/' && html[i + 1] === '>') { selfClosing = true; i += 2; break; }
    if (i >= html.length || html[i] === '>' || html[i] === '/') continue;

    const aStart = i;
    while (i < html.length && !/[\s=/>]/.test(html[i])) i++;
    const aName = html.slice(aStart, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        i++;
        const vStart = i;
        while (i < html.length && html[i] !== q) i++;
        value = html.slice(vStart, i);
        if (i < html.length) i++;
      } else {
        const vStart = i;
        while (i < html.length && !/[\s/>]/.test(html[i])) i++;
        value = html.slice(vStart, i);
      }
    }
    if (aName) attrs.set(aName, value);
  }

  let raw = html.slice(lt, i);
  if (!selfClosing && tag === 'title') {
    const closeTag = html.indexOf('</title', i);
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

  return {
    html: sorted.map(e => e.html).join('\n'),
    conflicts,
  };
}
