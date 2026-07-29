/**
 * Server-side rendering functions for Vesk components.
 * Provides compileFile, render, renderPage, ssg, renderFullPage, and renderPageStream.
 * @module server-render
 */

import { MapRegion } from './ir.js';
import { parse } from './parser.js';
import { generateIR } from './ir-generator.js';
import { compileClient, isStaticIR } from './client-codegen.js';
import {
	isStatic, prettifyHtml, resetVskState,
	loadRuntimeImports, evalTopLevelCode,
	callStaticProps, callLoadFunction,
	securityHeaders, securityComment,
} from './server-utils.js';
import { renderHeadHtml, mergeHeadHtml } from './server-head.js';
import { buildComponentMap } from './server-jsgen.js';

/**
 * Compile a .vsk source file and return the component map, IR, and runtime imports.
 * Parses the source, generates IR, builds the render-function map, loads runtime imports,
 * and evaluates top-level code so that render functions can be called immediately.
 * Callers can cache the result per-file to avoid recompilation on every request.
 * @param {string} source - raw .vsk source text
 * @returns {{ ir: object, componentMap: Map<string, Function>, __vesk: object }}
 */
export function compileFile(source) {
	const ast = parse(source);
	const ir = generateIR(ast, source);
	const componentMap = buildComponentMap(ir, true);
	const __vesk = loadRuntimeImports(ir.imports);
	evalTopLevelCode(ir.topLevelCode, __vesk);
	return { ir, componentMap, __vesk };
}

/**
 * Render a component to an HTML string (body only, no document shell).
 * This is the lowest-level render: no load function support, no head collection.
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [props]
 * @param {Map} [registry] - component registry for cross-file references
 * @param {object} [options]
 * @param {boolean} [options.hydrate] - emit hydration comment markers
 * @returns {string|Promise<string>} HTML string (Promise if component is async)
 */
export function render(source, componentName, props = {}, registry = new Map(), options = {}) {
	resetVskState(!!options.hydrate);
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
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [props]
 * @param {Map} [registry] - cross-file component registry
 * @param {object} [options]
 * @param {boolean} [options.hydrate] - emit hydration markers
 * @param {object} [options.cached] - pre-compiled { ir, componentMap, __vesk } to avoid recompilation
 * @returns {{ body: string, head: string, props: object }|Promise<{ body: string, head: string, props: object }>}
 */
export function renderPage(source, componentName, props = {}, registry = new Map(), options = {}) {
	resetVskState(!!options.hydrate);
	let __vesk, componentMap, ir;
	if (options.cached) {
		({ ir, componentMap, __vesk } = options.cached);
	} else {
		const compiled = compileFile(source);
		ir = compiled.ir;
		componentMap = compiled.componentMap;
		__vesk = compiled.__vesk;
	}

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
 * with hydration support, following the SSG pattern.
 *
 * 1. Parses the source to find an exported `getStaticProps` function
 * 2. Calls it at build time to obtain props
 * 3. Renders the component to HTML with hydration markers
 * 4. Embeds serialized props as a JS variable and includes the client hydration bundle
 *
 * @param {string} source - raw .vsk source
 * @param {string} [componentName] - auto-detected if omitted
 * @param {object} [customProps] - override props (bypasses getStaticProps)
 * @param {object} [options]
 * @param {Map} [options.registry] - cross-file component registry
 * @returns {Promise<{ html: string, body: string, head: string, props: string, clientCode: string, static: boolean, staticLists: boolean }>}
 */
export async function ssg(source, componentName, customProps, options = {}) {
	const ast = parse(source);
	const ir = generateIR(ast, source);

	if (!componentName) {
		const defaultComp = ir.components.find((c) => c.defaultExport);
		const exportedComp = ir.components.find((c) => c.exported);
		componentName = defaultComp?.name || exportedComp?.name || (ir.components.length > 0 ? ir.components[0].name : null);
	}
	if (!componentName) throw new Error('No component found in source for SSG');

	let props = customProps;
	if (props === undefined && ir.staticProps) {
		props = await callStaticProps(ir.staticProps);
	}
	if (props === undefined) props = {};

	const needsClient = ir.components.some((c) => {
		if (c.isClient) return true;
		if (c.style) return true;
		return !isStatic(c.body);
	});

	const rendered = await renderPage(source, componentName, props, options.registry || new Map(), { hydrate: needsClient });
	const bodyHtml = rendered.body;
	const headHtml = rendered.head;

	const clientCode = needsClient
		? compileClient(source, null, { hydrate: true })
		: '';

	const serializedProps = JSON.stringify(props);
	const hasClient = clientCode.length > 0;

	const scriptBlock = hasClient
		? `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n<script>${clientCode}</script>\n`
		: `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n`;

	const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
	const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');
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
 *
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [props]
 * @param {Map} [registry] - cross-file component registry
 * @param {object} [options]
 * @param {string} [options.cssUrl] - URL for a global CSS file
 * @param {string} [options.clientScriptUrl] - URL for the client hydration script
 * @param {string} [options.pageHead] - head HTML from the page component (for layout merging)
 * @param {object} [options.security] - security config (autoEscape, csrf, xFrameOptions, hsts)
 * @returns {Promise<{html: string, headers: object}>} complete HTML document with security headers
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
		const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
		const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');
		const clientScript = options.clientScriptUrl
			? `\t<script type="module" src="${options.clientScriptUrl}"></script>\n`
			: '';

		const dataScripts = [];
		if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};</script>`);
		const ssrDataKeys = Object.keys(ssrData);
		if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
		const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';

		const headLines = ['\t<meta charset="utf-8" />', '\t<meta name="viewport" content="width=device-width, initial-scale=1" />'];
		if (cssLink) headLines.push(cssLink.trimEnd());
		if (headHtml) headLines.push('\t' + headHtml.split('\n').join('\n\t'));

		if (options.security) {
			const sec = options.security;
			if (sec.xFrameOptions !== false) headLines.push(`\t<meta http-equiv="X-Frame-Options" content="${sec.xFrameOptions || 'DENY'}" />`);
			if (sec.referrerPolicy !== false) headLines.push(`\t<meta name="referrer" content="${sec.referrerPolicy || 'strict-origin-when-cross-origin'}" />`);
			if (sec.contentSecurityPolicy !== false) headLines.push(`\t<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />`);
			if (sec.autoEscape !== false) headLines.push(`\t<!-- vesk: auto-escape enabled -->`);
		}

		return `<!DOCTYPE html>
<html>
<head>
${headLines.join('\n')}</head>
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
 * Streaming SSR — yields HTML chunks progressively using an async generator.
 * The shell (<html><head>...</head><body>) is yielded first, then the body
 * content once it finishes rendering. This lets the browser start loading
 * CSS/fonts/scripts before the full page is ready.
 *
 * Supports:
 *   - load function (async data fetching before render)
 *   - createResource SSR data collection
 *   - client script injection
 *   - CSS link injection
 *   - security headers / meta tags
 *
 * @param {string} source - raw .vsk source
 * @param {string} componentName
 * @param {object} [props]
 * @param {Map} [registry] - cross-file component registry
 * @param {object} [options]
 * @param {boolean} [options.hydrate] - emit hydration markers
 * @param {string} [options.cssUrl] - URL for global CSS
 * @param {string} [options.clientScriptUrl] - URL for client hydration bundle
 * @param {string} [options.pageHead] - head HTML from page (for layout merging)
 * @param {object} [options.security] - security config
 * @yields {string} HTML chunks
 */
export async function* renderPageStream(source, componentName, props = {}, registry = new Map(), options = {}) {
	const ast = parse(source);
	const ir = generateIR(ast, source);

	let ssrProps = { ...props };
	let serializedProps = null;
	let __vesk = loadRuntimeImports(ir.imports);

	if (ir.loadFn) {
		const loadResult = await callLoadFunction(ir.loadFn, props, __vesk);
		if (loadResult && typeof loadResult === 'object') {
			if (loadResult.props) ssrProps = { ...ssrProps, ...loadResult.props };
			else ssrProps = { ...ssrProps, ...loadResult };
		}
		serializedProps = JSON.stringify(ssrProps);
	}

	const { componentMap } = compileFile(source);
	const fullRegistry = new Map([...registry, ...componentMap]);
	const renderFn = componentMap.get(componentName);
	if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);

	resetVskState(!!options.hydrate);

	const targetComp = ir.components.find((c) => c.name === componentName);
	const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
	const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');

	yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n';
	if (cssLink) yield cssLink;
	if (options.security) {
		const sec = options.security;
		if (sec.xFrameOptions !== false) yield `\t<meta http-equiv="X-Frame-Options" content="${sec.xFrameOptions || 'DENY'}" />\n`;
		if (sec.referrerPolicy !== false) yield `\t<meta name="referrer" content="${sec.referrerPolicy || 'strict-origin-when-cross-origin'}" />\n`;
		if (sec.contentSecurityPolicy !== false) yield `\t<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
		if (sec.autoEscape !== false) yield `\t<!-- vesk: auto-escape enabled -->\n`;
	}
	if (targetComp) {
		let headHtml = renderHeadHtml(targetComp, ssrProps);
		if (options.pageHead) {
			const merged = mergeHeadHtml(options.pageHead, headHtml);
			headHtml = merged.html;
			if (merged.conflicts.length > 0) {
				for (const c of merged.conflicts) {
					console.error(`vesk head conflict: ${c.message}`);
				}
			}
		}
		if (headHtml) yield '\t' + headHtml.split('\n').join('\n\t') + '\n';
	}
	yield '</head>\n<body>\n<div id="root">\n';

	globalThis.__vsk_ssr = true;
	let bodyHtml;
	try {
		bodyHtml = await Promise.resolve(renderFn(ssrProps, fullRegistry, __vesk));
	} finally {
		delete globalThis.__vsk_ssr;
	}

	yield bodyHtml;

	const ssrData = globalThis.__vsk_ssr_data || {};
	if (globalThis.__vsk_ssr_promises?.length > 0) {
		await Promise.allSettled(globalThis.__vsk_ssr_promises);
		const collectedData = globalThis.__vsk_ssr_data || {};
		Object.assign(ssrData, collectedData);
	}
	delete globalThis.__vsk_ssr_promises;

	const dataScripts = [];
	if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};</script>`);
	const ssrDataKeys = Object.keys(ssrData);
	if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
	const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') : '';

	const clientScript = options.clientScriptUrl
		? `\n<script type="module" src="${options.clientScriptUrl}"></script>\n`
		: '';
	yield `\n</div>${dataScriptBlock}${clientScript}</body>\n</html>\n`;
}
