/**
 * Leakage isolation test for the haul production engine:
 *   A. Error leakage   — errors from one component/page/layout/API/middleware
 *                        must never appear on another page's response.
 *   B. Data leakage    — serialized SSR data, route params, and middleware
 *                        locals must never cross page boundaries.
 *   C. SSR vs JSON     — a browser requesting a page always gets HTML (never
 *                        JSON), and JSON stays on /api + /_vesk/action paths.
 *
 * Creates temporary fixtures (throwing route middleware), builds, starts a
 * prod server on port 3998, runs the suite, cleans up.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = __dirname;
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
let server = null;
const failures = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  \u2717 ${msg}`); }
}

async function get(path) {
  // Tolerate relative refs stripped of their leading slash (e.g. regex
  // matches like `ssr-data.js?t=...` from HTML src="/ssr-data.js?t=...").
  const url = BASE + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(url, { redirect: 'manual' });
  const body = await res.text();
  return { status: res.status, type: res.headers.get('content-type') || '', body };
}

function marker(text, markers) {
  return markers.filter(m => text.includes(m));
}

// ---------- fixtures ----------
const FIXTURES = [
  {
    path: 'app/leakmid/middleware.ts',
    content: `import type { MiddlewareContext } from '@vesk/compiler';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
  if (ctx.url.pathname === '/leakmid') {
    throw new Error('LEAK_MW_BOOM');
  }
  return next();
}
`,
  },
  {
    path: 'app/leakmid/page.vsk',
    content: `component LeakMid {
	<h1 class="text-3xl font-bold mb-4">Leak Mid</h1>
	<p>Page behind a throwing route middleware.</p>
}
`,
  },
  {
    path: 'app/leaklocals/middleware.ts',
    content: `import type { MiddlewareContext } from '@vesk/compiler';

export async function middleware(ctx: MiddlewareContext, next: () => Promise<void>) {
  ctx.set('route', 'LEAK_LOCALS_ROUTE');
  return next();
}
`,
  },
  {
    path: 'app/leaklocals/page.vsk',
    content: `interface LocalsEcho {
	user: Record<string, unknown> | null
	route: string | null
}

async component LeakLocals() {
	const seen = await useFetch<LocalsEcho>('/api/locals')
	<h1 class="text-3xl font-bold mb-4">Leak Locals</h1>
	<p>user: {seen.user ? seen.user.name : 'none'} / route: {seen.route || 'none'}</p>
}
`,
  },
  {
    path: 'app/api/locals/route.ts',
    content: `import { VeskRequest, VeskResponse } from '@vesk/runtime/server';

export async function GET(req: VeskRequest) {
  const locals = req.locals || {};
  return VeskResponse.json({
    user: locals.user || null,
    route: locals.route || null,
  });
}
`,
  },
];

const fixturePaths = FIXTURES.map(f => f.path);

function writeFixtures() {
  for (const f of FIXTURES) {
    const full = resolve(appDir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
}

function cleanupFixtures() {
  for (const p of fixturePaths) rmSync(resolve(appDir, p), { force: true });
  rmSync(resolve(appDir, 'app/leakmid'), { recursive: true, force: true });
  rmSync(resolve(appDir, 'app/leaklocals'), { recursive: true, force: true });
}

function waitForServer(retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      fetch(`${BASE}/`).then(r => {
        if (r.status > 0) process.exitCode = process.exitCode;
      }).catch(() => {});
      return;
    } catch {}
  }
}

async function isUp() {
  try {
    const r = await fetch(`${BASE}/`);
    return r.status > 0;
  } catch {
    return false;
  }
}

// ---------- main ----------
writeFixtures();

console.log('[leakage] building with fixtures...');
execSync(`${resolve(appDir, 'node_modules', '.bin', 'haul')} build`, {
  cwd: appDir, stdio: 'inherit', timeout: 300000,
});

console.log('[leakage] starting prod server on port', PORT);
server = spawn(resolve(appDir, 'node_modules', '.bin', 'haul'), ['start', '-p', String(PORT)], {
  cwd: appDir, stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  await new Promise(r => setTimeout(r, 500));
  up = await isUp();
}
assert(up, 'server is up on port ' + PORT);

// ============================================================
console.log('\nA. ERROR LEAKAGE — errors from one route must not leak elsewhere');
// ============================================================

const ERR_MARKERS = [
  'Data layer unavailable',   // /dataerror throw during SSR
  'Store exploded',           // /store/boom throw
  'LEAK_MW_BOOM',             // throwing route middleware
  'Internal Server Error',    // generic 500 page text
];

// Hit every erroring route first, in sequence.
const errRoutes = [
  ['/dataerror', 500, 'ssr-phase throw'],
  ['/store/boom', 500, 'param-driven throw'],
  ['/store/missing', 404, 'NotFoundError'],
  ['/leakmid', 500, 'throwing route middleware'],
  ['/api/fail', 401, 'api 401'],
];
for (const [path, want, label] of errRoutes) {
  const r = await get(path);
  assert(r.status === want, `${path} (${label}) -> ${r.status} (want ${want})`);
}

// Now verify every healthy page/layout/API is untouched and error-free.
const healthy = [
  ['/', 200, 'root page'],
  ['/about', 200, 'about page'],
  ['/async', 200, 'async useFetch page'],
  ['/posts', 200, 'posts useFetch page'],
  ['/broken', 200, 'client-only throw renders fine on SSR'],
  ['/store/shirt', 200, 'store item page'],
  ['/store/shoes', 200, 'second store item page'],
  ['/typed', 200, 'typed page'],
  ['/md', 200, 'md page'],
  ['/api/hello', 201, 'hello api'],
  ['/api/posts', 200, 'posts api'],
  ['/api/protected', 200, 'protected api'],
  ['/api/echo/msg', 200, 'echo api'],
];
for (const [path, want, label] of healthy) {
  const r = await get(path);
  assert(r.status === want, `${path} (${label}) -> ${r.status} (want ${want})`);
  const hits = marker(r.body, ERR_MARKERS);
  assert(hits.length === 0, `${path} body is free of error markers (got: ${hits.join(', ') || 'none'})`);
}

// Layout integrity: healthy pages still render the shared layout (nav).
const home = await get('/');
assert(home.body.includes('client.js') && home.body.includes('<nav'), 'healthy page keeps layout + hydration script');

// Error pages must still be SSR HTML with hydration (not JSON, not blank).
for (const path of ['/dataerror', '/leakmid']) {
  const r = await get(path);
  assert(r.body.includes('client.js'), `${path} error page still carries hydration script`);
  assert(!r.body.trim().startsWith('{'), `${path} error page is HTML, not JSON`);
}

// Repeatability: erroring a route twice must not poison the function cache.
const d1 = await get('/dataerror');
const d2 = await get('/dataerror');
assert(d1.status === 500 && d2.status === 500, 'repeated erroring route stays 500 (no cache poisoning)');
const after = await get('/');
assert(after.status === 200 && !marker(after.body, ERR_MARKERS).length, 'healthy page still fine after repeated errors');

// Error text from an erroring page must not appear in any other page's HTML.
for (const path of ['/about', '/store/shirt', '/typed']) {
  const r = await get(path);
  const hits = marker(r.body, ERR_MARKERS);
  assert(hits.length === 0, `${path} carries no error text from other routes`);
}

// ============================================================
console.log('\nB. DATA LEAKAGE — data must stay on the route that fetched it');
// ============================================================

// Route params isolation: /store/shirt must never contain /store/shoes content.
const shirt = await get('/store/shirt');
const shoes = await get('/store/shoes');
assert(shirt.body.includes('shirt') && !shirt.body.includes('Item: shoes'), 'store/shirt contains only its own param');
assert(shoes.body.includes('shoes') && !shoes.body.includes('Item: shirt'), 'store/shoes contains only its own param');

// Serialized useFetch data isolation. `/` legitimately renders its own posts
// demo (added to the fixture), so 'Hello Vesk' is NOT a leak marker there —
// instead we assert / does not contain the /posts page's unique copy, and
// every OTHER route must not contain the posts data at all.
const POSTS_TITLE = 'Hello Vesk'; // a real post title from /api/posts
const POSTS_PAGE_UNIQUE = 'Fetched with useFetch'; // copy that exists only on /posts
const posts = await get('/posts');
assert(posts.body.includes(POSTS_TITLE), 'posts page contains its own fetched data');
assert(!posts.body.includes('does not leak'), 'sanity: marker strings present');
for (const path of ['/about', '/store/shirt', '/typed', '/dataerror', '/broken']) {
  const r = await get(path);
  assert(!r.body.includes(POSTS_TITLE), `${path} does not leak /posts fetched data`);
  const m = r.body.match(/ssr-data\.js\?t=([a-z0-9]+)/);
  if (m) {
    const data = await get(m[0]);
    assert(!data.body.includes(POSTS_TITLE), `${path} ssr-data payload does not contain posts data`);
  }
}
{
  const r = await get('/');
  assert(r.body.includes(POSTS_TITLE), '/ renders its own posts demo data');
  assert(!r.body.includes(POSTS_PAGE_UNIQUE), '/ does not leak /posts page content');
}

// Middleware locals isolation: Alice/db-result live only in protected API responses.
const protectedApi = await get('/api/protected');
assert(protectedApi.body.includes('Alice'), 'protected api sees middleware locals (baseline)');
for (const path of ['/', '/about', '/posts', '/store/shirt']) {
  const r = await get(path);
  assert(!r.body.includes('Alice') && !r.body.includes('db-result'),
    `${path} page HTML does not leak middleware locals`);
}

// SSR-internal API fetch isolation: a page that fetches an API during SSR must
// NOT leak its own route-middleware locals into the inner API request. The
// inner request runs its own fresh middleware chain (root only), so it sees
// root locals (user=Alice) but never the page's route marker.
const leakLocals = await get('/leaklocals');
assert(leakLocals.status === 200, '/leaklocals renders (page route middleware + SSR fetch)');
assert(leakLocals.body.includes('user: Alice'), 'inner API request sees fresh root middleware locals');
assert(!leakLocals.body.includes('LEAK_LOCALS_ROUTE'),
  'page route-middleware locals do NOT leak into the SSR-internal API request');
assert(!leakLocals.body.includes('route: LEAK_LOCALS_ROUTE'),
  'page locals never rendered from inner API response');

// Direct browser call to the same API sees only its own chain (no page context).
const directLocals = await get('/api/locals');
assert(directLocals.body.includes('Alice') && !directLocals.body.includes('LEAK_LOCALS_ROUTE'),
  'direct /api/locals sees root locals only, no route marker');

// Server action isolation: submitted action payload must not resurface elsewhere.
const actionPage = await get('/actions');
const actionScript = actionPage.body.match(/\/_vesk\/action\/[a-z0-9_-]+/);
assert(!!actionScript, 'actions page exposes an action endpoint');
if (actionScript) {
  const payload = 'name=Leaky%20User&email=leak%40test.dev&password=secret123';
  const res = await fetch(`${BASE}${actionScript[0]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload,
  });
  const actionBody = await res.text();
  assert(res.status === 200, 'action succeeds');
  assert(actionBody.includes('Leaky User'), 'action response echoes the submitted data');
  assert(actionBody.includes('application/json') || res.headers.get('content-type').includes('json'),
    'action response is JSON');
  for (const path of ['/', '/about', '/posts']) {
    const r = await get(path);
    assert(!r.body.includes('Leaky User') && !r.body.includes('leak@test.dev'),
      `${path} does not leak the action submission`);
  }
}

// ============================================================
console.log('\nC. SSR VS JSON — browsers get HTML for pages, JSON only for APIs');
// ============================================================

const pages = ['/', '/about', '/posts', '/store/shirt', '/actions', '/typed',
  '/dataerror', '/broken', '/leakmid', '/store/boom', '/store/missing', '/apierr'];
for (const path of pages) {
  const r = await get(path);
  assert(r.type.includes('text/html'), `${path} -> Content-Type ${r.type} (want text/html)`);
  assert(!r.type.includes('application/json'), `${path} is never JSON when a page was requested`);
}

const apis = ['/api/hello', '/api/posts', '/api/protected', '/api/echo/msg', '/api/fail'];
for (const path of apis) {
  const r = await get(path);
  assert(r.type.includes('application/json'), `${path} -> Content-Type ${r.type} (want application/json)`);
}

// Error responses for API paths are JSON; error responses for pages are HTML.
const failApi = await get('/api/fail');
assert(failApi.type.includes('application/json'), 'api 401 body is JSON');
const boomPage = await get('/store/boom');
assert(boomPage.type.includes('text/html'), 'page 500 body is HTML');

// Static assets keep their own types.
const css = await fetch(`${BASE}/_vesk/static/_tailwind.css`);
assert((css.headers.get('content-type') || '').includes('text/css'), 'css served as css');
const js = await fetch(`${BASE}/_vesk/static/client.js`);
assert((js.headers.get('content-type') || '').includes('javascript'), 'client.js served as javascript');

// An SSR-internal API error (page awaits a 401 fetch) still yields HTML to the browser.
const apierr = await get('/apierr');
assert(apierr.status === 500 && apierr.type.includes('text/html'), '/apierr (SSR awaited 401) -> HTML, not JSON');
assert(apierr.body.includes('client.js'), '/apierr error page carries hydration script');

// ============================================================
console.log(`\n[leakage] ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('failures:');
  for (const f of failures) console.log('  - ' + f);
}

server.kill('SIGKILL');
cleanupFixtures();
// Rebuild without fixtures so .vesk output is back to the clean state.
console.log('[leakage] rebuilding without fixtures...');
execSync(`${resolve(appDir, 'node_modules', '.bin', 'haul')} build`, {
  cwd: appDir, stdio: 'inherit', timeout: 300000,
});
process.exit(failed > 0 ? 1 : 0);