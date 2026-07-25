/**
 * Vesk File-Based Router — scans the `app/` directory and builds a route tree.
 *
 * Conventions:
 *   app/page.vsk          → /
 *   app/layout.vsk        → Root layout
 *   app/about/page.vsk    → /about
 *   app/blog/[slug]/page.vsk   → /blog/:slug
 *   app/blog/[...catchAll]/page.vsk  → /blog/*catchAll
 *   app/(group)/page.vsk  → Route group (no URL segment)
 *   app/_private/...      → Private folder (ignored)
 *   app/api/route.js      → API route (non-.vsk files)
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative, basename, dirname, resolve as resolvePath } from 'path';

// ── Middleware extraction ──────────────────────────────────────

/**
 * Extract `export function middleware(...)` source from a .vsk file.
 */
export function extractMiddleware(sourcePath) {
	try {
		if (!existsSync(sourcePath)) return null;
		const src = readFileSync(sourcePath, 'utf-8');
		const prefixMatch = src.match(/export\s+(?:async\s+)?function\s+middleware\s*\(([\s\S]*?)\)\s*\{/);
		if (!prefixMatch) return null;
		const start = prefixMatch.index + prefixMatch[0].length;
		const params = prefixMatch[1];
		let depth = 1;
		let i = start;
		while (i < src.length && depth > 0) {
			if (src[i] === '{') depth++;
			else if (src[i] === '}') depth--;
			i++;
		}
		const body = src.slice(start, i - 1);
		return `async function middleware(${params}) {\n${body.trim()}\n}`;
	} catch { return null; }
}

/**
 * @typedef {Object} RouteNode
 * @property {string} path - URL segment ('' for root, ':param' for dynamic, '*' for catch-all)
 * @property {string} fullPath - Full URL pattern
 * @property {boolean} isGroup - Route group (parenthesized folder, no URL segment)
 * @property {boolean} isDynamic - Dynamic segment [param]
 * @property {boolean} isCatchAll - Catch-all segment [...param]
 * @property {string|null} page - Component name for page.vsk
 * @property {string|null} layout - Component name for layout.vsk
 * @property {string|null} loading - Component name for loading.vsk
 * @property {string|null} error - Component name for error.vsk
 * @property {boolean} hasMiddleware - Route has middleware.vsk in its subtree
 * @property {RouteNode[]} children - Child route nodes
 * @property {string} sourceDir - Directory containing source files
 * @property {number} segmentCount - Number of URL segments this node consumes
 */

/**
 * Scan the `app/` directory and return a route tree.
 * @param {string} appDir - Path to the app directory
 * @param {object} [options]
 * @param {string} [options.layoutCompName] - Base name for layout components
 * @param {string} [options.pageCompName] - Base name for page components
 * @returns {RouteNode[]}
 */
export function scanRoutes(appDir, options = {}) {
	if (!existsSync(appDir)) {
		return [];
	}
	return scanDirectory(appDir, appDir, '/', options);
}

function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Scan a `components/` directory for reusable .vsk component files.
 * Returns a Map of component name → source file path.
 * Subdirectory nesting produces prefixed names (e.g. ui/Button.vsk → UiButton).
 * @param {string} componentsDir
 * @returns {Map<string, string>}
 */
export function scanComponents(componentsDir) {
	const map = new Map();
	if (!existsSync(componentsDir)) return map;

	function walk(dir, prefix) {
		let entries;
		try { entries = readdirSync(dir); } catch { return; }
		for (const entry of entries) {
			const full = join(dir, entry);
			let stat;
			try { stat = statSync(full); } catch { continue; }
			if (stat.isDirectory()) {
				if (!entry.startsWith('_')) {
					walk(full, prefix ? prefix + capitalize(entry) : capitalize(entry));
				}
			} else if (entry.endsWith('.vsk')) {
				const name = prefix
					? prefix + capitalize(entry.slice(0, -4))
					: entry.slice(0, -4);
				if (!map.has(name)) {
					map.set(name, full);
				}
			}
		}
	}
	walk(componentsDir, '');
	return map;
}

/**
 * Recursively scan a directory for route files.
 */
function scanDirectory(rootDir, dir, parentPath, options) {
	const nodes = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return nodes;
	}

	// Sort: page/layout first, then alphabetical
	entries.sort((a, b) => {
		const aIsSpecial = a === 'page.vsk' || a === 'layout.vsk';
		const bIsSpecial = b === 'page.vsk' || b === 'layout.vsk';
		if (aIsSpecial && !bIsSpecial) return -1;
		if (!aIsSpecial && bIsSpecial) return 1;
		return a.localeCompare(b);
	});

	// Check files in this directory
	let hasLayout = false;
	let hasPage = false;
	let hasLoading = false;
	let hasError = false;
	let hasMiddleware = false;
	let compName = options.compName || '';

	for (const entry of entries) {
		if (entry === 'layout.vsk') { hasLayout = true; continue; }
		if (entry === 'page.vsk') { hasPage = true; continue; }
		if (entry === 'loading.vsk') { hasLoading = true; continue; }
		if (entry === 'error.vsk') { hasError = true; continue; }
		if (entry === 'middleware.vsk') { hasMiddleware = true; continue; }
	}

	// Determine route path for this directory
	let segName = basename(dir);
	let isGroup = segName.startsWith('(') && segName.endsWith(')');
	let isDynamic = segName.startsWith('[') && segName.endsWith(']') && !segName.startsWith('[...');
	let isCatchAll = segName.startsWith('[...') && segName.endsWith(']');
	let isPrivate = segName.startsWith('_');

	// Skip private directories
	if (isPrivate && dir !== rootDir) return nodes;

	// Build path segment
	let seg = '';
	if (dir === rootDir) {
		seg = '';
	} else if (isGroup) {
		seg = ''; // Groups don't add URL segments
	} else if (isDynamic) {
		seg = ':' + segName.slice(1, -1);
	} else if (isCatchAll) {
		seg = ':' + segName.slice(4, -1); // Store param name with : prefix
	} else {
		seg = segName;
	}

	// Build full path
	const fullPath = seg
		? (parentPath === '/' ? '/' : parentPath + '/') + seg
		: (parentPath || '/');

	// Create node
	const node = {
		path: seg,
		fullPath: fullPath.replace(/\/+/g, '/') || '/',
		isGroup,
		isDynamic,
		isCatchAll,
		page: hasPage ? extractComponentName(dir, 'page', rootDir) : null,
		layout: hasLayout ? extractComponentName(dir, 'layout', rootDir) : null,
		loading: hasLoading ? extractComponentName(dir, 'loading', rootDir) : null,
		error: hasError ? extractComponentName(dir, 'error', rootDir) : null,
		hasMiddleware,
		children: [],
		sourceDir: dir,
		segmentCount: isGroup || dir === rootDir ? 0 : 1,
	};

	// Scan subdirectories
	for (const entry of entries) {
		const entryPath = join(dir, entry);
		let entryStat;
		try { entryStat = statSync(entryPath); } catch { continue; }
		if (entryStat.isDirectory()) {
			// Don't recurse into page/layout files (not dirs), but do recurse into
			// subdirectories that might contain route files
			const childNodes = scanDirectory(rootDir, entryPath, fullPath, options);
			node.children.push(...childNodes);
		}
	}

	// Only add node if it has content (page, layout, or children)
	if (node.page || node.layout || node.children.length > 0) {
		nodes.push(node);
	}

	return nodes;
}

/**
 * Extract a component name from directory and file type.
 * Generates unique names like: Page_index, Layout_blog_slug_Detail
 */
function extractComponentName(dir, type, rootDir) {
	const rel = relative(rootDir, dir);
	const parts = rel.split('/').filter(Boolean);
	// Clean up special chars in path parts
	const clean = parts.map(p => {
		// Remove [ ] ( ) ...
		return p.replace(/[\[\]()\.]/g, '').replace(/^\.+/, '');
	});
	const suffix = clean.length > 0 ? clean.join('_') : 'index';
	// Capitalize
	const capitalized = suffix.charAt(0).toUpperCase() + suffix.slice(1);
	if (type === 'page') return 'Page_' + capitalized;
	if (type === 'layout') return 'Layout_' + capitalized;
	if (type === 'loading') return 'Loading_' + capitalized;
	if (type === 'error') return 'Error_' + capitalized;
	return type + '_' + capitalized;
}

/**
 * Build a flat map of component names to source file paths.
 * @param {RouteNode[]} tree
 * @returns {Map<string, string>} component name → source file path
 */
export function collectSources(tree) {
	const map = new Map();
	let mwIdx = 0;
	function walk(nodes) {
		for (const node of nodes) {
			if (node.page) map.set(node.page, join(node.sourceDir, 'page.vsk'));
			if (node.layout) map.set(node.layout, join(node.sourceDir, 'layout.vsk'));
			if (node.loading) map.set(node.loading, join(node.sourceDir, 'loading.vsk'));
			if (node.error) map.set(node.error, join(node.sourceDir, 'error.vsk'));
			if (node.hasMiddleware) {
				map.set('__mw_' + mwIdx++, join(node.sourceDir, 'middleware.vsk'));
			}
			walk(node.children);
		}
	}
	walk(tree);
	return map;
}

/**
 * Generate route definition code that can be used with createFileRouter.
 * @param {RouteNode[]} tree
 * @param {object} [options]
 * @param {string} [options.importPrefix] - Prefix for import paths
 * @returns {string} JavaScript code
 */
export function generateRouteManifest(tree, options = {}) {
	const prefix = options.importPrefix || './';

	function genNode(node, isRoot = false) {
		const parts = [];
		if (node.page) parts.push(`page: ${node.page}`);
		if (node.layout) parts.push(`layout: ${node.layout}`);
		if (node.children.length > 0) {
			const childCodes = node.children.map(c => genNode(c));
			parts.push(`children: [\n${childCodes.map(c => '\t\t' + c).join(',\n')}\n\t]`);
		}
		const pathStr = JSON.stringify(node.fullPath);
		const groupStr = node.isGroup ? `, isGroup: true` : '';
		return `{ path: ${pathStr}${groupStr}, ${parts.join(', ')} }`;
	}

	const nodeCodes = tree.map(n => genNode(n));
	const components = flattenSources(tree);

	let code = `// Auto-generated route manifest — do not edit\n\n`;
	// Add imports for each component
	for (const [name, sourcePath] of components) {
		code += `import { ${name} } from '${prefix}${sourcePath}';\n`;
	}
	code += `\n`;
	code += `const __routeTree = [\n`;
	code += nodeCodes.map(c => '\t' + c).join(',\n');
	code += `\n];\n\n`;
	code += `export default __routeTree;\n`;
	return code;
}

function flattenSources(tree) {
	const map = new Map();
	function walk(nodes) {
		for (const node of nodes) {
			if (node.page) map.set(node.page, node.sourceDir + '/page.vsk');
			if (node.layout) map.set(node.layout, node.sourceDir + '/layout.vsk');
			if (node.loading) map.set(node.loading, node.sourceDir + '/loading.vsk');
			if (node.error) map.set(node.error, node.sourceDir + '/error.vsk');
			walk(node.children);
		}
	}
	walk(tree);
	return map;
}

/**
 * Match a URL pathname against a route tree.
 *
 * The algorithm walks the route tree in parallel with URL path parts.
 * Route groups are transparent (consume no parts). Dynamic segments
 * match any single part. Catch-all matches all remaining parts.
 * Intermediate nodes without page/layout act as path segments.
 *
 * Returns the matching chain (root → leaf) and extracted params.
 */
export function matchUrl(tree, pathname) {
	const parts = pathname.split('/').filter(Boolean);
	const chain = [];
	const params = {};

	// Find the root node (fullPath === '/')
	const rootNode = tree.find(n => n.fullPath === '/');
	if (rootNode) {
		chain.push(rootNode);
	}

	// Walk function: given a set of nodes, try to match remaining parts
	function matchNodes(nodes, partIndex) {
		for (const node of nodes) {
			if (node.isGroup) {
				// Groups are transparent — match children at same partIndex
				if (matchNodes(node.children, partIndex)) {
					if (node.layout) chain.push(node);
					return true;
				}
				continue;
			}

			if (node.fullPath === '/') {
				// Root is a special case — already in chain, match its children
				return matchNodes(node.children, partIndex);
			}

			// No more URL parts
			if (partIndex >= parts.length) {
				if (node.page) {
					chain.push(node);
					return true;
				}
				continue;
			}

			const part = parts[partIndex];

			// Catch-all matches everything remaining
			if (node.isCatchAll) {
				const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
				params[paramName] = parts.slice(partIndex).map(decodeURIComponent).join('/');
				chain.push(node);
				return true;
			}

			// Dynamic segment matches any single part
			if (node.isDynamic) {
				const paramName = node.path.startsWith(':') ? node.path.slice(1) : node.path;
				params[paramName] = decodeURIComponent(part);
				chain.push(node);
				if (node.children.length > 0) {
					if (matchNodes(node.children, partIndex + 1)) return true;
				} else if (node.page) {
					return true;
				}
				chain.pop();
				delete params[paramName];
				continue;
			}

			// Static segment must match exactly
			if (node.path === part) {
				chain.push(node);
				if (node.children.length > 0) {
					if (matchNodes(node.children, partIndex + 1)) return true;
				} else if (node.page) {
					return true;
				}
				chain.pop();
				continue;
			}
		}
		return false;
	}

	// Start matching from root's children at partIndex 0
	if (rootNode) {
		const matched = matchNodes(rootNode.children, 0);
		if (!matched && parts.length === 0) {
			// Root path with only a root node (which may have a page)
			return { nodes: chain, params };
		}
		if (!matched) return null;
	} else {
		const matched = matchNodes(tree, 0);
		if (!matched) return null;
	}

	return { nodes: chain, params };
}
