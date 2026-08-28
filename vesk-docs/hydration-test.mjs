/**
 * vesk-docs production-hydration test.
 *
 * A docs-site port shaped like the repo-level /root/vesk/hydration-test.mjs
 * (which targets test-app routes — do not touch it). Launches headless
 * Chromium via puppeteer-core against a running vesk-docs server and verifies
 * the docs routes SSR + hydrate + react + SPA-navigate without leaking errors.
 *
 * Key docs-specific contracts:
 *  · guide pages fetch their markdown via useFetch.text → SSR data → client
 *    render with <Md>; the "compiling" panel must be replaced by content.
 *  · /posts SSR'd once, rendered from serialized data (no re-fetch on load).
 *  · a /guide/:path with no doc.md is a 200 page (error panel), not a 500.
 *  · the 404 custom error page renders for unknown routes.
 *
 * Usage: node hydration-test.mjs
 * Prerequisite: cd vesk-docs && npm run dev (port 3000)
 * Env: BASE=..., CHROMIUM_PATH=...
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE || 'http://localhost:3000';

async function clickEl(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('clickEl: no element for ' + sel);
    el.click();
  }, selector);
}

async function clickRetry(page, selector) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await clickEl(page, selector);
      return;
    } catch (e) {
      if (!String(e).includes('detached from document')) throw e;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('click kept racing a re-render: ' + selector);
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

let passed = 0;
let failed = 0;
async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

const markerCount = () => `(() => {
  const root = document.getElementById('root');
  if (!root) return -1;
  const w = document.createTreeWalker(root, 128, { acceptNode: (n) => n.textContent === 'vsk' ? 1 : 2 });
  let c = 0; while (w.nextNode()) c++;
  return c;
})()`;

let browser;

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── Test 1: Home — static SSR + client island hydration ──
  console.log('\n=== TEST 1: Home (/) SSR + island hydration ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    assert(errors.length === 0, 'Zero JS errors on load (got ' + errors.length + ': ' + errors.join(', ') + ')');

    const state = await page.evaluate(() => ({
      nav: (document.querySelector('nav.site-nav') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
      hasHero: document.body.textContent.includes('compiler-first framework'),
      hasCompilePane: document.body.textContent.includes('what the compiler emits'),
      hasInstallBtn: !!document.querySelector('button.install-copy'),
      markers: (() => { const r = document.getElementById('root'); const w = document.createTreeWalker(r, 128, { acceptNode: n => n.textContent === 'vsk' ? 1 : 2 }); let c = 0; while (w.nextNode()) c++; return c; })(),
    }));
    assert(state.nav.includes('guide') && state.nav.includes('blog') && state.nav.includes('data') && state.nav.includes('statements') && state.nav.includes('about'),
      'nav links present: ' + state.nav);
    assert(state.hasHero, 'hero section rendered');
    assert(state.hasCompilePane, 'compile pane rendered');
    assert(state.hasInstallBtn, 'client island install-copy button rendered');
    assert(state.markers === 0, 'all hydration markers claimed (' + state.markers + ' remaining)');

    // The island is interactive: click copy → "copied ✓" → reverts.
    await clickEl(page, 'button.install-copy');
    await new Promise(r => setTimeout(r, 150));
    const copied = await page.evaluate(() => document.querySelector('button.install-copy')?.textContent?.trim() || '');
    assert(copied === 'copied ✓', 'island button flipped to copied: "' + copied + '"');
    await new Promise(r => setTimeout(r, 1700));
    const reverted = await page.evaluate(() => document.querySelector('button.install-copy')?.textContent?.trim() || '');
    assert(reverted === 'copy', 'island button reverted to "copy"');
    assert(errors.length === 0, 'Zero JS errors through island interaction');
    await page.close();
  }

  // ── Test 2: /posts — useFetch SSR data + refresh reactivity ──
  console.log('\n=== TEST 2: /posts useFetch demo ===');
  {
    const page = await browser.newPage();
    const errors = [];
    const dataRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => { if (req.headers()['x-vesk-data'] === '1') dataRequests.push(req.url()); });
    const resp = await goto(page, BASE + '/posts', { waitUntil: 'networkidle0' });
    assert(resp.status() === 200, '/posts HTTP 200 (got ' + resp.status() + ')');

    const result = await page.evaluate(() => ({
      hasHeading: document.body.textContent.includes('Posts, fetched live'),
      hasPost: document.body.textContent.includes('Hello Vesk'),
      hasSecond: document.body.textContent.includes('SSR in Vesk'),
      markers: (() => { const r = document.getElementById('root'); const w = document.createTreeWalker(r, 128, { acceptNode: n => n.textContent === 'vsk' ? 1 : 2 }); let c = 0; while (w.nextNode()) c++; return c; })(),
    }));
    assert(result.hasHeading, 'posts heading rendered');
    assert(result.hasPost && result.hasSecond, 'SSR-persisted post data rendered (Hello Vesk + SSR in Vesk)');
    assert(result.markers === 0, 'all hydration markers claimed');
    assert(dataRequests.length === 0, 'no X-Vesk-Data re-fetch on initial load (data is SSR\'d)');

    // Refresh button keeps the SSR'd list during reload (keepPreviousData).
    await clickEl(page, 'button.btn');
    await new Promise(r => setTimeout(r, 120));
    const duringRefresh = await page.evaluate(() => ({
      text: document.body.textContent,
      chip: document.querySelector('.chip-status')?.textContent?.trim() || '',
    }));
    assert(duringRefresh.text.includes('Hello Vesk'), 'post list stays on screen while refreshing (keepPreviousData)');
    assert(duringRefresh.chip.includes('refreshing') || duringRefresh.chip.includes('loading'), 'status chip reflects the refresh: ' + duringRefresh.chip);
    await new Promise(r => setTimeout(r, 2500));
    const afterRefresh = await page.evaluate(() => document.querySelector('.chip-status')?.textContent?.trim() || '');
    assert(afterRefresh.includes('fresh'), 'status settles back to fresh: ' + afterRefresh);
    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 3: guide doc — useFetch.text + <Md> end to end ──
  console.log('\n=== TEST 3: /guide/<doc> useFetch.text + Md ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const resp = await goto(page, BASE + '/guide/reactivity', { waitUntil: 'networkidle0' });
    assert(resp.status() === 200, '/guide/reactivity HTTP 200 (got ' + resp.status() + ')');

    const result = await page.evaluate((base) => ({
      markers: (() => { const r = document.getElementById('root'); const w = document.createTreeWalker(r, 128, { acceptNode: n => n.textContent === 'vsk' ? 1 : 2 }); let c = 0; while (w.nextNode()) c++; return c; })(),
      hasCrumb: document.body.textContent.includes('guide/reactivity'),
      hasHeading: !!document.querySelector('.g-main h1'),
      heading: document.querySelector('.g-main h1')?.textContent?.trim() || '',
      hasToc: (document.querySelectorAll('.g-toc .toc-list a').length || 0) > 0,
      stillCompiling: document.body.textContent.includes('compiling'),
      hasSourceRef: document.body.textContent.includes('public/docs/guide/reactivity/doc.md'),
    }));
    assert(result.markers === 0, 'all hydration markers claimed (' + result.markers + ' remaining)');
    assert(result.hasCrumb, 'guide crumb rendered');
    assert(result.hasHeading, 'markdown h1 rendered: "' + result.heading + '"');
    assert(!result.stillCompiling, '"compiling" panel replaced by rendered markdown');
    assert(result.hasSourceRef, 'doc-meta shows the source path');
    // tocFrom must run (it crashed SSR with "tocFrom is not defined").
    assert(result.hasToc, 'on-this-page TOC rendered from tocFrom(' + result.heading + ')');
    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 4: guide index — <Md content="/docs/guide/index.md"> ──
  console.log('\n=== TEST 4: /guide index Md ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const resp = await goto(page, BASE + '/guide', { waitUntil: 'networkidle0' });
    assert(resp.status() === 200, '/guide HTTP 200 (got ' + resp.status() + ')');
    const ok = await page.evaluate(() => ({
      hasDocTitle: document.body.textContent.includes('Vesk Documentation'),
      isCompiling: document.body.textContent.includes('compiling'),
      h1: document.querySelector('.g-main h1')?.textContent?.trim() || '',
    }));
    assert(ok.hasDocTitle, 'guide index markdown rendered (Vesk Documentation)');
    assert(!ok.isCompiling, 'index no longer shows "compiling" panel');
    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 5: missing guide doc is a 200 error-panel, not a 500 ──
  console.log('\n=== TEST 5: /guide/<missing> doc ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const resp = await goto(page, BASE + '/guide/no-such-doc', { waitUntil: 'networkidle0' });
    assert(resp.status() === 200, '/guide/no-such-doc HTTP 200 (got ' + resp.status() + ')');
    const hasPanel = await page.evaluate(() => document.body.textContent.includes('no source at this path'));
    assert(hasPanel, '"no source at this path" panel rendered');
    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 6: custom 404 ──
  console.log('\n=== TEST 6: custom 404 ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const resp = await goto(page, BASE + '/does-not-exist', { waitUntil: 'networkidle0' });
    assert(resp.status() === 404, '/does-not-exist HTTP 404 (got ' + resp.status() + ')');
    const text = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
    assert(text.includes('nothing compiles at this path'), 'custom not-found page rendered');
    assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 7: SPA navigation across the site, incl. data routes ──
  console.log('\n=== TEST 7: SPA navigation ===');
  {
    const page = await browser.newPage();
    const errors = [];
    const dataRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => { if (req.headers()['x-vesk-data'] === '1') dataRequests.push(req.url()); });
    await goto(page, BASE, { waitUntil: 'networkidle0' });

    const mark = (href, expect) => `await new Promise((res, rej) => {
      window.__spaFlag = true;
      window.__vesk_router.navigate(${JSON.stringify(href)});
      const t0 = Date.now();
      (function poll() {
        const ok = location.pathname === ${JSON.stringify(href)} && (document.getElementById('root') || document.body).textContent.includes(${JSON.stringify(expect)});
        if (ok) return res(true);
        if (Date.now() - t0 > 15000) return rej(new Error('nav timeout ' + ${JSON.stringify(href)}));
        setTimeout(poll, 100);
      })();
    })`;

    await page.evaluate(mark, '/about', 'How it works');
    assert(await page.evaluate(() => location.pathname === '/about' && window.__spaFlag === true), 'SPA nav → /about (no reload)');

    await page.evaluate(mark, '/blog', 'Hello, world');
    assert(await page.evaluate(() => location.pathname === '/blog' && window.__spaFlag === true), 'SPA nav → /blog (no reload)');

    await page.evaluate(mark, '/blog/hello-world', 'route /blog/hello-world');
    assert(await page.evaluate(() => location.pathname === '/blog/hello-world' && window.__spaFlag === true), 'SPA nav → /blog/hello-world (dynamic)');

    // Data route: fresh props fetched via X-Vesk-Data and rendered.
    await page.evaluate(mark, '/posts', 'Posts, fetched live');
    assert(await page.evaluate(() => location.pathname === '/posts' && window.__spaFlag === true), 'SPA nav → /posts (data route, no reload)');
    const hasPostAfter = await page.evaluate(() => document.body.textContent.includes('Hello Vesk'));
    assert(hasPostAfter, '/posts rendered fetched posts after SPA nav');

    // Guide doc: useFetch.text refetches doc.md client-side after SPA nav.
    await page.evaluate(mark, '/guide/reactivity', 'route: /guide/reactivity');
    assert(await page.evaluate(() => location.pathname === '/guide/reactivity' && window.__spaFlag === true), 'SPA nav → /guide/reactivity (no reload)');
    const guideAfter = await page.evaluate(() => document.body.textContent.includes('compiling') || !!document.querySelector('.g-main h1'));
    assert(guideAfter, '/guide/reactivity rendered content after SPA nav');

    await page.evaluate(mark, '/statements', 'Every JS construct');
    assert(await page.evaluate(() => location.pathname === '/statements' && window.__spaFlag === true), 'SPA nav → /statements (no reload)');

    await page.evaluate(mark, '/', 'what the compiler emits');
    assert(await page.evaluate(() => (location.pathname === '/' || location.pathname === '') && window.__spaFlag === true), 'SPA nav back → / (no reload)');

    const postsFetches = dataRequests.filter(u => u.includes('/posts')).length;
    const guideFetches = dataRequests.filter(u => u.includes('/guide/reactivity')).length;
    assert(postsFetches === 1, 'exactly one X-Vesk-Data fetch for /posts (got ' + postsFetches + ')');
    assert(guideFetches === 1, 'exactly one X-Vesk-Data fetch for /guide/reactivity (got ' + guideFetches + ')');
    assert(errors.length === 0, 'Zero JS errors across the SPA chain (got ' + errors.length + ': ' + errors.join(', ') + ')');
    await page.close();
  }

  // ── Test 8: API sanity + SSR markers ──
  console.log('\n=== TEST 8: API routes ===');
  {
    const page = await browser.newPage();
    const result = await page.evaluate(async () => {
      const posts = await fetch('/api/posts').then(r => r.json()).catch(() => null);
      const limited = await fetch('/api/posts?limit=2').then(r => r.json()).catch(() => null);
      const hello = await fetch('/api/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'crawler' }),
      }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
      return { posts, limited, hello };
    });
    assert(Array.isArray(result.posts) && result.posts.length >= 1 && typeof result.posts[0]?.date === 'string',
      '/api/posts returns typed post array');
    assert(Array.isArray(result.limited) && result.limited.length === 2, '/api/posts?limit=2 respects the limit');
    assert(result.hello.status === 201, 'POST /api/hello → 201 (got ' + result.hello.status + ')');
    await goto(page, BASE + '/posts', { waitUntil: 'networkidle0' });
    const raw = await fetch(BASE + '/posts').then(r => r.text());
    assert((raw.match(/<!--vsk-->/g) || []).length > 0, '/posts SSR output contains hydration markers');
    const ssrRefs = (raw.match(/ssr-data\.js/g) || []).length;
    assert(ssrRefs === 1, '/posts embeds exactly one ssr-data script (got ' + ssrRefs + ')');
    await page.close();
  }

  console.log(`\n\u2550\u2550\u2550 Hydration test: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  await browser.close();
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Hydration test error:', e); process.exit(1); });