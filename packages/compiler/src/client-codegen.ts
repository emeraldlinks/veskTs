import { walk } from 'zimmerframe';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import tsx from 'esrap/languages/tsx';
import type { IRNode, IRRoot, ComponentIR } from '@vesk/compiler/src/ir';
import {
  StaticNode,
  TextNode,
  DynamicBinding,
  OpaqueDynamicRegion,
  MapRegion,
  WhileLoop,
  SwitchBlock,
  TryCatch,
  ForLoop,
  TrackDecl,
  RuntimeStatement,
  ComponentRef,
  ComponentCall,
  ServerBlock,
  ClientBlock,
  HeadBlock,
  SlotNode,
} from '@vesk/compiler/src/ir';
import type { Expression } from '@vesk/compiler/src/ir';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { transformTopLevelForActions } from '@vesk/compiler/src/actions';
import { extractRuntimeNames } from '@vesk/compiler/src/server-utils';
import { stripTrackGeneric } from '@vesk/compiler/src/scan';
import { inlineMdImportsFrom } from '@vesk/compiler/src/md-inline';
import { stripTsTypes, hasTsSyntax } from '@vesk/compiler/src/strip-ts';

function memberExpr(object: string, property: string): Record<string, unknown> {
  return {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: object },
    property: { type: 'Identifier', name: property },
    computed: false,
    optional: false,
  };
}

function callExpr(callee: Record<string, unknown>, args: Record<string, unknown>[] = []): Record<string, unknown> {
  return { type: 'CallExpression', callee, arguments: args, optional: false };
}

/**
 * When `expr` is exactly `get(<word>)`, returns the word; otherwise `null`.
 * Used to substitute `get(tracked)` back to the raw tracked cell name.
 */
function simpleGetName(expr: string): string | null {
  if (!expr.startsWith('get(') || !expr.endsWith(')')) return null;
  const inner = expr.slice(4, -1);
  if (inner.length === 0) return null;
  for (let i = 0; i < inner.length; i++) {
    const code = inner.charCodeAt(i);
    const ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
    if (!ok) return null;
  }
  return inner;
}

export interface TrackedInfo {
  cellName: string;
  kind: 'virtual' | 'cell';
}

export function semicolonizeStatement(code: string): string {
  const trimmed = code.trimEnd();
  if (!trimmed || trimmed.endsWith(';') || trimmed.endsWith('}')) return code;
  return code + ';';
}

function containsJsx(node: any, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 40) return false;
  if (Array.isArray(node)) {
    for (const item of node) { if (containsJsx(item, depth + 1)) return true; }
    return false;
  }
  if (typeof node.type === 'string' && (node.type === 'JSXElement' || node.type === 'JSXFragment')) return true;
  for (const key of Object.keys(node)) {
    const v = (node as any)[key];
    if (v && typeof v === 'object' && containsJsx(v, depth + 1)) return true;
  }
  return false;
}

function printAst(ast: any): string {
  return print(ast, containsJsx(ast) ? tsx() : ts()).code;
}

export function transformTracked(irNode: Expression | RuntimeStatement | DynamicBinding, tracked: Map<string, TrackedInfo>): string {
  const ast = (irNode as any).ast;
  if (!ast) return (irNode as any).raw;
  if (tracked.size === 0) {
    if (!hasTsSyntax(ast)) return (irNode as any).raw;
    return printAst(stripTsTypes(ast));
  }
  const stripped = stripTsTypes(ast);

  const transformed = walk(stripped, tracked, {
    AssignmentExpression(node: any, context: any) {
      if (node.left.type === 'Identifier') {
        const info = context.state.get(node.left.name);
        if (info) {
          const right = context.visit(node.right);
          const setCall = { type: 'Identifier', name: 'set' } as const;
          if (node.operator === '=') {
            return callExpr(setCall, [
              { type: 'Identifier', name: info.cellName },
              right,
            ]);
          }
          const op = node.operator.slice(0, -1);
          const getCall = { type: 'Identifier', name: 'get' } as const;
          return callExpr(setCall, [
            { type: 'Identifier', name: info.cellName },
            {
              type: 'BinaryExpression',
              operator: op,
              left: callExpr(getCall, [
                { type: 'Identifier', name: info.cellName },
              ]),
              right,
            },
          ]);
        }
      }
      return context.next();
    },
    UpdateExpression(node: any, context: any) {
      if (node.argument.type === 'Identifier') {
        const info = context.state.get(node.argument.name);
        if (info) {
          const delta = node.operator === '++' ? 1 : -1;
          const setCall = { type: 'Identifier', name: 'set' } as const;
          const getCall = { type: 'Identifier', name: 'get' } as const;
          return callExpr(setCall, [
            { type: 'Identifier', name: info.cellName },
            {
              type: 'BinaryExpression',
              operator: '+',
              left: callExpr(getCall, [
                { type: 'Identifier', name: info.cellName },
              ]),
              right: { type: 'Literal', value: delta },
            },
          ]);
        }
      }
      return context.next();
    },
    Identifier(node: any, context: any) {
      const parent = context.path.at(-1);
      if (parent) {
        if (
          parent.type === 'AssignmentExpression' &&
          parent.left === node
        )
          return context.next();
        if (
          parent.type === 'UpdateExpression' &&
          parent.argument === node
        )
          return context.next();
        if (
          parent.type === 'Property' &&
          parent.value === node &&
          parent.key &&
          parent.key.type === 'Identifier' &&
          parent.key.name === 'into'
        )
          return context.next();
        if (
          parent.type === 'MemberExpression' &&
          !parent.computed &&
          parent.object === node &&
          parent.property &&
          parent.property.type === 'Identifier' &&
          parent.property.name === 'set'
        )
          return context.next();
      }
      const info = context.state.get(node.name);
      if (info && info.kind === 'virtual') {
        const getCall = { type: 'Identifier', name: 'get' } as const;
        return callExpr(getCall, [
          { type: 'Identifier', name: info.cellName },
        ]);
      }
      return context.next();
    },
  });

  return print(transformed, containsJsx(transformed) ? tsx() : ts()).code;
}

import type { Node as ESTreeNode } from 'estree';

export function collectTrackedNames(body: IRNode[]): Map<string, TrackedInfo> {
  const names = new Map<string, TrackedInfo>();
  for (const node of body) {
    if (node instanceof TrackDecl) {
      const cellName = node.rawName || node.name;
      names.set(node.name, { cellName, kind: 'virtual' });
      if (node.rawName) names.set(node.rawName, { cellName, kind: 'cell' });
    }
  }
  return names;
}

const NON_BUBBLING_EVENTS = new Set([
  'focus', 'blur',
  'mouseenter', 'mouseleave',
  'scroll', 'resize',
  'load', 'error', 'unload', 'abort',
  'play', 'pause', 'ended', 'waiting',
  'canplay', 'canplaythrough', 'durationchange', 'emptied',
  'loadeddata', 'loadedmetadata', 'loadstart',
  'playing', 'progress', 'ratechange', 'seeked', 'seeking',
  'stalled', 'suspend', 'timeupdate', 'volumechange',
  'toggle',
]);

function indent(code: string, level = 1): string {
  const pad = '\t'.repeat(level);
  return code.split('\n').map((l) => (l ? pad + l : '')).join('\n');
}

class Ctx {
  lines: string[] = [];
  effects: string[] = [];
  c = 0;
  importedNames = new Set<string>();
  delegatedEvents = new Set<string>();
  directEvents = new Set<string>();
  hydrate = false;
  inTryBody = false;
  claimStatic = false;
  walker = '__hydrate';
  asyncComps = new Set<string>();
  isAsyncScope = false;

  push(...args: (string | null | undefined | false)[]): void {
    for (const a of args) if (a) this.lines.push(a as string);
  }
  n(): string { return `$n${this.c++}`; }
  getCode(): string { return this.lines.join('\n'); }
  flushEffects(): string {
    if (this.effects.length === 0) return '';
    return '\n' + this.effects.join('\n');
  }
  emitDelegates(): string {
    if (this.delegatedEvents.size === 0 && this.directEvents.size === 0) return '';
    const lines: string[] = [];
    for (const type of this.delegatedEvents) {
      const guard = `__vesk_dlg_${type}`;
      const prop = `__evh_${type}`;
      lines.push(`if (!document.${guard}) {`);
      lines.push(`\tdocument.${guard} = true;`);
      lines.push(`\tdocument.addEventListener(${JSON.stringify(type)}, (e) => {`);
      lines.push(`\t\tvar el = e.target.closest('[data-vsk-ev]');`);
      lines.push(`\t\tif (el && el.${prop}) el.${prop}(e);`);
      lines.push(`\t});`);
      lines.push(`}`);
    }
    return '\n' + lines.join('\n');
  }
}

function emitNode(ctx: Ctx, node: IRNode, tracked: Map<string, TrackedInfo>, effectsVar: string | null, parentVar?: string, compPrefix = '__components'): string | null {
  if (node instanceof StaticNode) return emitStatic(ctx, node, tracked, effectsVar);
  if (node instanceof TextNode) {
    if (!node.value) return null;
    const v = ctx.n();
    ctx.push(`const ${v} = document.createTextNode(${JSON.stringify(node.value)});`);
    return v;
  }
  if (node instanceof DynamicBinding) return emitDynamicBinding(ctx, node, tracked, effectsVar);
  if (node instanceof TrackDecl) {
    const cellName = node.rawName || node.name;
    const init = stripTrackGeneric(node.init);
    ctx.push(`const ${cellName} = ${init};`);
    return null;
  }
  if (node instanceof ComponentRef) return null;
  if (node instanceof ComponentCall) return emitComponentCall(ctx, node, tracked, effectsVar, parentVar, compPrefix);
  if (node instanceof OpaqueDynamicRegion) return emitOpaque(ctx, node, tracked, parentVar);
  if (node instanceof MapRegion) return emitMap(ctx, node, tracked, parentVar);
  if (node instanceof ServerBlock) return null;
  if (node instanceof ClientBlock) {
    const savedHydrate = ctx.hydrate;
    ctx.hydrate = false;
    let lastVar: string | null = null;
    for (const n of node.children) {
      lastVar = emitNode(ctx, n, tracked, null, parentVar);
    }
    ctx.hydrate = savedHydrate;
    return lastVar;
  }
  if (node instanceof HeadBlock) {
    emitClientHead(ctx, node, tracked);
    return null;
  }
  if (node instanceof RuntimeStatement) {
    ctx.push(semicolonizeStatement(transformTracked(node as any, tracked)));
    return null;
  }
  if (node instanceof SlotNode) {
    if (!parentVar) return null;
    if (ctx.hydrate) {
      ctx.push(`if (props.children !== undefined && props.children !== null) {`);
      ctx.push(`  if (typeof props.children === 'function') {`);
      ctx.push(`    const __child = props.children(${ctx.walker}.subWalker(${parentVar}));`);
      ctx.push(`    if (__child && typeof __child.then === 'function') __pendingChild = __child.then(() => $root);`);
      ctx.push(`  } else {`);
      ctx.push(`    ${parentVar}.appendChild(props.children);`);
      ctx.push(`  }`);
      ctx.push(`}`);
    } else {
      ctx.push(`if (props.children !== undefined && props.children !== null) ${parentVar}.appendChild(props.children);`);
    }
    return null;
  }
  if (node instanceof TryCatch) return emitTryCatch(ctx, node, tracked, effectsVar, parentVar);
  if (node instanceof WhileLoop) return emitWhileLoop(ctx, node, tracked, parentVar);
  if (node instanceof ForLoop) return emitForLoop(ctx, node, tracked, parentVar);
  if (node instanceof SwitchBlock) return emitSwitchBlock(ctx, node, tracked, parentVar);
  return null;
}

const PROPERTY_ATTRS: Record<string, Set<string>> = {
  input: new Set(['value', 'checked', 'indeterminate']),
  textarea: new Set(['value']),
  select: new Set(['value']),
  option: new Set(['selected']),
  progress: new Set(['value']),
};

function emitStatic(ctx: Ctx, node: StaticNode, tracked: Map<string, TrackedInfo>, effectsVar: string | null): string | null {
  const el = ctx.n();
  if (ctx.hydrate) {
    const claim = ctx.claimStatic;
    ctx.claimStatic = false;
    if (!claim && isStaticIR(node.children)) return null;
    ctx.push(`const ${el} = ${ctx.walker}.nextElement(${JSON.stringify(node.tag)});`);
  } else {
    ctx.push(`const ${el} = document.createElement(${JSON.stringify(node.tag)});`);
  }

  const dynAttrs: DynamicBinding[] = [];
  const children: IRNode[] = [];
  for (const child of node.children) {
    if (child instanceof DynamicBinding && child.kind === 'attribute') {
      dynAttrs.push(child);
    } else {
      children.push(child);
    }
  }

  for (const attr of node.attributes) {
    if (attr.name.startsWith('on') && attr.name.length > 2) continue;
    if (attr.value === '') {
      ctx.push(`${el}.setAttribute(${JSON.stringify(attr.name)}, '');`);
    } else {
      ctx.push(`${el}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(escapeHtml(attr.value))});`);
    }
  }

  for (const child of children) {
    const childVar = emitNode(ctx, child, tracked, effectsVar, el);
    if (childVar) ctx.push(`${el}.appendChild(${childVar});`);
  }

  for (const attr of dynAttrs) {
    const target = attr.target || '';
    const isEvent = target.startsWith('on') && target.length > 2;
    if (target === 'ref') {
      const expr = transformTracked(attr.expression as any, tracked);
      ctx.push(`(${expr})(${el});`);
    } else if (isEvent) {
      const eventName = target.slice(2).toLowerCase();
      const handler = transformTracked(attr.expression as any, tracked);
      if (NON_BUBBLING_EVENTS.has(eventName)) {
        ctx.directEvents.add(eventName);
        ctx.push(`${el}.addEventListener(${JSON.stringify(eventName)}, ${handler});`);
      } else {
        const prop = `__evh_${eventName}`;
        ctx.delegatedEvents.add(eventName);
        ctx.push(`${el}.${prop} = ${handler};`);
      }
      ctx.push(`${el}.setAttribute('data-vsk-ev', '');`);
    } else {
      const expr = transformTracked(attr.expression as any, tracked);
      const useProp = PROPERTY_ATTRS[node.tag]?.has(target);
      const eff = useProp
        ? `effect(() => { ${el}.${target} = ${expr}; })`
        : `effect(() => { ${el}.setAttribute(${JSON.stringify(target)}, String(${expr})); })`;
      if (effectsVar) {
        ctx.push(`${effectsVar}.push(${eff});`);
      } else {
        ctx.effects.push(`${eff};`);
      }
    }
  }

  return el;
}

function emitClientHead(ctx: Ctx, node: HeadBlock, tracked: Map<string, TrackedInfo>): void {
  for (const child of node.children) {
    if (child instanceof StaticNode) {
      const tag = child.tag;

      const dynAttrs = new Map<string, string>();
      const staticAttrs = new Map(child.attributes.map((a) => [a.name, a.value]));
      for (const c of child.children) {
        if (c instanceof DynamicBinding && c.kind === 'attribute' && c.target && c.target !== 'ref') {
          dynAttrs.set(c.target, transformTracked(c.expression as any, tracked));
        }
      }
      const textParts: string[] = [];
      let hasDynamicText = false;
      for (const c of child.children) {
        if (c instanceof TextNode) textParts.push(JSON.stringify(c.value));
        else if (c instanceof DynamicBinding && c.kind === 'text') {
          hasDynamicText = true;
          textParts.push(transformTracked(c.expression as any, tracked));
        }
      }
      const hasDynamic = dynAttrs.size > 0 || hasDynamicText;
      if (ctx.hydrate && (tag === 'script' || tag === 'link' || tag === 'style') && !hasDynamic) {
        continue;
      }

      if (tag === 'title') {
        if (hasDynamicText) {
          ctx.push(`effect(() => { document.title = String(${textParts.join(' + ')}); });`);
        } else if (textParts.length > 0) {
          ctx.push(`document.title = ${textParts[0]};`);
        }
      } else if (tag === 'meta') {
        const nameVal = staticAttrs.get('name') || dynAttrs.get('name') || staticAttrs.get('property') || dynAttrs.get('property') || 'charset';
        const selector = staticAttrs.has('name') || dynAttrs.has('name')
          ? `meta[name="${nameVal}"]`
          : staticAttrs.has('property') || dynAttrs.has('property')
            ? `meta[property="${nameVal}"]`
            : `meta[charset]`;

        if (hasDynamic) {
          ctx.push(`effect(() => { let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement('meta'); document.head.appendChild(el); }`);
          for (const [k, v] of staticAttrs) if (!dynAttrs.has(k)) ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
          for (const [k, v] of dynAttrs) ctx.push(`el.setAttribute(${JSON.stringify(k)}, String(${v}));`);
          ctx.push(`});`);
        } else {
          for (const [k, v] of staticAttrs) {
            ctx.push(`{ let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement('meta'); document.head.appendChild(el); } el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)}); }`);
          }
        }
      } else if (tag === 'script') {
        const srcAttr = child.attributes.find((a) => a.name === 'src');
        const textChild = child.children.find((c) => c instanceof TextNode);
        if (srcAttr) {
          const src = srcAttr.value;
          ctx.push(`{ if (!document.querySelector('script[src=${JSON.stringify(src)}]')) { let el = document.createElement('script');`);
          for (const a of child.attributes) ctx.push(`el.setAttribute(${JSON.stringify(a.name)}, ${JSON.stringify(a.value)});`);
          ctx.push(`document.head.appendChild(el); } }`);
        } else if (textChild) {
          ctx.push(`{ let el = document.createElement('script');`);
          for (const a of child.attributes) ctx.push(`el.setAttribute(${JSON.stringify(a.name)}, ${JSON.stringify(a.value)});`);
          ctx.push(`el.textContent = ${JSON.stringify((textChild as TextNode).value)};`);
          ctx.push(`document.head.appendChild(el); }`);
        }
      } else {
        const textChild = child.children.find((c) => c instanceof TextNode);
        let selector = tag;
        if (tag === 'link' && staticAttrs.has('href')) selector = `link[href="${staticAttrs.get('href')}"]`;
        else if (tag === 'base') selector = 'base';
        if (hasDynamic) {
          ctx.push(`effect(() => { let el = document.querySelector(${JSON.stringify(selector)}) || (() => { const e = document.createElement(${JSON.stringify(tag)}); document.head.appendChild(e); return e; })();`);
          for (const [k, v] of staticAttrs) if (!dynAttrs.has(k)) ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
          for (const [k, v] of dynAttrs) ctx.push(`el.setAttribute(${JSON.stringify(k)}, String(${v}));`);
          if (hasDynamicText) ctx.push(`el.textContent = String(${textParts.join(' + ')});`);
          else if (textChild) ctx.push(`el.textContent = ${JSON.stringify((textChild as TextNode).value)};`);
          ctx.push(`});`);
        } else {
          ctx.push(`{ let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement(${JSON.stringify(tag)}); document.head.appendChild(el); }`);
          for (const [k, v] of staticAttrs) ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
          if (textChild) ctx.push(`el.textContent = ${JSON.stringify((textChild as TextNode).value)};`);
          ctx.push(`}`);
        }
      }
    }
  }
}

function isReactiveExpression(node: any, tracked: Map<string, TrackedInfo>): boolean {
  const ast = node && (node.ast || node);
  if (!ast) return false;
  let reactive = false;
  walk(ast, tracked, {
    Identifier(n: any, context: any) {
      if (reactive) return;
      const parent = context.path.at(-1);
      if (parent) {
        if (
          parent.type === 'AssignmentExpression' &&
          parent.left === n
        )
          return;
        if (
          parent.type === 'UpdateExpression' &&
          parent.argument === n
        )
          return;
        if (
          parent.type === 'Property' &&
          parent.value === n &&
          parent.key &&
          parent.key.type === 'Identifier' &&
          parent.key.name === 'into'
        )
          return;
        if (
          parent.type === 'MemberExpression' &&
          !parent.computed &&
          parent.property === n
        )
          return;
        if (
          parent.type === 'Property' &&
          parent.key === n &&
          !parent.shorthand
        )
          return;
      }
      const info = context.state.get(n.name);
      if (n.name === 'props' || (info && info.kind === 'virtual')) reactive = true;
    },
  });
  return reactive;
}

function emitDynamicBinding(ctx: Ctx, node: DynamicBinding, tracked: Map<string, TrackedInfo>, effectsVar: string | null): string | null {
  if (node.kind === 'attribute') return null;
  const expr = transformTracked(node.expression as any, tracked);
  const v = ctx.n();
  if (!isReactiveExpression(node.expression, tracked)) {
    ctx.push(`const ${v} = document.createTextNode(String(${expr}));`);
    return v;
  }
  ctx.push(`const ${v} = document.createTextNode('');`);
  const eff = `effect(() => { ${v}.data = String(${expr}); })`;
  if (effectsVar) {
    ctx.push(`${effectsVar}.push(${eff});`);
  } else {
    ctx.effects.push(`${eff};`);
  }
  return v;
}

function emitComponentCall(ctx: Ctx, node: ComponentCall, tracked: Map<string, TrackedInfo>, effectsVar: string | null, parentVar?: string, compPrefix = '__components'): string | null {
  const propsEntries: string[] = node.props.map((p) => {
    if (typeof p.value === 'string') return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`;
    const expr = transformTracked(p.value as any, tracked);
    const simpleGet = simpleGetName(expr);
    if (simpleGet !== null && tracked.has(simpleGet)) {
      return `${JSON.stringify(p.name)}: ${simpleGet}`;
    }
    return `${JSON.stringify(p.name)}: ${expr}`;
  });

  for (const sp of node.spreadProps) {
    const expr = transformTracked(sp as any, tracked);
    propsEntries.push(`...${expr}`);
  }

  const propsObj = `{ ${propsEntries.join(', ')} }`;
  const v = ctx.n();
  const awaitKw = ctx.asyncComps.has(node.componentName) ? 'await ' : '';
  if (ctx.hydrate) {
    const access = ctx.importedNames.has(node.componentName)
      ? node.componentName
      : `__components[${JSON.stringify(node.componentName)}]`;
    const subScope = () => ctx.inTryBody
      ? `${ctx.walker}.subWalker(${parentVar})`
      : `${ctx.walker}.subWalker(${ctx.walker}.nextElement())`;
    if (node.children.length > 0) {
      const walkerVar = ctx.n();
      ctx.push(`const ${walkerVar} = ${subScope()};`);
      const frag = ctx.n();
      ctx.push(`const ${frag} = (() => { const $f = document.createDocumentFragment();`);
      const savedWalker = ctx.walker;
      const savedEffects = ctx.effects;
      ctx.walker = walkerVar;
      ctx.effects = [];
      for (const child of node.children) {
        const childVar = emitNode(ctx, child, tracked, effectsVar, '$f');
        if (childVar) ctx.push(`$f.appendChild(${childVar});`);
      }
      for (const eff of ctx.effects) ctx.push(effectsVar ? `${effectsVar}.push(${eff});` : eff);
      ctx.effects = savedEffects;
      ctx.walker = savedWalker;
      ctx.push(`return $f; })();`);
      propsEntries.push(`children: ${frag}`);
      ctx.push(`const ${v} = ${awaitKw}${access}({ ${propsEntries.join(', ')} }, __registry, ${walkerVar});`);
      return v;
    }
    ctx.push(`const ${v} = ${awaitKw}${access}(${propsObj}, __registry, ${subScope()});`);
    return v;
  } else {
    if (node.children.length > 0) {
      const frag = ctx.n();
      ctx.push(`const ${frag} = (() => { const $f = document.createDocumentFragment();`);
      const savedEffects = ctx.effects;
      ctx.effects = [];
      for (const child of node.children) {
        const childVar = emitNode(ctx, child, tracked, effectsVar, '$f');
        if (childVar) ctx.push(`$f.appendChild(${childVar});`);
      }
      for (const eff of ctx.effects) ctx.push(effectsVar ? `${effectsVar}.push(${eff});` : eff);
      ctx.effects = savedEffects;
      ctx.push(`return $f; })();`);
      propsEntries.push(`children: ${frag}`);
    }
    if (ctx.importedNames.has(node.componentName)) {
      ctx.push(`const ${v} = ${awaitKw}${node.componentName}({ ${propsEntries.join(', ')} });`);
    } else {
      ctx.push(`const ${v} = ${awaitKw}${compPrefix}[${JSON.stringify(node.componentName)}]({ ${propsEntries.join(', ')} });`);
    }
  }
  return v;
}

function emitTryCatch(ctx: Ctx, node: TryCatch, tracked: Map<string, TrackedInfo>, effectsVar: string | null, parentVar?: string): string | null {
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effArr = ctx.n();
  const catchParam = node.catchParamName || '__e';
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('try');`);
  if (!ctx.hydrate) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effArr} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('try-end');`);

  const asyncKw = ctx.isAsyncScope ? 'await ' : '';

  function emitRenderFunc(name: string, isCatch: boolean, hydMode: boolean, compPrefix = '__components'): void {
    const savedHydrate = ctx.hydrate;
    const savedInTryBody = ctx.inTryBody;
    ctx.hydrate = hydMode;
    if (hydMode && !isCatch) {
      ctx.inTryBody = true;
    }
    ctx.push(`const ${name} = ${isCatch ? (ctx.isAsyncScope ? `async (${catchParam}) => {` : `(${catchParam}) => {`) : (ctx.isAsyncScope ? `async () => {` : `() => {`)}`);
    ctx.push(indent(`const __p = ${anchor}.parentNode;`));
    const savedEffects = ctx.effects;
    ctx.effects = [];
    const body = isCatch ? node.catchBody : node.bodyTemplate;
    if (hydMode) {
      ctx.push(indent(`const __cl = [];`));
    }
    for (const child of body) {
      const childVar = emitNode(ctx, child, tracked, isCatch ? null : effArr, undefined, compPrefix);
      if (childVar) {
        if (hydMode) ctx.push(indent(`__cl.push(${childVar});`));
        else ctx.push(indent(`__p.insertBefore(${childVar}, ${endAnchor});`));
      }
    }
    if (hydMode) {
      ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
    }
    for (const eff of ctx.effects) ctx.push(indent(eff));
    ctx.effects = savedEffects;
    ctx.hydrate = savedHydrate;
    ctx.inTryBody = savedInTryBody;
    ctx.push(`};`);
  }

  const tryRender = ctx.n();
  emitRenderFunc(tryRender, false, ctx.hydrate);

  let catchRender: string | null = null;
  const hasCatch = node.catchBody.length > 0;
  if (hasCatch) {
    catchRender = ctx.n();
    emitRenderFunc(catchRender, true, ctx.hydrate);
  }

  if (!ctx.hydrate) ctx.push(`${parent}.appendChild(${endAnchor});`);

  if (hasCatch) {
    ctx.push(`try { ${asyncKw}${tryRender}(); } catch(${catchParam}) { ${asyncKw}${catchRender}(${catchParam}); }`);
  } else {
    ctx.push(`${asyncKw}${tryRender}();`);
  }

  const tryRenderComp = ctx.n();
  emitRenderFunc(tryRenderComp, false, false, '__runtime_comps');

  let catchRenderComp: string | null = null;
  if (hasCatch) {
    catchRenderComp = ctx.n();
    emitRenderFunc(catchRenderComp, true, false, '__runtime_comps');
  }

  ctx.effects.push(`{
    effect(${ctx.isAsyncScope ? 'async () => {' : '() => {'}
      for (const e of ${effArr}) destroy_block(e);
      ${effArr}.length = 0;
      __cleanup(${anchor}, ${endAnchor});
      try { ${asyncKw}${tryRenderComp}(); } catch(${catchParam}) { ${hasCatch ? `${asyncKw}${catchRenderComp}(${catchParam});` : 'throw ${catchParam};'} }
    });
  }`);

  return null;
}

function emitOpaque(ctx: Ctx, node: OpaqueDynamicRegion, tracked: Map<string, TrackedInfo>, parentVar?: string): string | null {
  const condExpr = transformTracked(node.condition as any, tracked);
  const hasElse = node.alternateNodes.length > 0;
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effectsVar = ctx.n();
  const hyd = ctx.hydrate;
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('if');`);
  if (!hyd) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effectsVar} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('if-end');`);

  const asyncKw = ctx.isAsyncScope ? 'await ' : '';
  const fnOpen = ctx.isAsyncScope ? 'async () => {' : '() => {';

  const conRenderName = ctx.n();
  ctx.push(`const ${conRenderName} = ${fnOpen}`);
  if (!hyd) ctx.push(indent(`const __p = ${anchor}.parentNode;`));
  const conFrag = ctx.n();
  if (!hyd) ctx.push(indent(`const ${conFrag} = document.createDocumentFragment();`));
  if (hyd) ctx.push(indent(`const __cl = [];`));
  for (const n of node.consequentNodes) {
    const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : conFrag);
    if (v) {
      if (hyd) ctx.push(indent(`__cl.push(${v});`));
      else ctx.push(indent(`${conFrag}.appendChild(${v});`));
    }
  }
  if (hyd) ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
  else ctx.push(indent(`__p.insertBefore(${conFrag}, ${endAnchor});`));
  ctx.push(`};`);

  let altRenderName: string | null = null;
  if (hasElse) {
    altRenderName = ctx.n();
    ctx.push(`const ${altRenderName} = ${fnOpen}`);
    if (!hyd) ctx.push(indent(`const __p = ${anchor}.parentNode;`));
    const altFrag = ctx.n();
    if (!hyd) ctx.push(indent(`const ${altFrag} = document.createDocumentFragment();`));
    if (hyd) ctx.push(indent(`const __cl = [];`));
    for (const n of node.alternateNodes) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : altFrag);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`${altFrag}.appendChild(${v});`));
      }
    }
    if (hyd) ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
    else ctx.push(indent(`__p.insertBefore(${altFrag}, ${endAnchor});`));
    ctx.push(`};`);
  }

  if (!hyd) ctx.push(`${parent}.appendChild(${endAnchor});`);

  ctx.push(`if (${condExpr}) { ${asyncKw}${conRenderName}(); }` + (hasElse ? ` else { ${asyncKw}${altRenderName}(); }` : ''));

  ctx.effects.push(`{
    let __iv = ${condExpr};
    let __first = true;
    effect(${ctx.isAsyncScope ? 'async () => {' : '() => {'}
      if (__first) { __first = false; return; }
      const __nv = ${condExpr};
      if (__nv !== __iv) {
        for (const e of ${effectsVar}) destroy_block(e);
        ${effectsVar}.length = 0;
        __cleanup(${anchor}, ${endAnchor});
        if (__nv) { ${asyncKw}${conRenderName}(); }` + (hasElse ? ` else { ${asyncKw}${altRenderName}(); }` : '') + `
        __iv = __nv;
      }
    });
  }`);

  return null;
}

function emitWhileLoop(ctx: Ctx, node: WhileLoop, tracked: Map<string, TrackedInfo>, parentVar?: string): string | null {
  const condExpr = transformTracked(node.condition as any, tracked);
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effectsVar = ctx.n();
  const hyd = ctx.hydrate;
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('while');`);
  if (!hyd) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effectsVar} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('while-end');`);

  const renderLoop = ctx.n();
  ctx.push(`const ${renderLoop} = ${ctx.isAsyncScope ? 'async () => {' : '() => {'}`);
  if (!hyd) ctx.push(indent(`const __p = ${anchor}.parentNode;`));
  if (hyd) ctx.push(indent(`const __cl = [];`));
  if (node.isDoWhile) {
    ctx.push(indent(`do {`));
    for (const n of node.bodyTemplate) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : undefined);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
      }
    }
    ctx.push(indent(`} while (${condExpr});`));
  } else {
    ctx.push(indent(`while (${condExpr}) {`));
    for (const n of node.bodyTemplate) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : undefined);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
      }
    }
    ctx.push(indent(`}`));
  }
  if (hyd) ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
  ctx.push(`};`);

  if (!hyd) ctx.push(`${parent}.appendChild(${endAnchor});`);

  ctx.push(`${ctx.isAsyncScope ? 'await ' : ''}${renderLoop}();`);

  ctx.effects.push(`{
  let __busy = false;
  let __iv = (${condExpr});
  let __first = true;
  effect(${ctx.isAsyncScope ? 'async () => {' : '() => {'}
    if (__first) { __first = false; return; }
    if (__busy) return;
    const __nv = (${condExpr});
    if (__nv !== __iv) {
      for (const e of ${effectsVar}) destroy_block(e);
      ${effectsVar}.length = 0;
      __cleanup(${anchor}, ${endAnchor});
      __busy = true;
      ${ctx.isAsyncScope ? 'await ' : ''}${renderLoop}();
      __busy = false;
      __iv = (${condExpr});
    }
  });
}`);

  return null;
}

function emitForLoop(ctx: Ctx, node: ForLoop, tracked: Map<string, TrackedInfo>, parentVar?: string): string | null {
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effectsVar = ctx.n();
  const hyd = ctx.hydrate;
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('for');`);
  if (!hyd) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effectsVar} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('for-end');`);

  const renderLoop = ctx.n();
  ctx.push(`const ${renderLoop} = ${ctx.isAsyncScope ? 'async () => {' : '() => {'}`);
  if (!hyd) ctx.push(indent(`const __p = ${anchor}.parentNode;`));
  if (hyd) ctx.push(indent(`const __cl = [];`));
  if (node.kind === 'for-in') {
    const srcExpr = transformTracked(node.condition as any, tracked);
    ctx.push(indent(`for (${node.init} of (Array.isArray(${srcExpr}) ? ${srcExpr} : (${srcExpr} == null ? [] : Object.keys(${srcExpr})))) {`));
    for (const n of node.bodyTemplate) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : undefined);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
      }
    }
    ctx.push(indent(`}`));
  } else {
    const condExpr = transformTracked(node.condition as any, tracked);
    if (node.init) ctx.push(indent(`${node.init}`));
    ctx.push(indent(`while (${condExpr}) {`));
    for (const n of node.bodyTemplate) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : undefined);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
      }
    }
    if (node.update) ctx.push(indent(`${node.update}`));
    ctx.push(indent(`}`));
  }
  if (hyd) ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
  ctx.push(`};`);

  if (!hyd) ctx.push(`${parent}.appendChild(${endAnchor});`);

  ctx.push(`${ctx.isAsyncScope ? 'await ' : ''}${renderLoop}();`);

  if (node.kind === 'for-in') {
    const srcExpr = transformTracked(node.condition as any, tracked);
    ctx.effects.push(`{
  let __busy = false;
  let __iv = undefined;
  let __first = true;
  effect(${ctx.isAsyncScope ? 'async () => {' : '() => {'}
    if (__first) { __first = false; return; }
    if (__busy) return;
    const __nv = (${srcExpr});
    if (__nv !== __iv) {
      for (const e of ${effectsVar}) destroy_block(e);
      ${effectsVar}.length = 0;
      __cleanup(${anchor}, ${endAnchor});
      __busy = true;
      ${ctx.isAsyncScope ? 'await ' : ''}${renderLoop}();
      __busy = false;
      __iv = (${srcExpr});
    }
  });
}`);
  } else {
    // Classic `for` loops declare their loop variable in the init clause, so the
    // condition only refers to loop-local bindings. The loop renders once and is
    // not reactive, so no re-render effect is emitted.
  }

  return null;
}

function emitSwitchBlock(ctx: Ctx, node: SwitchBlock, tracked: Map<string, TrackedInfo>, parentVar?: string): string | null {
  const discExpr = transformTracked(node.discriminant as any, tracked);
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effectsVar = ctx.n();
  const hyd = ctx.hydrate;
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('switch');`);
  if (!hyd) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effectsVar} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('switch-end');`);

  const renderSwitch = ctx.n();
  ctx.push(`const ${renderSwitch} = ${ctx.isAsyncScope ? 'async () => {' : '() => {'}`);
  if (!hyd) ctx.push(indent(`const __p = ${anchor}.parentNode;`));
  if (hyd) ctx.push(indent(`const __cl = [];`));
  ctx.push(indent(`switch (${discExpr}) {`));
  for (const c of node.cases) {
    if (c.test) {
      ctx.push(indent(`case ${transformTracked(c.test as any, tracked)}:`));
    } else {
      ctx.push(indent(`default:`));
    }
    for (const n of c.body) {
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? parentVar : undefined);
      if (v) {
        if (hyd) ctx.push(indent(`__cl.push(${v});`));
        else ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
      }
    }
    ctx.push(indent(`break;`));
  }
  ctx.push(indent(`}`));
  if (hyd) ctx.push(indent(`__place(${anchor}, ${endAnchor}, __cl, ${parent});`));
  ctx.push(`};`);

  if (!hyd) ctx.push(`${parent}.appendChild(${endAnchor});`);

  ctx.push(`${ctx.isAsyncScope ? 'await ' : ''}${renderSwitch}();`);

  ctx.effects.push(`{
  let __busy = false;
  let __iv = (${discExpr});
  let __first = true;
  effect(${ctx.isAsyncScope ? 'async () => {' : '() => {'}
    if (__first) { __first = false; return; }
    if (__busy) return;
    const __nv = (${discExpr});
    if (__nv !== __iv) {
      for (const e of ${effectsVar}) destroy_block(e);
      ${effectsVar}.length = 0;
      __cleanup(${anchor}, ${endAnchor});
      __busy = true;
      ${ctx.isAsyncScope ? 'await ' : ''}${renderSwitch}();
      __busy = false;
      __iv = (${discExpr});
    }
  });
}`);

  return null;
}

function emitMap(ctx: Ctx, node: MapRegion, tracked: Map<string, TrackedInfo>, parentVar?: string): string | null {
  const arrExpr = transformTracked(node.expression as any, tracked);
  const itemVar = node.itemVariable;
  const anchor = ctx.n();
  const endAnchor = ctx.n();
  const effectsVar = ctx.n();
  const aw = ctx.isAsyncScope ? 'await ' : '';
  const effOpen = ctx.isAsyncScope ? 'async () => {' : '() => {';
  const keyed = !!node.keyExpr;
  const hyd = ctx.hydrate && !keyed;
  const parent = parentVar || '$root';

  ctx.push(`const ${anchor} = document.createComment('map');`);
  if (!hyd) ctx.push(`${parent}.appendChild(${anchor});`);
  ctx.push(`let ${effectsVar} = [];`);
  ctx.push(`const ${endAnchor} = document.createComment('map-end');`);

  const renderItem = ctx.n();
  const indexParam = node.indexVariable ? ', __i' : '';
  ctx.push(`const ${renderItem} = ${ctx.isAsyncScope ? 'async ' : ''}(${itemVar}${indexParam}, __e, __r${hyd ? ', __cl' : ''}) => {`);
  ctx.push(indent(`__r = __r || ${endAnchor};`));
  if (node.indexVariable) ctx.push(indent(`const ${node.indexVariable} = __i;`));
  ctx.push(indent(`const __p = ${anchor}.parentNode;`));
  for (const n of node.bodyTemplate) {
    const v = emitNode(ctx, n, tracked, '__e');
    if (v) {
      if (hyd) ctx.push(indent(`if (__cl) __cl.push(${v}); else __p.insertBefore(${v}, __r);`));
      else ctx.push(indent(`__p.insertBefore(${v}, __r);`));
    }
  }
  ctx.push(`};`);

  let emptyRenderName: string | null = null;
  if (node.alternateNodes.length > 0) {
    emptyRenderName = ctx.n();
    const emptySig = hyd
      ? (ctx.isAsyncScope ? 'async (__cl) => {' : '(__cl) => {')
      : (ctx.isAsyncScope ? 'async () => {' : '() => {');
    ctx.push(`const ${emptyRenderName} = ${emptySig}`);
    ctx.push(indent(`const __p = ${anchor}.parentNode;`));
    const frag = ctx.n();
    if (!hyd) ctx.push(indent(`const ${frag} = document.createDocumentFragment();`));
    const savedClaim = ctx.claimStatic;
    for (const n of node.alternateNodes) {
      ctx.claimStatic = true;
      const v = emitNode(ctx, n, tracked, effectsVar, hyd ? undefined : frag);
      if (v) {
        if (hyd) ctx.push(indent(`if (__cl) __cl.push(${v}); else __p.insertBefore(${v}, ${endAnchor});`));
        else ctx.push(indent(`${frag}.appendChild(${v});`));
      }
    }
    ctx.claimStatic = savedClaim;
    if (!hyd) ctx.push(indent(`__p.insertBefore(${frag}, ${endAnchor});`));
    ctx.push(`};`);
  }

  if (!hyd) ctx.push(`${parent}.appendChild(${endAnchor});`);

  const hasItems = ctx.n();
  ctx.push(`const ${hasItems} = () => { const __l = ${arrExpr}; return __l != null && __l.length > 0; };`);

  if (node.keyExpr) {
    const keyExpr = transformTracked(node.keyExpr as any, tracked);
    const reconciler = ctx.n();
    const initList = ctx.n();
    ctx.push(`let ${reconciler} = () => {};`);
    ctx.push(`const ${initList} = () => { ${reconciler} = reconcile(${anchor}, ${endAnchor}, ${arrExpr}, ${itemVar} => ${keyExpr}, (${itemVar}, __i, __e) => ${renderItem}(${itemVar}${indexParam ? ', __i, __e' : ', __e'})); };`);

    if (emptyRenderName) {
      const isEmptyVar = ctx.n();
      ctx.push(`let ${isEmptyVar} = !${hasItems}();`);
      ctx.push(`if (!${isEmptyVar}) { ${initList}(); } else { ${aw}${emptyRenderName}(); }`);
      ctx.effects.push(`{
  let __first = true;
  effect(${effOpen}
    const __new = ${hasItems}();
    if (__first) { __first = false; return; }
    if (__new !== ${isEmptyVar}) {
      if (__new) ${reconciler}(${arrExpr});
      return;
    }
    ${isEmptyVar} = !__new;
    for (const e of ${effectsVar}) destroy_block(e);
    ${effectsVar}.length = 0;
    __cleanup(${anchor}, ${endAnchor});
    if (__new) { ${initList}(); } else { ${aw}${emptyRenderName}(); }
  });
}`);
    } else {
      ctx.push(`${initList}();`);
      ctx.effects.push(`{
  let __first = true;
  effect(() => {
    const __nv = ${arrExpr};
    if (__first) { __first = false; return; }
    ${reconciler}(${arrExpr});
  });
}`);
    }
  } else {
    const renderAllItems = (ind: string, collect: string | null): string => {
      const lines: string[] = [];
      if (node.indexVariable) {
        lines.push(`${ind}let __i = 0;`);
        lines.push(`${ind}for (const ${itemVar} of ${arrExpr}) {`);
        lines.push(`${ind}\t${aw}${renderItem}(${itemVar}, __i, ${effectsVar}${collect ? `, null, ${collect}` : ''});`);
        lines.push(`${ind}\t__i++;`);
        lines.push(`${ind}}`);
      } else {
        lines.push(`${ind}for (const ${itemVar} of ${arrExpr}) {`);
        lines.push(`${ind}\t${aw}${renderItem}(${itemVar}, ${effectsVar}${collect ? `, null, ${collect}` : ''});`);
        lines.push(`${ind}}`);
      }
      return lines.join('\n');
    };

    if (emptyRenderName) {
      const collectVar = hyd ? ctx.n() : null;
      const isEmptyVar = ctx.n();
      ctx.push(`let ${isEmptyVar} = !${hasItems}();`);
      if (collectVar) ctx.push(`const ${collectVar} = [];`);
      ctx.push(`if (!${isEmptyVar}) {`);
      ctx.push(indent(renderAllItems('', collectVar)));
      ctx.push(indent(`} else { ${aw}${emptyRenderName}(${collectVar ? collectVar : ''}); }`));
      if (collectVar) ctx.push(`__place(${anchor}, ${endAnchor}, ${collectVar}, ${parent});`);
      ctx.effects.push(`{
  let __first = true;
  effect(${effOpen}
    const __new = ${hasItems}();
    if (__first) { __first = false; return; }
    if (__new !== ${isEmptyVar}) {
      if (__new) {
        for (const e of ${effectsVar}) destroy_block(e);
        ${effectsVar}.length = 0;
        __cleanup(${anchor}, ${endAnchor});
${renderAllItems('        ', null)}
      }
      return;
    }
    ${isEmptyVar} = !__new;
    for (const e of ${effectsVar}) destroy_block(e);
    ${effectsVar}.length = 0;
    __cleanup(${anchor}, ${endAnchor});
    if (__new) {
${renderAllItems('      ', null)}
    } else { ${aw}${emptyRenderName}(${collectVar ? collectVar : ''}); }
  });
}`);
    } else {
      const collectVar = hyd ? ctx.n() : null;
      if (collectVar) ctx.push(`const ${collectVar} = [];`);
      ctx.push(renderAllItems('', collectVar));
      if (collectVar) ctx.push(`__place(${anchor}, ${endAnchor}, ${collectVar}, ${parent});`);
      ctx.effects.push(`{
  let __first = true;
  effect(${effOpen}
    const __nv = ${arrExpr};
    if (__first) { __first = false; return; }
    for (const e of ${effectsVar}) destroy_block(e);
    ${effectsVar}.length = 0;
    __cleanup(${anchor}, ${endAnchor});
${renderAllItems('    ', null)}
  });
}`);
    }
  }

  return null;
}

function computeAsyncComponents(comps: ComponentIR[]): Set<string> {
  return new Set(comps.filter((c) => c.isAsync).map((c) => c.name));
}

function generateComponent(comp: ComponentIR, importedNames: Set<string> = new Set(), hydrate = false, asyncComps: Set<string> = new Set()): string {
  const tracked = collectTrackedNames(comp.body);
  const ctx = new Ctx();
  ctx.importedNames = importedNames;
  ctx.hydrate = hydrate;
  ctx.asyncComps = asyncComps;
  ctx.isAsyncScope = comp.isAsync || asyncComps.has(comp.name);

  ctx.push(hydrate ? (ctx.isAsyncScope ? 'async (props, __registry, __hydrate) => {' : '(props, __registry, __hydrate) => {') : (ctx.isAsyncScope ? 'async (props) => {' : '(props) => {'));
  ctx.push(indent(`props = reactiveProps(props);`));
  ctx.push(indent(`const __prev = getActiveComponent();`));
  ctx.push(indent(`setActiveComponent({ c: null, p: __prev });`));
  ctx.push(indent(`try {`));

  if (comp.style) {
    const key = `vesk-${comp.name}`;
    ctx.push(indent(`if (!document.getElementById(${JSON.stringify(key)})) {`));
    ctx.push(indent(`\tconst s = document.createElement('style'); s.id = ${JSON.stringify(key)}; s.textContent = ${JSON.stringify(comp.style)}; document.head.appendChild(s);`, 2));
    ctx.push(indent(`}`));
  }

  if (ctx.hydrate) {
    ctx.push(indent(`const $root = __hydrate.root;`));
  } else {
    ctx.push(indent(`const $root = document.createDocumentFragment();`));
  }
  ctx.push(indent(`let __pendingChild = null;`));

  const paramInit = buildParamInit(comp.paramNames);
  if (paramInit) ctx.push(indent(paramInit));

  for (const node of comp.body) {
    const v = emitNode(ctx, node, tracked, null);
    if (v) {
      if (ctx.hydrate) {
        ctx.push(indent(`if (${v}.parentNode !== $root) $root.appendChild(${v});`));
      } else {
        ctx.push(indent(`$root.appendChild(${v});`));
      }
    }
  }

  const effCode = ctx.flushEffects();
  if (effCode) ctx.push(indent(effCode.trim()));

  const delCode = ctx.emitDelegates();
  if (delCode) ctx.push(indent(delCode.trim()));

  ctx.push(indent(`return __pendingChild || $root;`));
  ctx.push(indent(`} finally {`));
  ctx.push(indent(`\tsetActiveComponent(__prev);`));
  ctx.push(indent(`}`));
  ctx.push(`}`);

  return ctx.getCode();
}

function buildParamInit(paramNames: string[]): string {
  if (paramNames.length === 1 && paramNames[0] === 'props') return '';
  if (paramNames.length === 0) return '';
  return `const { ${paramNames.join(', ')} } = props;`;
}

function buildComponentMap(irRoot: IRRoot, hydrate = false): string {
  const mapLines: string[] = [];
  mapLines.push(`const __components = {};`);
  const asyncComps = computeAsyncComponents(irRoot.components);

  for (const comp of irRoot.components) {
    if (hydrate && isStaticComponent(comp)) {
      const stub = `(props, __registry, __hydrate) => { return __hydrate.root; }`;
      mapLines.push(`__components[${JSON.stringify(comp.name)}] = ${stub};`);
      continue;
    }
    const code = generateComponent(comp, new Set(extractRuntimeNames(irRoot.imports)), hydrate, asyncComps);
    mapLines.push(`__components[${JSON.stringify(comp.name)}] = ${code};`);
  }

  mapLines.push(`function __cleanup(start, end) {`);
  mapLines.push(`\tlet n = start.nextSibling;`);
  mapLines.push(`\twhile (n && n !== end) {`);
  mapLines.push(`\t\tconst next = n.nextSibling;`);
  mapLines.push(`\t\tn.remove();`);
  mapLines.push(`\t\tn = next;`);
  mapLines.push(`\t}`);
  mapLines.push(`}`);
  mapLines.push(`function __place(start, end, nodes, fallback) {`);
  mapLines.push(`\tif (start.parentNode !== null) {`);
  mapLines.push(`\t\tconst p = start.parentNode;`);
  mapLines.push(`\t\tfor (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);`);
  mapLines.push(`\t\treturn;`);
  mapLines.push(`\t}`);
  mapLines.push(`\tif (nodes.length > 0 && nodes[0].parentNode) {`);
  mapLines.push(`\t\tconst p = nodes[0].parentNode;`);
  mapLines.push(`\t\tp.insertBefore(start, nodes[0]);`);
  mapLines.push(`\t\tp.insertBefore(end, nodes[nodes.length - 1].nextSibling);`);
  mapLines.push(`\t\treturn;`);
  mapLines.push(`\t}`);
  mapLines.push(`\tfallback.appendChild(start);`);
  mapLines.push(`\tfallback.appendChild(end);`);
  mapLines.push(`\tfor (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);`);
  mapLines.push(`}`);

  return mapLines.join('\n\n');
}

function isStaticIR(body: IRNode[]): boolean {
  for (const node of body) {
    if (node instanceof StaticNode) {
      for (const child of node.children) {
        if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target) {
          if (child.target.startsWith('on') && child.target.length > 2) return false;
          return false;
        }
      }
      if (!isStaticIR(node.children)) return false;
    } else if (!(node instanceof TextNode)) {
      return false;
    }
  }
  return true;
}

function isStaticComponent(comp: ComponentIR): boolean {
  if (comp.style) return false;
  return isStaticIR(comp.body);
}

function usedRuntimeBindings(ir: IRRoot): Set<string> {
  const found = new Set<string>();
  const allNames = ['bindValue', 'bindChecked', 'bindGroup'];
  for (const comp of ir.components) {
    for (const name of allNames) {
      if (found.has(name)) continue;
      if (findBindingInIR(comp.body, new Set([name]))) found.add(name);
    }
  }
  return found;
}

function findBindingInIR(nodes: IRNode[], names: Set<string>): boolean {
  for (const node of nodes) {
    if (node instanceof DynamicBinding) {
      if (astHasBinding(node.expression.ast, names)) return true;
    } else if (node instanceof OpaqueDynamicRegion) {
      if (astHasBinding(node.condition.ast, names)) return true;
      if (findBindingInIR(node.consequentNodes, names)) return true;
      if (findBindingInIR(node.alternateNodes, names)) return true;
    } else if (node instanceof MapRegion) {
      if (astHasBinding(node.expression.ast, names)) return true;
      if (findBindingInIR(node.bodyTemplate, names)) return true;
      if (findBindingInIR(node.alternateNodes, names)) return true;
    } else if (node instanceof WhileLoop) {
      if (astHasBinding(node.condition.ast, names)) return true;
      if (findBindingInIR(node.bodyTemplate, names)) return true;
    } else if (node instanceof SwitchBlock) {
      if (astHasBinding(node.discriminant.ast, names)) return true;
      for (const c of node.cases) {
        if (c.test && astHasBinding(c.test.ast, names)) return true;
        if (findBindingInIR(c.body, names)) return true;
      }
    } else if (node instanceof TryCatch) {
      if (findBindingInIR(node.bodyTemplate, names)) return true;
      if (findBindingInIR(node.catchBody, names)) return true;
    } else if (node instanceof ForLoop) {
      if (astHasBinding(node.condition.ast, names)) return true;
      if (findBindingInIR(node.bodyTemplate, names)) return true;
    } else if (node instanceof ComponentCall) {
      for (const prop of node.props) {
        if (astHasBinding(prop.value.ast, names)) return true;
      }
      if (findBindingInIR(node.children, names)) return true;
    } else if (node instanceof RuntimeStatement) {
      if (astHasBinding(node.ast, names)) return true;
    } else if (node instanceof StaticNode) {
      if (findBindingInIR(node.children, names)) return true;
    } else if (node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
      if (findBindingInIR(node.children, names)) return true;
    }
  }
  return false;
}

function findFormNameInIR(nodes: IRNode[], name: string): boolean {
  const fnPattern = name + '(';
  for (const node of nodes) {
    if (node instanceof ComponentCall) {
      if (node.componentName === name) return true;
      for (const prop of node.props) {
        if (prop.value && prop.value.raw && prop.value.raw.includes(fnPattern)) return true;
      }
      if (findFormNameInIR(node.children, name)) return true;
    }
    if (node instanceof DynamicBinding && node.expression && node.expression.raw) {
      if (node.expression.raw.includes(fnPattern)) return true;
    }
    if (node instanceof RuntimeStatement && node.raw) {
      if (node.raw.includes(fnPattern)) return true;
    }
    if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
      if (findFormNameInIR(node.children, name)) return true;
    }
  }
  return false;
}

function astHasBinding(ast: ESTreeNode | null, names: Set<string>): boolean {
  if (!ast) return false;
  let found = false;
  walk(ast, null, {
    Identifier(node: any, context: any) {
      if (names.has(node.name)) found = true;
      context.next();
    },
  });
  return found;
}

function hasKeyedMap(nodes: IRNode[]): boolean {
  for (const node of nodes) {
    if (node instanceof MapRegion && node.keyExpr) return true;
    if (node instanceof MapRegion && hasKeyedMap(node.bodyTemplate)) return true;
    if (node instanceof MapRegion && hasKeyedMap(node.alternateNodes)) return true;
    if (node instanceof WhileLoop && hasKeyedMap(node.bodyTemplate)) return true;
    if (node instanceof SwitchBlock) {
      for (const c of node.cases) {
        if (hasKeyedMap(c.body)) return true;
      }
    }
    if (node instanceof TryCatch) {
      if (hasKeyedMap(node.bodyTemplate)) return true;
      if (hasKeyedMap(node.catchBody)) return true;
    }
    if (node instanceof ForLoop && hasKeyedMap(node.bodyTemplate)) return true;
    if (node instanceof StaticNode && hasKeyedMap(node.children)) return true;
    if (node instanceof ComponentCall && hasKeyedMap(node.children)) return true;
    if (node instanceof OpaqueDynamicRegion) {
      if (hasKeyedMap(node.consequentNodes)) return true;
      if (hasKeyedMap(node.alternateNodes)) return true;
    }
  }
  return false;
}

export function escapeHtml(str: string): string {
  return str
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function emitClientFromIR(ir: IRRoot, options: { forceClient?: boolean; hydrate?: boolean; includeTopLevel?: boolean }): string {
  const needsClient = ir.components.some((c) => c.isClient || !isStaticComponent(c));
  if (!options.forceClient && !needsClient) {
    return '';
  }

  const componentMapCode = buildComponentMap(ir, options.hydrate);
  const importLines = ir.imports.length > 0 ? ir.imports.join('\n') + '\n' : '';
  const topCode = (options.includeTopLevel === false ? [] : transformTopLevelForActions(ir.topLevelCode, 'client')).join('\n') + '\n';

  const exportLines: string[] = [];
  for (const comp of ir.components) {
    if (comp.exported) {
      if (comp.defaultExport) {
        exportLines.push(`export default __components[${JSON.stringify(comp.name)}];`);
      } else {
        exportLines.push(`export const ${comp.name} = __components[${JSON.stringify(comp.name)}];`);
      }
    }
  }
  const exportCode = exportLines.join('\n');

  const runtimeNames: string[] = ['track', 'get', 'set', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'reactiveProps'];
  if (ir.components.some(c => !isStaticIR(c.body))) runtimeNames.push('effect');
  for (const name of usedRuntimeBindings(ir)) runtimeNames.push(name);
  for (const name of ['derived']) {
    if (findBindingInIR(
      ir.components.flatMap(c => c.body),
      new Set([name])
    )) runtimeNames.push(name);
  }
  if (ir.components.some(c => hasKeyedMap(c.body))) runtimeNames.push('reconcile');
  if (options.hydrate) {
    const hydrateNames = ['hydrate', 'hydrateViewport', 'hydrateIdle', 'hydrateOnInteraction', 'needsHydration', 'createHydrateWalker', 'collectVskMarkers', 'reactiveProps'];
    for (const name of hydrateNames) {
      if (!runtimeNames.includes(name)) runtimeNames.push(name);
    }
  }
  const formNames = ['Form', 'Field', 'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom'];
  for (const name of formNames) {
    if (!runtimeNames.includes(name) && findFormNameInIR(ir.components.flatMap(c => c.body), name)) {
      runtimeNames.push(name);
    }
  }

  const runtimeImport = `import { ${runtimeNames.join(', ')} } from '@vesk/runtime';`;

  const moduleCode = `
${runtimeImport}
${importLines}
${topCode}
${componentMapCode}
${exportCode}
`;
  return moduleCode.trim();
}

export function compileClient(source: string, _componentName: string | null, options: { forceClient?: boolean; hydrate?: boolean; includeTopLevel?: boolean; sourcePath?: string; mdRoots?: string[] } = {}): string {
  if (options.sourcePath) {
    source = inlineMdImportsFrom(source, options.sourcePath, options.mdRoots || []);
  }
  const ast = parse(source);
  const ir = generateIR(ast, source);
  return emitClientFromIR(ir, options);
}

/**
 * Compiles a component source in BOTH client modes (plain + hydrate)
 * sharing a single parse/IR pass. Used by the dev-server hot path, where
 * every edit otherwise pays the full acorn+TS parse twice. Also returns
 * the resolved component name using the exact selection order of
 * `resolveComponentName`, so callers don't need a second full parse just
 * to learn the name.
 */
export function compileClientBoth(source: string, _componentName: string | null): { comp: string; hyd: string; name: string | null } {
  const ast = parse(source);
  // Downstream type-stripping mutates AST nodes in place (stripTsTypes),
  // so each emit mode needs its own tree. Cloning is far cheaper than the
  // second full acorn+TS parse this replaces.
  const hydAst = structuredClone(ast);
  const ir = generateIR(ast, source);
  const irHyd = generateIR(hydAst, source);
  const defaultComp = ir.components.find((c) => c.defaultExport);
  let name: string | null = null;
  if (defaultComp) name = defaultComp.name;
  else if (ir.components.length > 0) name = ir.components[0].name;
  else {
    const exportedComp = ir.components.find((c) => c.exported);
    if (exportedComp) name = exportedComp.name;
  }
  return {
    comp: emitClientFromIR(ir, { forceClient: true }),
    hyd: emitClientFromIR(irHyd, { forceClient: true, hydrate: true, includeTopLevel: false }),
    name,
  };
}

export { compileClient as compile, isStaticIR };
