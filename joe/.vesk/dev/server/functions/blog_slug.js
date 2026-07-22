import { renderFullPage, renderPage } from '../runtime.js';

const _src = `component BlogPost(props) {
	<div class="blog-post" data-testid="blog-post">
		<a href="/blog" data-testid="back-link">← Back to blog</a>
		<h1 data-testid="post-title">Post: {props.params.slug}</h1>
	</div>
}
`;
const _comp = "BlogPost";


export async function handle(request) {
  const url = new URL(request.url);
  const urlParts: string[] = url.pathname.split('/').filter(Boolean);
  const params = { "slug": urlParts[0] };

  const html = renderFullPage(_src, _comp, { params }, new Map(), { hydrate: true, cssUrl: "/_vesk/static/global.css" });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
