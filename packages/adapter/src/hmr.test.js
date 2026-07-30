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

const PORT = parseInt(process.env.VESK_E2E_DEV_PORT || '3002');

const devDir = resolve(root, 'test-app', '.vesk', 'dev');
mkdirSync(resolve(devDir, 'static'), { recursive: true });
const clientBundlePath = resolve(devDir, 'static', 'client.js');
const runtimeDir = resolve(root, 'node_modules', '@vesk', 'runtime', 'src');
const hmrClientPath = resolve(runtimeDir, 'hmr-client.ts');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.log(`  \u2717 ${msg}`); }
  else { passed++; console.log(`  \u2713 ${msg}`); }
}

console.log('\n\u2550\u2550\u2550 Vesk HMR End-to-End Tests \u2550\u2550\u2550\n');

const originalPageSrc = readFileSync(pagePath, 'utf-8');
const originalLayoutSrc = readFileSync(layoutPath, 'utf-8');

if (!process.env.VESK_E2E) {
  startDevServer(appDir, { port: PORT, publicDir });
  await new Promise(r => setTimeout(r, 4000));
}

try {
  const clientCode = existsSync(clientBundlePath) ? readFileSync(clientBundlePath, 'utf-8') : '';
  assert(existsSync(clientBundlePath), 'Client bundle exists');
  assert(clientCode.includes('__vesk_hmr_eval'), 'HMR eval helper defined in client bundle');
  assert(clientCode.includes('__vesk_router'), 'Router exposed on globalThis');

  const hmrCode = existsSync(hmrClientPath) ? readFileSync(hmrClientPath, 'utf-8') : '';
  assert(existsSync(hmrClientPath), 'HMR client file exists');
  assert(hmrCode.includes('__vesk_dev'), 'HMR floating menu defined in hmr client');
  assert(hmrCode.includes('WebSocket'), 'HMR WebSocket connection code present');
  assert(hmrCode.includes("'update'") || hmrCode.includes('"update"'), 'HMR client handles update messages');
  assert(hmrCode.includes("'reload'") || hmrCode.includes('"reload"'), 'HMR client handles reload messages');

  const ws = new WebSocket(`ws://localhost:${PORT}/_vesk/hmr`);
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

  // --- Page .vsk change ---
  const modifiedPageSrc = originalPageSrc.replace(
    /<h1[^>]*>[^<]*<\/h1>/,
    '<h1 class="text-4xl font-bold mb-2">HMR Updated</h1>'
  );
  writeFileSync(pagePath, modifiedPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const hasCompiling = messages.some(m => m.type === 'compiling');
  const hasUpdate = messages.some(m => m.type === 'update' && m.components && m.components[pageCompName]);
  assert(hasCompiling, 'compiling message sent on file change');
  assert(hasUpdate, 'update message sent with component name');

  const pageUpdateMsg = messages.find(m => m.type === 'update' && m.components && m.components[pageCompName]);
  if (pageUpdateMsg) {
    const fnRaw = pageUpdateMsg.fnSources && (
      pageUpdateMsg.fnSources[pageCompName] || pageUpdateMsg.fnSources._raw
    );
    assert(!!fnRaw, 'update has fnSources');
    assert(
      fnRaw && (fnRaw.includes('function') || fnRaw.includes('=>')),
      'fnSource contains a function'
    );
    assert(typeof pageUpdateMsg.time === 'number', 'update has numeric time field');
  }

  // --- Compilation error ---
  writeFileSync(pagePath, 'invalid vesk code {{{', 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const errMsg = messages.find(m => m.type === 'error');
  assert(errMsg !== undefined, 'error message sent for broken file');
  if (errMsg) assert(errMsg.message, 'error has message');

  // --- Fix file ---
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const updatesAfterFix = messages.filter(m => m.type === 'update');
  assert(updatesAfterFix.length >= 1, 'update sent after fixing file');

  // --- Standalone component ---
  const compSrc = 'component Counter {\n\t<p>Count: 0</p>\n}';
  writeFileSync(compPath, compSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const counterCreate = messages.find(m => m.type === 'update' && m.components && m.components.Counter);
  assert(counterCreate !== undefined, 'standalone component creation broadcast');
  if (counterCreate) {
    const fnRaw = counterCreate.fnSources && (
      counterCreate.fnSources.Counter || counterCreate.fnSources._raw
    );
    assert(fnRaw && fnRaw.includes('__components["Counter"]'), 'fnSources contains Counter assignment');
  }

  const compSrc2 = 'component Counter {\n\t<p>Count: 1</p>\n}';
  writeFileSync(compPath, compSrc2, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const counterUpdates = messages.filter(m => m.type === 'update' && m.components && m.components.Counter);
  assert(counterUpdates.length >= 2, 'standalone component updates broadcast (create + modify)');

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
