/**
 * Shared utilities for server-side code generation and rendering.
 * Includes HTML escaping, JS expression evaluation, runtime import loading,
 * top-level code evaluation, and state management for SSR.
 * @module server-utils
 */

import { StaticNode, TextNode, DynamicBinding } from './ir.js';

/** Elements that self-close in HTML — never wrap content. */
const VOID_ELEMENTS = new Set([
	'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);
/** Elements whose content is treated as raw text (no child HTML parsing). */
const RAW_TEXT_ELEMENTS = new Set(['style','script','title']);

/** @type {boolean} Enable hydration markers when set before render. */
export let __vskHydrate = false;
/** @type {number} Counter for unique hydration IDs. */
export let __vskId = 0;
/** @type {Set<string>|null} Names imported from @vesk/runtime, used to resolve component calls. */
export let __vskImportedNames = null;

export function resetVskState(hydrate = false) {
	__vskHydrate = hydrate;
	__vskId = 0;
}

export function setVskImportedNames(names) {
	__vskImportedNames = names;
}

/**
 * Pretty-print HTML with indentation for readability.
 * Each level of nesting increases indent by one tab.
 */
export function prettifyHtml(html) {
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

/**
 * Check if an IR body is fully static (no reactive/dynamic nodes).
 * Used to determine whether client-side JS is needed.
 */
export function isStatic(body) {
	for (const node of body) {
		if (node instanceof StaticNode) { if (!isStatic(node.children)) return false; }
		else if (!(node instanceof TextNode)) return false;
	}
	return true;
}

/** Escape HTML special characters (`& < > " '`) for safe inclusion in HTML output. */
export function escapeHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Wrap a raw JS expression string in parentheses for safe interpolation. */
export function exprJS(raw) {
	return `(${raw})`;
}

/**
 * Indent a code string by a given number of levels (default 1).
 * Each level is one tab character.
 * Used by code generators to produce readable nested JS output.
 */
export function indent(code, level = 1) {
	const tab = '\t';
	return code.split('\n').map(line => line ? tab.repeat(level) + line : line).join('\n');
}

/**
 * Try to evaluate a raw JS expression against props and local variables,
 * falling back through three strategies: props only, merged locals, individual params.
 */
export function tryEvalExpr(raw, props, locals = {}) {
	try {
		const fn = new Function('props', 'return (' + raw + ')');
		return fn(props);
	} catch {
		const merged = { ...props, ...locals };
		try {
			const fn = new Function('props', 'return (' + raw + ')');
			return fn(merged);
		} catch {
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

/**
 * Serialize child IR nodes into a static HTML string.
 * Only handles StaticNode and TextNode — dynamic children are skipped.
 */
export function childrenToHTML(nodes) {
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

/** Extract top-level variable/function names from top-level code strings for scope injection. */
export function extractTopLevelNames(topLevelCode) {
	const names = [];
	for (const code of topLevelCode) {
		const match = code.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/);
		if (match) names.push(match[1]);
	}
	return names;
}

/** Extract imported names from `@vesk/runtime` import statements. */
export function extractRuntimeNames(importStrs) {
	const names = [];
	for (const imp of importStrs) {
		const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"](?:@vesk\/runtime|@vesk\/reactivity)['"]/);
		if (match) {
			for (const part of match[1].split(',')) {
				const name = part.trim().split(/\s+as\s+/).pop();
				if (name) names.push(name);
			}
		}
	}
	return names;
}

/**
 * Build parameter destructuring code for component function props.
 * If the component uses `props` as the single param, no destructuring is needed.
 */
export function buildParamInit(paramNames) {
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

// ── Runtime module cache ─────────────────────────────────────────

let __cachedRuntimeModule = null;

export function setRuntimeModule(mod) {
	__cachedRuntimeModule = mod;
}

// Preload runtime module at import time
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

/**
 * Extract the subset of runtime exports needed by a component's imports.
 * Returns an object with only the named exports used, plus active-component helpers.
 */
export function loadRuntimeImports(importStrs) {
	const names = extractRuntimeNames(importStrs);
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

/**
 * Execute top-level code (imports, constants, functions) in the context
 * of the loaded runtime module. This makes runtime imports available
 * to component render functions at SSR time.
 */
export function evalTopLevelCode(topLevelCode, __vesk) {
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
 * Evaluate a `getStaticProps` function at build time (sync or async).
 * Always returns a Promise of the resolved props.
 */
export async function callStaticProps(fnSource) {
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
export async function callLoadFunction(fnSource, currentProps, __vesk) {
	const isAsync = fnSource.trimStart().startsWith('async');
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
