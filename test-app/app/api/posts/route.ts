import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export interface Post {
	id: number;
	title: string;
	slug: string;
	excerpt: string;
	body: string;
	author: string;
	tags: string[];
	date: string;
}

const posts: Post[] = [
	{
		id: 1,
		title: 'Hello Vesk',
		slug: 'hello-vesk',
		excerpt: 'First post powered by Vesk — a compiler-first reactive UI framework for the post-VDOM web.',
		body: 'Vesk compiles your components to targeted, minimal JavaScript with a ripple-reactive runtime. No virtual DOM, no diffing — just direct DOM updates where things change.',
		author: 'Vesk Team',
		tags: ['intro', 'compiler'],
		date: '2026-07-01',
	},
	{
		id: 2,
		title: 'SSR in Vesk',
		slug: 'ssr-in-vesk',
		excerpt: 'How server-side rendering works, including awaiting in-flight fetches before writing the body.',
		body: 'Server components render to HTML while useFetch promises are in flight. The renderer awaits them, re-renders with data, and serializes the results so the client hydrates without re-fetching.',
		author: 'Vesk Team',
		tags: ['ssr', 'fetch'],
		date: '2026-07-08',
	},
	{
		id: 3,
		title: 'useFetch: SWR-style caching',
		slug: 'usefetch-caching',
		excerpt: 'Deduped in-flight requests, staleTime caching, keepPreviousData, retries with backoff, and timeouts.',
		body: 'Every useFetch call gets request deduplication by key, an optional staleTime cache with silent revalidation, keepPreviousData to keep old content on screen, exponential-backoff retries for GETs, and a timeout so slow endpoints never hang the UI.',
		author: 'Vesk Team',
		tags: ['fetch', 'caching'],
		date: '2026-07-15',
	},
	{
		id: 4,
		title: 'Reactivity without a VDOM',
		slug: 'no-vdom',
		excerpt: 'Ripple tracked cells and fine-grained effects mean only the exact nodes that changed are updated.',
		body: 'Tracked cells, derived values, and scoped effects let Vesk update exactly the DOM that depends on a change — no tree diffing, no reconciliation pass. Mutate a cell and the precise text nodes, attributes, or lists re-render.',
		author: 'Vesk Team',
		tags: ['reactivity', 'performance'],
		date: '2026-07-22',
	},
	{
		id: 5,
		title: 'Into tracked cells',
		slug: 'into-tracked-cells',
		excerpt: 'Point a fetch straight into a tracked cell with { into } and read it with plain tracked loops.',
		body: 'const &[posts] = track([]); useFetch(\'/api/posts\', { into: posts }). Server renders await the fetch, fill the cell, and the for-in loop renders the data inline — with the same cell driving the client-side UI after hydration.',
		author: 'Vesk Team',
		tags: ['tracked', 'fetch'],
		date: '2026-07-29',
	},
];

export async function GET(req: VeskRequest) {
	const delay = Math.min(Number(req.query.delay) || 0, 5000);
	if (delay > 0) await new Promise(r => setTimeout(r, delay));

	const failRate = Math.min(Number(req.query.fail) || 0, 100);
	if (failRate > 0 && Math.random() * 100 < failRate) {
		return VeskResponse.json({ error: 'simulated failure' }, { status: 503 });
	}

	const limit = Math.min(Number(req.query.limit) || posts.length, posts.length);
	const list = posts.slice(0, limit).map(({ body: _body, ...rest }) => rest);
	return VeskResponse.json(list);
}