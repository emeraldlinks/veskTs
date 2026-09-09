import puppeteer from 'puppeteer-core';
const CHROME = '/tmp/opencode/chrome/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:3000/docs/getting-started', { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(600);

// SPA nav to /docs/installation (click sidebar link)
await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href="/docs/installation"]')][0];
  if (a) a.click();
});
await sleep(1200);

const afterNav = await page.evaluate(() => ({
  path: location.pathname,
  menuLabel: (() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
    return b ? b.getAttribute('aria-label') : null;
  })(),
  tabTexts: [...document.querySelectorAll('main button')].filter(b => ['npm','pnpm','bun'].includes(b.textContent.trim())).map(b => ({ t: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') })),
  code: [...document.querySelectorAll('pre code')].map(c => c.textContent.trim().slice(0, 40)),
}));
console.log('after SPA nav:', JSON.stringify(afterNav, null, 1));

// click pnpm tab
await page.evaluate(() => {
  const b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'pnpm');
  if (b) b.click();
});
await sleep(800);
const afterTab = await page.evaluate(() => ({
  tabTexts: [...document.querySelectorAll('main button')].filter(b => ['npm','pnpm','bun'].includes(b.textContent.trim())).map(b => ({ t: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), cls: b.className.includes('bg-foreground') ? 'ACTIVE' : 'inactive' })),
  code: [...document.querySelectorAll('pre code')].map(c => c.textContent.trim().slice(0, 40)),
}));
console.log('after pnpm click:', JSON.stringify(afterTab, null, 1));

// toggle menu after SPA nav
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
  if (b) b.click();
});
await sleep(800);
const menuAfter = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('documentation menu'));
  return { label: b ? b.getAttribute('aria-label') : null, expanded: b ? b.getAttribute('aria-expanded') : null };
});
console.log('menu toggle after SPA nav:', JSON.stringify(menuAfter));
await browser.close();
console.log('errors:', JSON.stringify(errs));