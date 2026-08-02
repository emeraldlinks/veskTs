import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname);
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const PORT = parseInt(process.env.VESK_E2E_PROD_PORT || '3099');
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
let browser;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  let httpServer;
  if (!process.env.VESK_E2E) {
    const outDir = resolve(root, 'test-app', '.vesk', 'prod-test');

    const { build } = await import(resolve(root, 'packages/adapter/src/index.ts'));
    const { startProdServer } = await import(resolve(root, 'packages/adapter/src/prod-server.ts'));
    const appDir = resolve(root, 'test-app', 'app');
    const publicDir = resolve(root, 'test-app', 'public');

    console.error('Building...');
    await build(appDir, { outDir, publicDir, codeSplit: true });
    httpServer = await startProdServer(outDir, { port: PORT });
    await new Promise(r => setTimeout(r, 1000));
  }

  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── 0. Check JS errors on each page ──
  console.log('\n=== JS error inspection ===');
  for (const path of ['/', '/about', '/blog', '/blog/hello-world']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
    });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    if (errors.length > 0) {
      console.log(`  ${path} errors:`);
      for (const e of errors) console.log(`    - ${e}`);
    } else {
      console.log(`  ${path}: no errors`);
    }
    await page.close();
  }

  // ── 1. Direct SSR navigation to each page ──
  console.log('\n=== Direct SSR navigation (full page reload) ===');
  for (const [path, expectedH1] of [
    ['/', 'Welcome to Vesk'],
    ['/about', 'About Vesk'],
    ['/blog', 'Blog'],
    ['/blog/hello-world', 'Post: hello-world'],
    ['/blog/ssr-in-vesk', 'Post: ssr-in-vesk'],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === expectedH1, `${path} — h1: ${h1}`);
    assert(errors.length === 0, `${path} — zero JS errors`);
    await page.close();
  }

  // ── 2. SPA navigation chain ──
  console.log('\n=== SPA navigation chain ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Welcome to Vesk', 'Start at /');

    // SPA / → /about
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));
    let flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/ → /about (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'About Vesk', 'h1: About Vesk');

    // SPA /about → /blog
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/about → /blog (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'h1: Blog');

    // SPA /blog → /blog/hello-world
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog/hello-world"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/blog → /blog/hello-world (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Post: hello-world', 'h1: Post: hello-world');

    // SPA /blog/hello-world → /blog → /blog/ssr-in-vesk
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/blog/hello-world → /blog (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'h1: Blog');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog/ssr-in-vesk"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/blog → /blog/ssr-in-vesk (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Post: ssr-in-vesk', 'h1: Post: ssr-in-vesk');

    // SPA /blog/ssr-in-vesk → /about
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/blog/ssr-in-vesk → /about (SPA, no reload)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'About Vesk', 'h1: About Vesk');

    assert(errors.length === 0, 'Zero JS errors during SPA nav chain');
    await page.close();
  }

  // ── 3. Browser back/forward ──
  console.log('\n=== Browser back/forward ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    // navigate to /blog via SPA click so both history entries are same-document
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 800));
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'SPA /blog → h1: Blog');
    assert(await page.evaluate(() => window.__spaFlag === true), '/blog reached without reload');

    // back (SPA)
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.back());
    await new Promise(r => setTimeout(r, 800));
    let flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, 'back → /blog/hello-world (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Post: hello-world', 'h1: Post: hello-world');

    // forward (SPA)
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.forward());
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, 'forward → /blog (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'h1: Blog');

    assert(errors.length === 0, 'Zero JS errors during back/forward');
    await page.close();
  }

  // ── 4. Hydration: verify markers consumed and DOM intact ──
  console.log('\n=== Hydration + DOM structure ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

    // No hydration markers should remain
    const markers = await page.evaluate(() => document.body.innerHTML.match(/<!--vsk-->/g) || []);
    assert(markers.length === 0, 'All hydration markers consumed');

    // nav links present
    const navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a')).map(a => a.textContent.trim())
    );
    assert(navLinks.includes('Home') && navLinks.includes('About') && navLinks.includes('Blog'), 'Nav links present: ' + navLinks.join(', '));

    // footer present
    const footer = await page.evaluate(() => document.querySelector('footer p')?.textContent?.trim() || '');
    assert(footer.includes('Powered by Vesk'), 'Footer: ' + footer);

    await page.close();
  }

  // ── 5. Fresh server data on SPA navigation (X-Vesk-Data) ──
  console.log('\n=== Fresh server data on SPA navigation (TEST 12) ===');
  {
    const page = await browser.newPage();
    const errors = [];
    const dataRequests = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => {
      if (req.headers()['x-vesk-data'] === '1') dataRequests.push(req.url());
    });

    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

    // No data request should fire for the initial SSR'd page
    assert(dataRequests.length === 0, `no X-Vesk-Data request on initial load (got ${dataRequests.length})`);

    const titleBefore = await page.evaluate(() => document.title);
    assert(titleBefore !== 'Async — load() + async components', 'title is not the async one yet: "' + titleBefore + '"');

    // SPA nav to /async: optimistic render first, then fresh head + props land
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/async"]');
    await page.waitForFunction(() => document.title.includes('Async'), { timeout: 8000 });
    await new Promise(r => setTimeout(r, 200));

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

  // ── 6. Fresh data on repeated SPA navigation (prefetch reuse) (TEST 13) ──
  console.log('\n=== Fresh data on repeated SPA navigation (TEST 13) ===');
  {
    const page = await browser.newPage();
    const errors = [];
    let asyncDataRequests = 0;
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', req => {
      if (req.headers()['x-vesk-data'] === '1' && req.url().includes('/async')) asyncDataRequests++;
    });
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

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

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);

  await browser.close();
  if (httpServer) httpServer.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
