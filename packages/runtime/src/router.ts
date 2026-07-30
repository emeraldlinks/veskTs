import { track, get, set } from './ripple-runtime';
import { root } from './ripple-blocks';
import { createHydrateWalker, hydrateViewport, hydrateIdle, hydrateOnInteraction } from './hydrate';
import type { HydrateWalker } from './hydrate';
import { matchRoute, flattenLayoutChain, buildTreeFromMap } from './router-match';
import type { RouteNode, RouteMatch } from './router-match';
import {
	__isHydrating, setIsHydrating, _state, _scrollPositions,
	_isPopStateNavigation, setIsPopStateNavigation, setCurrentRouter,
	showLoadingInContainer, handleScroll, findLoadingComponent,
	findErrorComponent, findNotFoundComponent, RouterCtx, getCurrentRouter,
	Outlet, Link, NavLink, useNavigate, useParams, usePathname,
	useSearchParams, useRouter, Redirect, redirect, permanentRedirect,
	NotFoundError, notFound,
} from './router-components';

export {
	Outlet, Link, NavLink,
	useNavigate, useParams, usePathname, useSearchParams, useRouter,
	Redirect, redirect, permanentRedirect, NotFoundError, notFound,
};

interface RouterInstance {
	routeTree: RouteNode[];
	container: HTMLElement;
	_currentMatch: RouteMatch | null;
	_outletPlaceholders: HTMLElement[];
	_currentSegments: { rendered: Node }[] | null;
	_depth: number;
	start(): RouterInstance;
	navigate(path: string, opts?: { replace?: boolean }): Promise<void> | void;
	prefetch(path: string): void;
	readonly currentPath: string;
	hmrUpdate(): void;
	__hydrators?: Record<string, Function>;
	__componentInstances?: Map<string, { root: Element; props: Record<string, unknown>; node: RouteNode; type: string }[]>;
	__updateComponents?: (tree: RouteNode[] | RouteMatch['matchChain']) => void;
	_prefetched?: Map<string, RouteMatch>;
	[k: string]: unknown;
}

interface RouterOptions {
	container?: HTMLElement;
	prefetch?: boolean;
	hydrate?: 'full' | 'viewport' | 'idle' | 'interaction';
	[k: string]: unknown;
}

const loadedChunks = new Set<string>();

function ensureChunk(chunkUrl: string): Promise<void> {
	if (!chunkUrl || loadedChunks.has(chunkUrl)) return Promise.resolve();
	loadedChunks.add(chunkUrl);
	if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = chunkUrl;
		s.onload = () => resolve();
		s.onerror = () => {
			loadedChunks.delete(chunkUrl);
			reject(new Error(`Failed to load chunk: ${chunkUrl}`));
		};
		document.head.appendChild(s);
	});
}

function hasPendingChunks(nodes: RouteNode[]): string[] {
	const urls: string[] = [];
	function walk(n: RouteNode) {
		if (n._chunk && !loadedChunks.has(n._chunk as string)) urls.push(n._chunk as string);
		if (n.children) n.children.forEach(walk);
	}
	nodes.forEach(walk);
	return urls;
}

function renderMatch(router: RouterInstance, match: RouteMatch, container: HTMLElement): void {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode: RouteNode | null = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
		if (notFoundFn) {
			const tempRoot = document.createDocumentFragment();
			const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
			const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
			const nfDom = notFoundFn(nfProps, new Map(), walker);
			if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
				if (container.replaceChildren) container.replaceChildren(nfDom as Node);
				else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
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
	const clientWalker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);

	function renderLayoutChain(index: number): Node | string | undefined {
		if (index >= layoutNodes.length) {
			set(_state.params, paramValues);
			set(_state.path, match.pathname || window.location.pathname);
			set(_state.search, window.location.search || '');
			const pageProps = { params: paramValues, ...(pageNode!.props as Record<string, unknown>) };
			const result = pageNode!.page!(pageProps, new Map(), clientWalker) as Node | string | undefined;
			if (router && pageNode!._pageName && result && (result as Node).nodeType === 1) {
				if (!router.__componentInstances) router.__componentInstances = new Map();
				const name = pageNode!._pageName as string;
				if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
				router.__componentInstances.get(name)!.push({ root: result as Element, props: pageProps as Record<string, unknown>, node: pageNode!, type: 'page' });
			}
			return result;
		}
		const node = layoutNodes[index]!;
		const childDom = renderLayoutChain(index + 1);
		const layoutProps = { children: childDom, params: paramValues };
		const result = node.layout!(layoutProps, new Map(), clientWalker) as Node | string | undefined;
		if (router && node._layoutName && result && (result as Node).nodeType === 1) {
			if (!router.__componentInstances) router.__componentInstances = new Map();
			const name = node._layoutName as string;
			if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
			router.__componentInstances.get(name)!.push({ root: result as Element, props: layoutProps as Record<string, unknown>, node, type: 'layout' });
		}
		return result;
	}

	let rootDom: Node | string | undefined;
	try {
		root(() => {
			rootDom = renderLayoutChain(0);
		});
	} catch (error: unknown) {
		if (error && (error as Error).name === 'NotFoundError') {
			const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
			if (notFoundFn) {
				const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
				const nfDom = notFoundFn(nfProps, new Map(), clientWalker);
				if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
					if (container.replaceChildren) container.replaceChildren(nfDom as Node);
					else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
				} else if (typeof nfDom === 'string') {
					container.innerHTML = nfDom;
				}
				return;
			}
			container.innerHTML = '<h1>404 — Not Found</h1>';
			return;
		}
		const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
		if (errorFn) {
			const retry = () => {
				if (router && router.navigate) {
					router.navigate(window.location.pathname, { replace: true });
				}
			};
			const errorProps = { error, retry, params: paramValues };
			const errorDom = errorFn(errorProps, new Map(), clientWalker);
			if (errorDom && typeof errorDom === 'object' && (errorDom as Node).nodeType) {
				if (container.replaceChildren) container.replaceChildren(errorDom as Node);
				else { container.innerHTML = ''; container.appendChild(errorDom as Node); }
			} else if (typeof errorDom === 'string') {
				container.innerHTML = errorDom;
			}
			return;
		}
		throw error;
	}

	if (rootDom && typeof rootDom === 'object' && (rootDom as Node).nodeType) {
		if (container.replaceChildren) {
			container.replaceChildren(rootDom as Node);
		} else {
			container.innerHTML = '';
			container.appendChild(rootDom as Node);
		}
	} else if (typeof rootDom === 'string') {
		container.innerHTML = rootDom;
	}
}

function hydrateInitial(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
	strategy: string,
): void {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode: RouteNode | null = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}
	if (!pageNode) {
		const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
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

	set(_state.params, paramValues);
	set(_state.path, match.pathname || window.location.pathname);
	set(_state.search, window.location.search || '');

	const hydrators = router.__hydrators;
	const hydPage: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown = hydrators && pageNode._pageName
		? (hydrators[pageNode._pageName as string] || pageNode.page)! as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown
		: pageNode.page! as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown;
	const hydLayouts = layoutNodes.map(n => {
		if (hydrators && n._layoutName) {
			return hydrators[n._layoutName as string] || n.layout;
		}
		return n.layout;
	});

	if (layoutNodes.length === 0) {
		if (!strategy || strategy === 'full') {
			const walker = createHydrateWalker(container);
			setIsHydrating(true);
			root(() => {
				hydPage({ params: paramValues, ...(pageNode!.props as Record<string, unknown>) }, new Map(), walker);
			});
			setIsHydrating(false);
		} else if (strategy === 'viewport') {
			hydrateViewport(container, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
		} else if (strategy === 'idle') {
			hydrateIdle(container, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
		} else if (strategy === 'interaction') {
			hydrateOnInteraction(container, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
		}
		return;
	}

	setIsHydrating(true);

	function renderLayoutChain(index: number) {
		if (index >= layoutNodes.length) {
			return (subWalker: HydrateWalker) => {
				if (!strategy || strategy === 'full') {
					hydPage({ params: paramValues, ...(pageNode!.props as Record<string, unknown>) }, new Map(), subWalker);
				} else if (strategy === 'viewport') {
					hydrateViewport(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				} else if (strategy === 'idle') {
					hydrateIdle(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				} else if (strategy === 'interaction') {
					hydrateOnInteraction(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				}
			};
		}
		const node = layoutNodes[index]!;
		const hydLayout = hydLayouts[index]!;
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

export function createRouter(
	routes: RouteNode[] | Record<string, Function>,
	options: RouterOptions = {},
): RouterInstance {
	const container = options.container || document.getElementById('root')!;
	const prefetch = options.prefetch !== false;
	const hydrateStrategy = options.hydrate || 'full';

	const routeTree = Array.isArray(routes) ? routes as RouteNode[] : buildTreeFromMap(routes as Record<string, Function>, options);

	const router: RouterInstance = {
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
				let _scrollTimer: ReturnType<typeof setTimeout> | null = null;
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
				const link = (e.target as Element)?.nodeType === 1 ? (e.target as Element).closest('a[href]') : null;
				if (!link) return;
				if ((link as HTMLAnchorElement).hostname && (link as HTMLAnchorElement).hostname !== window.location.hostname) return;
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
					const link = (e.target as Element)?.nodeType === 1 ? (e.target as Element).closest('a[href]') : null;
					if (link) this.prefetch(link.getAttribute('href')!);
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

		navigate(path: string, opts = {}) {
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

			const loadingFn = findLoadingComponent(match.matchChain as Record<string, unknown>[]);

			const doRender = () => {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				set(_state.path, url.pathname);
				set(_state.search, url.search);
				renderMatch(this, match!, this.container);
				this._currentMatch = match!;
				handleScroll(url.pathname, opts.replace);
			};

			if (loadingFn) {
				showLoadingInContainer(this.container, loadingFn, match.params);
				Promise.resolve().then(() => doRender());
			} else {
				doRender();
			}
		},

		prefetch(path: string) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);
			if (!match) return;
			this._prefetched = this._prefetched || new Map();
			this._prefetched.set(url.pathname, match);
		},

		get currentPath() {
			return get(_state.path) as string;
		},

		hmrUpdate() {
			const updated = (globalThis as Record<string, unknown>).__updatedComponents as Set<string> | undefined;
			if (!updated || updated.size === 0) return;
			(globalThis as Record<string, unknown>).__updatedComponents = new Set();
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
								const walker = createHydrateWalker(document.createDocumentFragment() as unknown as HTMLElement, []);
								let newDom: unknown;
								root(() => {
									newDom = newFn!(inst.props, new Map(), walker);
								});
								if (newDom && (newDom as Node).nodeType === 1 && inst.root && inst.root.parentNode) {
									inst.root.parentNode.replaceChild(newDom as Node, inst.root);
									inst.root = newDom as Element;
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

interface FileRouterOptions extends RouterOptions {
	middleware?: Function | Function[];
	render?: (router: RouterInstance, match: RouteMatch, container: HTMLElement) => void;
}

interface FileRouterInstance extends RouterInstance {
	_hydrateStrategy: string;
	[k: string]: unknown;
}

export function createFileRouter(routeTree: RouteNode[], options: FileRouterOptions = {}): FileRouterInstance {
	const container = options.container || document.getElementById('root')!;
	const middleware = options.middleware || null;
	const renderFn = options.render || renderMatch;
	const hydrateStrategy = options.hydrate || 'full';

	const router: FileRouterInstance = {
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
				let _scrollTimer: ReturnType<typeof setTimeout> | null = null;
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

			window.addEventListener('popstate', () => {
				setIsPopStateNavigation(true);
				router.navigate(window.location.pathname + window.location.search, { replace: true });
			});

			if (options.prefetch !== false) {
				document.addEventListener('mouseenter', (e) => {
					const link = (e.target as Element)?.nodeType === 1 ? (e.target as Element).closest('a[href]') : null;
					if (link) router.prefetch(link.getAttribute('href')!);
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

		navigate(pathname: string, opts = {}) {
			const url = (pathname as unknown) instanceof URL ? (pathname as unknown as URL) : new URL(pathname, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) {
				const chain = flattenLayoutChain(routeTree, url.pathname.split('/').filter(Boolean));
				const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
				if (notFoundFn) {
					const tempRoot = document.createDocumentFragment();
					const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
					const nfProps = { params: {}, url: url.pathname };
					const nfDom = notFoundFn(nfProps, new Map(), walker);
					if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
						if (container.replaceChildren) container.replaceChildren(nfDom as Node);
						else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
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

			const loadingFn = findLoadingComponent(match.matchChain as Record<string, unknown>[]);

			const middlewareFns: Function[] = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			const doRender = () => {
				const fullUrl = url.pathname + url.search;
				if (!opts.replace) {
					window.history.pushState({ path: fullUrl }, '', fullUrl);
				} else {
					window.history.replaceState({ path: fullUrl }, '', fullUrl);
				}
				set(_state.path, url.pathname);
				set(_state.search, url.search);
				renderFn(router, match!, container);
				router._currentMatch = match!;
				handleScroll(url.pathname, opts.replace);
			};

			const pendingChunks = hasPendingChunks(match.matchChain);

			const doRenderWithChunks = pendingChunks.length > 0
				? () => Promise.all(pendingChunks.map(ensureChunk)).then(() => {
					if (typeof router.__updateComponents === 'function') {
						router.__updateComponents(match!.matchChain);
					}
					doRender();
				})
				: (() => { doRender(); }) as (() => Promise<void>) | (() => void);

			async function runMwChain(index: number): Promise<void> {
				if (index >= middlewareFns.length) {
					await (doRenderWithChunks as () => Promise<void>)();
					return;
				}

				const fn = middlewareFns[index];
				const ctx = { url: url.pathname, params: match!.params, router, locals: {} };

				async function next(rewrite?: string) {
					if (rewrite) {
						match!.pathname = rewrite;
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
				} catch (e: unknown) {
					if (e && (e as Error).name === 'Redirect') {
						router.navigate((e as Redirect).url, { replace: true });
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
						(doRenderWithChunks as () => void)();
					}
				});
			} else {
				(doRenderWithChunks as () => void)();
			}
		},

		prefetch(path: string) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) return;
			router._prefetched = router._prefetched || new Map();
			router._prefetched.set(url.pathname, match);
			const preloadUrls = hasPendingChunks(match.matchChain);
			preloadUrls.forEach(ensureChunk);
		},

		get currentPath() {
			return get(_state.path) as string;
		},

		hmrUpdate() {
			const updated = (globalThis as Record<string, unknown>).__updatedComponents as Set<string> | undefined;
			if (!updated || updated.size === 0) return;
			(globalThis as Record<string, unknown>).__updatedComponents = new Set();
			if (typeof router.__updateComponents === 'function') {
				router.__updateComponents(router.routeTree);
			}
			const instances = router.__componentInstances;
			if (instances && instances.size > 0) {
				let didUpdate = false;
				for (const [name, nameInstances] of instances) {
					if (updated.has(name)) {
						for (const inst of nameInstances) {
							try {
								const isPage = inst.type === 'page';
								const newFn = isPage ? inst.node.page : inst.node.layout;
								if (!newFn) continue;
								const walker = createHydrateWalker(document.createDocumentFragment() as unknown as HTMLElement, []);
								let newDom: unknown;
								root(() => {
									newDom = newFn!(inst.props, new Map(), walker);
								});
								if (newDom && (newDom as Node).nodeType === 1 && inst.root && inst.root.parentNode) {
									inst.root.parentNode.replaceChild(newDom as Node, inst.root);
									inst.root = newDom as Element;
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
					router.navigate(path, { replace: true });
				}
			} else {
				const path = window.location.pathname + window.location.search;
				router.navigate(path, { replace: true });
			}
		},
	};

	return router;
}

export function defineRoute(path: string, config: Record<string, unknown>): RouteNode {
	return { path, ...config } as unknown as RouteNode;
}

export function buildRouteTree(definitions: RouteNode[]): RouteNode[] {
	const tree: RouteNode[] = [];
	for (const def of definitions) {
		const parts = (def.path || '').split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p === '*');

		const node: RouteNode = {
			path: parts[parts.length - 1] || '',
			fullPath: def.fullPath || def.path,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: def.page || null,
			layout: def.layout || null,
			loading: def.loading || null,
			error: def.error || null,
			notFound: def.notFound || null,
			children: ((def.children || []) as RouteNode[]).map(c => {
				const cParts = (c.path || '').split('/').filter(Boolean);
				return {
					...c,
					path: cParts[cParts.length - 1] || '',
					fullPath: ((def.path || '') + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
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
