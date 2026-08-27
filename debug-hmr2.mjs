import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const root = resolve('/workspaces/veskTs');
process.chdir(resolve(root, 'test-app'));

const configModule = await import(resolve(root, 'test-app/vesk.config.ts'));
const config = configModule.default || {};
const { startDevServer } = await import(resolve(root, 'packages/cli/src/dev-server.ts'));
startDevServer(3000, resolve(root, 'test-app'), config);

for (let i = 0; i < 60; i++) {
  try { const res = await fetch('http://localhost:3000/'); if (res.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 1000));
}
console.log('Dev server ready');

const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({
  headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
page.on('console', msg => console.log('  BROWSER:', msg.text()));
page.on('pageerror', err => console.log('  PAGE ERR:', err.message));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

// Inject debugging into hmrUpdate
await page.evaluate(() => {
  const router = globalThis.__vesk_router;
  if (!router) { console.log('NO ROUTER'); return; }
  const origHmrUpdate = router.hmrUpdate.bind(router);
  router.hmrUpdate = function() {
    console.log('>>> hmrUpdate called');
    console.log('>>> updatedComponents:', [...(globalThis.__updatedComponents || [])]);
    console.log('>>> componentInstances:', router.__componentInstances ? [...router.__componentInstances.keys()] : 'EMPTY');
    origHmrUpdate();
    console.log('>>> hmrUpdate done, h1 now:', document.querySelector('h1')?.textContent?.trim());
  };
});

await page.evaluate(() => { window.__spaFlag = true; });

// Modify page.vsk
const pagePath = resolve(root, 'test-app/app/page.vsk');
const originalPage = readFileSync(pagePath, 'utf-8');
const modifiedPage = originalPage.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>');
writeFileSync(pagePath, modifiedPage, 'utf-8');
console.log('Wrote modified page.vsk');

await new Promise(r => setTimeout(r, 5000));

const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
console.log('FINAL h1:', h1);

writeFileSync(pagePath, originalPage, 'utf-8');
await browser.close();
process.exit(0);
