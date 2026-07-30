import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname);
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = 'http://localhost:3000';

const pagePath = resolve(root, 'test-app', 'app', 'page.vsk');
const layoutPath = resolve(root, 'test-app', 'app', 'layout.vsk');

let passed = 0;
let failed = 0;
let browser;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  // Read original sources
  const originalPage = readFileSync(pagePath, 'utf-8');
  const originalLayout = readFileSync(layoutPath, 'utf-8');

  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    // ── Test 1: HMR updates page.vsk content without full reload ──
    console.log('\n=== HMR: page.vsk content update ===');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') return;
      });

      await page.goto(BASE, { waitUntil: 'networkidle0' });

      // Verify initial content
      const h1Before = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      assert(h1Before === 'Welcome to Vesk', 'Initial h1: ' + h1Before);

      // Set SPA flag to detect full reloads
      await page.evaluate(() => { window.__spaFlag = true; });

      // Modify page.vsk
      const modifiedPage = originalPage.replace(
        /<h1[^>]*>[^<]*<\/h1>/,
        '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>'
      );
      writeFileSync(pagePath, modifiedPage, 'utf-8');

      // Wait for HMR rebuild + WebSocket broadcast + client eval + DOM update
      await new Promise(r => setTimeout(r, 4000));

      // Check content updated without full reload
      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      assert(flagAlive, 'No full page reload (SPA flag survived)');

      const h1After = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      assert(h1After === 'HMR Updated!', 'H1 updated: ' + h1After);
      assert(errors.length === 0, 'Zero JS errors during HMR update');
      await page.close();
    }

    // ── Test 2: SPA navigation still works after HMR update ──
    console.log('\n=== HMR: SPA nav still works after update ===');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(BASE, { waitUntil: 'networkidle0' });

      // Navigate to /about
      await page.evaluate(() => { window.__spaFlag = true; });
      await page.click('a[href="/about"]');
      await new Promise(r => setTimeout(r, 800));

      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      assert(flagAlive, 'SPA navigation still works after HMR');
      assert(page.url().includes('/about'), 'URL at /about');
      const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      assert(h1 === 'About Vesk', 'h1: ' + h1);
      assert(errors.length === 0, 'Zero JS errors');
      await page.close();
    }

    // ── Test 3: HMR updates layout.vsk ──
    console.log('\n=== HMR: layout.vsk content update ===');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(BASE, { waitUntil: 'networkidle0' });

      const footerBefore = await page.evaluate(() => document.querySelector('footer p')?.textContent || '');
      assert(footerBefore.includes('Powered by Vesk'), 'Initial footer: ' + footerBefore);

      await page.evaluate(() => { window.__spaFlag = true; });

      // Modify layout.vsk footer
      const modifiedLayout = originalLayout.replace(
        /<p>Powered by Vesk<\/p>/,
        '<p>HMR Footer Update</p>'
      );
      writeFileSync(layoutPath, modifiedLayout, 'utf-8');

      await new Promise(r => setTimeout(r, 4000));

      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      assert(flagAlive, 'No full reload on layout change');

      const footerAfter = await page.evaluate(() => document.querySelector('footer p')?.textContent?.trim() || '');
      assert(footerAfter === 'HMR Footer Update', 'Footer updated: ' + footerAfter);
      assert(errors.length === 0, 'Zero JS errors');
      await page.close();
    }

    // ── Test 4: Fix compilation error via HMR ──
    console.log('\n=== HMR: recovery from compilation error ===');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.goto(BASE, { waitUntil: 'networkidle0' });

      // Write broken file
      writeFileSync(pagePath, 'invalid vesk code {{{', 'utf-8');
      await new Promise(r => setTimeout(r, 1500));

      // Write fixed file
      writeFileSync(pagePath, originalPage, 'utf-8');
      await new Promise(r => setTimeout(r, 3000));

      // After fix, page should show original content
      const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      assert(h1 === 'Welcome to Vesk', 'Recovered h1: ' + h1);

      // SPA nav still works after error recovery
      await page.evaluate(() => { window.__spaFlag = true; });
      await page.click('a[href="/blog"]');
      await new Promise(r => setTimeout(r, 800));
      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      assert(flagAlive, 'SPA nav works after error recovery');
      assert(page.url().includes('/blog'), 'URL at /blog');
      assert(errors.length === 0, 'Zero JS errors');
      await page.close();
    }

  } finally {
    // Restore original files
    writeFileSync(pagePath, originalPage, 'utf-8');
    writeFileSync(layoutPath, originalLayout, 'utf-8');
    if (browser) await browser.close();
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  console.log('All HMR puppeteer tests passed!');
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
