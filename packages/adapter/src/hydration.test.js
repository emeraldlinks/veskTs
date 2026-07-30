import { build } from './index';
import { startProdServer } from './prod-server';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import puppeteer from 'puppeteer-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');
const appDir = resolve(root, 'test-app', 'app');
const outDir = resolve(root, 'test-app', '.vesk', 'hydration-test');
const publicDir = resolve(root, 'test-app', 'public');

const PORT = parseInt(process.env.VESK_E2E_PROD_PORT || '3099');
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
let browser;
let httpServer;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

function findChrome() {
  return '/data/data/com.termux/files/usr/bin/chromium-browser';
}

async function main() {
  if (!process.env.VESK_E2E) {
    try { rmSync(outDir, { recursive: true }); } catch {}
    mkdirSync(resolve(outDir, 'static'), { recursive: true });

    await build(appDir, { outDir, publicDir });

    httpServer = await startProdServer(outDir, { port: PORT });
    await new Promise(r => setTimeout(r, 500));
  }

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    executablePath: findChrome(),
  });

  try {
    console.log('\n=== Initial load ===');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(BASE, { waitUntil: 'networkidle0' });

      assert(errors.length === 0, 'Zero JS errors on load');

      const rootChildren = await page.evaluate(() => {
        const root = document.getElementById('root');
        return root ? root.children.length : 0;
      });
      assert(rootChildren >= 3, `#root has ${rootChildren} children`);

      const navText = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        return nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '';
      });
      assert(navText.includes('Home') && navText.includes('About') && navText.includes('Blog'), 'nav links present');

      const h1 = await page.evaluate(() => {
        const el = document.querySelector('h1');
        return el ? el.textContent.trim() : '';
      });
      assert(h1 === 'Welcome to Vesk', 'h1: Welcome to Vesk');

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
      assert(footerText.includes('Powered by Vesk'), 'footer shows Powered by Vesk');

      await page.close();
    }

    console.log('\n=== Reactivity ===');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });

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
      assert(after.some(p => p === '11'), 'count updated to 11 after click');

      for (let i = 0; i < 4; i++) {
        await page.click('button');
        await new Promise(r => setTimeout(r, 50));
      }

      const afterFive = await page.evaluate(() => {
        const ps = Array.from(document.querySelectorAll('main p'));
        return ps.map(p => p.textContent.trim());
      });
      assert(afterFive.some(p => p === '15'), 'count updated to 15 after 5 clicks');

      const hasOk = await page.evaluate(() => document.body.textContent.includes('OK '));
      assert(hasOk, 'OK content shown at count >= 15');

      await page.close();
    }

    console.log('\n=== Error boundaries ===');
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

    console.log('\n=== SPA navigation ===');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });

      await page.click('a[href="/about"]');
      await new Promise(r => setTimeout(r, 300));

      assert(page.url().includes('/about'), 'URL changed to /about');

      const h1 = await page.evaluate(() => {
        const el = document.querySelector('h1');
        return el ? el.textContent.trim() : '';
      });
      assert(h1 === 'About Vesk', 'h1: About Vesk');

      await page.close();
    }

    console.log('\n=== Back navigation ===');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });

      await page.click('a[href="/about"]');
      await new Promise(r => setTimeout(r, 200));
      await page.goBack();
      await new Promise(r => setTimeout(r, 300));

      assert(page.url() === BASE + '/' || page.url() === BASE, 'URL back to root');

      const h1 = await page.evaluate(() => {
        const el = document.querySelector('h1');
        return el ? el.textContent.trim() : '';
      });
      assert(h1 === 'Welcome to Vesk', 'h1 back to Welcome');

      await page.close();
    }

    console.log('\n=== Dynamic route ===');
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

      assert(page.url().includes('/blog/hello-world'), 'URL at /blog/hello-world');

      const h1 = await page.evaluate(() => {
        const el = document.querySelector('h1');
        return el ? el.textContent.trim() : '';
      });
      assert(h1.includes('Post:'), 'h1 shows Post:');

      await page.close();
    }

    console.log('\n=== No JS errors ===');
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

      assert(errors.length === 0, 'Zero JS errors through interactions');
      await page.close();
    }

    console.log('\n=== Hydration strategies ===');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });

      const modulesAccessible = await page.evaluate(async () => {
        try {
          const hyd = await import('/_vesk/runtime.js');
          return {
            hasHydrateViewport: typeof hyd.hydrateViewport === 'function',
            hasHydrateIdle: typeof hyd.hydrateIdle === 'function',
            hasHydrateOnInteraction: typeof hyd.hydrateOnInteraction === 'function',
            hasCollectVskMarkers: typeof hyd.collectVskMarkers === 'function',
            hasCreateHydrateWalker: typeof hyd.createHydrateWalker === 'function',
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
      assert(markersInfo.markerCount === 0, `All markers claimed (${markersInfo.markerCount} remaining)`);

      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    if (httpServer) httpServer.close();
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('Test error:', e.message);
  process.exit(1);
});
