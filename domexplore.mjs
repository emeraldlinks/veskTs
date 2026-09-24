import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: 'new' });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 1200));
const dump = await p.evaluate(() => {
  const root = document.getElementById('root');
  const walk = (n, d) => {
    const out = [];
    for (const c of n.childNodes) {
      if (c.nodeType === 8) { out.push('  '.repeat(d) + '<!--' + c.data + '-->'); continue; }
      if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) out.push('  '.repeat(d) + `text "${t}"`); continue; }
      out.push('  '.repeat(d) + `<${c.tagName.toLowerCase()} cl=`, (c.getAttribute && c.getAttribute('class')) || '', 'claim=', c.hasAttribute ? c.hasAttribute('data-vsk-claimed') : '', '>');
      out.push(...walk(c, d + 1));
      out.push('  '.repeat(d) + `</${c.tagName.toLowerCase()}>`);
    }
    return out;
  };
  return { lines: walk(root, 0).slice(0, 120), errsLen: 0 };
});
console.log(dump.lines.join('\n'));
console.log('PAGEERRORS:', errs.length ? errs.join(' | ') : 'none');
await b.close();
