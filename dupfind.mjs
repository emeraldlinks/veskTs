import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: 'new' });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 1200));
const info = await p.evaluate(() => {
  const all = Array.from(document.querySelectorAll('p')).filter(x => (x.textContent || '').includes('Insufficient'));
  const out = all.map(el => {
    const chain = [];
    let n = el;
    while (n && n !== document.body) { chain.unshift(n.tagName + (n.getAttribute && n.getAttribute('class') ? '.' + n.getAttribute('class').replace(/\s+/g, '.') : '')); n = n.parentNode; }
    return { claimed: el.hasAttribute('data-vsk-claimed'), chain: chain.join(' > '), prev: el.previousSibling ? (el.previousSibling.nodeType === 8 ? '<!--' + el.previousSibling.data + '-->' : el.previousSibling.nodeName) : null, next: el.nextSibling ? (el.nextSibling.nodeType === 8 ? '<!--' + el.nextSibling.data + '-->' : el.nextSibling.nodeName) : null };
  });
  const counts = Array.from(document.querySelectorAll('p')).filter(x => (x.textContent || '').trim() === 'Count: 10').map(el => ({ parentClass: (el.parentElement && el.parentElement.getAttribute('class')) || '', claimed: el.hasAttribute('data-vsk-claimed') }));
  return { insuff: out, counts };
});
console.log(JSON.stringify(info, null, 1));
console.log('ERR:', errs.length ? errs.join(' | ') : 'none');
await b.close();
