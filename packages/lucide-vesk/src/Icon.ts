/**
 * Core Icon primitive — framework-agnostic SVG renderer for Vesk.
 * Mirrors lucide-react's Icon.tsx but without React, without ForwardRef, and with Vesk SSR/CSR branching.
 *
 * Server (document === undefined): returns HTML string `<svg ...>...</svg>`
 * Client (document exists): returns an SVGSVGElement (or null when hydration claims an existing node)
 *   - normal: creates a fresh SVG via createElementNS
 *   - hydrate: when a HydrateWalker is passed as 3rd arg, reuses the SSR-rendered <svg>
 *
 * Never scoped — no style tag, no scoped attribute, just an svg with Lucide defaults.
 */

import { defaultAttributes } from "./defaultAttributes.js";
import { hasA11yProp, mergeClasses } from "./utils.js";
import type { IconNode, LucideProps } from "./types.js";

type HydrateWalker = {
  root: Element | null;
  nextElement(tag?: string): Element;
  subWalker(el: Element): HydrateWalker;
} | null | undefined;

function escapeAttr(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "&") out += "&amp;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else out += ch;
  }
  return out;
}

function buildSvgString(
  iconNode: IconNode,
  svgAttrs: Record<string, string>,
  title: string | undefined,
  children: unknown,
): string {
  let html = "<svg";
  for (const [k, v] of Object.entries(svgAttrs)) {
    if (v == null || v === (false as unknown)) continue;
    html += ` ${k}="${escapeAttr(String(v))}"`;
  }
  html += ">";
  if (title) html += `<title>${escapeAttr(title)}</title>`;
  for (const [tag, attrs] of iconNode) {
    html += `<${tag}`;
    for (const [ak, av] of Object.entries(attrs)) {
      if (ak === "key") continue;
      html += ` ${ak}="${escapeAttr(String(av))}"`;
    }
    html += "/>";
  }
  if (children != null) {
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr as unknown[]) {
      if (c == null || typeof c === "boolean") continue;
      if (typeof c === "string" || typeof c === "number") html += escapeAttr(String(c));
      // If children is an Element (client hydrated fragment) we serialise its outerHTML fallback
      else if (typeof (c as Element).outerHTML === "string") html += (c as Element).outerHTML;
      else html += escapeAttr(String(c));
    }
  }
  html += "</svg>";
  return html;
}

function setSvgAttrs(svg: Element, attrs: Record<string, string | number | boolean | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (v === true) svg.setAttribute(k, "");
    else svg.setAttribute(k, String(v));
  }
}

function syncIconNode(svg: Element, iconNode: IconNode): void {
  // For hydrate reuse, we assume SSR node matches iconNode; to be safe we only reconcile if child count differs.
  // IconNode is append-only static, so we can diff cheaply: remove all existing icon children then re-append.
  // But to avoid touching custom children, we only replace the iconNode portion.
  // Simpler: if child count === iconNode.length (+ title), assume it's already correct and return.
  // Otherwise rebuild.
  const expected = iconNode.length;
  // Count non-title, non-custom children: we can't distinguish custom children, so rebuild when mismatch and no custom children detected.
  // We'll do minimal: if counts differ, clear and rebuild iconNode.
  // This handles alias swaps where iconNode changes.
  const currentIconChildren = Array.from(svg.children).filter((el) => el.tagName.toLowerCase() !== "title");
  if (currentIconChildren.length === expected) {
    // verify attrs match? Assume ok for perf.
    return;
  }
  // remove existing icon-node children (keep title if present)
  for (const ch of Array.from(svg.children)) {
    if (ch.tagName.toLowerCase() === "title") continue;
    // If it's a custom child inserted by user, we don't have a marker; we preserve if we detect more than expected?
    // For now remove all non-title and re-append iconNode + preserve custom children appended after?
    ch.remove();
  }
  for (const [tag, attrs] of iconNode) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [ak, av] of Object.entries(attrs)) {
      if (ak === "key") continue;
      el.setAttribute(ak, String(av));
    }
    svg.appendChild(el);
  }
}

function appendChildren(svg: Element, children: unknown): void {
  if (children == null) return;
  const arr = Array.isArray(children) ? (children as unknown[]) : [children as unknown];
  for (const c of arr) {
    if (c == null || typeof c === "boolean") continue;
    if (typeof c === "string" || typeof c === "number") {
      svg.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      svg.appendChild(c);
    } else if (typeof (c as Element).outerHTML === "string") {
      // fallback for stringified
      const tmp = document.createElement("div");
      tmp.innerHTML = String(c);
      while (tmp.firstChild) svg.appendChild(tmp.firstChild);
    }
  }
}

export function Icon(
  props: LucideProps & { iconNode: IconNode },
  _registry?: Map<string, unknown>,
  walker?: HydrateWalker,
): string | Element | null {
  const {
    iconNode,
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    class: cls,
    style,
    children,
    title,
    ref,
    ...rest
  } = props as LucideProps & { iconNode: IconNode; title?: string; ref?: ((el: SVGSVGElement | null) => void) | null };

  // Remove internal keys from rest that shouldn't be forwarded as SVG attrs
  // (iconNode already destructured, but rest may contain iconNode? no)

  const classes = mergeClasses("lucide", className as string, cls as string, (rest as Record<string, unknown>).class as string | undefined, (rest as Record<string, unknown>).className as string | undefined);

  // Build the SVG attrs — defaultAttributes first, then size/stroke overrides, then rest
  // Note: defaultAttributes has 'stroke-width' kebab, we normalize to kebab for SSR and setAttribute
  let calcStrokeWidth: string | number = strokeWidth as string | number;
  if (absoluteStrokeWidth) {
    const nSize = Number(size);
    const nStroke = Number(strokeWidth);
    if (!Number.isNaN(nSize) && nSize !== 0 && !Number.isNaN(nStroke)) {
      calcStrokeWidth = (nStroke * 24) / nSize;
    }
  }

  const svgAttrs: Record<string, string> = {};
  // default attrs
  for (const [k, v] of Object.entries(defaultAttributes)) {
    svgAttrs[k] = String(v);
  }
  // overrides
  svgAttrs.width = String(size);
  svgAttrs.height = String(size);
  svgAttrs.stroke = String(color);
  svgAttrs["stroke-width"] = String(calcStrokeWidth);
  // class: merge lucide + user classes, and strip class/className from rest later
  const mergedClass = mergeClasses("lucide", className as string, cls as string);
  if (mergedClass) svgAttrs.class = mergedClass;
  else delete svgAttrs.class;
  if (style != null) svgAttrs.style = String(style);
  // a11y: if no title/children/aria prop, set aria-hidden true
  const hasA11y = hasA11yProp(rest as Record<string, unknown>) || !!title || !!children;
  if (!hasA11y) svgAttrs["aria-hidden"] = "true";

  // forward rest attrs (excluding class/className/style already handled, and internal keys)
  const skipKeys = new Set(["class", "className", "style", "color", "size", "strokeWidth", "absoluteStrokeWidth", "iconNode", "children", "title", "ref"]);
  for (const [k, v] of Object.entries(rest as Record<string, unknown>)) {
    if (skipKeys.has(k)) continue;
    if (v == null || v === false) continue;
    // Event handlers (on*) are excluded from SSR HTML — Vesk's server-utils strips them, and client adds via addEventListener
    // But for generic icon, we forward them as attributes for client setAttribute? They will be set as attributes, not listeners.
    // Vesk's client code handles on* via addEventListener, but for icons imported as JS, props spread includes on* that should be wired as listeners, not attrs.
    // We'll still set them as attributes for now; the compiler's event handling for icons will handle on* via the component's own logic if needed.
    // To keep parity with lucide-react (which spreads rest onto <svg>), we set them.
    if (typeof v === "function" && k.startsWith("on")) {
      // store for later addEventListener
      continue;
    }
    if (v === true) svgAttrs[k] = "";
    else svgAttrs[k] = String(v);
  }

  const isServer = typeof document === "undefined";

  if (isServer) {
    return buildSvgString(iconNode, svgAttrs, title as string | undefined, children);
  }

  // Client — try hydrate path if walker is provided
  const anyWalker = walker as HydrateWalker;
  let svg: Element | null = null;
  let walkerClaimed = false;

  if (anyWalker) {
    // Case A: walker.root is already the wrapper div or the svg itself.
    // The server wrapper (when hydrate) is <!--vsk--><div><svg>...</svg></div>
    // In that case walker.root should be the div, and we want to reuse its inner svg.
    // Case B: server without wrapper (<!--vsk--><svg>) — nextElement('svg') returns svg directly.
    // We try both.
    try {
      const root = (anyWalker as { root?: Element | null }).root as Element | null;
      if (root) {
        const tag = root.tagName.toLowerCase();
        if (tag === "svg") {
          svg = root;
          walkerClaimed = true;
        } else if (tag === "div") {
          // wrapper div case — find inner svg
          const inner = root.querySelector(":scope > svg") || root.querySelector("svg");
          if (inner && inner.tagName.toLowerCase() === "svg") {
            svg = inner;
            walkerClaimed = true;
          } else {
            // create svg inside wrapper
            svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            root.appendChild(svg);
            walkerClaimed = true;
          }
        }
      }
      if (!walkerClaimed && typeof (anyWalker as { nextElement?: (tag?: string) => Element }).nextElement === "function") {
        const maybe = (anyWalker as { nextElement: (tag?: string) => Element }).nextElement("svg");
        if (maybe && maybe.tagName.toLowerCase() === "svg") {
          svg = maybe;
          walkerClaimed = true;
        }
      }
    } catch {
      svg = null;
      walkerClaimed = false;
    }
  }

  if (walkerClaimed && svg) {
    // Reuse claimed SVG — sync attrs and iconNode if needed
    // Clear old attrs that may be stale? Just set new ones.
    // Remove stale attrs first? We overwrite.
    setSvgAttrs(svg, svgAttrs);
    // Ensure title
    const existingTitle = svg.querySelector(":scope > title");
    if (title) {
      if (existingTitle) existingTitle.textContent = String(title);
      else {
        const tEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
        tEl.textContent = String(title);
        svg.insertBefore(tEl, svg.firstChild);
      }
    } else if (existingTitle) {
      existingTitle.remove();
    }
    syncIconNode(svg, iconNode);
    // Re-append children if provided (custom children)
    if (children != null) {
      // For hydrate, children are fragment; we should ensure they are appended after iconNode
      // Simple: if svg already had custom children appended, we may duplicate; so we only append if not already.
      // We'll clear non-iconNode children beyond iconNode count? For now just append if no custom children yet.
      const hasCustom = svg.children.length > iconNode.length + (title ? 1 : 0);
      if (!hasCustom) appendChildren(svg, children);
    }
    // wire events from rest (on*)
    for (const [k, v] of Object.entries(rest as Record<string, unknown>)) {
      if (typeof v === "function" && k.startsWith("on") && k.length > 2) {
        const event = k.slice(2).toLowerCase();
        svg.addEventListener(event, v as EventListener);
      }
    }
    if (typeof ref === "function") {
      try {
        (ref as (el: SVGSVGElement | null) => void)(svg as SVGSVGElement);
      } catch {}
    } else if (ref && typeof (ref as { current?: unknown }).current !== "undefined") {
      (ref as { current: unknown }).current = svg;
    }

    // If walkerClaimed via wrapper div, return the wrapper div so parent doesn't duplicate
    const root = (anyWalker as { root?: Element | null })?.root as Element | null;
    if (root && root.tagName.toLowerCase() === "div" && svg.parentElement === root) {
      return root;
    }
    return svg;
  }

  // Normal client creation — fresh SVG
  const fresh = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setSvgAttrs(fresh, svgAttrs);
  if (title) {
    const tEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tEl.textContent = String(title);
    fresh.appendChild(tEl);
  }
  for (const [tag, attrs] of iconNode) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [ak, av] of Object.entries(attrs)) {
      if (ak === "key") continue;
      el.setAttribute(ak, String(av));
    }
    fresh.appendChild(el);
  }
  appendChildren(fresh, children);
  // wire events
  for (const [k, v] of Object.entries(rest as Record<string, unknown>)) {
    if (typeof v === "function" && k.startsWith("on") && k.length > 2) {
      const event = k.slice(2).toLowerCase();
      fresh.addEventListener(event, v as EventListener);
    }
  }
  if (typeof ref === "function") {
    try {
      (ref as (el: SVGSVGElement | null) => void)(fresh as SVGSVGElement);
    } catch {}
  } else if (ref && typeof (ref as { current?: unknown }).current !== "undefined") {
    (ref as { current: unknown }).current = fresh;
  }

  return fresh;
}

export default Icon;
