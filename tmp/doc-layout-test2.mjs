import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/home/codespace/.cache/puppeteer/chrome/linux-152.0.7977.64/chrome-linux64/chrome';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // Check the root docs index page
  const page = await browser.newPage();
  await page.goto('http://localhost:3007/docs', { waitUntil: 'networkidle0' });
  
  const title = await page.title();
  const hasFooter = await page.evaluate(() => document.querySelector('footer') !== null);
  const hasMain = await page.evaluate(() => document.querySelector('main') !== null);
  const hasHeader = await page.evaluate(() => document.querySelector('header') !== null);
  const navLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('nav a'));
    return links.map(a => a.textContent?.trim()).filter(t => t);
  });
  const mainHTML = await page.evaluate(() => {
    const main = document.querySelector('main');
    return main ? main.innerHTML.substring(0, 800) : 'No main';
  });
  const footerHTML = await page.evaluate(() => {
    const f = document.querySelector('footer');
    return f ? f.innerHTML.substring(0, 500) : 'No footer';
  });
  
  console.log(`=== /docs (root) ===`);
  console.log(`Title: ${title}`);
  console.log(`hasNav: ${navLinks.length} links`);
  console.log(`hasMain: ${hasMain}`);
  console.log(`hasFooter: ${hasFooter}`);
  console.log(`hasHeader: ${hasHeader}`);
  console.log(`Main HTML: ${mainHTML}...`);
  console.log(`Footer HTML: ${footerHTML}...`);
  
  // Check body classes
  const bodyClasses = await page.evaluate(() => document.body?.className || 'no class');
  console.log(`body class: ${bodyClasses}`);
  
  // Check for layout CSS
  const computedBody = await page.evaluate(() => {
    const body = document.querySelector('body');
    return body ? window.getComputedStyle(body) : {};
  });
  console.log(`body computed padding: ${computedBody.padding}`);
  console.log(`body computed margin: ${computedBody.margin}`);
  
  await page.close();
  
  await browser.close();
}

main().catch(console.error);
