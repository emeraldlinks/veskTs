/**
 * Route crawler: visits every test-app route with headless Chromium and
 * reports SSR latency + hydration performance.
 */
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE || 'http://localhost:3000';

// expectStatus: HTTP status the route must return (default 200).
// expectErrors: pageerror message substrings that are intentional (error
// boundaries / framework 404) and therefore do not count as failures.
const ROUTES = [
  { route: '/' },
  { route: '/about' },
  { route: '/blog' },
  { route: '/blog/hello-world' },
  { route: '/blog/ssr-in-vesk' },
  { route: '/async' },
  { route: '/comp-test' },
  { route: '/actions' },
  { route: '/posts' },
  { route: '/empty' },
  { route: '/map' },
  { route: '/statements' },
  { route: '/store' },
  { route: '/store/widget' },
  { route: '/typed' },
  { route: '/store/missing', expectStatus: 404, expectErrors: ['Not Found'] },
  { route: '/store/boom', expectStatus: 500, expectErrors: ['Store exploded'] },
  { route: '/does-not-exist', expectStatus: 404 },
];

async function measureSSR(route) {
  const url = BASE + route;
  const out = execSync(`curl -s -o /dev/null -w '%{time_starttransfer}\\t%{time_total}\\t%{http_code}\\t%{size_download}' '${url}'`, { encoding: 'utf8' });
  const [ttfb, total, code, bytes] = out.trim().split('\t');
  return { route, ttfb: (+ttfb * 1000).toFixed(0), total: (+total * 1000).toFixed(0), code, bytes };
}

let browser;
let passed = 0;
let failed = 0;
const results = [];

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  console.log('\n=== SSR latency (curl) ===');
  const ssrRows = [];
  for (const entry of ROUTES) {
    try { ssrRows.push(await measureSSR(entry.route)); }
    catch { ssrRows.push({ route: entry.route, ttfb: 'ERR', total: 'ERR', code: '-', bytes: '-' }); }
  }
  console.log('route'.padEnd(22), 'TTFB(ms)', 'total(ms)', 'http', 'bytes');
  for (const r of ssrRows) {
    console.log(r.route.padEnd(22), String(r.ttfb).padEnd(9), String(r.total).padEnd(9), r.code.padEnd(5), r.bytes);
  }

  console.log('\n=== Browser hydration ===');
  console.log('route'.padEnd(22), 'respStart', 'dcl', 'load', 'hydrate(ms)', 'jsErrors', 'status');

  for (const entry of ROUTES) {
    const { route, expectStatus = 200, expectErrors = [] } = entry;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    let hydrationMs = -1;
    let status = 'OK';
    try {
      const resp = await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 20000 });
      if (!resp) status = 'NO RESPONSE';
      else if (resp.status() >= 400) status = 'HTTP ' + resp.status();

      // Measure hydration completion: time until all `vsk` markers are claimed.
      hydrationMs = await page.evaluate(async () => {
        const t0 = performance.now();
        const countMarkers = () => {
          const root = document.getElementById('root');
          if (!root) return -1;
          const walker = document.createTreeWalker(root, 128, {
            acceptNode: (n) => n.textContent === 'vsk' ? 1 : 2,
          });
          let c = 0;
          while (walker.nextNode()) c++;
          return c;
        };
        const deadline = 5000;
        while (performance.now() - t0 < deadline) {
          if (countMarkers() === 0) return Math.round(performance.now() - t0);
          await new Promise(r => setTimeout(r, 10));
        }
        return -1;
      });
    } catch (e) {
      status = 'ERROR: ' + (e.message || e).slice(0, 80);
    }

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n ? {
        respStart: Math.round(n.responseStart),
        dcl: Math.round(n.domContentLoadedEventEnd),
        load: Math.round(n.loadEventEnd),
        transfer: Math.round(n.transferSize),
      } : {};
    }).catch(() => ({}));

    const expectStatusStr = expectStatus === 200 ? 'OK' : 'HTTP ' + expectStatus;
    const unexpectedErrors = errors.filter(e => !expectErrors.some(p => e.includes(p)));
    const statusMark = status === expectStatusStr ? '  ✓' : '  ✗';
    const ok = status === expectStatusStr && unexpectedErrors.length === 0;
    if (ok) passed++; else failed++;
    console.log(
      route.padEnd(22),
      String(nav.respStart ?? '-').padEnd(9),
      String(nav.dcl ?? '-').padEnd(8),
      String(nav.load ?? '-').padEnd(6),
      String(hydrationMs).padEnd(12),
      String(errors.length).padEnd(9),
      statusMark + ' ' + status + (status === expectStatusStr && expectErrors.length > 0 ? ' (expected)' : '')
    );
    results.push({ route, ssr: ssrRows.find(r => r.route === route), nav, hydrationMs, errors });
    await page.close();
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failed > 0) process.exit(1);
  await browser.close();
}

main().catch(e => { console.error('Crawler error:', e); process.exit(1); });
