import {
  renderDefaultPage,
  renderDefaultNotFoundPage,
  renderDefaultErrorPage,
  renderDefaultErrorFragment,
  escapeDefaultPageHtml,
} from '@vesk/adapter/src/default-pages';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

// ── 404 page ────────────────────────────────────────────────────────────────
{
  const html = renderDefaultNotFoundPage({ url: '/missing/page' });
  assert(html.startsWith('<!DOCTYPE html>'), '404 page is a full document');
  assert(html.includes('<title>404 — Not Found</title>'), '404 page sets the document title');
  assert(html.includes('data-vesk-default-page="404"'), '404 page carries the status marker');
  assert(html.includes('This page could not be found.'), '404 page shows the Next.js-style message');
  assert(html.includes('/missing/page'), '404 page renders the requested path');
  assert(html.includes('href="/"'), '404 page offers a Back to home link by default');
  assert(html.includes('<style>'), '404 page inlines its styles (self-contained)');
  assert(!html.includes('id="root"'), '404 page is not a mount root for the app');
}

// ── light-default theme ───────────────────────────────────────────────────
{
  const html = renderDefaultNotFoundPage();
  // Default (no media query) must be the light band; dark is the override.
  const lightAt = html.indexOf(':root{color-scheme:light');
  const darkAt = html.indexOf('@media (prefers-color-scheme:dark)');
  assert(lightAt !== -1, 'theme defaults to light');
  assert(darkAt !== -1, 'theme provides a dark-mode override');
  assert(lightAt < darkAt, 'light is the base rule and dark the media override');
  assert(html.includes('color-scheme:dark'), 'dark override actually flips color-scheme');
  assert(html.includes('@media (prefers-color-scheme:dark){:root{color-scheme:dark'), 'dark tokens are scoped inside the media query');
}

// ── 500 page ──────────────────────────────────────────────────────────────
{
  const html = renderDefaultErrorPage();
  assert(html.includes('data-vesk-default-page="500"'), '500 page carries the status marker');
  assert(html.includes('Internal Server Error'), '500 page shows the generic message');
  assert(html.includes(' — Internal Server Error</title>'), '500 page sets the document title');
  assert(html.includes('vsk-page--error'), '500 page paints the accent variant');
  assert(!html.includes('Back to home'), '500 page omits the home action');

  const exposed = renderDefaultErrorPage({ message: 'boom: null deref' });
  assert(exposed.includes('boom: null deref'), '500 page can surface a caller-supplied (dev) message');

  const escaped = renderDefaultErrorPage({ message: '<script>alert(1)</script>' });
  assert(!escaped.includes('<script>alert(1)</script>'), '500 message is HTML-escaped');
  assert(escaped.includes('&lt;script&gt;'), 'escaped message is entity-encoded');
}

// ── options ───────────────────────────────────────────────────────────────
{
  const custom = renderDefaultPage({ status: 418, title: 'Teapot', message: 'short and stout', homeHref: null });
  assert(custom.includes('data-vesk-default-page="418"'), 'renderDefaultPage honors a custom status');
  assert(!custom.includes('href="/"'), 'homeHref: null omits the action');

  const head = renderDefaultPage({ headExtra: '<meta name="x" content="y">' });
  assert(head.includes('<meta name="x" content="y">'), 'headExtra is injected into <head>');
}

// ── escaping ──────────────────────────────────────────────────────────────
{
  assert(escapeDefaultPageHtml('<a href="x">&\'</a>') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;', 'escaping covers < > & " and \'');
}

// ── in-layout fragment ────────────────────────────────────────────────────
{
  const frag = renderDefaultErrorFragment();
  assert(frag.startsWith('<div'), 'fragment is a bare element, not a document');
  assert(!frag.includes('<!DOCTYPE html>'), 'fragment is not a full document');
  assert(frag.includes('data-vesk-default-error-fragment="500"'), 'fragment carries the status marker');
  assert(frag.includes('Internal Server Error'), 'fragment shows the message');
  assert(renderDefaultErrorFragment({ message: 'x' }).includes('>x<'), 'fragment accepts a custom message');
}

// ── no bare fallbacks remain in the servers ────────────────────────────────
{
  const prod = readFileSync(resolve(__dirname, 'prod-server.ts'), 'utf-8');
  assert(!prod.includes('<h1>404</h1>'), 'prod-server has no bare 404 HTML');
  assert(!prod.includes('<h1>500</h1>'), 'prod-server has no bare 500 HTML');
  assert(prod.includes('renderDefaultNotFoundPage'), 'prod-server uses the branded 404');
  assert(prod.includes('renderDefaultErrorPage'), 'prod-server uses the branded 500');

  const dev = readFileSync(resolve(__dirname, 'dev-server.ts'), 'utf-8');
  assert(!dev.includes('<h1>404</h1>'), 'adapter dev-server has no bare 404 HTML');
  assert(!dev.includes('<h1>500</h1>'), 'adapter dev-server has no bare 500 HTML');

  const platform = readFileSync(resolve(__dirname, 'platform-handler.ts'), 'utf-8');
  assert(!platform.includes('<h1>404</h1>'), 'platform handler has no bare 404 HTML');
  assert(platform.includes('renderDefaultNotFoundPage'), 'platform handler generates the branded 404');

  const router = readFileSync(resolve(__dirname, '..', '..', 'runtime', 'src', 'router.ts'), 'utf-8');
  assert(!router.includes('<h1>404'), 'runtime router has no bare 404 HTML');
  assert(!router.includes('<h1>500'), 'runtime router has no bare 500 HTML');
  assert(router.includes('defaultErrorHtml('), 'runtime router uses the shared fallback helper');
}

console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550\n`);
process.exit(failed > 0 ? 1 : 0);
