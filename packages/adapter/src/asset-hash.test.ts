/**
 * Content-hashed asset names, SRI digests, and the cache policy that follows.
 *
 * A hashed name is the only way to serve `immutable` safely, and the digest in
 * the script tag is the only way for a browser to know the bytes it is running
 * are the bytes the build produced. Both are load-bearing for a deploy that
 * must never serve stale JS — and both are easy to get subtly wrong (an
 * extension dropped, a prerelease tag treated as content, a cache header
 * applied to an unhashed name, which is how "my deploy didn't take" happens).
 *
 * Run with: npx tsx packages/adapter/src/asset-hash.test.ts
 */
import { createHash } from 'node:crypto';
import { cacheControlFor, describeAsset, hashedName, hashOf, integrityOf, isHashedName } from '@vesk/adapter/src/asset-hash';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
    failures.push({ name, message: (e as Error).message });
  }
}

const CODE = 'console.log("hello");\n';

console.log('\n=== Asset hashing + SRI ===');

it('inserts the content hash before the extension', () => {
  const expected = `client.${createHash('sha256').update(CODE).digest('hex').slice(0, 10)}.js`;
  eq(hashedName('client.js', CODE), expected, 'client.js');
  eq(hashedName('page-docs-_slug_.js', CODE), `page-docs-_slug_.${hashOf(CODE)}.js`, 'dotted page name');
  eq(hashedName('global.css', CODE), `global.${hashOf(CODE)}.css`, 'css keeps its own extension');
});

it('leaves a name with no extension alone', () => {
  eq(hashedName('LICENSE', CODE), 'LICENSE', 'no extension');
});

it('the hash is content-addressed: same bytes, same name; different bytes, different', () => {
  const a = hashedName('client.js', CODE);
  const b = hashedName('client.js', CODE);
  const c = hashedName('client.js', CODE + '// one more byte');
  assert(a === b, 'the same content produced two names');
  assert(a !== c, 'a one-byte change kept the name — a CDN would serve stale JS forever');
  // `client` + `.` + 10 hex + `.js`
  eq(a, `client.${hashOf(CODE)}.js`, 'name shape: hash goes between the stem and the extension');
});

it('the integrity value is a real sha384 SRI digest', () => {
  const expected = `sha384-${createHash('sha384').update(CODE).digest('base64')}`;
  eq(integrityOf(CODE), expected, 'digest');
  // A browser computes base64 over the served bytes; an algorithm a browser does
  // not implement would silently disable the check, so pin sha384.
  assert(integrityOf(CODE).startsWith('sha384-'), 'SRI must use an implemented algorithm');
  assert(integrityOf(CODE) !== integrityOf(CODE + 'x'), 'digest does not cover the content');
});

it('describeAsset reports name, hash, byte length and digest together', () => {
  const d = describeAsset('client.js', CODE);
  eq(d.fileName, hashedName('client.js', CODE), 'fileName');
  eq(d.hash, hashOf(CODE), 'hash');
  eq(d.integrity, integrityOf(CODE), 'integrity');
  eq(d.bytes, Buffer.byteLength(CODE), 'bytes are measured on the encoded form');
  const multi = describeAsset('x.js', 'café');
  eq(multi.bytes, Buffer.byteLength('café'), 'a multi-byte string is not counted as characters');
});

it('recognises a hashed name (and only one)', () => {
  const name = hashedName('client.js', CODE);
  assert(isHashedName(name), `${name} should be recognised as hashed`);
  assert(!isHashedName('client.js'), 'the plain name is not hashed');
  assert(!isHashedName('index-CVGQLgGk.mjs'), 'a non-hex suffix is not a content hash');
  assert(!isHashedName('page-docs-_slug_.js'), 'a page chunk is unhashed until the build hashes it');
  assert(!isHashedName('noext'), 'no extension, no hash');
});

it('serves hashed assets immutable and everything else revalidated', () => {
  const name = hashedName('client.js', CODE);
  eq(cacheControlFor(name, false), 'public, max-age=31536000, immutable', 'hashed, prod');
  // The dangerous one: an immutable header on an unhashed name is how a deploy
  // ships and the client keeps running the old bundle for a year.
  eq(cacheControlFor('client.js', false), 'public, max-age=0, must-revalidate', 'unhashed, prod');
  eq(cacheControlFor(name, true), 'no-cache', 'dev never caches, hashed or not');
  eq(cacheControlFor('client.js', true), 'no-cache', 'dev, unhashed');
});

it('the generated SSR function carries the hashed URL and its digest', async () => {
  // The hash has to be known BEFORE the functions are generated (the build now
  // bundles the client first), and the tag has to carry the digest that matches
  // those exact bytes.
  const { generateSsrFunction } = await import('@vesk/adapter/src/ssr-function');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'vesk-asset-hash-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'about'), { recursive: true });
  writeFileSync(join(appDir, 'about/layout.vsk'), 'component Layout() { <div><Slot /></div> }\n');
  writeFileSync(join(appDir, 'layout.vsk'), 'component Layout() { <div><Slot /></div> }\n');
  writeFileSync(join(appDir, 'about/page.vsk'), 'component Page() { <h1>about</h1> }\n');
  const asset = describeAsset('client.js', CODE);
  const { funcCode } = generateSsrFunction(
    { fullPath: '/about', sourceDir: 'about', page: 'Page', layout: 'Layout' } as never,
    appDir,
    join(dir, '.vesk'),
    new Map(),
    { clientScriptUrl: `/_vesk/static/${asset.fileName}`, clientScriptIntegrity: asset.integrity },
  );
  assert(funcCode.includes(asset.fileName), 'the function does not reference the hashed bundle');
  assert(funcCode.includes(asset.integrity), 'the function does not carry the SRI digest');
  assert(!funcCode.includes('/_vesk/static/client.js"'), 'the unhashed URL is still baked in');
});

it('dev keeps the stable name and no digest', async () => {
  const { generateSsrFunction } = await import('@vesk/adapter/src/ssr-function');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'vesk-asset-hash-dev-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'about'), { recursive: true });
  writeFileSync(join(appDir, 'about/layout.vsk'), 'component Layout() { <div><Slot /></div> }\n');
  writeFileSync(join(appDir, 'layout.vsk'), 'component Layout() { <div><Slot /></div> }\n');
  writeFileSync(join(appDir, 'about/page.vsk'), 'component Page() { <h1>about</h1> }\n');
  const { funcCode } = generateSsrFunction(
    { fullPath: '/about', sourceDir: 'about', page: 'Page', layout: 'Layout' } as never,
    appDir,
    join(dir, '.vesk'),
    new Map(),
  );
  assert(funcCode.includes('/_vesk/static/client.js'), 'dev must keep the stable name so HMR can rewrite it');
  assert(!funcCode.includes('integrity'), 'dev must not pin a digest — the bytes change on every edit');
});

it('the route tree the client gets references chunks that actually exist', async () => {
  // The router asks for chunks by the URL baked into the route tree, so the
  // hash has to be applied THERE and not only to the files on disk. When it
  // was not, every chunk 404'd, the server answered with the SPA fallback
  // (text/html), the browser refused the script, and the page never hydrated —
  // a total failure with no error in the build log.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { generateClientBundle } = await import('@vesk/adapter/src/client-bundle');
  const dir = mkdtempSync(join(tmpdir(), 'vesk-chunk-hash-'));
  const appDir = join(dir, 'app');
  mkdirSync(join(appDir, 'about'), { recursive: true });
  writeFileSync(join(appDir, 'layout.vsk'), 'component Layout() { <div><Slot /></div> }\n');
  writeFileSync(join(appDir, 'page.vsk'), 'component Page() { <h1>home</h1> }\n');
  writeFileSync(join(appDir, 'about/page.vsk'), 'component About() { <h1>about</h1> }\n');

  const routeTree: any = [{
    fullPath: '/', sourceDir: '', page: 'Page', layout: 'Layout', children: [
      { fullPath: '/about', sourceDir: 'about', page: 'About', children: [] },
    ],
  }];
  const built = await generateClientBundle(routeTree, appDir, new Map(), { codeSplit: true });
  const byName = new Map(built.chunks.map((c) => [c.name, c]));
  assert(built.chunks.length > 0, 'no chunks were emitted');

  const urls: string[] = [];
  const collect = (nodes: any[]): void => {
    for (const n of nodes) {
      if (n.chunk) urls.push(n.chunk);
      collect(n.children || []);
    }
  };
  collect(routeTree);
  assert(urls.length > 0, 'no route in the tree carries a chunk URL');

  for (const url of urls) {
    const file = url.slice(url.lastIndexOf('/') + 1);
    const name = file.replace(/\.[0-9a-f]{10}(\.js)$/, '$1');
    const emitted = byName.get(name);
    assert(emitted !== undefined, `the route tree asks for ${url}, but no chunk named ${name} was emitted`);
    assert(
      file === hashedName(name, emitted!.code),
      `the route tree asks for ${file} but the build writes ${hashedName(name, emitted!.code)} — a chunk 404 kills hydration`,
    );
  }
});

it('a dev build keeps the unhashed chunk names (HMR rewrites them)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { generateClientBundle } = await import('@vesk/adapter/src/client-bundle');
  const dir = mkdtempSync(join(tmpdir(), 'vesk-chunk-hash-dev-'));
  const appDir = join(dir, 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'page.vsk'), 'component Page() { <h1>home</h1> }\n');
  const routeTree: any = [{ fullPath: '/', sourceDir: '', page: 'Page', children: [] }];
  await generateClientBundle(routeTree, appDir, new Map(), { codeSplit: true, hmr: true });
  const devUrl = routeTree[0].chunk || '';
  // The chunk name is derived from the route path, so only the shape is pinned:
  // a dev URL must never carry a content hash.
  assert(/^\/_vesk\/static\/page-[\w.\/-]+\.js$/.test(devUrl), `dev chunk URL changed: ${devUrl}`);
  assert(!/\.[0-9a-f]{10}\.js$/.test(devUrl), `a dev chunk URL must not be hashed: ${devUrl}`);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All asset-hash tests passed!');
