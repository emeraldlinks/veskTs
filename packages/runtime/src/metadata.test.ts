/**
 * The metadata API: shape, merge, serialization, and the static path.
 *
 * The reason this exists: both head bugs I hit were "silent and wrong" — an
 * expression the build-time evaluator could not resolve became an empty string,
 * and an already-escaped string became double-escaped in the tab. A static
 * `export const metadata` is evaluated in a sealed sandbox instead, so the two
 * headline cases are:
 *
 *   1. the head is CORRECT even when the component's frame cannot be evaluated
 *      (the empty-`<title>` bug), and
 *   2. it survives a page whose body throws — which is the case a crawler
 *      actually hits.
 *
 * Run with: npx tsx packages/runtime/src/metadata.test.ts
 */
import { defineMetadata, mergeMetadata, metadataToHtml, resolveTitle } from '@vesk/runtime/src/metadata';
import { renderStaticMetadataHtml } from '@vesk/compiler/src/server-head';
import { renderPage, renderFullPage } from '@vesk/compiler/src/server-codegen';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let chain: Promise<void> = Promise.resolve();
function it(name: string, fn: () => unknown): void {
  chain = chain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
      failures.push({ name, message: (e as Error).message });
    }
  });
}

const titleOf = (html: string): string | undefined => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
const attrOf = (html: string, re: RegExp): string | undefined => (html.match(re) || [])[1];

console.log('\n=== Metadata API ===');

it('defineMetadata is identity plus validation', () => {
  const meta = defineMetadata({ title: 'Docs', description: 'd' });
  assert(meta.title === 'Docs', 'the object was not returned as-is');
  let threw = false;
  try {
    defineMetadata({ descripton: 'typo' } as never);
  } catch (e) {
    threw = /unknown key "descripton"/.test((e as Error).message);
  }
  assert(threw, 'a typo in a metadata key was accepted — that is how it fails silently in a search result');
});

it('defineMetadata rejects the wrong types with a usable message', () => {
  const cases: Array<[() => unknown, RegExp]> = [
    [() => defineMetadata({ title: 42 } as never), /`title` must be a string/],
    [() => defineMetadata({ description: {} } as never), /`description` must be a string/],
    [() => defineMetadata({ openGraph: 'og' } as never), /`openGraph` must be a plain object/],
    [() => defineMetadata({ title: { nope: 1 } } as never), /unknown `title.nope`/],
    [() => defineMetadata([] as never), /must be a plain object/],
  ];
  for (const [fn, re] of cases) {
    let msg = '';
    try { fn(); } catch (e) { msg = (e as Error).message; }
    assert(re.test(msg), `expected ${re} got ${JSON.stringify(msg)}`);
  }
});

it('title resolution: literal, absolute, default, and a parent template', () => {
  assert(resolveTitle({ title: 'A' }) === 'A', 'literal');
  assert(resolveTitle({ title: { absolute: 'X' } }) === 'X', 'absolute wins over default');
  assert(resolveTitle({ title: { default: 'Site' } }) === 'Site', 'default');
  const parent = { title: { template: '%s | Site' } };
  assert(resolveTitle(parent, { title: 'Pricing' }) === 'Pricing | Site', 'template wraps the child title');
  assert(resolveTitle(parent) === null, 'a template alone produces no title');
  assert(resolveTitle(null) === null, 'no metadata, no title');
});

it('merge: page wins per field, nested groups merge, template survives', () => {
  const layout = defineMetadata({
    title: { template: '%s | Docs' },
    description: 'site description',
    openGraph: { siteName: 'Vesk', type: 'website' },
  });
  const page = defineMetadata({ title: 'Pricing', description: 'what it costs', openGraph: { title: 'Pricing' } });
  const merged = mergeMetadata(layout, page);
  assert(resolveTitle(merged) === 'Pricing', `merged title was ${resolveTitle(merged)}`);
  assert(merged.description === 'what it costs', 'the page description must win');
  const og = merged.openGraph as Record<string, unknown>;
  assert(og.siteName === 'Vesk' && og.type === 'website', 'layout OG fields were lost');
  assert(og.title === 'Pricing', "the page's OG title was lost");
  assert(mergeMetadata(null, undefined, page).title === 'Pricing', 'null sources must not break the merge');
});

it('metadataToHtml escapes text and attributes by their own rules', () => {
  const html = metadataToHtml({
    title: 'Tom & Jerry <fun>',
    description: 'a & b',
    openGraph: { title: 'og & title' },
  });
  assert(titleOf(html) === 'Tom &amp; Jerry &lt;fun&gt;', `title was ${JSON.stringify(titleOf(html))}`);
  assert(attrOf(html, /name="description" content="([^"]*)"/) === 'a &amp; b', 'description attribute escaping');
  // The double-escape bug: an attribute value must not be text-escaped.
  assert(!html.includes('&amp;amp;'), 'a value was escaped twice');
  assert(html.includes('<meta property="og:title" content="og &amp; title"'), `og:title missing: ${html}`);
});

it('metadataToHtml emits the tags a crawler actually reads', () => {
  const html = metadataToHtml({
    title: 'Pricing',
    description: 'What it costs',
    robots: { noindex: true, index: false, follow: true },
    alternates: { canonical: '/pricing', languages: { 'de': '/de/pricing' } },
    twitter: { card: 'summary_large_image' },
    themeColor: '#111',
  });
  for (const needle of [
    '<title data-vesk-head>Pricing</title>',
    'name="robots" content="noindex, follow"',
    'rel="canonical" href="/pricing"',
    'hreflang="de" href="/de/pricing"',
    'name="twitter:card" content="summary_large_image"',
    'name="theme-color" content="#111"',
  ]) {
    assert(html.includes(needle), `missing ${needle}\n  got: ${html.replace(/\n/g, ' ')}`);
  }
});

it('the sandbox evaluates a static metadata export and nothing else', () => {
  const html = renderStaticMetadataHtml("defineMetadata({ title: 'From the export', description: 'static' })");
  assert(titleOf(html) === 'From the export', `sandbox title was ${JSON.stringify(titleOf(html))}`);
  assert(html.includes('content="static"'), 'the sandbox dropped a field');
  // Nothing is in scope: a metadata declaration cannot read the request, a
  // component, or a global, so it can never be non-deterministic.
  assert(renderStaticMetadataHtml('defineMetadata({ title: process.env.SECRET })') === '', 'process leaked into the sandbox');
  assert(renderStaticMetadataHtml('defineMetadata({ title: globalThis.x })') === '', 'globalThis leaked into the sandbox');
  assert(renderStaticMetadataHtml('defineMetadata({ title: 1 })') === '', 'a validation failure was not caught');
  assert(renderStaticMetadataHtml(null) === '' && renderStaticMetadataHtml('') === '', 'absent metadata is not empty');
});

it('the static head is right where the interpolated one diverges', () => {
  // The interpolated head is a SECOND evaluation of the component's top-level
  // declarations, so it can only ever see their initializers. A `let` that is
  // reassigned — or a value derived from a call — silently renders the wrong
  // title while the body renders the right one. This is the class of bug the
  // docs site had (`<title>{doc.title} — Vesk Docs</title>` came out as
  // ` — Vesk Docs`), and it is not fixable in the evaluator: it is a second
  // evaluation by construction.
  const src = `export const metadata = defineMetadata({ title: 'Statement Mode', description: 'Markup as statements' })

component Page(props: { slug: string }) {
	let label = 'default'
	label = props.slug.toUpperCase()
	<Head>
		<title>{label} — Vesk Docs</title>
	</Head>
	<h1>{label}</h1>
}`;
  const r = renderPage(src, 'Page', { slug: 'pricing' }, new Map(), { hydrate: true }) as { body: string; head: string };
  assert(r.body.includes('PRICING'), `the body should render the reassigned value: ${r.body.slice(0, 120)}`);
  // The interpolated title is stale by construction; the static one is not.
  assert(r.head.includes('>Statement Mode</title>'), `static title missing: ${JSON.stringify(r.head)}`);
  assert(r.head.includes('content="Markup as statements"'), 'the static description was dropped');
});

it('static metadata is readable from a compiled file, before any render', async () => {
  // What a build step needs: SSG, the sitemap generator, an adapter, or an
  // error boundary wants the title of a route without rendering the route.
  const { compileFile } = await import('@vesk/compiler/src/server-codegen');
  const src = `export const metadata = defineMetadata({ title: 'Pricing', description: 'What it costs' })
component Page() { <h1>pricing</h1> }`;
  const compiled = compileFile(src);
  assert(compiled.metadataSource, 'compileFile did not surface the metadata source');
  const html = renderStaticMetadataHtml(compiled.metadataSource);
  assert(titleOf(html) === 'Pricing', `compiled metadata rendered ${JSON.stringify(titleOf(html))}`);
  // And a file without one says so, rather than being indistinguishable.
  assert(compileFile('component Page() { <h1>x</h1> }').metadataSource === null, 'a file with no metadata reported some');
});

it('a document with a static head carries it end to end', async () => {
  const src = `export const metadata = defineMetadata({ title: 'Pricing', description: 'What it costs', openGraph: { title: 'Pricing' } })
component Page() { <h1>pricing</h1> }`;
  const html = await renderFullPage(src, 'Page', {}, new Map(), { hydrate: true });
  assert(titleOf(html) === 'Pricing', `document title was ${JSON.stringify(titleOf(html))}`);
  assert(html.includes('property="og:title" content="Pricing"'), 'the og:title did not reach the document');
});

it('a file with no metadata export is untouched', async () => {
  const src = `component Page() { <h1>plain</h1> }`;
  const r = renderPage(src, 'Page', {}, new Map(), { hydrate: true }) as { head: string };
  assert(r.head === '', `expected an empty head, got ${JSON.stringify(r.head)}`);
});

void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All metadata tests passed!');
});
