/**
 * Hydration test using real SSR output from the test-app.
 * Launches headless Chromium via puppeteer-core against a running dev server.
 *
 * Usage: node hydration-test.mjs
 * Prerequisite: cd test-app && npm run dev (or vesk dev) running on port 3000
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let browser;

async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── Test 1: Initial load ──────────────────────────
  console.log('\n=== TEST 1: Initial load ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    assert(errors.length === 0, 'Zero JS errors on load (got ' + errors.length + ': ' + errors.join(', ') + ')');

    const rootChildren = await page.evaluate(() => {
      const root = document.getElementById('root');
      return root ? root.children.length : 0;
    });
    assert(rootChildren >= 3, `#root has ${rootChildren} children`);

    const navText = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    assert(navText.includes('Home') && navText.includes('About') && navText.includes('Blog'),
      'nav links: ' + navText);

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent.trim() : '';
    });
    assert(h1 === 'Welcome to Vesk', 'h1: ' + h1);

    const paragraphs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('main p')).map(p => p.textContent.trim());
    });
    assert(paragraphs.some(p => p === '10'), 'count shows 10');
    assert(paragraphs.some(p => p.includes('Hurray')), 'shows Hurray message');

    const hasButton = await page.evaluate(() => !!document.querySelector('button'));
    assert(hasButton, 'button exists');

    const footerText = await page.evaluate(() => {
      const f = document.querySelector('footer');
      return f ? f.textContent : '';
    });
    assert(footerText.includes('Powered by Vesk'), 'footer: ' + footerText.trim());

    const hasHmrOverlay = await page.evaluate(() => {
      const el = document.getElementById('__vesk_dev');
      return !!el;
    });
    assert(hasHmrOverlay, 'HMR dev overlay exists in DOM');
    const hmrText = await page.evaluate(() => {
      const el = document.getElementById('__vesk_dev');
      return el ? el.textContent : '';
    });
    assert(hmrText.includes('Vesk'), 'HMR overlay shows "Vesk"');
    const hmrDot = await page.evaluate(() => {
      const dot = document.querySelector('#__vesk_dev .__v_dot');
      return dot ? dot.className : '';
    });
    assert(hmrDot.includes('connected') || hmrDot.includes('loading'), 'HMR dot has status class: ' + hmrDot);

    await page.close();
  }

  // ── Test 2: Reactivity (click button, count updates) ───
  console.log('\n=== TEST 2: Reactivity ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    // Initial count should be 10
    const before = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main p'));
      return ps.map(p => p.textContent.trim());
    });
    assert(before.some(p => p === '10'), 'initial count is 10');

    await page.click('button');
    await new Promise(r => setTimeout(r, 200));

    const after = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main p'));
      return ps.map(p => p.textContent.trim());
    });
    assert(after.some(p => p === '11'), 'count updated to 11 after first click');

    // Click 4 more times to reach 15
    for (let i = 0; i < 4; i++) {
      await page.click('button');
      await new Promise(r => setTimeout(r, 50));
    }

    const afterFive = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main p'));
      return ps.map(p => p.textContent.trim());
    });
    assert(afterFive.some(p => p === '15'), 'count updated to 15 after 5 clicks');

    // At count >= 15, Throw should show "OK 15" instead of error
    const hasOk = await page.evaluate(() => {
      return document.body.textContent.includes('OK ');
    });
    assert(hasOk, 'OK content shown at count >= 15');

    await page.close();
  }

  // ── Test 3: Error boundaries ─────────────────
  console.log('\n=== TEST 3: Error boundaries ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    const errorsAt = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.error')).map(e => e.textContent);
    });
    assert(errorsAt.some(t => t.includes('Boom!')), 'Appx shows Error: Boom!');
    assert(errorsAt.some(t => t.includes('Insufficient')), 'Appxx shows Insufficient error');

    await page.close();
  }

  // ── Test 4: SPA navigation ─────────────────────────────
  console.log('\n=== TEST 4: SPA navigation ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 300));

    const url = page.url();
    assert(url.includes('/about'), 'URL changed to /about');

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent.trim() : '';
    });
    assert(h1 === 'About Vesk', 'h1: ' + h1);

    const hasNav = await page.evaluate(() => !!document.querySelector('nav'));
    assert(hasNav, 'nav still exists after navigation');
    await page.close();
  }

  // ── Test 5: Back navigation ───────────────────────────
  console.log('\n=== TEST 5: Back navigation ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 200));

    await page.goBack();
    await new Promise(r => setTimeout(r, 300));

    const url = page.url();
    assert(url === BASE + '/' || url === BASE, 'URL back to root');

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent.trim() : '';
    });
    assert(h1 === 'Welcome to Vesk', 'h1 back to Welcome');
    await page.close();
  }

  // ── Test 6: Dynamic route ─────────────────────────────
  console.log('\n=== TEST 6: Dynamic route ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    const url = page.url();
    assert(url.includes('/blog/hello-world'), 'URL at /blog/hello-world');

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent.trim() : '';
    });
    assert(h1.includes('Post:'), 'h1: ' + h1);

    // Should show the slug in the content
    const bodyText = await page.evaluate(() => document.body.textContent);
    console.log('  [debug] body excerpt:', bodyText.trim().substring(0, 300).replace(/\s+/g, ' '));
    assert(bodyText.includes('hello-world') || bodyText.includes('/hello-world'), 'slug shown in body');
    await page.close();
  }

  // ── Test 7: No JS errors through interactions ─────────
  console.log('\n=== TEST 7: No JS errors ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    await page.click('button');
    await new Promise(r => setTimeout(r, 100));
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 200));
    await page.goBack();
    await new Promise(r => setTimeout(r, 200));

    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 8: Tailwind CSS (separated global.css + _tailwind.css) ──
  console.log('\n=== TEST 8: Tailwind CSS ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    // All tailwind utilities live in _tailwind.css (auto-generated)
    const twCss = await page.evaluate(async () => {
      try {
        const res = await fetch('/_vesk/static/_tailwind.css');
        const css = await res.text();
        return {
          ok: res.ok,
          length: css.length,
          hasTheme: css.includes('@layer theme'),
          hasText4xl: css.includes('text-4xl'),
          hasFontBold: css.includes('font-bold'),
        };
      } catch (e) { return { error: e.message }; }
    });
    assert(twCss.ok, '_tailwind.css fetched OK');
    assert(twCss.length > 1000, '_tailwind.css has content (' + twCss.length + ' bytes)');
    assert(twCss.hasTheme, '_tailwind.css contains @layer theme');
    assert(twCss.hasText4xl, '_tailwind.css contains text-4xl utility');
    assert(twCss.hasFontBold, '_tailwind.css contains font-bold utility');

    // User CSS (global.css) should NOT contain tailwind-generated content
    const userCss = await page.evaluate(async () => {
      try {
        const res = await fetch('/_vesk/static/global.css');
        const css = await res.text();
        return {
          ok: res.ok,
          length: css.length,
          hasTheme: css.includes('@layer theme'),
          hasText4xl: css.includes('text-4xl'),
          hasFontBold: css.includes('font-bold'),
          hasImport: css.includes("@import 'tailwindcss'"),
          hasLayerBase: css.includes('@layer base'),
        };
      } catch (e) { return { error: e.message }; }
    });
    assert(userCss.ok, 'global.css fetched OK');
    assert(!userCss.hasTheme, 'global.css does NOT contain @layer theme');
    assert(!userCss.hasText4xl, 'global.css does NOT contain text-4xl utility');
    assert(!userCss.hasFontBold, 'global.css does NOT contain font-bold utility');
    assert(!userCss.hasImport, 'global.css does NOT contain @import tailwindcss');

    // Verify both CSS links are present in the page HTML
    const cssLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('link[rel="stylesheet"]');
      return Array.from(links).map(l => l.href);
    });
    assert(cssLinks.length >= 2, `at least 2 stylesheet links (got ${cssLinks.length})`);
    assert(cssLinks.some(h => h.includes('_tailwind.css')), 'includes _tailwind.css link');
    assert(cssLinks.some(h => h.includes('global.css')), 'includes global.css link');

    // Verify elements use tailwind classes and they compute correct styles
    const h1Styles = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      const cs = getComputedStyle(h1);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        marginBottom: cs.marginBottom,
      };
    });
    assert(h1Styles !== null, 'h1 exists');
    assert(h1Styles.fontSize === '36px', 'h1 font-size is 36px (text-4xl = 2.25rem)');
    assert(h1Styles.fontWeight === '700', 'h1 font-weight is 700 (font-bold)');

    // Verify nav links use tailwind classes
    const navLinkStyles = await page.evaluate(() => {
      const link = document.querySelector('nav a');
      if (!link) return null;
      const cs = getComputedStyle(link);
      return {
        textDecoration: cs.textDecoration,
        fontWeight: cs.fontWeight,
      };
    });
    assert(navLinkStyles !== null, 'nav link exists');
    assert(navLinkStyles.textDecoration.includes('none'), 'nav link has no-underline');

    await page.close();
  }

  // ── Test 9: Streaming (chunked transfer) ──────────
  console.log('\n=== TEST 9: Streaming ===');
  {
    const page = await browser.newPage();
    const response = await page.goto(BASE, { waitUntil: 'networkidle0' });
    const headers = response.headers();
    const encoding = headers['transfer-encoding'] || '';
    assert(encoding === 'chunked', `Transfer-Encoding: ${encoding}`);

    // Verify the response came in multiple chunks (would need raw socket to verify chunks,
    // but at minimum check the content is complete)
    const html = await page.content();
    assert(html.includes('<!DOCTYPE html>'), 'full HTML doctype');
    assert(html.includes('Welcome to Vesk'), 'page content present');
    assert(html.includes('</html>'), 'closing html tag');
    await page.close();
  }

  // ── Test 10: Hydration strategies (via page.evaluate) ──
  console.log('\n=== TEST 10: Hydration strategies ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    // Verify hydration module functions are accessible
    const modulesAccessible = await page.evaluate(async () => {
      try {
        const hyd = await import('/_vesk/runtime.js');
        return {
          hasHydrateViewport: typeof hyd.hydrateViewport === 'function',
          hasHydrateIdle: typeof hyd.hydrateIdle === 'function',
          hasHydrateOnInteraction: typeof hyd.hydrateOnInteraction === 'function',
          hasCollectVskMarkers: typeof hyd.collectVskMarkers === 'function',
          hasCreateHydrateWalker: typeof hyd.createHydrateWalker === 'function',
          hasHydrateInitial: typeof hyd.hydrateInitial === 'function',
        };
      } catch (e) {
        return { error: e.message };
      }
    });
    assert(!modulesAccessible.error, 'No error loading runtime module');
    assert(modulesAccessible.hasHydrateViewport, 'hydrateViewport exported');
    assert(modulesAccessible.hasHydrateIdle, 'hydrateIdle exported');
    assert(modulesAccessible.hasHydrateOnInteraction, 'hydrateOnInteraction exported');
    assert(modulesAccessible.hasCollectVskMarkers, 'collectVskMarkers exported');
    assert(modulesAccessible.hasCreateHydrateWalker, 'createHydrateWalker exported');

    // Verify markers exist in the SSR HTML (not yet claimed)
    const markersInfo = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return { error: 'no root' };
      const walker = document.createTreeWalker(root, 128, {
        acceptNode: (n) => n.textContent === 'vsk' ? 1 : 2,
      });
      let count = 0;
      while (walker.nextNode()) count++;
      return { markerCount: count };
    });
    // After full hydration, markers should be claimed (removed), so count should be 0
    assert(markersInfo.markerCount === 0, `All markers claimed (${markersInfo.markerCount} remaining)`);

    await page.close();
  }

  // ── Test 11: Server codegen streaming exports ──
  console.log('\n=== TEST 11: Server renderPageStream ===');
  {
    // Verify the server function signature by checking the generated HTML
    const page = await browser.newPage();
    const response = await page.goto(BASE, { waitUntil: 'networkidle0' });
    const html = await response.text();

    // The streaming render should place head BEFORE body
    const headIdx = html.indexOf('<head>');
    const bodyIdx = html.indexOf('<body>');
    const rootIdx = html.indexOf('<div id="root">');
    const h1Idx = html.indexOf('Welcome to Vesk');

    assert(headIdx >= 0, 'has <head>');
    assert(bodyIdx >= 0, 'has <body>');
    assert(headIdx < bodyIdx, '<head> before <body>');
    assert(bodyIdx < rootIdx, '<body> before <div id="root">');
    assert(rootIdx < h1Idx, '<div id="root"> before content');

    await page.close();
  }

  // ── Test 12: Fresh server data on SPA navigation ──
  console.log('\n=== TEST 12: Fresh server data on SPA navigation ===');
  {
    const page = await browser.newPage();
    const errors = [];
    const dataRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => {
      if (req.headers()['x-vesk-data'] === '1') dataRequests.push(req.url());
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    const titleBefore = await page.evaluate(() => document.title);
    assert(titleBefore !== 'Async — load() + async components', 'title is not the async one yet: "' + titleBefore + '"');

    // No data request should fire for the initial SSR'd page (container already hydrated)
    assert(dataRequests.length === 0, `no X-Vesk-Data request on initial load (got ${dataRequests.length})`);

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/async"]');

    // optimistic render should happen first, then fresh head + props land
    await page.waitForFunction(() => document.title.includes('Async'), { timeout: 8000 });
    // fresh props land asynchronously (cold-cache first fetch can exceed 200ms)
    await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });

    const url = page.url();
    assert(url.includes('/async'), 'URL changed to /async');
    assert(await page.evaluate(() => window.__spaFlag === true), '/async reached via SPA (no reload)');

    const finalTitle = await page.evaluate(() => document.title);
    assert(finalTitle === 'Async — load() + async components', 'title swapped to fresh head: "' + finalTitle + '"');

    const bodyText = await page.evaluate(() => document.body.textContent);
    assert(bodyText.includes('Posts from load()'), 'async page content rendered');
    assert(bodyText.includes('Hello Vesk'), 'posts from load() props rendered: ' + (bodyText.match(/Hello Vesk/) ? 'yes' : 'no'));

    const dataForAsync = dataRequests.filter(u => u.includes('/async'));
    assert(dataForAsync.length === 1, `exactly one X-Vesk-Data request for /async (got ${dataForAsync.length})`);
    assert(errors.length === 0, 'zero JS errors during data-fetch nav (got ' + errors.length + ': ' + errors.join(', ') + ')');

    // SPA back to root still works after data fetch
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.back());
    await new Promise(r => setTimeout(r, 400));
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Welcome to Vesk', 'back to / after async data nav (h1: ' + h1 + ')');
    assert(await page.evaluate(() => window.__spaFlag === true), 'back is SPA (no reload)');

    await page.close();
  }

  // ── Test 13: Fresh data on repeated SPA navigation (prefetch reuse) ──
  console.log('\n=== TEST 13: Fresh data on repeated SPA navigation ===');
  {
    const page = await browser.newPage();
    const errors = [];
    let asyncDataRequests = 0;
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => {
      if (req.headers()['x-vesk-data'] === '1' && req.url().includes('/async')) asyncDataRequests++;
    });
    await page.goto(BASE, { waitUntil: 'networkidle0' });

    // navigate away and back to /async twice
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.__spaFlag = true; });
      await page.click('a[href="/async"]');
      await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });
      assert(true, `async fresh props render on visit ${i + 1}`);

      await page.evaluate(() => { window.__spaFlag = true; });
      await page.click('a[href="/about"]');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim() === 'About Vesk', { timeout: 8000 });
      assert(await page.evaluate(() => window.__spaFlag === true), `navigated to /about on visit ${i + 1} (SPA)`);
    }

    // Third SPA nav to /async: data already fresh for this page session, no refetch
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/async"]');
    await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });
    const bodyText = await page.evaluate(() => document.body.textContent);
    assert(bodyText.includes('Hello Vesk'), 'async renders from cached fresh props without refetch');

    // First /async visit fetched fresh data; revisits (and the reuse nav) hit the
    // session cache — exactly one X-Vesk-Data request for /async total.
    assert(asyncDataRequests === 1, `async fresh data fetched once, reused on revisits (got ${asyncDataRequests})`);
    assert(errors.length === 0, 'zero JS errors during repeated data navs (got ' + errors.length + ')');

    await page.close();
  }

  // ── Results ────────────────────────────────────────
  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  console.log('All hydration tests passed!');

  await browser.close();
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
