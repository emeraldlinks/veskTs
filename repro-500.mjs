/**
 * repro-500.mjs — hunt the intermittent "client shows error 500 after hydration".
 * Full-loads + SPA-navigates + interacts across vesk-doc routes, checks the DOM for
 * the error.vsk surface (eyebrow "error · NNN"), and captures pageerrors/console errors.
 *
 * Usage: CHROMIUM_PATH=... BASE=http://localhost:4000 node repro-500.mjs [iterations]
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/tmp/opencode/chrome/chrome-headless-shell/linux-154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://localhost:4000';
const ITER = Number(process.argv[2] || 10);

const ROUTES = [
  '/', '/docs', '/docs/getting-started', '/docs/data-fetching', '/features',
  '/comparison', '/compiler', '/native', '/blog', '/showcase',
  '/showcase/aurora', '/showcase/fieldbook', '/contact', '/posts', '/examples',
  '/statements', '/about', '/vesk', '/api-docs', '/community/discussions',
  '/docs/role-players', '/community/discord',
];

let surfaced = 0;
const surfaces = [];
const pageErrors = [];
const consoleErrors = [];

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

async function sniff(page, tag) {
  const st = await page.evaluate(() => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    const hasErrSurface = /error · \d{3}|Error 500|error · offline/i.test(txt);
    return { hasErrSurface, preCount: document.querySelectorAll('#root pre').length, head: txt.slice(0, 160) };
  }).catch((e) => ({ hasErrSurface: false, preCount: -1, head: 'SNIFF-FAIL ' + e.message }));
  if (st.hasErrSurface) {
    surfaced++;
    surfaces.push({ tag, ...st });
    console.log(`  !! ERROR SURFACE @ ${tag}:`, JSON.stringify(st));
  }
  return st;
}

function noise(t) {
  return /favicon|_vesk\/hmr|Failed to load resource: the server responded with a status of 404/.test(t);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function interact(page) {
  // docs page: DocTabs + copy; nav pages: menu toggle; posts: refresh; compiler: counter
  const acted = await page.evaluate(() => {
    const out = [];
    const click = (sel) => {
      const el = document.querySelector(sel);
      if (el) { el.click(); out.push(sel); }
    };
    click('button[aria-label="Copy code"]');
    const docTab = [...document.querySelectorAll('button[role="tab"]')].find((b) => /expression mode/.test(b.textContent || ''));
    if (docTab) { docTab.click(); out.push('docTab'); }
    const cmdTab = [...document.querySelectorAll('button[role="tab"]')].find((b) => /runtime|build/i.test(b.textContent || ''));
    if (cmdTab) { cmdTab.click(); out.push('cmdTab'); }
    return out;
  });
  await sleep(600);
  await sniff(page, 'post-interact(' + acted.join(',') + ')');
}

for (let iter = 0; iter < ITER; iter++) {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  const errs = [];
  const cons = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text()); });

  const r0 = ROUTES[Math.floor(Math.random() * ROUTES.length)];
  try { await page.goto(BASE + r0, { waitUntil: 'networkidle2' }); } catch {}
  await sleep(700);
  await sniff(page, `iter${iter} full:${r0}`);
  await interact(page);

  const count = 1 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const r = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    try {
      await page.evaluate((url) => {
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, r);
    } catch {}
    await sleep(900);
    await sniff(page, `iter${iter} spa:${r}`);
    if (Math.random() < 0.3) await interact(page);
  }
  for (const e of errs) pageErrors.push(`[${iter}:${r0}] ${e}`);
  for (const c of cons) if (!noise(c)) consoleErrors.push(`[${iter}:${r0}] ${c}`);
  await page.close();
  console.log(`iter ${iter} done (${r0}; surfaces so far: ${surfaced})`);
}
await browser.close();

console.log('\n=== REPRO-500 RESULT ===');
console.log(`surfaces: ${surfaced}`);
console.log(`pageErrors: ${pageErrors.length}`);
console.log(`consoleErrors: ${consoleErrors.length}`);
for (const s of surfaces) console.log('surface:', JSON.stringify(s).slice(0, 300));
for (const e of pageErrors.slice(0, 25)) console.log('pageerror:', e.slice(0, 300));
for (const c of consoleErrors.slice(0, 25)) console.log('console:', c.slice(0, 300));