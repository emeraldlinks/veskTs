/**
 * probe-mobile.mjs — mobile-emulated (390×844, touch, isMobile) docs pages:
 * tap the menu button and a copy button at several early/settled moments,
 * under slow-3G and fast-3G throttles. Verifies icons stay inside their buttons
 * and no 500 error surface appears; captures pageerrors.
 * Usage: CHROMIUM_PATH=... BASE=... node probe-mobile.mjs
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
const surfaces = [];

const SLUGS = ['data-fetching', 'getting-started', 'forms', 'api-routes', 'reactivity', 'isr', 'routing'];

const THROTTLES = [
  { name: 'slow3g', download: 60 * 1024, upload: 20 * 1024, latency: 400 },
  { name: 'fast3g', download: 500 * 1024, upload: 120 * 1024, latency: 200 },
];

const icon = (page) => page.evaluate(() => {
  const menuBtn = document.querySelector('header button[aria-label]');
  const menu = menuBtn ? { svgInBtn: !!menuBtn.querySelector('svg'), svgs: menuBtn.querySelectorAll('svg').length, label: menuBtn.getAttribute('aria-label') } : null;
  const copies = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || '')).map((b) => ({ svgInBtn: !!b.querySelector('svg'), svgs: b.querySelectorAll('svg').length }));
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  return { menu, copies, errSurface: /error · \d{3}|Internal Server Error/i.test(txt), bodyLen: (document.body.innerText || '').length };
});

// real tap via touch API when the element is hit-testable
async function tap(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null; // display:none
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, selector);
  if (!box) return false;
  await page.touchscreen.tap(box.x, box.y);
  return true;
}

const CLICK_DELAYS = [150, 2000];

for (const t of THROTTLES) {
  for (const delay of CLICK_DELAYS) {
    for (let r = 0; r < 4; r++) {
      const page = await browser.newPage();
      page.setDefaultTimeout(40000);
      const errs = [];
      const cons = [];
      page.on('pageerror', (e) => errs.push(String(e.message)));
      page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text()); });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const cdp = await page.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: t.download, uploadThroughput: t.upload, latency: t.latency,
      });

      const slug = SLUGS[(r + CLICK_DELAYS.indexOf(delay)) % SLUGS.length];
      let loadErr = null;
      try { await page.goto(`${BASE}/docs/${slug}`, { waitUntil: 'domcontentloaded', timeout: 35000 }); }
      catch (e) { loadErr = e.shortMessage || e.message; }

      await sleep(delay);

      // tap menu button (visible below lg breakpoint)
      const tappedMenu = await tap(page, 'header button[aria-label]');
      await sleep(300);
      const s1 = await icon(page);

      // tap copy button
      await tap(page, 'button[aria-label="Copy code"], button[aria-label="Copied"]');
      await sleep(400);
      const s2 = await icon(page);

      // tap menu again (close)
      await tap(page, 'header button[aria-label]');
      await sleep(300);
      const s3 = await icon(page);

      const probs = [];
      if (loadErr) probs.push('load fail: ' + loadErr);
      if (!tappedMenu) probs.push('menu button not hit-testable at delay ' + delay);
      for (const [nm, st] of [['s1-menu', s1], ['s2-copy', s2], ['s3-close', s3]]) {
        if (st.errSurface) { surfaces.push({ t: t.name, delay, slug, nm }); probs.push(`${nm} 500-SURFACE`); }
        if (st.menu && (!st.menu.svgInBtn || st.menu.svgs !== 1)) probs.push(`${nm} menu icon: ${JSON.stringify(st.menu)}`);
        if (!st.menu) probs.push(`${nm} menu button GONE`);
        for (let c = 0; c < st.copies.length; c++) if (st.copies[c].svgs !== 1 || !st.copies[c].svgInBtn) probs.push(`${nm} copy[${c}]: ${JSON.stringify(st.copies[c])}`);
      }
      if (errs.length) probs.push('pageerror: ' + errs[0].slice(0, 160));
      const badCons = cons.filter((x) => !/favicon|Failed to load resource.*404/.test(x));
      if (badCons.length) probs.push('console: ' + badCons[0].slice(0, 160));
      if (probs.length) { fails.push({ t: t.name, delay, slug, probs }); console.log(`  !! ${t.name} d${delay} ${slug}: ${probs.join(' | ')}`); }

      await cdp.detach();
      await page.close();
    }
    console.log(`done ${t.name} delay=${delay}`);
  }
}
await browser.close();
console.log(`\n=== FAILURES ${fails.length} / surfaces ${surfaces.length} ===`);
for (const f of fails.slice(0, 30)) console.log(JSON.stringify(f).slice(0, 600));