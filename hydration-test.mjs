/**
 * Hydration test using real SSR output from the test-app.
 * Tests SSR structure, hydration claiming, reactivity, SPA navigation.
 *
 * Usage: node hydration-test.mjs
 * Prerequisite: cd test-app && npx vesk build
 */
import { parseHTML } from 'linkedom';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_JS = resolve(__dirname, 'test-app', '.vesk', 'server', 'runtime.js');
const CLIENT_JS = resolve(__dirname, 'test-app', '.vesk', 'static', 'client.js');
const PAGE_SRC = resolve(__dirname, 'test-app', 'app', 'page.vsk');
const LAYOUT_SRC = resolve(__dirname, 'test-app', 'app', 'layout.vsk');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function setupFromHtml(html, url = 'http://localhost:3000/') {
  const { document, window } = parseHTML(html);
  const loc = new URL(url);
  const location = {
    protocol: loc.protocol, host: loc.host, hostname: loc.hostname,
    port: loc.port, pathname: loc.pathname, search: loc.search,
    hash: loc.hash, href: loc.href, origin: loc.origin,
    ancestorOrigins: [], assign() {}, reload() {}, toString() { return this.href; },
    replace(u) { this.href = new URL(u, this.href).href; },
  };
  const history = {
    _stack: [{ url: location.href, state: null }], _index: 0, length: 1, state: null,
    scrollRestoration: 'auto',
    pushState(state, _, url) {
      const r = new URL(url, location.href);
      Object.assign(location, { href: r.href, pathname: r.pathname, search: r.search, hash: r.hash });
      this._stack = this._stack.slice(0, ++this._index);
      this._stack.push({ url: r.href, state }); this.length = this._stack.length; this.state = state;
    },
    replaceState(state, _, url) {
      const r = new URL(url, location.href);
      Object.assign(location, { href: r.href, pathname: r.pathname, search: r.search, hash: r.hash });
      this._stack[this._index] = { url: r.href, state }; this.state = state;
    },
    go(delta) {
      const i = this._index + delta;
      if (i >= 0 && i < this._stack.length) {
        this._index = i; const e = this._stack[i];
        Object.assign(location, { href: e.url, pathname: new URL(e.url).pathname, search: new URL(e.url).search, hash: new URL(e.url).hash });
        this.state = e.state; window.dispatchEvent(new window.Event('popstate'));
      }
    },
    back() { this.go(-1); }, forward() { this.go(1); },
  };
  window.location = location; window.history = history;

  const g = globalThis;
  for (const [k, v] of Object.entries({
    window, document, location, history, Event: window.Event,
    CustomEvent: window.CustomEvent, Node: window.Node, Element: window.Element,
    HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    console: g.console, URL: g.URL, setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout, setInterval: g.setInterval,
    clearInterval: g.clearInterval, requestAnimationFrame: cb => setTimeout(cb, 16),
    cancelAnimationFrame: id => clearTimeout(id), WebSocket: function WebSocket() {},
  })) g[k] = v;
  try { g.navigator = { userAgent: 'linkedom' }; } catch(e) {
    Object.defineProperty(g, 'navigator', { value: { userAgent: 'linkedom' }, configurable: true });
  }
  return { document, window };
}

function runClientBundle() {
  const code = readFileSync(CLIENT_JS, 'utf-8');
  new Function(code
    .replace(/^import\s+.*?['"][^'"]+['"];?\s*\n?/gm, '')
    .replace(/^export\s*\{[^}]+\}\s*;\s*\n?/gm, '')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    + '\nglobalThis.__NavLink = typeof NavLink !== "undefined" ? NavLink : undefined;'
  )();
}

async function getRealSsrHtml() {
  const { renderPage, renderFullPage } = await import(RUNTIME_JS);
  const pageSrc = readFileSync(PAGE_SRC, 'utf-8');
  const layoutSrc = readFileSync(LAYOUT_SRC, 'utf-8');
  const page = renderPage(pageSrc, 'Home', { params: {} }, new Map(), { hydrate: true });
  const fullHtml = await renderFullPage(layoutSrc, 'Layout', { params: {}, children: page.body }, new Map(), { hydrate: true });
  return fullHtml;
}

async function main() {
  if (!existsSync(CLIENT_JS)) {
    console.error('Client bundle not found. Run `cd test-app && npx vesk build` first.');
    process.exit(1);
  }

  // 1. Get real SSR HTML from test-app
  console.log('=== SSR OUTPUT (from test-app) ===\n');
  const rawHtml = await getRealSsrHtml();

  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const ssrBody = bodyMatch ? bodyMatch[1] : '';
  console.log(ssrBody.trim() + '\n');

  // 2. SSR assertions
  console.log('=== SSR ASSERTIONS ===\n');
  {
    // NavLink SSR
    assert(ssrBody.includes('<a href="/"'), 'SSR has <a href="/">');
    assert(ssrBody.includes('<a href="/about"'), 'SSR has <a href="/about">');
    assert(ssrBody.includes('<a href="/blog"'), 'SSR has <a href="/blog">');
    assert(ssrBody.includes('Home'), 'SSR nav has Home label');
    assert(ssrBody.includes('About'), 'SSR nav has About label');
    assert(ssrBody.includes('Blog'), 'SSR nav has Blog label');

    // SSR hydration markers
    assert(ssrBody.includes('<!--vsk-->'), 'SSR has <!--vsk--> markers');
    const vskCount = (ssrBody.match(/<!--vsk-->/g) || []).length;
    assert(vskCount >= 10, 'SSR has enough <!--vsk--> markers (' + vskCount + ')');

    // SSR count value
    const countMatch = ssrBody.match(/<p[^>]*>\s*(\d+)\s*<\/p>/);
    assert(countMatch !== null, 'SSR has count <p> element');
    if (countMatch) {
      assert(countMatch[1] === '10', 'SSR count is 10 (got: ' + countMatch[1] + ')');
    }
  }

  // 3. Post-hydration assertions
  console.log('\n=== POST-HYDRATION ASSERTIONS ===\n');
  {
    setupFromHtml(rawHtml);
    runClientBundle();
    await wait(300);
    const d = globalThis.document;
    const NavLink = globalThis.__NavLink;

    // NavLink function exists
    assert(typeof NavLink === 'function', 'typeof NavLink === "function"');

    // Count after hydration (still 10, no click yet)
    const countPs = Array.from(d.querySelectorAll('main > p'));
    const countText = countPs.map(p => p.textContent.trim()).find(t => /^\d+$/.test(t));
    assert(countText === '10', 'count is 10 after hydration (got: ' + countText + ')');

    // SSR elements claimed correctly
    const nav = d.querySelector('nav');
    assert(nav !== null, '<nav> exists after hydration');
    assert(nav.textContent.includes('Home'), 'nav has Home link after hydration');

    const links = d.querySelectorAll('nav a');
    assert(links.length >= 3, 'nav has 3+ <a> links after hydration');
    assert(links[0].getAttribute('href') === '/', 'first link href="/"');
    assert(links[1].getAttribute('href') === '/about', 'second link href="/about"');
    assert(links[2].getAttribute('href') === '/blog', 'third link href="/blog"');

    // Page content hydrated correctly
    const h1 = d.querySelector('h1');
    assert(h1 !== null, '<h1> exists after hydration');
    const main = d.querySelector('main');
    assert(main !== null, '<main> exists after hydration');
    const btn = d.querySelector('button');
    assert(btn !== null, 'button exists after hydration');

    // Direct NavLink call in create mode (simulating SPA)
    if (typeof NavLink === 'function') {
      const walker = { nextElement(tag) { return document.createElement(tag || 'div'); }, subWalker() { return this; }, done() { return true; } };
      const result = NavLink({ href: '/test', children: 'TestLabel' }, new Map(), walker);
      assert(typeof result === 'object', 'NavLink() returns object');
      assert(result.nodeType === 1, 'NavLink() returns Element (nodeType=1)');
      assert(result.tagName === 'A', 'NavLink() returns <a> element');
      assert(result.textContent === 'TestLabel', 'NavLink() <a> has correct text');
      assert(result.getAttribute('href') === '/test', 'NavLink() <a> has correct href');
    }
  }

  // 4. Reactivity
  console.log('\n=== REACTIVITY ===\n');
  {
    setupFromHtml(rawHtml);
    runClientBundle();
    await wait(200);
    const d = globalThis.document;

    const btn = d.querySelector('button');
    assert(btn !== null, 'button exists');

    // Count starts at 10 after hydration
    const beforePs = Array.from(d.querySelectorAll('main > p'));
    const beforeCount = beforePs.map(p => p.textContent.trim()).find(t => /^\d+$/.test(t));
    assert(beforeCount === '10', 'initial count is 10 before click (got: ' + beforeCount + ')');

    if (btn) {
      const evt = new globalThis.Event('click', { bubbles: true });
      Object.defineProperty(evt, 'button', { value: 0 });
      btn.dispatchEvent(evt);
      await wait(100);
    }

    const afterPs = Array.from(d.querySelectorAll('main > p'));
    const afterCount = afterPs.map(p => p.textContent.trim()).find(t => /^\d+$/.test(t));
    assert(afterCount === '11',
      'count updated to 11 after click (got: ' + afterCount + ')');
  }

  // 5. SPA navigation
  console.log('\n=== SPA NAVIGATION ===\n');
  {
    setupFromHtml(rawHtml);
    runClientBundle();
    await wait(200);
    const d = globalThis.document;

    const aboutLink = d.querySelector('nav a[href="/about"]');
    assert(aboutLink !== null, 'About link exists before SPA');

    if (aboutLink) {
      const evt = new globalThis.Event('click', { bubbles: true });
      Object.defineProperty(evt, 'button', { value: 0 });
      aboutLink.dispatchEvent(evt);
      await wait(300);
    }

    // URL changed
    const path = globalThis.location.pathname;
    assert(path === '/about' || path.endsWith('/about'), 'URL changed to /about, got: ' + path);

    // Nav still exists with fresh links
    const nav = d.querySelector('nav');
    assert(nav !== null, 'nav exists after SPA navigation');

    const navLinks = nav ? Array.from(nav.querySelectorAll('a')) : [];
    assert(navLinks.length >= 3, 'nav has 3+ links after SPA (got: ' + navLinks.length + ')');
    assert(navLinks.some(l => l.textContent.includes('Home')), 'nav has Home link after SPA');
    assert(navLinks.some(l => l.textContent.includes('About')), 'nav has About link after SPA');
    assert(navLinks.some(l => l.textContent.includes('Blog')), 'nav has Blog link after SPA');

    navLinks.forEach((link, i) => {
      assert(link.getAttribute('href') !== null, 'link ' + i + ' has href');
      assert(link.textContent.trim().length > 0, 'link ' + i + ' has text');
    });
  }

  const total = passed + failed;
  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${total} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed!');
}

main().catch(e => {
  process.stderr.write('Test error: ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
