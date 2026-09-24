/**
 * probe-docspa.mjs — SPA-navigate across /docs slugs, then on each page click the
 * mobile menu button and a copy button and a DocTabs tab, verifying icons stay
 * INSIDE their buttons afterwards (in-element reactive region must not leave).
 * Also sniffs for the error-500 surface and captures pageerrors.
 * Usage: CHROMIUM_PATH=... BASE=http://localhost:4001 node probe-docspa.mjs [iterations]
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/tmp/opencode/chrome/chrome-headless-shell/linux-154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://localhost:4001';
const ITER = Number(process.argv[2] || 6);

const SLUGS = ['getting-started', 'data-fetching', 'reactivity', 'forms', 'api-routes', 'routing', 'isr', 'components', 'statement-mode', 'pipeline'];

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = [];
let surfaces = 0;

async function snapIconState(page) {
  return page.evaluate(() => {
    const menuBtn = document.querySelector('header button[aria-label]');
    const menu = menuBtn
      ? { svgInBtn: !!menuBtn.querySelector('svg'), svgs: menuBtn.querySelectorAll('svg').length, label: menuBtn.getAttribute('aria-label') }
      : null;
    const copyBtns = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || ''));
    const copy = copyBtns.map((b) => ({ svgInBtn: !!b.querySelector('svg'), svgs: b.querySelectorAll('svg').length }));
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    const errSurface = /error · \d{3}|Internal Server Error/i.test(txt);
    return { menu, copy, errSurface };
  });
}

for (let iter = 0; iter < ITER; iter++) {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  const errs = [];
  const cons = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text()); });
  await page.setViewport({ width: 800, height: 900 });

  try { await page.goto(BASE + '/docs', { waitUntil: 'networkidle2' }); } catch {}
  await sleep(700);
  const visited = [];

  for (let i = 0; i < 6; i++) {
    const slug = SLUGS[Math.floor(Math.random() * SLUGS.length)];
    const url = `${BASE}/docs/${slug}`;
    try {
      await page.evaluate((u) => { window.history.pushState({}, '', new URL(u).pathname); window.dispatchEvent(new PopStateEvent('popstate')); }, url);
    } catch {}
    await sleep(700);

    const before = await snapIconState(page);
    if (before.errSurface) { surfaces++; console.log(`  !! 500 SURFACE on SPA nav to ${slug} (iter ${iter})`); }

    // click menu button
    await page.evaluate(() => { const b = document.querySelector('header button[aria-label]'); if (b) b.click(); });
    await sleep(300);
    const afterMenu = await snapIconState(page);

    // click a DocTabs tab if present
    const tabClicked = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('button[role="tab"]')].find((b) => !/aria-pressed/.test(b.getAttribute('aria-pressed') || 'true') && b.textContent && b.textContent.trim().length < 30 && b.textContent.trim().length > 2);
      if (tab) { tab.click(); return true; }
      return false;
    });
    await sleep(300);

    // click a copy button
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /copy/i.test(x.getAttribute('aria-label') || ''));
      if (b) b.click();
    });
    await sleep(400);
    const finalState = await snapIconState(page);

    const problems = [];
    if (before.menu && afterMenu.menu && (afterMenu.menu.svgs !== 1 || !afterMenu.menu.svgInBtn)) problems.push(`menu icon left button: ${JSON.stringify(afterMenu.menu)}`);
    if (before.menu && !afterMenu.menu) problems.push('menu button GONE');
    for (let c = 0; c < before.copy.length; c++) {
      const a = finalState.copy[c];
      if (a && (a.svgs !== 1 || !a.svgInBtn)) problems.push(`copy[${c}] icon left button: ${JSON.stringify(a)}`);
    }
    const badCons = cons.filter((t) => !/favicon|Failed to load resource.*404/.test(t));
    if (problems.length || errs.length || badCons.length || finalState.errSurface) {
      fails.push({ iter, slug, visited: visited.slice(), problems, errs: errs.slice(0, 3), cons: badCons.slice(0, 3), before: JSON.stringify(before).slice(0, 200) });
      console.log(`  !! iter${iter} ${slug} ${problems.join(' | ')} errs=${errs.length} cons=${badCons.length}`);
    }
    visited.push(slug);
  }
  await page.close();
  console.log(`iter ${iter} done (${visited.join(',')})`);
}
await browser.close();
console.log(`\n=== FAILURES ${fails.length} / surfaces ${surfaces} ===`);
for (const f of fails) console.log(JSON.stringify(f).slice(0, 700));