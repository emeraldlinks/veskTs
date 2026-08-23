/**
 * Hydration test using real SSR output from the test-app.
 * Launches headless Chromium via puppeteer-core against a running dev server.
 *
 * Usage: node hydration-test.mjs
 * Prerequisite: cd test-app && npm run dev (or vesk dev) running on port 3000
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE || 'http://localhost:3000';

// CDP Input.dispatchMouseEvent / dispatchKeyEvent can crash some chromium
// builds in this environment, so dispatch clicks/typing in-page via JS.
async function clickEl(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('clickEl: no element for ' + sel);
    el.click();
  }, selector);
}

async function typeInto(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('typeInto: no element for ' + sel);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

// newPage() can race main-frame attach; retry transient frame races.
async function goto(page, url, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      if (!String(e).includes('Requesting main frame too early') && !String(e).includes('Navigating frame was detached') && !String(e).includes('Attempted to use detached Frame')) throw e;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('goto retried too many times: ' + url);
}

async function clickNav(page, href, expectedPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await clickEl(page, `a[href="${href}"]`);
    } catch (e) {
      if (!String(e).includes('detached from document')) throw e;
    }
    try {
      await page.waitForFunction(
        (p) => location.pathname === p,
        { timeout: 4000 },
        expectedPath || href,
      );
      return;
    } catch {
      // raced a re-render; re-click and wait again
    }
  }
  throw new Error('clickNav timed out: ' + href);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let browser;

async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function skip(msg) {
  skipped++; console.log(`  - ${msg} (skipped: no HMR in production)`);
}

async function isDevServer(page) {
  return page.evaluate(() => {
    if (document.getElementById('__vesk_dev')) return true;
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    return scripts.some(s => s.includes('/_vesk/') && s.includes('dev')) ||
           scripts.some(s => s.includes('@vite') || s.includes('/hmr'));
  });
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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

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
    if (!hasHmrOverlay && !(await isDevServer(page))) {
      // HMR is a dev-server feature; production builds have no overlay by design.
      await skip('HMR dev overlay exists in DOM');
      await skip('HMR overlay shows "Vesk"');
      await skip('HMR dot has status class');
    } else {
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
    }

    await page.close();
  }

  // ── Test 2: Reactivity (click button, count updates) ───
  console.log('\n=== TEST 2: Reactivity ===');
  {
    const page = await browser.newPage();
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    // Initial count should be 10
    const before = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main p'));
      return ps.map(p => p.textContent.trim());
    });
    assert(before.some(p => p === '10'), 'initial count is 10');

    await clickEl(page, 'button');
    await new Promise(r => setTimeout(r, 200));

    const after = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('main p'));
      return ps.map(p => p.textContent.trim());
    });
    assert(after.some(p => p === '11'), 'count updated to 11 after first click');

    // Click 4 more times to reach 15
    for (let i = 0; i < 4; i++) {
      await clickEl(page, 'button');
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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    await clickNav(page, '/about', '/about');

    const url = page.url();
    assert(url.includes('/about'), 'URL changed to /about');

    // /about lives in a separate chunk (page-about.js): the URL updates
    // synchronously but the content renders only after the chunk loads.
    const deadline = 15000;
    const t0 = Date.now();
    let h1 = '';
    while (Date.now() - t0 < deadline) {
      h1 = await page.evaluate(() => {
        const el = document.querySelector('h1');
        return el ? el.textContent.trim() : '';
      });
      if (h1 === 'About Vesk') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert(h1 === 'About Vesk', 'h1: ' + h1);

    const hasNav = await page.evaluate(() => !!document.querySelector('nav'));
    assert(hasNav, 'nav still exists after navigation');
    await page.close();
  }

  // ── Test 5: Back navigation ───────────────────────────
  console.log('\n=== TEST 5: Back navigation ===');
  {
    const page = await browser.newPage();
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    await clickNav(page, '/about', '/about');

    await page.goBack();
    await page.waitForFunction(
      () => location.pathname === '/' || location.pathname === '',
      { timeout: 5000 },
    );

    const url = page.url();
    assert(url === BASE + '/' || url === BASE, 'URL back to root');

    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent?.trim() === 'Welcome to Vesk',
      { timeout: 8000 },
    );
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
    await goto(page, BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    await clickEl(page, 'button');
    await new Promise(r => setTimeout(r, 100));
    await clickNav(page, '/about', '/about');
    await page.goBack();
    await page.waitForFunction(
      () => location.pathname === '/' || location.pathname === '',
      { timeout: 5000 },
    );

    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 8: Tailwind CSS (separated global.css + _tailwind.css) ──
  console.log('\n=== TEST 8: Tailwind CSS ===');
  {
    const page = await browser.newPage();
    await goto(page, BASE, { waitUntil: 'networkidle0' });

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
    const response = await goto(page, BASE, { waitUntil: 'networkidle0' });
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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

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
    const response = await goto(page, BASE, { waitUntil: 'networkidle0' });
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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    const titleBefore = await page.evaluate(() => document.title);
    assert(titleBefore !== 'Async — async components', 'title is not the async one yet: "' + titleBefore + '"');

    // No data request should fire for the initial SSR'd page (container already hydrated)
    assert(dataRequests.length === 0, `no X-Vesk-Data request on initial load (got ${dataRequests.length})`);

    await page.evaluate(() => { window.__spaFlag = true; });
    await clickEl(page, 'a[href="/async"]');

    // optimistic render should happen first, then fresh head + props land
    await page.waitForFunction(() => document.title.includes('Async'), { timeout: 8000 });
    // the data fetch returns 200 with posts — wait for content to render
    await page.waitForFunction(() => document.body.textContent.includes('Posts fetched during SSR'), { timeout: 8000 });

    const url = page.url();
    assert(url.includes('/async'), 'URL changed to /async');
    assert(await page.evaluate(() => window.__spaFlag === true), '/async reached via SPA (no reload)');

    const bodyText = await page.evaluate(() => document.body.textContent);
    assert(bodyText.includes('Hello Vesk'), 'async page shows fetched post title');
    assert(bodyText.includes('Posts fetched during SSR'), 'async page heading rendered');
    const navFooter = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const footer = document.querySelector('footer');
      return {
        nav: nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '',
        footer: footer ? footer.textContent : '',
      };
    });
    assert(navFooter.nav.includes('Home') && navFooter.nav.includes('About'), 'nav survives on async data page');
    assert(navFooter.footer.includes('Powered by Vesk'), 'footer survives on async data page');

    const dataForAsync = dataRequests.filter(u => u.includes('/async'));
    assert(dataForAsync.length === 1, `exactly one X-Vesk-Data request for /async (got ${dataForAsync.length})`);
    assert(errors.length === 0, 'zero JS errors during data-fetch nav (got ' + errors.length + ': ' + errors.join(', ') + ')');

    // SPA back to root still works after data fetch
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.back());
    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent?.trim() === 'Welcome to Vesk',
      { timeout: 8000 },
    );
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
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    // navigate away and back to /async twice
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { window.__spaFlag = true; });
      await clickEl(page, 'a[href="/async"]');
      await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });
      assert(true, `async fresh props render on visit ${i + 1}`);

      await page.evaluate(() => { window.__spaFlag = true; });
      await clickEl(page, 'a[href="/about"]');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim() === 'About Vesk', { timeout: 8000 });
      assert(await page.evaluate(() => window.__spaFlag === true), `navigated to /about on visit ${i + 1} (SPA)`);
    }

    // Third SPA nav to /async: routeDataCache defaults to 0, so every visit
    // issues a fresh X-Vesk-Data request and renders the fresh props.
    await page.evaluate(() => { window.__spaFlag = true; });
    await clickEl(page, 'a[href="/async"]');
    await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });
    const bodyText = await page.evaluate(() => document.body.textContent);
    assert(bodyText.includes('Hello Vesk'), 'async renders fresh props on third visit');

    // Default routeDataCache = 0: one fresh data request per visit, never a
    // stale session cache hit.
    assert(asyncDataRequests === 3, `async fresh data fetched on every visit (got ${asyncDataRequests})`);
    assert(errors.length === 0, 'zero JS errors during repeated data navs (got ' + errors.length + ')');

    await page.close();
  }

  // ── Test 14: Cross-file .vsk component imports ──
  console.log('\n=== TEST 14: .vsk component imports ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await goto(page, BASE + '/comp-test', { waitUntil: 'networkidle0' });

    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Component import test', 'h1: ' + h1);

    // Imported Helper component must be SSR'd from its own .vsk file
    const helperBox = await page.evaluate(() => {
      const box = document.querySelector('.helper-box');
      if (!box) return null;
      return {
        label: box.querySelector('.helper-label')?.textContent?.trim() || '',
        hasButton: !!box.querySelector('button'),
      };
    });
    assert(helperBox !== null, 'helper-box present (imported component rendered)');
    assert(helperBox.label === 'Helper says 5', 'SSR helper label: "' + helperBox.label + '"');
    assert(helperBox.hasButton, 'imported component has its own button');

    // Reactivity inside the imported component must work after hydration
    await clickEl(page, '.helper-box button');
    await new Promise(r => setTimeout(r, 200));
    const afterClick = await page.evaluate(() => document.querySelector('.helper-label')?.textContent?.trim() || '');
    assert(afterClick === 'Helper says 6', 'imported component reactive state updates: "' + afterClick + '"');

    // Multiple clicks continue to update
    await clickEl(page, '.helper-box button');
    await clickEl(page, '.helper-box button');
    await new Promise(r => setTimeout(r, 200));
    const afterThree = await page.evaluate(() => document.querySelector('.helper-label')?.textContent?.trim() || '');
    assert(afterThree === 'Helper says 8', 'imported component persists state across clicks: "' + afterThree + '"');

    assert(errors.length === 0, 'zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 15: Server actions (defineAction + Form) ──
  console.log('\n=== TEST 15: Server actions ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await goto(page, BASE + '/actions', { waitUntil: 'networkidle0' });

    const formInfo = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return null;
      return {
        action: form.getAttribute('action'),
        hasName: !!form.querySelector('input[name="name"]'),
        hasEmail: !!form.querySelector('input[name="email"]'),
        hasPassword: !!form.querySelector('input[name="password"]'),
        errorEls: form.querySelectorAll('[data-vsk-error]').length,
      };
    });
    assert(formInfo !== null, 'form exists');
    assert(formInfo.action && formInfo.action.startsWith('/_vesk/action/'), 'form action is an action endpoint: ' + formInfo.action);
    assert(formInfo.hasName && formInfo.hasEmail && formInfo.hasPassword, 'form has name/email/password inputs');
    assert(formInfo.errorEls === 3, '3 field error slots rendered (' + formInfo.errorEls + ')');

    // Client-side validation: empty/invalid values → field errors appear
    await typeInto(page, 'input[name="name"]', '');
    await typeInto(page, 'input[name="email"]', 'not-an-email');
    await typeInto(page, 'input[name="password"]', '123');
    await clickEl(page, 'button[type="submit"]');
    await new Promise(r => setTimeout(r, 300));

    const clientErrors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-vsk-error]'))
        .map(el => el.textContent?.trim() || '')
        .filter(Boolean);
    });
    assert(clientErrors.some(t => t.includes('Name is required')), 'name required error shown');
    assert(clientErrors.some(t => t.includes('Enter a valid email')), 'email validation error shown');
    assert(clientErrors.some(t => t.includes('at least 6 characters')), 'password length error shown');

    // Valid submission → action executes, vsk-success fires, SPA preserved
    await page.evaluate(() => { window.__spaFlag = true; });
    const successFired = await page.evaluate(async () => {
      const form = document.querySelector('form');
      return await new Promise((resolve) => {
        form.addEventListener('vsk-success', () => resolve(true), { once: true });
        const name = form.querySelector('input[name="name"]');
        const email = form.querySelector('input[name="email"]');
        const password = form.querySelector('input[name="password"]');
        name.value = 'Alice';
        email.value = 'alice@example.com';
        password.value = 'secret123';
        form.requestSubmit();
      });
    });
    assert(successFired, 'valid submit fired vsk-success (action executed)');
    assert(await page.evaluate(() => window.__spaFlag === true), 'action submit preserved SPA (no full reload)');
    assert(await page.evaluate(() => document.querySelectorAll('[data-vsk-error]').length > 0), 'field error slots still rendered');

    // Server-side validation round-trip: client passes but server rejects
    await page.evaluate(() => { window.__spaFlag = true; });
    const serverErrorShown = await page.evaluate(async () => {
      const form = document.querySelector('form');
      return await new Promise((resolve) => {
        form.addEventListener('vsk-error', () => {
          const msg = Array.from(form.querySelectorAll('[data-vsk-error]'))
            .map(el => el.textContent?.trim() || '').join(' ');
          resolve(msg.includes('Enter a valid email'));
        }, { once: true });
        const name = form.querySelector('input[name="name"]');
        const email = form.querySelector('input[name="email"]');
        const password = form.querySelector('input[name="password"]');
        name.value = 'Bob';
        email.value = 'bob';          // passes client rule, rejected by server rule
        password.value = 'hunter22';
        form.requestSubmit();
      });
    });
    assert(serverErrorShown, 'server-side field error rendered after action round-trip');
    assert(await page.evaluate(() => window.__spaFlag === true), 'server-rejected submit preserved SPA (no reload)');

    assert(errors.length === 0, 'zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 16: API / server routes ──
  console.log('\n=== TEST 16: API routes ===');
  {
    const page = await browser.newPage();
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    const results = await page.evaluate(async () => {
      const j = (r) => r.json().catch(() => null);
      const get = (u, init) => fetch(u, init);

      const helloGet = await get('/api/hello');
      const helloJson = await j(helloGet);

      const helloPost = await get('/api/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar', n: 42 }),
      });
      const postJson = await j(helloPost);

      const echo = await get('/api/echo/hello-world');
      const echoJson = await j(echo);

      const posts2 = await get('/api/posts?limit=2');
      const posts2Json = await j(posts2);

      const posts1 = await get('/api/posts?limit=1');
      const posts1Json = await j(posts1);

      const postsFail = await get('/api/posts?fail=100');
      const postsFailJson = await j(postsFail);

      return {
        helloStatus: helloGet.status,
        helloMessage: helloJson?.message,
        postStatus: helloPost.status,
        postReceived: postJson?.received,
        postOk: postJson?.ok,
        echoMessage: echoJson?.message,
        echoMethod: echoJson?.method,
        posts2Count: Array.isArray(posts2Json) ? posts2Json.length : -1,
        posts2First: Array.isArray(posts2Json) && posts2Json.length > 0 ? posts2Json[0].title : '',
        posts1Count: Array.isArray(posts1Json) ? posts1Json.length : -1,
        postsFailStatus: postsFail.status,
        postsFailError: postsFailJson?.error,
      };
    });

    const cookieResp = await fetch(BASE + '/api/hello');
    assert(results.helloStatus === 201, 'GET /api/hello → 201 (got ' + results.helloStatus + ')');
    assert(results.helloMessage === 'Hello from Vesk!', 'GET /api/hello JSON message: ' + results.helloMessage);
    assert((cookieResp.headers.get('set-cookie') || '').includes('session='), 'GET /api/hello sets session cookie');
    assert(results.postStatus === 201, 'POST /api/hello → 201 (got ' + results.postStatus + ')');
    assert(results.postOk === true && results.postReceived?.foo === 'bar', 'POST /api/hello echoes JSON body');
    assert(results.echoMessage === 'hello-world', 'GET /api/echo/:msg → dynamic param echoed');
    assert(results.echoMethod === 'GET', 'GET /api/echo/:msg method = GET');
    assert(results.posts2Count === 2, 'GET /api/posts?limit=2 → 2 posts (got ' + results.posts2Count + ')');
    assert(results.posts2First === 'Hello Vesk', 'first post title: ' + results.posts2First);
    assert(results.posts1Count === 1, 'GET /api/posts?limit=1 → respects query param');
    assert(results.postsFailStatus === 503, 'GET /api/posts?fail=100 → 503 (got ' + results.postsFailStatus + ')');
    assert(results.postsFailError === 'simulated failure', 'failure body: ' + results.postsFailError);

    // The /posts page itself (SSR route) renders the API data
    await goto(page, BASE + '/posts', { waitUntil: 'networkidle0' });
    const postsPage = await page.evaluate(() => {
      const t = document.body.textContent || '';
      return {
        hasPostsH1: t.includes('Posts'),
        hasPostData: t.includes('Hello Vesk'),
      };
    });
    assert(postsPage.hasPostsH1, '/posts page header rendered');
    assert(postsPage.hasPostData, '/posts SSR page renders fetched post data');
    // Confirm vsk hydration markers exist in SSR output via fetch
    const rawHtml = await fetch(BASE + '/posts').then(r => r.text());
    assert((rawHtml.match(/<!--vsk-->/g) || []).length > 0, '/posts SSR output contains <!--vsk--> hydration markers');

    await page.close();
  }

  // ── Test: Markdown (<Md content={...} />) ─────────────
  console.log('\n=== TEST: Markdown ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await goto(page, BASE + '/md', { waitUntil: 'networkidle0' });

    assert(errors.length === 0, 'Zero JS errors on /md (got ' + errors.length + ': ' + errors.join(', ') + ')');

    const md = await page.evaluate(() => {
      const h1 = document.querySelector('main h1');
      const divs = Array.from(document.querySelectorAll('main div'));
      const mdDiv = divs.find(d => d.className.includes('md'));
      const mdContent = mdDiv ? mdDiv.textContent : '';
      return {
        pageH1: h1 ? h1.textContent.trim() : '',
        hasH1: mdContent.includes('Markdown in Vesk'),
        hasLi: mdContent.includes('compiler-first'),
        hasBlockquote: mdContent.includes('Content is escaped'),
        hasCode: mdContent.includes('const md = track'),
        hasOrdered: mdContent.includes('SSR and hydration'),
        hasLink: mdContent.includes('Md content'),
        hasRawScriptLeak: mdContent.includes('<script>'),
      };
    });
    assert(md.pageH1 === 'Markdown Demo', 'page h1: ' + md.pageH1);
    assert(md.hasH1, 'markdown h1 rendered');
    assert(md.hasLi, 'markdown list item rendered');
    assert(md.hasBlockquote, 'markdown blockquote rendered');
    assert(md.hasCode, 'markdown code block rendered');
    assert(md.hasOrdered, 'markdown ordered list rendered');
    assert(md.hasLink, 'markdown inline formatting rendered');
    assert(md.hasRawScriptLeak === false, 'no raw <script> leaked');

    // SPA-navigate away and back — Md must re-render in client-only mode
    // (retry on detach: the chunk-loaded router may re-render the chain a
    // frame after networkidle, replacing the queried element)
    const clickRetry = async (sel) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await clickEl(page, sel);
          return;
        } catch (e) {
          if (!String(e).includes('detached from document')) throw e;
          await new Promise(r => setTimeout(r, 250));
        }
      }
      throw new Error('click detached repeatedly: ' + sel);
    };
    await clickRetry('a[href="/about"]');
    await page.waitForFunction(
      () => document.querySelector('h1')?.textContent?.trim() === 'About Vesk',
      { timeout: 5000 },
    );
    await clickRetry('a[href="/md"]');
    await page.waitForFunction(
      () => document.body.textContent.includes('Markdown in Vesk'),
      { timeout: 5000 },
    );

    const afterNav = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('main div'));
      const mdDiv = divs.find(d => d.className.includes('md'));
      return mdDiv ? mdDiv.textContent.includes('Markdown in Vesk') : false;
    });
    assert(afterNav, 'Md re-renders after SPA navigation');

    await page.close();
  }

  // ── Test 17: Error isolation (layout nav survives a broken page) ──
  console.log('\n=== TEST 17: Error isolation ===');
  {
    // 17a: Full load of a client-throwing page. SSR is clean (200), hydration
    // fails, and the error component must replace only the page slot inside
    // the layout chain — nav + footer survive, zero uncaught page errors.
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      const response = await goto(page, BASE + '/broken', { waitUntil: 'networkidle0' });
      assert(response.status() === 200, '/broken SSR is 200 (got ' + response.status() + ')');
      await page.waitForFunction(() => document.body.textContent.includes('BrokenComp exploded'), { timeout: 8000 });

      const state = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        const footer = document.querySelector('footer');
        const root = document.getElementById('root');
        return {
          url: window.location.pathname,
          navText: nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '',
          footer: footer ? footer.textContent : '',
          body: root ? root.textContent.replace(/\s+/g, ' ').trim() : '',
          markerCount: (() => {
            const walker = document.createTreeWalker(root, 128, { acceptNode: (n) => n.textContent === 'vesk-ssr-error' ? 1 : 2 });
            let c = 0; while (walker.nextNode()) c++;
            return c;
          })(),
        };
      });
      assert(state.url === '/broken', 'stays on /broken after hydrate-failure re-render');
      assert(state.navText.includes('Home') && state.navText.includes('About') && state.navText.includes('Broken'),
        'nav survives on error page: ' + state.navText);
      assert(state.footer.includes('Powered by Vesk'), 'footer survives on error page');
      assert(state.body.includes('BrokenComp exploded'), 'error message rendered in page slot');
      assert(state.markerCount === 0, 'ssr-error marker consumed after error render');
      assert(errors.length === 0, 'zero uncaught page errors (got ' + errors.length + ': ' + errors.join(', ') + ')');

      // Nav still works after the error page render.
      await page.evaluate(() => { window.__spaFlag = true; });
      await clickNav(page, '/statements', '/statements');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('JS Statement Demo'), { timeout: 8000 });
      assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav from error page to /statements (no reload)');
      await page.close();
    }

    // 17b: Full load of a server-throwing route (SSR 500 + marker). Client
    // re-renders the route error component in the layout chain.
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await goto(page, BASE + '/store/boom', { waitUntil: 'networkidle0' });

      const state = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        const footer = document.querySelector('footer');
        const root = document.getElementById('root');
        return {
          navText: nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '',
          footer: footer ? footer.textContent : '',
          body: root ? root.textContent.replace(/\s+/g, ' ').trim() : '',
        };
      });
      assert(state.body.includes('Store Error Boundary'), 'route-level error component rendered');
      assert(state.body.includes('Store exploded'), 'store error message rendered');
      assert(state.navText.includes('Home') && state.navText.includes('Broken'), 'nav survives on server-error page');
      assert(state.footer.includes('Powered by Vesk'), 'footer survives on server-error page');
      assert(errors.length === 0, 'zero uncaught page errors (got ' + errors.length + ': ' + errors.join(', ') + ')');

      await page.evaluate(() => { window.__spaFlag = true; });
      await clickNav(page, '/', '/');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.includes('Welcome to Vesk'), { timeout: 8000 });
      assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav from server-error page to / (no reload)');
      await page.close();
    }

    // 17c: SPA nav TO a broken page. The page throws client-side; the error
    // component renders in the layout chain and nav keeps working.
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await goto(page, BASE, { waitUntil: 'networkidle0' });

      await page.evaluate(() => { window.__spaFlag = true; });
      await clickNav(page, '/broken', '/broken');
      await page.waitForFunction(() => document.body.textContent.includes('BrokenComp exploded'), { timeout: 8000 });

      const state = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        const footer = document.querySelector('footer');
        return {
          url: window.location.pathname,
          navText: nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '',
          footer: footer ? footer.textContent : '',
          body: document.getElementById('root') ? document.getElementById('root').textContent.replace(/\s+/g, ' ').trim() : '',
        };
      });
      assert(state.url === '/broken', 'SPA nav landed on /broken');
      assert(state.body.includes('Error 500') || state.body.includes('BrokenComp exploded'), 'client error rendered in page slot');
      assert(state.navText.includes('Home') && state.navText.includes('Broken'), 'nav survives SPA-nav error page');
      assert(state.footer.includes('Powered by Vesk'), 'footer survives SPA-nav error page');
      assert(errors.length === 0, 'zero uncaught page errors during SPA error nav (got ' + errors.length + ': ' + errors.join(', ') + ')');

      // And navigation out of the error page still works.
      await page.evaluate(() => { window.__spaFlag = true; });
      await clickNav(page, '/about', '/about');
      await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim() === 'About Vesk', { timeout: 8000 });
      assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav from SPA-error page to /about (no reload)');
      await page.close();
    }

    // 17d: SPA nav TO a route whose data fetch fails server-side. The page
    // renders optimistically on the client, then the X-Vesk-Data response is a
    // 500 `{ error }` JSON payload. The router must render the route error
    // component from that payload instead of falling back to an HTML fetch.
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await goto(page, BASE, { waitUntil: 'networkidle0' });

      await page.evaluate(() => { window.__spaFlag = true; });
      await page.evaluate(() => {
        const router = window.__vesk_router;
        if (router && typeof router.navigate === 'function') router.navigate('/dataerror');
      });
      await page.waitForFunction(() => document.body.textContent.includes('Data layer unavailable during SSR'), { timeout: 8000 });

      const state = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        const footer = document.querySelector('footer');
        return {
          url: window.location.pathname,
          navText: nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '',
          footer: footer ? footer.textContent : '',
          body: document.getElementById('root') ? document.getElementById('root').textContent.replace(/\s+/g, ' ').trim() : '',
        };
      });
      assert(state.url === '/dataerror', 'SPA nav landed on /dataerror');
      assert(state.body.includes('Data layer unavailable during SSR'), 'server data error message rendered from the X-Vesk-Data payload');
      assert(state.navText.includes('Home') && state.navText.includes('About'), 'nav survives SPA data-error page');
      assert(state.footer.includes('Powered by Vesk'), 'footer survives SPA data-error page');
      assert(errors.length === 0, 'zero uncaught page errors during SPA data-error nav (got ' + errors.length + ': ' + errors.join(', ') + ')');

      // Navigation out of the error page still works.
      await page.evaluate(() => { window.__spaFlag = true; });
      await clickNav(page, '/about', '/about');
      await page.waitForFunction(
        () => {
          const h1 = document.querySelector('h1');
          return h1 && h1.textContent && h1.textContent.trim() === 'About Vesk';
        },
        { timeout: 15000 },
      );
      assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav from data-error page to /about (no reload)');
      await page.close();
    }
  }

  // ── Test 18: SSR data integrity across all routes ──
  console.log('\n=== TEST 18: SSR data integrity across all routes ===');
  // '/' is a data route: Home demos `useFetch(..., { into })` with the posts
  // resource, so it embeds exactly one ssr-data script like /async and /posts.
  const DATA_ROUTES = new Set(['/', '/async', '/posts']);
  const FULL_ROUTES = [
    '/', '/about', '/blog', '/blog/hello-world', '/async', '/comp-test',
    '/actions', '/posts', '/empty', '/map', '/statements', '/broken',
    '/store', '/store/widget', '/typed',
  ];
  const SPA_TEXT = {
    '/': 'Welcome to Vesk',
    '/about': 'About Vesk',
    '/blog': 'Blog',
    '/blog/hello-world': 'Back to blog',
    '/async': 'Async Demo',
    '/comp-test': 'Component import test',
    '/actions': 'Server actions',
    '/posts': 'Posts',
    '/empty': 'Empty-',
    '/map': 'Inline .map() Demo',
    '/statements': 'JS Statement Demo',
    '/broken': 'BrokenComp exploded',
    '/store': 'Store',
    '/store/widget': 'Item: widget',
    '/typed': 'Total likes',
  };

  {
    // 18a: Fresh full load of every route. The response must be HTML, the
    // status 200, and the ssr-data script must appear ONLY on data-fetching
    // routes (regression: data payloads/scripts leaking into other pages).
    console.log('  18a: fresh SSR per route — html + data-script isolation');
    const leakChecks = [];
    for (const route of FULL_ROUTES) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      try {
        const resp = await goto(page, BASE + route, { waitUntil: 'networkidle0', timeout: 15000 });
        const ct = resp ? (resp.headers()['content-type'] || '') : '';
        assert(resp && resp.status() === 200, `${route} full load is HTTP 200 (got ${resp?.status()})`);
        assert(ct.includes('text/html'), `${route} serves HTML not JSON (content-type: ${ct})`);
        const scriptCount = await page.evaluate(() => (document.documentElement.outerHTML.match(/ssr-data\.js/g) || []).length);
        const expected = DATA_ROUTES.has(route) ? 1 : 0;
        assert(scriptCount === expected, `${route} has ${scriptCount} ssr-data script ref(s) (expected ${expected})`);
        if (scriptCount !== expected) leakChecks.push(route + ':' + scriptCount);
        if (route === '/broken') {
          await page.waitForFunction(() => document.body.textContent.includes('BrokenComp exploded'), { timeout: 8000 }).catch(() => {});
        }
        const text = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').trim());
        assert(text.includes(SPA_TEXT[route]), `${route} rendered real content (${SPA_TEXT[route]})`);
        assert(errors.length === 0, `${route} zero pageerrors (got ${errors.length}: ${errors.join(', ')})`);
      } catch (e) {
        assert(false, `${route} load failed: ${(e.message || e).slice(0, 80)}`);
      }
      await page.close();
    }
    assert(leakChecks.length === 0, 'no ssr-data script leaked into non-data routes' + (leakChecks.length ? ' — ' + leakChecks.join(', ') : ''));
  }

  {
    // 18b: One session, load a data route, then SPA-navigate across ALL routes.
    // Asserts every nav renders the right content, stays client-side, and
    // produces zero page errors — the full route graph exercised via the router.
    console.log('  18b: SPA navigation across all routes (starting from a data route)');
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await goto(page, BASE + '/async', { waitUntil: 'networkidle0' });

    const chain = Object.keys(SPA_TEXT).filter(r => r !== '/async');
    for (const route of chain) {
      await page.evaluate((href) => {
        window.__spaFlag = true;
        const router = window.__vesk_router;
        if (router && typeof router.navigate === 'function') {
          try {
            router.navigate(href);
          } catch (e) {
            window.__navError = String(e && e.message || e);
          }
        } else {
          window.__navError = 'router not available';
        }
      }, route);
      const deadline = 15000;
      const t0 = Date.now();
      let ok = false;
      while (Date.now() - t0 < deadline) {
        const cur = await page.evaluate(() => ({
          path: window.location.pathname,
          text: (document.getElementById('root') || document.body).textContent.replace(/\s+/g, ' '),
        }));
        if (cur.path === route && cur.text.includes(SPA_TEXT[route])) { ok = true; break; }
        await new Promise(r => setTimeout(r, 100));
      }
      assert(ok, `SPA nav to ${route} rendered ${SPA_TEXT[route]} (url ${await page.evaluate(() => window.location.pathname)})`);
      const isSpa = await page.evaluate(() => window.__spaFlag === true);
      assert(isSpa, `SPA nav to ${route} did not reload the page`);
      assert(errors.length === 0, `SPA nav to ${route} zero pageerrors (got ${errors.length})`);
    }
    assert(errors.length === 0, 'whole SPA chain zero pageerrors (got ' + errors.length + ': ' + errors.join(', ') + ')');

    // 18c: Full reloads after the data-heavy session. The browser has fetched
    // x-vesk-data JSON for /async and /posts during SPA nav; a plain reload
    // must return HTML again (regression: cached JSON poisoning the document).
    console.log('  18c: full reloads after SPA data fetches must stay HTML');
    for (const route of ['/async', '/posts', '/about', '/map']) {
      const resp = await goto(page, BASE + route, { waitUntil: 'networkidle0' });
      const ct = resp ? (resp.headers()['content-type'] || '') : '';
      assert(resp && resp.status() === 200 && ct.includes('text/html'),
        `reload of ${route} is HTML 200 (status ${resp?.status()}, content-type ${ct})`);
      const ok = await page.evaluate((needle) => {
        const t = (document.getElementById('root') || document.body).textContent;
        return t.includes(needle);
      }, SPA_TEXT[route]);
      assert(ok, `reload of ${route} shows real content (${SPA_TEXT[route]})`);
    }
    assert(errors.length === 0, 'reloads after data fetches zero pageerrors (got ' + errors.length + ')');
    await page.close();
  }

  {
    // 18d: View-source integrity — the fresh document of a non-data route must
    // never reference the ssr-data script; data routes must reference it exactly
    // once. Mirrors the reported "script leaks into other pages' view-source".
    console.log('  18d: fresh-document data-script isolation');
    for (const [route, expected] of [['/', 1], ['/about', 0], ['/async', 1], ['/posts', 1], ['/map', 0]]) {
      const page = await browser.newPage();
      await goto(page, BASE + route, { waitUntil: 'networkidle0' });
      const html = await page.content();
      const count = (html.match(/ssr-data\.js/g) || []).length;
      assert(count === expected, `${route} view-source has ${count} ssr-data refs (expected ${expected})`);
      await page.close();
    }
  }

  // ── Results ────────────────────────────────────────
  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  console.log('All hydration tests passed!');

  await browser.close();
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
