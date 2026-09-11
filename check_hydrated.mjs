import puppeteer from 'puppeteer-core';
const CHROMIUM_PATH = '/home/codespace/.cache/puppeteer/chrome-headless-shell/linux-152.0.7977.54/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:3000';
async function run() {
  const browser = await puppeteer.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#dx', {timeout: 10000});
  // Check SSR: should be empty initially
  const initial = await page.$eval('#dx', el => el.innerHTML);
  console.log('initial html snippet', initial.slice(0,800));
  // Wait for the effect to animate (shown increments every 600ms, cycles from 0 to lines.length)
  await new Promise(r => setTimeout(r, 2800));
  const after = await page.$eval('#dx', el => el.innerText);
  console.log('after text', after.slice(0,1500));
  const has = after.includes('npx create-vesk') || after.includes('my-app created');
  console.log('hasLines?', has);
  // Count divs inside the min-h container
  const count = await page.$$eval('#dx .min-h-\\[248px\\] > div', els => els.length);
  console.log('div count inside min-h', count);
  const caret = await page.$eval('#dx .caret', el => !!el);
  console.log('caret exists', caret);
  await browser.close();
  if (!has) {
    console.log('FAIL: block not rendering');
    process.exit(1);
  } else {
    console.log('PASS: block renders');
  }
}
run().catch(e=>{ console.error(e); process.exit(1)});
