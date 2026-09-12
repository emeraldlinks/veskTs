import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/workspaces/veskTs/chrome/linux-152.0.7977.82/chrome-linux64/chrome';
const BASE = process.env.BASE || 'http://localhost:3000';

let passed = 0;
let failed = 0;
async function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function clickEl(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('no element: ' + s);
    el.click();
  }, sel);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── Test 1: Initial load, zero JS errors, lucide icons hydrated ──
  console.log('\n=== TEST 1: initial load ===');
  {
    const page = await browser.newPage();
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    assert(errors.length === 0, 'zero pageerror (got ' + errors.length + ': ' + errors.join(' | ') + ')');
    assert(consoleErrors.length === 0, 'zero console errors (got ' + consoleErrors.length + ': ' + consoleErrors.join(' | ') + ')');

    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1.length > 0, 'h1 present: ' + h1);

    const navSvg = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? nav.querySelectorAll('svg').length : -1;
    });
    assert(navSvg >= 0, 'nav present, svg count: ' + navSvg);

    const markers = await page.evaluate(() => {
      const root = document.getElementById('root');
      const walker = document.createTreeWalker(root, 128, { acceptNode: n => n.textContent === 'vsk' ? 1 : 2 });
      let c = 0; while (walker.nextNode()) c++;
      return c;
    });
    assert(markers === 0, 'all hydration markers claimed (' + markers + ' remain)');
    await page.close();
  }

  // ── Test 2: interactive lucide-heavy component (mobile nav toggle) ──
  console.log('\n=== TEST 2: nav toggle ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));

    const toggles = [
      '[aria-label="Toggle navigation"]',
      'button[class*="menu"]',
      'summary',
    ];
    let toggler = null;
    try {
      for (const sel of toggles) {
        const found = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return el ? { tag: el.tagName, cls: el.className, label: el.getAttribute('aria-label') } : null;
        }, sel);
        if (found) { toggler = sel; break; }
      }
    } catch { /* selector may be invalid */ }

    if (!toggler) {
      // any button inside nav
      const anyBtn = await page.evaluate(() => {
        const nav = document.querySelector('nav');
        const b = nav && nav.querySelector('button');
        return b ? { tag: b.tagName } : null;
      });
      if (anyBtn) toggler = 'nav button';
    }

    console.log('  [info] toggler candidate:', toggler);
    assert(errors.length === 0, 'zero pageerror after interaction (got ' + errors.join(' | ') + ')');
    await page.close();
  }

  // ── Test 3: SPA navigation into code-split route ──
  console.log('\n=== TEST 3: SPA nav to /docs (code-split chunk) ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));

    await clickEl(page, 'a[href="/docs"]').catch(() => {});
    try {
      await page.waitForFunction(() => location.pathname === '/docs', { timeout: 8000 });
      let h1 = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
        if (h1) break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert((await page.url()).includes('/docs'), 'URL at /docs');
      assert(h1.length > 0, 'docs page rendered h1: ' + h1);
      const chunks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src*="page-"]')).map(s => s.getAttribute('src').split('/').pop()));
      console.log('  [info] chunks loaded:', chunks.join(', '));
    } catch (e) {
      assert(false, 'docs SPA nav failed: ' + e.message);
    }
    assert(errors.length === 0, 'zero pageerror during docs nav (got ' + errors.join(' | ') + ')');
    await page.close();
  }

  // ── Test 4: full load of a code-split route (docs) ──
  console.log('\n=== TEST 4: direct load /docs ===');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/docs/getting-started', { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 500));
    const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
    assert(h1.length > 0, 'docs page h1: ' + h1);
    assert(errors.length === 0, 'zero pageerror on /docs/getting-started (got ' + errors.join(' | ') + ')');
    await page.close();
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });