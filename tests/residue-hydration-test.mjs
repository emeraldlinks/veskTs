import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Component-call residue — the hydration path, in a real browser.
 *
 * A component whose hydrate-mode body emits NO claim (`island.vsk`: a bare
 * `effect()` plus static markup) leaves its server-rendered root in the DOM
 * with no owner. The NEXT sibling's claim used to land on that node, read the
 * tag mismatch as a divergence, consume the slot, DETACH it and return a fresh
 * element that never reached the document — so the counter rendered but was
 * completely inert: no `__evh_click`, no `data-vsk-ev`, clicks dead.
 *
 * The unit suites cover the walker rule (packages/runtime/src/hydrate.test.ts)
 * and the emitted marker (packages/compiler/src/client-codegen.test.ts). This
 * file is the end-to-end proof, on the production build AND the dev server.
 *
 * It drives its OWN fixture app (`tests/fixtures/residue-app/`) rather than a
 * route in `test-app`, for two reasons:
 *  - `scripts/asset-budget.mjs` measures test-app's production payload. A
 *    test-only route there added a 30th chunk and ~13.5 KB, which is a
 *    framework-payload regression the gate is right to flag — the fixture is
 *    not a framework payload. Keeping it out means the budget still measures
 *    exactly what it measured before.
 *  - the fixture is then 6 tiny files with no dependencies, so this test needs
 *    no e2e server, no port coordination with scripts/test.js, and cannot be
 *    invalidated by unrelated test-app routes.
 *
 * The RED HERRING worth repeating: a FULLY STATIC component is NOT this bug.
 * The bundler gives those a `claimOnly` stub that consumes their own SSR slot.
 * A fixture using that shape passes against the broken runtime. `island.vsk`
 * needs the `effect()` to stay out of the static bucket.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const FIXTURE = resolve(root, 'tests/fixtures/residue-app');
const FIXTURE_OUT = resolve(FIXTURE, '.vesk-build');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const PROD_PORT = parseInt(process.env.RESIDUE_PROD_PORT || '3187');
const DEV_PORT = parseInt(process.env.RESIDUE_DEV_PORT || '3188');

let passed = 0;
let failed = 0;
let browser;
let httpServer;
let devChild;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(base, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok && (await res.text()).includes('residue-bit')) return true;
    } catch { /* not listening yet */ }
    await sleep(1000);
  }
  return false;
}

const readState = (page) => page.evaluate(() => {
  const btn = document.querySelector('.rbtn');
  return {
    bitInDom: !!document.querySelector('.residue-bit'),
    btnCount: document.querySelectorAll('.rbtn').length,
    hasHandler: btn ? typeof btn.__evh_click === 'function' : false,
    evAttr: btn ? btn.getAttribute('data-vsk-ev') : null,
    connected: btn ? btn.isConnected : false,
    count: (document.querySelector('.rcount')?.textContent || '').trim(),
  };
});

/** One full hydration + interactivity pass against `base`. */
async function checkTarget(label, base) {
  console.log(`\n${label} (${base})`);
  const page = await browser.newPage();
  const errors = [];
  const notFound = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Collect failing URLs, not console text: the console message for a 404 is
  // "Failed to load resource..." with no URL in it, so a text filter silently
  // passes every missing asset (this fixture has no favicon, for one).
  page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(1200);

  // Both residue seams at once: the root layout's bare slot and the page's
  // element-level sibling. Neither may consume the island's SSR slot.
  const islands = await page.evaluate(() => document.querySelectorAll('.residue-bit').length);
  assert(islands >= 2, `both static islands are server-rendered (found ${islands})`);

  const before = await readState(page);
  assert(before.bitInDom, 'static sibling output survived hydration');
  assert(before.btnCount === 1, `exactly one .rbtn in the document (got ${before.btnCount})`);
  assert(before.connected, '.rbtn is connected to the document');
  assert(before.hasHandler, '.rbtn carries its event handler (not a detached node)');
  assert(before.evAttr !== null, '.rbtn carries data-vsk-ev');
  assert(before.count === 'count:0', `hydrated text is the SSR value (got ${JSON.stringify(before.count)})`);

  await page.click('.rbtn');
  await sleep(400);
  const after1 = await readState(page);
  assert(after1.count === 'count:1', `CLICK RE-RENDERS 0 → 1 (got ${JSON.stringify(after1.count)})`);

  await page.click('.rbtn');
  await sleep(400);
  const after2 = await readState(page);
  assert(after2.count === 'count:2', `CLICK RE-RENDERS 1 → 2 (got ${JSON.stringify(after2.count)})`);
  assert(after2.bitInDom, 'static sibling still in the document after re-renders');
  assert(after2.btnCount === 1, 'no duplicate .rbtn after re-renders');

  // SPA navigation: the fresh-render path, and a round trip back.
  // The click must NOT be awaited inside page.evaluate — the navigation can
  // tear down the execution context and reject a pending evaluate even though
  // the navigation succeeded. Fire it, then poll from Node.
  const clicked = await page.evaluate(() => {
    const link = document.querySelector('a[href="/other"]');
    if (!link) return false;
    link.click();
    return true;
  });
  assert(clicked, 'nav exposes a link to /other');
  let onOther = false;
  for (let i = 0; i < 20 && !onOther; i++) {
    await sleep(200);
    try { onOther = await page.evaluate(() => location.pathname === '/other'); } catch { /* mid-navigation */ }
  }
  assert(onOther, 'SPA navigation away from / works');
  if (onOther) {
    await sleep(400);
    const otherTitle = await page.evaluate(() => document.querySelector('.other-title')?.textContent?.trim());
    assert(otherTitle === 'other route', `the other route rendered (got ${JSON.stringify(otherTitle)})`);

    // The layout's OWN siblings (its nav, its static island) must survive a
    // fresh render. This is a bare-`{props.children}` layout, so the slot and
    // the siblings share one return value: returning only the slot silently
    // dropped them, and the page after a navigation had no nav at all.
    const navAfterNav = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a')).map((a) => a.getAttribute('href')));
    assert(navAfterNav.length === 2, `the layout's nav survives SPA navigation (found ${navAfterNav.length} links: ${JSON.stringify(navAfterNav)})`);
    const islandAfterNav = await page.evaluate(() => !!document.querySelector('.residue-bit'));
    assert(islandAfterNav, "the layout's static island survives SPA navigation");

    await page.evaluate(() => { const a = document.querySelector('a[href="/"]'); if (a) a.click(); });
    let backHome = false;
    for (let i = 0; i < 20 && !backHome; i++) {
      await sleep(200);
      try { backHome = await page.evaluate(() => location.pathname === '/'); } catch { /* mid-navigation */ }
    }
    assert(backHome, 'SPA navigation back to / works');
    if (backHome) {
      await sleep(600);
      await page.click('.rbtn');
      await sleep(400);
      const spaAfter = await readState(page);
      assert(spaAfter.count === 'count:1', `SPA-rendered page is interactive (got ${JSON.stringify(spaAfter.count)})`);
    }
  }

  const real = errors.filter((e) => !/favicon/i.test(e));
  assert(real.length === 0, `no console errors${real.length ? ` — ${real.slice(0, 2).join(' | ')}` : ''}`);
  const realMissing = notFound.filter((u) => !/favicon/i.test(u));
  assert(realMissing.length === 0, `no failed requests${realMissing.length ? ` — ${realMissing.slice(0, 2).join(' | ')}` : ''}`);
  await page.close();
}

async function main() {
  // Build the fixture with the repo's own adapter — the same code path a real
  // `vesk build` takes, so the fixture cannot drift from production behavior.
  const { build } = await import(resolve(root, 'packages/adapter/src/index.ts'));
  const { startProdServer } = await import(resolve(root, 'packages/adapter/src/prod-server.ts'));
  console.error('Building the residue fixture app...');
  await build(resolve(FIXTURE, 'app'), {
    outDir: FIXTURE_OUT,
    publicDir: resolve(FIXTURE, 'public'),
    codeSplit: true,
    plugins: [],
  });

  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    // Chrome's own 30s default is the tightest step in the suite on a loaded
    // box; the launch handshake needs far longer here.
    timeout: 120000,
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const prodBase = `http://127.0.0.1:${PROD_PORT}`;
  httpServer = await startProdServer(FIXTURE_OUT, { port: PROD_PORT, host: '127.0.0.1' });
  if (!(await waitForHttp(prodBase, 30000))) throw new Error(`fixture prod server never came up on ${PROD_PORT}`);
  await checkTarget('production', prodBase);
  await new Promise((r) => httpServer.close(r));

  // Dev server: its own process (startDevServer returns no handle to close).
  const devBase = `http://127.0.0.1:${DEV_PORT}`;
  devChild = spawn('npx', ['tsx', resolve(root, 'tests/fixtures/run-residue-dev.mjs'), String(DEV_PORT)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devChild.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[dev] ${d}`));
  devChild.stderr.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[dev!] ${d}`));
  if (!(await waitForHttp(devBase, 180000))) throw new Error(`fixture dev server never came up on ${DEV_PORT}`);
  await checkTarget('dev', devBase);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
}

main()
  .catch((e) => { console.error(e); failed++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (httpServer) await new Promise((r) => httpServer.close(r)).catch(() => {});
    if (devChild) devChild.kill('SIGKILL');
    await sleep(300);
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
