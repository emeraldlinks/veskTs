import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('map')) {
    try {
      const t = await r.text();
      if (u.endsWith('.js') || u.includes('chunk')) fs.writeFileSync('/tmp/opencode/mapchunk.js', t);
      console.log(u, t.length);
    } catch {}
  }
});
page.on('request', (r) => { if (/map|chunk/.test(r.url())) console.log('REQ', r.url()); });
await page.goto('http://localhost:3000/map', { waitUntil: 'networkidle0', timeout: 30000 });
await browser.close();
