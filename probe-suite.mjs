import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:3000/empty', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
console.log('EMPTY text:', JSON.stringify(await page.evaluate(() => document.body.textContent.replace(/\s+/g,' ').trim())));
console.log('EMPTY errs:', JSON.stringify(errs));
await page.close();

const p2 = await browser.newPage();
const errs2 = [];
p2.on('pageerror', e => errs2.push(String(e)));
await p2.goto('http://localhost:3000/blocknav', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
console.log('BLOCKNAV  :', JSON.stringify(await p2.evaluate(() => {
  const root = document.getElementById('root');
  const article = document.querySelector('article.blocknav-article');
  const all = Array.from(root?.querySelectorAll('h2, p') || []).filter(el => el.classList.contains('blocknav-h2') || el.classList.contains('blocknav-p'));
  return { inArticle: Array.from(article?.querySelectorAll('h2.blocknav-h2, p.blocknav-p')||[]).map(e=>e.textContent.trim()), all: all.map(e=>e.tagName+'.'+(e.classList.contains('blocknav-h2')?'h2':'p')+':'+e.textContent.trim()), claimedInRoot: root.querySelectorAll('[data-vsk-claimed]').length };
})));
console.log('BLOCKNAV errs:', JSON.stringify(errs2));
await browser.close();
