import type { IRNode, ComponentIR, IRRoot } from '@vesk/compiler/src/ir';
import {
  StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
  MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
  TrackDecl, RuntimeStatement, ComponentRef, ComponentCall,
  ServerBlock, ClientBlock, HeadBlock, SlotNode,
} from '@vesk/compiler/src/ir';
import { isStaticIR, collectTrackedNames, transformTracked, semicolonizeStatement, type TrackedInfo } from '@vesk/compiler/src/client-codegen';
import { walk } from 'zimmerframe';
import type { Node as ESTreeNode } from 'estree';
import { unwrapTrackCall, stripTrackGeneric, hasTopLevelComma, skipWhitespace, findBalancedEnd, startsWithIdentifier } from '@vesk/compiler/src/scan';
import {
  isStatic, escapeHtml, indent, exprJS,
  extractTopLevelNames, extractRuntimeNames, buildParamInit,
  __vskHydrate, __vskImportedNames, setVskImportedNames, setVskForceClaim, takeVskForceClaim, nextVskId,
} from '@vesk/compiler/src/server-utils';

export function irNodeToJS(node: IRNode, importedNames?: Set<string> | null, isAsync: boolean = false, tracked?: Map<string, TrackedInfo>): string {
  importedNames = importedNames || __vskImportedNames;
  if (node instanceof StaticNode) return staticNodeToJS(node, isAsync, tracked);
  if (node instanceof TextNode) {
    if (!node.value) return '';
    return `__out.push(${JSON.stringify(node.value)});`;
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
    const unwrapped = unwrapTrackCall(node.init);
    const inner = hasTopLevelComma(unwrapped) ? stripTrackGeneric(node.init) : unwrapped;
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
  if (node instanceof SlotNode) return `__out.push(props.children || '');`;
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
  const dynAttrOrder: string[] = [];
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== null && child.target !== 'ref') {
      if (isEvent(child.target)) continue;
      dynAttrTargets.add(child.target);
      dynAttrOrder.push(child.target);
    }
  }
  const hasDynamicAttrs = dynAttrTargets.size > 0;

  let openTag = `<${node.tag}`;
  const forceClaim = takeVskForceClaim();
  const subtreeNeedsJS = __vskHydrate && (forceClaim || !isStaticIR(node.children));
  if (subtreeNeedsJS) {
    lines.push(`__out.push('<!--vsk-->');`);
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
  for (const target of dynAttrOrder) {
    openTag += ` ${target}=""`;
  }

  if (node.selfClosing) {
    let tag = openTag + ' />';
    if (hasDynamicAttrs) {
      let expr = JSON.stringify(tag);
      for (const child of node.children) {
        if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref' && !isEvent(child.target)) {
          const val = `__escape(String(${exprJSX(child.expression, tracked)}))`;
          expr = `${expr}.replace(${JSON.stringify(' ' + child.target + '=""')}, ' ' + ${JSON.stringify(child.target)} + '=\"' + ${val} + '\"')`;
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
        const val = `__escape(String(${exprJSX(child.expression, tracked)}))`;
        expr = `${expr}.replace(${JSON.stringify(' ' + child.target + '=""')}, ' ' + ${JSON.stringify(child.target)} + '=\"' + ${val} + '\"')`;
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
  for (const n of node.consequentNodes) {
    const code = irNodeToJS(n, null, isAsync, tracked);
    if (code) lines.push(indent(code));
  }
  if (node.alternateNodes.length > 0) {
    lines.push(`} else {`);
    for (const n of node.alternateNodes) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function mapRegionToJS(node: MapRegion, isAsync = false, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const arr = exprJSX(node.expression, tracked);
  const item = node.itemVariable;

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
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(indent('__i++;'));
    lines.push(`}`);
  } else {
    lines.push(`for (const ${item} of ${loopArr}) {`);
    for (const n of node.bodyTemplate) {
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
    if (node.init) lines.push(`${node.init}`);
    lines.push(`while (${exprJSX(node.condition, tracked)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, isAsync, tracked);
      if (code) lines.push(indent(code));
    }
    if (node.update) lines.push(indent(`${node.update}`));
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
  if (node.children.length > 0) {
    const childLines: string[] = [];
    for (const child of node.children) {
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
  const isImported = importedNames && importedNames.has(compName);
  const callee = isImported ? compName : `__registry.get(${JSON.stringify(compName)})`;
  const awaitKw = isAsync ? 'await ' : '';
  if (__vskHydrate) {
    lines.push(`__out.push('<!--vsk--><div>' + (${awaitKw}${callee}(${propsObj}, __registry, __vesk) || '') + '</div>');`);
  } else {
    lines.push(`__out.push(${awaitKw}${callee}(${propsObj}, __registry, __vesk) || '');`);
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
  lines.push(`const __escape = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\x22/g,'&quot;');`);
  lines.push(`const raw = (s) => s == null ? '' : String(s);`);
  lines.push(`const __tk = globalThis.__vsk_ssr_token || '';`);

  if (asyncMode) {
    lines.push(`const __pk = __tk ? '__vsk_ssr_promises_' + __tk : '__vsk_ssr_promises';`);
    lines.push(`for (let __pass = 0; __pass < 3; __pass++) {`);
    lines.push(`const __out = [];`);
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
    lines.push(`return '';`);
  } else {
    lines.push(`return __out.join('');`);
  }
  lines.push(`} finally {`);
  lines.push(`__sa(__prev);`);
  lines.push(`}`);
  __currentCompName = '';
  return lines.join('\n');
}

export function buildComponentMap(irRoot: IRRoot, useSharedScope: boolean): Map<string, Function> {
  const map = new Map<string, Function>();
  const runtimeNames = extractRuntimeNames(irRoot.imports);
  const importedNames = new Set(runtimeNames);
  const topNames = extractTopLevelNames(irRoot.topLevelCode);
  const hasTracked = irRoot.components.some((c) => c.body.some((n) => n instanceof TrackDecl));
  const extraNames = hasTracked ? ['get', 'set', 'track'] : [];
  const allNames = [...new Set([...runtimeNames, ...topNames, ...extraNames])];
  const scopeDecl = allNames.length > 0 ? `const { ${allNames.join(', ')} } = __vesk;\n` : '';
  setVskImportedNames(importedNames);
  for (const comp of irRoot.components) {
    const bodyCode = generateFunctionBody(comp, importedNames);
    const paramInit = buildParamInit(comp.paramNames);
    const code = `${scopeDecl}${paramInit}\n${bodyCode}`;
    let fn: Function;
    if (comp.isAsync || comp.ssrAwait) {
      fn = new Function('props', '__registry', '__vesk', `return (async () => {\n${code}\n})()`);
    } else {
      fn = new Function('props', '__registry', '__vesk', code);
    }
    map.set(comp.name, fn);
  }
  setVskImportedNames(null);
  return map;
}
