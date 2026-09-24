import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(function () { globalThis.__vesk_hydrate_debug = true; });
const logs = [];
page.on('console', (m) => { const t = String(m.text()); if (t.includes('hyd-dbg')) logs.push(t.slice(8, 160)); });
await page.goto('http://localhost:3000/blocknav', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
console.log('STRUCT:', JSON.stringify(await page.evaluate(() => {
  const root = document.getElementById('root');
  const article = document.querySelector('article.blocknav-article');
  const p = (el) => el ? { tag: el.tagName, claim: el.hasAttribute('data-vsk-claimed'), cls: (el.className||'').toString().slice(0,30) } : null;
  const walk = (el, d) => {
    const out = { ...p(el), d };
    if (el && el.children.length) out.kids = Array.from(el.children).map(c => walk(c, d + 1));
    return out;
  };
  return { mainKids: Array.from(root?.querySelector('main')?.children || []).map(p), article: walk(article, 0) };
})));
console.log('\nTRACE:');
let prev=''; let n=0;
for (const l of logs) { if (l===prev){n++;continue;} if(n){console.log('  ...x'+n);n=0;} console.log('  ' + l); prev = l; }
if (n) console.log('  ...x'+n);
await browser.close();
