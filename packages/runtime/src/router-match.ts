export interface RouteNode {
	path: string;
	fullPath?: string;
	isGroup?: boolean;
	isDynamic?: boolean;
	isCatchAll?: boolean;
	page?: Function | null;
	layout?: Function | null;
	loading?: Function | null;
	error?: Function | null;
	notFound?: Function | null;
	offline?: Function | string | null;
	network?: Function | string | null;
	children?: RouteNode[];
	segmentCount?: number;
	_matchChain?: RouteNode[];
	loader?: Function;
	props?: Record<string, unknown>;
	_head?: string;
	[k: string]: unknown;
}

export interface RouteMatch {
	matchChain: RouteNode[];
	params: Record<string, string>;
	pathname?: string;
}

interface CompiledRoute {
	regex: RegExp;
	paramNames: string[];
}

export function compileRoutePattern(fullPath: string): CompiledRoute {
	const paramNames: string[] = [];
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

export function collectLayouts(nodes: RouteNode[], pathParts: string[]): { layout: Function; node: RouteNode }[] {
	const layouts: { layout: Function; node: RouteNode }[] = [];
	for (const node of nodes) {
		if (node.isGroup) {
			const childLayouts = collectLayouts(node.children || [], pathParts);
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
			if (remaining.length > 0 && (node.children || []).length > 0) {
				const childLayouts = collectLayouts(node.children || [], remaining);
				layouts.push(...childLayouts);
			}
		}
	}
	return layouts;
}

export function matchRouteNode(node: RouteNode, pathParts: string[]): boolean {
	if (node.isGroup) return false;
	if (pathParts.length === 0) return node.fullPath === '/';
	const part = pathParts[0];
	if (node.isCatchAll) return true;
	if (node.isDynamic) return true;
	return node.path === part;
}

export function extractParams(node: RouteNode, pathParts: string[]): Record<string, string> {
	const params: Record<string, string> = {};
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

export function flattenLayoutChain(tree: RouteNode[], pathParts: string[], result: RouteNode[] = []): RouteNode[] {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.isGroup) {
			flattenLayoutChain(node.children || [], pathParts, result);
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
			} else if ((node.children || []).length > 0) {
				flattenLayoutChain(node.children || [], remaining, result);
				break;
			}
		}
	}
	return result;
}

export function matchRoute(tree: RouteNode[], pathname: string): RouteMatch | null {
	const pathParts = pathname.split('/').filter(Boolean);
	const matchChain = flattenLayoutChain(tree, pathParts);
	if (matchChain.length === 0) return null;

	const params: Record<string, string> = {};
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

export function buildTreeFromMap(
	routes: Record<string, Function>,
	_options?: Record<string, unknown>,
): RouteNode[] {
	const root: RouteNode[] = [];
	for (const [pattern, loader] of Object.entries(routes)) {
		const parts = pattern.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p.startsWith('...'));
		const node: RouteNode = {
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
			offline: null,
			network: null,
			children: [],
			segmentCount: parts.length || 1,
			loader,
		};
		root.push(node);
	}
	return root;
}
