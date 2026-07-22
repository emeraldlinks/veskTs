import { renderFullPage, renderPage } from '../runtime.js';

const _layoutSrc = `import { NavLink } from '@vesk/runtime';

component RootLayout(props) {
	<nav class="flex gap-4 px-6 py-3 border-b bg-white nav-root">
		<NavLink href="/" class="font-medium">Home</NavLink>
		<NavLink href="/about" class="font-medium">About</NavLink>
		<NavLink href="/blog" class="font-medium">Blog</NavLink>
	</nav>
	<main class="p-4">{props.children}</main>
	<footer class="text-center py-4 text-sm text-gray-400">
		<p>Vesk Footer</p>
	</footer>
}
`;
const _pageSrc = `import { track } from '@vesk/runtime';

component Home {
	const count = track(0);
	<div class="home-page">
		<h1 class="text-2xl font-bold" data-testid="home-title">Home</h1>
		<p data-testid="home-desc">Welcome to the Vesk test app</p>
		<button class="btn-counter px-4 py-2 bg-blue-500 text-white rounded"
			onClick={() => count.set(count.get() + 1)}
			data-testid="counter-btn">
			Count: <span data-testid="counter-value">{count.get()}</span>
		</button>
		<button class="px-4 py-2 bg-red-500 text-white rounded ml-2"
			onClick={() => count.set(0)}
			data-testid="reset-btn">
			Reset
		</button>
	</div>
}
`;
const _layoutComp = "RootLayout";
const _pageComp = "Home";


export async function handle(request) {
  const url = new URL(request.url);
  const urlParts: string[] = url.pathname.split('/').filter(Boolean);
  const params = {};

  const page = renderPage(_pageSrc, _pageComp, { params }, new Map(), { hydrate: true });
  const html = renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, new Map(), { hydrate: true, cssUrl: "/_vesk/static/global.css" });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
