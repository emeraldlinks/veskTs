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

  // ── Helper: set a flag, perform action, verify flag survives (proves no full reload) ──
  async function verifySPA(page, action, label) {
    await page.evaluate(() => { window.__spaFlag = true; });
    await action();
    const flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, `${label} — SPA (no full reload)`);
  }

  // ── Test 1: Navigate across static pages via NavLink (SPA) ──
  console.log('\n=== TEST 1: SPA nav across static pages (NavLink) ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE, { waitUntil: 'networkidle0' });

    // NavLink SPA to /about
    await verifySPA(page, async () => {
      await page.click('a[href="/about"]');
      await new Promise(r => setTimeout(r, 800));
    }, 'NavLink / → /about');
    assert(page.url().includes('/about'), 'URL changed to /about');
    const h1About = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1About === 'About Vesk', 'h1: ' + h1About);

    // NavLink SPA to /blog
    await verifySPA(page, async () => {
      await page.click('a[href="/blog"]');
      await new Promise(r => setTimeout(r, 800));
    }, 'NavLink /about → /blog');
    assert(page.url().includes('/blog'), 'URL changed to /blog');
    const h1Blog = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1Blog === 'Blog', 'h1: ' + h1Blog);

    // NavLink SPA back to /
    await verifySPA(page, async () => {
      await page.click('a[href="/"]');
      await new Promise(r => setTimeout(r, 800));
    }, 'NavLink /blog → /');
    assert(page.url() === BASE + '/' || page.url() === BASE, 'URL back to root');
    const h1Home = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1Home === 'Welcome to Vesk', 'h1: ' + h1Home);

    assert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // ── Test 2: SPA nav via Link from blog index to dynamic route ──
  console.log('\n=== TEST 2: Link click from blog to dynamic route ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/blog', { waitUntil: 'networkidle0' });

    // Link click to /blog/hello-world
    await verifySPA(page, async () => {
      await page.click('a[href="/blog/hello-world"]');
      await new Promise(r => setTimeout(r, 1500));
    }, 'Link /blog → /blog/hello-world');
    assert(page.url().includes('/blog/hello-world'), 'URL at /blog/hello-world');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1 === 'Post: hello-world', 'h1: ' + h1);

    assert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // ── Test 3: Link chain slug -> blog index -> different slug ──
  console.log('\n=== TEST 3: Link chain between dynamic routes ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    // Back to blog index via Link
    await verifySPA(page, async () => {
      await page.click('a[href="/blog"]');
      await new Promise(r => setTimeout(r, 800));
    }, 'Link /blog/hello-world → /blog');
    assert(page.url().includes('/blog'), 'URL at /blog');

    // Click different slug
    await verifySPA(page, async () => {
      await page.click('a[href="/blog/ssr-in-vesk"]');
      await new Promise(r => setTimeout(r, 1500));
    }, 'Link /blog → /blog/ssr-in-vesk');
    assert(page.url().includes('/blog/ssr-in-vesk'), 'URL at /blog/ssr-in-vesk');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1 === 'Post: ssr-in-vesk', 'h1: ' + h1);

    assert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // ── Test 4: Browser back/forward between routes ──
  console.log('\n=== TEST 4: Browser back/forward between dynamic routes ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    // SPA to blog index
    await verifySPA(page, async () => {
      await page.click('a[href="/blog"]');
      await new Promise(r => setTimeout(r, 800));
    }, 'go /blog/hello-world → /blog');

    // Browser back to slug
    await verifySPA(page, async () => {
      await page.goBack();
      await new Promise(r => setTimeout(r, 1500));
    }, 'back → /blog/hello-world');
    assert(page.url().includes('/blog/hello-world'), 'URL back to slug');
    const h1Back = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1Back === 'Post: hello-world', 'h1: ' + h1Back);

    // Browser forward to blog index
    await verifySPA(page, async () => {
      await page.goForward();
      await new Promise(r => setTimeout(r, 1500));
    }, 'forward → /blog');
    assert(page.url().includes('/blog'), 'URL forward to blog');
    const h1Fwd = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1Fwd === 'Blog', 'h1: ' + h1Fwd);

    assert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // ── Test 5: Dynamic route SSR + hydration markers ──
  console.log('\n=== TEST 5: Dynamic route hydration ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

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
    assert(markersInfo.markerCount === 0, 'All markers claimed (' + markersInfo.markerCount + ' remaining)');

    const navText = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    assert(navText.includes('Home') && navText.includes('About') && navText.includes('Blog'), 'nav links present');

    const footerText = await page.evaluate(() => {
      const f = document.querySelector('footer');
      return f ? f.textContent : '';
    });
    assert(footerText.includes('Powered by Vesk'), 'footer present');

    await page.close();
  }

  // ── Test 6: SPA nav to /about AFTER visiting dynamic routes ──
  console.log('\n=== TEST 6: NavLink about after dynamic route ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    // NavLink to /about
    await verifySPA(page, async () => {
      await page.click('a[href="/about"]');
      await new Promise(r => setTimeout(r, 1000));
    }, 'NavLink /blog/hello-world → /about');
    assert(page.url().includes('/about'), 'URL at /about');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim() || '');
    assert(h1 === 'About Vesk', 'h1: ' + h1);

    assert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // ── Results ──
  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  console.log('All blog hydration tests passed!');

  await browser.close();
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
