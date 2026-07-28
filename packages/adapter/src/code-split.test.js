/**
 * End-to-end test for code-split client bundles.
 * Builds with codeSplit:true, starts production server, uses puppeteer-core to
 * verify chunks are loaded dynamically via <script> injection during navigation.
 */
import { build } from './index.js';
import { startProdServer } from './prod-server.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, mkdirSync, rmSync } from 'fs';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');
const appDir = resolve(root, 'test-app', 'app');
const outDir = resolve(root, 'test-app', '.vesk', 'code-split-test');
const publicDir = resolve(root, 'test-app', 'public');
const staticDir = resolve(outDir, 'static');

const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
let browser;
let httpServer;

async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  try { rmSync(outDir, { recursive: true }); } catch {}
  mkdirSync(staticDir, { recursive: true });

  console.log('\n=== Build with code splitting ===');
  await build(appDir, { outDir, publicDir, codeSplit: true });

  const files = readdirSync(staticDir);
  const chunks = files.filter(f => f.startsWith('page-') && f.endsWith('.js'));
  console.error(`  ${chunks.length} chunk files: ${chunks.join(', ')}`);

  httpServer = await startProdServer(outDir, { port: PORT });
  await new Promise(r => setTimeout(r, 500));

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: '/data/data/com.termux/files/usr/lib/chromium/chrome',
  });

  // ── Test 1: Main bundle loads ──
  console.log('\n=== TEST 1: Main bundle loads ===');
  {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', r => requests.push(r.url()));

    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await assert(requests.some(r => r.includes('/_vesk/static/client.js')), 'Main client bundle loaded');
    await page.close();
  }

  // ── Test 2: Chunk script element injected into DOM ──
  console.log('\n=== TEST 2: Chunk injected into DOM ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 1000));

    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src*="page-about"]')).map(s => s.src)
    );
    await assert(scripts.length > 0, 'Chunk script tag found in DOM. ' + scripts.join(', '));

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent : '';
    });
    await assert(h1 === 'About Vesk', 'h1: ' + h1);
    await page.close();
  }

  // ── Test 3: Direct navigation to /about ──
  console.log('\n=== TEST 3: Direct navigation ===');
  {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    page.on('response', r => {}); // ensure response handler

    await page.goto(BASE + '/about', { waitUntil: 'networkidle0' });
    // After SSR hydration, the chunk should also be loaded for SPA navigation
    const hasChunk = requests.some(r => r.includes('/_vesk/static/page-about'));
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script')).map(s => s.src)
    );
    await assert(hasChunk || scripts.some(s => s.includes('page-about')), 'About chunk loaded');
    await page.close();
  }

  // ── Test 4: Blog page ──
  console.log('\n=== TEST 4: Blog route ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/blog', { waitUntil: 'networkidle0' });

    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src*="page-blog"]')).map(s => s.src)
    );
    await assert(scripts.length > 0, 'Blog chunk in DOM. ' + scripts.join(', '));

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent : '';
    });
    await assert(h1 && h1.includes('Blog'), 'h1: ' + h1);
    await page.close();
  }

  // ── Test 5: Blog slug ──
  console.log('\n=== TEST 5: Blog slug route ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

    const h1 = await page.evaluate(() => {
      const el = document.querySelector('h1');
      return el ? el.textContent : '';
    });
    await assert(h1.includes('hello-world'), 'Slug rendered');

    const body = await page.evaluate(() => document.body.textContent);
    await assert(body.includes('hello-world'), 'Body contains slug');
    await page.close();
  }

  // ── Test 6: Chunk not re-downloaded on SPA revisit ──
  console.log('\n=== TEST 6: Chunk caching ===');
  {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', r => requests.push(r.url()));

    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));
    const firstChunkCount = requests.filter(r => r.includes('/_vesk/static/page-about')).length;

    // Navigate back to home via popstate (SPA, no full reload)
    await page.evaluate(() => window.history.back());
    await new Promise(r => setTimeout(r, 800));
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));
    const secondChunkCount = requests.filter(r => r.includes('/_vesk/static/page-about')).length;

    await assert(secondChunkCount === firstChunkCount, 'Chunk not re-downloaded');
    await page.close();
  }

  // ── Test 7: Lazy component registration ──
  console.log('\n=== TEST 7: Lazy component registration ===');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });

    // Root page chunk is loaded on bootstrap, so root components exist
    // About page component should NOT be registered yet
    const before = await page.evaluate(() => Object.keys(globalThis.__components || {}).filter(k => k.includes('About') || k.includes('Page_About')));
    await assert(before.length === 0, 'No about components before navigation');

    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));

    const after = await page.evaluate(() => Object.keys(globalThis.__components || {}).filter(k => k.includes('About') || k.includes('Page_About')));
    await assert(after.length > 0, 'About components registered after chunk load');
    await page.close();
  }

  // ── Test 8: No JS errors ──
  console.log('\n=== TEST 8: No JS errors ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));

    await assert(errors.length === 0, 'Zero JS errors (' + errors.join(', ') + ')');
    await page.close();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  if (failed > 0) process.exit(1);
  console.log('All code-split tests passed!');
}

main().then(() => {
  if (browser) browser.close();
  if (httpServer) httpServer.close();
  process.exit(0);
}).catch(e => {
  console.error('Test error:', e);
  if (browser) browser.close();
  if (httpServer) httpServer.close();
  process.exit(1);
});
