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

    const { build } = await import(resolve(root, 'packages/adapter/src/index.js'));
    const { startProdServer } = await import(resolve(root, 'packages/adapter/src/prod-server.js'));
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

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.goto(BASE + '/blog', { waitUntil: 'networkidle0' });
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'Direct /blog → h1: Blog');

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

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);

  await browser.close();
  if (httpServer) httpServer.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
