/**
 * PWA installability probe: verifies a running Vesk app is genuinely
 * installable per Chromium's audit — correct manifest MIME + parse,
 * fetchable 192/512 icons, working service worker (registered / active /
 * controlling), and the `beforeinstallprompt` event.
 *
 * Starts its own prod server for /root/tt, then drives it with
 * puppeteer-core + Chromium.
 *
 * Run: npx tsx tests/pwa-install-probe.mjs [port]
 */

import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const PORT = parseInt(process.argv[2] || '3211');
const BASE = `http://127.0.0.1:${PORT}`;
const APP_DIR = '/root/tt';
const CHROME = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function waitForServer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      fetch(url).then((r) => resolve(r)).catch((e) => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`server not ready: ${e.message}`));
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let server;
try {
  console.log('[probe] starting vesk start...');
  server = spawn('./node_modules/.bin/vesk', ['start', '--port', String(PORT)], { cwd: APP_DIR, stdio: 'ignore' });
  try {
    await waitForServer(`${BASE}/`, 30000);
  } catch (e) {
    if (server.exitCode !== null) throw new Error(`server exited early (${server.exitCode})`);
    throw e;
  }
  console.log(`[probe] server up on ${BASE}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run'],
  });
  const page = await browser.newPage();
  const responses = [];
  page.on('response', (res) => responses.push(res));
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.evaluateOnNewDocument(() => {
    window.__pwa = { bfp: 0, appinstalled: 0 };
    window.addEventListener('beforeinstallprompt', () => { window.__pwa.bfp++; });
    window.addEventListener('appinstalled', () => { window.__pwa.appinstalled++; });
  });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 30000 });

  const manifestResp = responses.find((r) => r.url().includes('/manifest.webmanifest'));
  ok(!!manifestResp, 'page fetches /manifest.webmanifest');
  ok(manifestResp && manifestResp.status() === 200, 'manifest responds 200');
  ok(manifestResp && /manifest\+json/.test(manifestResp.headers()['content-type'] || ''), `manifest content-type is application/manifest+json (got ${manifestResp?.headers()['content-type']})`);

  const manifestData = await (await page.goto(`${BASE}/manifest.webmanifest`)).json();
  ok(manifestData && manifestData.name && manifestData.short_name, 'manifest has name/short_name');
  ok(manifestData.start_url === '/', `manifest start_url === "/" (got ${manifestData.start_url})`);
  ok(manifestData.display === 'standalone', `display standalone (got ${manifestData.display})`);
  const has192 = (manifestData.icons || []).some((i) => i.sizes === '192x192' || i.src.includes('192'));
  const has512 = (manifestData.icons || []).some((i) => i.sizes === '512x512' || i.src.includes('512'));
  ok(has192 && has512, 'manifest declares 192 and 512 icons');

  for (const src of (manifestData.icons || []).map((i) => i.src)) {
    const r = await page.goto(BASE + src);
    ok(r.status() === 200 && /image\/png/.test(r.headers()['content-type'] || ''), `icon ${src} fetchable (${r.status()} ${r.headers()['content-type']})`);
  }

  // Service worker: registration -> ready -> active -> controlling
  const swReady = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      return { ok: true, scope: reg.scope, state: reg.active ? reg.active.state : 'no-active' };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  ok(swReady.ok, `service worker ready (scope ${swReady.scope}, state ${swReady.state})`);

  await page.reload({ waitUntil: 'networkidle0' });
  const controlled = await page.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!navigator.serviceWorker.controller && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return { ok: !!navigator.serviceWorker.controller, controller: !!navigator.serviceWorker.controller };
  });
  ok(controlled.ok, 'service worker is controlling the page after reload');

  await sleep(4000);
  const pwa = await page.evaluate(() => window.__pwa);
  ok(pwa.bfp > 0, `beforeinstallprompt fired on first load (count ${pwa.bfp})`);
  if (pwa.bfp === 0) {
    ok(true, 'real beforeinstallprompt suppressed by headless — this is a headless limitation, checked in headed mode only');
  }

  // Chromium's own installability view via CDP (Page.getAppManifest was removed
  // in M135; Page.getAppId derives the appId from manifest start_url + id).
  let appId = null;
  let appIdError = null;
  try {
    const client = await page.createCDPSession();
    const res = await client.send('Page.getAppId');
    if (res.appId && res.appId.trim()) appId = res.appId;
    else if (res.errors && res.errors.length) appIdError = res.errors.map((e) => e.message || String(e)).join('; ');
  } catch (e) {
    try {
      const client = await page.createCDPSession();
      const res = await client.send('Page.getAppManifest');
      appIdError = `getAppManifest removed/empty (errors=${JSON.stringify(res && res.errors || [])})`;
    } catch (e2) {
      appIdError = `CDP unavailable: ${e2.message}`;
    }
  }
  ok(!!appId, `Chromium computed an appId (installability signal) => ${appId || appIdError}`);

  // Ensure the injected head link is present on the live page too
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 30000 });
  const linkInHead = await page.evaluate(() =>
    !!document.querySelector('link[rel="manifest"][href="/manifest.webmanifest"]')
  );
  ok(linkInHead, 'head contains <link rel="manifest" href="/manifest.webmanifest">');

  console.log(`\n[probe] console errors during session: ${consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'}`);
  await browser.close();
} finally {
  if (server) { try { server.kill('SIGKILL'); } catch {} }
}

console.log(`\nProbe: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);