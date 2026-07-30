import { StaticNode, TextNode, DynamicBinding, HeadBlock, RuntimeStatement } from "./ir.js";
import { tryEvalExpr, escapeHtml } from "./server-utils.js";
function evaluateLocals(comp, props) {
  const locals = {};
  for (const node of comp.body) {
    if (node instanceof RuntimeStatement && node.ast) {
      const stmt = node.ast;
      if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations) {
          if (decl.id.type === "Identifier" && decl.init && node.source) {
            const name = decl.id.name;
            const initSrc = node.source.slice(decl.init.start, decl.init.end);
            try {
              const fn = new Function("props", "return (" + initSrc + ")");
              locals[name] = fn(props);
            } catch {
            }
          }
        }
      }
    }
  }
  return locals;
}
function headElementKey(node, props, locals) {
  if (!(node instanceof StaticNode)) return null;
  const tag = node.tag;
  if (tag === "title") return "title";
  if (tag === "base") return "base";
  const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === "attribute" && child.target && child.target !== "ref") {
      try {
        attrMap.set(child.target, String(tryEvalExpr(child.expression.raw, props, locals)));
      } catch {
      }
    }
  }
  if (tag === "meta") {
    if (attrMap.has("name")) return `meta[name=${attrMap.get("name")}]`;
    if (attrMap.has("property")) return `meta[property=${attrMap.get("property")}]`;
    if (attrMap.has("charset")) return "meta[charset]";
    if (attrMap.has("http-equiv")) return `meta[http-equiv=${attrMap.get("http-equiv")}]`;
    return null;
  }
  if (tag === "link") {
    if (attrMap.has("href")) return `link[href=${attrMap.get("href")}]`;
    if (attrMap.has("id")) return `link[id=${attrMap.get("id")}]`;
    return null;
  }
  if (tag === "script") {
    if (attrMap.has("src")) return `script[src=${attrMap.get("src")}]`;
    return null;
  }
  if (tag === "style") return null;
  return null;
}
function irNodeToHeadHtml(node, props, locals = {}) {
  if (node instanceof StaticNode) {
    const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
    for (const child of node.children) {
      if (child instanceof DynamicBinding && child.kind === "attribute" && child.target && child.target !== "ref") {
        try {
          const val = tryEvalExpr(child.expression.raw, props, locals);
          attrMap.set(child.target, String(val));
        } catch {
        }
      }
    }
    const attrs = [...attrMap.entries()].map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join("");
    if (node.selfClosing) return `<${node.tag}${attrs} />`;
    const inner = node.children.filter((c) => !(c instanceof DynamicBinding && c.kind === "attribute" && c.target !== "ref")).map((c) => irNodeToHeadHtml(c, props, locals)).join("");
    return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
  }
  if (node instanceof TextNode) return node.value;
  if (node instanceof DynamicBinding) {
    try {
      const val = tryEvalExpr(node.expression.raw, props, locals);
      return escapeHtml(String(val));
    } catch {
      return "";
    }
  }
  return "";
}
function renderHeadHtml(comp, props = {}) {
  const locals = evaluateLocals(comp, props);
  const seen = /* @__PURE__ */ new Set();
  const parts = [];
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
  return parts.join("\n");
}
function mergeHeadHtml(pageHead, layoutHead) {
  const parseHead = (html) => {
    const entries = [];
    const tagRegex = /<(base|meta|link|script|style)[^>]*\/?>|<title[^>]*>[^<]*<\/title>/gi;
    let m;
    while ((m = tagRegex.exec(html)) !== null) {
      entries.push(m[0]);
    }
    return entries;
  };
  const extractKey = (tagStr) => {
    if (tagStr.startsWith("<title")) return "title";
    if (tagStr.startsWith("<base")) {
      const h = tagStr.match(/href=["']([^"']+)["']/);
      return h ? `base[href=${h[1]}]` : "base";
    }
    if (tagStr.startsWith("<meta")) {
      const n = tagStr.match(/\sname=["']([^"']+)["']/);
      if (n) return `meta[name=${n[1]}]`;
      const p = tagStr.match(/\sproperty=["']([^"']+)["']/);
      if (p) return `meta[property=${p[1]}]`;
      const c = tagStr.match(/\scharset=["']?([^"'\s>]+)/);
      if (c) return `meta[charset]`;
      return null;
    }
    if (tagStr.startsWith("<link")) {
      const h = tagStr.match(/href=["']([^"']+)["']/);
      if (h) return `link[href=${h[1]}]`;
      return null;
    }
    if (tagStr.startsWith("<script")) {
      const s = tagStr.match(/src=["']([^"']+)["']/);
      if (s) return `script[src=${s[1]}]`;
      return null;
    }
    return null;
  };
  const layoutEntries = parseHead(layoutHead);
  const pageEntries = parseHead(pageHead);
  const merged = /* @__PURE__ */ new Map();
  for (const tag of layoutEntries) {
    const key = extractKey(tag);
    if (key) merged.set(key, { html: tag, source: "layout" });
  }
  const conflicts = [];
  for (const tag of pageEntries) {
    const key = extractKey(tag);
    if (key) {
      if (merged.has(key) && merged.get(key).source === "page") {
        conflicts.push({ key, message: `Sibling conflict for <head> key "${key}":
  ${merged.get(key).html}
  ${tag}` });
      }
      merged.set(key, { html: tag, source: "page" });
    }
  }
  const order = ["title", "base", "meta", "link", "script", "style"];
  const sorted = [...merged.values()].sort((a, b) => {
    const ak = [...merged.entries()].find((e) => e[1] === a)?.[0] || "";
    const bk = [...merged.entries()].find((e) => e[1] === b)?.[0] || "";
    const ai = order.findIndex((o) => ak.startsWith(o));
    const bi = order.findIndex((o) => bk.startsWith(o));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return {
    html: sorted.map((e) => e.html).join("\n"),
    conflicts
  };
}
export {
  mergeHeadHtml,
  renderHeadHtml
};
