/**
 * vesk-doc comprehensive route audit
 *
 * For every discoverable route in vesk-doc, performs:
 *   1. Full SSR load   → record timing, styles, DOM, hydration
 *   2. SPA nav (Link)   → record swap mechanism, timing, parity vs SSR
 *   3. Hard reload       → record fresh SSR timing, compare vs SPA result
 *   4. Back nav          → record restoration fidelity
 *
 * Writes NDJSON to /tmp/opencode/veskdoc-audit.jsonl and a human-readable
 * summary to stdout.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, appendFileSync } from 'node:fs';

const CHROMIUM = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE    = process.env.BASE || 'http://localhost:3001';
const OUTFILE = process.env.OUTFILE || '/tmp/opencode/veskdoc-audit.jsonl';
const MAX_ROUTES = Number(process.env.MAX_ROUTES || 35);

// ── helpers ──────────────────────────────────────────────────────────
function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function goto(p, url, opts = {}) {
  for (let i = 0; i < 5; i++) {
    try { return await p.goto(url, { timeout: 25000, ...opts }); }
    catch (e) {
      const m = String(e.message || e);
      if (m.includes('too early') || m.includes('detached') || m.includes('Timeout')) {
        await sleep(250); continue;
      }
      throw e;
    }
  }
  throw new Error('goto retried too many times: ' + url);
}

// ── page assistants ─────────────────────────────────────────────────
const PAGE_INFO = `(() => {
  const nav = performance.getEntriesByType('navigation');
  const last = nav[nav.length - 1] || {};
  return {
    url: location.href,
    pathname: location.pathname,
    h1: (() => { const h = document.querySelector('h1'); return h ? h.textContent.replace(/\\s+/g, ' ').trim() : null; })(),
    rootTextLen: (document.getElementById('root') || {}).textContent ? document.getElementById('root').textContent.replace(/\\s+/g, ' ').trim().length : 0,
    navCount: nav.length,
    navType: last.type || null,
    router: !!window.__vesk_router,
    upLevel: (document.getElementById('root') || {}).childElementCount,
  };
})();
`;
async function pageInfo(p) {
  for (let i = 0; i < 10; i++) {
    try { return await p.evaluate(PAGE_INFO); }
    catch (e) { if (i === 9) throw e; await sleep(150); }
  }
}

// Wait until the destination content is actually present and stable.
// contentChanged: sign() => true once DOM differs from the source page.
async function settle(p, targetPath, opts = {}) {
  const { contentChanged, waitForHydrate = true, timeoutMs = 20000 } = opts;
  const t0 = Date.now();
  let stable = 0;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    let info;
    try { info = await pageInfo(p); } catch (_) { await sleep(150); continue; }
    const urlOk = info.pathname === targetPath;
    const contentOk = !contentChanged || contentChanged(info);
    if (urlOk && contentOk) {
      if (last && last.pathname === info.pathname && last.h1 === info.h1 && last.rootTextLen === info.rootTextLen) {
        stable++;
        if (stable >= 2) {
          if (waitForHydrate) {
            const done = await p.evaluate(`(() => {
              const root = document.getElementById('root');
              if (!root) return false;
              const w = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
              let left = 0;
              while (w.nextNode()) { const t = w.currentNode.textContent; if (t === 'vsk' || t === 'vsk-hold') left++; }
              return left === 0 && document.readyState === 'complete';
            })`).catch(() => false);
            if (done) { last = info; break; }
          } else { last = info; break; }
        }
      } else { stable = 0; }
    }
    last = info;
    await sleep(120);
  }
  return last || await pageInfo(p);
}

// ── snapshot capture (runs inside the page) ──────────────────────────
const SNAPSHOT_SCRIPT = `(() => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const root = document.getElementById('root');
  const body = document.body;

  // performance timing
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const lcpEntry = performance.getEntriesByType('largest-contentful-paint').slice(-1)[0];

  // hydration markers
  let vskCount = 0, holdCount = 0;
  if (root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    while (w.nextNode()) {
      const t = w.currentNode.textContent;
      if (t === 'vsk') vskCount++;
      else if (t === 'vsk-hold') holdCount++;
    }
  }

  // active nav links
  const activeLinks = [];
  document.querySelectorAll('nav a[aria-current], nav a.active, aside a.border-accent').forEach(a => {
    activeLinks.push({ href: a.getAttribute('href'), text: norm(a.textContent) });
  });

  // styles
  const stylesheets = [];
  try {
    for (const sheet of document.styleSheets) {
      stylesheets.push({ href: sheet.href, rules: sheet.cssRules ? sheet.cssRules.length : -1 });
    }
  } catch (_) { stylesheets.push({ error: 'CORS' }); }
  const linkSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.getAttribute('href'));
  const styleTags = document.querySelectorAll('style').length;

  // computed styles of key elements
  const computed = {};
  for (const sel of ['body', 'h1', 'nav', 'aside', 'footer', '#root', 'header']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    computed[sel] = {
      display: cs.display, fontFamily: cs.fontFamily.slice(0, 60),
      color: cs.color, background: cs.backgroundColor,
      fontSize: cs.fontSize, lineHeight: cs.lineHeight, padding: cs.padding,
      width: cs.width, overflow: cs.overflow,
    };
  }

  // DOM stats
  const allElements = body.querySelectorAll('*').length;
  const allImages = document.querySelectorAll('img').length;

  // router state
  const router = window.__vesk_router || null;
  let routerState = null;
  if (router) {
    try {
      routerState = {
        path: router.currentPath || router._path || location.pathname,
        ready: true,
      };
    } catch (_) { routerState = { ready: false }; }
  }

return {
    url: location.href,
    pathname: location.pathname,
    title: document.title,
    description: (document.querySelector('meta[name="description"]') || {}).content || '',
    readyState: document.readyState,

    timing: {
      ttfb: nav.responseStart || 0,
      domInteractive: nav.domInteractive || 0,
      domContentLoaded: nav.domContentLoadedEventEnd || 0,
      loadEvent: nav.loadEventEnd || 0,
      transferSize: nav.transferSize || 0,
      encodedBodySize: nav.encodedBodySize || 0,
      decodedBodySize: nav.decodedBodySize || 0,
      lcpMs: lcpEntry ? lcpEntry.startTime : null,
    },

    hydration: {
      vskMarkers: vskCount,
      holdMarkers: holdCount,
      leftover: vskCount + holdCount,
      routerPresent: !!router,
      routerState,
    },

    styles: {
      styleSheets: stylesheets,
      linkSheets,
      styleTags,
      computed,
    },

    dom: {
      rootExists: !!root,
      rootChildCount: root ? root.children.length : 0,
      rootTextLen: root ? norm(root.textContent).length : 0,
      h1: (() => { const h = document.querySelector('h1'); return h ? norm(h.textContent) : null; })(),
      hasNav: !!document.querySelector('nav'),
      hasAside: !!document.querySelector('aside'),
      hasFooter: !!document.querySelector('footer'),
      hasHeader: !!document.querySelector('header'),
      totalElements: allElements,
      totalImages: allImages,
      activeLinks: activeLinks,
    },

    errors: {
      pageErrors: window.__audit_errors || [],
      consoleErrors: window.__audit_console_errors || [],
    },
  };
})();
`;

// ── install audit listeners + swap observer ───────────────────────────
const INSTALL_SCRIPT = `(() => {
  window.__audit_errors = [];
  window.__audit_console_errors = [];
  window.__audit_swaps = [];
  window.__audit_reqs = [];
  window.__audit_req_fails = [];

  window.addEventListener('error', e => {
    window.__audit_errors.push((e.message || '').slice(0, 200));
  });
  window.addEventListener('unhandledrejection', e => {
    window.__audit_errors.push('unhandled: ' + String(e.reason || '').slice(0, 200));
  });

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] || {}).url || '';
    return origFetch.apply(this, args).catch(e => {
      window.__audit_req_fails.push(url);
      throw e;
    });
  };

  // MutationObserver for swap detection
  window.__audit_swapStart = Date.now();
  window.__audit_mutCount = 0;
  window.__audit_rootReplaced = false;

  const root = document.getElementById('root');
  if (root) {
    const mo = new MutationObserver(muts => {
      window.__audit_mutCount += muts.length;
      for (const m of muts) {
        if (m.type === 'childList' && (m.target.id === 'root' || m.target.parentElement && m.target.parentElement.id === 'root')) {
          // removed all children = wipe
          if (m.removedNodes.length > 0 && m.addedNodes.length > 0) {
            window.__audit_swaps.push({ type: 'patch', removed: m.removedNodes.length, added: m.addedNodes.length, ts: Date.now() - window.__audit_swapStart });
          }
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    window.__audit_mo = mo;
  }
})();
`;

// ── collect links from current DOM ───────────────────────────────────
const LINKS_SCRIPT = `(() => {
  const base = new URL(location.origin);
  const links = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('http')) return;
    try {
      const u = new URL(href, location.origin);
      if (u.origin === location.origin) links.push(u.pathname);
    } catch (_) {}
  });
  return [...new Set(links)];
})();
`;

// ── main audit loop ──────────────────────────────────────────────────
async function main() {
  writeFileSync(OUTFILE, '');

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // collect network + console at browser level
  const netLog = [];
  const consoleLog = [];
  page.on('response', async resp => {
    const req = resp.request();
    const url = req.url();
    if (url.includes('chrome-extension://') || url.startsWith('data:')) return;
    let size = 0;
    try { size = (await resp.buffer()).length; } catch (_) {}
    netLog.push({
      url: url.replace(BASE, ''),
      status: resp.status(),
      type: req.resourceType(),
      size,
      fromDiskCache: resp.fromCache(),
    });
  });
  page.on('console', msg => {
    consoleLog.push({ type: msg.type(), text: (msg.text() || '').slice(0, 300) });
  });
  page.on('pageerror', err => {
    consoleLog.push({ type: 'pageerror', text: String(err).slice(0, 300) });
  });

  const results = [];
  const visited = new Set();
  const queue = ['/'];
  const allRoutes = [];

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  VESK-DOC COMPREHENSIVE ROUTE AUDIT`);
  console.log(`  ${BASE}  ·  max ${MAX_ROUTES} routes`);
  console.log(`${'═'.repeat(70)}\n`);

  while (queue.length > 0 && allRoutes.length < MAX_ROUTES) {
    const route = queue.shift();
    if (visited.has(route)) continue;
    visited.add(route);

    allRoutes.push(route);

    console.log(`\n┌─ [${allRoutes.length}/${MAX_ROUTES}] ${route}`);

    const entry = { route, snapshots: {}, network: {}, errors: [], discovered: [] };

    // ── 1. Full SSR load ──────────────────────────────────────────
    console.log('│  ① Full SSR load...');
    netLog.length = 0;
    consoleLog.length = 0;
    await page.evaluate(INSTALL_SCRIPT);

    const ssrStart = Date.now();
    try {
      await goto(page, BASE + route, { waitUntil: 'load' });
    } catch (e) {
      entry.ssrError = String(e.message || e).slice(0, 200);
      console.log(`│  ✗ SSR load failed: ${entry.ssrError}`);
      results.push(entry);
      const out = JSON.stringify(entry) + '\n';
      appendFileSync(OUTFILE, out);
      continue;
    }
    // settle until hydration completes (markers cleared + router present)
    await settle(page, route, { contentChanged: () => true, waitForHydrate: true, timeoutMs: 20000 });
    const ssrDuration = Date.now() - ssrStart;

    const ssrSnapshot = await page.evaluate(SNAPSHOT_SCRIPT);
    ssrSnapshot._meta = { phase: 'ssr', durationMs: ssrDuration, ts: Date.now() };
    ssrSnapshot._netLog = netLog.slice();
    ssrSnapshot._consoleLog = consoleLog.slice();
    entry.snapshots.ssr = ssrSnapshot;

    const ssrLinks = await page.evaluate(LINKS_SCRIPT);
    entry.discovered = ssrLinks.filter(l => !visited.has(l));

    console.log(`│  SSR: ttfb=${ssrSnapshot.timing.ttfb}ms  load=${ssrSnapshot.timing.loadEvent}ms  lcp=${ssrSnapshot.timing.lcpMs}ms  markers=${ssrSnapshot.hydration.leftover}  h1="${ssrSnapshot.dom.h1}"`);
    console.log(`│        sheets=${ssrSnapshot.styles.linkSheets.length}+${ssrSnapshot.styles.styleTags}style  elements=${ssrSnapshot.dom.totalElements}  img=${ssrSnapshot.dom.totalImages}`);

    // ── 2. SPA nav via Link click ────────────────────────────────
    console.log('│  ② SPA nav (click Link)...');
    const nextRoute = entry.discovered.length > 0 ? entry.discovered[0] : null;

    if (nextRoute) {
      entry.spaTarget = nextRoute;
      netLog.length = 0;
      consoleLog.length = 0;
      await page.evaluate(INSTALL_SCRIPT);

      const linkSelector = `a[href="${nextRoute}"]`;
      try {
        await page.waitForSelector(linkSelector, { timeout: 5000 });
        const preInfo = await pageInfo(page);
        const spaStart = Date.now();
        await page.click(linkSelector);

        // Classify the navigation kind:
        //  - navCount stays same + content changes  -> client-side swap
        //  - navCount increments                    -> full server round-trip
        let navKind = 'unknown';
        let info = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
          try { info = await pageInfo(page); } catch (_) { await sleep(150); continue; }
          if (info.navCount > preInfo.navCount) { navKind = 'full-reload'; break; }
          if (info.pathname === nextRoute && info.h1 && info.h1 !== preInfo.h1) { navKind = 'client'; break; }
          if (info.pathname === nextRoute && info.rootTextLen !== preInfo.rootTextLen && info.rootTextLen > 0) { navKind = 'client'; break; }
          await sleep(120);
        }
        entry.navKind = navKind;

        // Settle until the destination content is present + hydrated
        const changed = i => i.pathname === nextRoute && (i.h1 !== preInfo.h1 || i.rootTextLen !== preInfo.rootTextLen);
        info = await settle(page, nextRoute, { contentChanged: changed, waitForHydrate: true, timeoutMs: 20000 });

        const spaSnap = await page.evaluate(SNAPSHOT_SCRIPT);
        const { navCount } = await pageInfo(page);
        spaSnap._meta = { phase: 'spa', durationMs: Date.now() - spaStart, navKind, navCount, ts: Date.now() };
        spaSnap._swapData = await page.evaluate(`({
          mutCount: window.__audit_mutCount ?? -1,
          swaps: (window.__audit_swaps || []),
          rootReplaced: !!window.__audit_rootReplaced,
        })`);
        spaSnap._netLog = netLog.slice();
        spaSnap._consoleLog = consoleLog.slice();
        entry.snapshots.spa = spaSnap;

        console.log(`│  SPA${navKind === 'client' ? ' (client-side)' : navKind === 'full-reload' ? ' (FULL RELOAD!)' : ''}: ttfb=${spaSnap.timing.ttfb}ms  markers=${spaSnap.hydration.leftover}  muts=${spaSnap._swapData.mutCount}  h1="${spaSnap.dom.h1}"`);
      } catch (e) {
        entry.spaError = String(e.message || e).slice(0, 200);
        console.log(`│  ✗ SPA click failed: ${entry.spaError}`);
        await page.goto(BASE + nextRoute, { waitUntil: 'load' });
      }

      // ── 3. Hard reload of SPA destination ─────────────────────
      console.log('│  ③ Hard reload...');
      netLog.length = 0;
      consoleLog.length = 0;
      await page.evaluate(INSTALL_SCRIPT);

      try {
        const reloadStart = Date.now();
        await page.reload({ waitUntil: 'load', timeout: 25000 });
        // settle until content present + hydrated; URL is already nextRoute
        await settle(page, nextRoute, { contentChanged: () => true, waitForHydrate: true, timeoutMs: 20000 });

        const reloadSnap = await page.evaluate(SNAPSHOT_SCRIPT);
        const { navCount: reloadNavCount } = await pageInfo(page);
        reloadSnap._meta = { phase: 'reload', durationMs: Date.now() - reloadStart, navCount: reloadNavCount, ts: Date.now() };
        reloadSnap._netLog = netLog.slice();
        reloadSnap._consoleLog = consoleLog.slice();
        entry.snapshots.reload = reloadSnap;

        console.log(`│  RELOAD: ttfb=${reloadSnap.timing.ttfb}ms  markers=${reloadSnap.hydration.leftover}  h1="${reloadSnap.dom.h1}"`);
      } catch (e) {
        entry.reloadError = String(e.message || e).slice(0, 200);
        console.log(`│  ✗ Reload failed: ${entry.reloadError}`);
      }

      // ── 4. Back nav ───────────────────────────────────────────
      console.log('│  ④ Back nav...');
      netLog.length = 0;
      consoleLog.length = 0;
      await page.evaluate(INSTALL_SCRIPT);

      try {
        const backStart = Date.now();
        // Use history.back() via evaluate (same as browser back button). This
        // restores content via the client-side router; page.goBack() after a
        // reload() lands on the wrong history entry.
        await page.evaluate(`(() => history.back())()`);
        // settle until the original route content is present + hydrated
        const backChanged = i => i.pathname === route && i.rootTextLen > 0;
        await settle(page, route, { contentChanged: backChanged, waitForHydrate: true, timeoutMs: 20000 });

        const backSnap = await page.evaluate(SNAPSHOT_SCRIPT);
        const { navCount: backNavCount } = await pageInfo(page);
        backSnap._meta = { phase: 'back', durationMs: Date.now() - backStart, navCount: backNavCount, ts: Date.now() };
        backSnap._netLog = netLog.slice();
        backSnap._consoleLog = consoleLog.slice();
        entry.snapshots.back = backSnap;

        console.log(`│  BACK: pathname=${backSnap.pathname}  h1="${backSnap.dom.h1}"  markers=${backSnap.hydration.leftover}`);
      } catch (e) {
        entry.backError = String(e.message || e).slice(0, 200);
        console.log(`│  ✗ Back nav failed: ${entry.backError}`);
        try { await goto(page, BASE + route, { waitUntil: 'load' }); } catch (_) {}
      }

      // ── 5. Disparity ──────────────────────────────────────────
      const issues = [];
      const spa = entry.snapshots.spa;
      const reload = entry.snapshots.reload;
      const back = entry.snapshots.back;

      // Only compare SPA vs RELOAD for actual client-side navs; a full-reload
      // nav means SPA phase already produced a server-rendered document.
      if (spa && reload) {
        if (reload.hydration.leftover > 0) issues.push(`RELOAD leftover markers: ${reload.hydration.leftover}`);

        if (entry.navKind === 'client') {
          if (spa.dom.h1 && reload.dom.h1 && spa.dom.h1 !== reload.dom.h1) issues.push(`SPA h1 "${spa.dom.h1}" vs RELOAD h1 "${reload.dom.h1}"`);
          if (spa.dom.rootTextLen && reload.dom.rootTextLen) {
            const ratio = Math.abs(spa.dom.rootTextLen - reload.dom.rootTextLen) / Math.max(spa.dom.rootTextLen, reload.dom.rootTextLen);
            if (ratio > 0.3) issues.push(`SPA text len ${spa.dom.rootTextLen} vs RELOAD ${reload.dom.rootTextLen} (${(ratio*100).toFixed(0)}% diff)`);
          }
          if (spa.hydration.leftover > 0) issues.push(`SPA leftover markers: ${spa.hydration.leftover}`);
          if (spa.hydration.vskMarkers > 0) issues.push(`SPA unclaimed vsk markers: ${spa.hydration.vskMarkers}`);

          // style parity
          const spaSheets = spa.styles.linkSheets.join(',');
          const reloadSheets = reload.styles.linkSheets.join(',');
          if (spaSheets !== reloadSheets) issues.push(`Sheets differ: SPA [${spaSheets}] vs RELOAD [${reloadSheets}]`);

          // computed style parity for h1
          const spaH1 = spa.styles.computed['h1'];
          const reloadH1 = reload.styles.computed['h1'];
          if (spaH1 && reloadH1) {
            for (const p of ['color', 'fontSize', 'fontFamily']) {
              if (spaH1[p] !== reloadH1[p]) issues.push(`h1 ${p}: SPA="${spaH1[p]}" vs RELOAD="${reloadH1[p]}"`);
            }
          }

          // active link parity
          const spaActive = JSON.stringify(spa.dom.activeLinks);
          const reloadActive = JSON.stringify(reload.dom.activeLinks);
          if (spaActive !== reloadActive) issues.push(`Active links differ: SPA vs RELOAD`);
        } else if (entry.navKind === 'full-reload') {
          // The Link click performed a full server navigation instead of a
          // client-side swap — a silent SPA wiring break worth flagging.
          issues.push(`Link click triggered FULL PAGE RELOAD (no client-side swap)`);
        }
      } else if (!spa && entry.spaTarget) {
        issues.push('SPA nav produced no snapshot');
      }

      if (back) {
        if (back.pathname !== route) issues.push(`Back restored ${back.pathname}, expected ${route}`);
        if (back.dom.h1 && entry.snapshots.ssr && entry.snapshots.ssr.dom.h1 && back.dom.h1 !== entry.snapshots.ssr.dom.h1) {
          issues.push(`Back h1 "${back.dom.h1}" vs original SSR h1 "${entry.snapshots.ssr.dom.h1}"`);
        }
      }

      if (back) {
        if (back.pathname !== route) issues.push(`Back restored ${back.pathname}, expected ${route}`);
        if (back.dom.h1 && entry.snapshots.ssr && entry.snapshots.ssr.dom.h1 && back.dom.h1 !== entry.snapshots.ssr.dom.h1) {
          issues.push(`Back h1 "${back.dom.h1}" vs original SSR h1 "${entry.snapshots.ssr.dom.h1}"`);
        }
      }

      // JS errors
      for (const phase of ['spa', 'reload', 'back']) {
        const snap = entry.snapshots[phase];
        if (snap && snap._consoleLog) {
          const errs = snap._consoleLog.filter(c => c.type === 'error' || c.type === 'pageerror');
          if (errs.length > 0) issues.push(`${phase.toUpperCase()} JS errors: ${errs.map(e => e.text.slice(0, 80)).join(' | ')}`);
        }
      }

      entry.issues = issues;
      const status = issues.length === 0 ? '✓' : `✗ ${issues.length} issues`;
      console.log(`│  ${status}`);
      if (issues.length > 0) issues.forEach(i => console.log(`│    · ${i}`));
    } else {
      console.log('│  (no outbound links discovered, skipping SPA/reload/back)');
    }

    console.log(`└─ done`);

    // enqueue newly discovered links
    for (const link of entry.discovered) {
      if (!visited.has(link)) queue.push(link);
    }

    results.push(entry);
    writeFileSync(OUTFILE, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SUMMARY: ${allRoutes.length} routes audited`);
  console.log(`${'═'.repeat(70)}\n`);

  let totalIssues = 0;
  for (const entry of results) {
    const issues = entry.issues || [];
    const icon = issues.length === 0 ? '✓' : '✗';
    const ssr = entry.snapshots.ssr || {};
    const ttfb = ssr.timing?.ttfb ?? '?';
    const markers = ssr.hydration?.leftover ?? '?';
    const lcp = ssr.timing?.lcpMs ?? '?';

    console.log(`${icon} ${entry.route.padEnd(30)} ttfb=${String(ttfb).padEnd(5)} lcp=${String(lcp).padEnd(6)} markers=${markers} nav=${String(entry.navKind || '-').padEnd(6)} issues=${issues.length}`);
    if (issues.length > 0) totalIssues += issues.length;
  }

  console.log(`\n  Total issues: ${totalIssues}`);

  // ── Write summary report ─────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    routes: results.map(r => ({
      route: r.route,
      ssr: r.snapshots.ssr ? {
        ttfb: r.snapshots.ssr.timing.ttfb,
        load: r.snapshots?.ssr?.timing?.loadEvent,
        lcp: r.snapshots.ssr.timing.lcpMs,
        markers: r.snapshots.ssr.hydration.leftover,
        sheets: r.snapshots.ssr.styles.linkSheets.length,
        elements: r.snapshots.ssr.dom.totalElements,
        h1: r.snapshots.ssr.dom.h1,
      } : null,
      spa: r.snapshots.spa ? {
        markers: r.snapshots.spa.hydration.leftover,
        muts: r.snapshots.spa._swapData?.mutCount,
        h1: r.snapshots.spa.dom.h1,
      } : null,
      issues: r.issues || [],
    })),
  };
  writeFileSync(OUTFILE.replace('.jsonl', '-summary.json'), JSON.stringify(report, null, 2));

  console.log(`\n  Records: ${OUTFILE}`);
  console.log(`  Summary: ${OUTFILE.replace('.jsonl', '-summary.json')}\n`);

  await browser.close();
  if (totalIssues > 0) process.exit(1);
}

main().catch(e => { console.error('Audit error:', e); process.exit(1); });