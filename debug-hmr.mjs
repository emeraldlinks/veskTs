import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve('/workspaces/veskTs');
process.chdir(resolve(root, 'test-app'));

const configModule = await import(resolve(root, 'test-app/vesk.config.ts'));
const config = configModule.default || {};
const { startDevServer } = await import(resolve(root, 'packages/cli/src/dev-server.ts'));
startDevServer(3000, resolve(root, 'test-app'), config);

// Wait for server
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch('http://localhost:3000/');
    if (res.ok) break;
  } catch {}
  await new Promise(r => setTimeout(r, 1000));
}

console.log('Dev server ready on :3000');

// Launch browser
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();

// Capture console and errors
page.on('console', msg => console.log('  BROWSER:', msg.text()));
page.on('pageerror', err => console.log('  PAGE ERR:', err.message));

// Test 1: Initial load
console.log('\n--- Initial load ---');
await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
const h1Before = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
console.log('h1 before:', h1Before);

// Check globals
const globals = await page.evaluate(() => ({
  hasTrack: typeof globalThis.track,
  hasSet: typeof globalThis.set,
  hasGet: typeof globalThis.get,
  hasEffect: typeof globalThis.effect,
  hasComponents: typeof globalThis.__components,
  componentKeys: Object.keys(globalThis.__components || {}),
  hasRouter: typeof globalThis.__vesk_router,
  hasHmrEval: typeof globalThis.__vesk_hmr_eval,
  hasUpdatedComponents: typeof globalThis.__updatedComponents,
  componentInstances: globalThis.__vesk_router?.__componentInstances 
    ? [...globalThis.__vesk_router.__componentInstances.keys()]
    : 'none or empty',
}));
console.log('Globals:', JSON.stringify(globals, null, 2));

// Test 2: HMR page.vsk update
console.log('\n--- HMR page.vsk update ---');
const pagePath = resolve(root, 'test-app/app/page.vsk');
const originalPage = readFileSync(pagePath, 'utf-8');

// Set flag
await page.evaluate(() => { window.__spaFlag = true; });

// Modify page.vsk
const modifiedPage = originalPage.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>');
writeFileSync(pagePath, modifiedPage, 'utf-8');
console.log('Wrote modified page.vsk');

// Wait for HMR
await new Promise(r => setTimeout(r, 5000));

// Check
const flagAlive = await page.evaluate(() => window.__spaFlag === true);
console.log('Flag alive (no reload):', flagAlive);

const h1After = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || '');
console.log('h1 after:', h1After);

// Check if __components was updated
const afterGlobals = await page.evaluate(() => ({
  componentKeys: Object.keys(globalThis.__components || {}),
  updatedComponents: globalThis.__updatedComponents instanceof Set ? [...globalThis.__updatedComponents] : 'not a set',
}));
console.log('After HMR globals:', JSON.stringify(afterGlobals, null, 2));

// Restore
writeFileSync(pagePath, originalPage, 'utf-8');

await browser.close();
process.exit(0);
