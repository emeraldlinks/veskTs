# Static Site Generation (SSG)

Pages can prerender to static HTML at build time — zero-JS output for
fully static trees.

## Enable

```ts
// vesk.config.ts
export default defineConfig({ ssg: {} });
```

## `getStaticProps`

Export it from a `page.vsk` to fetch data at build time. The returned
`props` spread into the page's props; the payload also serializes into the
page's data script.

```vsk
export function getStaticProps() {
	return {
		props: { items: [1, 2, 3] },
	};
}

component List(props) {
	for (const item of props.items) {
		<li>{item}</li>
	}
}
```

Async works too (`export async function getStaticProps()`).

## `getStaticPaths`

For dynamic routes, enumerate params at build time — one HTML file per
path:

```ts
// app/blog/[slug]/page.vsk
export async function getStaticPaths() {
	const posts = await fetchPosts();
	return {
		paths: posts.map((p) => ({ params: { slug: p.slug } })),
	};
}

component Post(props: { params: { slug: string } }) {
	<h1>{props.params.slug}</h1>
}
```

## Output

```
dist/
└── prerendered/
    ├── index.html          # "/" 
    ├── about.html          # "/about"
    └── blog/
        └── hello.html      # "/blog/hello"
```

- Prerendered pages ship **no client JS** when their trees are fully
  static (no markers → no hydration runtime).
- Paths are containment-checked — a malicious `getStaticPaths` cannot
  write outside `prerendered/`.
- The production server serves prerendered entries before middleware/SSR.

## Combining with SSR

Unlisted dynamic paths still fall through to normal SSR — SSG covers the
known set, SSR handles the rest. Pair with [ISR](../isr/doc.md)
(`export const revalidate`) for cached-but-refreshing pages.

## Build summary

The build logs `ssg → prerendered/ (N pages)`; each page appears in the
manifest under `prerendered`, and generated sitemap entries prioritize
them (0.80 / weekly).
