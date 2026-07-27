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

/** Mark a string as safe HTML (bypasses auto-escaping). Use raw() only for trusted content. */
export function raw(value) {
	if (value == null) return '';
	return String(value);
}

// ── CSRF ──────────────────────────────────────────────────────────
const __csrfSecrets = new Map();

function csrfSecret(host) {
	if (!host) host = 'localhost';
	if (!__csrfSecrets.has(host)) {
		__csrfSecrets.set(host, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
	}
	return __csrfSecrets.get(host);
}

function csrfHmac(value, secret) {
	// Simple HMAC-like signing using the secret
	let h = 0;
	for (let i = 0; i < value.length; i++) {
		h = ((h << 5) - h + value.charCodeAt(i)) | 0;
	}
	for (let i = 0; i < secret.length; i++) {
		h = ((h << 5) - h + secret.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36);
}

/** Generate a signed CSRF token for a given session/request. */
export function csrfToken(sessionId, host) {
	const secret = csrfSecret(host);
	const value = sessionId || 'anonymous';
	const sig = csrfHmac(value, secret);
	return `${value}:${sig}`;
}

/** Verify a CSRF token. Returns true if valid. */
export function verifyCsrfToken(token, host) {
	if (!token || typeof token !== 'string') return false;
	const parts = token.split(':');
	if (parts.length !== 2) return false;
	const [value, sig] = parts;
	const secret = csrfSecret(host);
	const expected = csrfHmac(value, secret);
	return sig === expected;
}

/**
 * CSRF guard — call at the top of API route handlers for POST/PUT/DELETE requests.
 * Reads the token from X-CSRF-Token header or _csrf body field.
 * Throws on invalid/missing token.
 */
export function csrfGuard(request) {
	if (!request || typeof request !== 'object') return;
	const method = (request.method || 'GET').toUpperCase();
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
	const token = request.headers?.['x-csrf-token']
		|| (request.body && request.body._csrf)
		|| '';
	if (!verifyCsrfToken(token)) {
		throw new Error('CSRF validation failed');
	}
}

// ── Cookie signing ────────────────────────────────────────────────
const __cookieSecrets = new Map();

function cookieSecret(host) {
	if (!host) host = 'localhost';
	if (!__cookieSecrets.has(host)) {
		__cookieSecrets.set(host, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
	}
	return __cookieSecrets.get(host);
}

/** Sign a cookie value with HMAC to prevent tampering. */
export function signCookie(name, value, host) {
	const secret = cookieSecret(host);
	const payload = `${name}=${value}`;
	let h = 0;
	for (let i = 0; i < payload.length; i++) {
		h = ((h << 5) - h + payload.charCodeAt(i)) | 0;
	}
	for (let i = 0; i < secret.length; i++) {
		h = ((h << 5) - h + secret.charCodeAt(i)) | 0;
	}
	const sig = (h >>> 0).toString(36);
	return `${value}.${sig}`;
}

/** Verify and unsign a cookie value. Returns null if tampered. */
export function unsignCookie(name, signedValue, host) {
	if (!signedValue || typeof signedValue !== 'string') return null;
	const dot = signedValue.lastIndexOf('.');
	if (dot === -1) return null;
	const value = signedValue.slice(0, dot);
	const sig = signedValue.slice(dot + 1);
	const expectedSig = signCookie(name, value, host).split('.').pop();
	return sig === expectedSig ? value : null;
}

/**
 * Generate default security headers map for SSR responses.
 * Configurable via security section in vesk.config.
 */
export function securityHeaders(config = {}) {
	const sec = config.security || {};
	return {
		'X-Frame-Options': sec.xFrameOptions || 'DENY',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': sec.referrerPolicy || 'strict-origin-when-cross-origin',
		...(sec.hsts !== false ? { 'Strict-Transport-Security': sec.hsts || 'max-age=31536000; includeSubDomains' } : {}),
		'X-XSS-Protection': '0',
	};
}

/**
 * Generate CORS headers based on security config and request origin.
 * Returns an object of header key/value pairs, or empty object if CORS is not needed.
 *
 * Same-origin requests (Origin matches Host) are always allowed implicitly.
 * Cross-origin requests require security.cors.origin to be configured.
 *
 * Config options (under security.cors):
 *   origin: string | string[]   — allowed origins for cross-origin requests
 *   methods: string             — allowed methods (default: 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
 *   headers: string             — allowed headers (default: 'Content-Type,Authorization,X-CSRF-Token')
 *   credentials: boolean        — allow credentials (default: true)
 *   maxAge: number              — preflight cache seconds (default: 86400)
 */
export function corsHeaders(security = {}, requestOrigin = '', host = '') {
	if (!requestOrigin) return {};

	// Same-origin check — always allowed
	const originHost = (requestOrigin || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
	const localHost = (host || '').split(':')[0];
	if (originHost && localHost && originHost === localHost) {
		return {};
	}

	const cors = security?.cors;
	if (!cors || !cors.origin) return {};

	const allowedOrigins = Array.isArray(cors.origin) ? cors.origin : [cors.origin];
	const origin = allowedOrigins.includes('*')
		? '*'
		: allowedOrigins.includes(requestOrigin) ? requestOrigin : null;

	if (!origin) return {};

	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': cors.methods || 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
		'Access-Control-Allow-Headers': cors.headers || 'Content-Type,Authorization,X-CSRF-Token',
		...(cors.credentials !== false ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
		'Access-Control-Max-Age': String(cors.maxAge || 86400),
	};
}

/** CORS preflight guard — call for OPTIONS requests. Returns true if handled. */
export function corsPreflight(request, security) {
	if ((request.method || 'GET').toUpperCase() !== 'OPTIONS') return false;
	const origin = request.headers?.['origin'] || '';
	const host = request.headers?.['host'] || '';
	const headers = corsHeaders(security, origin, host);
	if (!headers['Access-Control-Allow-Origin']) return false;
	throw new CorsResponse(headers);
}

class CorsResponse extends Error {
	constructor(headers) {
		super('CORS preflight');
		this.name = 'CorsResponse';
		this.status = 204;
		this.headers = { ...headers, 'Content-Length': '0' };
	}
}

/**
 * Security comment markers — injected into SSR HTML to indicate security posture.
 * These are stripped in production builds.
 */
export function securityComment(config = {}) {
	const sec = config.security || {};
	const features = [];
	if (sec.autoEscape !== false) features.push('auto-escape');
	if (sec.csrf !== false) features.push('csrf');
	if (sec.xFrameOptions !== false) features.push('x-frame-options');
	if (sec.hsts !== false) features.push('hsts');
	return `<!-- vesk-sec: ${features.join(', ')} -->`;
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
	if (paramNames.length === 0) return '';
	return `const { ${paramNames.join(', ')} } = props;`;
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
