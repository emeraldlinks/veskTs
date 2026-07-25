import { track, get, set, set_active_block, set_active_component } from './ripple-runtime.js';
import { effect as createEffect, root } from './ripple-blocks.js';
import { createContext } from './context.js';
import { hydrate, createHydrateWalker } from './hydrate.js';

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

export function Link(props, registry, hydrate) {
	const href = props.href || '#';
	if (hydrate && hydrate.nextElement && !hydrate.done) {
		const a = hydrate.nextElement('a');
		if (props.children != null) {
			if (typeof props.children === 'string' || typeof props.children === 'number') {
				a.textContent = String(props.children);
			} else if (props.children.textContent) {
				a.textContent = props.children.textContent;
			}
		}
		a.addEventListener('click', (e) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			if (props.target === '_blank') return;
			e.preventDefault();
			const nav = useNavigate();
			nav(href);
		});
		return document.createDocumentFragment();
	}
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
	if (childStr) {
		a.textContent = childStr;
	} else if (props.children != null) {
		if (props.children.nodeType) {
			a.appendChild(props.children);
		} else if (Array.isArray(props.children)) {
			for (const c of props.children) {
				if (c && c.nodeType) a.appendChild(c);
				else if (c != null) a.appendChild(document.createTextNode(String(c)));
			}
		}
	}
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

export function NavLink(props, registry, hydrate) {
	if (typeof document === 'undefined') {
		return Link(props, registry, hydrate);
	}
	if (__isHydrating) {
		// Hydration mode — claim existing <a> elements by href
		const a = document.querySelector(`a[href="${props.href}"]`);
		if (a) {
			if (props.children != null) {
				if (typeof props.children === 'string' || typeof props.children === 'number') {
					a.textContent = String(props.children);
				} else if (props.children.textContent) {
					a.textContent = props.children.textContent;
				}
			}
			a.addEventListener('click', (e) => {
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				if (props.target === '_blank') return;
				e.preventDefault();
				const nav = useNavigate();
				nav(props.href);
			});
			const path = usePathname();
			const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === '/' || path[props.href.length] === '?'));
			if (isActive) {
				a.classList.add(props.activeClass || 'active');
				if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
			}
			return document.createDocumentFragment();
		}
	}
	const a = Link(props, registry, hydrate);
	const path = usePathname();
		const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === '/' || path[props.href.length] === '?'));
	if (isActive) {
		a.classList.add(props.activeClass || 'active');
		if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
	}
	return a;
}

// ── Hooks ──────────────────────────────────────────────────────

/** Set to true during initial hydration to signal components to claim SSR elements */
let __isHydrating = false;

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
			_state.path.value = path;
		}
	};
}

export function useParams() {
	return get(_state.params);
}

export function usePathname() {
	return get(_state.path);
}

export function useSearchParams() {
	const s = get(_state.search);
	const sp = new URLSearchParams(s || '');
	const setter = (next) => {
		const q = typeof next === 'string' ? next : new URLSearchParams(next).toString();
		_state.search.value = q;
		const nav = useNavigate();
		const path = get(_state.path);
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
			const remaining = pathParts.slice(node.segmentCount != null ? node.segmentCount : 1);
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
		const segCount = node.segmentCount != null ? node.segmentCount : 1;

		// Check if this node matches the current path segment
		let matched = false;
		if (node.fullPath === '/') {
			// Root node always matches as a layout prefix
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
			if (isLeaf && node.page && node.layout) {
				// Node serves as both layout and page — push once for layout
				// renderMatch will also render its page component
				result.push(node);
				break;
			} else if (node.layout) {
				result.push(node);
			}
			if (isLeaf) {
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

	// Extract params by walking the match chain alongside path parts
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

function renderMatch(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		if (container.replaceChildren) {
			container.replaceChildren();
		} else {
			container.innerHTML = '';
		}
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);
	const tempRoot = document.createDocumentFragment();
	const clientWalker = createHydrateWalker(tempRoot, []);

	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			_state.params.value = paramValues;
			_state.path.value = match.pathname || window.location.pathname;
			_state.search.value = window.location.search || '';
			const pageProps = { params: paramValues, ...pageNode.props };
			return pageNode.page(pageProps, new Map(), clientWalker);
		}
		const node = layoutNodes[index];
		const childDom = renderLayoutChain(index + 1);
		const layoutProps = { children: childDom, params: paramValues };
		return node.layout(layoutProps, new Map(), clientWalker);
	}

	let rootDom;
	root(() => {
		rootDom = renderLayoutChain(0);
	});

	if (rootDom && typeof rootDom === 'object' && rootDom.nodeType) {
		if (container.replaceChildren) {
			container.replaceChildren(rootDom);
		} else {
			container.innerHTML = '';
			container.appendChild(rootDom);
		}
	} else if (typeof rootDom === 'string') {
		container.innerHTML = rootDom;
	}
}

/**
 * Hydrate initial SSR content — claims existing DOM nodes instead of re-rendering.
 * Uses tree-structured walker scoped to each component's parent element.
 * Each component claims elements from its parent's children by tag matching.
 * Child components (via slot) receive a sub-walker scoped to the parent element.
 * This ensures zero DOM mutations for the initial load.
 */
function hydrateInitial(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}
	if (!pageNode) {
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);

	_state.params.value = paramValues;
	_state.path.value = match.pathname || window.location.pathname;
	_state.search.value = window.location.search || '';

	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);

	// Use hydrator versions of component functions
	const hydrators = router.__hydrators;
	const hydPage = hydrators && pageNode._pageName
		? (hydrators[pageNode._pageName] || pageNode.page)
		: pageNode.page;
	const hydLayouts = layoutNodes.map(n => {
		if (hydrators && n._layoutName) {
			return hydrators[n._layoutName] || n.layout;
		}
		return n.layout;
	});

	if (layoutNodes.length === 0) {
		__isHydrating = true;
		root(() => {
			hydPage({ params: paramValues, ...pageNode.props }, new Map(), walker);
		});
		__isHydrating = false;
		return;
	}

	__isHydrating = true;

	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			return (subWalker) => {
				hydPage({ params: paramValues, ...pageNode.props }, new Map(), subWalker);
			};
		}
		const node = layoutNodes[index];
		const hydLayout = hydLayouts[index];
		const childHydrator = renderLayoutChain(index + 1);
		const layoutProps = { children: childHydrator, params: paramValues };
		hydLayout(layoutProps, new Map(), walker);
		return null;
	}

	root(() => {
		renderLayoutChain(0);
	});

	__isHydrating = false;
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

			// Render initial route — hydrate if SSR content exists
			const path = window.location.pathname + window.location.search;
			if (container.children.length > 0) {
				const url = new URL(path, window.location.origin);
				const match = matchRoute(this.routeTree, url.pathname);
				if (match) {
					match.pathname = url.pathname;
					hydrateInitial(this, match, container);
					this._currentMatch = match;
				} else {
					this.navigate(path, { replace: true });
				}
			} else {
				this.navigate(path, { replace: true });
			}

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

			_state.path.value = url.pathname;
			_state.search.value = url.search;

			renderMatch(this, match, this.container);
			this._currentMatch = match;
		},

		prefetch(path) {
			// For manual routes, could preload lazy components
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });
		},
	};

	return router;
}

function buildTreeFromMap(routes) {
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
			children: [],
			segmentCount: parts.length || 1,
			loader,
		};
		root.push(node);
	}
	return root;
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
				if (e.defaultPrevented) return;
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
				router.navigate(window.location.pathname + window.location.search, { replace: true });
			});

			const path = window.location.pathname;
			if (container.children.length > 0) {
				const match = matchRoute(routeTree, path);
				if (match) {
					match.pathname = path;
					hydrateInitial(router, match, container);
					router._currentMatch = match;
				} else {
					router.navigate(path, { replace: true });
				}
			} else {
				router.navigate(path, { replace: true });
			}
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
					const fullUrl = url.pathname + url.search;
					if (!opts.replace) {
						window.history.pushState({ path: fullUrl }, '', fullUrl);
					} else {
						window.history.replaceState({ path: fullUrl }, '', fullUrl);
					}
					_state.path.value = url.pathname;
					_state.search.value = url.search;
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
				_state.path.value = url.pathname;
				_state.search.value = url.search;
				renderFn(router, match, container);
				router._currentMatch = match;
			}
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });
		},
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
			children: (def.children || []).map(c => {
				const cParts = c.path.split('/').filter(Boolean);
				return {
					...c,
					path: cParts[cParts.length - 1] || '',
					fullPath: (def.path + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
					isDynamic: cParts.some(p => p.startsWith(':')),
					isCatchAll: cParts.some(p => p === '*'),
					isGroup: false,
					segmentCount: Math.max(1, cParts.length),
					children: [],
				};
			}),
			segmentCount: Math.max(1, parts.length),
		};
		tree.push(node);
	}
	return tree;
}
