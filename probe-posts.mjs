import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await p.goto('http://localhost:3113/posts', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
console.log('ERRORS:', JSON.stringify(errors, null, 1));
await b.close();
