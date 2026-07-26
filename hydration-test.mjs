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
