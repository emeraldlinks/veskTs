# Router API

File-based routing covers most apps — you create folders, Vesk handles
navigation. This page is for everything beyond that: embedding a router in
your own shell, custom navigation behavior, guards, prefetch tuning or
hydration strategies. If that's not you yet, start with
[File-Based Routing](../file-based/doc.md).

Two factories share the same navigation machinery:

- `createRouter(routes, options)` — programmatic routes (array or pattern
  map).
- `createFileRouter(tree, options)` — the route tree emitted by the build
  from your `app/` directory; adds chunk loading, middleware and
  not-found handling.

Import from `@vesk/runtime/router`:

```ts
import {
	createRouter, createFileRouter, defineRoute, buildRouteTree,
	Link, NavLink, Outlet, useNavigate, useParams, usePathname,
	useSearchParams, useRouter, matchRoute, ensureChunk,
	redirect, permanentRedirect, notFound, NotFoundError, Redirect,
} from '@vesk/runtime/router';
```

## Programmatic routes

```ts
const router = createFileRouter(tree, { container: document.getElementById('root')! });
router.start();
```

```ts
// flat pattern map — ':param' and '*catchAll' supported
const router = createRouter({
	'/': () => import('./pages/Home'),
	'/blog/:slug': () => import('./pages/Post'),
}, { container: root });

router.start();
```

```ts
// explicit tree with nesting + boundaries
const tree = buildRouteTree([
	defineRoute('/', { page: () => null }),
	defineRoute('/blog', {
		layout: BlogLayout,
		loading: BlogLoading,
		children: [
			defineRoute('/blog/:slug', { page: Post }),
			defineRoute('/blog/:slug/review', { page: Review }),
		],
	}),
]);
```

## Options

```ts
interface RouterOptions {
	container?: HTMLElement;       // default #root
	prefetch?: boolean;            // default true — hover-prefetch links
	/** Wrap DOM swaps in document.startViewTransition when available. */
	viewTransitions?: boolean;     // default false
	hydrate?: 'full' | 'viewport' | 'idle' | 'interaction';  // default 'full'
	/** Route-data freshness TTL in ms. Default 0 = always refetch. */
	routeDataCache?: number;
	/** Offline UI for failed SPA navigations (component or HTML string). */
	offline?: Function | string;
}

interface FileRouterOptions extends RouterOptions {
	middleware?: Function | Function[];
	render?: (router, match, container) => void;
}
```

Defaults resolved at creation:

```ts
container   = options.container || document.getElementById('root')
prefetch    = options.prefetch !== false          // ON by default
routeDataCache = options.routeDataCache ?? 0
viewTransitions = options.viewTransitions === true
```

## Navigation pipeline

`router.navigate(path)` / `<Link>` clicks run this sequence:

1. `beforeEach` guards run (sync fast path; async guards awaited).
2. Scroll position saved for the current path.
3. Loading indicator starts (`loadingStart()`); if the target has a
   `loading.vsk`, it renders synchronously.
4. URL update (`pushState`/`replaceState`) + tracked path/search cells.
5. Optional view transition wraps the DOM swap.
6. Content renders; hash anchors scroll into view.
7. Route data fetches via `fetch(path, { headers: { 'X-Vesk-Data': '1' } })`
   unless fresh per `routeDataCache`; result applies props/head or handles
   redirect/notFound/error payloads.
8. Loading indicator finishes.

`navigate()` is synchronous when all guards are sync; returns a Promise
when an async guard is involved.

**Navigation policy:** SPA navigation happens through
`<Link>`/`<NavLink>`/`navigate()` and through opt-in plain anchors:

```html
<a href="/login" no-reload>Login</a>
<!-- also valid: data-no-reload -->
<a href="/docs" data-no-reload>Docs</a>
```

The router installs a single delegated document `click` listener that
intercepts **only** anchors bearing `no-reload` (or `data-no-reload`).
Plain `<a href>` without the attribute — including markdown-rendered links
— always does native browser navigation.

The interceptor respects modifier keys (meta/ctrl/shift/alt), non-left
clicks, `target="_blank"`, `download`, `rel="external"`, external
origins, and `hash` / `mailto:` / `tel:` / `javascript:` schemes — those
are never turned into SPA navigations.

## Guards

```ts
const unsub = router.beforeEach((to, from) => {
	if (!isAuthed() && to.startsWith('/admin')) return '/login'; // redirect
	if (hasUnsavedChanges()) return false;                        // block
	// return nothing → continue
});
// later:
unsub();
```

- Return `false` to cancel, a string path to redirect (replace-nav),
  nothing to continue. Async guards return Promises.
- Redirect loops are capped (depth 5).
- Guards apply to programmatic/Link navigations only — the browser's own
  back/forward cannot be blocked.
- Works identically on both routers; `useRouter().beforeEach` is safe even
  before a router exists.

## Prefetching

- On by default: `start()` installs a passive document-level `mouseenter`
  listener; hovering any `a[href]` prefetches that path.
- Prefetch matches the route, preloads pending JS chunks (file router),
  then fetches route data with scope `'prefetch'`, caching props/head on
  the page node.
- Combine with `routeDataCache` so navigating to a prefetched path reuses
  data with zero refetch.

```ts
router.prefetch('/blog/hello');
```

## View transitions

```ts
createFileRouter(tree, { viewTransitions: true });
```

When `document.startViewTransition` exists, each DOM swap (and the post-
data swap) is wrapped in it; otherwise swaps run directly.

## Hydration strategies

```ts
createFileRouter(tree, { hydrate: 'viewport' });
```

| Strategy | Behavior |
| --- | --- |
| `'full'` | Hydrate everything immediately (default) |
| `'viewport'` | In-viewport markers now; rest on approach (IntersectionObserver) |
| `'idle'` | Chunked during idle callbacks |
| `'interaction'` | First click/touch/focus/mouseenter hydrates |

See [SSR & Hydration](../../ssr-hydration/doc.md).

## API reference

```ts
/**
 * Create a programmatic SPA router. Accepts a RouteNode[] tree OR a flat
 * Record<pattern, loader> map (':param'/'*catchAll' syntax). Call
 * .start() to bind history, scroll restoration, prefetch listeners and
 * hydration/navigation.
 */
function createRouter(routes: RouteNode[] | Record<string, Function>, options?: RouterOptions): RouterInstance;

/**
 * Create the file-based router over a compiler-generated route tree.
 * Adds lazy chunk loading, middleware chain execution, loading/error/
 * not-found boundary rendering, offline UX and X-Vesk-Data fetching.
 */
function createFileRouter(tree: RouteNode[], options?: FileRouterOptions): FileRouterInstance;

/** Declare one node of a manual route tree. */
function defineRoute(path: string, config: Record<string, unknown>): RouteNode;

/** Compute fullPaths/dynamic/catch-all flags for a manual tree. */
function buildRouteTree(definitions: RouteNode[]): RouteNode[];

/**
 * Match a pathname against a route tree.
 * Returns { matchChain, params } or null.
 */
function matchRoute(tree: RouteNode[], pathname: string): RouteMatch | null;

/**
 * Inject <script src=url> into <head> once; dedupes, records failures,
 * retries after failure. No-op without a DOM (server).
 */
function ensureChunk(chunkUrl: string): Promise<void>;
```

### RouterInstance

```ts
interface RouterInstance {
	routeTree: RouteNode[];
	container: HTMLElement;
	/** Bind popstate/scroll/prefetch listeners and hydrate-or-navigate. */
	start(): RouterInstance;
	navigate(path: string, opts?: { replace?: boolean }): Promise<void> | void;
	prefetch(path: string): void;
	readonly currentPath: string;
	/** True while an SPA navigation is in flight (shared loading cell). */
	readonly isLoading: boolean;
	/**
	 * Register a navigation guard. Return false to block, a path string to
	 * redirect, void to continue; async guards may return a Promise.
	 * Returns an unsubscribe function. Link/programmatic navs only.
	 */
	beforeEach(fn: (to: string, from: string) => false | string | void | Promise<false | string | void>): () => void;
	go(n: number): void;
	/** Current match snapshot: { pathname, params, pattern } or null. */
	readonly route: { pathname: string; params: Record<string, string>; pattern: string } | null;
	/** Internal hook used by HMR to re-render the current page. */
	hmrUpdate(): void;
}
```
