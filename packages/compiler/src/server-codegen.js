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
} from './ir.js';
import { compileClient, isStaticIR } from './client-codegen.js';

const VOID_ELEMENTS = new Set([
	'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['style','script','title']);

function prettifyHtml(html) {
	let out = '';
	let depth = 0;
	let inRaw = false;
	let rawTag = '';
	const tokens = html.replace(/>\s+</g, '><').split(/(<[^>]+>)/);
	for (const token of tokens) {
		if (!token) continue;
		if (!token.startsWith('<')) {
			const text = token.trim();
			if (inRaw) {
				out += token;
			} else if (text) {
				out += '\t'.repeat(depth) + text + '\n';
			}
			continue;
		}
		const isClose = token[1] === '/';
		const isComment = token.startsWith('<!--');
		if (isComment) {
			out += '\t'.repeat(depth) + token + '\n';
			continue;
		}
		const tagMatch = token.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
		if (!tagMatch) {
			out += token;
			continue;
		}
		const tag = tagMatch[1].toLowerCase();
		const selfClose = token.endsWith('/>');
		if (isClose) {
			if (inRaw && tag === rawTag) inRaw = false;
			depth = Math.max(0, depth - 1);
			out += '\t'.repeat(depth) + token + '\n';
		} else {
			out += '\t'.repeat(depth) + token + '\n';
			if (!selfClose && !VOID_ELEMENTS.has(tag)) {
				depth++;
				if (RAW_TEXT_ELEMENTS.has(tag)) {
					inRaw = true;
					rawTag = tag;
				}
			}
		}
	}
	return out.trimEnd();
}
import { parse } from './parser.js';
import { generateIR } from './ir-generator.js';
let __cachedRuntimeModule = null;

export function setRuntimeModule(mod) {
	__cachedRuntimeModule = mod;
}

try {
	const runtimeDir = new URL('../../runtime/src/index-server.js', import.meta.url).href;
	__cachedRuntimeModule = await import(runtimeDir);
} catch {}
if (!__cachedRuntimeModule) {
	try {
		const { createRequire } = await import('module');
		const __require = createRequire(import.meta.url);
		for (const p of ['@vesk/runtime']) {
			try { __cachedRuntimeModule = __require(p); break; } catch {}
		}
	} catch {}
}
if (!__cachedRuntimeModule) __cachedRuntimeModule = {};

let __vskImportedNames = null;

/** Check if an IR body is fully static (no reactive/dynamic nodes). */
function isStatic(body) {
	for (const node of body) {
		if (node instanceof StaticNode) { if (!isStatic(node.children)) return false; }
		else if (!(node instanceof TextNode)) return false;
	}
	return true;
}

function escapeHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function indent(code, level = 1) {
	const pad = '\t'.repeat(level);
	return code.split('\n').map((l) => (l ? pad + l : '')).join('\n');
}

function exprJS(raw) {
	return `(${raw})`;
}

function irNodeToJS(node, importedNames, isAsync = false) {
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
		const lines = [];
		for (const n of node.children) {
			const code = irNodeToJS(n, importedNames, isAsync);
			if (code) lines.push(code);
		}
		return lines.join('\n');
	}
	if (node instanceof ClientBlock) return ''; // stripped from server output
	if (node instanceof HeadBlock) return ''; // collected separately for <head>
	if (node instanceof ForLoop) return forLoopToJS(node);
	if (node instanceof TrackDecl) {
		const inner = node.init.replace(/^track\(/, '').replace(/\)$/, '');
		return `const ${node.name} = (() => { try { const __v = (${inner}); return typeof __v === 'function' ? __v() : __v; } catch(e) { return void 0; } })();`;
	}
	if (node instanceof RuntimeStatement) return node.raw;
	if (node instanceof SlotNode) return `__out.push(props.children || '');`;
	return '';
}

/** @type {boolean} */
let __vskHydrate = false;
let __vskId = 0;

/**
 * Extract and evaluate local variable declarations from a component body
 * so they can be used when rendering <Head> content at compile time.
 * Returns a { varName: value } map.
 */
function evaluateLocals(comp, props) {
	const locals = {};
	for (const node of comp.body) {
		if (node instanceof RuntimeStatement && node.ast) {
			const stmt = node.ast;
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

/**
 * Render head content to HTML at compile time (elements inside <Head> blocks).
 * Evaluates local variable declarations so they're available for dynamic expressions.
 */
function renderHeadHtml(comp, props = {}) {
	const locals = evaluateLocals(comp, props);
	const seen = new Set();
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
	return parts.join('\n');
}

function headElementKey(node, props, locals) {
	if (!(node instanceof StaticNode)) return null;
	const tag = node.tag;
	if (tag === 'title') return 'title';
	if (tag === 'base') return 'base';

	// Evaluate all attributes (static + dynamic) to build the key
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
		// meta without identifying attribute — treat each as unique
		return null;
	}
	if (tag === 'link') {
		if (attrMap.has('href')) return `link[href=${attrMap.get('href')}]`;
		if (attrMap.has('id')) return `link[id=${attrMap.get('id')}]`;
		return null; // link without href — include always
	}
	if (tag === 'script') {
		if (attrMap.has('src')) return `script[src=${attrMap.get('src')}]`;
		return null; // inline script — include always
	}
	if (tag === 'style') return null; // always include
	return null;
}

function irNodeToHeadHtml(node, props, locals = {}) {
	if (node instanceof StaticNode) {
		// Build attribute map: static first, then dynamic bindings override
		const attrMap = new Map(node.attributes.map((a) => [a.name, a.value]));
		for (const child of node.children) {
			if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target && child.target !== 'ref') {
				try {
					const val = tryEvalExpr(child.expression.raw, props, locals);
					attrMap.set(child.target, String(val));
				} catch {
					// skip failed evaluations
				}
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

function tryEvalExpr(raw, props, locals = {}) {
	// First try with props alone
	try {
		const fn = new Function('props', 'return (' + raw + ')');
		return fn(props);
	} catch {
		// Try with locals merged into props
		const merged = { ...props, ...locals };
		try {
			const fn = new Function('props', 'return (' + raw + ')');
			return fn(merged);
		} catch {
			// Try with everything as individual variables
			const paramNames = Object.keys({ ...props, ...locals });
			const paramValues = paramNames.map((k) => (k in props ? props[k] : locals[k]));
			try {
				const fn = new Function(...paramNames, 'return (' + raw + ')');
				return fn(...paramValues);
			} catch {
				throw new Error('Cannot evaluate: ' + raw);
			}
		}
	}
}

function staticNodeToJS(node) {
	const lines = [];

	const dynAttrTargets = new Set();
	for (const child of node.children) {
		if (child instanceof DynamicBinding && child.kind === 'attribute' && child.target !== 'ref') {
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
		// Strip event handler attributes from SSR — bound via addEventListener on client
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

function dynamicBindingToJS(node) {
	if (node.kind === 'attribute') return '';
	const raw = node.expression.raw;
	return `{ const __v = ${exprJS(raw)}; if (__v != null) __out.push(typeof __v === 'boolean' ? (__v ? 'true' : '') : __escape(String(__v))); }`;
}

function opaqueRegionToJS(node) {
	const lines = [];
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

function mapRegionToJS(node) {
	const lines = [];
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

function whileLoopToJS(node) {
	const lines = [];
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

function switchBlockToJS(node) {
	const lines = [];
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

function tryCatchToJS(node) {
	const lines = [];
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

function forLoopToJS(node) {
	const lines = [];
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

function componentCallToJS(node, importedNames, isAsync = false) {
	const propsEntries = node.props.map((p) => {
		if (typeof p.value === 'string') return `${JSON.stringify(p.name)}: ${JSON.stringify(p.value)}`;
		return `${JSON.stringify(p.name)}: ${exprJS(p.value.raw)}`;
	});
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

function childrenToHTML(nodes) {
	const parts = [];
	for (const n of nodes) {
		if (n instanceof StaticNode) {
			const tag = n.tag;
			const attrs = n.attributes.map(a => ` ${a.name}="${escapeHtml(a.value)}"`).join('');
			if (n.selfClosing) {
				parts.push(`<${tag}${attrs}/>`);
			} else {
				const inner = childrenToHTML(n.children);
				parts.push(`<${tag}${attrs}>${inner}</${tag}>`);
			}
		} else if (n instanceof TextNode) {
			parts.push(escapeHtml(n.value));
		}
	}
	return parts.join('');
}

function generateFunctionBody(comp, importedNames) {
	const lines = [];
	lines.push(`const __sa = (__vesk && __vesk.setActiveComponent) || ((c) => { globalThis.__vesk_ctx = c; });`);
	lines.push(`const __ga = (__vesk && __vesk.getActiveComponent) || (() => globalThis.__vesk_ctx);`);
	lines.push(`const __prev = __ga();`);
	lines.push(`__sa({ c: null, p: __prev });`);
	lines.push(`try {`);
	lines.push(`const __out = [];`);
	lines.push(`const __escape = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\x22/g,'&quot;');`);

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

function buildComponentMap(irRoot, useSharedScope) {
	const map = new Map();
	const runtimeNames = extractRuntimeNames(irRoot.imports);
	const importedNames = new Set(runtimeNames);
	const topNames = extractTopLevelNames(irRoot.topLevelCode);
	const allNames = [...new Set([...runtimeNames, ...topNames])];
	const scopeDecl = allNames.length > 0 ? `const { ${allNames.join(', ')} } = __vesk;\n` : '';
	__vskImportedNames = importedNames;
	for (const comp of irRoot.components) {
		const bodyCode = generateFunctionBody(comp, importedNames);
		const paramInit = buildParamInit(comp.paramNames);
		const code = `${scopeDecl}${paramInit}\n${bodyCode}`;
		let fn;
		if (comp.isAsync) {
			fn = new Function('props', '__registry', '__vesk', `return (async () => {\n${code}\n})()`);
		} else {
			fn = new Function('props', '__registry', '__vesk', code);
		}
		map.set(comp.name, fn);
	}
	__vskImportedNames = null;
	return map;
}

function extractTopLevelNames(topLevelCode) {
	const names = [];
	for (const code of topLevelCode) {
		const match = code.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/);
		if (match) names.push(match[1]);
	}
	return names;
}

function extractRuntimeNames(importStrs) {
	const names = [];
	for (const imp of importStrs) {
		const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"]@vesk\/runtime['"]/);
		if (match) {
			for (const part of match[1].split(',')) {
				const name = part.trim().split(/\s+as\s+/).pop();
				if (name) names.push(name);
			}
		}
	}
	return names;
}

function buildParamInit(paramNames) {
	if (paramNames.length === 1 && paramNames[0] === 'props') {
		return '';
	}
	const destructured = [];
	for (const name of paramNames) {
		destructured.push(`${name}: props.${name}`);
	}
	if (destructured.length === 0) return '';
	if (destructured.length === 1) return `const { ${destructured[0]} } = props;`;
	return `const { ${destructured.join(', ')} } = props;`;
}

export { buildComponentMap, prettifyHtml };

/**
 * Render a component to HTML for SSR.
 *
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [props]
 * @param {Map} [registry] - component registry for cross-file references
 * @param {object} [options]
 * @param {boolean} [options.hydrate] - emit <!--vsk--> comment markers for client hydration
 */
const __runtimePath = new URL('../runtime/src/index-client.js', import.meta.url).pathname;

function loadRuntimeImports(importStrs) {
	const names = [];
	for (const imp of importStrs) {
		const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"]@vesk\/runtime['"]/);
		if (match) {
			for (const part of match[1].split(',')) {
				const name = part.trim().split(/\s+as\s+/).pop();
				if (name) names.push(name);
			}
		}
	}
	const mod = __cachedRuntimeModule;
	if (mod) {
		const result = {};
		if (mod.getActiveComponent) result.getActiveComponent = mod.getActiveComponent;
		if (mod.setActiveComponent) result.setActiveComponent = mod.setActiveComponent;
		for (const name of names) {
			if (name in mod) result[name] = mod[name];
		}
		return result;
	}
	return {};
}

function evalTopLevelCode(topLevelCode, __vesk) {
	for (const code of topLevelCode) {
		const constMatch = code.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(.+);?\s*$/s);
		if (constMatch) {
			try {
				const keys = Object.keys(__vesk);
				const params = [...keys, '__vesk', 'result'];
				const body = `result.value = ${constMatch[2]};`;
				const fn = new Function(...params, body);
				const result = { value: undefined };
				fn(...keys.map(k => __vesk[k]), __vesk, result);
				__vesk[constMatch[1]] = result.value;
			} catch {}
			continue;
		}
		const fnMatch = code.match(/^(?:export\s+)?(async\s+)?function\s+(\w+)\s*([\s\S]*)$/);
		if (fnMatch) {
			try {
				const keys = Object.keys(__vesk);
				const params = [...keys, '__vesk'];
				const asyncKw = fnMatch[1] || '';
				const body = `__vesk['${fnMatch[2]}'] = ${asyncKw}function ${fnMatch[2]}${fnMatch[3]};`;
				const fn = new Function(...params, body);
				fn(...keys.map(k => __vesk[k]), __vesk);
			} catch {}
		}
	}
}

/**
 * Compile a .vsk source file and return the component map, IR, and runtime imports.
 * Callers can cache this per-file to avoid recompilation on every request.
 */
export function compileFile(source) {
	const ast = parse(source);
	const ir = generateIR(ast, source);
	const componentMap = buildComponentMap(ir, true);
	const __vesk = loadRuntimeImports(ir.imports);
	evalTopLevelCode(ir.topLevelCode, __vesk);
	return { ir, componentMap, __vesk };
}

export function render(source, componentName, props = {}, registry = new Map(), options = {}) {
	__vskHydrate = !!options.hydrate;
	__vskId = 0;
	const ast = parse(source);
	const ir = generateIR(ast, source);
	const componentMap = buildComponentMap(ir, true);
	const renderFn = componentMap.get(componentName);
	if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
	const fullRegistry = new Map([...registry, ...componentMap]);
	const __vesk = options.__vesk || loadRuntimeImports(ir.imports);
	evalTopLevelCode(ir.topLevelCode, __vesk);
	const result = renderFn(props, fullRegistry, __vesk);
	const targetComp = ir.components.find((c) => c.name === componentName);
	if (targetComp?.isAsync) {
		return result.then ? result : Promise.resolve(result);
	}
	return result;
}

/**
 * Like `render` but also returns head content (extracted from <Head> blocks).
 */
export function renderPage(source, componentName, props = {}, registry = new Map(), options = {}) {
	__vskHydrate = !!options.hydrate;
	__vskId = 0;
	let __vesk, componentMap, ir;
	if (options.cached) {
		({ ir, componentMap, __vesk } = options.cached);
	} else {
		const compiled = compileFile(source);
		ir = compiled.ir;
		componentMap = compiled.componentMap;
		__vesk = compiled.__vesk;
	}

	// Enable SSR tracking for createResource during render
	globalThis.__vsk_ssr = true;
	const renderFn = componentMap.get(componentName);
	if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
	const fullRegistry = new Map([...registry, ...componentMap]);
	let bodyHtml;
	try {
		bodyHtml = renderFn(props, fullRegistry, __vesk);
	} finally {
		delete globalThis.__vsk_ssr;
	}

	const targetComp = ir.components.find((c) => c.name === componentName);
	if (targetComp?.isAsync) {
		return (async () => ({
			body: await bodyHtml,
			head: renderHeadHtml(targetComp, props),
			props
		}))();
	}
	const headHtml = targetComp ? renderHeadHtml(targetComp, props) : '';
	return { body: bodyHtml, head: headHtml, props };
}

/**
 * Static Site Generation — pre-render a component to a complete HTML page
 * with hydration support, following the Next.js SSG pattern.
 *
 * 1. Parses the source to find an exported `getStaticProps` function
 * 2. Calls it at build time to obtain props
 * 3. Renders the component to HTML with hydration markers
 * 4. Embeds serialized props as a JS variable (avoids JSON.parse overhead)
 *    and includes the client hydration bundle as an inline `<script>`
 *
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [customProps] - override props (bypasses getStaticProps)
 * @param {object} [options]
 * @param {Map} [options.registry] - cross-file component registry
 * @returns {{ html: string, props: string, clientCode: string, static: boolean }}
 */
export async function ssg(source, componentName, customProps, options = {}) {
	const ast = parse(source);
	const ir = generateIR(ast, source);

	// Auto-detect component: prefer default export, else first exported, else first
	if (!componentName) {
		const defaultComp = ir.components.find((c) => c.defaultExport);
		const exportedComp = ir.components.find((c) => c.exported);
		componentName = defaultComp?.name || exportedComp?.name || (ir.components.length > 0 ? ir.components[0].name : null);
	}
	if (!componentName) throw new Error('No component found in source for SSG');

	let props = customProps;

	// Call getStaticProps if present and no custom props provided
	if (props === undefined && ir.staticProps) {
		props = await callStaticProps(ir.staticProps);
	}
	if (props === undefined) props = {};

	// Check whether any component needs client JS
	const needsClient = ir.components.some((c) => {
		if (c.isClient) return true;
		if (c.style) return true;
		return !isStatic(c.body);
	});

	// Server-render: only add hydration markers if client code exists
	const rendered = await renderPage(source, componentName, props, options.registry || new Map(), { hydrate: needsClient });
	const bodyHtml = rendered.body;
	const headHtml = rendered.head;

	// Client hydration bundle (empty for fully static pages)
	const clientCode = needsClient
		? compileClient(source, null, { hydrate: true })
		: '';

	const serializedProps = JSON.stringify(props);
	const hasClient = clientCode.length > 0;

	// No serialization boundary: embed props as a JS literal instead of JSON + JSON.parse
	const scriptBlock = hasClient
		? `\n<script>const __vesk_props = ${serializedProps};</script>\n<script>${clientCode}</script>\n`
		: `\n<script>const __vesk_props = ${serializedProps};</script>\n`;

	const cssUrl = options.cssUrl || '';
	const cssLink = cssUrl ? `\t<link rel="stylesheet" href="${cssUrl}" />\n` : '';
	const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
${cssLink}${headHtml ? '\t' + headHtml.split('\n').join('\n\t') + '\n' : ''}</head>
<body>
${bodyHtml}${scriptBlock}</body>
</html>
`;

	// No double data for lists: check if map bodies are fully static
	const staticLists = ir.components.some((c) => {
		return c.body.some((node) => {
			if (node instanceof MapRegion) return isStaticIR(node.bodyTemplate);
			return false;
		});
	});

	return { html, body: bodyHtml, head: headHtml, props: serializedProps, clientCode, static: !hasClient, staticLists };
}

/**
 * Full-page SSR — returns a complete HTML document as a string.
 * Wraps renderPage() output in a proper HTML5 document with <head> and <body>.
 * If the source has a `load` export, it is called before render to fetch SSR data.
 * Also handles SSR resource tracking for createResource().
 */
export async function renderFullPage(source, componentName, props = {}, registry = new Map(), options = {}) {
	globalThis.__vsk_ssr = true;
	try {
		let ssrProps = { ...props };
		let serializedProps = null;
		const ast = parse(source);
		const ir = generateIR(ast, source);
		if (ir.loadFn) {
			const __vesk = options.__vesk || loadRuntimeImports(ir.imports);
			const loadResult = await callLoadFunction(ir.loadFn, props, __vesk);
			if (loadResult && typeof loadResult === 'object') {
				if (loadResult.props) ssrProps = { ...ssrProps, ...loadResult.props };
				else ssrProps = { ...ssrProps, ...loadResult };
			}
			serializedProps = JSON.stringify(ssrProps);
		}
		const rendered = renderPage(source, componentName, ssrProps, registry, { ...options, __vesk: options.__vesk || (ir.loadFn ? undefined : undefined) });

		const ssrData = globalThis.__vsk_ssr_data || {};
		if (globalThis.__vsk_ssr_promises?.length > 0) {
			await Promise.allSettled(globalThis.__vsk_ssr_promises);
			const collectedData = globalThis.__vsk_ssr_data || {};
			Object.assign(ssrData, collectedData);
		}
		delete globalThis.__vsk_ssr_promises;

		// Merge page head with layout head (page overrides layout on key collisions)
		let headHtml = rendered.head;
		if (options.pageHead) {
			const merged = mergeHeadHtml(options.pageHead, rendered.head);
			headHtml = merged.html;
			if (merged.conflicts.length > 0) {
				for (const c of merged.conflicts) {
					console.error(`vesk head conflict: ${c.message}`);
				}
			}
		}

		const bodyHtml = prettifyHtml(rendered.body);
		const cssLink = options.cssUrl ? `\t<link rel="stylesheet" href="${options.cssUrl}" />\n` : '';
		const clientScript = options.clientScriptUrl
			? `\t<script type="module" src="${options.clientScriptUrl}"></script>\n`
			: '';

		const dataScripts = [];
		if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};</script>`);
		const ssrDataKeys = Object.keys(ssrData);
		if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
		const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
${cssLink}${headHtml ? '\t' + headHtml.split('\n').join('\n\t') + '\n' : ''}</head>
<body>
<div id="root">
${bodyHtml}
</div>
${dataScriptBlock}${clientScript}</body>
</html>`;
	} finally {
		delete globalThis.__vsk_ssr;
	}
}

/**
 * Merge two head HTML strings by key. The second (pageHead) overrides the first (layoutHead)
 * when keys collide. Returns merged HTML and any sibling-level conflicts found within pageHead.
 */
export function mergeHeadHtml(pageHead, layoutHead) {
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
		if (tagStr.startsWith('<title')) return 'title';
		if (tagStr.startsWith('<base')) {
			const h = tagStr.match(/href=["']([^"']+)["']/);
			return h ? `base[href=${h[1]}]` : 'base';
		}
		if (tagStr.startsWith('<meta')) {
			const n = tagStr.match(/\sname=["']([^"']+)["']/);
			if (n) return `meta[name=${n[1]}]`;
			const p = tagStr.match(/\sproperty=["']([^"']+)["']/);
			if (p) return `meta[property=${p[1]}]`;
			const c = tagStr.match(/\scharset=["']?([^"'\s>]+)/);
			if (c) return `meta[charset]`;
			return null;
		}
		if (tagStr.startsWith('<link')) {
			const h = tagStr.match(/href=["']([^"']+)["']/);
			if (h) return `link[href=${h[1]}]`;
			return null;
		}
		if (tagStr.startsWith('<script')) {
			const s = tagStr.match(/src=["']([^"']+)["']/);
			if (s) return `script[src=${s[1]}]`;
			return null;
		}
		return null;
	};

	const layoutEntries = parseHead(layoutHead);
	const pageEntries = parseHead(pageHead);

	const merged = new Map();
	for (const tag of layoutEntries) {
		const key = extractKey(tag);
		if (key) merged.set(key, { html: tag, source: 'layout' });
	}

	const conflicts = [];
	for (const tag of pageEntries) {
		const key = extractKey(tag);
		if (key) {
			if (merged.has(key) && merged.get(key).source === 'page') {
				// Two sibling page components set the same key — warn
				conflicts.push({ key, message: `Sibling conflict for <head> key "${key}":\n  ${merged.get(key).html}\n  ${tag}` });
			}
			merged.set(key, { html: tag, source: 'page' });
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

/**
 * Streaming SSR — yields HTML chunks progressively using an async generator.
 * The shell (<html><head>...) is yielded first, then the body content.
 * Supports async data fetching via async component functions.
 */
export async function* renderPageStream(source, componentName, props = {}, registry = new Map(), options = {}) {
	const rendered = renderPage(source, componentName, props, registry, options);
	const cssLink = options.cssUrl ? `\t<link rel="stylesheet" href="${options.cssUrl}" />\n` : '';
	yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n';
	if (cssLink) yield cssLink;
	if (rendered.head) {
		yield '\t' + rendered.head.split('\n').join('\n\t') + '\n';
	}
	yield '</head>\n<body>\n';
	yield rendered.body;
	yield '\n</body>\n</html>\n';
}

/**
 * Evaluate a getStaticProps function at build time (sync or async).
 * Always returns a Promise of the resolved props.
 */
async function callStaticProps(fnSource) {
	const isAsync = fnSource.trimStart().startsWith('async');
	const wrapper = isAsync
		? `return (async () => {\n${fnSource}\nreturn await getStaticProps();\n})()`
		: `return (() => {\n${fnSource}\nreturn getStaticProps();\n})()`;
	const fn = new Function(wrapper);
	const result = fn();
	const resolved = result && typeof result.then === 'function' ? await result : result;
	return resolved && resolved.props ? resolved.props : resolved;
}

/**
 * Evaluate a `load` function during SSR (sync or async).
 * The load function receives ({ params, request, fetch, url }) and returns
 * either { props: {...} } or a plain object to merge into props.
 */
async function callLoadFunction(fnSource, currentProps, __vesk) {
	const isAsync = fnSource.trimStart().startsWith('async');
	// Build context object for load function
	// The load function receives ({ params, request, fetch, url }) — SvelteKit-style
	const ctx = {
		params: currentProps.params || {},
		request: currentProps.request || null,
		fetch: globalThis.fetch,
		url: currentProps.url || '',
	};
	const ctxCode = `const __ctx = ${JSON.stringify(ctx)};\n`;
	const wrapper = isAsync
		? `return (async () => {\n${ctxCode}\n${fnSource}\nreturn await load(__ctx);\n})()`
		: `return (() => {\n${ctxCode}\n${fnSource}\nreturn load(__ctx);\n})()`;
	const fn = new Function(wrapper);
	const result = fn();
	const resolved = result && typeof result.then === 'function' ? await result : result;
	return resolved;
}


