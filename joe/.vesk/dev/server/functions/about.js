import { renderFullPage, renderPage } from '../runtime.js';

const _layoutSrc = `component AboutLayout(props) {
	<div class="about-layout border-2 border-green-300 rounded p-4">
		<h2 class="text-lg font-semibold text-green-700">About Section</h2>
		{props.children}
	</div>
}
`;
const _pageSrc = `component About {
	<div class="about-page">
		<h1 data-testid="about-title">About Vesk</h1>
		<p data-testid="about-desc">A compiler-first reactive UI framework</p>
		<button class="about-btn px-3 py-1 bg-green-500 text-white rounded"
			onClick={() => alert('about')}
			data-testid="about-btn">
			About Click
		</button>
	</div>
}
`;
const _layoutComp = "AboutLayout";
const _pageComp = "About";


export async function handle(request) {
  const url = new URL(request.url);
  const urlParts = url.pathname.split('/').filter(Boolean);
  const params = {};

  const page = renderPage(_pageSrc, _pageComp, { params }, new Map(), { hydrate: true });
  const html = renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, new Map(), { hydrate: true, cssUrl: "/_vesk/static/global.css" });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
