import puppeteer from 'puppeteer-core';
const CHROME = '/tmp/opencode/chrome/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:3000/docs/getting-started', { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(800);

// menu button = button with aria-label "Open documentation menu"
const before = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
  return b ? { label: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), class: b.className } : null;
});
console.log('menu before:', JSON.stringify(before));

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
  if (!b) return false; b.click(); return true;
});
await sleep(800);
const after = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
  const sidebar = document.querySelector('div.max-h-\\[70vh\\]');
  const sidebarVisible = sidebar && sidebar.parentElement && getComputedStyle(sidebar.parentElement).display !== 'none';
  const root = document.getElementById('root');
  return {
    label: b ? b.getAttribute('aria-label') : null,
    expanded: b ? b.getAttribute('aria-expanded') : null,
    sidebars: [...document.querySelectorAll('div[id],div[class*="lg:hidden"],nav')].filter(n => n.textContent.includes('Introduction')).map(n => n.className.slice(0, 50)),
    rootText: (root ? root.textContent.replace(/^\s+/gm, '') : '').slice(0, 120),
  };
});
console.log('menu after click:', JSON.stringify(after, null, 1));
await browser.close();
console.log('errors:', JSON.stringify(errs));