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
	standalone?: boolean;
	_matchChain?: RouteNode[];
	loader?: Function;
	props?: Record<string, unknown>;
	_head?: string;
	[k: string]: unknown;
}

export interface RouteMatch {
	matchChain: RouteNode[];
	params: Record<string, string>;
	/**
	 * The pathname this match was computed FOR — not the pattern that matched.
	 * `usePathname()` and `NavLink`'s active state read it, so leaving it unset
	 * made every route report `/` (via `pathname || ''`), which is what made
	 * NavLink highlighting permanently inert.
	 */
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
		// Root node (fullPath '/') always matches as a container; recurse into children.
		const isRoot = node.fullPath === '/';
		const matched = isRoot ? true : matchRouteNode(node, pathParts);
		if ((node as any).standalone && matched && !isRoot) {
			layouts.length = 0;
		}
		if (node.layout) {
			layouts.push({ layout: node.layout, node });
		}
		if (matched && !isRoot) {
			const remaining = pathParts.slice(node.segmentCount != null ? node.segmentCount : 1);
			if (remaining.length > 0 && (node.children || []).length > 0) {
				const childLayouts = collectLayouts(node.children || [], remaining);
				layouts.push(...childLayouts);
			}
		} else if (isRoot && (node.children || []).length > 0) {
			const childLayouts = collectLayouts(node.children || [], pathParts);
			layouts.push(...childLayouts);
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
			// A group contributes its LAYOUT to every route beneath it, so it has
			// to be in the chain even when one of its children is the match.
			// Dropping it meant `app/(public)/layout.vsk` never applied on the
			// client — the framework's own hyd-dbg output showed
			// `layoutNames:["Layout_Index"]` for `/about`, i.e. the root layout
			// only, and the page rendered outside its shell. SSR kept the group
			// (the server routes from the build manifest), which is why the page
			// looked right until the client took over.
			//
			// A group consumes no path segment, so children are matched against
			// the SAME parts.
			const contributes = !!(node.layout || node.page);
			const marker = result.length;
			if (contributes) result.push(node);
			const before = result.length;
			flattenLayoutChain(node.children || [], pathParts, result);
			if (result.length > before) break;
			// No child matched at this position; if the group is not itself the
			// page here, it contributes nothing and must not stay in the chain.
			// (If it IS the page, the push above is the match.)
			if (contributes) result.length = marker;
			// A group can BE the page at this position: `app/(public)/page.vsk`
			// serves `/`. Recursing into its children was the only thing this
			// branch did, and at `/` none of them match (each carries a path
			// segment), so the group was dropped and the chain collapsed onto the
			// page-less root — a client-side 404 for the zero-segment path, with
			// no hydration, while `/about` and every nested route matched fine.
			//
			// A group is transparent for prefix matching; it has to be
			// transparent here too. Only at a terminal position: mid-path, the
			// child that matched is the page, not the group.
			if (node.page && (pathParts.length === 0 || pathParts.every((p) => p === ''))) {
				result.push(node);
				break;
			}
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
			if ((node as any).standalone) result.length = 0;
			result.push(node);
			if (isLeaf) {
				// A container node at a terminal position must still let a deeper
				// page-owning node win. The root is exactly this case: it matches
				// every URL, so without descending here the chain stopped on the
				// page-less root and never reached `app/(public)/page.vsk` — a
				// client 404 with no hydration for `/`, while `/about` matched
				// fine.
				//
				// Only when THIS node has no page of its own; if it does, it is the
				// page and descending would shadow it.
				if (!node.page && (node.children || []).length > 0) {
					const before = result.length;
					flattenLayoutChain(node.children || [], remaining, result);
					if (result.length > before) break;
				}
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
			const paramIdx = partIdx + segCount - 1;
			if (paramIdx < pathParts.length) {
				params[name] = decodeURIComponent(pathParts[paramIdx]);
			}
		}
		if (node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			params[name] = pathParts.slice(partIdx).map(decodeURIComponent).join('/');
		}
		partIdx += segCount;
	}

	return { matchChain, params, pathname };
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
			segmentCount: parts.length,
			loader,
		};
		root.push(node);
	}
	return root;
}
