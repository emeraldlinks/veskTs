type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "metadata",
    title: "Metadata",
    description:
      "Declare a route's title, description, Open Graph and alternates as data, with a static head that does not depend on the component's frame.",
    group: "Runtime",
    blocks: [
      {
        kind: "p",
        text:
          "A route can declare its head as DATA instead of markup. `export const metadata = defineMetadata({...})` is evaluated at build time in a sealed sandbox, so the head is correct even when the component's own frame is not evaluable — which is the case that silently produces an empty `<title>` when you interpolate the value into `<Head>` instead.",
      },
      {
        kind: "code",
        filename: "app/pricing/page.vsk",
        language: "vsk",
        code: `import { defineMetadata } from '@vesk/runtime'

export const metadata = defineMetadata({
  title: 'Pricing',
  description: 'What it costs, and what it does not.',
  openGraph: { title: 'Pricing', image: '/og.png' },
  alternates: { canonical: '/pricing', languages: { de: '/de/pricing' } },
  themeColor: '#111',
})

component Page() {
  <h1>Pricing</h1>
}`,
      },
      { kind: "h2", text: "Why not <Head> with an expression" },
      {
        kind: "p",
        text:
          "`<Head>` is markup, so its values are expressions the BUILD re-evaluates outside the component's call frame. That is a second evaluation by construction, and a second evaluation can be wrong without reporting anything:",
      },
      {
        kind: "list",
        items: [
          "an expression that needs an import renders as an EMPTY string — a docs site shipped `<title> — Vesk Docs</title>` because `{doc.title}` came from an import the head pass could not see.",
          "a value the evaluator can only partly see (a `let` reassigned after its declaration) renders STALE, while the body renders the right one.",
          "an already-escaped string comes back DOUBLE-ESCAPED in the tab title, because HTML source was assigned to `textContent`.",
        ],
      },
      {
        kind: "p",
        text:
          "A metadata declaration is evaluated with exactly one binding in scope (`defineMetadata`) and no access to the request, the component, or globals, so it cannot depend on a frame resolving and cannot be non-deterministic. If you need state, that is `<Head>` — the reactive path — and both are merged, static first.",
      },
      { kind: "h2", text: "What is checked, and when" },
      {
        kind: "p",
        text:
          "`defineMetadata` validates its input at module load and throws with a precise message. Unknown top-level keys are a hard error, because `descripton` and `ogTitle` are the two that actually happen, and both fail silently everywhere downstream.",
      },
      {
        kind: "table",
        head: ["Field", "Type"],
        rows: [
          ["title", "string, or `{ default, template, absolute }`"],
          ["description", "string"],
          ["openGraph", "`{ title, description, url, siteName, image, type }`"],
          ["twitter", "`{ card, site, title, description, image }`"],
          ["robots", "string, or `{ noindex, follow, ... }`"],
          ["alternates", "`{ canonical, languages: { 'de': '/de/pricing' } }`"],
          ["themeColor", "string"],
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "The serializer is the same code for the build and the runtime, with text and attributes escaped by their own rules — escaping a `content` attribute as text is how you get `&amp;amp;` in a description.",
      },
      { kind: "h2", text: "When it is NOT enough: a dynamic title" },
      {
        kind: "p",
        text:
          "A metadata declaration is static, so it cannot express a title that depends on the route. This very site is the case: `/docs/[slug]` serves 26 pages, and each one's title comes from the document it resolved. That is `<Head>`'s job, and it works — the page it renders is correct after hydration.",
      },
      {
        kind: "code",
        filename: "app/docs/[slug]/page.vsk",
        language: "vsk",
        code: `import { getDoc } from '../../../src/content/docs'

// Static per-route metadata for the layout and the index…
export const metadata = defineMetadata({ title: { template: '%s — Vesk Docs' } })

component DocsPage(props: { params: { slug: string } }) {
  const doc = getDoc(props.params.slug)
  if (!doc) throw new NotFoundError()

  // …and a dynamic title for the page itself, merged with the above.
  return (
    <>
      <Head>
        <title>{doc.title} — Vesk Docs</title>
        <meta name="description" content={doc.description} />
      </Head>
      <article><h1>{doc.title}</h1></article>
    </>
  )
}`,
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "Order matters when you mix them: the static declaration is emitted FIRST and the interpolated one after, so a dynamic `<title>` wins the browser's title bar (there is only one) while the static tags you did not duplicate are still there. If you find yourself writing a dynamic title, ask whether it could be a route of its own — `metadata` is the better answer wherever the value is knowable at build time.",
      },
      { kind: "h2", text: "Layouts and title templates" },
      {
        kind: "p",
        text:
          "A layout can set defaults that pages inherit, and a title template wraps the page's title. `mergeMetadata` gives the page precedence per field, merges `openGraph`/`twitter` field-wise, and keeps the parent's template.",
      },
      {
        kind: "code",
        filename: "app/docs/layout.vsk + app/docs/pricing/page.vsk",
        language: "vsk",
        code: `// app/docs/layout.vsk
import { defineMetadata } from '@vesk/runtime'

export const metadata = defineMetadata({
  title: { template: '%s — Vesk Docs' },
  description: 'Guides and reference.',
  openGraph: { siteName: 'Vesk Docs' },
})

// app/docs/pricing/page.vsk  →  <title>Pricing — Vesk Docs</title>
export const metadata = defineMetadata({ title: 'Pricing' })`,
      },
      { kind: "h2", text: "Reading it without rendering" },
      {
        kind: "p",
        text:
          "`compileFile(source).metadataSource` exposes the declaration, so a build step — SSG, the sitemap generator, an adapter, or an error boundary that wants a title — can serialize a route's head without rendering the route. That is how the head can be right for a page whose body throws.",
      },
      { kind: "h2", text: "Islands: data that must not hold the document" },
      {
        kind: "p",
        text:
          "SSR waits for every resource a render starts, and the body is flushed as one piece. For data that belongs to a `client` island that is usually the wrong trade: the island's server output is a placeholder the client fills on hydration anyway, so the wait delays every other byte on the page to buy a request the client was going to make.",
      },
      {
        kind: "code",
        filename: "components/Feed.vsk",
        language: "vsk",
        code: `component Feed client {
  // fetched during SSR, but the DOCUMENT does not wait for it
  const feed = useFetch('/api/feed', { ssr: 'defer' })
  return <ul>{feed.value.items.map((i) => <li>{i.title}</li>)}</ul>
}`,
      },
      {
        kind: "table",
        head: ["`ssr`", "Document behaviour"],
        rows: [
          ["`'wait'` (default)", "Holds until the resource settles, so the data is in the SSR hydration handoff."],
          ["`'defer'`", "Starts the fetch, stays out of the settle barrier. Data is left out of the handoff when it loses the race; the island fetches on hydration."],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "For data that is part of the page's critical path, prefer `async component` + `await useFetch` over any fallback: no placeholder, no patch, no flash. Vesk has no `Suspense` primitive by design — `await` for the critical path, `{#if (loading)}` or an island for everything else.",
      },
    ],
  },
];
