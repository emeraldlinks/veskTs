import { walk } from 'zimmerframe';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion, MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop, TrackDecl, RuntimeStatement, ComponentRef, ComponentCall, ServerBlock, ClientBlock, HeadBlock, SlotNode, } from './ir.js';
import { parse } from './parser.js';
import { generateIR } from './ir-generator.js';
function memberExpr(object, property) {
    return {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: object },
        property: { type: 'Identifier', name: property },
        computed: false,
        optional: false,
    };
}
function callExpr(callee, args = []) {
    return { type: 'CallExpression', callee, arguments: args, optional: false };
}
function transformTracked(irNode, tracked) {
    if (tracked.size === 0)
        return irNode.raw;
    const ast = irNode.ast;
    if (!ast)
        return irNode.raw;
    const transformed = walk(ast, tracked, {
        AssignmentExpression(node, context) {
            if (node.left.type === 'Identifier') {
                const info = context.state.get(node.left.name);
                if (info) {
                    const right = context.visit(node.right);
                    const setCall = { type: 'Identifier', name: 'set' };
                    if (node.operator === '=') {
                        return callExpr(setCall, [
                            { type: 'Identifier', name: info.cellName },
                            right,
                        ]);
                    }
                    const op = node.operator.slice(0, -1);
                    const getCall = { type: 'Identifier', name: 'get' };
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
        UpdateExpression(node, context) {
            if (node.argument.type === 'Identifier') {
                const info = context.state.get(node.argument.name);
                if (info) {
                    const delta = node.operator === '++' ? 1 : -1;
                    const setCall = { type: 'Identifier', name: 'set' };
                    const getCall = { type: 'Identifier', name: 'get' };
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
        Identifier(node, context) {
            const parent = context.path.at(-1);
            if (parent) {
                if (parent.type === 'AssignmentExpression' &&
                    parent.left === node)
                    return context.next();
                if (parent.type === 'UpdateExpression' &&
                    parent.argument === node)
                    return context.next();
                if (parent.type === 'MemberExpression' &&
                    parent.object === node &&
                    !parent.computed)
                    return context.next();
            }
            const info = context.state.get(node.name);
            if (info && info.kind === 'virtual') {
                const getCall = { type: 'Identifier', name: 'get' };
                return callExpr(getCall, [
                    { type: 'Identifier', name: info.cellName },
                ]);
            }
            return context.next();
        },
    });
    return print(transformed, ts()).code;
}
function collectTrackedNames(body) {
    const names = new Map();
    for (const node of body) {
        if (node instanceof TrackDecl) {
            const cellName = node.rawName || node.name;
            names.set(node.name, { cellName, kind: 'virtual' });
            if (node.rawName)
                names.set(node.rawName, { cellName, kind: 'cell' });
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
function indent(code, level = 1) {
    const pad = '\t'.repeat(level);
    return code.split('\n').map((l) => (l ? pad + l : '')).join('\n');
}
class Ctx {
    lines = [];
    effects = [];
    c = 0;
    importedNames = new Set();
    delegatedEvents = new Set();
    directEvents = new Set();
    hydrate = false;
    inTryBody = false;
    push(...args) {
        for (const a of args)
            if (a)
                this.lines.push(a);
    }
    n() { return `$n${this.c++}`; }
    getCode() { return this.lines.join('\n'); }
    flushEffects() {
        if (this.effects.length === 0)
            return '';
        return '\n' + this.effects.join('\n');
    }
    emitDelegates() {
        if (this.delegatedEvents.size === 0 && this.directEvents.size === 0)
            return '';
        const lines = [];
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
function emitNode(ctx, node, tracked, effectsVar, parentVar, compPrefix = '__components') {
    if (node instanceof StaticNode)
        return emitStatic(ctx, node, tracked, effectsVar);
    if (node instanceof TextNode) {
        if (!node.value)
            return null;
        const v = ctx.n();
        ctx.push(`const ${v} = document.createTextNode(${JSON.stringify(node.value)});`);
        return v;
    }
    if (node instanceof DynamicBinding)
        return emitDynamicBinding(ctx, node, tracked, effectsVar);
    if (node instanceof TrackDecl) {
        const cellName = node.rawName || node.name;
        ctx.push(`const ${cellName} = ${node.init};`);
        return null;
    }
    if (node instanceof ComponentRef)
        return null;
    if (node instanceof ComponentCall)
        return emitComponentCall(ctx, node, tracked, parentVar, compPrefix);
    if (node instanceof OpaqueDynamicRegion)
        return emitOpaque(ctx, node, tracked, parentVar);
    if (node instanceof MapRegion)
        return emitMap(ctx, node, tracked, parentVar);
    if (node instanceof ServerBlock)
        return null;
    if (node instanceof ClientBlock) {
        const savedHydrate = ctx.hydrate;
        ctx.hydrate = false;
        let lastVar = null;
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
        ctx.push(transformTracked(node, tracked));
        return null;
    }
    if (node instanceof SlotNode) {
        if (!parentVar)
            return null;
        if (ctx.hydrate) {
            ctx.push(`if (props.children !== undefined && props.children !== null) {`);
            ctx.push(`  if (typeof props.children === 'function') {`);
            ctx.push(`    props.children(__hydrate.subWalker(${parentVar}));`);
            ctx.push(`  } else {`);
            ctx.push(`    ${parentVar}.appendChild(props.children);`);
            ctx.push(`  }`);
            ctx.push(`}`);
        }
        else {
            ctx.push(`if (props.children !== undefined && props.children !== null) ${parentVar}.appendChild(props.children);`);
        }
        return null;
    }
    if (node instanceof TryCatch)
        return emitTryCatch(ctx, node, tracked, effectsVar, parentVar);
    return null;
}
const PROPERTY_ATTRS = {
    input: new Set(['value', 'checked', 'indeterminate']),
    textarea: new Set(['value']),
    select: new Set(['value']),
    option: new Set(['selected']),
    progress: new Set(['value']),
};
function emitStatic(ctx, node, tracked, effectsVar) {
    const el = ctx.n();
    if (ctx.hydrate) {
        if (isStaticIR(node.children))
            return null;
        ctx.push(`const ${el} = __hydrate.nextElement(${JSON.stringify(node.tag)});`);
    }
    else {
        ctx.push(`const ${el} = document.createElement(${JSON.stringify(node.tag)});`);
    }
    const dynAttrs = [];
    const children = [];
    for (const child of node.children) {
        if (child instanceof DynamicBinding && child.kind === 'attribute') {
            dynAttrs.push(child);
        }
        else {
            children.push(child);
        }
    }
    for (const attr of node.attributes) {
        if (attr.value === '') {
            ctx.push(`${el}.setAttribute(${JSON.stringify(attr.name)}, '');`);
        }
        else {
            ctx.push(`${el}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(escapeHtml(attr.value))});`);
        }
    }
    for (const child of children) {
        const childVar = emitNode(ctx, child, tracked, effectsVar, el);
        if (childVar)
            ctx.push(`${el}.appendChild(${childVar});`);
    }
    for (const attr of dynAttrs) {
        const target = attr.target || '';
        const isEvent = target.startsWith('on') && target.length > 2;
        if (target === 'ref') {
            const expr = transformTracked(attr.expression, tracked);
            ctx.push(`(${expr})(${el});`);
        }
        else if (isEvent) {
            const eventName = target.slice(2).toLowerCase();
            const handler = transformTracked(attr.expression, tracked);
            if (NON_BUBBLING_EVENTS.has(eventName)) {
                ctx.directEvents.add(eventName);
                ctx.push(`${el}.addEventListener(${JSON.stringify(eventName)}, ${handler});`);
            }
            else {
                const prop = `__evh_${eventName}`;
                ctx.delegatedEvents.add(eventName);
                ctx.push(`${el}.${prop} = ${handler};`);
            }
            ctx.push(`${el}.setAttribute('data-vsk-ev', '');`);
        }
        else {
            const expr = transformTracked(attr.expression, tracked);
            const useProp = PROPERTY_ATTRS[node.tag]?.has(target);
            const eff = useProp
                ? `effect(() => { ${el}.${target} = ${expr}; })`
                : `effect(() => { ${el}.setAttribute(${JSON.stringify(target)}, String(${expr})); })`;
            if (effectsVar) {
                ctx.push(`${effectsVar}.push(${eff});`);
            }
            else {
                ctx.effects.push(`${eff};`);
            }
        }
    }
    return el;
}
function emitClientHead(ctx, node, tracked) {
    for (const child of node.children) {
        if (child instanceof StaticNode) {
            const tag = child.tag;
            const dynAttrs = new Map();
            const staticAttrs = new Map(child.attributes.map((a) => [a.name, a.value]));
            for (const c of child.children) {
                if (c instanceof DynamicBinding && c.kind === 'attribute' && c.target && c.target !== 'ref') {
                    dynAttrs.set(c.target, transformTracked(c.expression, tracked));
                }
            }
            const textParts = [];
            let hasDynamicText = false;
            for (const c of child.children) {
                if (c instanceof TextNode)
                    textParts.push(JSON.stringify(c.value));
                else if (c instanceof DynamicBinding && c.kind === 'text') {
                    hasDynamicText = true;
                    textParts.push(transformTracked(c.expression, tracked));
                }
            }
            const hasDynamic = dynAttrs.size > 0 || hasDynamicText;
            if (ctx.hydrate && (tag === 'script' || tag === 'link' || tag === 'style') && !hasDynamic) {
                continue;
            }
            if (tag === 'title') {
                if (hasDynamicText) {
                    ctx.push(`effect(() => { document.title = String(${textParts.join(' + ')}); });`);
                }
                else if (textParts.length > 0) {
                    ctx.push(`document.title = ${textParts[0]};`);
                }
            }
            else if (tag === 'meta') {
                const nameVal = staticAttrs.get('name') || dynAttrs.get('name') || staticAttrs.get('property') || dynAttrs.get('property') || 'charset';
                const selector = staticAttrs.has('name') || dynAttrs.has('name')
                    ? `meta[name="${nameVal}"]`
                    : staticAttrs.has('property') || dynAttrs.has('property')
                        ? `meta[property="${nameVal}"]`
                        : `meta[charset]`;
                if (hasDynamic) {
                    ctx.push(`effect(() => { let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement('meta'); document.head.appendChild(el); }`);
                    for (const [k, v] of staticAttrs)
                        if (!dynAttrs.has(k))
                            ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
                    for (const [k, v] of dynAttrs)
                        ctx.push(`el.setAttribute(${JSON.stringify(k)}, String(${v}));`);
                    ctx.push(`});`);
                }
                else {
                    for (const [k, v] of staticAttrs) {
                        ctx.push(`{ let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement('meta'); document.head.appendChild(el); } el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)}); }`);
                    }
                }
            }
            else if (tag === 'script') {
                const srcAttr = child.attributes.find((a) => a.name === 'src');
                const textChild = child.children.find((c) => c instanceof TextNode);
                if (srcAttr) {
                    const src = srcAttr.value;
                    ctx.push(`{ if (!document.querySelector('script[src=${JSON.stringify(src)}]')) { let el = document.createElement('script');`);
                    for (const a of child.attributes)
                        ctx.push(`el.setAttribute(${JSON.stringify(a.name)}, ${JSON.stringify(a.value)});`);
                    ctx.push(`document.head.appendChild(el); } }`);
                }
                else if (textChild) {
                    ctx.push(`{ let el = document.createElement('script');`);
                    for (const a of child.attributes)
                        ctx.push(`el.setAttribute(${JSON.stringify(a.name)}, ${JSON.stringify(a.value)});`);
                    ctx.push(`el.textContent = ${JSON.stringify(textChild.value)};`);
                    ctx.push(`document.head.appendChild(el); }`);
                }
            }
            else {
                const textChild = child.children.find((c) => c instanceof TextNode);
                let selector = tag;
                if (tag === 'link' && staticAttrs.has('href'))
                    selector = `link[href="${staticAttrs.get('href')}"]`;
                else if (tag === 'base')
                    selector = 'base';
                if (hasDynamic) {
                    ctx.push(`effect(() => { let el = document.querySelector(${JSON.stringify(selector)}) || (() => { const e = document.createElement(${JSON.stringify(tag)}); document.head.appendChild(e); return e; })();`);
                    for (const [k, v] of staticAttrs)
                        if (!dynAttrs.has(k))
                            ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
                    for (const [k, v] of dynAttrs)
                        ctx.push(`el.setAttribute(${JSON.stringify(k)}, String(${v}));`);
                    if (hasDynamicText)
                        ctx.push(`el.textContent = String(${textParts.join(' + ')});`);
                    else if (textChild)
                        ctx.push(`el.textContent = ${JSON.stringify(textChild.value)};`);
                    ctx.push(`});`);
                }
                else {
                    ctx.push(`{ let el = document.querySelector(${JSON.stringify(selector)}); if (!el) { el = document.createElement(${JSON.stringify(tag)}); document.head.appendChild(el); }`);
                    for (const [k, v] of staticAttrs)
                        ctx.push(`el.setAttribute(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
                    if (textChild)
                        ctx.push(`el.textContent = ${JSON.stringify(textChild.value)};`);
                    ctx.push(`}`);
                }
            }
        }
    }
}
function emitDynamicBinding(ctx, node, tracked, effectsVar) {
    if (node.kind === 'attribute')
        return null;
    const expr = transformTracked(node.expression, tracked);
    const v = ctx.n();
    ctx.push(`const ${v} = document.createTextNode('');`);
    const eff = `effect(() => { ${v}.data = String(${expr}); })`;
    if (effectsVar) {
        ctx.push(`${effectsVar}.push(${eff});`);
    }
    else {
        ctx.effects.push(`${eff};`);
    }
    return v;
}
function emitComponentCall(ctx, node, tracked, parentVar, compPrefix = '__components') {
    const propsEntries = node.props.map((p) => {
        if (typeof p.value === 'string')
            return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`;
        const expr = transformTracked(p.value, tracked);
        const simpleGet = expr.match(/^get\((\w+)\)$/);
        if (simpleGet && tracked.has(simpleGet[1])) {
            return `${JSON.stringify(p.name)}: ${simpleGet[1]}`;
        }
        return `${JSON.stringify(p.name)}: ${expr}`;
    });
    for (const sp of node.spreadProps) {
        const expr = transformTracked(sp, tracked);
        propsEntries.push(`...${expr}`);
    }
    if (node.children.length > 0) {
        const frag = ctx.n();
        ctx.push(`const ${frag} = (() => { const $f = document.createDocumentFragment();`);
        for (const child of node.children) {
            const childVar = emitNode(ctx, child, tracked, null, '$f');
            if (childVar)
                ctx.push(`$f.appendChild(${childVar});`);
        }
        ctx.push(`return $f; })();`);
        propsEntries.push(`children: ${frag}`);
    }
    const propsObj = `{ ${propsEntries.join(', ')} }`;
    const v = ctx.n();
    if (ctx.hydrate) {
        const access = ctx.importedNames.has(node.componentName)
            ? node.componentName
            : `__components[${JSON.stringify(node.componentName)}]`;
        const subScope = ctx.inTryBody
            ? `__hydrate.subWalker(${parentVar})`
            : `__hydrate.subWalker(__hydrate.nextElement())`;
        ctx.push(`const ${v} = ${access}(${propsObj}, __registry, ${subScope});`);
        return v;
    }
    else {
        if (ctx.importedNames.has(node.componentName)) {
            ctx.push(`const ${v} = ${node.componentName}(${propsObj});`);
        }
        else {
            ctx.push(`const ${v} = ${compPrefix}[${JSON.stringify(node.componentName)}](${propsObj});`);
        }
    }
    return v;
}
function emitTryCatch(ctx, node, tracked, effectsVar, parentVar) {
    const anchor = ctx.n();
    const endAnchor = ctx.n();
    const effArr = ctx.n();
    const catchParam = node.catchParamName || '__e';
    const parent = parentVar || '$root';
    ctx.push(`const ${anchor} = document.createComment('try');`);
    ctx.push(`${parent}.appendChild(${anchor});`);
    ctx.push(`let ${effArr} = [];`);
    ctx.push(`const ${endAnchor} = document.createComment('try-end');`);
    function emitRenderFunc(name, isCatch, hydMode, compPrefix = '__components') {
        const savedHydrate = ctx.hydrate;
        const savedInTryBody = ctx.inTryBody;
        ctx.hydrate = hydMode;
        if (hydMode && !isCatch) {
            ctx.inTryBody = true;
        }
        ctx.push(`const ${name} = ${isCatch ? `(${catchParam}) =>` : '() =>'} {`);
        ctx.push(indent(`const __p = ${anchor}.parentNode;`));
        const savedEffects = ctx.effects;
        ctx.effects = [];
        const body = isCatch ? node.catchBody : node.bodyTemplate;
        let parentOverride;
        if (hydMode && !isCatch) {
            parentOverride = ctx.n();
            ctx.push(`const ${parentOverride} = document.createDocumentFragment();`);
        }
        for (const child of body) {
            const childVar = emitNode(ctx, child, tracked, isCatch ? null : effArr, parentOverride, compPrefix);
            if (childVar)
                ctx.push(indent(`__p.insertBefore(${childVar}, ${endAnchor});`));
        }
        for (const eff of ctx.effects)
            ctx.push(indent(eff));
        ctx.effects = savedEffects;
        ctx.hydrate = savedHydrate;
        ctx.inTryBody = savedInTryBody;
        ctx.push(`};`);
    }
    const tryRender = ctx.n();
    emitRenderFunc(tryRender, false, ctx.hydrate);
    let catchRender = null;
    const hasCatch = node.catchBody.length > 0;
    if (hasCatch) {
        catchRender = ctx.n();
        emitRenderFunc(catchRender, true, ctx.hydrate);
    }
    ctx.push(`${parent}.appendChild(${endAnchor});`);
    if (hasCatch) {
        ctx.push(`try { ${tryRender}(); } catch(${catchParam}) { ${catchRender}(${catchParam}); }`);
    }
    else {
        ctx.push(`${tryRender}();`);
    }
    const tryRenderComp = ctx.n();
    emitRenderFunc(tryRenderComp, false, false, '__runtime_comps');
    let catchRenderComp = null;
    if (hasCatch) {
        catchRenderComp = ctx.n();
        emitRenderFunc(catchRenderComp, true, false, '__runtime_comps');
    }
    ctx.effects.push(`{
    effect(() => {
      for (const e of ${effArr}) destroy_block(e);
      ${effArr}.length = 0;
      __cleanup(${anchor}, ${endAnchor});
      try { ${tryRenderComp}(); } catch(${catchParam}) { ${hasCatch ? `${catchRenderComp}(${catchParam});` : 'throw ${catchParam};'} }
    });
  }`);
    return null;
}
function emitOpaque(ctx, node, tracked, parentVar) {
    const condExpr = transformTracked(node.condition, tracked);
    const hasElse = node.alternateNodes.length > 0;
    const anchor = ctx.n();
    const endAnchor = ctx.n();
    const effectsVar = ctx.n();
    ctx.push(`const ${anchor} = document.createComment('if');`);
    ctx.push(`${parentVar || '$root'}.appendChild(${anchor});`);
    ctx.push(`let ${effectsVar} = [];`);
    ctx.push(`const ${endAnchor} = document.createComment('if-end');`);
    const conRenderName = ctx.n();
    ctx.push(`const ${conRenderName} = () => {`);
    ctx.push(indent(`const __p = ${anchor}.parentNode;`));
    for (const n of node.consequentNodes) {
        const v = emitNode(ctx, n, tracked, effectsVar);
        if (v)
            ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
    }
    ctx.push(`};`);
    let altRenderName = null;
    if (hasElse) {
        altRenderName = ctx.n();
        ctx.push(`const ${altRenderName} = () => {`);
        ctx.push(indent(`const __p = ${anchor}.parentNode;`));
        for (const n of node.alternateNodes) {
            const v = emitNode(ctx, n, tracked, effectsVar);
            if (v)
                ctx.push(indent(`__p.insertBefore(${v}, ${endAnchor});`));
        }
        ctx.push(`};`);
    }
    ctx.push(`${parentVar || '$root'}.appendChild(${endAnchor});`);
    if (ctx.hydrate) {
        // During hydration, SSR content is already in the DOM.
    }
    else {
        ctx.push(`if (${condExpr}) { ${conRenderName}(); }` + (hasElse ? ` else { ${altRenderName}(); }` : ''));
    }
    ctx.effects.push(`{
    let __iv = ${ctx.hydrate ? `!${condExpr}` : 'true'};
    effect(() => {
      const __nv = ${condExpr};
      if (__nv !== __iv) {
        for (const e of ${effectsVar}) destroy_block(e);
        ${effectsVar}.length = 0;
        __cleanup(${anchor}, ${endAnchor});
        if (__nv) { ${conRenderName}(); }` + (hasElse ? ` else { ${altRenderName}(); }` : '') + `
        __iv = __nv;
      }
    });
  }`);
    return null;
}
function emitMap(ctx, node, tracked, parentVar) {
    const arrExpr = transformTracked(node.expression, tracked);
    const itemVar = node.itemVariable;
    const anchor = ctx.n();
    const endAnchor = ctx.n();
    const effectsVar = ctx.n();
    ctx.push(`const ${anchor} = document.createComment('map');`);
    ctx.push(`${parentVar || '$root'}.appendChild(${anchor});`);
    ctx.push(`let ${effectsVar} = [];`);
    ctx.push(`const ${endAnchor} = document.createComment('map-end');`);
    const renderItem = ctx.n();
    ctx.push(`const ${renderItem} = (${itemVar}, __e, __r) => {`);
    ctx.push(indent(`__r = __r || ${endAnchor};`));
    ctx.push(indent(`const __p = ${anchor}.parentNode;`));
    for (const n of node.bodyTemplate) {
        const v = emitNode(ctx, n, tracked, '__e');
        if (v)
            ctx.push(indent(`__p.insertBefore(${v}, __r);`));
    }
    ctx.push(`};`);
    ctx.push(`${parentVar || '$root'}.appendChild(${endAnchor});`);
    if (node.keyExpr) {
        const keyExpr = transformTracked(node.keyExpr, tracked);
        const reconciler = ctx.n();
        ctx.push(`const ${reconciler} = reconcile(${anchor}, ${endAnchor}, ${arrExpr}, ${itemVar} => ${keyExpr}, (${itemVar}, __e, __r) => ${renderItem}(${itemVar}, __e, __r));`);
        ctx.effects.push(`{
  let __first = true;
  effect(() => {
    if (__first) { __first = false; return; }
    ${reconciler}(${arrExpr});
  });
}`);
    }
    else {
        ctx.push(`for (const ${itemVar} of ${arrExpr}) {`);
        ctx.push(indent(`${renderItem}(${itemVar}, ${effectsVar});`));
        ctx.push(`}`);
        ctx.effects.push(`{
  let __first = true;
  effect(() => {
    if (__first) { __first = false; return; }
    for (const e of ${effectsVar}) destroy_block(e);
    ${effectsVar}.length = 0;
    __cleanup(${anchor}, ${endAnchor});
    for (const ${itemVar} of ${arrExpr}) {
      ${renderItem}(${itemVar}, ${effectsVar});
    }
  });
}`);
    }
    return null;
}
function generateComponent(comp, importedNames = new Set(), hydrate = false) {
    const tracked = collectTrackedNames(comp.body);
    const ctx = new Ctx();
    ctx.importedNames = importedNames;
    ctx.hydrate = hydrate;
    ctx.push(hydrate ? (comp.isAsync ? 'async (props, __registry, __hydrate) => {' : '(props, __registry, __hydrate) => {') : (comp.isAsync ? 'async (props) => {' : '(props) => {'));
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
    }
    else {
        ctx.push(indent(`const $root = document.createDocumentFragment();`));
    }
    const paramInit = buildParamInit(comp.paramNames);
    if (paramInit)
        ctx.push(indent(paramInit));
    for (const node of comp.body) {
        const v = emitNode(ctx, node, tracked, null);
        if (v) {
            if (ctx.hydrate) {
                ctx.push(indent(`if (${v}.parentNode !== $root) $root.appendChild(${v});`));
            }
            else {
                ctx.push(indent(`$root.appendChild(${v});`));
            }
        }
    }
    const effCode = ctx.flushEffects();
    if (effCode)
        ctx.push(indent(effCode.trim()));
    const delCode = ctx.emitDelegates();
    if (delCode)
        ctx.push(indent(delCode.trim()));
    ctx.push(indent(`return $root;`));
    ctx.push(indent(`} finally {`));
    ctx.push(indent(`\tsetActiveComponent(__prev);`));
    ctx.push(indent(`}`));
    ctx.push(`}`);
    return ctx.getCode();
}
function buildParamInit(paramNames) {
    if (paramNames.length === 1 && paramNames[0] === 'props')
        return '';
    if (paramNames.length === 0)
        return '';
    return `const { ${paramNames.join(', ')} } = props;`;
}
function buildComponentMap(irRoot, hydrate = false) {
    const mapLines = [];
    mapLines.push(`const __components = {};`);
    for (const comp of irRoot.components) {
        if (hydrate && isStaticComponent(comp)) {
            const stub = `(props, __registry, __hydrate) => { return __hydrate.root; }`;
            mapLines.push(`__components[${JSON.stringify(comp.name)}] = ${stub};`);
            continue;
        }
        const code = generateComponent(comp, irRoot.importedNames, hydrate);
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
    return mapLines.join('\n\n');
}
function isStaticIR(body) {
    for (const node of body) {
        if (node instanceof StaticNode) {
            for (const child of node.children) {
                if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target) {
                    if (child.target.startsWith('on') && child.target.length > 2)
                        return false;
                    return false;
                }
            }
            if (!isStaticIR(node.children))
                return false;
        }
        else if (!(node instanceof TextNode)) {
            return false;
        }
    }
    return true;
}
function isStaticComponent(comp) {
    if (comp.style)
        return false;
    return isStaticIR(comp.body);
}
function usedRuntimeBindings(ir) {
    const found = new Set();
    const allNames = ['bindValue', 'bindChecked', 'bindGroup'];
    for (const comp of ir.components) {
        for (const name of allNames) {
            if (found.has(name))
                continue;
            if (findBindingInIR(comp.body, new Set([name])))
                found.add(name);
        }
    }
    return found;
}
function findBindingInIR(nodes, names) {
    for (const node of nodes) {
        if (node instanceof DynamicBinding) {
            if (astHasBinding(node.expression.ast, names))
                return true;
        }
        else if (node instanceof OpaqueDynamicRegion) {
            if (astHasBinding(node.condition.ast, names))
                return true;
            if (findBindingInIR(node.consequentNodes, names))
                return true;
            if (findBindingInIR(node.alternateNodes, names))
                return true;
        }
        else if (node instanceof MapRegion) {
            if (astHasBinding(node.expression.ast, names))
                return true;
            if (findBindingInIR(node.bodyTemplate, names))
                return true;
        }
        else if (node instanceof WhileLoop) {
            if (astHasBinding(node.condition.ast, names))
                return true;
            if (findBindingInIR(node.bodyTemplate, names))
                return true;
        }
        else if (node instanceof SwitchBlock) {
            if (astHasBinding(node.discriminant.ast, names))
                return true;
            for (const c of node.cases) {
                if (c.test && astHasBinding(c.test.ast, names))
                    return true;
                if (findBindingInIR(c.body, names))
                    return true;
            }
        }
        else if (node instanceof TryCatch) {
            if (findBindingInIR(node.bodyTemplate, names))
                return true;
            if (findBindingInIR(node.catchBody, names))
                return true;
        }
        else if (node instanceof ForLoop) {
            if (astHasBinding(node.condition.ast, names))
                return true;
            if (findBindingInIR(node.bodyTemplate, names))
                return true;
        }
        else if (node instanceof ComponentCall) {
            for (const prop of node.props) {
                if (astHasBinding(prop.value.ast, names))
                    return true;
            }
            if (findBindingInIR(node.children, names))
                return true;
        }
        else if (node instanceof RuntimeStatement) {
            if (astHasBinding(node.ast, names))
                return true;
        }
        else if (node instanceof StaticNode) {
            if (findBindingInIR(node.children, names))
                return true;
        }
        else if (node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
            if (findBindingInIR(node.children, names))
                return true;
        }
    }
    return false;
}
function findFormNameInIR(nodes, name) {
    const fnPattern = name + '(';
    for (const node of nodes) {
        if (node instanceof ComponentCall) {
            if (node.componentName === name)
                return true;
            for (const prop of node.props) {
                if (prop.value && prop.value.raw && prop.value.raw.includes(fnPattern))
                    return true;
            }
            if (findFormNameInIR(node.children, name))
                return true;
        }
        if (node instanceof DynamicBinding && node.expression && node.expression.raw) {
            if (node.expression.raw.includes(fnPattern))
                return true;
        }
        if (node instanceof RuntimeStatement && node.raw) {
            if (node.raw.includes(fnPattern))
                return true;
        }
        if (node instanceof StaticNode || node instanceof ServerBlock || node instanceof ClientBlock || node instanceof HeadBlock) {
            if (findFormNameInIR(node.children, name))
                return true;
        }
    }
    return false;
}
function astHasBinding(ast, names) {
    if (!ast)
        return false;
    let found = false;
    walk(ast, null, {
        Identifier(node, context) {
            if (names.has(node.name))
                found = true;
            context.next();
        },
    });
    return found;
}
function hasKeyedMap(nodes) {
    for (const node of nodes) {
        if (node instanceof MapRegion && node.keyExpr)
            return true;
        if (node instanceof MapRegion && hasKeyedMap(node.bodyTemplate))
            return true;
        if (node instanceof WhileLoop && hasKeyedMap(node.bodyTemplate))
            return true;
        if (node instanceof SwitchBlock) {
            for (const c of node.cases) {
                if (hasKeyedMap(c.body))
                    return true;
            }
        }
        if (node instanceof TryCatch) {
            if (hasKeyedMap(node.bodyTemplate))
                return true;
            if (hasKeyedMap(node.catchBody))
                return true;
        }
        if (node instanceof ForLoop && hasKeyedMap(node.bodyTemplate))
            return true;
        if (node instanceof StaticNode && hasKeyedMap(node.children))
            return true;
        if (node instanceof ComponentCall && hasKeyedMap(node.children))
            return true;
        if (node instanceof OpaqueDynamicRegion) {
            if (hasKeyedMap(node.consequentNodes))
                return true;
            if (hasKeyedMap(node.alternateNodes))
                return true;
        }
    }
    return false;
}
export function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
export function compileClient(source, _componentName, options = {}) {
    const ast = parse(source);
    const ir = generateIR(ast, source);
    const needsClient = ir.components.some((c) => c.isClient || !isStaticComponent(c));
    if (!options.forceClient && !needsClient) {
        return '';
    }
    const componentMapCode = buildComponentMap(ir, options.hydrate);
    const importLines = ir.imports.length > 0 ? ir.imports.join('\n') + '\n' : '';
    const topCode = ir.topLevelCode.length > 0 ? ir.topLevelCode.join('\n') + '\n' : '';
    const exportLines = [];
    for (const comp of ir.components) {
        if (comp.exported) {
            if (comp.defaultExport) {
                exportLines.push(`export default __components[${JSON.stringify(comp.name)}];`);
            }
            else {
                exportLines.push(`export const ${comp.name} = __components[${JSON.stringify(comp.name)}];`);
            }
        }
    }
    const exportCode = exportLines.join('\n');
    const runtimeNames = ['track', 'get', 'set', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'reactiveProps'];
    if (ir.components.some(c => !isStaticIR(c.body)))
        runtimeNames.push('effect');
    for (const name of usedRuntimeBindings(ir))
        runtimeNames.push(name);
    for (const name of ['batch', 'derived']) {
        if (findBindingInIR(ir.components.flatMap(c => c.body), new Set([name])))
            runtimeNames.push(name);
    }
    if (ir.components.some(c => hasKeyedMap(c.body)))
        runtimeNames.push('reconcile');
    if (options.hydrate)
        runtimeNames.push('hydrate');
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
export { compileClient as compile, isStaticIR };
