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
	findErrorComponent, findNotFoundComponent, findOfflineComponent,
	findNetworkComponent, RouterCtx, getCurrentRouter,
	Outlet, Link, NavLink, useNavigate, useParams, usePathname,
	useSearchParams, useRouter, Redirect, redirect, permanentRedirect,
	NotFoundError, notFound,
} from '@vesk/runtime/src/router-components';
import { getNetworkState, watchNetwork } from '@vesk/runtime/src/network';
import { loadingStart, loadingFinish, getLoadingState } from '@vesk/runtime/src/loading-indicator';

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
	/** True while an SPA navigation is in flight (shared with LoadingIndicator). */
	readonly isLoading: boolean;
	/** Registers a navigation guard (programmatic/Link navigations only — the
	 * browser's own back/forward cannot be blocked). Return `false` to block
	 * or a path to redirect. Returns an unsubscribe function. */
	beforeEach(fn: (to: string, from: string) => false | string | void | Promise<false | string | void>): () => void;
	go(n: number): void;
	readonly route: { pathname: string; params: Record<string, string>; pattern: string } | null;
	_beforeGuards?: GuardFn[];
	_viewTransitions?: boolean;
	_guardDepth?: number;
	_runGuards(to: string): false | string | void | Promise<false | string | void>;
	hmrUpdate(): void;
	__hydrators?: Record<string, Function>;
	__componentInstances?: Map<string, { root: Element; props: Record<string, unknown>; node: RouteNode; type: string }[]>;
	__updateComponents?: (tree: RouteNode[] | RouteMatch['matchChain']) => void;
	_prefetched?: Map<string, RouteMatch>;
	_navToken?: number;
	/** Client route-data freshness TTL (ms). 0 = always fetch fresh data. */
	_routeDataCache?: number;
	[k: string]: unknown;
}

interface RouterOptions {
	container?: HTMLElement;
	prefetch?: boolean;
	/** Wrap SPA DOM swaps in document.startViewTransition when supported. Default false. */
	viewTransitions?: boolean;
	hydrate?: 'full' | 'viewport' | 'idle' | 'interaction';
	/** Route-data freshness TTL in ms. Default 0 = always refetch on SPA nav. */
	routeDataCache?: number;
	/**
	 * Offline experience for SPA navigations that fail due to loss of
	 * connectivity: a component `(props, registry, walker) => Node | string`
	 * receiving `{ url, params, retry }`, or a raw HTML string. When omitted,
	 * a built-in default panel with automatic recovery is shown. Network
	 * failures never render the not-found page.
	 */
	offline?: Function | string;
	[k: string]: unknown;
}

const loadedChunks = new Set<string>();
const failedChunks = new Map<string, Error>();

function chunkLoadError(chunkUrl: string): Error | undefined {
	return failedChunks.get(chunkUrl);
}

function ensureChunk(chunkUrl: string): Promise<void> {
	if (!chunkUrl || loadedChunks.has(chunkUrl)) return Promise.resolve();
	loadedChunks.add(chunkUrl);
	if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = chunkUrl;
		s.onload = () => {
			failedChunks.delete(chunkUrl);
			resolve();
		};
		s.onerror = () => {
			loadedChunks.delete(chunkUrl);
			const err = new Error(`Failed to load chunk: ${chunkUrl}`);
			failedChunks.set(chunkUrl, err);
			reject(err);
		};
		document.head.appendChild(s);
	});
}

/** Loads pending chunks without letting a single failed chunk abort the flow. */
function loadChunksQuietly(urls: string[]): Promise<void> {
	navDebug('loadChunks start', urls);
	return Promise.all(urls.map((u) => ensureChunk(u).catch(() => undefined))).then(() => {
		navDebug('loadChunks done', urls);
	});
}

// Set window.__veskNavDebug = [] in the page to capture router breadcrumbs.
function navDebug(...parts: unknown[]): void {
	if (typeof window === 'undefined') return;
	const log = (window as unknown as { __veskNavDebug?: unknown[] }).__veskNavDebug;
	if (log) log.push(parts.map(p => Array.isArray(p) ? p.join(',') : String(p)).join(' '));
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
	error?: string;
	statusCode?: number;
	/** True when the request failed because the client has no network. */
	offline?: boolean;
}

/**
 * Classifies a data-fetch failure as a connectivity problem rather than a
 * server problem: fetch rejects with TypeError on network failure, and
 * `navigator.onLine === false` confirms it even where the error shape is
 * environment-specific.
 */
function isConnectivityFailure(err: unknown): boolean {
	if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
	return err instanceof TypeError;
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
		const ct = res.headers.get('content-type') || '';
		if (!res.ok) {
			// The server's x-vesk-data error payload is `{ error: message }`.
			// Surface it so the route's error component can render instead of
			// silently falling back to an HTML fetch.
			if (ct.includes('application/json')) {
				try {
					const body = await res.json() as Record<string, unknown>;
					if (body && typeof body === 'object' && typeof body.error === 'string') {
						return { error: body.error, statusCode: res.status };
					}
				} catch {
					/* fall through to null */
				}
			}
			return null;
		}
		if (!ct.includes('application/json')) return null;
		return (await res.json()) as RouteDataResult;
	} catch (err) {
		if (isConnectivityFailure(err)) return { offline: true };
		// Passive signals can miss (proxies, emulation) — actively probe
		// before classifying as a plain failure.
		if (await looksOffline()) return { offline: true };
		return null;
	}
}

function getRouteData(path: string, scope?: string): Promise<RouteDataResult | null> {
	const key = scope === undefined ? path : path + '\u0000' + scope;
	const existing = _dataPromises.get(key);
	if (existing) return existing;
	const p = fetchRouteData(path).finally(() => { _dataPromises.delete(key); });
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

/**
 * A route whose component chunk failed to load (or failed to compile) must
 * surface as an error page for that route only — never as a 404, and never
 * as a thrown exception that breaks the rest of the app.
 */
function findPageNodeOrFailed(match: RouteMatch): RouteNode | null {
	const chain = match.matchChain;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page || chain[i]._pageName) return chain[i];
	}
	return null;
}

function chunkErrorForNode(node: RouteNode | null): Error | undefined {
	if (!node) return undefined;
	if (node._chunk) {
		const err = chunkLoadError(node._chunk as string);
		if (err) return err;
	}
	if (node._chunkError) return new Error(String(node._chunkError));
	return undefined;
}

/**
 * Active connectivity check for failure paths where passive signals
 * (`navigator.onLine`) are unreliable (proxies, CDP emulation, some
 * browsers lag the flag). Any HTTP response — even 404/500 — proves the
 * origin is reachable; only a fetch-level rejection counts as offline.
 */
async function looksOffline(): Promise<boolean> {
	if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
	if (typeof fetch !== 'function') return false;
	try {
		await fetch('/__vesk_connectivity_' + Date.now(), { method: 'HEAD', cache: 'no-store' });
		return false;
	} catch (err) {
		return err instanceof TypeError;
	}
}

async function renderNotFound(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
): Promise<void> {
	clearOfflineFlag(router, container);
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

type OfflineEntry = Function | string;

function defaultOfflineHtml(url: string): string {
	return '<div data-vesk-offline style="all:initial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;font-family:system-ui,-apple-system,sans-serif;color:#1f2937;text-align:center;padding:24px">' +
		'<div style="font-size:40px;line-height:1;margin-bottom:16px" aria-hidden="true">📡</div>' +
		'<h1 style="font-size:22px;font-weight:700;margin:0 0 8px">You\u2019re offline</h1>' +
		'<p style="margin:0 0 20px;color:#6b7280;max-width:34em">Check your connection. <span style="color:#9ca3af">' + escapeOfflineUrl(url) + '</span> will load automatically once you\u2019re back online.</p>' +
		'<button type="button" data-vesk-offline-retry style="all:unset;cursor:pointer;background:#2563eb;color:#fff;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600">Retry now</button>' +
	'</div>';
}

function escapeOfflineUrl(url: string): string {
	return String(url).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Renders the connectivity experience for a navigation that failed due to
 * loss of (or degraded) network. Precedence:
 *   1. nearest route `offline.vsk` — dedicated offline UI (when offline)
 *   2. nearest route `network.vsk` — state-aware UI receiving
 *      `{ url, params, retry, online, effectiveType, downlink, rtt, saveData }`
 *   3. router `offline` option (component or HTML string)
 *   4. nearest route `error.vsk`, invoked with an `offline: true` error so
 *      existing error boundaries can style the offline case themselves
 *   5. built-in default panel
 *
 * A network failure never renders the not-found page. While a boundary from
 * steps 1–3 or 5 is displayed it re-renders on connectivity changes
 * (3g→4g→offline…), and the router re-navigates automatically when the
 * browser comes back online.
 */
async function renderOfflinePage(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
): Promise<void> {
	const url = match.pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
	const chain = match.matchChain as unknown as Record<string, unknown>[];
	const navTokenAtRender = (router as RouterInstance & { _navToken?: number })._navToken;

	// Debounced retry: a component that calls retry() while rendering must
	// not trigger a navigate→fail→render→retry microtask loop.
	const safeRetry = () => {
		const r = router as RouterInstance & { _lastOfflineRetry?: number };
		const now = Date.now();
		if (now - (r._lastOfflineRetry || 0) < 300) return;
		r._lastOfflineRetry = now;
		router.navigate(url, { replace: true });
	};

	const mountComponent = async (entry: Function | string): Promise<boolean> => {
		if (typeof entry === 'string') {
			container.innerHTML = entry;
			return true;
		}
		const tempRoot = document.createDocumentFragment();
		const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
		const props = { url, params: match.params, retry: safeRetry, ...getNetworkState() };
		const dom = await runInBlockWindow(() => entry(props, new Map(), walker));
		if (dom && typeof dom === 'object' && (dom as Node).nodeType) {
			if (container.replaceChildren) container.replaceChildren(dom as Node);
			else { container.innerHTML = ''; container.appendChild(dom as Node); }
			return true;
		}
		if (typeof dom === 'string') {
			container.innerHTML = dom;
			return true;
		}
		return false;
	};

	let mounted = false;
	let reactive = false; // re-render on connectivity change

	const offlineEntry = findOfflineComponent(chain);
	if (!mounted && offlineEntry && !(getNetworkState().online)) {
		mounted = await mountComponent(offlineEntry as Function | string);
		reactive = mounted;
	}

	const networkEntry = findNetworkComponent(chain);
	if (!mounted && networkEntry) {
		mounted = await mountComponent(networkEntry as Function | string);
		reactive = mounted;
	}

	const optionUI = router._offlineUI as OfflineEntry | undefined;
	if (!mounted && optionUI !== undefined && optionUI !== null) {
		mounted = typeof optionUI === 'function'
			? await mountComponent(optionUI)
			: ((container.innerHTML = String(optionUI)), true);
		reactive = typeof optionUI === 'function';
	}

	const errorFn = findErrorComponent(chain);
	if (!mounted && errorFn) {
		// Existing error boundary opts in via `props.offline` /
		// `props.networkState`.
		const err = new Error('You are offline');
		(err as Error & { statusCode?: number }).statusCode = 0;
		(err as Error & { offline?: boolean }).offline = true;
		await renderErrorPage(router, match, container, err);
		mounted = true;
	}

	if (!mounted) {
		container.innerHTML = defaultOfflineHtml(url);
		const retryBtn = (container.querySelector ? container.querySelector('[data-vesk-offline-retry]') : null) as HTMLElement | null;
		if (retryBtn) retryBtn.addEventListener('click', safeRetry);
		reactive = true;
	}

	(router as RouterInstance & { _showingOffline?: boolean })._showingOffline = true;
	registerOnlineRecovery(router);

	// Live-swap the displayed boundary when connectivity changes (e.g.
	// offline → 3g → 4g), but stop as soon as a newer navigation takes over.
	if (reactive && typeof window !== 'undefined') {
		(container as HTMLElement & { __veskNetworkUI?: boolean }).__veskNetworkUI = true;
		const unsubscribe = watchNetwork(() => {
			const stillCurrent =
				(router as RouterInstance & { _navToken?: number })._navToken === navTokenAtRender &&
				(container as HTMLElement & { __veskNetworkUI?: boolean }).__veskNetworkUI === true &&
				(router as RouterInstance & { _showingOffline?: boolean })._showingOffline === true;
			if (!stillCurrent) {
				unsubscribe();
				return;
			}
			void renderOfflinePage(router, match, container);
		});
	}
}

function registerOnlineRecovery(router: RouterInstance): void {
	const r = router as RouterInstance & { _onlineHandler?: EventListener };
	if (r._onlineHandler || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
	r._onlineHandler = () => {
		if (!r._showingOffline) return;
		r._showingOffline = false;
		router.navigate(window.location.pathname + window.location.search, { replace: true });
	};
	window.addEventListener('online', r._onlineHandler);
}

async function applyRouteData(
	router: RouterInstance,
	match: RouteMatch,
	data: RouteDataResult,
	container: HTMLElement,
	render: (router: RouterInstance, match: RouteMatch, container: HTMLElement) => Promise<void> | void = renderMatch,
): Promise<void> {
	if (data.offline) {
		await renderOfflinePage(router, match, container);
		return;
	}
	if (data.notFound) {
		await renderNotFound(router, match, container);
		return;
	}
	if (data.error) {
		const err = new Error(data.error);
		(err as Error & { statusCode?: number }).statusCode = data.statusCode || 500;
		await renderErrorPage(router, match, container, err);
		router._currentMatch = match;
		return;
	}
	const pathname = match.pathname || window.location.pathname;
	const pageNode = findPageNodeOrFailed(match);
	if (pageNode && data.props) {
		pageNode.props = data.props;
		pageNode._dataPath = pathname;
		pageNode._dataFetchedAt = Date.now();
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
	// Use findPageNodeOrFailed: on lazy/chunked routes the page component is
	// wired only after its chunk finishes loading, but the route node exists
	// from the start (via _pageName). Requiring an already-loaded `.page`
	// (findPageNode) makes shouldFetchData return false for a first visit to a
	// chunked route — fetchData runs before the chunk resolves — silently
	// dropping the X-Vesk-Data fetch for that visit.
	const pageNode = findPageNodeOrFailed(match);
	if (!pageNode) return false;
	const pathname = match.pathname || window.location.pathname;
	if ((pageNode._dataPath as string | undefined) !== pathname) return true;
	const ttl = (router._routeDataCache as number | undefined) ?? 0;
	if (ttl <= 0) return true;
	const fetchedAt = (pageNode._dataFetchedAt as number | undefined) ?? 0;
	return Date.now() - fetchedAt >= ttl;
}

function hasRealPageData(data: RouteDataResult): boolean {
	if (data.offline || data.notFound || data.redirect || data.error) return true;
	if (data.head && data.head.trim().length > 0) return true;
	const props = data.props as Record<string, unknown> | undefined;
	if (!props) return false;
	return Object.keys(props).some(k => k !== 'params');
}

function storePrefetchedData(match: RouteMatch, data: RouteDataResult): void {
	if (!data || data.notFound || data.redirect) return;
	const pathname = match.pathname || window.location.pathname;
	const pageNode = findPageNodeOrFailed(match);
	if (pageNode && data.props) {
		pageNode.props = data.props;
		pageNode._dataPath = pathname;
		pageNode._dataFetchedAt = Date.now();
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
	const pageNode = findPageNodeOrFailed(match);
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

function renderMatch(router: RouterInstance, match: RouteMatch, container: HTMLElement, navToken?: number): void | Promise<void> {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode: RouteNode | null = findPageNodeOrFailed(match);

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

	// The route matched and has a page name, but its component chunk failed
	// to load or compile (or its component ref is still an unwired name).
	// While offline that is a connectivity problem, not a broken route —
	// show the offline experience instead of an error page. The connectivity
	// probe only runs when a chunk actually failed or the browser reports
	// offline, so ordinary lazy-loading never pays for it.
	if (pageNode._pageName && (!pageNode.page || typeof pageNode.page === 'string')) {
		const suspectOffline = failedChunks.has(pageNode._chunk as string)
			|| (typeof navigator !== 'undefined' && !!navigator && navigator.onLine === false);
		navDebug('unresolved page guard', String(pageNode._pageName), 'suspect=', String(suspectOffline));
		if (!suspectOffline) {
			const chunkErr0 = chunkErrorForNode(pageNode);
			return renderErrorPage(
				router,
				match,
				container,
				chunkErr0 || new Error(`Component "${pageNode._pageName}" is unavailable`),
			);
		}
		return looksOffline().then((offline) => {
			if (offline) return renderOfflinePage(router, match, container);
			const chunkErr = chunkErrorForNode(pageNode);
			return renderErrorPage(
				router,
				match,
				container,
				chunkErr || new Error(`Component "${pageNode._pageName}" is unavailable`),
			);
		});
	}

	const layoutNodes = chain.filter(n => n.layout);
	const tempRoot = document.createDocumentFragment();
	const clientWalker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);

	// Renders the layout+page chain. Returns the DOM node synchronously when
	// every component is synchronous; returns a Promise when any component
	// suspends (async page / `await useFetch`). Sync throws propagate to the
	// caller so `navigate()` keeps throwing synchronously for plain pages.
	function renderLayoutChain(index: number): unknown {
		return renderLayoutWith(index, pageStep);
	}

	// Renders the chain of `layoutNodes` from `index` down, calling `renderPage`
	// at the innermost step. The real page step and the error step (see
	// `renderErrorInLayout`) both go through here so an error page keeps the
	// layout/nav instead of replacing the whole container.
	function renderLayoutWith(index: number, renderPage: () => unknown): unknown {
		if (index >= layoutNodes.length) {
			return renderPage();
		}
		const node = layoutNodes[index]!;
		const childDom = renderLayoutWith(index + 1, renderPage);
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

	// The real page step: sets router state and invokes the page component.
	const pageStep = (): unknown => {
		set(_state.params, paramValues);
		set(_state.path, match.pathname || window.location.pathname);
		{
			const s = window.location.search || '';
			set(_state.search, s.startsWith('?') ? s.slice(1) : s);
		}
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
	};

	// Renders the route's error component inside the layout chain so the error
	// page keeps the site nav. Throws when no error component exists.
	function renderErrorInLayout(error: unknown): unknown {
		const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
		if (!errorFn) throw error;
		const retry = () => {
			if (router && router.navigate) {
				router.navigate(window.location.pathname, { replace: true });
			}
		};
		const errorProps = { error, retry, params: paramValues, statusCode: (error as Error & { statusCode?: number })?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== 'undefined' ? window.location.pathname : '', offline: (error as Error & { offline?: boolean })?.offline === true, networkState: getNetworkState() };
		return runInBlockWindow(() => renderLayoutWith(0, () => {
			const result = errorFn(errorProps, new Map(), clientWalker) as unknown;
			if (result && typeof (result as { then?: unknown }).then === 'function') {
				return (result as Promise<unknown>).then((res) => wrapPageContent(res as Node | string | undefined));
			}
			return wrapPageContent(result as Node | string | undefined);
		}));
	}

	// Renders the error component into the container directly (used only when
	// re-rendering through the layout also throws, e.g. the layout is the
	// component that failed).
	function mountStandaloneError(error: unknown): void {
		const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
		if (!errorFn) throw error;
		const retry = () => {
			if (router && router.navigate) {
				router.navigate(window.location.pathname, { replace: true });
			}
		};
		const errorProps = { error, retry, params: paramValues, statusCode: (error as Error & { statusCode?: number })?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== 'undefined' ? window.location.pathname : '', offline: (error as Error & { offline?: boolean })?.offline === true, networkState: getNetworkState() };
		const errDom = runInBlockWindow(() => errorFn(errorProps, new Map(), clientWalker));
		if (errDom && typeof (errDom as { then?: unknown }).then === 'function') {
			(errDom as Promise<unknown>).then(mountDom);
		} else {
			mountDom(errDom);
		}
	}


	const mountDom = (dom: unknown): void => {
		// Staleness guard: a suspended (async) page whose render resolves after
		// a NEWER navigation must not clobber the newer page's DOM. The file
		// router stamps the container with the latest nav token per navigation.
		if (
			navToken !== undefined &&
			(container as HTMLElement & { __veskMountToken?: number }).__veskMountToken !== navToken
		) {
			return;
		}
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
		let errDom: unknown;
		try {
			errDom = renderErrorInLayout(error);
		} catch (err2: unknown) {
			mountStandaloneError(err2);
			return;
		}
		if (errDom && typeof (errDom as { then?: unknown }).then === 'function') {
			return (errDom as Promise<unknown>).then(mountDom, (e: unknown) => { mountStandaloneError(e); });
		}
		mountDom(errDom);
		return;
	}
	if (rootDom && typeof (rootDom as { then?: unknown }).then === 'function') {
		return (rootDom as Promise<unknown>).then(
			(resolved) => { mountDom(resolved); },
			(error: unknown) => {
				if (error && (error as Error).name === 'NotFoundError') {
					return renderNotFound(router, match, container);
				}
				return Promise.resolve(renderErrorInLayout(error)).then(
					mountDom,
					(e: unknown) => { mountStandaloneError(e); },
				);
			},
		);
	}
	mountDom(rootDom);
}

// Constructs the error object used when the server already rendered an error
// page for this route (the DOM carries the `vesk-ssr-error` marker). The
// marker optionally carries the URI-encoded server error message so the
// client-side error boundary can render the real reason instead of a generic
// one.
function makeSsrError(message?: string): Error {
	const e = new Error(message || 'Internal Server Error');
	(e as Error & { statusCode?: number }).statusCode = 500;
	return e;
}

// Client-side render of the route's error component (used after a hydration
// failure or when the SSR output is already an error page). The error
// component renders in place of the page inside the layout chain so the error
// page keeps the site nav.
function clearOfflineFlag(router: RouterInstance, container?: HTMLElement): void {
	(router as RouterInstance & { _showingOffline?: boolean })._showingOffline = false;
	if (container) (container as HTMLElement & { __veskNetworkUI?: boolean }).__veskNetworkUI = false;
}

async function renderErrorPage(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
	error: unknown,
): Promise<void> {
	clearOfflineFlag(router, container);
	const chain = match.matchChain;
	const paramValues = match.params;
	const errorFn = findErrorComponent(chain as Record<string, unknown>[]);
	if (!errorFn) {
		if (container.replaceChildren) container.replaceChildren();
		else container.innerHTML = '';
		container.innerHTML = '<h1>500 — Internal Server Error</h1>';
		return;
	}
	const layoutNodes = chain.filter(n => n.layout);
	const tempRoot = document.createDocumentFragment();
	const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
	const retry = () => {
		if (router && router.navigate) {
			router.navigate(window.location.pathname, { replace: true });
		}
	};
	const errorProps = { error, retry, params: paramValues, statusCode: (error as Error & { statusCode?: number })?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== 'undefined' ? window.location.pathname : '', offline: (error as Error & { offline?: boolean })?.offline === true, networkState: getNetworkState() };

	const renderErrorChain = (index: number): unknown => {
		if (index >= layoutNodes.length) {
			const result = errorFn(errorProps, new Map(), walker) as unknown;
			if (result && typeof (result as { then?: unknown }).then === 'function') {
				return (result as Promise<unknown>).then((res) => wrapPageContent(res as Node | string | undefined));
			}
			return wrapPageContent(result as Node | string | undefined);
		}
		const node = layoutNodes[index]!;
		const childDom = renderErrorChain(index + 1);
		if (childDom && typeof (childDom as { then?: unknown }).then === 'function') {
			return (childDom as Promise<unknown>).then((resolved) => {
				const layoutProps = { children: resolved, params: paramValues };
				const result = node.layout!(layoutProps, new Map(), walker) as unknown;
				if (result && typeof (result as { then?: unknown }).then === 'function') {
					return (result as Promise<unknown>).then((res) => res);
				}
				return result;
			});
		}
		const layoutProps = { children: childDom, params: paramValues };
		const result = node.layout!(layoutProps, new Map(), walker) as unknown;
		if (result && typeof (result as { then?: unknown }).then === 'function') {
			return (result as Promise<unknown>).then((res) => res);
		}
		return result;
	};

	const dom = await runInBlockWindow(() => renderErrorChain(0));
	if (dom && typeof dom === 'object' && (dom as Node).nodeType) {
		if (container.replaceChildren) container.replaceChildren(dom as Node);
		else { container.innerHTML = ''; container.appendChild(dom as Node); }
	} else if (typeof dom === 'string') {
		container.innerHTML = dom;
	}
}

async function hydrateInitial(
	router: RouterInstance,
	match: RouteMatch,
	container: HTMLElement,
	strategy: string,
): Promise<void> {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode: RouteNode | null = findPageNodeOrFailed(match);
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

	// When SSR rendered an error page for this route (the page component threw
	// on the server) the DOM holds error-component markup, not page markup.
	// Rendering the error component client-side instead of hydrating the page
	// against mismatched markers keeps the initial load from exploding.
	const ssrErrorMarker = ((): string | null => {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
		while (walker.nextNode()) {
			const v = walker.currentNode.nodeValue;
			if (v && v.startsWith('vesk-ssr-error')) {
				return v.slice('vesk-ssr-error'.length);
			}
		}
		return null;
	})();
	set(_state.params, paramValues);
	set(_state.path, match.pathname || window.location.pathname);
	{
		const s = window.location.search || '';
		set(_state.search, s.startsWith('?') ? s.slice(1) : s);
	}
	if (ssrErrorMarker !== null) {
		let message = 'Internal Server Error';
		if (ssrErrorMarker.startsWith(':')) {
			try {
				message = decodeURIComponent(ssrErrorMarker.slice(1));
			} catch {
				// malformed payload — keep the generic message
			}
		}
		await renderErrorPage(router, match, container, makeSsrError(message));
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);

	const hydrators = router.__hydrators;
	if (!pageNode.page && !(hydrators && pageNode._pageName && hydrators[pageNode._pageName as string])) {
		// The route's component chunk failed to load or compile. While
		// offline that is a connectivity problem — show the offline
		// experience; otherwise render the error boundary for this route.
		if (await looksOffline()) {
			await renderOfflinePage(router, match, container);
			return;
		}
		const chunkErr = chunkErrorForNode(pageNode);
		await renderErrorPage(
			router,
			match,
			container,
			chunkErr || new Error(`Component "${pageNode._pageName}" is unavailable`),
		);
		return;
	}

	const hydPage: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown = hydrators && pageNode._pageName
		? (hydrators[pageNode._pageName as string] || pageNode.page)! as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown
		: pageNode.page! as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown;
	const hydLayouts = layoutNodes.map(n => {
		if (hydrators && n._layoutName) {
			return hydrators[n._layoutName as string] || n.layout;
		}
		return n.layout;
	});

	try {
		if (layoutNodes.length === 0) {
			const pageProps = { params: paramValues, ...(pageNode!.props as Record<string, unknown>) };
			if (!strategy || strategy === 'full') {
				const walker = createHydrateWalker(container);
				setIsHydrating(true);
				await runInBlockWindow(() => {
					const result = hydPage(pageProps, new Map(), walker);
					storePageInstance(router, pageNode!, pageProps, result);
				});
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
						const pageProps = { params: paramValues, ...(pageNode!.props as Record<string, unknown>) };
						const result = hydPage(pageProps, new Map(), subWalker);
						storePageInstance(router, pageNode!, pageProps, result);
						return result;
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
			const result = hydLayout(layoutProps, new Map(), walker);
			storeLayoutInstance(router, node, layoutProps, result);
			return result;
		}

		const walker = createHydrateWalker(container);
		await runInBlockWindow(() => renderLayoutChain(0));
		setIsHydrating(false);
	} catch (error: unknown) {
		setIsHydrating(false);
		// Hydration failed — most often the page component throwing on the
		// client after a clean SSR. Re-render through renderMatch so the error
		// component replaces just the page slot and the layout/nav survives.
		if (error && (error as Error).name === 'NotFoundError') {
			await renderNotFound(router, match, container);
			return;
		}
		try {
			await renderMatch(router, match, container);
		} catch (err2: unknown) {
			await renderErrorPage(router, match, container, err2);
		}
	}
}

function scrollToHash(): void {
	const h = typeof window !== 'undefined' ? window.location.hash : '';
	if (!h || h === '#') return;
	const id = h.slice(1);
	setTimeout(() => {
		try {
			const el = document.getElementById(id);
			if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		} catch { /* element may not exist */ }
	}, 80);
}

type GuardDecision = false | string | void | Promise<false | string | void>;
type GuardFn = (to: string, from: string) => false | string | void | Promise<false | string | void>;

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
		_routeDataCache: options.routeDataCache ?? 0,
		_offlineUI: (options.offline ?? null) as OfflineEntry | null,
		_beforeGuards: [],
		_viewTransitions: options.viewTransitions === true,

		beforeEach(fn: GuardFn): () => void {
			(this._beforeGuards as GuardFn[]).push(fn);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				const guards = this._beforeGuards as GuardFn[];
				const i = guards.indexOf(fn);
				if (i > -1) guards.splice(i, 1);
			};
		},

		_runGuards(to: string): false | string | void | Promise<false | string | void> {
			const from = window.location.pathname;
			for (const g of (this._beforeGuards as GuardFn[]) ?? []) {
				const d = g(to, from);
				if (d instanceof Promise) {
					return d.then((r) => {
						if (r === false || typeof r === 'string') return r;
					});
				}
				if (d === false || typeof d === 'string') return d;
			}
		},

		go(n: number) {
			window.history.go(n);
		},

		get route() {
			const m = this._currentMatch as RouteMatch | null;
			if (!m) return null;
			const chain = m.matchChain ?? [];
			const deepest = chain[chain.length - 1] as RouteNode | undefined;
			return {
				pathname: m.pathname || '',
				params: m.params,
				pattern: deepest?.fullPath || '/',
			};
		},

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

			// Navigation policy: SPA navigation happens through <Link>/
			// <NavLink>/navigate() and opt-in plain anchors
			// `<a href="..." no-reload>`. Plain <a href> without `no-reload`
			// (or `data-no-reload`) always does native browser navigation.
			// `no-reload` anchors are intercepted via a delegated document
			// click listener that respects modifier keys, target="_blank",
			// download, external origins, hash/mailto/tel schemes.

			window.addEventListener('popstate', () => {
				setIsPopStateNavigation(true);
				this.navigate(window.location.href, { replace: true });
			});

			document.addEventListener('click', (e) => {
				const target = e.target as Element | null;
				if (!target || target.nodeType !== 1) return;
				const anchor = (target as Element).closest('a[href]') as HTMLAnchorElement | null;
				if (!anchor) return;
				if (!anchor.hasAttribute('no-reload') && !anchor.hasAttribute('data-no-reload')) return;
				if ((e as MouseEvent).defaultPrevented) return;
				const me = e as MouseEvent;
				if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
				if (anchor.target === '_blank') return;
				if (anchor.hasAttribute('download')) return;
				if (anchor.getAttribute('rel') === 'external') return;
				const href = anchor.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
				try {
					const url = new URL(href, window.location.origin);
					if (url.origin !== window.location.origin) return;
				} catch { return; }
				e.preventDefault();
				e.stopPropagation();
				this.navigate(href);
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

			// Navigation guards (programmatic/Link navigations only).
			const self = this as RouterInstance;
			const guardResult = self._runGuards(url.pathname);
			const proceedNav = () => {
				if (!_isPopStateNavigation) {
					_scrollPositions.set(window.location.pathname, window.scrollY);
				}

				const loadingFn = findLoadingComponent(match.matchChain as Record<string, unknown>[]);
				this._navToken = (this._navToken || 0) + 1;
				const navToken = this._navToken;
				loadingStart();

				let firstRenderFailed = false;

				const updateUrl = () => {
					if (!opts.replace) {
						window.history.pushState({ path: url.pathname }, '', url.pathname + url.search);
					} else {
						window.history.replaceState({ path: url.pathname }, '', url.pathname + url.search);
					}
					set(_state.path, url.pathname);
					set(_state.search, url.search.startsWith('?') ? url.search.slice(1) : url.search);
				};

				const renderContent = () => {
					try {
						renderMatch(this, match!, this.container);
					} catch (e) {
						firstRenderFailed = true;
						throw e;
					}
					this._currentMatch = match!;
					clearOfflineFlag(this, container);
					handleScroll(url.pathname, opts.replace);
				};

				const swapView = (fn: () => void | Promise<void>) => {
					const d = document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => unknown };
					if ((this as RouterInstance)._viewTransitions && typeof d.startViewTransition === 'function') d.startViewTransition(fn);
					else fn();
				};

				const doRender = () => {
					updateUrl();
					swapView(() => renderContent());
					scrollToHash();
				};

				const fetchData = () => {
					if (firstRenderFailed) return;
					if (!shouldFetchData(this, match!)) { loadingFinish(); scrollToHash(); return; }
				getRouteData(url.pathname + url.search, 'nav' + navToken).then(async (data) => {
					if (navToken !== this._navToken) return;
					if (!data) { loadingFinish(); return; }
					if (data.redirect) {
						loadingFinish();
						this.navigate(data.redirect, { replace: true });
						return;
					}
					if (!hasRealPageData(data)) { loadingFinish(); scrollToHash(); return; }
					await swapView(() => applyRouteData(this, match!, data, this.container));
					scrollToHash();
					loadingFinish({ error: !!data.error });
				}).catch(() => loadingFinish({ error: true }));
				};

				if (loadingFn) {
					showLoadingInContainer(this.container, loadingFn, match.params);
					Promise.resolve().then(() => { try { doRender(); } finally { fetchData(); } });
				} else {
					try { doRender(); } finally { fetchData(); }
				}
			};

			// If guards return a Promise, chain the rest asynchronously.
			// If sync (the common case), the navigation completes synchronously,
			// preserving backward compatibility with callers that don't await.
			if (guardResult instanceof Promise) {
				return guardResult.then((decision) => {
					if (decision === false) return;
					if (typeof decision === 'string' && decision !== url.pathname && (self._guardDepth ?? 0) < 5) {
						self._guardDepth = (self._guardDepth ?? 0) + 1;
						try { self.navigate(decision, { replace: true }); }
						finally { self._guardDepth = 0; }
						return;
					}
					proceedNav();
				});
			}
			if (guardResult === false) return;
			if (typeof guardResult === 'string' && guardResult !== url.pathname && (self._guardDepth ?? 0) < 5) {
				self._guardDepth = (self._guardDepth ?? 0) + 1;
				try { self.navigate(guardResult, { replace: true }); }
				finally { self._guardDepth = 0; }
				return;
			}
			proceedNav();
		},

		prefetch(path: string) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);
			if (!match) return;
			match.pathname = url.pathname;
			this._prefetched = this._prefetched || new Map();
			this._prefetched.set(url.pathname, match);
			if (typeof document === 'undefined') return;
			getRouteData(url.pathname + url.search, 'prefetch').then((data) => {
				if (data) storePrefetchedData(match!, data);
			});
		},

		get currentPath() {
			return get(_state.path) as string;
		},

		get isLoading() {
			const cells = getLoadingState();
			return Boolean(get(cells.isLoading));
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
		_routeDataCache: options.routeDataCache ?? 0,
		_offlineUI: (options.offline ?? null) as OfflineEntry | null,
		_beforeGuards: [],
		_viewTransitions: options.viewTransitions === true,

		beforeEach(fn: GuardFn): () => void {
			(this._beforeGuards as GuardFn[]).push(fn);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				const guards = this._beforeGuards as GuardFn[];
				const i = guards.indexOf(fn);
				if (i > -1) guards.splice(i, 1);
			};
		},

		_runGuards(to: string): false | string | void | Promise<false | string | void> {
			const from = window.location.pathname;
			for (const g of (this._beforeGuards as GuardFn[]) ?? []) {
				const d = g(to, from);
				if (d instanceof Promise) {
					return d.then((r) => {
						if (r === false || typeof r === 'string') return r;
					});
				}
				if (d === false || typeof d === 'string') return d;
			}
		},

		go(n: number) {
			window.history.go(n);
		},

		get route() {
			const m = router._currentMatch as RouteMatch | null;
			if (!m) return null;
			const chain = m.matchChain ?? [];
			const deepest = chain[chain.length - 1] as RouteNode | undefined;
			return {
				pathname: m.pathname || '',
				params: m.params,
				pattern: deepest?.fullPath || '/',
			};
		},

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

			document.addEventListener('click', (e) => {
				const target = e.target as Element | null;
				if (!target || target.nodeType !== 1) return;
				const anchor = (target as Element).closest('a[href]') as HTMLAnchorElement | null;
				if (!anchor) return;
				if (!anchor.hasAttribute('no-reload') && !anchor.hasAttribute('data-no-reload')) return;
				if ((e as MouseEvent).defaultPrevented) return;
				const me = e as MouseEvent;
				if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
				if (anchor.target === '_blank') return;
				if (anchor.hasAttribute('download')) return;
				if (anchor.getAttribute('rel') === 'external') return;
				const href = anchor.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
				try {
					const url = new URL(href, window.location.origin);
					if (url.origin !== window.location.origin) return;
				} catch { return; }
				e.preventDefault();
				e.stopPropagation();
				router.navigate(href);
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

			const afterGuards = () => {
				if (!_isPopStateNavigation) {
					_scrollPositions.set(window.location.pathname, window.scrollY);
				}

				const swapView = (fn: () => void | Promise<void>) => {
					const d = document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => unknown };
					if (router._viewTransitions && typeof d.startViewTransition === 'function') d.startViewTransition(fn);
					else fn();
				};

				const loadingFn = findLoadingComponent(match.matchChain as Record<string, unknown>[]);
				router._navToken = (router._navToken || 0) + 1;
				navDebug('navigate', url.pathname, 'token=' + router._navToken, 'pendingChunks', hasPendingChunks(match.matchChain));
				const navToken = router._navToken;
				loadingStart();

				const middlewareFns: Function[] = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

				let firstRenderFailed = false;

				const updateUrl = () => {
					const fullUrl = url.pathname + url.search;
					if (!opts.replace) {
						window.history.pushState({ path: fullUrl }, '', fullUrl);
					} else {
						window.history.replaceState({ path: fullUrl }, '', fullUrl);
					}
					set(_state.path, url.pathname);
					set(_state.search, url.search.startsWith('?') ? url.search.slice(1) : url.search);
				};

				const renderContent = () => {
					const propsNode = findPageNode(match!);
					if (propsNode && propsNode._dataPath !== url.pathname) {
						propsNode.props = undefined;
					}
					try {
						(container as HTMLElement & { __veskMountToken?: number }).__veskMountToken = navToken;
						renderFn(router, match!, container, navToken);
					} catch (e) {
						firstRenderFailed = true;
						throw e;
					}
					router._currentMatch = match!;
					clearOfflineFlag(router, container);
					handleScroll(url.pathname, opts.replace);
				};

				const doRender = () => {
					navDebug('doRender', url.pathname, 'token=' + navToken);
					updateUrl();
					swapView(() => renderContent());
					scrollToHash();
					navDebug('painted', url.pathname);
				};

				const fetchData = () => {
					if (firstRenderFailed) return;
					navDebug('fetchData?', url.pathname, String(shouldFetchData(router, match!)));
					if (!shouldFetchData(router, match!)) { loadingFinish(); scrollToHash(); return; }
					getRouteData(url.pathname + url.search, 'nav' + navToken).then(async (data) => {
						navDebug('data arrived', url.pathname, 'token=' + navToken, 'current=' + router._navToken, 'realProps', JSON.stringify(data && hasRealPageData(data)));
						if (navToken !== router._navToken) return;
						if (!data) { loadingFinish(); return; }
						if (data.redirect) {
							loadingFinish();
							router.navigate(data.redirect, { replace: true });
							return;
						}
						if (!hasRealPageData(data)) { loadingFinish(); return; }
						const pending = hasPendingChunks(match!.matchChain);
						if (pending.length > 0) {
							await loadChunksQuietly(pending);
							if (navToken !== router._navToken) return;
							if (typeof router.__updateComponents === 'function') {
								router.__updateComponents(match!.matchChain);
							}
						}
						await swapView(() => applyRouteData(router, match!, data, container, renderFn));
						scrollToHash();
						loadingFinish({ error: !!data.error });
					}).catch(() => loadingFinish({ error: true }));
				};

				const pendingChunks = hasPendingChunks(match.matchChain);

				const handleNavFailure = (err: unknown) => {
					navDebug('handleNavFailure', String((err as Error)?.message || err).slice(0, 80));
					if (navToken !== router._navToken) return;
					loadingFinish({ error: true });
					looksOffline().then((offline) => {
						navDebug('handleNavFailure verdict', offline ? 'offline' : 'online');
						if (offline) return void renderOfflinePage(router, match!, container);
						return void renderErrorPage(router, match!, container, err);
					}).catch(() => {});
				};

				const doRenderWithChunks = pendingChunks.length > 0
					? () => {
						updateUrl();
						return loadChunksQuietly(pendingChunks).then(() => {
							if (navToken !== router._navToken) return;
						if (typeof router.__updateComponents === 'function') {
							router.__updateComponents(match!.matchChain);
						}
						try {
							renderContent();
							loadingFinish();
						} catch (e) {
							handleNavFailure(e);
						}
						}, (e) => {
							handleNavFailure(e);
						});
					}
					: (() => {
						if (typeof router.__updateComponents === 'function') {
							router.__updateComponents(match!.matchChain);
						}
						doRender();
					}) as (() => Promise<void>) | (() => void);

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
			};

			// Navigation guards — sync fast path for sync guard functions.
			const guardResult = router._runGuards(url.pathname);
			if (guardResult instanceof Promise) {
				return guardResult.then((decision) => {
					if (decision === false) return;
					if (typeof decision === 'string' && decision !== url.pathname && (router._guardDepth || 0) < 5) {
						router._guardDepth = (router._guardDepth || 0) + 1;
						try { router.navigate(decision, { replace: true }); }
						finally { router._guardDepth = 0; }
						return;
					}
					afterGuards();
				});
			}
			if (guardResult === false) return;
			if (typeof guardResult === 'string' && guardResult !== url.pathname && (router._guardDepth || 0) < 5) {
				router._guardDepth = (router._guardDepth || 0) + 1;
				try { router.navigate(guardResult, { replace: true }); }
				finally { router._guardDepth = 0; }
				return;
			}
			afterGuards();
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
			getRouteData(url.pathname + url.search, 'prefetch').then((data) => {
				if (data) storePrefetchedData(match!, data);
			});
		},

		get currentPath() {
			return get(_state.path) as string;
		},

		get isLoading() {
			const cells = getLoadingState();
			return Boolean(get(cells.isLoading));
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
			offline: (def as RouteNode & { offline?: Function | string | null }).offline ?? null,
			network: (def as RouteNode & { network?: Function | string | null }).network ?? null,
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
					segmentCount: cParts.length || 1,
					children: [],
				};
			}),
			segmentCount: parts.length,
		};
		tree.push(node);
	}
	return tree;
}
