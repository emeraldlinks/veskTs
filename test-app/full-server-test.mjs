/**
 * Full-stack integration test for Vesk:
 *   - Security string shorthands + preset()
 *   - definePlugin() with provides
 *   - Middleware ctx.set/get and convenience getters
 *   - Route-level middleware
 *   - VeskResponse auto-build (cookies, security headers, status, cors)
 *
 * Modifies test-app files, starts dev server, runs curl tests, cleans up.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = __dirname;

let passed = 0;
let failed = 0;
let server = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

function curl(url) {
  try {
    const out = execSync(`curl -s -i http://localhost:3002${url} 2>/dev/null`, {
      timeout: 10000, encoding: 'utf-8',
    });
    const lines = out.split('\n');
    const statusLine = lines[0];
    const status = parseInt(statusLine.split(' ')[1], 10);
    const headers = {};
    let i = 1;
    while (i < lines.length && lines[i].trim() !== '') {
      const colon = lines[i].indexOf(':');
      if (colon > 0) {
        const k = lines[i].slice(0, colon).trim().toLowerCase();
        const v = lines[i].slice(colon + 1).trim();
        headers[k] = headers[k] ? [...(Array.isArray(headers[k]) ? headers[k] : [headers[k]]), v] : v;
      }
      i++;
    }
    const body = lines.slice(i + 1).join('\n').trim();
    return { status, headers, body };
  } catch {
    return { status: 0, headers: {}, body: '' };
  }
}

function waitForServer(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      execSync(`curl -s -o /dev/null -w '%{http_code}' ${url} 2>/dev/null`, { timeout: 3000 });
      return true;
    } catch {
      execSync('sleep 0.3');
    }
  }
  return false;
}

// ── 1. Save originals ──────────────────────────────────────────
const configPath = resolve(appDir, 'vesk.config.ts');
const middlewarePath = resolve(appDir, 'app', 'middleware.ts');
const apiHelloPath = resolve(appDir, 'app', 'api', 'hello', 'route.ts');
const adminDir = resolve(appDir, 'app', 'admin');
const adminMwPath = resolve(adminDir, 'middleware.ts');
const apiProtectedDir = resolve(appDir, 'app', 'api', 'protected');
const apiProtectedPath = resolve(apiProtectedDir, 'route.ts');

const origConfig = readFileSync(configPath, 'utf-8');
const origMiddleware = readFileSync(middlewarePath, 'utf-8');
const origApiHello = readFileSync(apiHelloPath, 'utf-8');

console.log('=== Setting up test fixtures ===');

// ── 2. Write updated vesk.config.ts with security preset + test plugin ──
writeFileSync(configPath, [
  `import { defineConfig, definePlugin, preset } from '@vesk/compiler'`,
  `import tailwindcss from '@vesk/plugin-tailwind'`,
  ``,
  `const testPlugin = definePlugin({`,
  `  name: 'test-services',`,
  `  provides: {`,
  `    serviceName: () => 'provided-by-plugin',`,
  `  },`,
  `  onRequest: async (ctx) => {`,
  `    ctx.set('pluginValue', 'injected-by-onRequest');`,
  `  },`,
  `});`,
  ``,
  `export default defineConfig({`,
  `  appDir: './app',`,
  `  outDir: './dist',`,
  `  publicDir: './public',`,
  `  security: preset('production', {`,
  `    trustProxy: true,`,
  `    cors: { origin: ['http://localhost:3002'] },`,
  `  }),`,
  `  plugins: [`,
  `    tailwindcss({ entry: 'src/global.css', appDir: 'app' }),`,
  `    testPlugin,`,
  `  ],`,
  `  ssg: {},`,
  `})`,
  '',
].join('\n'));

// ── 3. Write root middleware with ctx.set/get ──
writeFileSync(middlewarePath, [
  `export async function middleware(ctx, next) {`,
  `  ctx.set('user', { id: 1, name: 'Alice' });`,
  `  ctx.set('db', { query: () => 'db-result' });`,
  `  ctx.set('startTime', Date.now());`,
  `  return next();`,
  `}`,
  '',
].join('\n'));

// ── 4. Write route-level middleware at app/admin/middleware.ts ──
mkdirSync(adminDir, { recursive: true });
writeFileSync(adminMwPath, [
  `export async function middleware(ctx, next) {`,
  `  // Verify root middleware already injected user`,
  `  ctx.set('role', ctx.user ? 'admin' : 'anonymous');`,
  `  ctx.set('route', 'admin');`,
  `  return next();`,
  `}`,
  '',
].join('\n'));

// ── 5. Write API route that uses VeskResponse ──
writeFileSync(apiHelloPath, [
  `import { VeskRequest, VeskResponse } from '@vesk/runtime';`,
  ``,
  `export async function GET(req: VeskRequest) {`,
  `  return VeskResponse.json({ message: 'Hello from Vesk!' })`,
  `    .setCookie('session', 'abc123', { httpOnly: true, secure: true, path: '/', maxAge: 3600 })`,
  `    .setStatus(201)`,
  `    .cors({ origin: 'http://localhost:3002', methods: 'GET,POST' });`,
  `}`,
  ``,
  `export async function POST(req: VeskRequest) {`,
  `  const body = await req.getBody();`,
  `  if (body instanceof Response) return body;`,
  `  return VeskResponse.json({ received: body, ok: true }, { status: 201 })`,
  `    .setCookie('posted', 'true');`,
  `}`,
  '',
].join('\n'));

// ── 6. Write protected API route with security overrides ──
mkdirSync(apiProtectedDir, { recursive: true });
writeFileSync(apiProtectedPath, [
  `import { VeskRequest, VeskResponse } from '@vesk/runtime';`,
  ``,
  `export async function GET(req: VeskRequest) {`,
  `  return VeskResponse.json({`,
  `    secure: true,`,
  `    user: req.locals?.user || null,`,
  `    service: req.locals?.serviceName || null,`,
  `    pluginValue: req.locals?.pluginValue || null,`,
  `  })`,
  `    .setCsp("default-src 'none'")`,
  `    .setSecurityHeader('X-Custom', 'custom-val')`,
  `    .cache(60);`,
  `}`,
  '',
].join('\n'));

console.log('  test fixtures written');

// ── 7. Start dev server ──────────────────────────────────────────
console.log('\n=== Starting dev server ===');
server = spawn('node', ['--experimental-vm-modules', resolve(appDir, 'node_modules/@vesk/cli/src/index.js'), 'dev', '3002'], {
  cwd: appDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PATH: `${resolve(root, 'test-app/node_modules/.bin')}:${process.env.PATH}` },
});

let serverLog = '';
server.stdout.on('data', d => { serverLog += d.toString(); });
server.stderr.on('data', d => { serverLog += d.toString(); });

const started = waitForServer('http://localhost:3002');
if (!started) {
  console.log('  \u2717 dev server failed to start');
  console.log(serverLog.slice(-500));
  process.exit(1);
}
console.log('  \u2713 dev server running on http://localhost:3002');

// ── 8. Tests ─────────────────────────────────────────────────────
console.log('\n=== Test 1: Security headers via preset("production") ===');
{
  const r = curl('/');
  assert(r.status === 200, 'root page returns 200');
  let csp = r.headers['content-security-policy'];
  csp = Array.isArray(csp) ? csp[0] : csp;
  assert(csp && csp.includes("default-src 'self'"), `CSP header present: ${!!csp}`);
  let hsts = r.headers['strict-transport-security'];
  hsts = Array.isArray(hsts) ? hsts[0] : hsts;
  assert(hsts && hsts.includes('max-age=31536000'), `HSTS header present: ${!!hsts}`);
  let xfo = r.headers['x-frame-options'];
  xfo = Array.isArray(xfo) ? xfo[0] : xfo;
  assert(xfo === 'DENY', `X-Frame-Options: DENY — got ${xfo}`);
}

console.log('\n=== Test 2: VeskResponse API route with cookies, status, cors ===');
{
  const r = curl('/api/hello');
  assert(r.status === 201, `status is 201 — got ${r.status}`);
  let cookie = r.headers['set-cookie'];
  cookie = Array.isArray(cookie) ? cookie[0] : cookie;
  assert(cookie && cookie.includes('session=abc123'), `Set-Cookie contains session: ${!!cookie}`);
  assert(cookie && cookie.includes('HttpOnly'), `Set-Cookie has HttpOnly: ${!!cookie}`);
  assert(cookie && cookie.includes('Secure'), `Set-Cookie has Secure: ${!!cookie}`);
  assert(cookie && cookie.includes('Max-Age=3600'), `Set-Cookie has Max-Age: ${!!cookie}`);
  let acao = r.headers['access-control-allow-origin'];
  acao = Array.isArray(acao) ? acao[0] : acao;
  assert(acao === 'http://localhost:3002', `CORS origin: ${acao}`);
  // CSP from default security headers should also be present
  let csp = r.headers['content-security-policy'];
  csp = Array.isArray(csp) ? csp[0] : csp;
  assert(csp && csp.includes("default-src 'self'"), `CSP header present on API response: ${!!csp}`);
  const body = JSON.parse(r.body);
  assert(body.message === 'Hello from Vesk!', `body.message correct: ${body.message}`);
}

console.log('\n=== Test 3: VeskResponse POST with cookie ===');
{
  const out = execSync(`curl -s -i -X POST -H 'Content-Type: application/json' -d '{"test":true}' http://localhost:3002/api/hello 2>/dev/null`, {
    timeout: 10000, encoding: 'utf-8',
  });
  const lines = out.split('\n');
  const status = parseInt(lines[0].split(' ')[1], 10);
  assert(status === 201, `POST returns 201 — got ${status}`);
  const hasCookie = out.toLowerCase().includes('set-cookie:') && out.includes('posted=true');
  assert(hasCookie, `POST response has Set-Cookie: posted=true`);
  const body = JSON.parse(out.split('\n\n').slice(1).join('\n\n').trim());
  assert(body.ok === true, 'POST body.ok is true');
}

console.log('\n=== Test 4: Protected API route with security overrides ===');
{
  const r = curl('/api/protected');
  assert(r.status === 200, `status is 200 — got ${r.status}`);
  let csp = r.headers['content-security-policy'];
  csp = Array.isArray(csp) ? csp[0] : csp;
  assert(csp === "default-src 'none'", `CSP overridden: ${csp}`);
  let custom = r.headers['x-custom'];
  custom = Array.isArray(custom) ? custom[0] : custom;
  assert(custom === 'custom-val', `X-Custom header: ${custom}`);
  let cc = r.headers['cache-control'];
  cc = Array.isArray(cc) ? cc[0] : cc;
  assert(cc && cc.includes('max-age=60'), `Cache-Control: ${cc}`);
}

console.log('\n=== Test 5: Middleware ctx.set/get + plugin provides + onRequest ===');
{
  const r = curl('/api/protected');
  const body = JSON.parse(r.body);
  assert(body.user && body.user.name === 'Alice', `ctx.user injected: ${JSON.stringify(body.user)}`);
  assert(body.pluginValue === 'injected-by-onRequest', `plugin onRequest injected: ${body.pluginValue}`);
}

console.log('\n=== Test 6: Dynamic API route still works ===');
{
  const r = curl('/api/echo/hello-world');
  const body = JSON.parse(r.body);
  assert(body.message === 'hello-world', `echo param: ${body.message}`);
}

console.log('\n=== Test 7: SSR page renders ===');
{
  const r = curl('/');
  assert(r.status === 200, 'root page 200');
  assert(r.body.includes('Welcome'), 'root page contains Welcome');
  assert(r.body.includes('Vesk'), 'root page contains Vesk');
}

console.log('\n=== Test 8: Route-level middleware (app/admin) ===');
{
  const r = curl('/admin');
  // 404 expected since there's no /admin page.vsk
  // But the middleware should still have run before 404
  assert(r.status === 404, 'admin page returns 404 (no page.vsk)');
}

console.log('\n=== Test 9: security("minimal") preset ===');
// Test that the preset function config correctly resolves
{
  const { preset, defineConfig } = await import(resolve(root, 'packages/compiler/src/config.js'));
  const minimal = defineConfig({ security: 'minimal' });
  assert(minimal.security.autoEscape === true, 'minimal autoEscape');
  assert(minimal.security.csrf === false, 'minimal csrf off');
  assert(minimal.security.xFrameOptions === 'SAMEORIGIN', 'minimal XFO');
  assert(minimal.security.hsts === false, 'minimal HSTS off');
  assert(minimal.security.redactLogs === false, 'minimal redactLogs off');

  const off = defineConfig({ security: 'off' });
  assert(off.security.autoEscape === true, 'off default autoEscape');

  const fnCfg = defineConfig({ security: (p) => p('production', { trustProxy: true }) });
  assert(fnCfg.security.trustProxy === true, 'function security trustProxy');
  assert(fnCfg.security.autoEscape === true, 'function security autoEscape');
}

// ── 9. Cleanup ───────────────────────────────────────────────────
console.log('\n=== Cleaning up ===');
server.kill('SIGTERM');
execSync('sleep 0.5');
server.kill('SIGKILL'); // ensure dead

writeFileSync(configPath, origConfig);
writeFileSync(middlewarePath, origMiddleware);
writeFileSync(apiHelloPath, origApiHello);
if (existsSync(adminMwPath)) unlinkSync(adminMwPath);
if (existsSync(apiProtectedPath)) unlinkSync(apiProtectedPath);
try { unlinkSync(resolve(adminDir, 'page.vsk')); } catch {}
try { execSync(`rmdir "${adminDir}" 2>/dev/null`); } catch {}
try { execSync(`rmdir "${apiProtectedDir}" 2>/dev/null`); } catch {}
console.log('  cleaned up test fixtures');

// ── Results ──────────────────────────────────────────────────────
console.log(`\n\x1b[1m=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===\x1b[0m`);
if (failed > 0) process.exit(1);
console.log('All server integration tests passed!');
process.exit(0);
