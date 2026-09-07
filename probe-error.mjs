import puppeteer from 'puppeteer-core';

const CHROME = '/workspaces/veskTs/chrome/linux-152.0.7977.82/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const events = [];
page.on('pageerror', e => events.push('pageerror: ' + e.message + '\n' + (e.stack || '')));
page.on('console', m => { if (['error', 'warn'].includes(m.type())) events.push(m.type() + ': ' + m.text()); });
await page.evaluateOnNewDocument(() => {
  window.addEventListener('error', e => {
    window.__errs = window.__errs || [];
    window.__errs.push(String(e.error && e.error.stack ? e.error.stack : (e.message || e.filename)));
  });
  window.addEventListener('unhandledrejection', e => {
    window.__errs = window.__errs || [];
    window.__errs.push('rejection: ' + String(e.reason && e.reason.stack ? e.reason.stack : e.reason));
  });
});
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

const dom = await page.evaluate(() => {
  const root = document.getElementById('root');
  return {
    text: root ? root.textContent.replace(/\s+/g, ' ').trim().slice(0, 1000) : '(no root)',
    markup: root ? root.innerHTML.slice(0, 2000) : '(no root)',
    errs: window.__errs || [],
  };
});
console.log('=== DOC/TEXT ===', dom.text);
console.log('\n=== ERRORS captured in-page ===');
for (const e of dom.errs) console.log('  ', e.split('\n')[0]);
console.log('\n=== Puppeteer events ===');
for (const e of events) console.log('  ', e.split('\n')[0]);

await browser.close();