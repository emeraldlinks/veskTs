import puppeteer from 'puppeteer-core';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const BASE = 'http://localhost:3000';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#dx', {timeout: 10000});
  await page.waitForTimeout(2500);
  const text = await page.$eval('#dx', el => el.innerText);
  const has = text.includes('npx create-vesk');
  console.log('has npx create-vesk?', has);
  console.log(text.slice(0,800));
  await browser.close();
})();
