import puppeteer from 'puppeteer-core';

const CHROME = '/tmp/opencode/chrome/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE + '/docs/installation', { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(1000);

const before = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }));
  const codeBlocks = [...document.querySelectorAll('pre code')].map(c => c.textContent.trim().slice(0, 60));
  return { btns, codeBlocks };
});
console.log('BEFORE click:');
console.log('  tab buttons:', JSON.stringify(before.btns));
console.log('  code blocks:', JSON.stringify(before.codeBlocks));

// Find npm/pnpm/bun buttons and click pnpm
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'pnpm');
  if (!btn) return false;
  btn.click();
  return true;
});
await sleep(700);
const afterPnpm = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map(b => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }));
  const codeBlocks = [...document.querySelectorAll('pre code')].map(c => c.textContent.trim().slice(0, 60));
  return { btns, codeBlocks };
});
console.log('\nAFTER pnpm click:');
console.log('  tab buttons:', JSON.stringify(afterPnpm.btns));
console.log('  code blocks:', JSON.stringify(afterPnpm.codeBlocks));

await browser.close();
console.log('\nerrors:', JSON.stringify(errs));