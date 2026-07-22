import { track, effect } from './track.js';
import { createContext } from './context.js';

// ── Redirect — throws a redirect that SSR can catch ───────────

export class Redirect extends Error {
	constructor(url, status = 302) {
		super(`Redirect to ${url}`);
		this.url = url;
		this.status = status;
		this.name = 'Redirect';
	}
}

export function redirect(url, status = 302) {
	throw new Redirect(url, status);
}

/** 308 Permanent Redirect */
export function permanentRedirect(url) {
	throw new Redirect(url, 308);
}

// ── NotFound — triggers a 404 response ──────────────────────────

export class NotFoundError extends Error {
	constructor(msg = 'Not Found') {
		super(msg);
		this.name = 'NotFoundError';
	}
}

/** Trigger a 404 — caught by dev server or API route executor */
export function notFound() {
	throw new NotFoundError();
}

// ── Router Context ──────────────────────────────────────────────

const RouterCtx = createContext(null);

let _currentRouter = null;
let _outletId = 0;

// ── Outlet Component ───────────────────────────────────────────

export function Outlet(props) {
	const router = RouterCtx.get();
	if (!router) return document.createComment('outlet');
	const div = document.createElement('div');
	div.setAttribute('data-vesk-outlet', String(_outletId++));
	div.style.display = 'contents';
	if (router._outletPlaceholders) {
		router._outletPlaceholders.push(div);
	}
	const seg = router._currentSegments && router._currentSegments[router._depth];
	if (seg && seg.rendered) {
		div.appendChild(seg.rendered);
	}
	return div;
}

// ── Link Component ──────────────────────────────────────────────

export function Link(props) {
	const href = props.href || '#';
	const attrs = [
		`href="${href.replace(/"/g, '&quot;')}"`,
		props.class ? `class="${String(props.class).replace(/"/g, '&quot;')}"` : '',
		props.style ? `style="${String(props.style).replace(/"/g, '&quot;')}"` : '',
		props.target ? `target="${String(props.target).replace(/"/g, '&quot;')}"` : '',
		props.rel ? `rel="${String(props.rel).replace(/"/g, '&quot;')}"` : '',
	].filter(Boolean).join(' ');
	let childStr = '';
	if (props.children != null) {
		childStr = typeof props.children === 'string' ? props.children
			: typeof props.children === 'number' ? String(props.children)
			: '';
	}
	if (typeof document === 'undefined') {
		return `<a ${attrs}>${childStr}</a>`;
	}
	const a = document.createElement('a');
	a.href = href;
	if (props.class) a.className = props.class;
	if (props.style) a.setAttribute('style', props.style);
	if (props.target) a.target = props.target;
	if (props.rel) a.rel = props.rel;
	if (childStr) a.textContent = childStr;
	a.addEventListener('click', (e) => {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		if (props.target === '_blank') return;
		e.preventDefault();
		const nav = useNavigate();
		nav(href);
	});
	return a;
}

// ── NavLink Component ───────────────────────────────────────────

export function NavLink(props) {
	if (typeof document === 'undefined') {
		return Link(props);
	}
	const a = Link(props);
	const path = usePathname();
	const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href));
	if (isActive) {
		a.classList.add(props.activeClass || 'active');
		if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
	}
	return a;
}

// ── Hooks ──────────────────────────────────────────────────────

const _state = {
	path: track('/'),
	params: track({}),
	search: track(''),
};

export function useNavigate() {
	const router = RouterCtx.get() || _currentRouter;
	return (path, opts = {}) => {
		if (router && router.navigate) {
			router.navigate(path, opts);
		} else {
			window.history.pushState({}, '', path);
			_state.path.set(path);
		}
	};
}

export function useParams() {
	return _state.params.get();
}

export function usePathname() {
	return _state.path.get();
}

export function useSearchParams() {
	const s = _state.search.get();
	const sp = new URLSearchParams(s || '');
	const setter = (next) => {
		const q = typeof next === 'string' ? next : new URLSearchParams(next).toString();
		_state.search.set(q);
		const nav = useNavigate();
		const path = _state.path.get();
		nav(path + (q ? '?' + q : ''), { replace: true });
	};
	return [sp, setter];
}

export function useRouter() {
	const router = RouterCtx.get() || _currentRouter;
	return {
		push: (href) => router?.navigate?.(href),
		replace: (href) => router?.navigate?.(href, { replace: true }),
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		refresh: () => router?.navigate?.(window.location.pathname, { replace: true }),
	};
}

// ── Route Tree Types ───────────────────────────────────────────

/*
 * RouteNode:
 *   path: string           // URL segment ('' for root, ':param' for dynamic, '*' for catch-all)
 *   fullPath: string       // Full URL pattern
 *   isGroup: boolean       // Route group (no URL segment)
 *   isDynamic: boolean     // [param] segment
 *   isCatchAll: boolean    // [...param] segment
 *   page: Function|null    // Page component
 *   layout: Function|null  // Layout component
 *   children: RouteNode[]
 *   layouts: RouteNode[]   // Flattened layout chain for this route
 */

function compileRoutePattern(fullPath) {
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

function collectLayouts(nodes, pathParts) {
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
			const remaining = pathParts.slice(node.segmentCount || 1);
			if (remaining.length > 0 && node.children.length > 0) {
				const childLayouts = collectLayouts(node.children, remaining);
				layouts.push(...childLayouts);
			}
		}
	}
	return layouts;
}

function matchRouteNode(node, pathParts) {
	if (node.isGroup) return false;
	if (pathParts.length === 0) return node.fullPath === '/';
	const part = pathParts[0];
	if (node.isCatchAll) return true;
	if (node.isDynamic) return true;
	return node.path === part;
}

function extractParams(node, pathParts) {
	const params = {};
	let idx = 0;
	for (const node of node._matchChain || []) {
		if (node.isDynamic && pathParts[idx]) {
			const name = node.path.slice(1); // remove ':'
			params[name] = decodeURIComponent(pathParts[idx]);
		} else if (node.isCatchAll) {
			const name = node.path.slice(1); // remove ':'
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
		if (!node.isGroup) idx++;
	}
	return params;
}

// ── Route Tree Matching ────────────────────────────────────────

function flattenLayoutChain(tree, pathParts, result = []) {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.isGroup) {
			flattenLayoutChain(node.children, pathParts, result);
			continue;
		}

		const part = pathParts[0];

		// Check if this node matches the current path segment
		let matched = false;
		if (node.fullPath === '/') {
			matched = pathParts.length === 0 || pathParts.every(p => p === '');
		} else if (node.isCatchAll) {
			matched = true;
		} else if (node.isDynamic) {
			matched = part !== undefined;
		} else {
			matched = node.path === part;
		}

		if (matched) {
			if (node.layout) {
				result.push(node);
			}
			const remaining = pathParts.slice(node.isCatchAll ? pathParts.length : 1);
			if (remaining.length === 0 || remaining.every(p => p === '')) {
				// This is the leaf — add the page
				if (node.page) result.push(node);
				break;
			} else if (node.children.length > 0) {
				flattenLayoutChain(node.children, remaining, result);
				break;
			}
		}
	}
	return result;
}

// ── Router Implementation ──────────────────────────────────────

function matchRoute(tree, pathname) {
	const pathParts = pathname.split('/').filter(Boolean);
	const matchChain = flattenLayoutChain(tree, pathParts);
	if (matchChain.length === 0) return null;

	const params = {};
	for (const node of matchChain) {
		if (node.isDynamic) {
			let partIndex = 0;
			let found = false;
			for (let i = 0; i < tree.length; i++) {
				if (tree[i].isGroup) continue;
				if (tree[i].fullPath === '/') continue;
				if (tree[i] === node) { found = true; break; }
				partIndex++;
			}
			if (pathParts[partIndex]) {
				const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
				params[name] = decodeURIComponent(pathParts[partIndex]);
			}
		}
		if (node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			let idx = 0;
			for (let i = 0; i < tree.length; i++) {
				if (tree[i].isGroup) continue;
				if (tree[i] === node) break;
				idx++;
			}
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
	}

	return { matchChain, params };
}

function renderMatch(router, match, container) {
	container.innerHTML = '';
	const chain = match.matchChain;
	const paramValues = match.params;

	// Find the page node (the last one in the chain that has a page component)
	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	// Collect layout nodes (everything before pageNode that has a layout)
	const layoutNodes = chain.filter(n => n.layout && n !== pageNode);

	// Build the component tree: outermost layout wraps... wraps page
	// We render top-down: each component receives children (the next inner component)
	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			// Render the page
			_state.params.set(paramValues);
			_state.path.set(match.pathname || window.location.pathname);
			_state.search.set(window.location.search || '');

			const pageProps = { params: paramValues, ...pageNode.props };
			const dom = pageNode.page(pageProps);
			return dom;
		}

		const node = layoutNodes[index];
		// Create a fragment to hold the child content
		const childDom = renderLayoutChain(index + 1);

		// Wrap in the layout
		const layoutProps = { children: childDom, params: paramValues };
		const layoutDom = node.layout(layoutProps);
		return layoutDom;
	}

	const rootDom = renderLayoutChain(0);
	if (rootDom && typeof rootDom === 'object' && rootDom.nodeType) {
		container.appendChild(rootDom);
	} else if (typeof rootDom === 'string') {
		container.innerHTML = rootDom;
	}
}

// ── Create Router (Manual) ─────────────────────────────────────

export function createRouter(
	routes,
	options = {}
) {
	const container = options.container || document.getElementById('root');
	const prefetch = options.prefetch !== false;

	// Build route tree from flat route map
	const routeTree = buildTreeFromMap(routes, options);

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			// Set up click delegation
			document.addEventListener('click', (e) => {
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				this.navigate(href);
			});

			window.addEventListener('popstate', () => {
				this.navigate(window.location.href, { replace: true });
			});

			if (prefetch) {
				document.addEventListener('mouseenter', (e) => {
					const link = e.target.closest('a[href]');
					if (link) this.prefetch(link.getAttribute('href'));
				}, { passive: true });
			}

			// Render initial route
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });

			return this;
		},

		async navigate(path, opts = {}) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);

			if (!match) {
				window.location.href = path;
				return;
			}

			match.pathname = url.pathname;

			if (!opts.replace) {
				window.history.pushState({ path: url.pathname }, '', url.pathname);
			} else {
				window.history.replaceState({ path: url.pathname }, '', url.pathname);
			}

			_state.path.set(url.pathname);
			_state.search.set(url.search);

			renderMatch(this, match, this.container);
			this._currentMatch = match;
		},

		prefetch(path) {
			// For manual routes, could preload lazy components
		},

		get currentPath() {
			return _state.path.get();
		}
	};

	return router;
}

function buildTreeFromMap(routes) {
	const tree = [];
	for (const [pattern, loader] of Object.entries(routes)) {
		const parts = pattern.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: pattern,
			isGroup: false,
			isDynamic,
			isCatchAll: false,
			page: null,
			layout: null,
			children: [],
			loader,
		};
		tree.push(node);
	}
	return tree;
}

// ── Create File Router ─────────────────────────────────────────

export function createFileRouter(routeTree, options = {}) {
	const container = options.container || document.getElementById('root');
	const middleware = options.middleware || null;
	const renderFn = options.render || renderMatch;

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			document.addEventListener('click', (e) => {
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				router.navigate(href);
			});
			window.addEventListener('popstate', () => {
				router.navigate(window.location.pathname, { replace: true });
			});

			const path = window.location.pathname;
			router.navigate(path, { replace: true });
			return router;
		},

		navigate(pathname, opts = {}) {
			const url = pathname instanceof URL ? pathname : new URL(pathname, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) {
				container.innerHTML = '<h1>404 — Not Found</h1>';
				return;
			}

			match.pathname = url.pathname;

			// Run middleware chain (onion model)
			const middlewareFns = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			async function runMwChain(index) {
				if (index >= middlewareFns.length) {
					// All middleware passed — render
					if (!opts.replace) {
						window.history.pushState({ path: url.pathname }, '', url.pathname);
					} else {
						window.history.replaceState({ path: url.pathname }, '', url.pathname);
					}
					_state.path.set(url.pathname);
					_state.search.set(url.search);
					renderFn(router, match, container);
					router._currentMatch = match;
					return;
				}

				const fn = middlewareFns[index];
				const ctx = { url: url.pathname, params: match.params, router, locals: {} };

				async function next(rewrite) {
					if (rewrite) {
						match.pathname = rewrite;
						url.pathname = rewrite;
					}
					return runMwChain(index + 1);
				}

				try {
					const result = await fn(ctx, next);
					if (result && result.redirect) {
						router.navigate(result.redirect, { replace: true });
						return;
					}
				} catch (e) {
					if (e && e.name === 'Redirect') {
						router.navigate(e.url, { replace: true });
						return;
					}
				}
			}

			if (middlewareFns.length > 0) {
				runMwChain(0);
			} else {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				_state.path.set(url.pathname);
				_state.search.set(url.search);
				renderFn(router, match, container);
				router._currentMatch = match;
			}
		},

		get currentPath() {
			return _state.path.get();
		}
	};

	return router;
}

// ── Route Tree Builder (for compiler output) ───────────────────

export function defineRoute(path, config) {
	return { path, ...config };
}

export function buildRouteTree(definitions) {
	const tree = [];
	for (const def of definitions) {
		const parts = def.path.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p === '*');

		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: def.path,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: def.page || null,
			layout: def.layout || null,
			children: (def.children || []).map(c => ({
				...c,
				fullPath: (def.path + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
			})),
			segmentCount: Math.max(1, parts.length),
		};
		tree.push(node);
	}
	return tree;
}
