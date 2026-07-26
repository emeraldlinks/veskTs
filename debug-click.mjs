import puppeteer from 'puppeteer-core';
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
page.on('console', msg => console.log('CONSOLE:', msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR:', err.message()));
page.on('response', r => { if (!r.ok()) console.log('HTTP FAIL:', r.status(), r.url()); });

await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

const info = await page.evaluate(() => {
  const btn = document.querySelector('button');
  const p = document.querySelector('main p');
  return {
    tag: btn?.tagName,
    text: btn?.textContent?.trim(),
    hasDataVskEv: btn?.hasAttribute('data-vsk-ev'),
    hasClickHandler: typeof btn?.__evh_click === 'function',
    delegateGuard: document.__vesk_dlg_click,
    initialCount: p?.textContent?.trim(),
  };
});
console.log('INFO:', JSON.stringify(info, null, 2));

await page.click('button');
await new Promise(r => setTimeout(r, 300));

const after = await page.evaluate(() => {
  const p = document.querySelector('main p');
  return { count: p?.textContent?.trim(), all: Array.from(document.querySelectorAll('main p')).map(p => p.textContent.trim()) };
});
console.log('AFTER CLICK:', JSON.stringify(after, null, 2));

await browser.close();
