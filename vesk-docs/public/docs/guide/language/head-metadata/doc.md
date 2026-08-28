# Head & Metadata

Every page deserves its own `<title>`, description and social-preview
tags — even though Vesk apps render as single documents. The `<Head>`
element solves this: declare metadata anywhere in a component, and Vesk
collects it into the document's `<head>` on the server and keeps it
correct as users navigate on the client.

Components declare document metadata with a `<Head>` element. The
compiler collects it at build time and merges it into the SSR `<head>`;
during client-side navigation the incoming page's head is applied too.

## Basic usage

```vsk
component AboutPage() {
	<Head>
		<title>About — My App</title>
		<meta name="description" content="All about us" />
		<meta property="og:title" content="About" />
	</Head>

	<h1>About</h1>
}
```

- `<Head>` works in both body modes and may appear anywhere in the body.
- Collected tags are hoisted into `<head>` at render time.

## Deduplication

Head merging deduplicates by tag identity: a later `<title>` replaces an
earlier one, repeated `meta[name=…]` entries collapse, and page-level tags
override layout-level defaults. Supported managed elements include
`title`, `meta`, `link`, `style`, `script`, and `base`.

## Layout defaults + page overrides

```vsk
// app/layout.vsk — site-wide defaults
component Layout(props) {
	<html>
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>My App</title>
		</head>
		<body>{props.children}</body>
	</html>
}
```

```vsk
// app/blog/[slug]/page.vsk — per-page override
component Post(props: { params: { slug: string } }) {
	<Head>
		<title>{props.params.slug} — My App</title>
	</Head>
	…
}
```

## Client-side head management

During client-side navigation the router applies the target route's head
payload (delivered through the `X-Vesk-Data` JSON phase): title/meta/script/
link/style/base are inserted or updated in `document.head`, with the same
dedup rules. Head-only payloads do not re-render the page body — they just
refresh the cache markers.

## SEO

For structured data use the JSON-LD components (`<JsonLd>` +
schema helpers) — see [SEO](../../seo/doc.md). The SEO audit checks titles,
descriptions, OG tags and heading order across pages+layouts:

```sh
vesk seo            # report
vesk build --seo    # audit during build (--strict fails the build)
```
