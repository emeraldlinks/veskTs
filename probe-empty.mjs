import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(function () { globalThis.__vesk_hydrate_debug = true; });
const logs = [];
page.on('console', (m) => { const t = String(m.text()); if (t.includes('hyd-dbg')) logs.push(t.slice(8, 130)); });
await page.goto('http://localhost:3000/empty', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
console.log('STRUCT:', JSON.stringify(await page.evaluate(() => {
  const p = (el) => el ? { tag: el.tagName, claim: el.hasAttribute('data-vsk-claimed'), txt: (el.textContent||'').slice(0,22) } : null;
  return { kids: Array.from(document.querySelector('main')?.children || []).map(p) };
})));
console.log('\nTRACE:');
let prev=''; let n=0;
for (const l of logs) { if (l===prev){n++;continue;} if(n){console.log('  ...x'+n);n=0;} console.log('  ' + l); prev = l; }
if (n) console.log('  ...x'+n);
await browser.close();
