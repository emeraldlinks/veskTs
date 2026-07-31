/**
 * Vesk development server with HMR, SSR, API routes, middleware, and file watching.
 *
 * @module dev-server
 */

import { readFileSync, watch, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const LOG = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  dim: '\x1b[2m',
  method(m) {
    const colors = { GET: '\x1b[32m', POST: '\x1b[34m', PUT: '\x1b[33m', PATCH: '\x1b[33m', DELETE: '\x1b[31m', HEAD: '\x1b[90m', OPTIONS: '\x1b[36m' };
    return (colors[m] || '\x1b[37m') + m + '\x1b[0m';
  },
  status(s) {
    if (s < 300) return '\x1b[32m' + s + '\x1b[0m';
    if (s < 400) return '\x1b[36m' + s + '\x1b[0m';
    if (s < 500) return '\x1b[33m' + s + '\x1b[0m';
    return '\x1b[31m' + s + '\x1b[0m';
  },
  info(...args) { console.log('\x1b[2mvesk:\x1b[0m', ...args); },
  ok(...args) { console.log('\x1b[32mvesk:\x1b[0m', ...args); },
  warn(...args) { console.log('\x1b[33mvesk:\x1b[0m', ...args); },
  err(...args) { console.log('\x1b[31mvesk:\x1b[0m', ...args); },
  request(method, pathname, status, ms) {
    const m = LOG.method(method);
    const s = LOG.status(status);
    const t = ms !== undefined ? ` \x1b[2m${ms}ms\x1b[0m` : '';
    console.log(`  ${m} ${pathname} ${s}${t}`);
  },
};

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
	const { renderPage, renderFullPage, renderPageStream, securityHeaders, corsHeaders, corsPreflight, createRateLimiter, applyTrustProxy } = await import('../../compiler/src/server-codegen.js');
	const { compileClient } = await import('../../compiler/src/client-codegen.js');
	const { scanRoutes, matchUrl, collectSources } = await import('../../compiler/src/router.js');
	const { scanApiRoutes, matchApiUrl, buildWebRequest, executeApiRoute } = await import('../../compiler/src/api-routes.js');
	const { collectMiddlewareChain, executeMiddlewareChain } = await import('../../compiler/src/middleware.js');
	const { generateClientBundle } = await import('../../adapter/src/client-bundle.js');

	const appDirPath = join(projectDir, 'app');
	const publicDir = join(projectDir, 'public');
	const runtimeDir = resolve(projectDir, 'node_modules', '@vesk/runtime', 'src');
	if (!existsSync(runtimeDir)) {
		LOG.err(`@vesk/runtime not found. Run npm install first.`);
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
			LOG.info(`runtime bundle: ${code.length} bytes`);
		} catch (e) {
			LOG.err(`runtime bundle error:`, e.message);
		}
	}

	// ── Client bundling ─────────────────────────────────────────
	/**
	 * Generate client bundle using the shared bundle generator.
	 */
	async function buildClientBundle() {
		try {
			const { main } = await generateClientBundle(routeTree, appDirPath, new Map(), {
				importRuntime: true,
				hmr: true,
			});
			clientBundle = main;
			LOG.info(`client bundle: ${clientBundle.length} bytes`);
		} catch (e) {
			LOG.err(`client build error:`, e.message);
			throw e;
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
			LOG.err(`CSS rebuild error:`, e.message);
		}
	}

	const apiWatchCache = new Map();
	try {
		let debounceTimer = null;
		let cssDebounceTimer = null;
		const watchDirs = [appDirPath];
		if (existsSync(srcDir)) watchDirs.push(srcDir);
		for (const watchDir of watchDirs) {
		watch(watchDir, { recursive: true }, (eventType, filename) => {
			if (!filename) return;
			const isVsk = filename.endsWith('.vsk');
			const isCss = filename.endsWith('.css');
			const isApiRoute = filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.tsx');
			if (!isVsk && !isCss && !isApiRoute) return;

			const fullPath = filename.startsWith('/') ? filename : join(watchDir, filename);
			const fileExists = existsSync(fullPath);

			if (isVsk) {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(async () => {
					const t0 = Date.now();
					try {
						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({ type: 'compiling' });
						}

						routeTree = scanRoutes(appDirPath);
						updateSourceMapping();
						const changedComponents = sourceToComponents.get(fullPath) || [];

						clientBundle = '';
						let bundleError = null;
						try {
							await buildClientBundle();
						} catch (e) {
							bundleError = e;
							LOG.err(`client build error:`, e.message);
						}

						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							if (changedComponents.length > 0) {
								let fnSources;
								let errorMessage = bundleError ? bundleError.message : '';
								if (fileExists && !bundleError) {
									try {
										const src = readFileSync(fullPath, 'utf-8');
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
										LOG.err(`HMR compile error for ${filename}:`, e.message);
									}
								} else {
									LOG.warn(`HMR source not found: ${fullPath}`);
								}
								if (fnSources) {
									globalThis.__vesk_broadcastHmr({
										type: 'update',
										time: Date.now() - t0,
										components: Object.fromEntries(changedComponents.map(name => [name, true])),
										fnSources
									});
								} else if (errorMessage) {
									const err = bundleError || e;
									let line = 0, col = 0, file = '';
									let suggestions = [], nextSteps = [], tip = '';
									if (err && err.name === 'VeskError') {
										line = err.line || 0;
										col = err.column || 0;
										file = err.file || fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
										suggestions = err.suggestions || [];
										nextSteps = err.nextSteps || [];
										tip = err.tip || '';
									} else {
										const lineMatch = errorMessage.match(/(?:line|at\s+line)\s*(\d+)/i);
										const colMatch = errorMessage.match(/(?:column|col)\s*(\d+)/i);
										const fileMatch = errorMessage.match(/(?:in|at)\s+['"]?([^'":\s]+(?:\.[a-z]+))['"]?/i);
										line = lineMatch ? parseInt(lineMatch[1]) : 0;
										col = colMatch ? parseInt(colMatch[1]) : 0;
										file = fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
										if (fileMatch) file = fileMatch[1];
									}
									let code = '';
									if (line > 0 && fileExists) {
										try {
											const src = readFileSync(fullPath, 'utf-8');
											const lines = src.split('\n');
											const start = Math.max(0, line - 3);
											const end = Math.min(lines.length, line + 2);
											code = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
										} catch {}
									}
									const tips = [];
									if (tip) tips.push(tip);
									if (errorMessage.toLowerCase().includes('unexpected token')) tips.push('Check for missing or extra brackets, parentheses, or quotes.');
									if (errorMessage.toLowerCase().includes('unexpected identifier')) tips.push('A keyword or identifier is in an unexpected position. Check for typos.');
									if (errorMessage.toLowerCase().includes('expected')) tips.push('Check the syntax around the reported line for missing punctuation.');
									if (errorMessage.toLowerCase().includes('not defined') || errorMessage.toLowerCase().includes('is not defined')) tips.push('The variable or component may not be imported or declared.');
									if (errorMessage.toLowerCase().includes('invalid')) tips.push('Check the expression syntax around the reported location.');
									if (errorMessage.toLowerCase().includes('component') && errorMessage.toLowerCase().includes('not')) tips.push('Ensure the component is properly defined with the "component" keyword.');
									if (nextSteps.length) tips.push(...nextSteps);
									if (tips.length === 0) tips.push('Review the code around the reported line for syntax or type errors.');
									globalThis.__vesk_broadcastHmr({
										type: 'error',
										message: errorMessage,
										file,
										line,
										column: col,
										code,
										stack: err?.stack || '',
										tips,
										suggestions,
										nextSteps,
									});
								} else {
									globalThis.__vesk_broadcastHmr({ type: 'reload' });
								}
							} else {
								globalThis.__vesk_broadcastHmr({ type: 'reload' });
							}
						}
						// Rebuild tailwind CSS — .vsk files may contain new tailwind classes
						await rebuildTailwindCss();
						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({ type: 'css-update' });
						}
						LOG.info(`rebuilt (${filename}) — ${Date.now() - t0}ms`);
					} catch (e) {
						LOG.err(`rebuild error:`, e.message);
					}
				}, 200);
			} else if (isCss) {
				if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
				cssDebounceTimer = setTimeout(async () => {
					try {
						if (fileExists) {
							rawCss = readFileSync(fullPath, 'utf-8');
						}
						await rebuildTailwindCss();
						if (typeof globalThis.__vesk_broadcastHmr === 'function') {
							globalThis.__vesk_broadcastHmr({ type: 'css-update' });
						}
						LOG.info(`CSS rebuilt`);
					} catch (e) {
						LOG.err(`CSS rebuild error:`, e.message);
					}
				}, 200);
			} else if (isApiRoute) {
				const isInApi = fullPath.includes('/api/');
				if (isInApi && fileExists) {
					apiWatchCache.set(fullPath, Date.now());
				}
			}
		});
		}
	} catch (e) {
		LOG.warn(`file watching unavailable, serving without auto-rebuild`);
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

	// ── Rate limiter (if configured) ────────────────────────────
	let rateLimiter = null;
	if (config.security?.rateLimit) {
		const rlConfig = config.security.rateLimit;
		rateLimiter = createRateLimiter({ windowMs: rlConfig.windowMs || 60000, max: rlConfig.max || 100 });
	}

	// ── HTTP server ─────────────────────────────────────────────
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);
		const reqStart = Date.now();

		const logRequest = (status) => {
			if (url.pathname.startsWith('/_vesk')) return;
			LOG.request(req.method || 'GET', url.pathname, status, Date.now() - reqStart);
		};

		// ── trustProxy — build enriched request context ────────────
		const rawCtx = buildRequestContext(req);
		if (config.security?.trustProxy) {
			applyTrustProxy(rawCtx, config.security.trustProxy);
		}

		// ── Rate limiting check (before CORS) ──────────────────────
		if (rateLimiter) {
			const clientIp = rawCtx.ip || req.socket?.remoteAddress || 'unknown';
			if (!rateLimiter.check(clientIp)) {
				res.writeHead(429, {
					'Content-Type': 'application/json',
					'Retry-After': String(Math.ceil((config.security.rateLimit.windowMs || 60000) / 1000)),
				});
				res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: Math.ceil((config.security.rateLimit.windowMs || 60000) / 1000) }));
				return;
			}
		}

		// ── CORS ──────────────────────────────────────────────────
		const reqOrigin = req.headers['origin'] || '';
		const reqHost = req.headers['host'] || `localhost:${port}`;
		const corsAllowed = corsHeaders(config.security, reqOrigin, reqHost);
		if (corsAllowed['Access-Control-Allow-Origin'] && req.method === 'OPTIONS') {
			res.writeHead(204, { ...corsAllowed, 'Content-Length': '0' });
			res.end();
			return;
		}
		// Monkey-patch writeHead to inject CORS headers on every response
		const origWriteHead = res.writeHead.bind(res);
		res.writeHead = (statusCode, headers) => {
			return origWriteHead(statusCode, { ...headers, ...corsAllowed });
		};

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

		// Middleware chain (computed once, before API route check)
		const mwChain = collectMiddlewareChain(routeTree, url.pathname, appDirPath);

		// API routes (with middleware support)
		const apiDirPath = join(appDirPath, 'api');
		if (url.pathname.startsWith('/api') && existsSync(apiDirPath)) {
			const apiRoutes = await scanApiRoutes(apiDirPath);
			const apiMatch = matchApiUrl(apiRoutes, req.url || url.pathname);
			if (apiMatch) {
				const { VeskRequest } = await import('@vesk/runtime/server');
				// Buffer body once for both middleware and route handler
				const bodyChunks = [];
				for await (const chunk of req) bodyChunks.push(chunk);
				const bodyBuffer = Buffer.concat(bodyChunks);
				const requestUrl = req.url ? `http://localhost:${port}${req.url.startsWith('/') ? req.url : '/' + req.url}` : url.href;
				const rawHeaders = Object.fromEntries(
					Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
				);
				const rawCookies = {};
				for (const pair of (req.headers.cookie || '').split(';')) {
					const eq = pair.indexOf('=');
					if (eq !== -1) {
						const k = pair.slice(0, eq).trim();
						const v = pair.slice(eq + 1).trim();
						if (k) rawCookies[k] = v;
					}
				}

				// Run middleware chain for API routes
				let apiLocals = {};
				if (mwChain.length > 0) {
					const mwReq = new Request(requestUrl, { headers: rawHeaders, method: req.method || 'GET' });
					const mwResult = await executeMiddlewareChain(mwChain, mwReq, apiMatch.params, {
						plugins: config.plugins,
						onLast: async () => new Response(null),
					});
					apiLocals = mwResult.locals || {};
				}

				// Build VeskRequest with body and pass middleware locals
				const webRequest = new VeskRequest(requestUrl, {
					method: req.method || 'GET',
					headers: rawHeaders,
					body: bodyBuffer.length ? bodyBuffer : null,
				});
				webRequest._cookies = rawCookies;
				webRequest.locals = apiLocals;
				const response = await executeApiRoute(apiMatch.node.filePath, (req.method || 'GET').toUpperCase(), webRequest, apiMatch.params, apiLocals, apiWatchCache);
				logRequest(response.status);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				const body = await response.text();
				res.end(body);
				return;
			}
		}

		// trustProxy — update request context for SSR handlers
		const ctx = rawCtx;

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
						notFoundHtml = await rfp(nfSrc, nfCompName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: config.security });
					} catch {}
				}
			}
			logRequest(404);
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
				let secMeta = '';
				if (config.security) {
					const s = config.security;
					if (s.referrerPolicy !== false) secMeta += `\t<meta name="referrer" content="${s.referrerPolicy || 'strict-origin-when-cross-origin'}" />\n`;
					if (s.contentSecurityPolicy !== false) secMeta += `\t<meta http-equiv="Content-Security-Policy" content="${(s.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
					if (s.autoEscape !== false) secMeta += `\t<!-- vesk: auto-escape enabled -->\n`;
				}
				html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
			} else {
				const leaf = chain.find(n => n.page);
				if (leaf) {
					const src = readFileSync(resolve(appDirPath, leaf.sourceDir, 'page.vsk'), 'utf-8');
					const compName = extractCompName(src) || leaf.page;
					html = renderFullPage(src, compName, { params: match.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: config.security });
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
					yield* renderPageStream(src, compName, { params: match.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: config.security });
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
			if (config.security) {
				const s = config.security;
				if (s.referrerPolicy !== false) yield `\t<meta name="referrer" content="${s.referrerPolicy || 'strict-origin-when-cross-origin'}" />\n`;
				if (s.contentSecurityPolicy !== false) yield `\t<meta http-equiv="Content-Security-Policy" content="${(s.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
				if (s.autoEscape !== false) yield '\t<!-- vesk: auto-escape enabled -->\n';
			}
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
					plugins: config.plugins,
					onLast: async (rewrite) => {
						if (rewrite) url.pathname = rewrite;
						const prev = globalThis.__vesk_request;
						globalThis.__vesk_request = ctx;
						try {
							const html = await renderSSR();
							const secHeaders = config.security ? securityHeaders(config.security) : {};
							return new Response(html, { headers: { 'Content-Type': 'text/html', ...secHeaders } });
						} finally {
							globalThis.__vesk_request = prev;
						}
					},
				});
				mwLocals = mwResult.locals;
				if (mwResult.response) {
					if (typeof mwResult.response.build === 'function') mwResult.response.build();
					logRequest(mwResult.response.status);
					res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
					res.end(await mwResult.response.text());
					return;
				}
			} else {
				const prev = globalThis.__vesk_request;
				globalThis.__vesk_request = ctx;
				try {
					const stream = renderSSRStream();
					const secHeaders = config.security ? securityHeaders(config.security) : {};
					logRequest(200);
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Transfer-Encoding': 'chunked', ...secHeaders });
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
				const status = e.status || 302;
				logRequest(status);
				res.writeHead(status, { Location: e.url });
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
									const html = await rfp(nfSrc, nfCompName, { params: match.params, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: config.security });
									notFoundHtml = html.replace('</body>',
										`\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
								} catch {}
							}
							break;
						}
					}
				}
				logRequest(404);
				res.writeHead(404, { 'Content-Type': 'text/html' });
				res.end(notFoundHtml || `<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>`);
			} else {
				let errorHtml = null;
				if (match && match.nodes) {
					for (let i = match.nodes.length - 1; i >= 0; i--) {
						const node = match.nodes[i];
						if (node.error) {
							const errPath = resolve(appDirPath, node.sourceDir, 'error.vsk');
							if (existsSync(errPath)) {
								try {
									const { renderFullPage: rfp } = await import('../../compiler/src/server-codegen.js');
									const errSrc = readFileSync(errPath, 'utf-8');
									const errCompName = extractCompName(errSrc) || node.error;
									const errProps = { error: e.message, stack: e.stack, statusCode: 500, url: url.pathname };
									const html = await rfp(errSrc, errCompName, errProps, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: config.security });
									errorHtml = html.replace('</body>', `\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
								} catch (e2) {
									LOG.err(`error page render failed: ${e2.message}`);
								}
							}
							break;
						}
					}
				}
				logRequest(500);
				res.writeHead(500, { 'Content-Type': 'text/html' });
				res.end(errorHtml || `<!DOCTYPE html><html><body><h1>500</h1><pre>${e.message}\n${e.stack}</pre></body></html>`);
			}
		}
	});

	server.listen(port, () => {
		LOG.ok(`dev server at http://localhost:${port}`);
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
