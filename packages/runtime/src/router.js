/**
 * Vesk Router — core router implementation.
 *
 * Provides createRouter (manual) and createFileRouter (file-based) APIs,
 * plus defineRoute/buildRouteTree for compiler-generated routes.
 *
 * @module router
 */

import { track, get, set } from './ripple-runtime.js';
import { root } from './ripple-blocks.js';
import { createHydrateWalker, hydrateViewport, hydrateIdle, hydrateOnInteraction } from './hydrate.js';
import { matchRoute, flattenLayoutChain, buildTreeFromMap } from './router-match.js';
import {
	__isHydrating, setIsHydrating, _state, _scrollPositions,
	_isPopStateNavigation, setIsPopStateNavigation, setCurrentRouter,
	showLoadingInContainer, handleScroll, findLoadingComponent,
	findErrorComponent, findNotFoundComponent, RouterCtx, getCurrentRouter,
	Outlet, Link, NavLink, useNavigate, useParams, usePathname,
	useSearchParams, useRouter, Redirect, redirect, permanentRedirect,
	NotFoundError, notFound,
} from './router-components.js';

// ── Re-export all component/hook/error symbols ─────────────────
export {
	Outlet, Link, NavLink,
	useNavigate, useParams, usePathname, useSearchParams, useRouter,
	Redirect, redirect, permanentRedirect, NotFoundError, notFound,
};

const loadedChunks = new Set();

function ensureChunk(chunkUrl) {
	if (!chunkUrl || loadedChunks.has(chunkUrl)) return Promise.resolve();
	loadedChunks.add(chunkUrl);
	if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = chunkUrl;
		s.onload = resolve;
		s.onerror = () => {
			loadedChunks.delete(chunkUrl);
			reject(new Error(`Failed to load chunk: ${chunkUrl}`));
		};
		document.head.appendChild(s);
	});
}

function hasPendingChunks(nodes) {
	const urls = [];
	function walk(n) {
		if (n._chunk && !loadedChunks.has(n._chunk)) urls.push(n._chunk);
		if (n.children) n.children.forEach(walk);
	}
	nodes.forEach(walk);
	return urls;
}

function renderMatch(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		const notFoundFn = findNotFoundComponent(chain);
		if (notFoundFn) {
			const tempRoot = document.createDocumentFragment();
			const walker = createHydrateWalker(tempRoot, []);
			const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
			const nfDom = notFoundFn(nfProps, new Map(), walker);
			if (nfDom && typeof nfDom === 'object' && nfDom.nodeType) {
				if (container.replaceChildren) container.replaceChildren(nfDom);
				else { container.innerHTML = ''; container.appendChild(nfDom); }
			} else if (typeof nfDom === 'string') {
				container.innerHTML = nfDom;
			}
			return;
		}
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
			const result = pageNode.page(pageProps, new Map(), clientWalker);
			if (router && pageNode._pageName && result && result.nodeType === 1) {
				if (!router.__componentInstances) router.__componentInstances = new Map();
				const name = pageNode._pageName;
				if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
				router.__componentInstances.get(name).push({ root: result, props: pageProps, node: pageNode, type: 'page' });
			}
			return result;
		}
		const node = layoutNodes[index];
		const childDom = renderLayoutChain(index + 1);
		const layoutProps = { children: childDom, params: paramValues };
		const result = node.layout(layoutProps, new Map(), clientWalker);
		if (router && node._layoutName && result && result.nodeType === 1) {
			if (!router.__componentInstances) router.__componentInstances = new Map();
			const name = node._layoutName;
			if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
			router.__componentInstances.get(name).push({ root: result, props: layoutProps, node, type: 'layout' });
		}
		return result;
	}

	let rootDom;
	try {
		root(() => {
			rootDom = renderLayoutChain(0);
		});
	} catch (error) {
		if (error && error.name === 'NotFoundError') {
			const notFoundFn = findNotFoundComponent(chain);
			if (notFoundFn) {
				const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
				const nfDom = notFoundFn(nfProps, new Map(), clientWalker);
				if (nfDom && typeof nfDom === 'object' && nfDom.nodeType) {
					if (container.replaceChildren) container.replaceChildren(nfDom);
					else { container.innerHTML = ''; container.appendChild(nfDom); }
				} else if (typeof nfDom === 'string') {
					container.innerHTML = nfDom;
				}
				return;
			}
			container.innerHTML = '<h1>404 — Not Found</h1>';
			return;
		}
		const errorFn = findErrorComponent(chain);
		if (errorFn) {
			const retry = () => {
				if (router && router.navigate) {
					router.navigate(window.location.pathname, { replace: true });
				}
			};
			const errorProps = { error, retry, params: paramValues };
			const errorDom = errorFn(errorProps, new Map(), clientWalker);
			if (errorDom && typeof errorDom === 'object' && errorDom.nodeType) {
				if (container.replaceChildren) container.replaceChildren(errorDom);
				else { container.innerHTML = ''; container.appendChild(errorDom); }
			} else if (typeof errorDom === 'string') {
				container.innerHTML = errorDom;
			}
			return;
		}
		throw error;
	}

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

function hydrateInitial(router, match, container, strategy) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}
	if (!pageNode) {
		const notFoundFn = findNotFoundComponent(chain);
		if (notFoundFn) {
			const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
			const walker2 = createHydrateWalker(container);
			root(() => {
				notFoundFn(nfProps, new Map(), walker2);
			});
			return;
		}
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);

	_state.params.value = paramValues;
	_state.path.value = match.pathname || window.location.pathname;
	_state.search.value = window.location.search || '';

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
		if (!strategy || strategy === 'full') {
			const walker = createHydrateWalker(container);
			setIsHydrating(true);
			root(() => {
				hydPage({ params: paramValues, ...pageNode.props }, new Map(), walker);
			});
			setIsHydrating(false);
		} else if (strategy === 'viewport') {
			hydrateViewport(container, hydPage, { params: paramValues, ...pageNode.props });
		} else if (strategy === 'idle') {
			hydrateIdle(container, hydPage, { params: paramValues, ...pageNode.props });
		} else if (strategy === 'interaction') {
			hydrateOnInteraction(container, hydPage, { params: paramValues, ...pageNode.props });
		}
		return;
	}

	setIsHydrating(true);

	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			return (subWalker) => {
				if (!strategy || strategy === 'full') {
					hydPage({ params: paramValues, ...pageNode.props }, new Map(), subWalker);
				} else if (strategy === 'viewport') {
					hydrateViewport(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
				} else if (strategy === 'idle') {
					hydrateIdle(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
				} else if (strategy === 'interaction') {
					hydrateOnInteraction(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
				}
			};
		}
		const node = layoutNodes[index];
		const hydLayout = hydLayouts[index];
		const childHydrator = renderLayoutChain(index + 1);
		const layoutProps = { children: childHydrator, params: paramValues };
		hydLayout(layoutProps, new Map(), walker);
		return null;
	}

	const walker = createHydrateWalker(container);
	root(() => {
		renderLayoutChain(0);
	});

	setIsHydrating(false);
}

// ── Create Router (Manual) ─────────────────────────────────────

export function createRouter(
	routes,
	options = {}
) {
	const container = options.container || document.getElementById('root');
	const prefetch = options.prefetch !== false;
	const hydrateStrategy = options.hydrate || 'full';

	const routeTree = buildTreeFromMap(routes, options);

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			setCurrentRouter(this);

			if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
				window.history.scrollRestoration = 'manual';
			}
			if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
				let _scrollTimer = null;
				window.addEventListener('scroll', () => {
					if (_scrollTimer) return;
					_scrollTimer = setTimeout(() => {
						if (window.scrollY !== undefined) {
							_scrollPositions.set(window.location.pathname, window.scrollY);
						}
						_scrollTimer = null;
					}, 100);
				}, { passive: true });
			}

			document.addEventListener('click', (e) => {
				const link = e.target?.nodeType === 1 ? e.target.closest('a[href]') : null;
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				this.navigate(href);
			});

			window.addEventListener('popstate', () => {
				setIsPopStateNavigation(true);
				this.navigate(window.location.href, { replace: true });
			});

			if (prefetch) {
				document.addEventListener('mouseenter', (e) => {
					const link = e.target?.nodeType === 1 ? e.target.closest('a[href]') : null;
					if (link) this.prefetch(link.getAttribute('href'));
				}, { passive: true });
			}

			const path = window.location.pathname + window.location.search;
			if (container.children.length > 0) {
				const url = new URL(path, window.location.origin);
				const match = matchRoute(this.routeTree, url.pathname);
				if (match) {
					match.pathname = url.pathname;
					hydrateInitial(this, match, container, hydrateStrategy);
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

			if (!_isPopStateNavigation) {
				_scrollPositions.set(window.location.pathname, window.scrollY);
			}

			const loadingFn = findLoadingComponent(match.matchChain);

			const doRender = () => {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				_state.path.value = url.pathname;
				_state.search.value = url.search;
				renderMatch(this, match, this.container);
				this._currentMatch = match;
				handleScroll(url.pathname, opts.replace);
			};

			if (loadingFn) {
				showLoadingInContainer(this.container, loadingFn, match.params);
				Promise.resolve().then(() => doRender());
			} else {
				doRender();
			}
		},

		prefetch(path) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);
			if (!match) return;
			this._prefetched = this._prefetched || new Map();
			this._prefetched.set(url.pathname, match);
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			if (typeof this.__updateComponents === 'function') {
				this.__updateComponents(this.routeTree);
			}
			const instances = this.__componentInstances;
			if (instances && instances.size > 0) {
				let didUpdate = false;
				for (const [name, nameInstances] of instances) {
					if (updated.has(name)) {
						for (const inst of nameInstances) {
							try {
								const isPage = inst.type === 'page';
								const newFn = isPage ? inst.node.page : inst.node.layout;
								if (!newFn) continue;
								const walker = createHydrateWalker(document.createDocumentFragment(), []);
								let newDom;
								root(() => {
									newDom = newFn(inst.props, new Map(), walker);
								});
								if (newDom && newDom.nodeType === 1 && inst.root && inst.root.parentNode) {
									inst.root.parentNode.replaceChild(newDom, inst.root);
									inst.root = newDom;
									didUpdate = true;
								}
							} catch (e) {
								console.error('HMR update error:', e);
							}
						}
					}
				}
				if (!didUpdate) {
					const path = window.location.pathname + window.location.search;
					this.navigate(path, { replace: true });
				}
			} else {
				const path = window.location.pathname + window.location.search;
				this.navigate(path, { replace: true });
			}
		},
	};

	return router;
}

// ── Create File Router ─────────────────────────────────────────

export function createFileRouter(routeTree, options = {}) {
	const container = options.container || document.getElementById('root');
	const middleware = options.middleware || null;
	const renderFn = options.render || renderMatch;
	const hydrateStrategy = options.hydrate || 'full';

	const router = {
		_hydrateStrategy: hydrateStrategy,
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			setCurrentRouter(this);

			if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
				window.history.scrollRestoration = 'manual';
			}
			if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
				let _scrollTimer = null;
				const _onScroll = () => {
					if (_scrollTimer) return;
					_scrollTimer = setTimeout(() => {
						if (window.scrollY !== undefined) {
							_scrollPositions.set(window.location.pathname, window.scrollY);
						}
						_scrollTimer = null;
					}, 100);
				};
				window.addEventListener('scroll', _onScroll, { passive: true });
			}

			document.addEventListener('click', (e) => {
				const link = e.target?.nodeType === 1 ? e.target.closest('a[href]') : null;
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				router.navigate(href);
			});

			window.addEventListener('popstate', () => {
				setIsPopStateNavigation(true);
				router.navigate(window.location.pathname + window.location.search, { replace: true });
			});

			if (options.prefetch !== false) {
				document.addEventListener('mouseenter', (e) => {
					const link = e.target?.nodeType === 1 ? e.target.closest('a[href]') : null;
					if (link) router.prefetch(link.getAttribute('href'));
				}, { passive: true });
			}

			const path = window.location.pathname;
			if (container.children.length > 0) {
				const match = matchRoute(routeTree, path);
				if (match) {
					match.pathname = path;
					hydrateInitial(router, match, container, hydrateStrategy);
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
				const chain = flattenLayoutChain(routeTree, url.pathname.split('/').filter(Boolean));
				const notFoundFn = findNotFoundComponent(chain);
				if (notFoundFn) {
					const tempRoot = document.createDocumentFragment();
					const walker = createHydrateWalker(tempRoot, []);
					const nfProps = { params: {}, url: url.pathname };
					const nfDom = notFoundFn(nfProps, new Map(), walker);
					if (nfDom && typeof nfDom === 'object' && nfDom.nodeType) {
						if (container.replaceChildren) container.replaceChildren(nfDom);
						else { container.innerHTML = ''; container.appendChild(nfDom); }
					} else if (typeof nfDom === 'string') {
						container.innerHTML = nfDom;
					}
				} else {
					container.innerHTML = '<h1>404 — Not Found</h1>';
				}
				return;
			}

			match.pathname = url.pathname;

			if (!_isPopStateNavigation) {
				_scrollPositions.set(window.location.pathname, window.scrollY);
			}

			const loadingFn = findLoadingComponent(match.matchChain);

			const middlewareFns = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			const doRender = () => {
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
				handleScroll(url.pathname, opts.replace);
			};

			const pendingChunks = hasPendingChunks(match.matchChain);

			const doRenderWithChunks = pendingChunks.length > 0
				? () => Promise.all(pendingChunks.map(ensureChunk)).then(() => {
					if (typeof this.__updateComponents === 'function') {
						this.__updateComponents(match.matchChain);
					}
					doRender();
				})
				: () => { doRender(); };

			async function runMwChain(index) {
				if (index >= middlewareFns.length) {
					await doRenderWithChunks();
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

			if (middlewareFns.length > 0 || loadingFn) {
				if (loadingFn) {
					showLoadingInContainer(container, loadingFn, match.params);
				}
				Promise.resolve().then(() => {
					if (middlewareFns.length > 0) {
						runMwChain(0);
					} else {
						doRenderWithChunks();
					}
				});
			} else {
				doRenderWithChunks();
			}
		},

		prefetch(path) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) return;
			router._prefetched = router._prefetched || new Map();
			router._prefetched.set(url.pathname, match);
			// Preload code-split chunk for this route
			const preloadUrls = hasPendingChunks(match.matchChain);
			preloadUrls.forEach(ensureChunk);
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			if (typeof this.__updateComponents === 'function') {
				this.__updateComponents(this.routeTree);
			}
			const instances = this.__componentInstances;
			if (instances && instances.size > 0) {
				let didUpdate = false;
				for (const [name, nameInstances] of instances) {
					if (updated.has(name)) {
						for (const inst of nameInstances) {
							try {
								const isPage = inst.type === 'page';
								const newFn = isPage ? inst.node.page : inst.node.layout;
								if (!newFn) continue;
								const walker = createHydrateWalker(document.createDocumentFragment(), []);
								let newDom;
								root(() => {
									newDom = newFn(inst.props, new Map(), walker);
								});
								if (newDom && newDom.nodeType === 1 && inst.root && inst.root.parentNode) {
									inst.root.parentNode.replaceChild(newDom, inst.root);
									inst.root = newDom;
									didUpdate = true;
								}
							} catch (e) {
								console.error('HMR update error:', e);
							}
						}
					}
				}
				if (!didUpdate) {
					const path = window.location.pathname + window.location.search;
					this.navigate(path, { replace: true });
				}
			} else {
				const path = window.location.pathname + window.location.search;
				this.navigate(path, { replace: true });
			}
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
			loading: def.loading || null,
			error: def.error || null,
			notFound: def.notFound || null,
			children: (def.children || []).map(c => {
				const cParts = c.path.split('/').filter(Boolean);
				return {
					...c,
					path: cParts[cParts.length - 1] || '',
					fullPath: (def.path + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
					isDynamic: cParts.some(p => p.startsWith(':')),
					isCatchAll: cParts.some(p => p === '*'),
					isGroup: false,
					loading: null,
					error: null,
					notFound: null,
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
