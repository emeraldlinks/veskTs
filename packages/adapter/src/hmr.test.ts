import { startDevServer } from '@vesk/adapter/src/dev-server';
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
const runtimeDir = resolve(root, 'node_modules', '@vesk', 'runtime');
const hmrClientPath = resolve(runtimeDir, 'dist', 'hmr-client.js');

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
  // The initial build (SSR functions + esbuild client bundle) can take several
  // seconds. Poll for the client bundle AND a live TCP connection instead of
  // sleeping a fixed amount so the assertions below don't race the build.
  const deadline = Date.now() + 30000;
  while (!existsSync(clientBundlePath)) {
    if (Date.now() > deadline) {
      console.log('  \u2717 timed out waiting for dev-server client bundle');
      failed++;
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/_vesk/runtime.js`);
      if (res.ok) { up = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!up) {
    console.log('  \u2717 timed out waiting for dev server to accept connections');
    failed++;
    process.exit(1);
  }
}

try {
  const clientCode = existsSync(clientBundlePath) ? readFileSync(clientBundlePath, 'utf-8') : '';
  assert(existsSync(clientBundlePath), 'Client bundle exists');
  assert(clientCode.includes('__vesk_hmr_eval'), 'HMR eval helper defined in client bundle');
  assert(clientCode.includes('__vesk_hmr_nonce'), 'HMR eval helper is nonce-gated');
  assert(clientCode.includes('__vesk_router'), 'Router exposed on globalThis');

  const hmrCode = existsSync(hmrClientPath) ? readFileSync(hmrClientPath, 'utf-8') : '';
  assert(existsSync(hmrClientPath), 'HMR client file exists');
  assert(hmrCode.includes('__vesk_dev'), 'HMR floating menu defined in hmr client');
  assert(hmrCode.includes('WebSocket'), 'HMR WebSocket connection code present');
  assert(hmrCode.includes("'update'") || hmrCode.includes('"update"'), 'HMR client handles update messages');
  assert(hmrCode.includes("'reload'") || hmrCode.includes('"reload"'), 'HMR client handles reload messages');
  assert(hmrCode.includes('nonce'), 'HMR client forwards the update nonce to the eval hook');

  const ws = new WebSocket(`ws://localhost:${PORT}/_vesk/hmr`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  assert(true, 'WebSocket connects to HMR endpoint');

  // Browser-style connection sends an Origin header — same origin must pass.
  try {
    const sameOrigin = new WebSocket(`ws://127.0.0.1:${PORT}/_vesk/hmr`, {
      headers: { origin: `http://localhost:${PORT}` },
    });
    await new Promise((resolve, reject) => {
      sameOrigin.onopen = resolve;
      sameOrigin.onerror = reject;
      setTimeout(() => reject(new Error('timeout')), 4000);
    });
    sameOrigin.close();
    assert(true, 'same-origin WebSocket (with Origin header) connects');
  } catch {
    assert(false, 'same-origin WebSocket (with Origin header) connects');
  }

  // Cross-site pages attach a mismatched Origin — must be destroyed.
  let blocked = false;
  try {
    const evil = new WebSocket(`ws://127.0.0.1:${PORT}/_vesk/hmr`, {
      headers: { origin: 'https://evil.example' },
    });
    await new Promise((resolve, reject) => {
      evil.onopen = resolve;
      evil.onerror = () => reject(new Error('rejected'));
      setTimeout(() => reject(new Error('timeout')), 4000);
    });
    evil.close();
  } catch {
    blocked = true;
  }
  assert(blocked, 'cross-origin WebSocket upgrade is rejected');

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

  // --- Compilation error (multi-line file, syntax error at line 11) ---
  const brokenLines = Array.from({ length: 21 }, (_, i) => `const n${i} = ${i};`);
  brokenLines[10] = 'const {{{ break;';
  writeFileSync(pagePath, brokenLines.join('\n'), 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const errMsg = messages.find(m => m.type === 'error');
  assert(errMsg !== undefined, 'error message sent for broken file');
  if (errMsg) {
    assert(typeof errMsg.message === 'string' && errMsg.message.length > 0, 'enriched error has a string message');
    assert(Number.isInteger(errMsg.line) && Number.isInteger(errMsg.column), 'enriched error has integer line/column');
    assert(errMsg.line === 11 && errMsg.column > 0, 'enriched error line points at the syntax-error line (11)');
    assert(Array.isArray(errMsg.tips) && errMsg.tips.length >= 1, 'enriched error has tips array');
    assert(Array.isArray(errMsg.suggestions) && errMsg.suggestions.length >= 1, 'enriched error has suggestions array');
    assert(Array.isArray(errMsg.nextSteps) && errMsg.nextSteps.length >= 1, 'enriched error has nextSteps array');
    assert(errMsg.codeframe && Array.isArray(errMsg.codeframe.code), 'enriched error includes a codeframe (source + line available)');
    if (errMsg.codeframe) {
      const errLines = errMsg.codeframe.code.filter(l => l.isError);
      assert(errLines.length === 1 && errLines[0].no === errMsg.line, 'codeframe has exactly one isError line at the error line');
      assert(errMsg.codeframe.code.length === 11, 'codeframe spans 5 up + error + 5 down (11 lines)');
      assert(
        errMsg.codeframe.code[0].no === errMsg.line - 5 && errMsg.codeframe.code[10].no === errMsg.line + 5,
        'codeframe window is exactly ±5 lines'
      );
    }
  }

  // Live HMR state reflects the error over the state endpoint.
  const stErrRes = await fetch(`http://127.0.0.1:${PORT}/__vesk/hmr/state`);
  const stErr = await stErrRes.json();
  assert(stErrRes.ok, 'state endpoint responds 200');
  assert(stErr.status === 'up', 'getHmrState status is up while serving');
  assert(stErr.hasError === true && stErr.error && stErr.error.message === errMsg.message,
    'getHmrState reflects the live (enriched) error');
  assert(stErr.error && stErr.error.codeframe && stErr.error.codeframe.code.length === 11,
    'getHmrState carries the enriched error with codeframe');

  // --- Fix file ---
  writeFileSync(pagePath, originalPageSrc, 'utf-8');
  await new Promise(r => setTimeout(r, 1500));

  const updatesAfterFix = messages.filter(m => m.type === 'update');
  assert(updatesAfterFix.length >= 1, 'update sent after fixing file');

  const stFixed = await (await fetch(`http://127.0.0.1:${PORT}/__vesk/hmr/state`)).json();
  assert(stFixed.hasError === false && stFixed.error === null, 'getHmrState error cleared on update');
  assert(typeof stFixed.lastCompileMs === 'number', 'getHmrState tracks lastCompileMs after a successful update');

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
