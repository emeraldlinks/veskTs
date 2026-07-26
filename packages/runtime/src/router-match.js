/**
 * Route pattern matching, parameter extraction, and layout chain flattening.
 * Pure utilities — no side effects, no imports.
 *
 * @module router-match
 */

/**
 * Compile a route pattern (e.g. "/blog/:slug") into a RegExp and param name list.
 * Supports `:param` dynamic segments and `*` catch-all.
 * @param {string} fullPath - route pattern (e.g. "/blog/:slug")
 * @returns {{ regex: RegExp, paramNames: string[] }}
 */
export function compileRoutePattern(fullPath) {
	const paramNames = [];
	const parts = fullPath.split('/').filter(Boolean);
	let regexStr = '^';
	for (const part of parts) {
		if (part.startsWith(':')) {
			const name = part.slice(1);
			paramNames.push(name);
			regexStr += '/([^/]+)';
		} else if (part === '*') {
			regexStr += '(?:/(.*))?';
		} else {
			regexStr += '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	regexStr += '$';
	return { regex: new RegExp(regexStr), paramNames };
}

/**
 * Collect layout components from route nodes that match the given path parts.
 * Used to build the layout chain for SSR rendering.
 * @param {object[]} nodes - route tree nodes
 * @param {string[]} pathParts - URL path segments
 * @returns {Array<{ layout: Function, node: object }>}
 */
export function collectLayouts(nodes, pathParts) {
	const layouts = [];
	for (const node of nodes) {
		if (node.isGroup) {
			const childLayouts = collectLayouts(node.children, pathParts);
			layouts.push(...childLayouts);
			continue;
		}
		if (node.layout) {
			layouts.push({ layout: node.layout, node });
		}
		const len = pathParts.length;
		const matched = matchRouteNode(node, pathParts);
		if (matched) {
			const remaining = pathParts.slice(node.segmentCount != null ? node.segmentCount : 1);
			if (remaining.length > 0 && node.children.length > 0) {
				const childLayouts = collectLayouts(node.children, remaining);
				layouts.push(...childLayouts);
			}
		}
	}
	return layouts;
}

/**
 * Check if a route node matches the first path segment.
 * @param {object} node - route tree node
 * @param {string[]} pathParts - URL path segments
 * @returns {boolean}
 */
export function matchRouteNode(node, pathParts) {
	if (node.isGroup) return false;
	if (pathParts.length === 0) return node.fullPath === '/';
	const part = pathParts[0];
	if (node.isCatchAll) return true;
	if (node.isDynamic) return true;
	return node.path === part;
}

/**
 * Extract URL parameters from the match chain.
 * @param {object} node - matched route node (with `_matchChain`)
 * @param {string[]} pathParts - URL path segments
 * @returns {object} param name → value
 */
export function extractParams(node, pathParts) {
	const params = {};
	let idx = 0;
	for (const n of node._matchChain || []) {
		if (n.isDynamic && pathParts[idx]) {
			const name = n.path.slice(1);
			params[name] = decodeURIComponent(pathParts[idx]);
		} else if (n.isCatchAll) {
			const name = n.path.slice(1);
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
		if (!n.isGroup) idx++;
	}
	return params;
}

/**
 * Flatten the route tree into a match chain for a given URL path.
 * Returns the sequence of nodes that match, from root to leaf.
 * @param {object[]} tree - route tree
 * @param {string[]} pathParts - URL path segments
 * @param {object[]} [result] - accumulator
 * @returns {object[]} flattened match chain
 */
export function flattenLayoutChain(tree, pathParts, result = []) {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.isGroup) {
			flattenLayoutChain(node.children, pathParts, result);
			continue;
		}

		const part = pathParts[0];
		const segCount = node.segmentCount != null ? node.segmentCount : 1;

		let matched = false;
		if (node.fullPath === '/') {
			matched = true;
		} else if (node.isCatchAll) {
			matched = true;
		} else if (node.isDynamic) {
			matched = part !== undefined;
		} else {
			matched = node.path === part;
		}

		if (matched) {
			const consumeCount = node.isCatchAll ? pathParts.length : segCount;
			const remaining = pathParts.slice(consumeCount);
			const isLeaf = remaining.length === 0 || remaining.every(p => p === '');
			result.push(node);
			if (isLeaf) {
				break;
			} else if (node.children.length > 0) {
				flattenLayoutChain(node.children, remaining, result);
				break;
			}
		}
	}
	return result;
}

/**
 * Match a URL pathname against the route tree, returning the match chain and params.
 * @param {object[]} tree - route tree
 * @param {string} pathname - URL pathname (e.g. "/blog/hello-world")
 * @returns {{ matchChain: object[], params: object } | null}
 */
export function matchRoute(tree, pathname) {
	const pathParts = pathname.split('/').filter(Boolean);
	const matchChain = flattenLayoutChain(tree, pathParts);
	if (matchChain.length === 0) return null;

	const params = {};
	let partIdx = 0;
	for (const node of matchChain) {
		const segCount = node.segmentCount != null ? node.segmentCount : 1;
		if (node.isDynamic && !node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			if (partIdx < pathParts.length) {
				params[name] = decodeURIComponent(pathParts[partIdx]);
			}
		}
		if (node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			params[name] = pathParts.slice(partIdx).map(decodeURIComponent).join('/');
		}
		partIdx += segCount;
	}

	return { matchChain, params };
}

/**
 * Build a flat route tree from a map of pattern → loader function.
 * Used by the manual `createRouter` API.
 * @param {object} routes - map of pattern → component function
 * @returns {object[]} route tree
 */
export function buildTreeFromMap(routes) {
	const root = [];
	for (const [pattern, loader] of Object.entries(routes)) {
		const parts = pattern.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p.startsWith('...'));
		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: pattern,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: loader,
			layout: null,
			loading: null,
			error: null,
			notFound: null,
			children: [],
			segmentCount: parts.length || 1,
			loader,
		};
		root.push(node);
	}
	return root;
}
