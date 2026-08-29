# SEO

Being found is a feature. Vesk covers search visibility from three sides:
JSON-LD components that emit rich structured data (articles, products,
FAQs…), automatic `sitemap.xml` and `robots.txt` generation at build
time, and an audit command that reviews every page for common issues —
missing titles, broken heading order, absent alt text — before your
users' search engines do.

## JSON-LD

`<JsonLd>` serializes a schema.org payload into a `ld+json` script. On the
server it returns the script tag directly (with `</script>` escaped inside
the JSON); on the client it appends to `<head>` once per data key.

```vsk
import { JsonLd, ArticleSchema } from '@vesk/runtime';

component ArticlePage(props) {
	<JsonLd schema={ArticleSchema({
		headline: props.post.title,
		description: props.post.excerpt,
		author: props.post.author,
		datePublished: props.post.date,
		image: props.post.cover,
	})} />
	<article>…</article>
}
```

```ts
/** Render a JSON-LD script tag. Uses schema || children || {}. */
function JsonLd(props: {
	schema?: Record<string, unknown>;
	children?: Record<string, unknown>;
	key?: string;
}): string | null;
```

All schema helpers return **plain objects** (no `@context`) — wrap them in
`<JsonLd schema={…}>`.

```ts
function ArticleSchema(a: {
	headline: string; description?: string; author: string | string[];
	datePublished: string; dateModified?: string; image?: string | string[];
	publisher?: string; url?: string;
}): Record<string, unknown>;
// dateModified defaults to datePublished; authors become Person nodes.

function ProductSchema(p: {
	name: string; description?: string; image?: string | string[];
	sku?: string; brand?: string; price?: string;
	currency?: string /* default 'USD' */; inStock?: boolean; url?: string;
	reviews?: { rating: number; author: string; body?: string }[];
	aggregateRating?: { value: number; count: number };
}): Record<string, unknown>;

function FAQPageSchema(faqs: { question: string; answer: string }[]): Record<string, unknown>;

function BreadcrumbListSchema(items: { name: string; url: string }[]): Record<string, unknown>;

function OrganizationSchema(o: {
	type?: string /* default 'Organization' */;
	name: string; url?: string; logo?: string; description?: string;
	sameAs?: string[];
	contactPoint?: { telephone: string; contactType?: string; email?: string };
	address?: { streetAddress?, addressLocality?, addressRegion?,
	            postalCode?, addressCountry? };
}): Record<string, unknown>;

function LocalBusinessSchema(b: OrganizationData & {
	subtype?: string /* default 'LocalBusiness' */;
	hours?: { days: string; open: string; close: string }[];
	priceRange?: string; telephone?: string;
}): Record<string, unknown>;

function VideoSchema(v: {
	name: string; description?: string; thumbnailUrl?: string | string[];
	uploadDate?: string; duration?: string; contentUrl?: string;
	embedUrl?: string; viewCount?: number;
}): Record<string, unknown>;
```

## Metadata

Use `<Head>` for titles/meta/OG tags — see
[Head & Metadata](../language/head-metadata/doc.md).

## Sitemap & robots.txt

Generated automatically at build (unless you supply your own in
`public/`):

- `sitemap.xml` — prerendered pages at priority 0.80 / weekly; static SSR
  routes 0.64 / daily; deduplicated; base URL from `siteUrl` build option
  (default `http://localhost:3000`)
- `robots.txt` — allow-all plus `Sitemap:` line

Both land in `.vesk/static/public/`.

## SEO audit

```sh
vesk seo              # report per page
vesk seo --strict     # exit 1 when errors exist
vesk build --seo      # run during build
vesk build --seo --strict   # SEO errors FAIL the build
```

Each `page.vsk` is audited combined with its sibling `layout.vsk`. Checks:

| Check | Severity |
| --- | --- |
| `h1` — exactly one h1 present | error if none, warn if multiple |
| `altText` — plain `<img>` alt attributes | warn |
| `imageAlt` — `<Image>` alt prop | warn |
| `metaDescription` | warn when missing |
| `ogTags` — og:title / og:description / og:image | warn each missing |
| `langAttr` — html lang attribute | warn |
| `title` — title/head title | warn when missing |
| `headingOrder` — no skipped heading levels | warn |

Status per page: `PASS` / `PASS_WARN` / `FAIL`.
