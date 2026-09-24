import type { IRNode, ComponentIR, IRRoot } from '@vesk/compiler/src/ir';
import {
  StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
  MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
  TrackDecl, RuntimeStatement, ComponentRef, ComponentCall,
  ServerBlock, ClientBlock, HeadBlock, SlotNode, PropSlot, PropSlotRender,
} from '@vesk/compiler/src/ir';
import { isStaticIR, collectTrackedNames, transformTracked, transformTrackedInit, semicolonizeStatement, type TrackedInfo } from '@vesk/compiler/src/client-codegen';
import { walk } from 'zimmerframe';
import type { Node as ESTreeNode } from 'estree';
import { unwrapTrackCall, stripTrackGeneric, hasTopLevelComma, skipWhitespace, findBalancedEnd, startsWithIdentifier } from '@vesk/compiler/src/scan';
import {
  isStatic, escapeHtml, indent, exprJS,
  extractTopLevelNames, extractRuntimeNames, buildParamInit,
  __vskHydrate, __vskMarkerless, __vskImportedNames, setVskImportedNames, setVskForceClaim, takeVskForceClaim, nextVskId,
} from '@vesk/compiler/src/server-utils';
import { localValueImportNames } from '@vesk/compiler/src/module-imports';

// Hydrate-mode component-boundary wrapper. Each server-rendered component call
// is preceded by a `<!--vsk-->` marker and a single container element: the
// hydration walker adopts that element as the component root
// (`walker.nextElement()`) and scopes interior claims via
// `subWalker(rootEl).contains(...)`, so fragment components with multiple root
// siblings need one shared container here.
//
// The container MUST NOT be a layout box. The client renderer has no such box
// — component nodes are appended straight into the parent — so a block wrapper
// that collapses to the component's own height confines every child that
// depends on the parent layout: `position: sticky`, `h-full`/`min-h-screen`,
// inset/percent offsets, flex/grid stretch. `display: contents` keeps the DOM
// node for claiming while suppressing its box, making SSR layout identical to
// the client's for every property, not just sticky.
//
// The wrapper tag must be `<span>`, not `<div>`. The HTML parser implicitly
// Marker-ONLY component boundary. The client's shared walker claims a
// component call-site by reading the component's own root element off this
// marker — the SSR output of a component call is exactly the marker followed
// by the callee's content. A `<span style="display:contents">` box here would
// sit between the marker and that root, so a `nextElement(tag)` claim (e.g.
// LoadingIndicator claiming `div`) hits a tag mismatch, never advances the
// walker cursor, and every later claim miss wipes the SSR content.
//
// Every marker is keyed, no bare markers (Hydrate-Todo: keyed markers):
// component boundaries carry the callee name (`<!--vsk:c:Name-->`),
// static-subtree boundaries carry the tag (`<!--vsk:t:tag-->`). The walker
// asserts the tag identity on adopt, reports skew deterministically, and names
// every miss/orphan — divergence is pinpointed at the exact boundary instead
// of cascading anonymously.
function sanitizeMarkerName(name: string): string {
  // No regex (compiler rule): identifiers cannot contain comment-breaking
  // sequences, but guard anyway — `--` would terminate the HTML comment.
  return String(name).split('--').join('-').split('<').join('').split('>').join('');
}

function componentMarker(compName: string): string {
  return `<!--vsk:c:${sanitizeMarkerName(compName)}-->`;
}

export function irNodeToJS(node: IRNode, importedNames?: Set<string> | null, isAsync: boolean = false, tracked?: Map<string, TrackedInfo>): string {
  importedNames = importedNames || __vskImportedNames;
  if (node instanceof StaticNode) return staticNodeToJS(node, isAsync, tracked);
  if (node instanceof TextNode) {
    if (!node.value) return '';
    // The JSX parser entity-decodes text (`&lt;style&gt;` -> `<style>`), so the
    // decoded value must be re-escaped for HTML text context. Emitting it raw
    // would turn &lt;` escapes into real start tags and break the parse.
    return `__out.push(${JSON.stringify(escapeHtml(node.value))});`;
  }
  if (node instanceof DynamicBinding) return dynamicBindingToJS(node, tracked);
  if (node instanceof OpaqueDynamicRegion) return opaqueRegionToJS(node, isAsync, tracked);
  if (node instanceof MapRegion) return mapRegionToJS(node, isAsync, tracked);
  if (node instanceof WhileLoop) return whileLoopToJS(node, isAsync, tracked);
  if (node instanceof SwitchBlock) return switchBlockToJS(node, isAsync, tracked);
  if (node instanceof TryCatch) return tryCatchToJS(node, isAsync, tracked);
  if (node instanceof ComponentRef) return '';
  if (node instanceof ComponentCall) return componentCallToJS(node, importedNames, isAsync, tracked);
  if (node instanceof ServerBlock) {
    const lines: string[] = [];
    for (const n of node.children) {
      const code = irNodeToJS(n, importedNames, isAsync, tracked);
      if (code) lines.push(code);
    }
    return lines.join('\n');
  }
  if (node instanceof ClientBlock) return '';
  if (node instanceof HeadBlock) return '';
  if (node instanceof ForLoop) return forLoopToJS(node, isAsync, tracked);
  if (node instanceof TrackDecl) {
    const cellName = node.rawName || node.name;
    // Tracked reads inside a `track`/`derived` init are re-emitted as `get(…)`
    // (matching client codegen) so a function init like
    // `track(() => x * 2)` / `derived(() => props.tabs[x])` computes against the
    // cell VALUES server-side instead of the raw cell objects.
    const init = transformTrackedInit(node.init, tracked || new Map());
    const unwrapped = unwrapTrackCall(init);
    const inner = hasTopLevelComma(unwrapped) ? stripTrackGeneric(init) : unwrapped;
    const key = JSON.stringify(`${compKey(node)}:${node.name}`);
    return [
      `const ${cellName} = (() => {`,
      `  const __s = globalThis.__vsk_ssr_cells || (globalThis.__vsk_ssr_cells = new Map());`,
      `  const __k = __tk + ${key};`,
      `  if (__s.has(__k)) return __s.get(__k);`,
      `  let __c;`,
      `  try { const __v = (${inner}); __c = track(typeof __v === 'function' ? __v() : __v); } catch (e) { __c = track(void 0); }`,
      `  __s.set(__k, __c);`,
      `  return __c;`,
      `})();`,
    ].join('\n');
  }
  if (node instanceof RuntimeStatement) return semicolonizeStatement(transformTracked(node as any, tracked || new Map()));
  if (node instanceof SlotNode) {
    // Markerless mode drops the slot boundary comments: SSR output is plain
    // HTML and slot claims scope structurally (createLayoutSlot subject to the
    // markerless layout contract — Phase 3.x). The children themselves render
    // identically either way.
    if (__vskMarkerless) return `__out.push(props.children || '');`;
    const sid = `s${nextVskId()}`;
    return `__out.push('<!--vsk-slot:${sid}-->');__out.push(props.children || '');__out.push('<!--vsk-slot-end:${sid}-->');`;
  }
  if (node instanceof PropSlotRender) return `__out.push(props.${node.propName} || '');`;
  if (node instanceof PropSlot) return '';
  return '';
}

let __currentCompName = '';

function compKey(_node: TrackDecl): string {
  return __currentCompName || 'comp';
}

function isEvent(target: string | null): boolean {
  return !!target && target.startsWith('on') && target.length > 2;
}

function exprJSX(node: { raw: string; ast: ESTreeNode | null }, tracked?: Map<string, TrackedInfo>): string {
  return exprJS(transformTracked(node as any, tracked || new Map()));
}

function staticNodeToJS(node: StaticNode, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];

  const dynAttrTargets = new Set<string>();
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== null && child.target !== 'ref') {
      if (isEvent(child.target)) continue;
      dynAttrTargets.add(child.target);
    }
  }
  const hasDynamicAttrs = dynAttrTargets.size > 0;

  let openTag = `<${node.tag}`;
  const forceClaim = takeVskForceClaim();
  const subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children));
  if (subtreeNeedsJS && !__vskMarkerless) {
    // Keyed static boundary (Hydrate-Todo: no bare markers): the walker
    // asserts this tag on adopt and names it in every miss/orphan report.
    // Markerless mode omits the comment entirely — the structural walker
    // scopes interior claims to the claimed element's own children.
    lines.push('__out.push(' + JSON.stringify(`<!--vsk:t:${sanitizeMarkerName(node.tag)}-->`) + ');');
  }
  for (const attr of node.attributes) {
    if (isEvent(attr.name)) continue;
    if (dynAttrTargets.has(attr.name)) continue;
    if (attr.value === '') {
      openTag += ` ${attr.name}`;
    } else {
      openTag += ` ${attr.name}="${escapeHtml(attr.value)}"`;
    }
  }

  if (node.selfClosing) {
    let tag = openTag + ' />';
    if (hasDynamicAttrs) {
      let expr = JSON.stringify(tag);
      for (const child of node.children) {
        if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref' && !isEvent(child.target)) {
          expr += ` + __attr(${JSON.stringify(child.target)}, ${exprJSX(child.expression, tracked)})`;
        }
      }
      lines.push(`__out.push(${expr});`);
    } else {
      lines.push(`__out.push(${JSON.stringify(tag)});`);
    }
    return lines.join('\n');
  }

  const childNodes = node.children.filter(
    (c) => !(c instanceof DynamicBinding && c.kind === 'attribute' && c.target !== 'ref')
  );

  if (hasDynamicAttrs) {
    let expr = JSON.stringify(openTag);
    for (const child of node.children) {
      if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref' && !isEvent(child.target)) {
        expr += ` + __attr(${JSON.stringify(child.target)}, ${exprJSX(child.expression, tracked)})`;
      }
    }
    lines.push(`__out.push(${expr});`);
    lines.push(`__out.push('>');`);
  } else {
    lines.push(`__out.push(${JSON.stringify(openTag + '>')});`);
  }

  for (const child of childNodes) {
    const code = irNodeToJS(child, null, isAsync, tracked);
    if (code) lines.push(code);
  }

  lines.push(`__out.push(${JSON.stringify('</' + node.tag + '>')});`);
  return lines.join('\n');
}

/**
 * Returns the inner expression of a whole `raw(<expr>)` binding, or `null`
 * when `raw` is not a complete `raw(...)` call.
 */
function extractRawInner(raw: string): string | null {
  if (!startsWithIdentifier(raw, 'raw')) return null;
  let i = skipWhitespace(raw, 3);
  if (raw[i] !== '(') return null;
  const end = findBalancedEnd(raw, i);
  if (skipWhitespace(raw, end + 1) !== raw.length) return null;
  return raw.slice(i + 1, end);
}

function dynamicBindingToJS(node: DynamicBinding, tracked?: Map<string, TrackedInfo>): string {
  if (node.kind === 'attribute') return '';
  const raw = node.expression.raw;
  const inner = extractRawInner(raw);
  if (inner !== null) {
    const innerAst = (node.expression.ast as any)?.arguments?.[0] ?? null;
    return `{ const __v = ${exprJSX({ raw: inner, ast: innerAst }, tracked)}; if (__v != null) __out.push(typeof __v === 'boolean' ? 'true' : String(__v)); }`;
  }
  return `{ const __v = ${exprJSX(node.expression, tracked)}; if (__v != null) __out.push(typeof __v === 'boolean' ? (__v ? 'true' : '') : __escape(String(__v))); }`;
}

function opaqueRegionToJS(node: OpaqueDynamicRegion, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const cond = exprJSX(node.condition, tracked);
  lines.push(`if (${cond}) {`);
  // Static branch content still needs server claim markers: the client
  // re-branches an if/else-if region on every tracked change (OpaqueDynamicRegion
  // claimStatic codegen), so opposed to plain component bodies it must be able
  // to adopt the SSR nodes in place — not leave them orphaned next to the
  // region's anchors. Mirrors mapRegionToJS' alternate handling below.
  setVskForceClaim(true);
  for (const n of node.consequentNodes) {
    const code = irNodeToJS(n, null, isAsync, tracked);
    if (code) lines.push(indent(code));
  }
  setVskForceClaim(false);
  if (node.alternateNodes.length > 0) {
    lines.push(`} else {`);
    setVskForceClaim(true);
    for (const n of node.alternateNodes) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    setVskForceClaim(false);
  }
  lines.push(`}`);
  return lines.join('\n');
}

function mapRegionToJS(node: MapRegion, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const arr = exprJSX(node.expression, tracked);
  const item = node.itemVariable;
  // In hydration SSR, stamp each keyed item root with `data-vsk-key` so the
  // client can claim items by key instead of rebuilding them. The binding is
  // injected into a shadow copy of the item root at codegen time — it flows
  // through the existing dynamic-attribute machinery (which also forces a
  // claim marker on otherwise-static roots).
  const bodyForItem: IRNode[] = __vskHydrate && !__vskMarkerless && node.keyExpr ? keyedItemTemplate(node) : node.bodyTemplate;

  const hasAlternate = node.alternateNodes.length > 0;
  const arrVar = hasAlternate ? `__a${nextVskId()}` : null;

  if (hasAlternate) {
    lines.push(`const ${arrVar} = ${arr};`);
    lines.push(`if (${arrVar} == null || ${arrVar}.length === 0) {`);
    for (const n of node.alternateNodes) {
      setVskForceClaim(true);
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    setVskForceClaim(false);
    lines.push(`} else {`);
  }

  const loopArr = arrVar || arr;
  if (node.indexVariable) {
    lines.push('let __i = 0;');
    lines.push(`for (const ${item} of ${loopArr}) {`);
    lines.push(indent(`const ${node.indexVariable} = __i;`));
    for (const n of bodyForItem) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(indent('__i++;'));
    lines.push(`}`);
  } else {
    lines.push(`for (const ${item} of ${loopArr}) {`);
    for (const n of bodyForItem) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  }

  if (hasAlternate) {
    lines.push(`}`);
  }
  return lines.join('\n');
}

/**
 * Returns a per-item body where the item root element (the first top-level
 * StaticNode) carries an injected `data-vsk-key` dynamic attribute matching
 * the map's `keyExpr`. Only the common case — an element as the item root —
 * is supported; other root shapes (conditionals/components) render without a
 * key and degrade to fresh rendering, exactly as before.
 */
function keyedItemTemplate(node: MapRegion): IRNode[] {
  if (!node.keyExpr) return node.bodyTemplate;
  const template = node.bodyTemplate;
  const idx = template.findIndex((n) => n instanceof StaticNode);
  if (idx === -1) return template;
  const root = template[idx] as StaticNode;
  const copy = new StaticNode(root.tag, root.attributes, [...root.children, new DynamicBinding(node.keyExpr, 'attribute', 'data-vsk-key')], root.keyExpr);
  copy.selfClosing = root.selfClosing;
  const out = template.slice();
  out[idx] = copy;
  return out;
}

function whileLoopToJS(node: WhileLoop, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  if (node.isDoWhile) {
    lines.push(`do {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`} while (${exprJSX(node.condition, tracked)});`);
  } else {
    lines.push(`while (${exprJSX(node.condition, tracked)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

function switchBlockToJS(node: SwitchBlock, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  lines.push(`switch (${exprJSX(node.discriminant, tracked)}) {`);
  for (const c of node.cases) {
    if (c.test) {
      lines.push(`case ${exprJSX(c.test, tracked)}:`);
    } else {
      lines.push(`default:`);
    }
    for (const n of c.body) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code, 2));
    }
    lines.push(indent('break;', 2));
  }
  lines.push(`}`);
  return lines.join('\n');
}

function tryCatchToJS(node: TryCatch, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const catchParam = node.catchParamName || '__e';
  lines.push(`try {`);
  for (const n of node.bodyTemplate) {
    const code = irNodeToJS(n, null, isAsync, tracked);
    if (code) lines.push(indent(code));
  }
  if (node.catchBody.length > 0) {
    lines.push(`} catch (${catchParam}) {`);
    for (const n of node.catchBody) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function forLoopToJS(node: ForLoop, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  if (node.kind === 'for-in') {
    const arr = exprJSX(node.condition, tracked);
    lines.push(`for (${node.init} of (Array.isArray(${arr}) ? ${arr} : (${arr} == null ? [] : Object.keys(${arr})))) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  } else {
    // Emit a real `for` statement (matching the client codegen): a `let`/`const`
    // declared in the init clause gets a fresh binding per iteration, so closures
    // created in the body capture that iteration's value rather than the loop
    // variable's final value after the last pass.
    let initPart = (node.init || '').trim();
    let updatePart = (node.update || '').trim();
    if (initPart.endsWith(';')) initPart = initPart.slice(0, -1).trim();
    if (updatePart.endsWith(';')) updatePart = updatePart.slice(0, -1).trim();
    const cond = exprJSX(node.condition, tracked);
    const head = initPart ? `${initPart}; ${cond}` : `; ${cond}`;
    lines.push(`for (${head}; ${updatePart}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

function componentCallToJS(node: ComponentCall, importedNames: Set<string> | null | undefined, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const propsEntries: string[] = node.props.map((p) => {
    if (typeof p.value === 'string') return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`;
    return `${JSON.stringify(p.name)}: ${exprJSX(p.value, tracked)}`;
  });
  for (const sp of node.spreadProps) {
    propsEntries.push(`...${exprJSX(sp, tracked)}`);
  }
  const lines: string[] = [];
  // Named content slots (`trigger={<Button/>}`) thread through the same channel
  // as `children`: a closed-over IIFE that serializes the slot body to a string.
  const slotChildren = node.children.filter((c): c is PropSlot => c instanceof PropSlot);
  const regularChildren = node.children.filter((c) => !(c instanceof PropSlot));
  for (const slot of slotChildren) {
    const slotLines: string[] = [];
    for (const child of slot.body) {
      const code = irNodeToJS(child, importedNames, isAsync, tracked);
      if (code) slotLines.push(code);
    }
    if (slotLines.length > 0) {
      const slotVar = `__sl${nextVskId()}`;
      propsEntries.push(`${JSON.stringify(slot.propName)}: ${slotVar}`);
      lines.push(`const ${slotVar} = ${isAsync ? 'await (async ' : '('}() => {`);
      lines.push(`const __out = [];`);
      lines.push(indent(slotLines.join('\n')));
      lines.push(`return __out.join(''); })();`);
    }
  }
  if (regularChildren.length > 0) {
    const childLines: string[] = [];
    for (const child of regularChildren) {
      const code = irNodeToJS(child, importedNames, isAsync, tracked);
      if (code) childLines.push(code);
    }
    if (childLines.length > 0) {
      const childrenVar = `__ch${nextVskId()}`;
      propsEntries.push(`children: ${childrenVar}`);
      lines.push(`const ${childrenVar} = ${isAsync ? 'await (async ' : '('}() => {`);
      lines.push(`const __out = [];`);
      lines.push(indent(childLines.join('\n')));
      lines.push(`return __out.join(''); })();`);
    }
  }
  const propsObj = `{ ${propsEntries.join(', ')} }`;
  const compName = node.componentName;
  // Member-expression tags (`<it.icon>`) carry the raw component-valued
  // expression — invoke it directly; it is never a registry name.
  const callee = node.calleeExpr
    ? `(${node.calleeExpr})`
    : (() => {
      const isImported = importedNames && importedNames.has(compName);
      return isImported ? compName : `__registry.get(${JSON.stringify(compName)})`;
    })();
  const awaitKw = isAsync ? 'await ' : '';
  // Hoist the callee so its defining-file scope (`__veskScope`, attached in
  // server-render.ts) is preferred over the merged caller scope. Same-named
  // top-level bindings in different `.vsk` files must not leak across
  // components during SSR.
  const calleeVar = `__cc${nextVskId()}`;
  lines.push(`const ${calleeVar} = ${callee};`);
  // Registry lookups can resolve to `undefined` when a JSX tag names a
  // component that was never declared, imported, or registered at runtime
  // (e.g. `<Slot/>` in a framework where `{props.children}` is the channel).
  // Guard the hoisted callee so the failure is an actionable message instead
  // of `Cannot read properties of undefined (reading '__veskScope')` mid-deref.
  if (!node.calleeExpr) {
    lines.push(`if (${calleeVar} == null) throw new Error(${JSON.stringify(`Component "${compName}" was not found while rendering SSR HTML. Declare it with the \`component\` keyword, import it, or register it in the component registry.`)});`);
  }
  const callExpr = `${awaitKw}${calleeVar}(${propsObj}, __registry, (${calleeVar}.__veskScope || __vesk))`;
  if (__vskHydrate && !__vskMarkerless) {
    lines.push(`__out.push(${JSON.stringify(componentMarker(compName))} + (${callExpr} || ''));`);
  } else {
    lines.push(`__out.push(${callExpr} || '');`);
  }
  return lines.join('\n');
}

export function generateFunctionBody(comp: ComponentIR, importedNames: Set<string>): string {
  const tracked = collectTrackedNames(comp.body);
  const asyncMode = comp.isAsync || comp.ssrAwait;
  __currentCompName = comp.name;
  const lines: string[] = [];
  lines.push(`const __sa = (__vesk && __vesk.setActiveComponent) || ((c) => { globalThis.__vesk_ctx = c; });`);
  lines.push(`const __ga = (__vesk && __vesk.getActiveComponent) || (() => globalThis.__vesk_ctx);`);
  lines.push(`const __prev = __ga();`);
  lines.push(`__sa({ c: null, p: __prev });`);
  lines.push(`try {`);
  lines.push(`const __escape = (s) => { s = String(s); return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split(${JSON.stringify('"')}).join('&quot;'); };`);
  lines.push(`const __styleText = (v) => { if (typeof v === 'string') return v; if (v && typeof v === 'object') { let s = ''; for (const k in v) { const x = v[k]; if (x == null || x === false) continue; s += k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + ':' + x + ';'; } return s; } return String(v); };`);
  lines.push(`const __attr = (n, v) => (v == null || v === false) ? '' : ' ' + n + '="' + __escape(n === 'style' ? __styleText(v) : String(v)) + '"';`);
  lines.push(`const raw = (s) => s == null ? '' : String(s);`);
  lines.push(`const __tk = globalThis.__vsk_ssr_token || '';`);

  if (asyncMode) {
    lines.push(`const __pk = __tk ? '__vsk_ssr_promises_' + __tk : '__vsk_ssr_promises';`);
    lines.push(`let __out = [];`);
    lines.push(`for (let __pass = 0; __pass < 3; __pass++) {`);
    lines.push(`__out = [];`);
    lines.push(`const __start = (globalThis[__pk] || []).length;`);
  } else {
    lines.push(`const __out = [];`);
  }

  if (comp.style) {
    lines.push(`__out.push('<style>');`);
    lines.push(`__out.push(${JSON.stringify(comp.style)});`);
    lines.push(`__out.push('</style>');`);
  }

  for (const node of comp.body) {
    const code = irNodeToJS(node, importedNames, asyncMode, tracked);
    if (code) lines.push(code);
  }

  if (asyncMode) {
    lines.push(`const __all = globalThis[__pk] || [];`);
    lines.push(`if (__all.length <= __start) return __out.join('');`);
    lines.push(`const __ps = __all.slice(__start);`);
    lines.push(`globalThis[__pk] = __all.slice(0, __start);`);
    lines.push(`await Promise.allSettled(__ps);`);
    lines.push(`}`);
    lines.push(`return __out.join('');`);
  } else {
    lines.push(`return __out.join('');`);
  }
  lines.push(`} finally {`);
  lines.push(`__sa(__prev);`);
  lines.push(`}`);
  __currentCompName = '';
  return lines.join('\n');
}

export interface ComponentMapEntry {
  name: string;
  source: string;
  isAsync: boolean;
}

/**
 * Builds the compiled body source for every component in an IR root. Used by
 * both `buildComponentMap` (live functions) and `precompile.ts` (AOT SSR plans
 * that reconstruct the same functions at function-bundle load time).
 */
export function buildComponentEntries(irRoot: IRRoot): ComponentMapEntry[] {
  const runtimeNames = extractRuntimeNames(irRoot.imports);
  const localValueNames = localValueImportNames(irRoot.imports);
  const topNames = extractTopLevelNames(irRoot.topLevelCode);
  // Top-level value bindings (`const MyIcon = Cpu`) are destructured into
  // every component scope from `__vesk` (see `scopeDecl` below), so a
  // same-named JSX tag must invoke that in-scope value directly — not a
  // registry lookup. File-defined components keep registry precedence.
  const componentNames = new Set(irRoot.components.map((c) => c.name));
  const topValueNames = topNames.filter((n) => !componentNames.has(n));
  const importedNames = new Set([...runtimeNames, ...localValueNames, ...topValueNames]);
  const hasTracked = irRoot.components.some((c) => c.body.some((n) => n instanceof TrackDecl));
  const extraNames = hasTracked ? ['get', 'set', 'track'] : [];
  const allNames = [...new Set([...runtimeNames, ...topNames, ...extraNames, ...localValueNames])];
  const scopeDecl = allNames.length > 0 ? `const { ${allNames.join(', ')} } = __vesk;\n` : '';
  setVskImportedNames(importedNames);
  const entries: ComponentMapEntry[] = [];
  for (const comp of irRoot.components) {
    const bodyCode = generateFunctionBody(comp, importedNames);
    const paramInit = buildParamInit(comp.paramNames, comp.propsAlias);
    const diag = process.env.VESK_SSR_LOG
      ? `console.error('[SSR-CALL]', ${JSON.stringify(comp.name)}, props ? JSON.stringify(props) : String(props));\n`
      : '';
    const code = `${scopeDecl}${paramInit}${diag}\n${bodyCode}`;
    entries.push({ name: comp.name, source: code, isAsync: comp.isAsync || comp.ssrAwait });
  }
  setVskImportedNames(null);
  return entries;
}

export function buildComponentMap(irRoot: IRRoot, useSharedScope: boolean): Map<string, Function> {
  const map = new Map<string, Function>();
  for (const entry of buildComponentEntries(irRoot)) {
    let fn: Function;
    if (entry.isAsync) {
      fn = new Function('props', '__registry', '__vesk', `return (async () => {\n${entry.source}\n})()`);
    } else {
      fn = new Function('props', '__registry', '__vesk', entry.source);
    }
    map.set(entry.name, fn);
  }
  return map;
}
