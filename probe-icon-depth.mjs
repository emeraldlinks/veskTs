/**
 * probe-icon-depth.mjs — geometry truth on the DEPLOYED client:
 * after full reload + hydration, toggle the docs header menu button open and
 * closed, and click every copy button, asserting every icon's bounding rect is
 * CONTAINED inside its button (catches the "in-element region rendered outside
 * the element" vanish exactly). Reports what was found (no silent skips).
 * Usage: CHROMIUM_PATH=... BASE=... node probe-icon-depth.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH;
const BASE = process.env.BASE || 'http://localhost:4000';
const MOBILE = process.env.MOBILE === '1';
const SLUGS = process.argv[2] ? process.argv[2].split(',') : ['getting-started', 'components', 'hydration'];

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const geometry = (page) => page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('header button, main button'));
  const report = [];
  for (const btn of buttons) {
    const br = btn.getBoundingClientRect();
    const label = btn.getAttribute('aria-label') || btn.textContent.trim().slice(0, 40);
    let svgs = [];
    for (const svg of btn.querySelectorAll('svg')) {
      const sr = svg.getBoundingClientRect();
      const inside = sr.left >= br.left - 1 && sr.right <= br.right + 1 && sr.top >= br.top - 1 && sr.bottom <= br.bottom + 1;
      svgs.push({ inside, w: Math.round(sr.width), h: Math.round(sr.height) });
    }
    report.push({ label, svgCount: svgs.length, allInside: svgs.length > 0 && svgs.every((s) => s.inside), svgs });
  }
  return report;
});

let fails = 0;
for (const slug of SLUGS) {
  const url = `${BASE}/docs/${slug}`;
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  if (MOBILE) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  else await page.setViewport({ width: 900, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  try { await page.goto(url, { waitUntil: 'networkidle2' }); } catch (e) { console.log(`  LOAD-FAIL ${slug}: ${e.shortMessage || e.message}`); fails++; await page.close(); continue; }
  await sleep(1200);

  let headerBtn = null;
  if (!MOBILE) {
    // ── header menu button ────────────────────────────────────────────────
    headerBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => /menu|close/i.test(b.getAttribute('aria-label') || ''));
      return btn ? { label: btn.getAttribute('aria-label'), count: btn.querySelectorAll('svg').length } : null;
    });
    console.log(`${slug} header-btn: ${JSON.stringify(headerBtn)}`);
    if (headerBtn) {
      for (let t = 0; t < 2; t++) {
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('header button')].find((b) => /menu|close/i.test(b.getAttribute('aria-label') || ''));
          btn && btn.click();
        });
        await sleep(350);
        const geo = await geometry(page);
        const hb = geo.find((b) => /menu|close/i.test(b.label));
        if (!hb || hb.svgCount !== 1 || !hb.allInside) {
          console.log(`  ✗ ${slug} toggle#${t + 1}: ${JSON.stringify(hb)}`);
          fails++;
        } else console.log(`  ✓ ${slug} toggle#${t + 1} icon-in-button: ${JSON.stringify(hb)}`);
      }
    } else {
      console.log(`  ? ${slug} no menu-aria header button found`);
      fails++;
    }
  }

  // ── every copy button ─────────────────────────────────────────────────────
  const copyBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || '')).length);
  console.log(`${slug} copy-buttons: ${copyBtns}`);
  if (copyBtns > 0) {
    await page.evaluate(() => {
      for (const b of Array.from(document.querySelectorAll('button'))) if (/copy/i.test(b.getAttribute('aria-label') || '')) b.click();
    });
    await sleep(500);
    const geo = await geometry(page);
    const copyAll = geo.filter((b) => /copy/i.test(b.label));
    const bad = copyAll.filter((b) => b.svgCount !== 1 || !b.allInside);
    if (bad.length) { console.log(`  ✗ ${slug} copy icons outside/multi: ${JSON.stringify(bad)}`); fails++; }
    else console.log(`  ✓ ${slug} all ${copyAll.length} copy icons in-button`);
  }
  // toggle back for cleanliness on non-mobile
  if (!MOBILE && headerBtn) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => /close/i.test(b.getAttribute('aria-label') || ''));
      btn && btn.click();
    });
    await sleep(300);
  }
  if (errs.length) { console.log(`  ✗ ${slug} pageerrors: ${errs.slice(0, 3)}`); fails++; }
  else console.log(`  ✓ ${slug} no pageerrors`);
  await page.close();
}
await browser.close();
console.log(`\n=== DEPTH FAILURES: ${fails} ===`);
process.exit(fails ? 1 : 0);