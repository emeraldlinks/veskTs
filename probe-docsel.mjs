/**
 * probe-docsel.mjs — for every /docs slug: full reload, then verify the mobile
 * menu button keeps its icon inside the button after toggle AND every copy
 * button keeps its lucide-copy icon inside after a click. Several reloads per
 * page to catch "sometimes".
 * Usage: CHROMIUM_PATH=... BASE=http://localhost:4000 node probe-docsel.mjs [reloads_per_page]
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/tmp/opencode/chrome/chrome-headless-shell/linux-154.0.8037.57/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://localhost:4000';
const RELOADS = Number(process.argv[2] || 3);

const SLUGS = [
  'getting-started', 'data-fetching', 'role-players', 'reactivity', 'forms',
  'api-routes', 'isr', 'routing', 'components', 'statement-mode',
  'expression-mode', 'markdown', 'styles', 'track-declarations', 'network',
  'middleware', 'server-apis', 'cli', 'pipeline', 'client-boundary',
  'static-codegen', 'ir-format', 'native', 'not-in-the-grammar',
];

const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkMenu(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('header button[aria-label]');
    if (!btn) return { present: false };
    const svg = btn.querySelector('svg');
    const before = { svgInBtn: !!svg, svgs: btn.querySelectorAll('svg').length };
    btn.click();
    return { present: true, before };
  });
}

async function checkCopy(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || ''));
    if (btns.length === 0) return { count: 0 };
    const state = (b) => ({ svgInBtn: !!b.querySelector('svg'), svgs: b.querySelectorAll('svg').length });
    const pre = btns.map(state);
    const first = btns[0];
    first.click();
    // the click callback swaps the icon; wait handled outside
    return { count: btns.length, pre, selectorA: first.getAttribute('aria-label') };
  });
}

let fails = [];
console.log(`[probe-docsel] BASE=${BASE} reloads/page=${RELOADS}`);
for (const slug of SLUGS) {
  const url = `${BASE}/docs/${slug}`;
  for (let r = 0; r < RELOADS; r++) {
    const page = await browser.newPage();
    page.setDefaultTimeout(25000);
    const errs = [];
    const cons = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text()); });
    await page.setViewport({ width: 800, height: 900 });
    try { await page.goto(url, { waitUntil: 'networkidle2' }); } catch (e) { console.log(`  LOAD-FAIL ${slug} r${r}: ${e.shortMessage || e.message}`); await page.close(); continue; }
    await sleep(800);

    const m = await checkMenu(page);
    await sleep(400);
    const mAfter = m.present
      ? await page.evaluate(() => {
          const btn = document.querySelector('header button[aria-label]');
          const svg = btn && btn.querySelector('svg');
          const menuOpen = !!document.querySelector('div.sticky.top-\\[56px\\]') || /Close documentation menu/.test(btn?.getAttribute('aria-label') || '');
          return { btnStillThere: !!btn, svgInBtn: !!svg, svgs: btn ? btn.querySelectorAll('svg').length : -1, menuOpen };
        })
      : null;

    const copy = await checkCopy(page);
    await sleep(500);
    const copyAfter = copy.count > 0
      ? await page.evaluate((/*state*/) => {
          const btns = Array.from(document.querySelectorAll('button')).filter((b) => /copy/i.test(b.getAttribute('aria-label') || ''));
          const first = btns[0];
          return { count: btns.length, svgInBtn: first ? !!first.querySelector('svg') : null, svgs: first ? first.querySelectorAll('svg').length : -1 };
        })
      : null;

    const title = await page.title().catch(() => '?');
    const problems = [];
    if (m.present && !mAfter.btnStillThere) problems.push(`menu button GONE`);
    if (m.present && mAfter.btnStillThere && (!mAfter.svgInBtn || mAfter.svgs !== 1)) problems.push(`menu icon outside/multi: ${JSON.stringify(mAfter)}`);
    if (copy.count > 0 && !(copyAfter.svgInBtn && copyAfter.svgs === 1 && copyAfter.count >= copy.count - 1)) problems.push(`copy icon outside/multi: ${JSON.stringify(copyAfter)}`);

    const badCons = cons.filter((t) => !/favicon|Failed to load resource.*404/.test(t));
    if (problems.length || errs.length || badCons.length) {
      fails.push({ slug, r, url, problems, errs: errs.slice(0, 3), cons: badCons.slice(0, 3), title });
      console.log(`  !! ${slug} r${r} ${problems.join(' | ')} errs=${errs.length} cons=${badCons.length}`);
    }
    await page.close();
  }
  console.log(`done ${slug}`);
}
await browser.close();
console.log(`\n=== FAILURES: ${fails.length} ===`);
for (const f of fails) console.log(JSON.stringify(f).slice(0, 600));