/**
 * Router components (Outlet, Link, NavLink) and hooks (useNavigate, useParams, etc.)
 * plus Redirect/NotFoundError error classes.
 *
 * @module router-components
 */

import { track, get } from './ripple-runtime.js';
import { createContext } from './context.js';
import { createHydrateWalker } from './hydrate.js';

// ── Errors ─────────────────────────────────────────────────────

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

export function permanentRedirect(url) {
	throw new Redirect(url, 308);
}

export class NotFoundError extends Error {
	constructor(msg = 'Not Found') {
		super(msg);
		this.name = 'NotFoundError';
	}
}

export function notFound() {
	throw new NotFoundError();
}

// ── Router Context ──────────────────────────────────────────────

export const RouterCtx = createContext(null);

let _currentRouter = null;
let _outletId = 0;

// ── Hooks state ──────────────────────────────────────────────

export let __isHydrating = false;

export function setIsHydrating(v) {
	__isHydrating = v;
}

export const _state = {
	path: track('/'),
	params: track({}),
	search: track(''),
};

export const _scrollPositions = new Map();
export let _isPopStateNavigation = false;

export function setIsPopStateNavigation(v) {
	_isPopStateNavigation = v;
}

export function setCurrentRouter(r) {
	_currentRouter = r;
}

export function getCurrentRouter() {
	return _currentRouter;
}

// ── Loading / Error / NotFound helpers ────────────────────────────

export function findLoadingComponent(chain) {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].loading) return chain[i].loading;
	}
	return null;
}

export function findErrorComponent(chain) {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].error) return chain[i].error;
	}
	return null;
}

export function findNotFoundComponent(chain) {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].notFound) return chain[i].notFound;
	}
	return null;
}

export function showLoadingInContainer(container, loadingFn, params) {
	const tempRoot = document.createDocumentFragment();
	const walker = createHydrateWalker(tempRoot, []);
	const loadingContent = loadingFn({ params }, new Map(), walker);
	container.replaceChildren();
	if (loadingContent && typeof loadingContent === 'object' && loadingContent.nodeType) {
		container.appendChild(loadingContent);
	} else if (typeof loadingContent === 'string') {
		container.innerHTML = loadingContent;
	}
}

export function handleScroll(pathname, isReplace) {
	if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
	if (_isPopStateNavigation) {
		setIsPopStateNavigation(false);
		const savedY = _scrollPositions.get(pathname);
		requestAnimationFrame(() => {
			window.scrollTo(0, savedY !== undefined ? savedY : 0);
		});
	} else if (!isReplace) {
		requestAnimationFrame(() => window.scrollTo(0, 0));
	}
}

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

/**
 * Create a navigate function for client-side SPA navigation.
 * Uses the current router if available, otherwise falls back to
 * direct history.pushState.
 * @returns {(path: string, opts?: object) => void}
 */
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
		prefetch: (href) => router?.prefetch?.(href),
	};
}
