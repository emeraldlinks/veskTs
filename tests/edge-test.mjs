/**
 * Vesk Edge Runtime Test.
 * Builds the test-app for the 'edge' platform and drives the generated
 * `handleEdgeRequest(request)` handler directly with Node's Request/Response —
 * no browser, no HTTP server. Asserts SSR HTML, hydration markers, embedded
 * static serving, API routes and 404 handling.
 * Usage: node edge-test.mjs  (run by scripts/test.js after prod hydration)
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'test-app', 'app');
const publicDir = resolve(root, 'test-app', 'public');
const baseOut = resolve(root, 'test-app', '.vesk');
const edgeOut = resolve(root, 'test-app', '.vesk', 'edge');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
  const { build } = await import(resolve(root, 'packages/adapter/src/index.ts'));

  // The tailwind plugin resolves its entry/candidates from process.cwd() (the
  // CLI runs from the project root). Mirror that here so utilities compile.
  const testAppDir = resolve(root, 'test-app');
  process.chdir(testAppDir);

  const configModule = await import(resolve(testAppDir, 'vesk.config.ts'));
  const config = configModule.default || configModule;
  const plugins = (config && config.plugins) || [];

  console.error('Building for edge platform...');
  rmSync(baseOut, { recursive: true, force: true });
  rmSync(edgeOut, { recursive: true, force: true });
  await build(appDir, { outDir: baseOut, publicDir, platform: 'edge', plugins });

  const handlerModule = await import(resolve(edgeOut, 'index.js'));
  const handleEdgeRequest = handlerModule.default || handlerModule.handleEdgeRequest;
  assert(typeof handleEdgeRequest === 'function', 'edge bundle exports handleEdgeRequest');

  const GET = (path, init = {}) => handleEdgeRequest(new Request('http://localhost' + path, init));

  console.log('\n=== SSR pages ===');
  {
    const res = await GET('/');
    assert(res.status === 200, 'GET / → 200');
    assert((res.headers.get('content-type') || '').includes('text/html'), 'content-type text/html');
    const html = await res.text();
    const flat = html.replace(/\n\s*/g, '');

    assert(flat.includes('>Welcome to Vesk</h1>'), 'h1: Welcome to Vesk');
    assert(flat.includes('<p>10</p>'), 'count track cell renders 10');
    assert(html.includes('Hurray 3 people won'), 'hurray message rendered');
    assert(html.includes('Powered by Vesk'), 'footer rendered');

    const navOk = flat.includes('>Home<') && flat.includes('>About<') && flat.includes('>Blog<');
    assert(navOk, 'nav links present');

    const markers = (html.match(/<!--vsk-->/g) || []).length;
    assert(markers > 0, `hydration markers present in SSR output (${markers})`);
    assert(flat.includes('<script type="module" src="/_vesk/static/client.js">'), 'client runtime script tag present');
  }

  console.log('\n=== Dynamic routes ===');
  {
    const res = await GET('/blog/hello-world');
    const html = await res.text();
    assert(res.status === 200, 'GET /blog/hello-world → 200');
    assert(html.includes('Post: hello-world'), 'dynamic h1: Post: hello-world');

    const res2 = await GET('/about');
    const html2 = await res2.text();
    assert(res2.status === 200, 'GET /about → 200');
    assert(html2.includes('About Vesk'), 'h1: About Vesk');
  }

  console.log('\n=== API routes ===');
  {
    const res = await GET('/api/hello');
    assert(res.status === 201, 'GET /api/hello → 201 (setStatus)');
    const body = await res.json();
    assert(body.message === 'Hello from Vesk!', 'api json body message');
    const setCookie = res.headers.get('set-cookie') || '';
    assert(setCookie.includes('session=abc123'), 'api sets session cookie');

    const post = await GET('/api/hello', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'edge' }),
    });
    assert(post.status === 201, 'POST /api/hello → 201');
    const postBody = await post.json();
    assert(postBody.received?.name === 'edge' && postBody.ok === true, 'api echoes POST body');
  }

  console.log('\n=== Embedded static ===');
  {
    const css = await GET('/_vesk/static/global.css');
    assert(css.status === 200, 'GET /_vesk/static/global.css → 200');
    assert((css.headers.get('content-type') || '').includes('text/css'), 'css content-type');
    const cssText = await css.text();
    assert(!cssText.includes("@import 'tailwindcss'"), 'global.css tailwind import processed');

    const tw = await GET('/_vesk/static/_tailwind.css');
    assert(tw.status === 200, 'GET /_vesk/static/_tailwind.css → 200');
    const twText = await tw.text();
    assert(twText.length > 0, `_tailwind.css non-empty (${twText.length} bytes)`);
  }

  console.log('\n=== 404 handling ===');
  {
    const res = await GET('/no-such-page');
    assert(res.status === 404, 'GET /no-such-page → 404');
    assert((await res.text()).includes('404'), '404 body mentions 404');
  }

  console.log('\n=== Edge-compat bundle ===');
  {
    const bundle = (await import('fs')).readFileSync(resolve(edgeOut, 'index.js'), 'utf-8');
    assert(!/from ['"]node:/.test(bundle), 'no node: imports in edge bundle');
    assert(!bundle.includes('__require'), 'no cjs require shims in edge bundle');
    assert(bundle.includes('handleEdgeRequest'), 'edge bootstrap exported');
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed, ${passed + failed} total \u2550\u2550\u2550`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
