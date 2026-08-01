import type { IRNode, ComponentIR, IRRoot } from '@vesk/compiler/src/ir';
import {
  StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
  MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
  TrackDecl, RuntimeStatement, ComponentRef, ComponentCall,
  ServerBlock, ClientBlock, HeadBlock, SlotNode,
} from '@vesk/compiler/src/ir';
import { isStaticIR, collectTrackedNames, transformTracked, type TrackedInfo } from '@vesk/compiler/src/client-codegen';
import { walk } from 'zimmerframe';
import type { Node as ESTreeNode } from 'estree';
import {
  isStatic, escapeHtml, indent, exprJS, childrenToHTML,
  extractTopLevelNames, extractRuntimeNames, buildParamInit,
  __vskHydrate, __vskImportedNames, setVskImportedNames,
} from '@vesk/compiler/src/server-utils';

export function irNodeToJS(node: IRNode, importedNames?: Set<string> | null, isAsync: boolean = false, tracked?: Map<string, TrackedInfo>): string {
  importedNames = importedNames || __vskImportedNames;
  if (node instanceof StaticNode) return staticNodeToJS(node, tracked);
  if (node instanceof TextNode) {
    if (!node.value) return '';
    return `__out.push(${JSON.stringify(node.value)});`;
  }
  if (node instanceof DynamicBinding) return dynamicBindingToJS(node, tracked);
  if (node instanceof OpaqueDynamicRegion) return opaqueRegionToJS(node, tracked);
  if (node instanceof MapRegion) return mapRegionToJS(node, tracked);
  if (node instanceof WhileLoop) return whileLoopToJS(node, tracked);
  if (node instanceof SwitchBlock) return switchBlockToJS(node, tracked);
  if (node instanceof TryCatch) return tryCatchToJS(node, tracked);
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
  if (node instanceof ForLoop) return forLoopToJS(node, tracked);
  if (node instanceof TrackDecl) {
    const cellName = node.rawName || node.name;
    const init = node.init.trim();
    let inner = init;
    const m = init.match(/^track\s*(?:<[^>]*>)?\s*\(([\s\S]*)\)\s*$/);
    if (m) inner = m[1];
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
  if (node instanceof RuntimeStatement) return transformTracked(node as any, tracked || new Map());
  if (node instanceof SlotNode) return `__out.push(props.children || '');`;
  return '';
}

let __currentCompName = '';

function compKey(_node: TrackDecl): string {
  return __currentCompName || 'comp';
}

function exprJSX(node: { raw: string; ast: ESTreeNode | null }, tracked?: Map<string, TrackedInfo>): string {
  const code = tracked && tracked.size > 0 ? transformTracked(node as any, tracked) : node.raw;
  return exprJS(code);
}

function trackedExprRefs(node: { raw: string; ast: ESTreeNode | null }, tracked?: Map<string, TrackedInfo>): boolean {
  if (!tracked || tracked.size === 0 || !node.ast) return false;
  let found = false;
  walk(node.ast, null, {
    Identifier(n: any) {
      const info = tracked.get(n.name);
      if (info && info.kind === 'virtual') found = true;
    },
  });
  return found;
}

function staticNodeToJS(node: StaticNode, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];

  const dynAttrTargets = new Set<string>();
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== null && child.target !== 'ref') {
      dynAttrTargets.add(child.target);
    }
  }
  const hasDynamicAttrs = dynAttrTargets.size > 0;

  let openTag = `<${node.tag}`;
  const subtreeNeedsJS = __vskHydrate && !isStaticIR(node.children);
  if (subtreeNeedsJS) {
    lines.push(`__out.push('<!--vsk-->');`);
  }
  for (const attr of node.attributes) {
    if (attr.name.startsWith('on') && attr.name.length > 2) continue;
    if (attr.value === '' && !dynAttrTargets.has(attr.name)) {
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
        if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref') {
          const val = `__escape(String(${exprJS(child.expression.raw)}))`;
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
      if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref') {
        const val = `__escape(String(${exprJS(child.expression.raw)}))`;
        expr = `${expr}.replace(${JSON.stringify(' ' + child.target + '=""')}, ' ' + ${JSON.stringify(child.target)} + '=\"' + ${val} + '\"')`;
      }
    }
    lines.push(`__out.push(${expr});`);
    lines.push(`__out.push('>');`);
  } else {
    lines.push(`__out.push(${JSON.stringify(openTag + '>')});`);
  }

  for (const child of childNodes) {
    const code = irNodeToJS(child, null, false, tracked);
    if (code) lines.push(code);
  }

  lines.push(`__out.push(${JSON.stringify('</' + node.tag + '>')});`);
  return lines.join('\n');
}

function dynamicBindingToJS(node: DynamicBinding, tracked?: Map<string, TrackedInfo>): string {
  if (node.kind === 'attribute') return '';
  const raw = node.expression.raw;
  const isRaw = /^\s*raw\s*\(/.test(raw);
  if (isRaw) {
    const inner = raw.replace(/^\s*raw\s*\(/, '').replace(/\)\s*$/, '');
    const innerAst = (node.expression.ast as any)?.arguments?.[0] ?? null;
    return `{ const __v = ${exprJSX({ raw: inner, ast: innerAst }, tracked)}; if (__v != null) __out.push(typeof __v === 'boolean' ? 'true' : String(__v)); }`;
  }
  return `{ const __v = ${exprJSX(node.expression, tracked)}; if (__v != null) __out.push(typeof __v === 'boolean' ? (__v ? 'true' : '') : __escape(String(__v))); }`;
}

function opaqueRegionToJS(node: OpaqueDynamicRegion, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const cond = exprJSX(node.condition, tracked);
  lines.push(`if (${cond}) {`);
  for (const n of node.consequentNodes) {
    const code = irNodeToJS(n, null, false, tracked);
    if (code) lines.push(indent(code));
  }
  if (node.alternateNodes.length > 0) {
    lines.push(`} else {`);
    for (const n of node.alternateNodes) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function mapRegionToJS(node: MapRegion, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const arr = exprJSX(node.expression, tracked);
  const item = node.itemVariable;
  lines.push(`for (const ${item} of ${arr}) {`);
  for (const n of node.bodyTemplate) {
    const code = irNodeToJS(n, null, false, tracked);
    if (code) lines.push(indent(code));
  }
  lines.push(`}`);
  return lines.join('\n');
}

function whileLoopToJS(node: WhileLoop, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  if (node.isDoWhile) {
    lines.push(`do {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`} while (${exprJSX(node.condition, tracked)});`);
  } else {
    lines.push(`while (${exprJSX(node.condition, tracked)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

function switchBlockToJS(node: SwitchBlock, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  lines.push(`switch (${exprJSX(node.discriminant, tracked)}) {`);
  for (const c of node.cases) {
    if (c.test) {
      lines.push(`case ${exprJSX(c.test, tracked)}:`);
    } else {
      lines.push(`default:`);
    }
    for (const n of c.body) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code, 2));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function tryCatchToJS(node: TryCatch, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  const catchParam = node.catchParamName || '__e';
  lines.push(`try {`);
  for (const n of node.bodyTemplate) {
    const code = irNodeToJS(n, null, false, tracked);
    if (code) lines.push(indent(code));
  }
  if (node.catchBody.length > 0) {
    lines.push(`} catch (${catchParam}) {`);
    for (const n of node.catchBody) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function forLoopToJS(node: ForLoop, tracked?: Map<string, TrackedInfo>): string {
  const lines: string[] = [];
  if (node.kind === 'for-in') {
    const isTrackedLoop = trackedExprRefs(node.condition, tracked);
    const arr = exprJSX(node.condition, tracked);
    if (isTrackedLoop) {
      lines.push(`for (${node.init} of ${arr}) {`);
    } else {
      lines.push(`for (${node.init} in ${arr}) {`);
    }
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, false, tracked);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  } else {
    if (node.init) lines.push(`${node.init}`);
    lines.push(`while (${exprJSX(node.condition, tracked)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n, null, false, tracked);
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
  if (node.children.length > 0) {
    const childCode = childrenToHTML(node.children);
    propsEntries.push(`children: ${JSON.stringify(childCode)}`);
  }
  const propsObj = `{ ${propsEntries.join(', ')} }`;
  const compName = node.componentName;
  const isImported = importedNames && importedNames.has(compName);
  const callee = isImported ? compName : `__registry.get(${JSON.stringify(compName)})`;
  const awaitKw = isAsync ? 'await ' : '';
  if (__vskHydrate) {
    return `__out.push('<!--vsk--><div>' + (${awaitKw}${callee}(${propsObj}, __registry, __vesk) || '') + '</div>');`;
  }
  return `__out.push(${awaitKw}${callee}(${propsObj}, __registry, __vesk) || '');`;
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
    lines.push(`if (!(globalThis[__pk] && globalThis[__pk].length > 0)) return __out.join('');`);
    lines.push(`const __ps = globalThis[__pk].slice();`);
    lines.push(`globalThis[__pk] = [];`);
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
