# Link, NavLink, Outlet & Router Hooks

These are the everyday building blocks of navigation: `<Link>` for links
that navigate instantly without a page reload, `<NavLink>` for menu items
that know they're active, `<Outlet>` for layouts, and a handful of hooks
(`useRouter`, `useParams`, …) for reading and steering navigation from
code. All are imported from `@vesk/runtime/router`.

```vsk
import { Link, NavLink } from '@vesk/runtime/router';
```

## Components

```ts
/**
 * Renders an anchor that performs client-side (SPA) navigation on plain
 * left-clicks. Modifier-clicks (meta/ctrl/shift/alt), target="_blank" and
 * external URLs fall through to native browser behavior. SSR renders a
 * normal <a>; hydration claims the existing element.
 *
 * @example
 * <Link href="/blog/hello">Read post</Link>
 * <Link href="/docs" class="btn">Docs</Link>
 */
function Link(props: {
	href: string;
	children?: unknown;
	class?: string;
	style?: string;
	target?: string;
	rel?: string;
	[k: string]: unknown;   // extra attributes pass through
}): Node | string;

/**
 * Link with active-state styling. Active when the current path equals
 * `href`, or (for non-root hrefs) when the path starts with it followed by
 * end-of-string, '/' or '?'. Applies `activeClass` (default 'active') and
 * aria-current="page" unless ariaCurrent is false.
 *
 * @example
 * <nav>
 *   <NavLink href="/">Home</NavLink>
 *   <NavLink href="/blog" activeClass="is-active">Blog</NavLink>
 * </nav>
 */
function NavLink(props: {
	href: string;
	activeClass?: string;          // default 'active'
	ariaCurrent?: boolean | string;// default true → aria-current="page"
	// …plus every Link prop
}): Node | string;

/**
 * Placeholder rendered by layouts; the router fills it with the next
 * layout/page in the match chain. Emits a display:contents div marked
 * data-vesk-outlet; renders a comment node outside router context.
 *
 * @example
 * // app/layout.vsk
 * component Layout(props) { <body><Nav />{props.children}</body> }
 */
function Outlet(props?: { children?: unknown }): Node;

/**
 * Throw to redirect during render/middleware. Server/API maps it to an
 * HTTP redirect; the client file-router performs a replace-navigation.
 */
class Redirect extends Error {
	constructor(url: string, status?: number); // status default 302
}
/** Throws Redirect(url, 302). */
function redirect(url: string): never;
/** Throws Redirect(url, 308) — permanent. */
function permanentRedirect(url: string): never;

/**
 * Throw to render the nearest not-found.vsk (client) or respond 404
 * (server/API).
 */
class NotFoundError extends Error { constructor(msg?: string); }
/** Throws NotFoundError. */
function notFound(): never;
```

### Usage

```vsk
component Nav() {
	<nav>
		<NavLink href="/" activeClass="active">Home</NavLink>
		<NavLink href="/blog">Blog</NavLink>
		<Link href="/about" class="cta">About</Link>
	</nav>
}
```

```vsk
component AdminPage(props) {
	if (!props.user?.isAdmin) redirect('/login');    // or notFound();
	return <Dashboard />;
}
```

## Hooks

```ts
/**
 * Full facade over the ambient router. All getters are reactive — safe to
 * read inside effect()/tracked expressions.
 */
function useRouter(): {
	push(href: string): void;                 // navigate (pushState)
	replace(href: string): void;              // navigate (replaceState)
	back(): void;
	forward(): void;
	go(n: number): void;
	refresh(): void;                          // re-navigate current path (replace)
	prefetch(href: string): void;
	beforeEach(fn: (to: string, from: string) => false | string | void |
	          Promise<false | string | void>): () => void;
	readonly isLoading: boolean;              // navigation in flight
	/** 0–100 progress of the in-flight navigation; 0 when idle. */
	readonly progress: number;
	/** True when the last navigation finished with an error. */
	readonly error: boolean;
	readonly pathname: string;
	readonly params: Record<string, string>;
	readonly search: string;                  // e.g. "q=1&page=2"
	setSearch(next: Record<string, string> | string): void;  // replace-nav
	readonly route: { pathname: string; params: Record<string, string>;
	                  pattern: string } | null;
	readonly canGoBack: boolean;              // history.length > 1
};

/** Navigate imperatively. Falls back to bare history.pushState without a router. */
function useNavigate(): (path: string, opts?: { replace?: boolean }) => void;

/** Decoded params for the current route (reactive). Empty object on server/outside router. */
function useParams(): Record<string, string>;

/** Current pathname (reactive). */
function usePathname(): string;

/**
 * Current query as [URLSearchParams, setter]. The setter accepts an object
 * or raw query string and replace-navigates to pathname?query.
 *
 * @example
 * const [sp, setSp] = useSearchParams();
 * setSp({ page: '2' });            // /path?page=2
 */
function useSearchParams(): [URLSearchParams, (next: Record<string, string> | string) => void];
```

> Note on the server barrel: `@vesk/runtime/server` re-exports the router's
> `useParams` as `routerParams` to avoid clashing with the request-side
> `useParams`.

### Usage

```vsk
component SearchBox() {
	let &[q] = track("")
	const [sp, setSp] = useSearchParams()

	<input value={q} onInput={(e) => q.set(e.currentTarget.value)} />
	<button onClick={() => setSp({ q })}>Search</button>
}
```

```vsk
component Status() {
	const r = useRouter()
	effect(() => {
		if (r.isLoading) console.log('navigating…', r.progress)
	})
	return <span>{r.pathname} · back: {r.canGoBack ? 'yes' : 'no'}</span>
}
```

```ts
// guards via facade (works before router creation too)
const unsub = useRouter().beforeEach((to) => {
	if (to === '/admin' && !authed()) return '/login';
});
```

## Route data & search

- Pages receive route **params** as props (`props.params.slug`) plus any
  server-fetched data spread at top level.
- **Search params** are not props — read them via `useSearchParams()` /
  `useRouter().search`.
