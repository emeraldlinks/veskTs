import type { IRNode, ComponentIR, IRRoot } from './ir.js';
import {
  StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
  MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
  TrackDecl, RuntimeStatement, ComponentRef, ComponentCall,
  ServerBlock, ClientBlock, HeadBlock, SlotNode,
} from './ir.js';
import { isStaticIR } from './client-codegen.js';
import {
  isStatic, escapeHtml, indent, exprJS, childrenToHTML,
  extractTopLevelNames, extractRuntimeNames, buildParamInit,
  __vskHydrate, __vskImportedNames, setVskImportedNames,
} from './server-utils.js';

export function irNodeToJS(node: IRNode, importedNames?: Set<string> | null, isAsync: boolean = false): string {
  importedNames = importedNames || __vskImportedNames;
  if (node instanceof StaticNode) return staticNodeToJS(node);
  if (node instanceof TextNode) {
    if (!node.value) return '';
    return `__out.push(${JSON.stringify(node.value)});`;
  }
  if (node instanceof DynamicBinding) return dynamicBindingToJS(node);
  if (node instanceof OpaqueDynamicRegion) return opaqueRegionToJS(node);
  if (node instanceof MapRegion) return mapRegionToJS(node);
  if (node instanceof WhileLoop) return whileLoopToJS(node);
  if (node instanceof SwitchBlock) return switchBlockToJS(node);
  if (node instanceof TryCatch) return tryCatchToJS(node);
  if (node instanceof ComponentRef) return '';
  if (node instanceof ComponentCall) return componentCallToJS(node, importedNames, isAsync);
  if (node instanceof ServerBlock) {
    const lines: string[] = [];
    for (const n of node.children) {
      const code = irNodeToJS(n, importedNames, isAsync);
      if (code) lines.push(code);
    }
    return lines.join('\n');
  }
  if (node instanceof ClientBlock) return '';
  if (node instanceof HeadBlock) return '';
  if (node instanceof ForLoop) return forLoopToJS(node);
  if (node instanceof TrackDecl) {
    const inner = node.init.replace(/^track\(/, '').replace(/\)$/, '');
    return `const ${node.name} = (() => { try { const __v = (${inner}); return typeof __v === 'function' ? __v() : __v; } catch(e) { return void 0; } })();`;
  }
  if (node instanceof RuntimeStatement) return node.raw;
  if (node instanceof SlotNode) return `__out.push(props.children || '');`;
  return '';
}

function staticNodeToJS(node: StaticNode): string {
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
    const code = irNodeToJS(child);
    if (code) lines.push(code);
  }

  lines.push(`__out.push(${JSON.stringify('</' + node.tag + '>')});`);
  return lines.join('\n');
}

function dynamicBindingToJS(node: DynamicBinding): string {
  if (node.kind === 'attribute') return '';
  const raw = node.expression.raw;
  const isRaw = /^\s*raw\s*\(/.test(raw);
  if (isRaw) {
    const inner = raw.replace(/^\s*raw\s*\(/, '').replace(/\)\s*$/, '');
    return `{ const __v = ${exprJS(inner)}; if (__v != null) __out.push(typeof __v === 'boolean' ? 'true' : String(__v)); }`;
  }
  return `{ const __v = ${exprJS(raw)}; if (__v != null) __out.push(typeof __v === 'boolean' ? (__v ? 'true' : '') : __escape(String(__v))); }`;
}

function opaqueRegionToJS(node: OpaqueDynamicRegion): string {
  const lines: string[] = [];
  const cond = exprJS(node.condition.raw);
  lines.push(`if (${cond}) {`);
  for (const n of node.consequentNodes) {
    const code = irNodeToJS(n);
    if (code) lines.push(indent(code));
  }
  if (node.alternateNodes.length > 0) {
    lines.push(`} else {`);
    for (const n of node.alternateNodes) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function mapRegionToJS(node: MapRegion): string {
  const lines: string[] = [];
  const arr = exprJS(node.expression.raw);
  const item = node.itemVariable;
  lines.push(`for (const ${item} of ${arr}) {`);
  for (const n of node.bodyTemplate) {
    const code = irNodeToJS(n);
    if (code) lines.push(indent(code));
  }
  lines.push(`}`);
  return lines.join('\n');
}

function whileLoopToJS(node: WhileLoop): string {
  const lines: string[] = [];
  if (node.isDoWhile) {
    lines.push(`do {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
    lines.push(`} while (${exprJS(node.condition.raw)});`);
  } else {
    lines.push(`while (${exprJS(node.condition.raw)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  }
  return lines.join('\n');
}

function switchBlockToJS(node: SwitchBlock): string {
  const lines: string[] = [];
  lines.push(`switch (${exprJS(node.discriminant.raw)}) {`);
  for (const c of node.cases) {
    if (c.test) {
      lines.push(`case ${exprJS(c.test.raw)}:`);
    } else {
      lines.push(`default:`);
    }
    for (const n of c.body) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code, 2));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function tryCatchToJS(node: TryCatch): string {
  const lines: string[] = [];
  const catchParam = node.catchParamName || '__e';
  lines.push(`try {`);
  for (const n of node.bodyTemplate) {
    const code = irNodeToJS(n);
    if (code) lines.push(indent(code));
  }
  if (node.catchBody.length > 0) {
    lines.push(`} catch (${catchParam}) {`);
    for (const n of node.catchBody) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
  }
  lines.push(`}`);
  return lines.join('\n');
}

function forLoopToJS(node: ForLoop): string {
  const lines: string[] = [];
  if (node.kind === 'for-in') {
    lines.push(`for (${node.init} in ${exprJS(node.condition.raw)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
    lines.push(`}`);
  } else {
    if (node.init) lines.push(`${node.init}`);
    lines.push(`while (${exprJS(node.condition.raw)}) {`);
    for (const n of node.bodyTemplate) {
      const code = irNodeToJS(n);
      if (code) lines.push(indent(code));
    }
    if (node.update) lines.push(indent(`${node.update}`));
    lines.push(`}`);
  }
  return lines.join('\n');
}

function componentCallToJS(node: ComponentCall, importedNames: Set<string> | null | undefined, isAsync = false): string {
  const propsEntries: string[] = node.props.map((p) => {
    if (typeof p.value === 'string') return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`;
    return `${JSON.stringify(p.name)}: ${exprJS(p.value.raw)}`;
  });
  for (const sp of node.spreadProps) {
    propsEntries.push(`...${exprJS(sp.raw)}`);
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
  const lines: string[] = [];
  lines.push(`const __sa = (__vesk && __vesk.setActiveComponent) || ((c) => { globalThis.__vesk_ctx = c; });`);
  lines.push(`const __ga = (__vesk && __vesk.getActiveComponent) || (() => globalThis.__vesk_ctx);`);
  lines.push(`const __prev = __ga();`);
  lines.push(`__sa({ c: null, p: __prev });`);
  lines.push(`try {`);
  lines.push(`const __out = [];`);
  lines.push(`const __escape = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\x22/g,'&quot;');`);
  lines.push(`const raw = (s) => s == null ? '' : String(s);`);

  if (comp.style) {
    lines.push(`__out.push('<style>');`);
    lines.push(`__out.push(${JSON.stringify(comp.style)});`);
    lines.push(`__out.push('</style>');`);
  }

  for (const node of comp.body) {
    const code = irNodeToJS(node, importedNames, comp.isAsync);
    if (code) lines.push(code);
  }

  lines.push(`return __out.join('');`);
  lines.push(`} finally {`);
  lines.push(`__sa(__prev);`);
  lines.push(`}`);
  return lines.join('\n');
}

export function buildComponentMap(irRoot: IRRoot, useSharedScope: boolean): Map<string, Function> {
  const map = new Map<string, Function>();
  const runtimeNames = extractRuntimeNames(irRoot.imports);
  const importedNames = new Set(runtimeNames);
  const topNames = extractTopLevelNames(irRoot.topLevelCode);
  const allNames = [...new Set([...runtimeNames, ...topNames])];
  const scopeDecl = allNames.length > 0 ? `const { ${allNames.join(', ')} } = __vesk;\n` : '';
  setVskImportedNames(importedNames);
  for (const comp of irRoot.components) {
    const bodyCode = generateFunctionBody(comp, importedNames);
    const paramInit = buildParamInit(comp.paramNames);
    const code = `${scopeDecl}${paramInit}\n${bodyCode}`;
    let fn: Function;
    if (comp.isAsync) {
      fn = new Function('props', '__registry', '__vesk', `return (async () => {\n${code}\n})()`);
    } else {
      fn = new Function('props', '__registry', '__vesk', code);
    }
    map.set(comp.name, fn);
  }
  setVskImportedNames(null);
  return map;
}
