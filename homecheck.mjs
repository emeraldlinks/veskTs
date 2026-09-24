import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox','--disable-dev-shm-usage'], headless: 'new' });
const p = await b.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 800));
const txt = await p.evaluate(() => document.body.innerText);
console.log('=== innerText ===');
console.log(txt);
const counts = await p.evaluate(() => {
  const out = {};
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) continue;
      const T = c.tagName && c.tagName.toLowerCase();
      if (c.children && c.children.length === 0) {
        const k = T + '::' + (c.textContent || '').replace(/\s+/g, ' ').trim();
        out[k] = (out[k] || 0) + 1;
      }
      if (c.children) walk(c);
    }
  };
  walk(document.body);
  return out;
});
console.log('=== leaf dups ===');
for (const [k, v] of Object.entries(counts)) if (v > 1) console.log('x' + v, JSON.stringify(k));
console.log('=== errors ===', errs.length ? errs : 'none');
await b.close();
