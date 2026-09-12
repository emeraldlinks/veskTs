/**
 * Route audit: for every page route in the test-app, capture
 *  (1) SSR HTML via plain fetch
 *  (2) hydrated live DOM via headless Chromium (full page load)
 *  (3) SPA-nav live DOM via client-side router.navigate
 * then diff the normalized text/DOM across the three to surface silent
 * breaks that unit tests don't exercise.
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE || 'http://localhost:3000';

const ROUTES = [
  '/', '/about', '/actions', '/apierr', '/async', '/blocknav',
  '/blog', '/blog/hello-world',
  '/broken', '/comp-test', '/dataerror', '/empty',
  '/lobby', '/lobby/deep',
  '/map', '/md', '/md-html', '/posts', '/statements',
  '/store', '/store/widget', '/store/missing', '/store/boom', '/typed',
];

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

async function goto(page, url, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      if (!String(e).includes('Requesting main frame too early') && !String(e).includes('Navigating frame was detached') && !String(e).includes('Attempted to use detached Frame')) throw e;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('goto retried too many times: ' + url);
}

async function readSSR(pathname) {
  const res = await fetch(BASE + pathname);
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
  // Only look at the #root server-rendered block when present
  const rootMatch = html.match(/<div id="root"[\s\S]*?>([\s\S]*?)<\/div>\s*<\/body>/) || [];
  const rootHtml = rootMatch[1] || html;
  // strip tags/scripts for text compare
  const rootText = norm(rootHtml
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' '));
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const h1Text = norm(h1 ? h1.replace(/<[^>]+>/g, ' ') : '');
  return {
    status: res.status,
    title: norm(title),
    h1: h1Text,
    rootText,
    hasRoot: html.includes('id="root"'),
    navCarat: (html.match(/<nav[\s\S]*?<\/nav>/) || [''])[0].length > 0,
    markerCount: (html.match(/<!--vsk(--hold)?-->/g) || []).length,
    error500: html.includes('500') && html.includes('Error') || html.includes('Error 500'),
  };
}

async function readDOM(page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    const scripts = Array.from(document.querySelectorAll('script')).map(s => (s.getAttribute('src') || '').split('/').pop()).filter(Boolean);
    let h1 = '';
    const h1el = document.querySelector('h1');
    if (h1el) h1 = h1el.textContent.replace(/\s+/g, ' ').trim();
    let vsk = 0, hold = 0;
    if (root) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
      while (w.nextNode()) {
        const t = w.currentNode.textContent || '';
        if (t === 'vsk') vsk++;
        else if (t === 'vsk-hold') hold++;
      }
    }
    const pageEl = document.getElementById('root') || document.body;
    return {
      path: location.pathname,
      survived: !!root,
      h1,
      navCarat: !!document.querySelector('nav'),
      bodyText: norm(document.body.textContent),
      rootText: norm(root ? root.textContent : ''),
      leftMarkers: { vsk, hold },
      scripts,
      readyState: document.readyState,
    };
  });
}

async function spaNav(page, pathname) {
  await page.evaluate((p) => {
    const r = window.__vesk_router;
    if (!r || !r.navigate) throw new Error('no router');
    r.navigate(p);
  }, pathname);
  // wait for URL + h1 settle (poll up to 12s)
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 12000) {
    last = await readDOM(page);
    if (last.path === pathname && last.h1 && last.readyState === 'complete') {
      // give a beat for effects to flush
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return last;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let passed = 0, failed = 0;
  const failures = [];

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));

  for (const route of ROUTES) {
    pageErrors.length = 0;
    let entry = { route };

    try {
      // (1) SSR
      entry.ssr = await readSSR(route);

      // (2) Fresh full load in browser
      await goto(page, BASE + route, { waitUntil: 'networkidle0', timeout: 20000 });
      // small settle for hydration async
      await new Promise(r => setTimeout(r, 500));
      entry.hydrated = await readDOM(page);

      // (3) SPA nav — start from / and navigate client-side to keep prior chunks loaded
      await page.evaluate(() => { if (window.__vesk_router) window.__vesk_router.navigate('/'); });
      await new Promise(r => setTimeout(r, 400));
      entry.spa = await spaNav(page, route);
      entry.pageErrors = pageErrors.length;
      entry.pageErrorMsgs = pageErrors.slice(0, 3);
    } catch (e) {
      entry.error = String(e.message || e);
    }

    // -------- disparity analysis --------
    const issues = [];
    const ssr = entry.ssr;
    const hyd = entry.hydrated;
    const spa = entry.spa;
    if (ssr && hyd) {
      if (ssr.h1 && hyd.h1 && ssr.h1 !== hyd.h1) issues.push(`SSR h1 "${ssr.h1}" != hydrated h1 "${hyd.h1}"`);
      if (hyd.survived === false) issues.push('#root did NOT survive');
      if (hyd.leftMarkers && (hyd.leftMarkers.vsk > 0 || hyd.leftMarkers.hold > 0)) issues.push(`leftover markers vsk=${hyd.leftMarkers.vsk} hold=${hyd.leftMarkers.hold}`);
      if (ssr.navCarat !== hyd.navCarat) issues.push(`nav present SSR=${ssr.navCarat} vs client=${hyd.navCarat}`);
      if (ssr.error500) issues.push('SSR emitted error 500 content');
      if (entry.pageErrors > 0) issues.push(`JS errors: ${entry.pageErrorMsgs.join(' | ')}`);
    }
    if (ssr && spa) {
      if (ssr.h1 && spa.h1 && ssr.h1 !== spa.h1 && route !== '/' && route !== '/store/missing') issues.push(`SSR h1 "${ssr.h1}" != SPA h1 "${spa.h1}"`);
      // Both routes with async data legitimately differ; flag only text divergence where h1 same but root differs wildly
      const ssrRoot = ssr.rootText; const spaRoot = spa && spa.rootText;
      if (ssrRoot && spaRoot && !issues.some(i => i.startsWith('JS errors'))) {
        if (spaRoot && (ssrRoot.length === 0 || spaRoot.length === 0)) {
          issues.push(`root text empty: SSR(len ${ssrRoot.length}) vs SPA(len ${spaRoot.length})`);
        } else if (ssrRoot && spaRoot && ssr.h1 === spa.h1) {
          const a = spaRoot.split(' ').filter(Boolean);
          const b = ssrRoot.split(' ').filter(Boolean);
          const missingInSpa = b.filter(w => !a.includes(w));
          if (missingInSpa.length >= 3) issues.push(`SPA missing SSR words (${missingInSpa.slice(0, 5).join(', ')})`);
        }
      }
      if (spa && !spa.h1 && route !== '/') issues.push(`SPA nav rendered no h1 (h1="")`);
    }

    const ok = issues.length === 0 && !entry.error;
    if (ok) passed++;
    else {
      failed++;
      failures.push({ route, issues, entry });
    }

    console.log(`\n===== ${route} =====`);
    if (entry.error) { console.log('  FATAL: ' + entry.error); continue; }
    console.log(`  SSR   [${ssr.status}] h1="${ssr.h1}" title="${ssr.title}" nav=${ssr.navCarat} markers=${ssr.markerCount}`);
    console.log(`  HYDR  h1="${hyd.h1}" nav=${hyd.navCarat} survived=${hyd.survived} left=${hyd.leftMarkers.vsk}/${hyd.leftMarkers.hold} jsErr=${entry.pageErrors}`);
    console.log(`  SPA   h1="${spa && spa.h1}" path=${spa && spa.path} jsErr=${0}`);
    if (issues.length) console.log('  ✗ ' + issues.join('\n    ✗ '));
    else console.log('  ✓ no disparity');
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${ROUTES.length} total \u2550\u2550\u2550`);
  await browser.close();
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Audit error:', e); process.exit(1); });