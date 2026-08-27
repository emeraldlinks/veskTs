import { resolve } from 'path';
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

// Check if HMR websocket is connected
const wsStatus = await page.evaluate(() => {
  // Intercept WebSocket to see messages
  return typeof WebSocket !== 'undefined' ? 'WebSocket available' : 'no WebSocket';
});
console.log('WebSocket:', wsStatus);

// Set up message interception
await page.evaluate(() => {
  const OrigWS = window.WebSocket;
  window.__hmrMessages = [];
  window.WebSocket = function(url, ...args) {
    const ws = new OrigWS(url, ...args);
    const origOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        window.__hmrMessages.push({ type: msg.type, components: msg.components, hasFnSources: !!msg.fnSources });
        console.log('[HMR MSG]', msg.type, msg.components ? Object.keys(msg.components) : '');
      } catch(ex) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  window.WebSocket.CONNECTING = OrigWS.CONNECTING;
  window.WebSocket.OPEN = OrigWS.OPEN;
  window.WebSocket.CLOSING = OrigWS.CLOSING;
  window.WebSocket.CLOSED = OrigWS.CLOSED;
});

// Reload to pick up the intercepted WebSocket
await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
console.log('Page loaded with WS interceptor');

const h1Before = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim());
console.log('h1 before:', h1Before);

// Modify page.vsk
const pagePath = resolve(root, 'test-app/app/page.vsk');
const originalPage = readFileSync(pagePath, 'utf-8');
const modifiedPage = originalPage.replace(/<h1[^>]*>[^<]*<\/h1>/, '<h1 class="text-4xl font-bold mb-2">HMR Updated!</h1>');
writeFileSync(pagePath, modifiedPage, 'utf-8');
console.log('Wrote modified page.vsk');

await new Promise(r => setTimeout(r, 6000));

const h1After = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim());
console.log('h1 after:', h1After);

const messages = await page.evaluate(() => window.__hmrMessages);
console.log('HMR messages received:', JSON.stringify(messages));

const evalResult = await page.evaluate(() => {
  const r = globalThis.__vesk_router;
  return {
    hasRouter: !!r,
    hasHmrUpdate: typeof r?.hmrUpdate,
    hasUpdateComponents: typeof r?.__updateComponents,
    hasComponents: typeof globalThis.__components,
    homeFn: typeof globalThis.__components?.Home,
    homeFnName: globalThis.__components?.Home?.name,
    updatedComponents: globalThis.__updatedComponents instanceof Set ? [...globalThis.__updatedComponents] : String(globalThis.__updatedComponents),
  };
});
console.log('Router state:', JSON.stringify(evalResult, null, 2));

writeFileSync(pagePath, originalPage, 'utf-8');
await browser.close();
process.exit(0);
