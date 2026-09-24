import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.goto('http://localhost:3000/map', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
const read = () => page.evaluate(() => {
  const root = document.getElementById('root');
  const chips = Array.from(document.querySelectorAll('.rk-chip')).map(c => c.textContent.trim() + (c.hasAttribute('data-vsk-claimed') ? '!' : ''));
  return { claimed: root.querySelectorAll('[data-vsk-claimed]').length, chips, keys: Array.from(document.querySelectorAll('.rk-chip')).map(c => c.getAttribute('data-vsk-key')) };
});
const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()));
const click = async (label) => { const i = btns.indexOf(label); if (i < 0) throw new Error('no btn ' + label); await page.evaluate((i) => Array.from(document.querySelectorAll('button'))[i].click(), i); await new Promise((r) => setTimeout(r, 250)); };
console.log('initial   ', JSON.stringify(await read()));
await click('Add');
console.log('after Add ', JSON.stringify(await read()));
await click('Add');
console.log('after Add2', JSON.stringify(await read()));
await click('Remove last');
console.log('after Rem ', JSON.stringify(await read()));
await click('Reverse');
console.log('after Rev ', JSON.stringify(await read()));
await browser.close();
