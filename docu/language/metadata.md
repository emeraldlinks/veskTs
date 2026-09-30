# Metadata

A route's head can be declared as **data** instead of markup:

```ts
import { defineMetadata } from '@vesk/runtime'

export const metadata = defineMetadata({
  title: 'Pricing',
  description: 'What it costs, and what it does not.',
  openGraph: { title: 'Pricing', image: '/og.png' },
  alternates: { canonical: '/pricing', languages: { de: '/de/pricing' } },
  themeColor: '#111',
})
```

## Why not `<Head><title>{…}</title></Head>`

Because `<Head>` is markup, so its values are **expressions the build has to
evaluate outside the component's frame**. That is a second evaluation by
construction, and a second evaluation can be wrong in ways nothing reports:

- an expression that needs an import rendered as an **empty string** — the docs
  site shipped `<title> — Vesk Docs</title>` for a whole afternoon because
  `{doc.title}` came from an import the head pass could not see;
- a value the evaluator could only partly see (a `let` reassigned after its
  declaration) rendered **stale**, while the body rendered the right one;
- an already-escaped string came back **double-escaped** in the tab title.

`export const metadata` is a static declaration, so it is evaluated in a
**sealed sandbox** with exactly one binding in scope (`defineMetadata`) and no
access to the request, the component, or globals. It cannot depend on a frame
resolving, and it cannot be non-deterministic. If you need state, that is
`<Head>` — the reactive path — and both are merged, with the static one first.

## What is checked, and when

`defineMetadata` validates its input at module load and throws with a precise
message: `title` must be a string or `{ default, template, absolute }`,
`description` a string, `openGraph`/`twitter`/`alternates` objects, and **any
unknown top-level key is an error** — `descripton` and `ogTitle` are the two
that actually happen, and both fail silently everywhere downstream.

The serialization (`metadataToHtml`) is the single path both the build and the
runtime use, with text and attributes escaped by their own rules — escaping a
`content` attribute as text is how you get `&amp;amp;` in a description.

## Layouts and templates

A layout can set defaults that pages inherit, with a title template:

```ts
// app/docs/layout.vsk
export const metadata = defineMetadata({
  title: { template: '%s — Vesk Docs' },
  description: 'Guides and reference.',
  openGraph: { siteName: 'Vesk Docs' },
})
```

```ts
// app/docs/pricing/page.vsk
export const metadata = defineMetadata({ title: 'Pricing' })   // → "Pricing — Vesk Docs"
```

`mergeMetadata` resolves this: a page wins per field, `openGraph`/`twitter`
merge field-wise, and a parent's template survives to wrap the child's title.

## Reading it without rendering

`compileFile(source).metadataSource` exposes the declaration, so a build step —
SSG, the sitemap generator, an adapter, an error boundary that wants a title —
can serialize a route's head without rendering the route:

```ts
const file = compileFile(source, { sourcePath })
const html = metadataToHtml(evaluateStaticMetadata(file.metadataSource))
```
