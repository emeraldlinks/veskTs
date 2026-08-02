/**
 * Vesk Production Server Test Runner.
 * Builds the app, starts the production server, runs all production tests.
 * Usage: node tests/prod-test.mjs
 */
import { execSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

execSync('npx tsx packages/cli/src/build-packages.ts', { cwd: root, stdio: 'inherit' });

const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
const outDir = resolve(root, 'test-app', '.vesk', 'prod-test');
let serverProcess = null;
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write(`  \u2713 ${msg}\n`); }
  else { failed++; process.stdout.write(`  \u2717 ${msg}\n`); }
}

async function buildApp() {
  process.stdout.write('\x1b[1mBuilding...\x1b[0m\n');
  const adapterPath = resolve(root, 'packages/adapter/src/index.ts');
  const adapterPathJs = resolve(root, 'packages/adapter/src/index.js');
  const { build } = await import(existsSync(adapterPath) ? adapterPath : adapterPathJs);
  const appDir = resolve(root, 'test-app', 'app');
  const publicDir = resolve(root, 'test-app', 'public');
  await build(appDir, { outDir, publicDir, codeSplit: true });
}

function startProdServer() {
  return new Promise((resolve_, reject) => {
    const prodServerPath = resolve(root, 'packages/adapter/src/prod-server.ts');
    const prodServerPathJs = resolve(root, 'packages/adapter/src/prod-server.js');
    serverProcess = spawn('npx', ['tsx', existsSync(prodServerPath) ? prodServerPath : prodServerPathJs], {
      cwd: resolve(root, 'test-app'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    });
    let started = false;
    const onData = (data) => {
      const text = data.toString();
      if (!started && text.includes('production server at')) {
        started = true;
        setTimeout(resolve_, 1000);
      }
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('error', reject);
    setTimeout(() => { if (!started) resolve_(); }, 10000);
  });
}

function stopProdServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

async function runProdHydrationTests() {
  process.stdout.write('\n\x1b[1m=== Production Hydration Tests ===\x1b[0m\n');
  const { default: puppeteer } = await import('puppeteer-core');
  const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // Test 1: Direct SSR navigation
  process.stdout.write('\n--- Direct SSR navigation ---\n');
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
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === expectedH1, `${path} — h1: ${h1}`);
    assert(errors.length === 0, `${path} — zero JS errors`);
    await page.close();
  }

  // Test 2: SPA navigation chain
  process.stdout.write('\n--- SPA navigation chain ---\n');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Welcome to Vesk', 'Start at /');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/about"]');
    await new Promise(r => setTimeout(r, 800));
    let flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/ → /about (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'About Vesk', 'h1: About Vesk');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/about → /blog (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'h1: Blog');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.click('a[href="/blog/hello-world"]');
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, '/blog → /blog/hello-world (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Post: hello-world', 'h1: Post: hello-world');

    assert(errors.length === 0, 'Zero JS errors during SPA nav');
    await page.close();
  }

  // Test 3: Browser back/forward
  process.stdout.write('\n--- Browser back/forward ---\n');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });
    await page.goto(BASE + '/blog', { waitUntil: 'networkidle0' });
    let h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'Direct /blog');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.back());
    await new Promise(r => setTimeout(r, 800));
    let flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, 'back → /blog/hello-world (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Post: hello-world', 'h1: Post: hello-world');

    await page.evaluate(() => { window.__spaFlag = true; });
    await page.evaluate(() => window.history.forward());
    await new Promise(r => setTimeout(r, 800));
    flagAlive = await page.evaluate(() => window.__spaFlag === true);
    assert(flagAlive, 'forward → /blog (SPA)');
    h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1 === 'Blog', 'h1: Blog');

    assert(errors.length === 0, 'Zero JS errors back/forward');
    await page.close();
  }

  // Test 4: Hydration markers consumed
  process.stdout.write('\n--- Hydration ---\n');
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    const markers = await page.evaluate(() => document.body.innerHTML.match(/<!--vsk-->/g) || []);
    assert(markers.length === 0, 'All markers consumed');
    const navLinks = await page.evaluate(() => Array.from(document.querySelectorAll('nav a')).map(a => a.textContent.trim()));
    assert(navLinks.includes('Home') && navLinks.includes('About') && navLinks.includes('Blog'), `Nav: ${navLinks.join(', ')}`);
    const footer = await page.evaluate(() => document.querySelector('footer p')?.textContent?.trim() || '');
    assert(footer.includes('Powered by Vesk'), `Footer: ${footer}`);
    await page.close();
  }

  await browser.close();
}

async function main() {
  process.stdout.write('\x1b[1m\x1b[36m=== Vesk Production Test Runner ===\x1b[0m\n');

  try {
    await buildApp();
  } catch (e) {
    process.stderr.write(`Build failed: ${e.message}\n`);
    process.exit(1);
  }

  try {
    await startProdServer();
  } catch (e) {
    process.stderr.write(`Failed to start server: ${e.message}\n`);
    stopProdServer();
    process.exit(1);
  }

  try {
    await runProdHydrationTests();
  } finally {
    stopProdServer();
  }

  const total = passed + failed;
  process.stdout.write(`\n\x1b[1m\x1b[36m\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${total} total \u2550\u2550\u2550\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  process.stderr.write(`Fatal: ${e.stack}\n`);
  stopProdServer();
  process.exit(1);
});
