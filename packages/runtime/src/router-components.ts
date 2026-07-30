import { track, get } from './ripple-runtime.js';
import { createContext } from './context.js';
import { createHydrateWalker } from './hydrate.js';

interface Router {
	start(): Router;
	navigate(path: string, opts?: { replace?: boolean }): void;
	prefetch(path: string): void;
	readonly currentPath: string;
	_outletPlaceholders?: HTMLElement[];
	_currentSegments?: { rendered: Node }[] | null;
	_depth?: number;
	[k: string]: unknown;
}

export class Redirect extends Error {
	url: string;
	status: number;
	declare name: 'Redirect';

	constructor(url: string, status = 302) {
		super(`Redirect to ${url}`);
		this.url = url;
		this.status = status;
		this.name = 'Redirect';
	}
}

export function redirect(url: string, status = 302): never {
	throw new Redirect(url, status);
}

export function permanentRedirect(url: string): never {
	throw new Redirect(url, 308);
}

export class NotFoundError extends Error {
	declare name: 'NotFoundError';

	constructor(msg = 'Not Found') {
		super(msg);
		this.name = 'NotFoundError';
	}
}

export function notFound(): never {
	throw new NotFoundError();
}

export const RouterCtx = createContext<Router | null>(null);

let _currentRouter: Router | null = null;
let _outletId = 0;

export let __isHydrating = false;

export function setIsHydrating(v: boolean): void {
	__isHydrating = v;
}

export const _state = {
	path: track('/'),
	params: track({} as Record<string, string>),
	search: track(''),
};

export const _scrollPositions = new Map<string, number>();
export let _isPopStateNavigation = false;

export function setIsPopStateNavigation(v: boolean): void {
	_isPopStateNavigation = v;
}

export function setCurrentRouter(r: Router | null): void {
	_currentRouter = r;
}

export function getCurrentRouter(): Router | null {
	return _currentRouter;
}

export function findLoadingComponent(chain: Record<string, unknown>[]): Function | null {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].loading) return chain[i].loading as Function;
	}
	return null;
}

export function findErrorComponent(chain: Record<string, unknown>[]): Function | null {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].error) return chain[i].error as Function;
	}
	return null;
}

export function findNotFoundComponent(chain: Record<string, unknown>[]): Function | null {
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].notFound) return chain[i].notFound as Function;
	}
	return null;
}

export function showLoadingInContainer(container: HTMLElement, loadingFn: Function, params: Record<string, string>): void {
	const tempRoot = document.createDocumentFragment();
	const walker = createHydrateWalker(tempRoot as unknown as HTMLElement, []);
	const loadingContent = loadingFn({ params }, new Map(), walker);
	container.replaceChildren();
	if (loadingContent && typeof loadingContent === 'object' && (loadingContent as Node).nodeType) {
		container.appendChild(loadingContent as Node);
	} else if (typeof loadingContent === 'string') {
		container.innerHTML = loadingContent;
	}
}

export function handleScroll(pathname: string, isReplace?: boolean): void {
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

interface OutletProps {
	children?: unknown;
}

export function Outlet(props?: OutletProps): Node {
	const router = RouterCtx.get();
	if (!router) return document.createComment('outlet');
	const div = document.createElement('div');
	div.setAttribute('data-vesk-outlet', String(_outletId++));
	div.style.display = 'contents';
	if (router._outletPlaceholders) {
		router._outletPlaceholders.push(div);
	}
	const seg = router._currentSegments && router._currentSegments[router._depth || 0];
	if (seg && seg.rendered) {
		div.appendChild(seg.rendered);
	}
	return div;
}

interface LinkProps {
	href: string;
	children?: unknown;
	class?: string;
	style?: string;
	target?: string;
	rel?: string;
	[k: string]: unknown;
}

type HydrateWalker = ReturnType<typeof createHydrateWalker>;

export function Link(
	props: LinkProps,
	registry?: Map<string, unknown>,
	hydrate?: HydrateWalker,
): Node | string {
	const href = props.href || '#';
	if (hydrate && hydrate.nextElement) {
		let a = hydrate.nextElement('a') as HTMLAnchorElement;
		if (a && !a.parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector('a');
			if (existing) a = existing as HTMLAnchorElement;
		}
		if (props.children != null) {
			if (typeof props.children === 'string' || typeof props.children === 'number') {
				a.textContent = String(props.children);
			} else if ((props.children as Node).textContent) {
				a.textContent = (props.children as Node).textContent;
			}
		}
		a.addEventListener('click', (e) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			if (props.target === '_blank') return;
			e.preventDefault();
			e.stopPropagation();
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
		if ((props.children as Node).nodeType) {
			a.appendChild(props.children as Node);
		} else if (Array.isArray(props.children)) {
			for (const c of props.children) {
				if (c && (c as Node).nodeType) a.appendChild(c as Node);
				else if (c != null) a.appendChild(document.createTextNode(String(c)));
			}
		}
	}
	a.addEventListener('click', (e) => {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		if (props.target === '_blank') return;
		e.preventDefault();
		e.stopPropagation();
		const nav = useNavigate();
		nav(href);
	});
	return a;
}

interface NavLinkProps extends LinkProps {
	activeClass?: string;
	ariaCurrent?: boolean | string;
}

export function NavLink(
	props: NavLinkProps,
	registry?: Map<string, unknown>,
	hydrate?: HydrateWalker,
): Node | string {
	if (typeof document === 'undefined') {
		return Link(props, registry, hydrate);
	}
	if (__isHydrating) {
		const a = document.querySelector(`a[href="${props.href}"]`) as HTMLAnchorElement;
		if (a) {
			if (props.children != null) {
				if (typeof props.children === 'string' || typeof props.children === 'number') {
					a.textContent = String(props.children);
				} else if ((props.children as Node).textContent) {
					a.textContent = (props.children as Node).textContent;
				}
			}
			a.addEventListener('click', (e) => {
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				if (props.target === '_blank') return;
				e.preventDefault();
				e.stopPropagation();
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
	const a = Link(props, registry, hydrate) as HTMLAnchorElement;
	const path = usePathname();
	const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === '/' || path[props.href.length] === '?'));
	if (isActive) {
		a.classList.add(props.activeClass || 'active');
		if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
	}
	return a;
}

export function useNavigate(): (path: string, opts?: { replace?: boolean }) => void {
	const router = RouterCtx.get() || _currentRouter;
	return (path: string, opts = {}) => {
		if (router && router.navigate) {
			router.navigate(path, opts);
		} else {
			window.history.pushState({}, '', path);
			(_state as unknown as Record<string, { value: string }>).path.value = path;
		}
	};
}

export function useParams(): Record<string, string> {
	return get(_state.params) as Record<string, string>;
}

export function usePathname(): string {
	return get(_state.path) as string;
}

export function useSearchParams(): [URLSearchParams, (next: Record<string, string> | string) => void] {
	const s = get(_state.search) as string;
	const sp = new URLSearchParams(s || '');
	const setter = (next: Record<string, string> | string) => {
		const q = typeof next === 'string' ? next : new URLSearchParams(next).toString();
		(_state as unknown as Record<string, { value: string }>).search.value = q;
		const nav = useNavigate();
		const path = get(_state.path) as string;
		nav(path + (q ? '?' + q : ''), { replace: true });
	};
	return [sp, setter];
}

export function useRouter(): {
	push: (href: string) => void;
	replace: (href: string) => void;
	back: () => void;
	forward: () => void;
	refresh: () => void;
	prefetch: (href: string) => void;
} {
	const router = RouterCtx.get() || _currentRouter;
	return {
		push: (href: string) => router?.navigate?.(href),
		replace: (href: string) => router?.navigate?.(href, { replace: true }),
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		refresh: () => router?.navigate?.(window.location.pathname, { replace: true }),
		prefetch: (href: string) => router?.prefetch?.(href),
	};
}
