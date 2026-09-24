/**
 * probe-throttle.mjs — emulate slow networks (large code-split docs chunk like
 * stand-in for the real connection pattern); click the docs menu button and a
 * copy button at several moments during/after hydration; verify icons stay in
 * buttons and no 500 surface appears.
 * Usage: CHROMIUM_PATH=... BASE=... node probe-throttle.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/tmp/opencode/chrome/chrome-headless-shell/linux-154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://localhost:4000';

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const SLUGS = ['data-fetching', 'getting-started', 'forms'];

const icon = (page) => page.evaluate(() => {
  const menuBtn = document.querySelector('header button[aria-label]');
  const menu = menuBtn ? { svgInBtn: !!menuBtn.querySelector('svg'), svgs: menuBtn.querySelectorAll('svg').length } : null;
  const copies = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || '')).map((b) => ({ svgInBtn: !!b.querySelector('svg'), svgs: b.querySelectorAll('svg').length }));
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { menu, copies, errSurface: /error · \d{3}|Internal Server Error/i.test(txt) };
});

// Slow 3G-ish: ~ (down, up, latency)
const THROTTLES = [
  { name: 'slow3g', download: 60 * 1024, upload: 20 * 1024, latency: 400 },
  { name: 'fast3g', download: 500 * 1024, upload: 120 * 1024, latency: 200 },
];

for (const t of THROTTLES) {
  console.log(`=== throttle ${t.name} ===`);
  for (let r = 0; r < 10; r++) {
    const page = await browser.newPage();
    page.setDefaultTimeout(40000);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, downloadThroughput: t.download, uploadThroughput: t.upload, latency: t.latency,
    });
    await page.setViewport({ width: 800, height: 900 });

    const slug = SLUGS[r % SLUGS.length];
    let loadErr = null;
    try { await page.goto(`${BASE}/docs/${slug}`, { waitUntil: 'domcontentloaded', timeout: 35000 }); }
    catch (e) { loadErr = e.shortMessage || e.message; }

    // click menu button as soon as DOM is there (mid chunk-load)
    await sleep(100);
    await page.evaluate(() => { const b = document.querySelector('header button[aria-label]'); if (b) b.click(); });
    await sleep(250);
    const s1 = await icon(page);
    // click copy button
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /copy/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
    await sleep(300);
    const s2 = await icon(page);
    // wait for hydration settle, then toggle menu once more (close)
    await sleep(3500);
    await page.evaluate(() => { const b = document.querySelector('header button[aria-label]'); if (b) b.click(); });
    await sleep(250);
    const s3 = await icon(page);

    const probs = [];
    if (loadErr) probs.push('load fail: ' + loadErr);
    for (const [nm, st] of [['s1-mid', s1], ['s2-copy', s2], ['s3-after', s3]]) {
      if (st.errSurface) probs.push(`${nm} 500-SURFACE`);
      if (st.menu && (!st.menu.svgInBtn || st.menu.svgs !== 1)) probs.push(`${nm} menu icon: ${JSON.stringify(st.menu)}`);
      for (let c = 0; c < st.copies.length; c++) if (st.copies[c].svgs !== 1 || !st.copies[c].svgInBtn) probs.push(`${nm} copy[${c}]: ${JSON.stringify(st.copies[c])}`);
    }
    if (errs.length) probs.push('pageerror: ' + errs[0].slice(0, 140));
    if (probs.length) { fails.push({ t: t.name, slug, probs, r }); console.log(`  !! ${t.name} r${r} ${slug}: ${probs.join(' | ')}`); }
    await cdp.detach();
    await page.close();
  }
}
await browser.close();
console.log(`\n=== FAILURES ${fails.length} ===`);
for (const f of fails) console.log(JSON.stringify(f).slice(0, 500));