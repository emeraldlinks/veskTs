type Block =
	| { kind: "h2"; text: string }
	| { kind: "p"; text: string }
	| { kind: "list"; items: string[] }
	| { kind: "note"; tone: "info" | "warn"; text: string }
	| { kind: "code"; filename: string; language?: string; code: string }
	| { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
	| { kind: "table"; head: string[]; rows: string[][] };

export const pages: {
	slug: string;
	title: string;
	description: string;
	group: string;
	blocks: Block[];
}[] = [
	{
		slug: "routing",
		title: "Routing",
		description:
			"File-based routing under app/, dynamic segments and catch-alls, nested layouts, loading/error/not-found/offline pages, Link/NavLink navigation, prefetching, guards, and the programmatic router API.",
		group: "Runtime",
		blocks: [
			{
				kind: "p",
				text: "Vesk is file-based routing. The structure of your `app/` directory — plus a handful of reserved file names (`page.vsk`, `layout.vsk`, `loading.vsk`, `error.vsk`, `not-found.vsk`, `offline.vsk`, `network.vsk`, `middleware.ts`) — determines every URL in the app. The compiler scans `app/` (`scanRoutes` in `packages/compiler/src/router.ts`) into an in-memory route tree, and the client router builds `Link`/`NavLink` SPA navigations, route-data prefetching and hydration on top of it.",
			},
			{ kind: "h2", text: "Route conventions" },
			{
				kind: "table",
				head: ["app/ file", "URL route"],
				rows: [
					["app/page.vsk", "/"],
					["app/about/page.vsk", "/about"],
					["app/about/layout.vsk", "layout wrapping /about"],
					["app/blog/[slug]/page.vsk", "/blog/:slug"],
					["app/docs/[...rest]/page.vsk", "/docs/:rest (catch-all)"],
					["app/(marketing)/page.vsk", "/ (route group, no URL segment)"],
					["app/_private/page.vsk", "excluded from the router"],
				],
			},
			{
				kind: "list",
				items: [
					"Every directory can carry `page.vsk` (the route itself) and `layout.vsk` (the wrapper that renders the child chain).",
					"A directory name in square brackets — `[slug]` — is a dynamic segment; under `/blog/[slug]` the page receives `slug` via `useParams()`.",
					"A directory starting with `[...` — `[...rest]` — is a catch-all; `useParams().rest` holds the decoded, `/`-joined remainder.",
					"A directory name wrapped in parens — `(marketing)`, `(auth)` — is a route group: it organizes routes but contributes no URL segment.",
					"Directories starting with `_` are private and never scanned (components and other non-route files belong there).",
					"Reserved files resolve to the nearest directory up the match chain: a `not-found.vsk` in `app/` covers every unmatched URL, one in `app/blog/` covers `app/blog` only.",
				],
			},
			{
				kind: "p",
				text: "When no page matches, the router renders the nearest `not-found.vsk` (falling back to a built-in `404 — Not Found`). Custom `not-found.vsk` receives `{ params, url }`.",
			},
			{ kind: "h2", text: "Dynamic segments & params" },
			{
				kind: "p",
				text: "`useParams()` returns the current route's dynamic segments as a record. Values are URL-decoded. The router updates `params` reactively on every navigation, so reads inside `effect()` re-run when the segment changes.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/flights/[id]/page.vsk",
						code: `component FlightDetail() {
	const { id } = useParams();
	<p class="flight">Flight {id}</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/flights/[id]/page.vsk",
						code: `component FlightDetail() {
	const { id } = useParams();
	return <p class="flight">Flight {id}</p>;
}`,
					},
				],
			},
			{
				kind: "p",
				text: "Catch-all segments capture the remaining URL after the matched prefix. For `app/docs/[...rest]/page.vsk`, `/docs/guides/routing/deep` yields `useParams().rest === 'guides/routing/deep'`.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/docs/[...rest]/page.vsk",
						code: `component DocPage() {
	const { rest } = useParams();
	<p>Segments: {rest}</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/docs/[...rest]/page.vsk",
						code: `component DocPage() {
	const { rest } = useParams();
	return <p>Segments: {rest}</p>;
}`,
					},
				],
			},
			{ kind: "h2", text: "Nested layouts" },
			{
				kind: "p",
				text: "A `layout.vsk` wraps every route beneath its directory. The router renders the layout chain inside-out and passes each layout `{ children, params }` — render the matched page (and any inner layouts) with `{props.children}`.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/layout.vsk",
						code: `component Layout(props: { children: any }) {
	<header>Site header</header>
	<main>{props.children}</main>
	<footer>Footer</footer>
}`,
					},
					{
						label: "expression mode",
						filename: "app/layout.vsk",
						code: `component Layout(props: { children: any }) {
	return (<div>
		<header>Site header</header>
		<main>{props.children}</main>
		<footer>Footer</footer>
	</div>);
}`,
					},
				],
			},
			{
				kind: "p",
				text: "Layouts nest by directory depth. `app/layout.vsk` wraps everything, `app/docs/layout.vsk` wraps only `/docs` routes, and `app/docs/layout.vsk`'s `{props.children}` receives the rendered `app/docs/[...rest]/page.vsk`. The `params` prop mirrors `useParams()` at the layout's depth, so a layout for `app/blog/[slug]/` sees `{ slug }`.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/docs/layout.vsk",
						code: `component DocsLayout(props: { children: any }) {
	<aside>Docs nav</aside>
	<main>{props.children}</main>
}`,
					},
					{
						label: "expression mode",
						filename: "app/docs/layout.vsk",
						code: `component DocsLayout(props: { children: any }) {
	return (<div>
		<aside>Docs nav</aside>
		<main>{props.children}</main>
	</div>);
}`,
					},
				],
			},
			{
				kind: "note",
				tone: "info",
				text: "File-based layouts render the page chain through `props.children` — the runtime (`renderMatch` in `packages/runtime/src/router.ts`) passes `{ children, params }` down the layout chain. The `Outlet` component exists in the runtime surface but is not what file-based layouts use; the layout system renders `props.children` directly.",
			},
			{ kind: "h2", text: "Loading, error, not-found & offline pages" },
			{
				kind: "table",
				head: ["Reserved file", "When it renders", "Props"],
				rows: [
					["loading.vsk", "While an SPA navigation to the route is in flight", "{ params }"],
					["error.vsk", "When the matched page or layout throws", "{ error, retry, params, statusCode, stack, url, offline, networkState }"],
					["not-found.vsk", "Unmatched URL, or `notFound()` thrown", "{ params, url }"],
					["offline.vsk", "Navigation failed because the client lost connectivity", "{ url, params, retry, online, effectiveType, downlink, rtt, saveData }"],
					["network.vsk", "Connectivity-aware UI that live re-renders on online/offline/type changes", "{ url, params, retry, online, effectiveType, downlink, rtt, saveData }"],
				],
			},
			{
				kind: "p",
				text: "Each file sits in the same directory as the routes it covers and resolves to the nearest ancestor up the match chain. The `error.vsk` boundary keeps the layout/nav intact — it swaps only the page slot.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/error.vsk",
						code: `component ErrorBoundary(props: { error: any; retry: any; params: any }) {
	<main>
		<h1>Something went wrong</h1>
		<p>{props.error.message}</p>
		<button onClick={() => props.retry()}>Retry</button>
	</main>
}`,
					},
					{
						label: "expression mode",
						filename: "app/error.vsk",
						code: `component ErrorBoundary(props: { error: any; retry: any; params: any }) {
	return (
		<main>
			<h1>Something went wrong</h1>
			<p>{props.error.message}</p>
			<button onClick={() => props.retry()}>Retry</button>
		</main>
	);
}`,
					},
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/blog/loading.vsk",
						code: `component LoadingEl() {
	<p>Loading…</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/blog/loading.vsk",
						code: `component LoadingEl() {
	return <p>Loading…</p>;
}`,
					},
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/not-found.vsk",
						code: `component NotFound404(props: { url: string }) {
	<main>
		<h1>404</h1>
		<p>{props.url} was not found</p>
		<Link href="/">Go home</Link>
	</main>
}`,
					},
					{
						label: "expression mode",
						filename: "app/not-found.vsk",
						code: `component NotFound404(props: { url: string }) {
	return (
		<main>
			<h1>404</h1>
			<p>{props.url} was not found</p>
			<Link href="/">Go home</Link>
		</main>
	);
}`,
					},
				],
			},
			{
				kind: "p",
				text: "Offline and network pages are the router's connectivity experience for SPA navigations that fail due to lost (or degraded) network. Precedence: nearest `offline.vsk` (when offline) → `network.vsk` → the router's `offline` option → `error.vsk` invoked with `offline: true` → the built-in offline panel.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/offline.vsk",
						code: `component Offline() {
	<main>
		<p>You're offline.</p>
		<button onClick={() => props.retry()}>Retry</button>
	</main>
}`,
					},
					{
						label: "expression mode",
						filename: "app/offline.vsk",
						code: `component Offline() {
	return (
		<main>
			<p>You're offline.</p>
			<button onClick={() => props.retry()}>Retry</button>
		</main>
	);
}`,
					},
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/network.vsk",
						code: `component NetworkState(props) {
	<p>{props.online ? 'Online' : 'Offline'} · {props.effectiveType}</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/network.vsk",
						code: `component NetworkState(props) {
	return <p>{props.online ? 'Online' : 'Offline'} · {props.effectiveType}</p>;
}`,
					},
				],
			},
			{
				kind: "note",
				tone: "info",
				text: "A network failure never renders the not-found page — it is a connectivity problem, not a missing route. `props.retry()` debounces a re-navigation, and while an offline/network boundary is displayed the router re-renders it on connectivity changes and re-navigates automatically once the browser comes back online.",
			},
			{ kind: "h2", text: "Navigation components" },
			{
				kind: "list",
				items: [
					"`Link { href, class, style, target, rel }` — renders an `<a>` and intercepts clicks for client-side (SPA) navigation. Clicks with meta/ctrl/shift/alt or a non-primary button, `target=\"_blank\"`, and non-route hrefs (`#anchor`, `mailto:`…) fall through to native behavior.",
					"`NavLink` — everything `Link` does plus active-state styling: `activeClass` (default `'active'`) is applied and `aria-current=\"page\"` set when the current path exactly equals the href, or is a descendant of it (boundary-aware prefix match, `/docs/x` matches `/docs` but not `/docs2`). Pass `ariaCurrent={false}` to skip `aria-current`.",
					"Plain `<a href=\"...\" no-reload>` — opts an ordinary anchor into SPA navigation with no page reload (the router installs a delegated click listener). `data-no-reload` is equivalent.",
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/components/Nav.vsk",
						code: `component Nav() {
	<nav>
		<Link href="/">Home</Link>
		<NavLink href="/shop" activeClass="font-bold text-accent">Shop</NavLink>
		<Link href="/about" class="no-underline">About</Link>
	</nav>
}`,
					},
					{
						label: "expression mode",
						filename: "app/components/Nav.vsk",
						code: `component Nav() {
	return (
		<nav>
			<Link href="/" class="no-underline">Home</Link>
			<NavLink href="/shop" activeClass="font-bold text-accent">Shop</NavLink>
		</nav>
	);
}`,
					},
				],
			},
			{
				kind: "code",
				filename: "app/components/ArticleLink.vsk",
				code: `component ArticleLink() {
	<a href="/docs/routing" no-reload>Routing docs</a>
}`,
			},
			{
				kind: "note",
				tone: "info",
				text: "In hash mode (`hash: true`) `Link` renders `#/path` and `#/...` hrefs are SPA-navigated; plain `#anchor` in-page links always stay native.",
			},
			{ kind: "h2", text: "Prefetching" },
			{
				kind: "p",
				text: "The router prefetches route data and route-component chunks on hover: a delegated `mouseenter` listener calls `router.prefetch(href)` for any link on the page. Prefetched data is stashed on the matched route node and used by the next navigation to that path; route-data freshness is controlled by the `routeDataCache` option (TTL in ms, `0` = always refetch fresh data on SPA navigation).",
			},
			{
				kind: "list",
				items: [
					"`createRouter(routes, { prefetch: false })` / `createFileRouter(tree, { prefetch: false })` — disable hover prefetching.",
					"`router.prefetch(path)` or `useRouter().prefetch(path)` — prefetch on demand (e.g. on focus or button hover).",
				],
			},
			{ kind: "h2", text: "Programmatic navigation" },
			{
				kind: "p",
				text: "`useNavigate()` returns `navigate(path, opts?)` for imperative client-side navigation: `navigate('/settings')` pushes history, `navigate('/settings', { replace: true })` replaces. `usePathname()`, `useParams()` and `useSearchParams()` are reactive — reads inside `effect()` re-run on change. `useSearchParams()` returns `[URLSearchParams, setter]` where the setter accepts a record or a raw query string and replaces the current URL.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/dashboard/page.vsk",
						code: `component Dashboard() {
	const pathname = usePathname();
	const [search, setSearch] = useSearchParams();
	const navigate = useNavigate();
	const { id } = useParams();
	<p>{pathname}</p>
	<p>Query: {search.toString()}</p>
	<button onClick={() => navigate('/settings')}>Settings</button>
	<button onClick={() => setSearch({ tab: 'preview' })}>Preview</button>
	<span>Doc {id}</span>
}`,
					},
					{
						label: "expression mode",
						filename: "app/dashboard/page.vsk",
						code: `component Dashboard() {
	const pathname = usePathname();
	const [search, setSearch] = useSearchParams();
	const navigate = useNavigate();
	const { id } = useParams();
	return (
		<div>
			<p>{pathname}</p>
			<p>Query: {search.toString()}</p>
			<button onClick={() => navigate('/settings')}>Settings</button>
			<button onClick={() => setSearch({ tab: 'preview' })}>Preview</button>
			<span>Doc {id}</span>
		</div>
	);
}`,
					},
				],
			},
			{
				kind: "p",
				text: "`useRouter()` returns a facade over the active router with navigation helpers, loading state and reactive route getters:",
			},
			{
				kind: "table",
				head: ["Member", "Description"],
				rows: [
					["push(href)", "Navigate, pushing history"],
					["replace(href)", "Navigate, replacing history"],
					["navigate(href, opts?)", "Alias of the router's navigate; opts may carry `{ replace }`"],
					["back() / forward() / go(n)", "History traversal"],
					["refresh()", "Re-navigate the current path (replace)"],
					["prefetch(href)", "Warm route data + chunks for a path"],
					["beforeEach(fn)", "Register a navigation guard; returns an unsubscribe function"],
					["isLoading", "True while a navigation is in flight (reactive)"],
					["progress", "0–100 progress of the in-flight navigation (reactive)"],
					["error", "True when the last navigation finished with an error (reactive)"],
					["pathname", "Reactive current pathname"],
					["params", "Reactive dynamic-segment params for the current route"],
					["search", "Reactive query string, without '?'"],
					["setSearch(next)", "Set the query string (record or raw string), replacing the URL"],
					["route", "Snapshot `{ pathname, params, pattern }` of the matched route, or null before the first navigation"],
					["canGoBack", "True when `window.history` has an entry to go back to"],
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/components/Toolbar.vsk",
						code: `component Toolbar() {
	const router = useRouter();
	<div>
		<button onClick={() => router.push('/dashboard')}>Dashboard</button>
		<button onClick={() => router.replace('/settings')}>Settings</button>
		<button onClick={() => router.back()}>Back</button>
		<button onClick={() => router.forward()}>Forward</button>
		<button onClick={() => router.prefetch('/reports')}>Prefetch reports</button>
		<span>{router.isLoading ? 'Loading' : 'Idle'}</span>
	</div>
}`,
					},
					{
						label: "expression mode",
						filename: "app/components/Toolbar.vsk",
						code: `component Toolbar() {
	const router = useRouter();
	const progress = router.progress;
	return (
		<div>
			<button onClick={() => router.push('/dashboard')}>Dashboard</button>
			<button onClick={() => router.refresh()}>Refresh</button>
			<span>{router.isLoading ? 'Loading' : 'Idle'}</span>
			<span>{progress}%</span>
		</div>
	);
}`,
					},
				],
			},
			{ kind: "h2", text: "Route guards" },
			{
				kind: "p",
				text: "`router.beforeEach(fn)` / `useRouter().beforeEach(fn)` register navigation guards. Each guard receives `(to, from)` and returns `false` to block the navigation, a path to redirect to, or `undefined`/`void` to allow. Guards may be async (return a Promise). They run for programmatic and `Link`/`NavLink` navigations only — the browser's own back/forward cannot be blocked. Redirect loops are capped at 5 hops. `beforeEach` returns an unsubscribe function.",
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/components/Guard.vsk",
						code: `component Guarded() {
	const router = useRouter();
	router.beforeEach((to, from) => {
		if (to.startsWith('/admin')) return '/login';
		if (to === '/secret') return false;
	});
	<p>guarded page</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/components/Guard.vsk",
						code: `component Guarded() {
	const router = useRouter();
	router.beforeEach((to, from) => {
		if (to.startsWith('/admin')) return '/login';
		if (to === '/secret') return false;
	});
	return <p>guarded page</p>;
}`,
					},
				],
			},
			{ kind: "h2", text: "Redirects" },
			{
				kind: "list",
				items: [
					"`redirect(url, status = 302)` — throws a `Redirect`; the router catches it and navigates (with the status honored by the server).",
					"`permanentRedirect(url)` — throws a `Redirect` with `status = 308`.",
					"`notFound()` — throws a `NotFoundError`; the router renders the nearest `not-found.vsk`.",
					"`Redirect` / `NotFoundError` can also be thrown directly (`throw new NotFoundError()`), as in the docs app's `app/docs/[slug]/page.vsk`.",
					"Server middleware and API route handlers recognize the thrown `Redirect` (`err.name === 'Redirect'`) and turn it into an HTTP redirect response.",
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/secure/page.vsk",
						code: `component Secure() {
	const allowed = true;
	if (!allowed) {
		redirect('/login');
	}
	<p>Secret dashboard</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/secure/page.vsk",
						code: `component Secure() {
	const allowed = true;
	if (!allowed) {
		redirect('/login');
	}
	return <p>Secret dashboard</p>;
}`,
					},
				],
			},
			{
				kind: "tabs",
				tabs: [
					{
						label: "statement mode",
						filename: "app/blog/[slug]/page.vsk",
						code: `component BlogPost() {
	const { slug } = useParams();
	if (slug === 'missing') {
		notFound();
	}
	<p>Post {slug}</p>
}`,
					},
					{
						label: "expression mode",
						filename: "app/blog/[slug]/page.vsk",
						code: `component BlogPost() {
	const { slug } = useParams();
	if (slug === 'missing') {
		notFound();
	}
	return <p>Post {slug}</p>;
}`,
					},
				],
			},
			{ kind: "h2", text: "Programmatic router API" },
			{
				kind: "p",
				text: "Beyond the file-based convention, the runtime exposes lower-level builders for the route tree and two router factories. All of them live in `@vesk/runtime/router` and are NOT auto-imported — import them explicitly. (The `Link`, `NavLink`, `Outlet` components and the `useRouter`/`useNavigate`/`useParams`/`usePathname`/`useSearchParams`/`redirect`/`permanentRedirect`/`notFound` hooks are auto-imported by the compiler.)",
			},
			{
				kind: "list",
				items: [
					"`createRouter(routes, options)` — builds a router from an array of `RouteNode`s or a `Record<string, Function>` path→loader map, rendering into `options.container` (default `#root`).",
					"`createFileRouter(routeTree, options)` — the factory the compiled app uses: takes the route tree scanned from `app/` and adds middleware and lazy chunk loading (`ensureChunk`) on top.",
					"`defineRoute(path, config)` — one lazy route definition; returns `{ path, ...config }`.",
					"`buildRouteTree(definitions)` — normalizes an array of `defineRoute` results into a matchable tree (dynamic `:param`, catch-all `*`, `segmentCount`, `fullPath`).",
					"`matchRoute(tree, pathname)` — pure matcher; returns `{ matchChain, params }` or `null`.",
				],
			},
			{
				kind: "code",
				filename: "app/client.ts",
				code: `import { createFileRouter } from '@vesk/runtime/router';
import routes from './routes.generated';

const router = createFileRouter(routes, {
	hydrate: 'viewport',
	prefetch: true,
});
router.start();`,
			},
			{
				kind: "p",
				text: "Router options shared by both factories: `container`, `prefetch` (default `true`), `viewTransitions` (default `false`; wraps SPA swaps in `document.startViewTransition`), `hydrate` (`'full' | 'viewport' | 'idle' | 'interaction'`), `routeDataCache` (route-data freshness TTL in ms, default `0`), `hash` (route in `#/path` instead of the pathname), and `offline` (a fallback offline component or HTML string). `createFileRouter` additionally accepts `middleware` and a custom `render`.",
			},
			{
				kind: "code",
				filename: "app/client.ts",
				code: `import { createRouter, defineRoute, buildRouteTree } from '@vesk/runtime/router';

const Home = () => '<h1>Home</h1>';

const tree = buildRouteTree([
	defineRoute('/', { page: Home }),
	defineRoute('/about/:id', { page: () => '<p>about</p>' }),
	defineRoute('/docs/*', { page: () => '<p>catch-all</p>' }),
]);

const router = createRouter(tree, {
	container: document.getElementById('root')!,
	prefetch: true,
});
router.start();`,
			},
			{
				kind: "p",
				text: "Passing a plain map to `createRouter` skips `buildRouteTree`: keys are patterns, `:param` marks dynamic segments, `...name` marks a catch-all, and the router builds the tree with `buildTreeFromMap`. The `hash: true` option reads/writes the route in the URL fragment.",
			},
			{
				kind: "code",
				filename: "app/client.ts",
				code: `import { createRouter, matchRoute } from '@vesk/runtime/router';

const routes: Record<string, Function> = {
	'/home': () => '<h1>Home</h1>',
	'/post/:slug': () => '<h1>Post</h1>',
	'/files/...rest': () => '<h1>Files</h1>',
};

const router = createRouter(routes, { hash: true });
router.start();

const match = matchRoute(router.routeTree, '/post/hello');
console.log(match!.params.slug);`,
			},
			{
				kind: "code",
				filename: "app/router-utils.ts",
				code: `import { matchRoute, buildRouteTree, defineRoute } from '@vesk/runtime/router';

const tree = buildRouteTree([
	defineRoute('/blog', { page: () => '<p>index</p>' }),
	defineRoute('/blog/:slug', { page: () => '<p>post</p>' }),
	defineRoute('/blog/:slug/comments', { page: () => '<p>comments</p>' }),
]);

const m = matchRoute(tree, '/blog/intro-to-vesk/comments');
console.log(m?.params.slug);`,
			},
			{
				kind: "note",
				tone: "warn",
				text: "`creating a component with <Redirect to=\"...\">` does not exist: `Redirect` is an `Error` subclass, not a component. Throw it via `redirect(url)` / `permanentRedirect(url)` or `new Redirect(url, status)`.",
			},
		],
	},
];