/**
 * probe-earlyclick.mjs — after a full load of a /docs page, click the menu button
 * and a copy button at various early delays (before hydration fully settles),
 * then verify icons stay inside buttons and no 500/error surface appears.
 * Usage: CHROMIUM_PATH=... BASE=... node probe-earlyclick.mjs [delayMs ...]
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/tmp/opencode/chrome/chrome-headless-shell/linux-154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://localhost:4000';
const DELAYS = (process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [50, 150, 300, 600]);

const SLUGS = ['data-fetching', 'getting-started', 'forms', 'reactivity', 'api-routes'];
const ROUNDS = 12;

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = [];
let surfaces = 0;

const iconState = (page) => page.evaluate(() => {
  const menuBtn = document.querySelector('header button[aria-label]');
  const menu = menuBtn ? { svgInBtn: !!menuBtn.querySelector('svg'), svgs: menuBtn.querySelectorAll('svg').length } : null;
  const copies = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || '')).map((b) => ({ svgInBtn: !!b.querySelector('svg'), svgs: b.querySelectorAll('svg').length }));
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { menu, copies, errSurface: /error · \d{3}|Internal Server Error/i.test(txt) };
});

for (const delay of DELAYS) {
  console.log(`--- delay=${delay}ms ---`);
  for (let r = 0; r < ROUNDS; r++) {
    const slug = SLUGS[r % SLUGS.length];
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.setViewport({ width: 800, height: 900 });
    try { await page.goto(`${BASE}/docs/${slug}`, { waitUntil: 'domcontentloaded' }); } catch {}
    await sleep(delay);

    await page.evaluate(() => { const b = document.querySelector('header button[aria-label]'); if (b) b.click(); });
    await sleep(200);
    const s1 = await iconState(page);

    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /copy/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
    await sleep(300);
    const s2 = await iconState(page);

    const probs = [];
    if (s1.menu && (s1.menu.svgs !== 1 || !s1.menu.svgInBtn)) probs.push(`menu icon: ${JSON.stringify(s1.menu)}`);
    if (s2.menu && (s2.menu.svgs !== 1 || !s2.menu.svgInBtn)) probs.push(`menu post-copy: ${JSON.stringify(s2.menu)}`);
    for (let c = 0; c < s2.copies.length; c++) if (s2.copies[c].svgs !== 1 || !s2.copies[c].svgInBtn) probs.push(`copy[${c}]: ${JSON.stringify(s2.copies[c])}`);
    if (s2.errSurface) { surfaces++; probs.push('500 SURFACE'); }
    if (errs.length) probs.push('pageerror: ' + errs[0].slice(0, 120));
    if (probs.length) { fails.push({ delay, slug, probs, round: r }); console.log(`  !! d${delay} r${r} ${slug}: ${probs.join(' | ')}`); }
    await page.close();
  }
}
await browser.close();
console.log(`\n=== FAILURES ${fails.length} / surfaces ${surfaces} ===`);
for (const f of fails.slice(0, 20)) console.log(JSON.stringify(f));