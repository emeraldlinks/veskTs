/**
 * Vesk development server with HMR, SSR, API routes, middleware, and file watching.
 *
 * @module dev-server
 */

import { readFileSync, watch, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

/**
 * Start the Vesk dev server.
 * Compiles routes, bundles runtime/client code, sets up file watching with HMR,
 * and starts an HTTP server with streaming SSR support.
 *
 * @param {number} port - HTTP server port
 * @param {string} projectDir - root project directory
 * @param {object} config - loaded vesk config object
 */
export async function startDevServer(port, projectDir, config) {
	const { renderPage, renderFullPage, renderPageStream } = await import('../../compiler/src/server-codegen.js');
	const { compileClient } = await import('../../compiler/src/client-codegen.js');
	const { scanRoutes, matchUrl, collectSources } = await import('../../compiler/src/router.js');
	const { scanApiRoutes, matchApiUrl, buildWebRequest, executeApiRoute } = await import('../../compiler/src/api-routes.js');
	const { collectMiddlewareChain, executeMiddlewareChain } = await import('../../compiler/src/middleware.js');

	const appDirPath = join(projectDir, 'app');
	const publicDir = join(projectDir, 'public');
	const runtimeDir = resolve(projectDir, 'node_modules', '@vesk/runtime', 'src');
	if (!existsSync(runtimeDir)) {
		console.error(`vesk: @vesk/runtime not found. Run npm install first.`);
		process.exit(1);
	}
	const devPlugins = config.plugins || [];

	// ── CSS processing ───────────────────────────────────────────
	let devUserCssContent = '';
	let devTailwindCssContent = '';
	const srcDir = join(projectDir, 'src');
	const cssPath = join(srcDir, 'global.css');
	const altCssPath = join(srcDir, 'app.css');
	let rawCss = '';
	if (existsSync(cssPath)) {
		rawCss = readFileSync(cssPath, 'utf-8');
	} else if (existsSync(altCssPath)) {
		rawCss = readFileSync(altCssPath, 'utf-8');
	}
	if (rawCss) {
		for (const plugin of devPlugins) {
			if (typeof plugin.onBuildStart === 'function') {
				await plugin.onBuildStart();
			}
		}

		// User-facing CSS: strip tailwind directives (@import 'tailwindcss', @theme {}, @layer base|components|utilities, @utility)
		devUserCssContent = stripTailwindDirectives(rawCss);

		// Tailwind CSS: pass raw CSS through plugins (each plugin extracts its directives internally)
		devTailwindCssContent = rawCss;
		for (const plugin of devPlugins) {
			if (typeof plugin.onCSS === 'function') {
				const result = await plugin.onCSS(rawCss, cssPath);
				if (result !== null && typeof result === 'string') {
					devTailwindCssContent = result;
				}
			}
		}
		if (devUserCssContent === devTailwindCssContent || devUserCssContent === rawCss) {
			devTailwindCssContent = devUserCssContent;
		}
	}

	// ── State ────────────────────────────────────────────────────
	/** @type {object} Route tree from scanRoutes, rebuilt on file change */
	let routeTree = scanRoutes(appDirPath);

	/** @type {string} Compiled client JS bundle */
	let clientBundle = '';

	/** @type {string} Concatenated runtime JS bundle */
	let runtimeBundle = '';

	// ── Runtime bundling ────────────────────────────────────────
	/**
	 * Concatenate runtime source files into a single JS bundle string.
	 * Strips import/export statements so the bundle runs in the browser.
	 */
	function bundleRuntime() {
		try {
			const files = [
				'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
				'context.js', 'hydrate.js', 'resource.js', 'portal.js',
				'reconcile.js', 'bindings.js', 'router-match.js', 'router-components.js', 'router.js',
				'seo.js', 'image.js', 'experiment.js', 'form.js',
			];
			let code = '';
			for (const f of files) {
				const p = join(runtimeDir, f);
				if (existsSync(p)) {
					let src = readFileSync(p, 'utf-8');
					src = src.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\n?/gm, '');
					src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, '');
					src = src.replace(/^export\s+/gm, '');
					code += `// --- ${f} ---\n${src}\n`;
				}
			}
			const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
			const exportNames = indexSrc.match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
				?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim()))
				|| [];
			code += `// --- exports ---\n`;
			for (const name of [...new Set(exportNames)]) {
				if (name) code += `export { ${name} };\n`;
			}
			runtimeBundle = code;
			console.error(`vesk: runtime bundle: ${code.length} bytes`);
		} catch (e) {
			console.error(`vesk: runtime bundle error:`, e.message);
		}
	}

	// ── Client bundling ─────────────────────────────────────────
	/**
	 * Compile all .vsk components into a client-side JS bundle with hydration support.
	 * Produces both non-hydrate (SPA navigation) and hydrate (initial render) versions.
	 */
	async function buildClientBundle() {
		try {
			const seen = new Set();
			const sources = collectSources(routeTree);
			const componentLines = [];
			const hydratorLines = [];
			const aliasLines = [];
			const hydratorAliasLines = [];
			const runtimeImportNames = new Set();
			runtimeImportNames.add('track');
			runtimeImportNames.add('get');
			runtimeImportNames.add('set');
			runtimeImportNames.add('destroy_block');
			runtimeImportNames.add('getActiveComponent');
			runtimeImportNames.add('setActiveComponent');
			runtimeImportNames.add('effect');
			runtimeImportNames.add('createFileRouter');
			runtimeImportNames.add('NavLink');
			runtimeImportNames.add('Link');

			for (const [compName, sourcePath] of sources) {
				if (seen.has(sourcePath)) continue;
				if (sourcePath.endsWith('middleware.ts')) continue;
				seen.add(sourcePath);
				const src = readFileSync(sourcePath, 'utf-8');

				// Non-hydrate version — for SPA navigation
				const compCode = compileClient(src, null, { forceClient: true });
				if (compCode) {
					const stripped = compCode
						.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, (match) => {
							const names = match.match(/\{([^}]*)\}/)?.[1] || '';
							names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => runtimeImportNames.add(n));
							return '';
						})
						.replace(/^const __components = \{\};\s*\n?/gm, '')
						.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '');
					const withoutLeadingBlank = stripped.replace(/^\n+/, '').replace(/\n+$/, '');
					componentLines.push(withoutLeadingBlank);
					const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
					if (actualName && actualName !== compName) {
						aliasLines.push(`__components[${JSON.stringify(compName)}] = __components[${JSON.stringify(actualName)}];`);
					}
				}

				// Hydrate version — for initial hydration
				const hydCode = compileClient(src, null, { hydrate: true, forceClient: true });
				if (hydCode) {
					const stripped = hydCode
						.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, (match) => {
							const names = match.match(/\{([^}]*)\}/)?.[1] || '';
							names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => runtimeImportNames.add(n));
							return '';
						})
						.replace(/^const __components = \{\};\s*\n?/gm, '')
						.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '')
						.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '')
						.replace(/__components/g, '__hydrators');
					const withoutLeadingBlank = stripped.replace(/^\n+/, '').replace(/\n+$/, '');
					hydratorLines.push(withoutLeadingBlank);
					const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
					if (actualName && actualName !== compName) {
						hydratorAliasLines.push(`__hydrators[${JSON.stringify(compName)}] = __hydrators[${JSON.stringify(actualName)}];`);
					}
				}
			}

			const importStr = [...runtimeImportNames].join(', ');
			clientBundle = '';
			clientBundle += `import { ${importStr} } from '/_vesk/runtime.js';\n\n`;
			clientBundle += `const __components = {};\n\n`;
			clientBundle += `const __hydrators = {};\n\n`;
			clientBundle += `const __runtime_comps = __components;\n\n`;
			clientBundle += componentLines.join('\n\n');
			if (aliasLines.length > 0) {
				clientBundle += '\n' + aliasLines.join('\n') + '\n';
			}
			if (hydratorLines.length > 0) {
				clientBundle += '\n' + hydratorLines.join('\n') + '\n';
			}
			if (hydratorAliasLines.length > 0) {
				clientBundle += '\n' + hydratorAliasLines.join('\n') + '\n';
			}
			clientBundle += `\nfunction __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n`;
			const treeJson = JSON.stringify(routeTree);
			clientBundle += `\nconst __routeTree = ${treeJson};\n`;
			clientBundle += `function __resolveNames(nodes) { for (const n of nodes) { if (typeof n.page === 'string') { n._pageName = n.page; n.page = __components[n.page]; } if (typeof n.layout === 'string') { n._layoutName = n.layout; n.layout = __components[n.layout]; } if (n.children) __resolveNames(n.children); } }\n`;
			clientBundle += `function __updateComponents(nodes) { for (const n of nodes) { if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName]; if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName]; if (n.children) __updateComponents(n.children); } }\n`;
			clientBundle += `__resolveNames(__routeTree);\n`;
			clientBundle += `const __router = createFileRouter(__routeTree);\n`;
			clientBundle += `__router.__hydrators = __hydrators;\n`;
			clientBundle += `__router.__updateComponents = __updateComponents;\n`;
			clientBundle += `globalThis.__vesk_router = __router;\n`;
			clientBundle += `globalThis.__components = __components;\n`;
			clientBundle += `globalThis.__vesk_hmr_eval = (code) => eval(code);\n`;
			clientBundle += `if (typeof document !== 'undefined') __router.start();\n`;
			console.error(`vesk: client bundle: ${clientBundle.length} bytes`);
		} catch (e) {
			console.error(`vesk: client build error:`, e.message);
		}
	}

	// ── Initial build ───────────────────────────────────────────
	bundleRuntime();
	await buildClientBundle();

	// ── File watcher + HMR ──────────────────────────────────────
	/** @type {Map<string, string[]>} Maps absolute source path → component names (for HMR targeting) */
	const sourceToComponents = new Map();

	/**
	 * Rebuild the source-to-component mapping from the current route tree.
	 * Called after every route scan to keep HMR targeting accurate.
	 */
	function updateSourceMapping() {
		sourceToComponents.clear();
		for (const [compName, sourcePath] of collectSources(routeTree)) {
			const existing = sourceToComponents.get(sourcePath) || [];
			existing.push(compName);
			sourceToComponents.set(sourcePath, existing);
		}
	}
	updateSourceMapping();

	// ── CSS rebuild ────────────────────────────────────────────
	async function rebuildTailwindCss() {
		if (!rawCss) return;
		try {
			devUserCssContent = stripTailwindDirectives(rawCss);
			devTailwindCssContent = rawCss;
			for (const plugin of devPlugins) {
				if (typeof plugin.onCSS === 'function') {
					const result = await plugin.onCSS(rawCss, cssPath);
					if (result !== null && typeof result === 'string') {
						devTailwindCssContent = result;
					}
				}
			}
		} catch (e) {
			console.error(`vesk: CSS rebuild error:`, e.message);
		}
	}

	try {
		let debounceTimer = null;
		let cssDebounceTimer = null;
		watch(appDirPath, { recursive: true }, (eventType, filename) => {
			if (filename && filename.endsWith('.vsk')) {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(async () => {
					const t0 = Date.now();
					try {
						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({ type: 'compiling' });
						}

						routeTree = scanRoutes(appDirPath);
						updateSourceMapping();
						const changedSource = filename.startsWith('/') ? filename : join(appDirPath, filename);
						const changedComponents = sourceToComponents.get(changedSource) || [];

						clientBundle = '';
						await buildClientBundle();

						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							if (changedComponents.length > 0) {
								let fnSources;
								let errorMessage = '';
								const srcPath = existsSync(changedSource) ? changedSource : join(appDirPath, filename);
								if (existsSync(srcPath)) {
									try {
										const src = readFileSync(srcPath, 'utf-8');
										let compCode = compileClient(src, null, { forceClient: true });
										compCode = compCode.replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?\s*\n?/gm, '');
										compCode = compCode.replace(/^const __components = \{\};\s*\n?/m, '');
										compCode = compCode.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/m, '');
										compCode = compCode.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
										const actualName = extractCompName(src);
										for (const cname of changedComponents) {
											if (actualName && actualName !== cname) {
												compCode += `\n__components[${JSON.stringify(cname)}] = __components[${JSON.stringify(actualName)}];\n`;
											}
										}
										if (compCode.trim()) fnSources = { _raw: compCode };
									} catch (e) {
										errorMessage = e.message;
										console.error(`vesk: HMR compile error for ${filename}:`, e.message);
									}
								} else {
									console.error(`vesk: HMR source not found: ${srcPath}`);
								}
								if (fnSources) {
									globalThis.__vesk_broadcastHmr({
										type: 'update',
										time: Date.now() - t0,
										components: Object.fromEntries(changedComponents.map(name => [name, true])),
										fnSources
									});
								} else if (errorMessage) {
									globalThis.__vesk_broadcastHmr({
										type: 'error',
										message: errorMessage
									});
								} else {
									globalThis.__vesk_broadcastHmr({ type: 'reload' });
								}
							} else {
								globalThis.__vesk_broadcastHmr({ type: 'reload' });
							}
						}
						console.error(`vesk: rebuilt (${filename}) — ${Date.now() - t0}ms`);
					} catch (e) {
						console.error(`vesk: rebuild error:`, e.message);
					}
				}, 200);
			} else if (filename && (filename.endsWith('.css'))) {
				if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
				cssDebounceTimer = setTimeout(async () => {
					try {
						const cssFullPath = filename.startsWith('/') ? filename : join(appDirPath, filename);
						if (existsSync(cssFullPath)) {
							rawCss = readFileSync(cssFullPath, 'utf-8');
						}
						await rebuildTailwindCss();
						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({ type: 'css-update' });
						}
						console.error(`vesk: CSS rebuilt`);
					} catch (e) {
						console.error(`vesk: CSS rebuild error:`, e.message);
					}
				}, 200);
			}
		});
	} catch (e) {
		console.error(`vesk: file watching unavailable, serving without auto-rebuild`);
	}

	// ── MIME types ──────────────────────────────────────────────
	const MIME = {
		'.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'application/javascript',
		'.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
		'.html': 'text/html', '.json': 'application/json',
	};

	// ── HMR client script — served from runtime package ───────────
	const hmrClientPath = join(runtimeDir, 'hmr-client.js');

	/**
	 * Extract the component name from a .vsk source string.
	 * @param {string} src - .vsk source text
	 * @returns {string|null} component name or null if not found
	 */
	function extractCompName(src) {
		const m = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
		return m ? m[1] : null;
	}

	// ── HTTP server ─────────────────────────────────────────────
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);

		// Static bundle endpoints
		if (url.pathname === '/_vesk/runtime.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(runtimeBundle);
			return;
		}
		if (url.pathname === '/_vesk/client.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(clientBundle);
			return;
		}
		if (url.pathname === '/_vesk/static/global.css') {
			res.writeHead(200, { 'Content-Type': 'text/css' });
			res.end(devUserCssContent);
			return;
		}
		if (url.pathname === '/_vesk/static/_tailwind.css') {
			res.writeHead(200, { 'Content-Type': 'text/css' });
			res.end(devTailwindCssContent);
			return;
		}
		if (url.pathname === '/_vesk/hmr.js') {
			res.writeHead(200, { 'Content-Type': 'application/javascript' });
			res.end(readFileSync(hmrClientPath, 'utf-8'));
			return;
		}

		// Static files from public/
		if (url.pathname !== '/') {
			const staticPath = join(publicDir, url.pathname);
			if (existsSync(staticPath) && statSync(staticPath).isFile()) {
				const ext = extname(staticPath);
				res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
				res.end(readFileSync(staticPath));
				return;
			}
		}

		// API routes
		const apiDirPath = join(appDirPath, 'api');
		if (url.pathname.startsWith('/api') && existsSync(apiDirPath)) {
			const apiRoutes = await scanApiRoutes(apiDirPath);
			const apiMatch = matchApiUrl(apiRoutes, req.url || url.pathname);
			if (apiMatch) {
				const webRequest = buildWebRequest(req, req.url || url.pathname);
				const response = await executeApiRoute(apiMatch.node.filePath, (req.method || 'GET').toUpperCase(), webRequest, apiMatch.params);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				const body = await response.text();
				res.end(body);
				return;
			}
		}

		// SSR route matching + layout composition
		const match = matchUrl(routeTree, url.pathname);

		if (!match) {
			const rootNode = routeTree.find(n => n.fullPath === '/');
			let notFoundHtml = null;
			if (rootNode && rootNode.notFound) {
				const nfPath = resolve(appDirPath, rootNode.sourceDir, 'not-found.vsk');
				if (existsSync(nfPath)) {
					try {
						const { renderFullPage: rfp } = await import('../../compiler/src/server-codegen.js');
						const nfSrc = readFileSync(nfPath, 'utf-8');
						const nfCompName = extractCompName(nfSrc) || rootNode.notFound;
						notFoundHtml = await rfp(nfSrc, nfCompName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'] });
					} catch {}
				}
			}
			res.writeHead(404, { 'Content-Type': 'text/html' });
			res.end(notFoundHtml || `<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`);
			return;
		}

		// Clean chain: only keep nodes matching actual URL segments
		const urlParts = url.pathname.split('/').filter(Boolean);
		const cleanChain = [];
		let segIdx = 0;
		for (const node of match.nodes) {
			if (node.fullPath === '/') {
				cleanChain.push(node);
			} else if (!node.isGroup && node.segmentCount > 0) {
				if (segIdx < urlParts.length) {
					cleanChain.push(node);
					segIdx++;
				}
			} else {
				cleanChain.push(node);
			}
		}

		// Middleware (onion model) + SSR
		const mwChain = collectMiddlewareChain(routeTree, url.pathname, appDirPath);

		async function renderSSR() {
			const chain = cleanChain;
			let body = '';
			let head = '';

			for (let i = chain.length - 1; i >= 0; i--) {
				const node = chain[i];
				const pageFilePath = resolve(appDirPath, node.sourceDir, 'page.vsk');
				const layoutFilePath = resolve(appDirPath, node.sourceDir, 'layout.vsk');

				if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
					const src = readFileSync(pageFilePath, 'utf-8');
					const compName = extractCompName(src) || node.page;
					const result = renderPage(src, compName, { params: match.params }, new Map(), { hydrate: true });
					body = result.body;
					head = result.head || '';
				}

				if (node.layout && existsSync(layoutFilePath)) {
					const src = readFileSync(layoutFilePath, 'utf-8');
					const compName = extractCompName(src) || node.layout;
					const result = renderPage(src, compName, { children: body }, new Map(), { hydrate: true });
					body = result.body;
					head = (result.head || '') + head;
				}
			}

			const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir, 'layout.vsk')));
			let html;
			if (hasLayout) {
				const { prettifyHtml } = await import('../../compiler/src/server-codegen.js');
				html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
			} else {
				const leaf = chain.find(n => n.page);
				if (leaf) {
					const src = readFileSync(resolve(appDirPath, leaf.sourceDir, 'page.vsk'), 'utf-8');
					const compName = extractCompName(src) || leaf.page;
					html = renderFullPage(src, compName, { params: match.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'] });
					html = html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
				} else {
					throw new Error('No page or layout matched');
				}
			}
			return html;
		}

		/**
		 * Streaming variant of renderSSR — yields the HTML shell immediately
		 * with Transfer-Encoding: chunked, then the body when ready.
		 * For layout chains, the renders are synchronous but head/body are
		 * yielded as separate chunks. For single pages, delegates to renderPageStream.
		 */
		async function* renderSSRStream() {
			const chain = cleanChain;
			const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir, 'layout.vsk')));

			if (!hasLayout) {
				const leaf = chain.find(n => n.page);
				if (leaf) {
					const src = readFileSync(resolve(appDirPath, leaf.sourceDir, 'page.vsk'), 'utf-8');
					const compName = extractCompName(src) || leaf.page;
					yield* renderPageStream(src, compName, { params: match.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'] });
				} else {
					throw new Error('No page or layout matched');
				}
				return;
			}

			let body = '';
			let head = '';

			for (let i = chain.length - 1; i >= 0; i--) {
				const node = chain[i];
				const pageFilePath = resolve(appDirPath, node.sourceDir, 'page.vsk');
				const layoutFilePath = resolve(appDirPath, node.sourceDir, 'layout.vsk');

				if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
					const src = readFileSync(pageFilePath, 'utf-8');
					const compName = extractCompName(src) || node.page;
					const result = renderPage(src, compName, { params: match.params }, new Map(), { hydrate: true });
					body = result.body;
					head = result.head || '';
				}

				if (node.layout && existsSync(layoutFilePath)) {
					const src = readFileSync(layoutFilePath, 'utf-8');
					const compName = extractCompName(src) || node.layout;
					const result = renderPage(src, compName, { children: body }, new Map(), { hydrate: true });
					body = result.body;
					head = (result.head || '') + head;
				}
			}

			// Yield shell before body
			const { prettifyHtml } = await import('../../compiler/src/server-codegen.js');
			yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n';
			if (head) yield '\t' + head.split('\n').join('\n\t') + '\n';
			yield '</head>\n<body>\n<div id="root">\n';
			yield prettifyHtml(body);
			yield '\n</div>\n</body>\n</html>';
		}

		// ── Request handling ────────────────────────────────────
		let mwLocals = {};
		try {
			if (mwChain.length > 0) {
				const mwReq = new Request(`http://localhost${url.pathname}${url.search}`, {
					headers: req.headers,
					method: req.method || 'GET',
				});
				const mwResult = await executeMiddlewareChain(mwChain, mwReq, match.params, {
					onLast: async (rewrite) => {
						if (rewrite) url.pathname = rewrite;
						const ctx = buildRequestContext(req);
						const prev = globalThis.__vesk_request;
						globalThis.__vesk_request = ctx;
						try {
							const html = await renderSSR();
							return new Response(html, { headers: { 'Content-Type': 'text/html' } });
						} finally {
							globalThis.__vesk_request = prev;
						}
					},
				});
				mwLocals = mwResult.locals;
				if (mwResult.response) {
					res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
					res.end(await mwResult.response.text());
					return;
				}
			} else {
				const ctx = buildRequestContext(req);
				const prev = globalThis.__vesk_request;
				globalThis.__vesk_request = ctx;
				try {
					const stream = renderSSRStream();
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Transfer-Encoding': 'chunked' });
					for await (const chunk of stream) {
						if (chunk.includes('</body>')) {
							res.write(chunk.replace('</body>', '\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>'));
						} else {
							res.write(chunk);
						}
					}
					res.end();
				} finally {
					globalThis.__vesk_request = prev;
				}
				return;
			}
		} catch (e) {
			if (e.name === 'Redirect') {
				res.writeHead(e.status || 302, { Location: e.url });
				res.end(`<!DOCTYPE html><html><body><a href="${e.url}">Redirect</a></body></html>`);
			} else if (e.name === 'NotFoundError') {
				let notFoundHtml = null;
				if (match && match.nodes) {
					for (let i = match.nodes.length - 1; i >= 0; i--) {
						const node = match.nodes[i];
						if (node.notFound) {
							const nfPath = resolve(appDirPath, node.sourceDir, 'not-found.vsk');
							if (existsSync(nfPath)) {
								try {
									const { renderFullPage: rfp } = await import('../../compiler/src/server-codegen.js');
									const nfSrc = readFileSync(nfPath, 'utf-8');
									const nfCompName = extractCompName(nfSrc) || node.notFound;
									const html = await rfp(nfSrc, nfCompName, { params: match.params, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'] });
									notFoundHtml = html.replace('</body>',
										`\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
								} catch {}
							}
							break;
						}
					}
				}
				res.writeHead(404, { 'Content-Type': 'text/html' });
				res.end(notFoundHtml || `<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>`);
			} else {
				res.writeHead(500, { 'Content-Type': 'text/html' });
				res.end(`<!DOCTYPE html><html><body><h1>500</h1><pre>${e.message}\n${e.stack}</pre></body></html>`);
			}
		}
	});

	server.listen(port, () => {
		console.error(`vesk dev server at http://localhost:${port}`);
	});

	// Update source mapping after initial route scan
	updateSourceMapping();

	// ── WebSocket HMR server ────────────────────────────────────
	/** @type {Set<import('ws').WebSocket>} */
	const hmrClients = new Set();
	const wss = new WebSocketServer({ noServer: true });
	wss.on('connection', (ws) => {
		hmrClients.add(ws);
		ws.on('close', () => hmrClients.delete(ws));
	});
	server.on('upgrade', (req, socket, head) => {
		if (req.url === '/_vesk/hmr') {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit('connection', ws, req);
			});
		} else {
			socket.destroy();
		}
	});

	globalThis.__vesk_broadcastHmr = (update) => {
		const msg = JSON.stringify(update);
		for (const ws of hmrClients) {
			if (ws.readyState === 1) ws.send(msg);
		}
	};

	// Don't exit — keep serving
	await new Promise(() => {});
}

/**
 * Strip tailwind-specific directives from CSS, leaving only user-authored styles.
 * Removes @import 'tailwindcss', @source, @theme {}, @layer base|components|utilities {},
 * and @utility {} blocks.
 * @param {string} css - raw CSS content
 * @returns {string} CSS with tailwind directives removed
 */
function stripTailwindDirectives(css) {
  const blockStart = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/;
  css = css.replace(/^\s*@import\s+['"]tailwindcss['"]\s*;?\s*$/gm, '');
  css = css.replace(/^\s*@source\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  const lines = css.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    if (blockStart.test(lines[i].trim())) {
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      i++;
      while (i < lines.length && braceCount > 0) {
        braceCount += (lines[i].match(/\{/g) || []).length;
        braceCount -= (lines[i].match(/\}/g) || []).length;
        i++;
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n').trim();
}

/**
 * Build a per-request context object for SSR, extracting headers, cookies, and URL info.
 * @param {import('node:http').IncomingMessage} req - Node.js HTTP request object
 * @returns {{ headers: object, url: string|null, method: string, cookies: object, locals: object }}
 */
function buildRequestContext(req) {
	const headers = Object.fromEntries(
		Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
	);
	const cookies = {};
	const raw = req.headers.cookie || '';
	for (const pair of raw.split(';')) {
		const eq = pair.indexOf('=');
		if (eq === -1) continue;
		const k = pair.slice(0, eq).trim();
		const v = pair.slice(eq + 1).trim();
		if (k) cookies[k] = v;
	}
	return { headers, url: req.url, method: req.method || 'GET', cookies, locals: {} };
}
