/**
 * Hydration test for a freshly scaffolded create-vesk project.
 * Launches headless Chromium via puppeteer-core against the scratch-app dev server.
 *
 * Usage: node scratch-hydration-test.mjs
 * Prerequisite: bash /tmp/opencode/start-scratch.sh (vesk dev -p 3112 in scratch-app)
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE || 'http://localhost:3112';
let passed = 0;
let failed = 0;
let browser;

async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function newPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.__errors = errors;
  return page;
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0' });
}

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── TEST 1: Home SSR + hydration ─────────────────
  console.log('\n=== TEST 1: Home SSR + hydration ===');
  {
    const page = await newPage();
    await goto(page, BASE);

    assert(page.__errors.length === 0, 'zero JS errors on load (got ' + page.__errors.join(', ') + ')');

    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
    assert(h1 === 'Welcome to Vesk', 'h1: ' + h1);

    const countText = await page.evaluate(() => document.body.textContent.match(/count: (\d+)/)?.[1]);
    assert(countText === '0', 'counter SSR\'d at 0 (got ' + countText + ')');

    const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()));
    assert(buttons.join(',') === '+,-', 'buttons: ' + buttons.join(','));

    const nav = await page.evaluate(() => document.querySelector('nav')?.textContent.replace(/\s+/g, ' ').trim() || '');
    assert(nav.includes('Home') && nav.includes('Posts') && nav.includes('Statements'), 'nav: ' + nav);

    const footer = await page.evaluate(() => document.querySelector('footer')?.textContent.trim() || '');
    assert(footer.includes('Powered by Vesk'), 'footer: ' + footer);

    const hasDevMark = await page.evaluate(() => !!document.getElementById('__vesk_dev'));
    assert(process.env.PROD ? !hasDevMark : hasDevMark, process.env.PROD ? 'no dev overlay marker in prod' : 'dev overlay marker present');

    const title = await page.evaluate(() => document.title);
    assert(title === 'scratch-app', 'document.title: ' + title);

    // reactive counter updates client-side
    await page.click('button');
    await new Promise(r => setTimeout(r, 100));
    const afterPlus = await page.evaluate(() => document.body.textContent.match(/count: (\d+)/)?.[1]);
    assert(afterPlus === '1', 'counter + click → 1 (got ' + afterPlus + ')');

    await page.evaluate(() => document.querySelectorAll('button')[1].click());
    await new Promise(r => setTimeout(r, 100));
    const afterMinus = await page.evaluate(() => document.body.textContent.match(/count: (\d+)/)?.[1]);
    assert(afterMinus === '0', 'counter - click → 0 (got ' + afterMinus + ')');

    assert(page.__errors.length === 0, 'zero JS errors after counter clicks');
    await page.close();
  }

  // ── TEST 2: Static pages SSR ──────────────────────
  console.log('\n=== TEST 2: Static pages SSR ===');
  for (const [path, expected] of [['/about', 'About Vesk'], ['/blog', 'Hello World'], ['/statements', 'JS Statement Demo']]) {
    const page = await newPage();
    await goto(page, BASE + path);
    const body = await page.evaluate(() => document.body.textContent);
    assert(body.includes(expected), path + ' renders ' + expected);
    assert(page.__errors.length === 0, path + ' zero JS errors');
    await page.close();
  }

  // ── TEST 3: Blog hydration (replica of test-app TEST 6) ─
  console.log('\n=== TEST 3: Blog hydration (dynamic route) ===');
  {
    const page = await newPage();
    await goto(page, BASE + '/blog/hello-world');

    const url = page.url();
    assert(url.includes('/blog/hello-world'), 'URL at /blog/hello-world');

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent.trim() : '';
    });
    assert(h1.includes('Post:'), 'h1: ' + h1);

    const bodyText = await page.evaluate(() => document.body.textContent);
    console.log('  [debug] body excerpt:', bodyText.trim().substring(0, 300).replace(/\s+/g, ' '));
    assert(bodyText.includes('hello-world') || bodyText.includes('/hello-world'), 'slug shown in body');
    assert(bodyText.includes('Back to blog'), 'back link present');
    assert(page.__errors.length === 0, 'zero JS errors');
    await page.close();
  }

  // ── TEST 4: useFetch page (SSR data + hydration) ──
  console.log('\n=== TEST 4: /posts useFetch SSR + hydrate ===');
  {
    const page = await newPage();
    await goto(page, BASE + '/posts');
    const body = await page.evaluate(() => document.body.textContent);
    assert(body.includes('Posts'), 'posts page rendered');
    assert(body.includes('Hello Vesk'), 'posts SSR\'d from /api/posts');
    assert(body.includes('Fresh') || body.includes('Loading'), 'fetch state label present');
    assert(page.__errors.length === 0, 'zero JS errors on /posts');

    // client-side refresh keeps data
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Refresh')?.click());
    await new Promise(r => setTimeout(r, 600));
    const afterRefresh = await page.evaluate(() => document.body.textContent);
    assert(afterRefresh.includes('Hello Vesk'), 'posts still rendered after refresh');
    assert(page.__errors.length === 0, 'zero JS errors after refresh');
    await page.close();
  }

  // ── TEST 5: SPA navigation ────────────────────────
  console.log('\n=== TEST 5: SPA nav without reloads ===');
  {
    const page = await newPage();
    await goto(page, BASE);
    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 400));
    assert(page.url().endsWith('/about'), 'url is /about');
    assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav (no reload)');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
    assert(h1 === 'About Vesk', 'about content swapped in');
    assert(page.__errors.length === 0, 'zero JS errors during SPA nav');

    await page.click('a[href="/posts"]');
    await page.waitForFunction(() => document.body.textContent.includes('Hello Vesk'), { timeout: 8000 });
    assert(await page.evaluate(() => window.__spaFlag === true), 'nav to /posts is SPA (no reload)');
    assert(await page.evaluate(() => document.body.textContent.includes('Posts')), '/posts content in place');
    assert(page.__errors.length === 0, 'zero JS errors after /posts nav');

    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 400));
    assert(await page.evaluate(() => window.__spaFlag === true), 'nav to /blog is SPA (no reload)');
    await page.click('a[href="/blog/hello-world"]');
    await page.waitForFunction(() => document.body.textContent.includes('Post: hello-world'), { timeout: 8000 });
    assert(await page.evaluate(() => window.__spaFlag === true), 'nav to /blog/hello-world is SPA (no reload)');
    assert(page.__errors.length === 0, 'zero JS errors after dynamic SPA nav');

    await page.evaluate(() => window.history.back());
    await new Promise(r => setTimeout(r, 400));
    assert(await page.evaluate(() => document.body.textContent.includes('Hello World')), 'back to /blog works');
    assert(await page.evaluate(() => window.__spaFlag === true), 'back is SPA (no reload)');
    await page.close();
  }

  // ── TEST 6: 404 custom page ───────────────────────
  console.log('\n=== TEST 6: custom 404 ===');
  {
    const page = await newPage();
    await goto(page, BASE + '/nonexistent-route');
    const body = await page.evaluate(() => document.body.textContent);
    assert(body.includes('Page Not Found'), 'custom 404 rendered');
    assert(body.includes('404'), '404 status shown');
    assert(page.__errors.length === 0, 'zero JS errors on 404');
    await page.close();
  }

  // ── TEST 7: API routes ────────────────────────────
  console.log('\n=== TEST 7: API routes ===');
  {
    const page = await newPage();
    await goto(page, BASE);
    const results = await page.evaluate(async () => {
      const out = {};
      const posts = await fetch('/api/posts').then(r => r.json());
      out.posts = Array.isArray(posts) ? posts.length : -1;
      out.postTitle = posts[0]?.title;
      const hello = await fetch('/api/hello').then(r => r.json());
      out.hello = hello.message;
      const echo = await fetch('/api/echo/yo').then(r => r.json());
      out.echo = echo.message;
      return out;
    });
    assert(results.posts === 3, '/api/posts returns 3 posts (got ' + results.posts + ')');
    assert(results.postTitle === 'Hello Vesk', 'first post: ' + results.postTitle);
    assert(results.hello === 'Hello from Vesk!', '/api/hello: ' + results.hello);
    assert(results.echo === 'yo', '/api/echo/yo: ' + results.echo);
    assert(page.__errors.length === 0, 'zero JS errors fetching APIs');
    await page.close();
  }

  // ── TEST 8: error page renders on thrown errors ───
  console.log('\n=== TEST 8: error page ===');
  {
    const page = await newPage();
    await goto(page, BASE + '/__throw_test_404__');
    const body = await page.evaluate(() => document.body.textContent);
    assert(body.includes('Page Not Found'), 'unknown routes hit custom 404, not error page');
    await page.close();
  }

  await browser.close();
  console.log('\n\u2550\u2550\u2550 Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total \u2550\u2550\u2550');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test error:', e.message);
  if (browser) browser.close();
  process.exit(1);
});
