import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const root = resolve('/workspaces/veskTs');
process.chdir(resolve(root, 'test-app'));

const configModule = await import(resolve(root, 'test-app/vesk.config.ts'));
const config = configModule.default || {};
const { startDevServer } = await import(resolve(root, 'packages/cli/src/dev-server.ts'));
startDevServer(3002, resolve(root, 'test-app'), config);

for (let i = 0; i < 60; i++) {
  try { const res = await fetch('http://localhost:3002/'); if (res.ok) break; } catch {}
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

await page.goto('http://localhost:3002', { waitUntil: 'networkidle0' });
console.log('Page loaded');

// Wait a bit for HMR WS to connect
await new Promise(r => setTimeout(r, 2000));

// Check HMR WS connection state
const wsState = await page.evaluate(() => {
  // Check if there's a WebSocket connected to the HMR endpoint
  // by looking at the hmr-client state
  const hmrEval = typeof globalThis.__vesk_hmr_eval;
  const router = globalThis.__vesk_router;
  return {
    hmrEval,
    routerExists: !!router,
    routerHmrUpdate: typeof router?.hmrUpdate,
    updatedComponents: String(globalThis.__updatedComponents),
  };
});
console.log('State before HMR:', JSON.stringify(wsState));

// Modify page.vsk
const pagePath = resolve(root, 'test-app/app/page.vsk');
const originalPage = readFileSync(pagePath, 'utf-8');
const modifiedPage = originalPage.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>');
writeFileSync(pagePath, modifiedPage, 'utf-8');
console.log('Wrote modified page.vsk');

// Wait for HMR
await new Promise(r => setTimeout(r, 5000));

const stateAfter = await page.evaluate(() => {
  const router = globalThis.__vesk_router;
  const tree = router?.routeTree;
  const rootNode = tree?.[0];
  return {
    updatedComponents: globalThis.__updatedComponents instanceof Set ? [...globalThis.__updatedComponents] : String(globalThis.__updatedComponents),
    h1: document.querySelector('h1')?.textContent?.trim(),
    rootNodePageType: typeof rootNode?.page,
    rootNodePageName: rootNode?.page?.name,
    rootNodePageName2: rootNode?._pageName,
    componentKeys: Object.keys(globalThis.__components || {}),
    homeFnName: globalThis.__components?.Home?.name,
    containerInner: document.getElementById('root')?.innerHTML?.slice(0, 200),
  };
});
console.log('State after HMR:', JSON.stringify(stateAfter, null, 2));

writeFileSync(pagePath, originalPage, 'utf-8');
await browser.close();
process.exit(0);
