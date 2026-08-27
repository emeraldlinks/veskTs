/**
 * Route crawler — full-capture audit.
 *
 * Visits every test-app route with headless Chromium and captures EVERYTHING
 * that can leak data or errors:
 *
 *  Phase A — fresh full load of each route:
 *    · SSR latency (curl), HTTP status, content-type
 *    · hydration completion (all `vsk` markers claimed within the deadline)
 *    · page errors (uncaught exceptions), console error/warning messages,
 *      failed network requests, resources answered >= 400
 *    · document leak analysis: stack-trace frames, absolute filesystem paths,
 *      node:internal frames, ssr-data script refs (must be exactly 1 on data
 *      routes, 0 everywhere else), x-vesk-data requests on initial load
 *      (must be 0 — data is SSR'd, never re-fetched)
 *    · ssr-data payload integrity (must be `globalThis.__vsk_ssr_data = {...}`
 *      JSON, never an HTML/error response)
 *
 *  Phase B — one session, SPA-navigate across every route via the router:
 *    · content renders per route, no full-page reload, zero page errors,
 *      zero console errors, zero failed requests
 *    · x-vesk-data requests fire exactly for data routes (200) / the
 *      data-error route (500) and for nothing else
 *
 * Expected-intentional errors per route are declared with `expectErrors`
 * (pageerror substrings) / `expectConsole` (console error substrings).
 * Error pages that deliberately render a stack trace (error boundary)
 * declare `leakTolerance` so the crawl reports the stack as tolerated instead
 * of failing — anything NOT covered still fails.
 *
 * Usage: node crawl.mjs        (server on BASE, default http://localhost:3000)
 * Env:    BASE=..., CHROMIUM_PATH=...
 */
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROMIUM_CANDIDATES = [
  '/data/data/com.termux/files/usr/bin/chromium-browser',
  '/usr/sbin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || CHROMIUM_CANDIDATES.find(p => existsSync(p));
if (!CHROMIUM_PATH) {
  console.error('no chromium found; set CHROMIUM_PATH to a Chromium executable');
  process.exit(1);
}
const BASE = process.env.BASE || 'http://localhost:3000';
// Tests run against both the dev server (Test job) and the prod server
// (Production job, where VESK_TEST_TARGET=production). Prod intentionally
// sanitizes server-rendered error messages, so error-message expectations
// must branch on the target.
const IS_PROD = process.env.VESK_TEST_TARGET === 'production';
const HYDRATION_DEADLINE = 5000;

// expectStatus:   HTTP status the route must return.
// expectErrors:   pageerror message substrings that are intentional.
// expectConsole:  console `error` message substrings that are intentional.
// isData:         route embeds an ssr-data.js script (must appear exactly once).
// leakTolerance:  error-boundary page that deliberately renders a stack trace;
//                 matching content is reported as tolerated, not failed.
const ROUTES = [
  // '/' is a data route: Home demos `useFetch(..., { into })` with the posts
  // resource, so it embeds exactly one ssr-data script like /async and /posts.
  { route: '/', isData: true },
  { route: '/about' },
  { route: '/blog' },
  { route: '/blog/hello-world' },
  { route: '/blog/ssr-in-vesk' },
  { route: '/async', isData: true },
  { route: '/comp-test' },
  { route: '/actions' },
  { route: '/posts', isData: true },
  { route: '/empty' },
  { route: '/map' },
  { route: '/statements' },
  { route: '/broken', expectErrors: ['BrokenComp exploded'] },
  { route: '/store' },
  { route: '/store/widget' },
  { route: '/typed' },
  { route: '/store/missing', expectStatus: 404, ssrRefs: 1 },
  {
    route: '/store/boom',
    expectStatus: 500,
    expectErrors: ['Store exploded'],
    // externalDataScript is always used (dev + prod) -> one origin-served
    // ssr-data.js reference in the document.
    ssrRefs: 1,
    // The store error boundary intentionally renders err.stack; report the
    // stack but don't fail. Any other stack/absolute path still fails.
    leakTolerance: true,
  },
  {
    route: '/dataerror',
    expectStatus: 500,
    expectErrors: ['Data layer unavailable during SSR'],
    // externalDataScript is always used (dev + prod) -> one origin-served
    // ssr-data.js reference in the document.
    ssrRefs: 1,
    // Same error-boundary stack display as /store/boom.
    leakTolerance: true,
  },
  { route: '/does-not-exist', expectStatus: 404, ssrRefs: 1 },
];

// Phase B: SPA-navigation content marker per route.
const SPA_TEXT = {
  '/': 'Welcome to Vesk',
  '/about': 'About Vesk',
  '/blog': 'Blog',
  '/blog/hello-world': 'Back to blog',
  '/async': 'Async Demo',
  '/comp-test': 'Component import test',
  '/actions': 'Server actions',
  '/posts': 'Posts',
  '/empty': 'Empty-',
  '/map': 'Inline .map() Demo',
  '/statements': 'JS Statement Demo',
  '/broken': 'BrokenComp exploded',
  '/store': 'Store',
  '/store/widget': 'Item: widget',
  '/typed': 'Total likes',
  '/dataerror': IS_PROD ? 'Data Error Demo' : 'Data layer unavailable during SSR',
};

// Per-route x-vesk-data expectations during SPA navigation: { count, status }.
// The router fetches SSR props via X-Vesk-Data for EVERY SPA navigation; a
// data-error route returns 500 with an `{ error }` payload.
const SPA_XVESK_DEFAULT = { count: 1, status: 200 };
const SPA_XVESK = {
  '/dataerror': { count: 1, status: 500 },
};

// Wire every signal a page can emit into a capture object.
function newCapture(page) {
  const cap = {
    pageerrors: [],   // { message, stack }
    console: [],      // { type, text }
    requestfailed: [],// { url, error }
    badResponses: [], // { url, status } — resources answered >= 400
    xvesk: [],        // { url, status } — requests with X-Vesk-Data: 1
    xveskPending: new Set(),
    ssrData: [],      // Response objects for ssr-data.js (body read via CDP)
  };
  page.on('pageerror', err => cap.pageerrors.push({ message: err.message, stack: err.stack || '' }));
  page.on('console', msg => cap.console.push({ type: msg.type(), text: msg.text() }));
  page.on('requestfailed', req => cap.requestfailed.push({ url: req.url(), error: (req.failure() || {}).errorText || 'unknown' }));
  page.on('request', req => {
    if (req.headers()['x-vesk-data'] === '1') cap.xveskPending.add(req.url());
  });
  page.on('response', resp => {
    const url = resp.url();
    if (resp.status() >= 400) cap.badResponses.push({ url, status: resp.status() });
    if (url.includes('ssr-data.js')) cap.ssrData.push(resp);
    if (cap.xveskPending.has(url)) {
      // The request event reports request headers reliably; the response's
      // req.headers() can drop custom headers (CDP ExtraInfo fidelity), so
      // detect the header on the request and take the status from the response.
      cap.xveskPending.delete(url);
      cap.xvesk.push({ url, status: resp.status() });
    }
  });
  return cap;
}

// Wait until every `vsk` hydration marker has been claimed, or deadline.
async function measureHydration(page) {
  return page.evaluate((deadline) => {
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
    while (performance.now() - t0 < deadline) {
      if (countMarkers() === 0) return Math.round(performance.now() - t0);
    }
    return -1;
  }, HYDRATION_DEADLINE);
}

function matchAny(list, substrings) {
  return list.some(s => substrings.some(sub => s.includes(sub)));
}

// Analyze a route's SSR document for data/error leak signals.
function analyzeDocument(body, entry, docStatus) {
  const leaks = [];
  const refs = (body.match(/ssr-data\.js/g) || []).length;
  const wantRefs = entry.ssrRefs ?? (entry.isData ? 1 : 0);
  if (refs !== wantRefs) {
    leaks.push(`ssr-data refs = ${refs} (expected ${wantRefs})`);
  }
  const stackLike = /(?:^|\n)\s+at\s+(?:file:|[A-Za-z]:[\\/]|node:internal|\/|eval)/m.test(body);
  const absPath = body.includes('file:///') || body.includes('/root/') ||
    body.includes('/home/') || body.includes('/usr/') || body.includes('node:internal');
  if (stackLike || absPath) {
    const tolerated = docStatus >= 400 && entry.leakTolerance;
    leaks.push((stackLike ? 'stack trace in document' : '') +
      (stackLike && absPath ? ' + ' : '') +
      (absPath ? 'absolute path in document' : '') +
      (tolerated ? ' (tolerated: error boundary renders stack)' : ''));
  }
  return { leaks, fail: leaks.some(l => !l.includes('(tolerated)')) };
}

// Validate an ssr-data.js payload as delivered to the browser: must be a real
// `globalThis.__vsk_ssr_data = {...}` JSON payload whose values are data, not
// error/HTML leakage.
function analyzeSsrDataPayload(payloadText, route) {
  if (!payloadText.startsWith('globalThis.__vsk_ssr_data = ')) {
    return route + ' ssr-data payload is not a __vsk_ssr_data assignment: ' + payloadText.slice(0, 60);
  }
  const json = payloadText.slice('globalThis.__vsk_ssr_data = '.length).trim();
  let parsed;
  try {
    parsed = JSON.parse(json.replace(/;$/, ''));
  } catch {
    return route + ' ssr-data payload is not valid JSON';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return route + ' ssr-data payload is not an object';
  }
  if (Object.keys(parsed).length === 0) return route + ' ssr-data payload is empty';
  const serialized = JSON.stringify(parsed);
  if (/node:internal|^\s*at\s+(?:file:|[A-Za-z]:[\\/])/m.test(serialized) || /<(!DOCTYPE|html)/i.test(serialized)) {
    return route + ' ssr-data payload contains error/HTML leakage';
  }
  return null;
}

async function measureSSR(route) {
  const url = BASE + route;
  try {
    const out = execSync(`curl -s --max-time 10 -o /dev/null -w '%{time_starttransfer}\\t%{time_total}\\t%{http_code}\\t%{size_download}' '${url}'`, { encoding: 'utf8' });
    const [ttfb, total, code, bytes] = out.trim().split('\t');
    return { route, ttfb: (+ttfb * 1000).toFixed(0), total: (+total * 1000).toFixed(0), code, bytes };
  } catch {
    return { route, ttfb: 'ERR', total: 'ERR', code: '-', bytes: '-' };
  }
}

let browser;
let passed = 0;
let failed = 0;
const failures = [];

function verdict(name, ok, detail) {
  if (ok) passed++;
  else { failed++; failures.push(detail || name); }
  return ok;
}

async function fullLoad(entry) {
  const { route, expectStatus = 200, expectErrors = [], expectConsole = [] } = entry;
  const page = await browser.newPage();
  const cap = newCapture(page);
  let docStatus = 0;
  let docUrl = '';
  let ctype = '';
  let body = '';
  let hydrationMs = -1;
  let loadError = '';

  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 20000 });
    if (!resp) {
      loadError = 'NO RESPONSE';
    } else {
      docStatus = resp.status();
      docUrl = resp.url();
      ctype = resp.headers()['content-type'] || '';
      body = await resp.text().catch(() => '');
    }
    // Only pages that load client.js hydrate (404/error-simple pages render
    // static SSR without a bundle); those have no hydration to wait for.
    if (!loadError && body.includes('_vesk/static/client.js')) {
      hydrationMs = await measureHydration(page);
    } else if (!loadError) {
      hydrationMs = 'n/a';
    }
  } catch (e) {
    loadError = (e.message || e).slice(0, 100);
  }

  const problems = [];
  if (loadError) problems.push('load: ' + loadError);
  if (!loadError && docStatus !== expectStatus) problems.push(`HTTP ${docStatus} (expected ${expectStatus})`);
  if (ctype && !ctype.includes('text/html')) problems.push(`content-type ${ctype} (expected text/html)`);
  if (hydrationMs === -1 && !loadError) problems.push('hydration did not complete within ' + HYDRATION_DEADLINE + 'ms');

  const unexpectedErrors = cap.pageerrors.filter(e => !matchAny([e.message], expectErrors));
  if (unexpectedErrors.length) problems.push(unexpectedErrors.length + ' unexpected page error(s): ' +
    unexpectedErrors.slice(0, 3).map(e => e.message).join(' | '));

  // "Failed to load resource" console errors are purely informational — the
  // underlying cause is already captured precisely via `badResponses`
  // (status/URL) and `requestfailed`. Filtering them here keeps real console
  // errors (exceptions, CSP violations, assertions) loud.
  const realConsole = cap.console.filter(m => m.type === 'error' && !m.text.startsWith('Failed to load resource'));
  const unexpectedConsole = realConsole.filter(m => !matchAny([m.text], expectConsole));
  if (unexpectedConsole.length) problems.push(unexpectedConsole.length + ' console error(s): ' +
    unexpectedConsole.slice(0, 3).map(m => m.text.slice(0, 160)).join(' | '));

  if (cap.requestfailed.length) problems.push(cap.requestfailed.length + ' failed request(s): ' +
    cap.requestfailed.slice(0, 3).map(r => r.url + ' (' + r.error + ')').join(' | '));

  if (cap.xvesk.length) problems.push(cap.xvesk.length + ' x-vesk-data request(s) on initial load (must be 0, data is SSR\'d)');

  const docLeak = analyzeDocument(body, entry, docStatus);
  if (docLeak.fail) problems.push('document leak: ' + docLeak.leaks.join('; '));

  const resourceProblems = cap.badResponses.filter(b => b.url !== docUrl && (b.status >= 500 || /\.(?:js|mjs|css)(?:\?|$)/.test(b.url)));
  if (resourceProblems.length) problems.push('broken resource(s): ' +
    resourceProblems.slice(0, 3).map(b => b.status + ' ' + b.url).join(' | '));

  let ssrPayloadProblem = '';
  if (entry.isData && !loadError) {
    // The payload is one-shot (keyed by `t` and consumed by the browser), so
    // read the body from the observed browser response rather than re-fetching.
    const sr = cap.ssrData.find(r => r.status() === 200);
    if (!sr) ssrPayloadProblem = route + ': no ssr-data.js response observed';
    else ssrPayloadProblem = analyzeSsrDataPayload(await sr.text().catch(() => ''), route) || '';
  }
  if (ssrPayloadProblem) problems.push(ssrPayloadProblem);

  const statusStr = docStatus === expectStatus ? (expectStatus === 200 ? 'OK' : 'HTTP ' + docStatus) : 'HTTP ' + docStatus + '!';
  const row = {
      route, statusStr, hydrationMs,
      pgErr: cap.pageerrors.length,
      cErr: realConsole.length,
      warn: cap.console.filter(m => m.type === 'warning').length,
      reqFail: cap.requestfailed.length,
      xvesk: cap.xvesk.length,
      leak: docLeak.leaks.join('; ') || '-',
      problems,
      cap,
    };
  await page.close();
  return row;
}

async function spaChain() {
  const page = await browser.newPage();
  const cap = newCapture(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 20000 });
  const hasRouter = await page.evaluate(() => typeof (window.__vesk_router || {}).navigate === 'function');
  const rows = [];

  // The entry route ('/') is already loaded; navigating to it would not fire a
  // fetch. Start the chain on the second route.
  const chain = Object.keys(SPA_TEXT).filter(r => r !== '/');

  for (const route of chain) {
    const errBefore = cap.pageerrors.length;
    const consoleBefore = cap.console.length;
    const reqFailBefore = cap.requestfailed.length;
    const problems = [];

    if (!hasRouter) { problems.push('router not available'); rows.push({ route, ok: false, problems }); continue; }

    await page.evaluate((href) => {
      window.__spaFlag = true;
      window.__navError = '';
      try { window.__vesk_router.navigate(href); }
      catch (e) { window.__navError = String(e && e.message || e); }
    }, route);

    const deadline = 15000;
    const t0 = Date.now();
    let reached = false;
    while (Date.now() - t0 < deadline) {
      const cur = await page.evaluate((href) => ({
        path: window.location.pathname,
        text: (document.getElementById('root') || document.body).textContent.replace(/\s+/g, ' '),
      }), route);
      if (cur.path === route && cur.text.includes(SPA_TEXT[route])) { reached = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }
    if (!reached) problems.push('content not rendered: ' + SPA_TEXT[route]);

    const isSpa = await page.evaluate(() => window.__spaFlag === true);
    if (!isSpa) problems.push('full page reload instead of SPA navigation');
    const navError = await page.evaluate(() => window.__navError || '');
    if (navError) problems.push('router.navigate threw: ' + navError);

    const newErrs = cap.pageerrors.slice(errBefore);
    if (newErrs.length) problems.push(newErrs.length + ' page error(s): ' + newErrs.slice(0, 3).map(e => e.message).join(' | '));
    const newConsole = cap.console
      .filter(m => m.type === 'error' && !m.text.startsWith('Failed to load resource'))
      .filter((m, i) => i >= consoleBefore);
    if (newConsole.length) problems.push(newConsole.length + ' console error(s): ' +
      newConsole.slice(0, 3).map(m => m.text.slice(0, 160)).join(' | '));
    const newReqFail = cap.requestfailed.slice(reqFailBefore);
    if (newReqFail.length) problems.push(newReqFail.length + ' failed request(s): ' +
      newReqFail.slice(0, 3).map(r => r.url + ' (' + r.error + ')').join(' | '));

    rows.push({ route, problems });
  }

  // x-vesk-data requests lag behind navigation, so attribute them globally once
  // the chain is done: every visited route must be fetched with the expected
  // status, and every fetch must belong to a visited route (or the entry '/').
  if (hasRouter) {
    // The data-fetch render of slow routes (e.g. /posts, which re-runs a
    // server resource) can take several seconds — longer than the chain loop.
    // Wait for every x-vesk request we saw to be answered before attributing.
    const settleDeadline = Date.now() + 30000;
    while (cap.xveskPending.size > 0 && Date.now() < settleDeadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    const expectedStatus = (r) => (SPA_XVESK[r] || SPA_XVESK_DEFAULT).status;
    const byLength = [...chain].sort((a, b) => b.length - a.length);
    const seen = new Map(); // route -> statuses
    for (const x of cap.xvesk) {
      let match = byLength.find(r => x.url.includes(r));
      if (!match && x.url.includes('/')) match = '/';
      if (!match) { rows.push({ route: '?', ok: false, problems: [`unexpected x-vesk-data ${x.status} ${x.url}`] }); continue; }
      if (!seen.has(match)) seen.set(match, []);
      seen.get(match).push(x.status);
    }
    for (const route of chain) {
      const row = rows.find(r => r.route === route);
      const statuses = seen.get(route) || [];
      if (statuses.length === 0) row.problems.push(`no x-vesk-data request for ${route}`);
      else if (statuses.some(s => s !== expectedStatus(route))) {
        row.problems.push(`x-vesk-data status(es) ${statuses.join(',')} (expected ${expectedStatus(route)})`);
      }
      row.xvesk = statuses.join(',');
      row.ok = row.problems.length === 0;
    }
  }
  await page.close();
  return { rows, hasRouter };
}

async function main() {
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  // ── SSR latency (curl) — informational ──
  console.log('\n=== SSR latency (curl) ===');
  const ssrRows = [];
  for (const entry of ROUTES) ssrRows.push(await measureSSR(entry.route));
  console.log('route'.padEnd(22), 'TTFB(ms)', 'total(ms)', 'http', 'bytes');
  for (const r of ssrRows) {
    console.log(r.route.padEnd(22), String(r.ttfb).padEnd(9), String(r.total).padEnd(9), r.code.padEnd(5), r.bytes);
  }

  // ── Phase A: full loads, capture everything ──
  console.log('\n=== Phase A: fresh full load per route ===');
  console.log('route'.padEnd(22), 'status'.padEnd(9), 'hyd(ms)'.padEnd(8), 'pgErr'.padEnd(6), 'cErr'.padEnd(5), 'warn'.padEnd(5), 'reqFail'.padEnd(8), 'xvesk'.padEnd(6), 'leaks');
  const rows = [];
  for (const entry of ROUTES) {
    const row = await fullLoad(entry);
    rows.push(row);
    const ok = row.problems.length === 0;
    verdict(ok, `Phase A ${row.route}`, `[A] ${row.route}: ${row.problems.join('; ')}`);
    console.log(
      row.route.padEnd(22),
      row.statusStr.padEnd(9),
      String(row.hydrationMs).padEnd(8),
      String(row.pgErr).padEnd(6),
      String(row.cErr).padEnd(5),
      String(row.warn).padEnd(5),
      String(row.reqFail).padEnd(8),
      String(row.xvesk).padEnd(6),
      (ok ? '  \u2713' : '  \u2717 ' + row.problems.join('; ')),
    );
  }

  // ── Phase B: SPA chain, capture everything ──
  console.log('\n=== Phase B: SPA navigation across all routes ===');
  const spa = await spaChain();
  if (!spa.hasRouter) {
    verdict(false, 'SPA router available', '[B] router not available');
    console.log('  \u2717 router (window.__vesk_router.navigate) not available');
  } else {
    console.log('route'.padEnd(22), 'xvesk'.padEnd(6), 'verdict');
    for (const row of spa.rows) {
      verdict(row.ok, `Phase B ${row.route}`, `[B] ${row.route}: ${row.problems.join('; ')}`);
      console.log(row.route.padEnd(22), String(row.xvesk ?? '-').padEnd(6), row.ok ? '  \u2713' : '  \u2717 ' + row.problems.join('; '));
    }
  }

  // ── Full capture report ──
  console.log('\n=== Capture report (everything observed) ===');
  for (const row of rows) {
    const bits = [];
    if (row.cap.pageerrors.length) bits.push('pageerrors: ' + row.cap.pageerrors.map(e => e.message).join(' | '));
    const errs = row.cap.console.filter(m => m.type === 'error' && !m.text.startsWith('Failed to load resource'));
    if (errs.length) bits.push('console.error: ' + errs.map(m => m.text.slice(0, 140)).join(' | '));
    const warns = row.cap.console.filter(m => m.type === 'warning');
    if (warns.length) bits.push('console.warn: ' + warns.map(m => m.text.slice(0, 140)).join(' | '));
    if (row.cap.requestfailed.length) bits.push('requestfailed: ' + row.cap.requestfailed.map(r => r.url + ' (' + r.error + ')').join(' | '));
    const noise = row.cap.badResponses.filter(b => !/\.(?:js|mjs|css)(?:\?|$)/.test(b.url) && b.status < 500);
    if (noise.length) bits.push('non-fatal >=400 resources: ' + noise.map(b => b.status + ' ' + b.url).join(' | '));
    if (row.leak !== '-') bits.push('document leaks: ' + row.leak);
    if (bits.length) {
      console.log(`\n${row.route}:`);
      for (const b of bits) console.log('  · ' + b);
    }
  }

  // ── Summary ──
  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  \u2717 ' + f);
  }
  await browser.close();
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Crawler error:', e); process.exit(1); });
