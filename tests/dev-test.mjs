/**
 * Vesk Dev Server Test Runner.
 * Starts the CLI dev server, runs all unit tests, hydration tests, and HMR tests.
 * Usage: node tests/dev-test.mjs
 */
import { execSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PORT = 3000;
let serverProcess = null;
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write(`  \u2713 ${msg}\n`); }
  else { failed++; process.stdout.write(`  \u2717 ${msg}\n`); }
}

function startDevServer() {
  return new Promise((resolve_, reject) => {
    const cliEntry = resolve(root, 'packages/cli/src/index.ts');
    const cliEntryJs = resolve(root, 'packages/cli/src/index.js');
    const cliPath = existsSync(cliEntry) ? cliEntry : cliEntryJs;
    serverProcess = spawn('npx', ['tsx', cliPath, 'dev', '--port', String(PORT)], {
      cwd: resolve(root, 'test-app'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' },
    });
    let started = false;
    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (!started && text.includes('dev server at')) {
        started = true;
        resolve_();
      }
    });
    serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      if (!started && text.includes('dev server at')) {
        started = true;
        resolve_();
      }
    });
    serverProcess.on('error', reject);
    setTimeout(() => { if (!started) resolve_(); }, 15000);
  });
}

function stopDevServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

async function runUnitTests() {
  process.stdout.write('\n\x1b[1m=== Unit Tests ===\x1b[0m\n');
  const testDirs = [
    resolve(root, 'packages/compiler/src'),
    resolve(root, 'packages/runtime/src'),
    resolve(root, 'packages/adapter/src'),
  ];
  for (const dir of testDirs) {
    if (!existsSync(dir)) continue;
    const files = (await import('fs')).readdirSync(dir).filter(f => f.endsWith('.test.js'));
    for (const file of files.sort()) {
      const filePath = resolve(dir, file);
      process.stdout.write(`${file} ... `);
      try {
        const output = execSync(`node --experimental-vm-modules "${filePath}"`, {
          encoding: 'utf-8', timeout: 120000,
        });
        const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
        if (match) {
          const p = parseInt(match[1]), f = parseInt(match[2]);
          passed += p; failed += f;
          process.stdout.write(f > 0 ? `FAIL (${f} failure${f > 1 ? 's' : ''})\n` : `OK (${p} tests)\n`);
        } else {
          process.stdout.write(`OK\n`);
        }
      } catch (e) {
        failed++;
        process.stdout.write(`ERROR: ${e.message.slice(0, 150)}\n`);
      }
    }
  }
}

async function runHydrationTests() {
  process.stdout.write('\n\x1b[1m=== Hydration Tests ===\x1b[0m\n');
  const { default: puppeteer } = await import('puppeteer-core');
  const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
  const BASE = `http://localhost:${PORT}`;

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  async function hydrateAssert(cond, msg) {
    if (cond) { passed++; process.stdout.write(`  \u2713 ${msg}\n`); }
    else { failed++; process.stdout.write(`  \u2717 ${msg}\n`); }
  }

  // Test 1: Initial load
  process.stdout.write('\n--- Initial load ---\n');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    hydrateAssert(errors.length === 0, `Zero JS errors (got ${errors.length})`);
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1 === 'Welcome to Vesk', `h1: ${h1}`);
    const navText = await page.evaluate(() => document.querySelector('nav')?.textContent.replace(/\s+/g, ' ').trim() || '');
    hydrateAssert(navText.includes('Home') && navText.includes('About') && navText.includes('Blog'), `nav: ${navText}`);
    const paragraphs = await page.evaluate(() => Array.from(document.querySelectorAll('main p')).map(p => p.textContent.trim()));
    hydrateAssert(paragraphs.some(p => p === '10'), 'count shows 10');
    hydrateAssert(paragraphs.some(p => p.includes('Hurray')), 'hurray message');
    await page.close();
  }

  // Test 2: Reactivity
  process.stdout.write('\n--- Reactivity ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.click('button');
    await new Promise(r => setTimeout(r, 200));
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('main p')).map(p => p.textContent.trim()));
    hydrateAssert(after.some(p => p === '11'), 'count 11 after click');
    for (let i = 0; i < 4; i++) { await page.click('button'); await new Promise(r => setTimeout(r, 50)); }
    const afterFive = await page.evaluate(() => Array.from(document.querySelectorAll('main p')).map(p => p.textContent.trim()));
    hydrateAssert(afterFive.some(p => p === '15'), 'count 15 after 5 clicks');
    const hasOk = await page.evaluate(() => document.body.textContent.includes('OK '));
    hydrateAssert(hasOk, 'OK shown at count >= 15');
    await page.close();
  }

  // Test 3: SPA navigation
  process.stdout.write('\n--- SPA navigation ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 300));
    hydrateAssert(page.url().includes('/about'), 'URL /about');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1 === 'About Vesk', 'h1: About Vesk');
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 300));
    hydrateAssert(page.url().includes('/blog'), 'URL /blog');
    const h1b = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1b === 'Blog', 'h1: Blog');
    await page.close();
  }

  // Test 4: Dynamic routes
  process.stdout.write('\n--- Dynamic routes ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });
    hydrateAssert(page.url().includes('/blog/hello-world'), 'URL /blog/hello-world');
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1.includes('Post:'), `h1: ${h1}`);
    await page.close();
  }

  // Test 5: SPA nav chain across dynamic routes
  process.stdout.write('\n--- SPA nav chain ---\n');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE + '/blog', { waitUntil: 'networkidle0' });
    await page.click('a[href="/blog/hello-world"]');
    await new Promise(r => setTimeout(r, 800));
    hydrateAssert(page.url().includes('/blog/hello-world'), 'link → /blog/hello-world');
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1 === 'Post: hello-world', 'h1: Post: hello-world');
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 800));
    await page.click('a[href="/blog/ssr-in-vesk"]');
    await new Promise(r => setTimeout(r, 800));
    hydrateAssert(page.url().includes('/blog/ssr-in-vesk'), 'link → /blog/ssr-in-vesk');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    hydrateAssert(h1 === 'Post: ssr-in-vesk', 'h1: Post: ssr-in-vesk');
    hydrateAssert(errors.length === 0, 'Zero JS errors');
    await page.close();
  }

  // Test 6: Tailwind CSS
  process.stdout.write('\n--- Tailwind CSS ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    const twCss = await page.evaluate(async () => {
      const res = await fetch('/_vesk/static/_tailwind.css');
      return { ok: res.ok, length: (await res.text()).length };
    });
    hydrateAssert(twCss.ok, '_tailwind.css OK');
    hydrateAssert(twCss.length > 1000, `_tailwind.css ${twCss.length} bytes`);
    const userCss = await page.evaluate(async () => {
      const res = await fetch('/_vesk/static/global.css');
      return { ok: res.ok, hasImport: (await res.text()).includes("@import 'tailwindcss'") };
    });
    hydrateAssert(userCss.ok, 'global.css OK');
    hydrateAssert(!userCss.hasImport, 'global.css no tailwind import');
    const h1Styles = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      return { fontSize: getComputedStyle(h1).fontSize, fontWeight: getComputedStyle(h1).fontWeight };
    });
    hydrateAssert(h1Styles?.fontSize === '36px', 'h1 font-size 36px');
    hydrateAssert(h1Styles?.fontWeight === '700', 'h1 font-weight 700');
    await page.close();
  }

  // Test 7: Hydration markers consumed
  process.stdout.write('\n--- Hydration markers ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    const markers = await page.evaluate(() => document.body.innerHTML.match(/<!--vsk-->/g) || []);
    hydrateAssert(markers.length === 0, 'All markers consumed');
    await page.close();
  }

  await browser.close();
}

async function runHmrTests() {
  process.stdout.write('\n\x1b[1m=== HMR Tests ===\x1b[0m\n');
  const { default: puppeteer } = await import('puppeteer-core');
  const { readFileSync, writeFileSync } = await import('fs');
  const { resolve } = await import('path');
  const { WebSocket } = await import('ws');

  const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
  const HMR_PORT = 3002;
  const BASE = `http://localhost:${HMR_PORT}`;
  const appDir = resolve(root, 'test-app', 'app');
  const pagePath = resolve(appDir, 'page.vsk');
  const layoutPath = resolve(appDir, 'layout.vsk');
  const originalPage = readFileSync(pagePath, 'utf-8');
  const originalLayout = readFileSync(layoutPath, 'utf-8');

  async function hmrAssert(cond, msg) {
    if (cond) { passed++; process.stdout.write(`  \u2713 ${msg}\n`); }
    else { failed++; process.stdout.write(`  \u2717 ${msg}\n`); }
  }

  // Start adapter dev server on port 3002
  let hmrServerProcess;
  await new Promise((resolve_, reject) => {
    const hmrEntry = resolve(root, 'packages/adapter/src/dev-server.ts');
    const hmrEntryJs = resolve(root, 'packages/adapter/src/dev-server.js');
    const hmrPath = existsSync(hmrEntry) ? hmrEntry : hmrEntryJs;
    hmrServerProcess = spawn('npx', ['tsx', hmrPath], {
      cwd: resolve(root, 'test-app'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(HMR_PORT) },
    });
    let started = false;
    const onData = (data) => {
      const text = data.toString();
      if (!started && (text.includes('dev server at') || text.includes('rebuilt'))) {
        started = true;
        setTimeout(resolve_, 1000);
      }
    };
    hmrServerProcess.stdout.on('data', onData);
    hmrServerProcess.stderr.on('data', onData);
    setTimeout(() => resolve_(), 15000);
  });

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    // HMR Test 1: page.vsk content update
    process.stdout.write('\n--- HMR page.vsk update ---\n');
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      const h1Before = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      hmrAssert(h1Before === 'Welcome to Vesk', `Initial h1: ${h1Before}`);
      await page.evaluate(() => { window.__spaFlag = true; });
      const modifiedPage = originalPage.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>');
      writeFileSync(pagePath, modifiedPage, 'utf-8');
      await new Promise(r => setTimeout(r, 4000));
      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      hmrAssert(flagAlive, 'No full reload');
      const h1After = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      hmrAssert(h1After === 'HMR Updated!', `H1: ${h1After}`);
      hmrAssert(errors.length === 0, 'Zero JS errors');
      writeFileSync(pagePath, originalPage, 'utf-8');
      await page.close();
    }

    // HMR Test 2: SPA nav still works
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('\n--- HMR SPA nav ---\n');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      await page.evaluate(() => { window.__spaFlag = true; });
      await page.click('a[href="/blog"]');
      await new Promise(r => setTimeout(r, 800));
      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      hmrAssert(flagAlive, 'SPA nav works after HMR');
      hmrAssert(page.url().includes('/blog'), 'URL /blog');
      await page.close();
    }

    // HMR Test 3: layout.vsk update
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('\n--- HMR layout update ---\n');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      await page.evaluate(() => { window.__spaFlag = true; });
      const modifiedLayout = originalLayout.replace(/<p>Powered by Vesk<\/p>/, '<p>HMR Footer Update</p>');
      writeFileSync(layoutPath, modifiedLayout, 'utf-8');
      await new Promise(r => setTimeout(r, 4000));
      const flagAlive = await page.evaluate(() => window.__spaFlag === true);
      hmrAssert(flagAlive, 'No full reload on layout change');
      const footerAfter = await page.evaluate(() => document.querySelector('footer p')?.textContent?.trim() || '');
      hmrAssert(footerAfter === 'HMR Footer Update', `Footer: ${footerAfter}`);
      writeFileSync(layoutPath, originalLayout, 'utf-8');
      await page.close();
    }

    // HMR Test 4: error recovery
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('\n--- HMR error recovery ---\n');
    {
      const page = await browser.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle0' });
      writeFileSync(pagePath, 'invalid vesk code {{{', 'utf-8');
      await new Promise(r => setTimeout(r, 1500));
      writeFileSync(pagePath, originalPage, 'utf-8');
      await new Promise(r => setTimeout(r, 3000));
      const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
      hmrAssert(h1 === 'Welcome to Vesk', `Recovered h1: ${h1}`);
      await page.close();
    }
  } finally {
    writeFileSync(pagePath, originalPage, 'utf-8');
    writeFileSync(layoutPath, originalLayout, 'utf-8');
  }

  await browser.close();
  if (hmrServerProcess) hmrServerProcess.kill('SIGTERM');
}

async function main() {
  process.stdout.write('\x1b[1m\x1b[36m=== Vesk Dev Test Runner ===\x1b[0m\n');
  process.stdout.write('Starting dev server...\n');
  try {
    await startDevServer();
  } catch (e) {
    process.stderr.write(`Failed to start dev server: ${e.message}\n`);
    stopDevServer();
    process.exit(1);
  }

  try {
    await runUnitTests();
    await runHydrationTests();
    await new Promise(r => setTimeout(r, 1000));
    await runHmrTests();
  } finally {
    stopDevServer();
  }

  const total = passed + failed;
  process.stdout.write(`\n\x1b[1m\x1b[36m\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${total} total \u2550\u2550\u2550\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  process.stderr.write(`Fatal: ${e.stack}\n`);
  stopDevServer();
  process.exit(1);
});
