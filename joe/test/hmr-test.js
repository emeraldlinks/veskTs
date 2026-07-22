import { startDevServer } from '../../packages/adapter/src/dev-server.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..', 'app');
const pagePath = resolve(appDir, 'page.vsk');
const layoutPath = resolve(appDir, 'layout.vsk');
const compPath = resolve(appDir, 'counter.vsk');
const clientBundlePath = resolve(__dirname, '..', '.vesk', 'dev', 'static', 'client.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) { if (!cond) { failed++; console.log(`  ✗ ${msg}`); } else { passed++; console.log(`  ✓ ${msg}`); } }

console.log('\n═══ Vesk HMR End-to-End Tests ═══\n');

const originalPageSrc = readFileSync(pagePath, 'utf-8');
const originalLayoutSrc = readFileSync(layoutPath, 'utf-8');

let server = null;
try {
  startDevServer(appDir, { port: 3002, publicDir: resolve(__dirname, '..', 'public') });
} catch(e) {
  // expected — server runs forever
}

await new Promise(r => setTimeout(r, 4000));

try {
  // --- Test 1: Client bundle has HMR runtime ---
  assert(existsSync(clientBundlePath), 'Client bundle exists');
  const clientCode = readFileSync(clientBundlePath, 'utf-8');
  assert(clientCode.includes('__vesk_dev'), 'HMR floating menu injected in client bundle');
  assert(clientCode.includes('component-update'), 'HMR message handler exists');
  assert(clientCode.includes('full-reload'), 'HMR full-reload handler exists');
  assert(clientCode.includes('WebSocket'), 'HMR WebSocket connection code present');

  // --- Test 2: WebSocket connects ---
  const ws = new WebSocket('ws://localhost:3002/_vesk/hmr');
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  assert(true, 'WebSocket connects to HMR endpoint');

  const messages = [];
  ws.onmessage = (e) => {
    try {
      messages.push(JSON.parse(e.data));
    } catch {}
  };

  await new Promise(r => setTimeout(r, 500));

  // --- Test 3: Page .vsk change — kind=page ---
  const modifiedSrc = originalPageSrc.replace(
    'data-testid="home-title">Home</h1>',
    'data-testid="home-title">HMR Updated Home</h1>'
  );
  writeFileSync(pagePath, modifiedSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const hasCompiling = messages.some(m => m.type === 'compiling');
  const hasComponentUpdate = messages.some(m => m.type === 'component-update');
  assert(hasCompiling, 'compiling message sent on file change');
  assert(hasComponentUpdate, 'component-update message sent after compilation');
  const pageCuMsg = messages.find(m => m.type === 'component-update' && m.name === 'Home');
  if (pageCuMsg) {
    assert(pageCuMsg.kind === 'page', 'Page update has kind=page');
    assert(pageCuMsg.fnSource.includes('__components["Home"]'), 'fnSource contains component assignment');
    const fnSource = pageCuMsg.fnSource;
    assert(fnSource.includes('function') || fnSource.includes('=>') || fnSource.includes('{'), 'fnSource is full function (not just first line)');
  }

  // --- Test 4: Compilation error sends error message ---
  writeFileSync(pagePath, 'invalid vesk code {{{', 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const hasError = messages.some(m => m.type === 'error');
  assert(hasError, 'error message sent for broken file');
  const errMsg = messages.find(m => m.type === 'error');
  if (errMsg) assert(errMsg.message, 'error has message');

  // --- Test 5: Fixing the file sends update again ---
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const updatesAfterFix = messages.filter(m => m.type === 'component-update');
  assert(updatesAfterFix.length >= 1, 'component-update sent after fixing file');

  // --- Test 6: Layout .vsk change — kind=layout ---
  const modifiedLayoutSrc = originalLayoutSrc.replace(
    'Vesk Footer',
    'HMR Updated Footer'
  );
  writeFileSync(layoutPath, modifiedLayoutSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const layoutCuMsg = messages.find(m => m.type === 'component-update' && m.kind === 'layout');
  assert(layoutCuMsg !== undefined, 'layout update has kind=layout');
  if (layoutCuMsg) assert(layoutCuMsg.name === 'RootLayout', 'layout component name is RootLayout');

  // --- Test 7: Standalone component .vsk — kind=component ---
  const compSrc = `component Counter {\n\t<div>Count: 0</div>\n}`;
  writeFileSync(compPath, compSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const compCreateMsg = messages.find(m => m.type === 'component-update' && m.name === 'Counter');
  assert(compCreateMsg !== undefined, 'standalone component creation broadcast');
  if (compCreateMsg) {
    assert(compCreateMsg.kind === 'component', 'Standalone component has kind=component');
    assert(compCreateMsg.fnSource.includes('__components["Counter"]'), 'fnSource contains Counter assignment');
  }

  const compSrc2 = `component Counter {\n\t<div>Count: 1</div>\n}`;
  writeFileSync(compPath, compSrc2, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const compUpdateMsgs = messages.filter(m => m.type === 'component-update' && m.name === 'Counter');
  assert(compUpdateMsgs.length >= 2, 'standalone component updates broadcast (create + modify)');

  // --- Test 8: HMR client has surgical update function ---
  assert(clientCode.includes('applyPageUpdate'), 'HMR client has applyPageUpdate function');
  assert(clientCode.includes('document.querySelector(\'main\')'), 'applyPageUpdate queries <main>');

  ws.close();
} catch (e) {
  console.log(`  ✗ Test error: ${e.message}`);
  console.error(e.stack);
  failed++;
} finally {
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  writeFileSync(layoutPath, originalLayoutSrc, 'utf-8');
  if (existsSync(compPath)) unlinkSync(compPath);
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
