import { renderFullPage, renderPage } from '../runtime.js';

const _layoutSrc = `component BlogLayout(props) {
	<div class="blog-layout border-2 border-blue-300 rounded p-4">
		<h2 class="text-lg font-semibold text-blue-700">Blog</h2>
		{props.children}
	</div>
}
`;
const _pageSrc = `component BlogList {
	<div class="blog-list" data-testid="blog-list">
		<h1 class="text-xl font-bold" data-testid="blog-title">Blog Posts</h1>
		<ul>
			<li><a href="/blog/first-post" data-testid="post-link-1">First Post</a></li>
			<li><a href="/blog/second-post" data-testid="post-link-2">Second Post</a></li>
		</ul>
	</div>
}
`;
const _layoutComp = "BlogLayout";
const _pageComp = "BlogList";


export async function handle(request) {
  const url = new URL(request.url);
  const urlParts = url.pathname.split('/').filter(Boolean);
  const params = {};

  const page = renderPage(_pageSrc, _pageComp, { params }, new Map(), { hydrate: true });
  const html = renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, new Map(), { hydrate: true, cssUrl: "/_vesk/static/global.css", clientScriptUrl: "/_vesk/static/client.js" });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
