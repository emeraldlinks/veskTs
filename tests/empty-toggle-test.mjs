import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let browser;

async function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  console.log('\n=== /empty: client empty-state toggle ===');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE + '/empty', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));

  assert(errors.length === 0, 'Zero JS errors on load (got ' + errors.length + ': ' + errors.join(', ') + ')');

  const text = () => page.evaluate(() => document.body.innerText);
  let t = await text();
  assert(t.includes('Buy milk'), 'Items visible on hydrate (' + (t.match(/Buy milk/g) || []).length + 'x)');
  assert(!t.includes('No todos yet'), 'No empty message while populated');

  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Clear').click());
  await new Promise(r => setTimeout(r, 300));
  t = await text();
  assert(t.includes('No todos yet'), 'Empty message after Clear (' + (t.match(/No todos yet/g) || []).length + 'x)');
  assert(!t.includes('Buy milk'), 'Items gone after Clear');

  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Restore').click());
  await new Promise(r => setTimeout(r, 300));
  t = await text();
  assert(t.includes('Buy milk'), 'Items restored (' + (t.match(/Buy milk/g) || []).length + 'x)');
  assert(!t.includes('No todos yet'), 'Empty message gone after Restore');
  assert(errors.length === 0, 'Zero JS errors after toggles (got ' + errors.length + ': ' + errors.join(', ') + ')');

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
