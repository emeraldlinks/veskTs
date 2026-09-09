import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/home/codespace/.cache/puppeteer/chrome/linux-152.0.7977.64/chrome-linux64/chrome';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const pages = ['getting-started', 'installation', 'core-concepts', 'components', 'styling', 'animations', 'native', 'compiler', 'packages', 'api', 'deployment'];
  
  for (const slug of pages) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:3007/docs/${slug}`, { waitUntil: 'networkidle0' });
    
    const title = await page.title();
    const h1 = await page.evaluate(() => {
      const h = document.querySelector('h1');
      return h ? h.textContent.trim() : 'No h1';
    });
    const navLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('nav a'));
      return links.map(a => a.textContent?.trim()).filter(t => t);
    });
    const mainContent = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.innerHTML.substring(0, 300) : 'No main';
    });
    const footer = await page.evaluate(() => {
      const f = document.querySelector('footer');
      return f ? f.innerHTML.substring(0, 200) : 'No footer';
    });
    const hasNav = await page.evaluate(() => document.querySelector('nav') !== null);
    const hasMain = await page.evaluate(() => document.querySelector('main') !== null);
    const hasFooter = await page.evaluate(() => document.querySelector('footer') !== null);
    const hasHeader = await page.evaluate(() => document.querySelector('header') !== null);
    const navPosition = await page.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? window.getComputedStyle(nav).position : 'static';
    });
    
    console.log(`=== /docs/${slug} ===`);
    console.log(`Title: ${title}`);
    console.log(`H1: ${h1}`);
    console.log(`Nav links: ${navLinks.length} links`);
    console.log(`Main content (first 300 chars): ${mainContent}...`);
    console.log(`Footer (first 200 chars): ${footer}...`);
    console.log(`hasNav: ${hasNav}, hasMain: ${hasMain}, hasFooter: ${hasFooter}, hasHeader: ${hasHeader}`);
    console.log(`Nav position: ${navPosition}`);
    console.log();
    
    await page.close();
  }
  
  await browser.close();
}

main().catch(console.error);
