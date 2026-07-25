import { startDevServer } from './dev-server.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');

const appDir = resolve(root, 'test-app', 'app');
const publicDir = resolve(root, 'test-app', 'public');
const pagePath = resolve(appDir, 'page.vsk');
const layoutPath = resolve(appDir, 'layout.vsk');
const compPath = resolve(appDir, 'counter.vsk');

const devDir = resolve(root, 'test-app', '.vesk', 'dev');
mkdirSync(resolve(devDir, 'static'), { recursive: true });
const clientBundlePath = resolve(devDir, 'static', 'client.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk HMR End-to-End Tests \u2550\u2550\u2550\n');

const originalPageSrc = readFileSync(pagePath, 'utf-8');
const originalLayoutSrc = readFileSync(layoutPath, 'utf-8');

startDevServer(appDir, { port: 3002, publicDir });
await new Promise(r => setTimeout(r, 4000));

try {
  const clientCode = existsSync(clientBundlePath) ? readFileSync(clientBundlePath, 'utf-8') : '';
  assert(existsSync(clientBundlePath), 'Client bundle exists');
  assert(clientCode.includes('__vesk_dev'), 'HMR floating menu injected in client bundle');
  assert(clientCode.includes('component-update'), 'HMR message handler exists');
  assert(clientCode.includes('full-reload'), 'HMR full-reload handler exists');
  assert(clientCode.includes('WebSocket'), 'HMR WebSocket connection code present');

  const ws = new WebSocket('ws://localhost:3002/_vesk/hmr');
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  assert(true, 'WebSocket connects to HMR endpoint');

  const messages = [];
  ws.onmessage = (e) => {
    try { messages.push(JSON.parse(e.data)); } catch {}
  };
  await new Promise(r => setTimeout(r, 500));

  const pageCompName = originalPageSrc.match(/component\s+(\w+)/m)?.[1] || 'Home';
  const layoutCompName = originalLayoutSrc.match(/component\s+(\w+)/m)?.[1] || 'Layout';

  // --- Page .vsk change ---
  const modifiedPageSrc = originalPageSrc.replace(
    /<h1[^>]*>[^<]*<\/h1>/,
    '<h1 class="text-4xl font-bold mb-2">HMR Updated</h1>'
  );
  writeFileSync(pagePath, modifiedPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const hasCompiling = messages.some(m => m.type === 'compiling');
  const hasComponentUpdate = messages.some(m => m.type === 'component-update');
  assert(hasCompiling, 'compiling message sent on file change');
  assert(hasComponentUpdate, 'component-update message sent after compilation');

  const pageCuMsg = messages.find(m => m.type === 'component-update' && m.name === pageCompName);
  if (pageCuMsg) {
    assert(pageCuMsg.kind === 'page', 'Page update has kind=page');
    assert(pageCuMsg.fnSource.includes(`__components["${pageCompName}"]`), 'fnSource contains component assignment');
    assert(
      pageCuMsg.fnSource.includes('function') || pageCuMsg.fnSource.includes('=>'),
      'fnSource is a function (not just first line)'
    );
  }

  // --- Compilation error ---
  writeFileSync(pagePath, 'invalid vesk code {{{', 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const hasError = messages.some(m => m.type === 'error');
  assert(hasError, 'error message sent for broken file');
  const errMsg = messages.find(m => m.type === 'error');
  if (errMsg) assert(errMsg.message, 'error has message');

  // --- Fix file ---
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const updatesAfterFix = messages.filter(m => m.type === 'component-update');
  assert(updatesAfterFix.length >= 1, 'component-update sent after fixing file');

  // --- Layout .vsk change ---
  const modifiedLayoutSrc = originalLayoutSrc.replace(
    /Powered by Vesk/,
    'HMR Updated Footer'
  );
  writeFileSync(layoutPath, modifiedLayoutSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const layoutCuMsg = messages.find(m => m.type === 'component-update' && m.kind === 'layout');
  assert(layoutCuMsg !== undefined, 'layout update has kind=layout');
  if (layoutCuMsg) assert(layoutCuMsg.name === layoutCompName, `layout component name is ${layoutCompName}`);

  // --- Standalone component ---
  const compSrc = 'component Counter {\n\t<p>Count: 0</p>\n}';
  writeFileSync(compPath, compSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const compCreateMsg = messages.find(m => m.type === 'component-update' && m.name === 'Counter');
  assert(compCreateMsg !== undefined, 'standalone component creation broadcast');
  if (compCreateMsg) {
    assert(compCreateMsg.kind === 'component', 'Standalone component has kind=component');
    assert(compCreateMsg.fnSource.includes('__components["Counter"]'), 'fnSource contains Counter assignment');
  }

  const compSrc2 = 'component Counter {\n\t<p>Count: 1</p>\n}';
  writeFileSync(compPath, compSrc2, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const compUpdateMsgs = messages.filter(m => m.type === 'component-update' && m.name === 'Counter');
  assert(compUpdateMsgs.length >= 2, 'standalone component updates broadcast (create + modify)');

  // --- HMR client helpers ---
  assert(clientCode.includes('applyPageUpdate'), 'HMR client has applyPageUpdate function');
  assert(clientCode.includes("document.querySelector('main')"), 'applyPageUpdate queries <main>');

  ws.close();
} catch (e) {
  console.log(`  \u2717 Test error: ${e.message}`);
  console.error(e.stack);
  failed++;
} finally {
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  writeFileSync(layoutPath, originalLayoutSrc, 'utf-8');
  if (existsSync(compPath)) unlinkSync(compPath);
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
