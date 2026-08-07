import { track, get, set, scope, set_active_block } from '@vesk/runtime/src/ripple-runtime';
import { root } from '@vesk/runtime/src/ripple-blocks';
import { createHydrateWalker, hydrateViewport, hydrateIdle, hydrateOnInteraction } from '@vesk/runtime/src/hydrate';
import type { HydrateWalker } from '@vesk/runtime/src/hydrate';
import { matchRoute, flattenLayoutChain, buildTreeFromMap } from '@vesk/runtime/src/router-match';
import type { RouteNode, RouteMatch } from '@vesk/runtime/src/router-match';
import {
	__isHydrating, setIsHydrating, _state, _scrollPositions,
	_isPopStateNavigation, setIsPopStateNavigation, setCurrentRouter,
	showLoadingInContainer, handleScroll, applyHead, findLoadingComponent,
	findErrorComponent, findNotFoundComponent, RouterCtx, getCurrentRouter,
	Outlet, Link, NavLink, useNavigate, useParams, usePathname,
	useSearchParams, useRouter, Redirect, redirect, permanentRedirect,
	NotFoundError, notFound,
} from '@vesk/runtime/src/router-components';

export {
	Outlet, Link, NavLink,
	useNavigate, useParams, usePathname, useSearchParams, useRouter,
	Redirect, redirect, permanentRedirect, NotFoundError, notFound,
	ensureChunk,
};

export { matchRoute } from '@vesk/runtime/src/router-match';

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
	_navToken?: number;
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

interface RouteDataResult {
	props?: Record<string, unknown>;
	head?: string;
	notFound?: boolean;
	redirect?: string;
}

const _dataPromises = new Map<string, Promise<RouteDataResult | null>>();

async function fetchRouteData(path: string): Promise<RouteDataResult | null> {
	try {
		const res = await fetch(path, { headers: { 'X-Vesk-Data': '1' }, credentials: 'same-origin' });
		if (res.redirected && res.url) {
			const finalUrl = new URL(res.url);
			const requested = new URL(path, window.location.origin);
			if (finalUrl.pathname !== requested.pathname || finalUrl.search !== requested.search) {
				return { redirect: finalUrl.pathname + finalUrl.search };
			}
		}
		if (res.status === 404) return { notFound: true };
		if (!res.ok) return null;
		const ct = res.headers.get('content-type') || '';
		if (!ct.includes('application/json')) return null;
		return (await res.json()) as RouteDataResult;
	} catch {
		return null;
	}
}

function getRouteData(path: string): Promise<RouteDataResult | null> {
	const key = path;
	const existing = _dataPromises.get(key);
	if (existing) return existing;
	const p = fetchRouteData(key).finally(() => { _dataPromises.delete(key); });
	_dataPromises.set(key, p);
	return p;
}

function findPageNode(match: RouteMatch): RouteNode | null {
	const chain = match.matchChain;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) return chain[i];
	}
	return null;
}

async function renderNotFound(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
): Promise<void> {
	const chain = match.matchChain;
	const paramValues = match.params;
	const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
	if (notFoundFn) {
		const tempRoot = document.createDocumentFragment();
		const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
		const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
		const nfDom = await runInBlockWindow(() => notFoundFn(nfProps, new Map(), walker));
		if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
			if (container.replaceChildren) container.replaceChildren(nfDom as Node);
			else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
		} else if (typeof nfDom === 'string') {
			container.innerHTML = nfDom;
		}
		return;
	}
	if (container.replaceChildren) container.replaceChildren();
	else container.innerHTML = '';
	container.innerHTML = '<h1>404 — Not Found</h1>';
	router._currentMatch = match;
}

async function applyRouteData(
	router: RouterInstance,
	match: RouteMatch,
	data: RouteDataResult,
	container: HTMLElement,
	render: (router: RouterInstance, match: RouteMatch, container: HTMLElement) => Promise<void> | void = renderMatch,
): Promise<void> {
	if (data.notFound) {
		await renderNotFound(router, match, container);
		return;
	}
	const pathname = match.pathname || window.location.pathname;
	const pageNode = findPageNode(match);
	if (pageNode && data.props) {
		pageNode.props = data.props;
		pageNode._dataPath = pathname;
	}
	if (data.head) {
		applyHead(data.head);
		if (pageNode) pageNode._head = data.head;
	}
	const hasRealProps = data.props
		? Object.keys(data.props as Record<string, unknown>).some(k => k !== 'params')
		: false;
	if (!hasRealProps) {
		// Head-only/params-only payload: the page is already rendered by the
		// initial renderMatch. Cache the fresh marker (_dataPath) so revisits
		// skip the fetch, but don't re-render — an async page's pending render
		// continuation could otherwise land after a later navigation and
		// clobber the newly mounted DOM.
		router._currentMatch = match;
		return;
	}
	let swapped = false;
	try {
		const fresh = await renderPageOnly(router, match);
		if (fresh !== undefined) {
			swapped = replacePageContent(container, fresh);
		}
	} catch {
		swapped = false;
	}
	if (!swapped) {
		await render(router, match, container);
	}
	router._currentMatch = match;
}

function shouldFetchData(router: RouterInstance, match: RouteMatch): boolean {
	const pageNode = findPageNode(match);
	if (!pageNode) return false;
	const pathname = match.pathname || window.location.pathname;
	return (pageNode._dataPath as string | undefined) !== pathname;
}

function hasRealPageData(data: RouteDataResult): boolean {
	if (data.notFound || data.redirect) return true;
	if (data.head && data.head.trim().length > 0) return true;
	const props = data.props as Record<string, unknown> | undefined;
	if (!props) return false;
	return Object.keys(props).some(k => k !== 'params');
}

function storePrefetchedData(match: RouteMatch, data: RouteDataResult): void {
	if (!data || data.notFound || data.redirect) return;
	const pathname = match.pathname || window.location.pathname;
	const pageNode = findPageNode(match);
	if (pageNode && data.props) {
		pageNode.props = data.props;
		pageNode._dataPath = pathname;
	}
	if (data.head && pageNode) pageNode._head = data.head;
}

const PAGE_START_MARKER = 'vesk:page';
const PAGE_END_MARKER = '/vesk:page';

function wrapPageContent(result: Node | string | undefined): Node {
	const frag = document.createDocumentFragment();
	frag.appendChild(document.createComment(PAGE_START_MARKER));
	if (result && typeof result === 'object' && (result as Node).nodeType) {
		frag.appendChild(result as Node);
	} else if (typeof result === 'string') {
		frag.appendChild(document.createTextNode(result));
	}
	frag.appendChild(document.createComment(PAGE_END_MARKER));
	return frag;
}

async function renderPageOnly(router: RouterInstance, match: RouteMatch): Promise<Node | string | undefined> {
	const pageNode = findPageNode(match);
	if (!pageNode || !pageNode.page) return undefined;
	const tempRoot = document.createDocumentFragment();
	const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
	const pageProps = { params: match.params, ...(pageNode.props as Record<string, unknown>) };
	const result = await runInBlockWindow(() => pageNode!.page!(pageProps, new Map(), walker) as Node | string | undefined);
	if (result && (result as Node).nodeType === 1 && pageNode._pageName && router.__componentInstances) {
		const list = router.__componentInstances.get(pageNode._pageName as string);
		if (list && list.length > 0) list[list.length - 1].root = result as Element;
	}
	return result;
}

/**
 * Runs a render call with an active root block that stays active across
 * `await` suspensions. Async components suspend at `await useFetch(...)` and
 * resume in a microtask continuation; without a persistent active block every
 * `track()`/`effect()` created after the await would be orphaned (a null owner
 * block) and its updates silently dropped by `schedule_update`.
 *
 * Fully synchronous renders return synchronously (so `navigate()` keeps its
 * synchronous behavior for plain pages); only thenable results suspend.
 */
function runInBlockWindow<T>(fn: () => T): T | Promise<T> {
	const previous = scope();
	const block = root(() => {});
	set_active_block(block);
	let result: T;
	try {
		result = fn();
	} catch (error) {
		set_active_block(previous);
		throw error;
	}
	if (result && typeof (result as { then?: unknown }).then === 'function') {
		return (result as unknown as Promise<T>).then(
			(value) => { set_active_block(previous); return value; },
			(error) => { set_active_block(previous); throw error; },
		);
	}
	set_active_block(previous);
	return result;
}

function replacePageContent(container: HTMLElement, newContent: Node | string | undefined): boolean {
	if (newContent === undefined || newContent === null) return false;
	let start: Node | null = null;
	let end: Node | null = null;
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
	while (walker.nextNode()) {
		const n = walker.currentNode;
		if (!start && n.nodeValue === PAGE_START_MARKER) start = n;
		else if (start && n.nodeValue === PAGE_END_MARKER) { end = n; break; }
	}
	if (!start || !end || !end.parentNode) return false;
	let cur = start.nextSibling;
	while (cur && cur !== end) {
		const next = cur.nextSibling;
		cur.remove();
		cur = next;
	}
	if (typeof newContent === 'string') {
		end.parentNode.insertBefore(document.createTextNode(newContent), end);
	} else {
		end.parentNode.insertBefore(newContent, end);
	}
	return true;
}

function renderMatch(router: RouterInstance, match: RouteMatch, container: HTMLElement): void | Promise<void> {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode: RouteNode | null = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	const mountNotFound = (nfDom: unknown): void => {
		if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
			if (container.replaceChildren) container.replaceChildren(nfDom as Node);
			else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
		} else if (typeof nfDom === 'string') {
			container.innerHTML = nfDom;
		}
	};

	if (!pageNode) {
		const notFoundFn = findNotFoundComponent(chain as Record<string, unknown>[]);
		if (notFoundFn) {
			const tempRoot = document.createDocumentFragment();
			const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
			const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
			const nfDom = runInBlockWindow(() => notFoundFn(nfProps, new Map(), walker));
			if (nfDom && typeof (nfDom as { then?: unknown }).then === 'function') {
				return (nfDom as Promise<unknown>).then(mountNotFound);
			}
			mountNotFound(nfDom);
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

	// Renders the layout+page chain. Returns the DOM node synchronously when
	// every component is synchronous; returns a Promise when any component
	// suspends (async page / `await useFetch`). Sync throws propagate to the
	// caller so `navigate()` keeps throwing synchronously for plain pages.
	function renderLayoutChain(index: number): unknown {
		if (index >= layoutNodes.length) {
			set(_state.params, paramValues);
			set(_state.path, match.pathname || window.location.pathname);
			set(_state.search, window.location.search || '');
			const pageProps = { params: paramValues, ...(pageNode!.props as Record<string, unknown>) };
			const result = pageNode!.page!(pageProps, new Map(), clientWalker) as unknown;
			if (result && typeof (result as { then?: unknown }).then === 'function') {
				return (result as Promise<unknown>).then((res) => {
					storePageInstance(router, pageNode!, pageProps, res);
					return wrapPageContent(res as Node | string | undefined);
				});
			}
			storePageInstance(router, pageNode!, pageProps, result);
			return wrapPageContent(result as Node | string | undefined);
		}
		const node = layoutNodes[index]!;
		const childDom = renderLayoutChain(index + 1);
		if (childDom && typeof (childDom as { then?: unknown }).then === 'function') {
			return (childDom as Promise<unknown>).then((resolved) => {
				const layoutProps = { children: resolved, params: paramValues };
				const result = node.layout!(layoutProps, new Map(), clientWalker) as unknown;
				if (result && typeof (result as { then?: unknown }).then === 'function') {
					return (result as Promise<unknown>).then((res) => {
						storeLayoutInstance(router, node, layoutProps, res);
						return res;
					});
				}
				storeLayoutInstance(router, node, layoutProps, result);
				return result;
			});
		}
		const layoutProps = { children: childDom, params: paramValues };
		const result = node.layout!(layoutProps, new Map(), clientWalker) as unknown;
		if (result && typeof (result as { then?: unknown }).then === 'function') {
			return (result as Promise<unknown>).then((res) => {
				storeLayoutInstance(router, node, layoutProps, res);
				return res;
			});
		}
		storeLayoutInstance(router, node, layoutProps, result);
		return result;
	}

	function storePageInstance(router: RouterInstance, pageNode: RouteNode, pageProps: Record<string, unknown>, result: unknown): void {
		if (!router || !pageNode._pageName || !result || (result as Node).nodeType !== 1) return;
		if (!router.__componentInstances) router.__componentInstances = new Map();
		const name = pageNode._pageName as string;
		if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
		router.__componentInstances.get(name)!.push({ root: result as Element, props: pageProps as Record<string, unknown>, node: pageNode, type: 'page' });
	}

	function storeLayoutInstance(router: RouterInstance, node: RouteNode, layoutProps: Record<string, unknown>, result: unknown): void {
		if (!router || !node._layoutName || !result || (result as Node).nodeType !== 1) return;
		if (!router.__componentInstances) router.__componentInstances = new Map();
		const name = node._layoutName as string;
		if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
		router.__componentInstances.get(name)!.push({ root: result as Element, props: layoutProps as Record<string, unknown>, node, type: 'layout' });
	}

	const mountDom = (dom: unknown): void => {
		if (dom && typeof dom === 'object' && (dom as Node).nodeType) {
			if (container.replaceChildren) container.replaceChildren(dom as Node);
			else { container.innerHTML = ''; container.appendChild(dom as Node); }
		} else if (typeof dom === 'string') {
			container.innerHTML = dom;
		}
	};

	let rootDom: unknown;
	try {
		rootDom = runInBlockWindow(() => renderLayoutChain(0));
	} catch (error: unknown) {
		if (error && (error as Error).name === 'NotFoundError') {
			return renderNotFound(router, match, container);
		}
		const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
		if (errorFn) {
			const retry = () => {
				if (router && router.navigate) {
					router.navigate(window.location.pathname, { replace: true });
				}
			};
			const errorProps = { error, retry, params: paramValues };
			mountDom(runInBlockWindow(() => errorFn(errorProps, new Map(), clientWalker)));
			return;
		}
		throw error;
	}
	if (rootDom && typeof (rootDom as { then?: unknown }).then === 'function') {
		return (rootDom as Promise<unknown>).then(
			(resolved) => { mountDom(resolved); },
			(error: unknown) => {
				if (error && (error as Error).name === 'NotFoundError') {
					return renderNotFound(router, match, container);
				}
				const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
				if (errorFn) {
					const retry = () => {
						if (router && router.navigate) {
							router.navigate(window.location.pathname, { replace: true });
						}
					};
					const errorProps = { error, retry, params: paramValues };
					const errDom = runInBlockWindow(() => errorFn(errorProps, new Map(), clientWalker));
					if (errDom && typeof (errDom as { then?: unknown }).then === 'function') {
						return (errDom as Promise<unknown>).then(mountDom);
					}
					mountDom(errDom);
					return;
				}
				throw error;
			},
		);
	}
	mountDom(rootDom);
}

async function hydrateInitial(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
	strategy: string,
): Promise<void> {
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
		const pageProps = { params: paramValues, ...(pageNode!.props as Record<string, unknown>) };
		if (!strategy || strategy === 'full') {
			const walker = createHydrateWalker(container);
			setIsHydrating(true);
			await runInBlockWindow(() => hydPage(pageProps, new Map(), walker));
			setIsHydrating(false);
		} else if (strategy === 'viewport') {
			root(() => { hydrateViewport(container, hydPage, pageProps); });
		} else if (strategy === 'idle') {
			root(() => { hydrateIdle(container, hydPage, pageProps); });
		} else if (strategy === 'interaction') {
			root(() => { hydrateOnInteraction(container, hydPage, pageProps); });
		}
		return;
	}

	setIsHydrating(true);

	// Keep the hydration chain synchronous so every track()/effect() created by
	// the layout and page hydrators runs inside the active block below. Unlike a
	// bare root() block, runInBlockWindow keeps that block active across `await`
	// suspensions, so an async page resuming from `await useFetch(...)` still
	// attaches its track()/effect() blocks to the root instead of orphaning them
	// (orphaned effects never flush — async pages would hydrate with empty lists).
	function renderLayoutChain(index: number): unknown {
		if (index >= layoutNodes.length) {
			return (subWalker: HydrateWalker) => {
				if (!strategy || strategy === 'full') {
					return hydPage({ params: paramValues, ...(pageNode!.props as Record<string, unknown>) }, new Map(), subWalker);
				} else if (strategy === 'viewport') {
					hydrateViewport(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				} else if (strategy === 'idle') {
					hydrateIdle(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				} else if (strategy === 'interaction') {
					hydrateOnInteraction(subWalker.root!, hydPage, { params: paramValues, ...(pageNode!.props as Record<string, unknown>) });
				}
				return undefined;
			};
		}
		const node = layoutNodes[index]!;
		const hydLayout = hydLayouts[index]!;
		const childHydrator = renderLayoutChain(index + 1);
		const layoutProps = { children: childHydrator, params: paramValues };
		return hydLayout(layoutProps, new Map(), walker);
	}

	const walker = createHydrateWalker(container);
	await runInBlockWindow(() => renderLayoutChain(0));
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
			this._navToken = (this._navToken || 0) + 1;
			const navToken = this._navToken;

			let firstRenderFailed = false;

			const doRender = () => {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				set(_state.path, url.pathname);
				set(_state.search, url.search);
				try {
					renderMatch(this, match!, this.container);
				} catch (e) {
					firstRenderFailed = true;
					throw e;
				}
				this._currentMatch = match!;
				handleScroll(url.pathname, opts.replace);
			};

			const fetchData = () => {
				if (firstRenderFailed) return;
				if (!shouldFetchData(this, match!)) return;
			getRouteData(url.pathname + url.search).then(async (data) => {
				if (navToken !== this._navToken) return;
				if (!data) return;
				if (data.redirect) {
					this.navigate(data.redirect, { replace: true });
					return;
				}
				if (!hasRealPageData(data)) return;
				await applyRouteData(this, match!, data, this.container);
			});
			};

			if (loadingFn) {
				showLoadingInContainer(this.container, loadingFn, match.params);
				Promise.resolve().then(() => { try { doRender(); } finally { fetchData(); } });
			} else {
				try { doRender(); } finally { fetchData(); }
			}
		},

		prefetch(path: string) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);
			if (!match) return;
			match.pathname = url.pathname;
			this._prefetched = this._prefetched || new Map();
			this._prefetched.set(url.pathname, match);
			if (typeof document === 'undefined') return;
			getRouteData(url.pathname + url.search).then((data) => {
				if (data) storePrefetchedData(match!, data);
			});
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
					void (async () => {
						const tempRoot = document.createDocumentFragment();
						const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
						const nfProps = { params: {}, url: url.pathname };
						const nfDom = await runInBlockWindow(() => notFoundFn(nfProps, new Map(), walker));
						if (nfDom && typeof nfDom === 'object' && (nfDom as Node).nodeType) {
							if (container.replaceChildren) container.replaceChildren(nfDom as Node);
							else { container.innerHTML = ''; container.appendChild(nfDom as Node); }
						} else if (typeof nfDom === 'string') {
							container.innerHTML = nfDom;
						}
					})();
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
			router._navToken = (router._navToken || 0) + 1;
			const navToken = router._navToken;

			const middlewareFns: Function[] = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			let firstRenderFailed = false;

			const doRender = () => {
				const fullUrl = url.pathname + url.search;
				if (!opts.replace) {
					window.history.pushState({ path: fullUrl }, '', fullUrl);
				} else {
					window.history.replaceState({ path: fullUrl }, '', fullUrl);
				}
				set(_state.path, url.pathname);
				set(_state.search, url.search);
				try {
					renderFn(router, match!, container);
				} catch (e) {
					firstRenderFailed = true;
					throw e;
				}
				router._currentMatch = match!;
				handleScroll(url.pathname, opts.replace);
			};

			const fetchData = () => {
				if (firstRenderFailed) return;
				if (!shouldFetchData(router, match!)) return;
				getRouteData(url.pathname + url.search).then(async (data) => {
					if (navToken !== router._navToken) return;
					if (!data) return;
					if (data.redirect) {
						router.navigate(data.redirect, { replace: true });
						return;
					}
					if (!hasRealPageData(data)) return;
					const pending = hasPendingChunks(match!.matchChain);
					if (pending.length > 0) {
						await Promise.all(pending.map(ensureChunk));
						if (navToken !== router._navToken) return;
						if (typeof router.__updateComponents === 'function') {
							router.__updateComponents(match!.matchChain);
						}
					}
					await applyRouteData(router, match!, data, container, renderFn);
				});
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
					try {
						if (middlewareFns.length > 0) {
							runMwChain(0);
						} else {
							(doRenderWithChunks as () => void)();
						}
					} finally {
						fetchData();
					}
				});
			} else {
				try { (doRenderWithChunks as () => void)(); } finally { fetchData(); }
			}
		},

		prefetch(path: string) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) return;
			match.pathname = url.pathname;
			router._prefetched = router._prefetched || new Map();
			router._prefetched.set(url.pathname, match);
			const preloadUrls = hasPendingChunks(match.matchChain);
			preloadUrls.forEach(ensureChunk);
			if (typeof document === 'undefined') return;
			getRouteData(url.pathname + url.search).then((data) => {
				if (data) storePrefetchedData(match!, data);
			});
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
