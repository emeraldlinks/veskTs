/**
 * Unit tests for the esbuild-free mini-bundler used by the Go haul engine.
 *
 * The mini-bundler replaces the esbuild Go API for two narrow tasks:
 *   1. bundleClientRuntimeIife  — tree-shaken client runtime IIFE (mirrors
 *      buildTreeShakenRuntime in packages/adapter/src/client-bundle.ts, minus
 *      the legacy-concat fallback: a genuinely missing name throws instead).
 *   2. bundleServerRuntime      — server/runtime.js ESM (externals stay bare).
 *
 * Unlike the adapter's esbuild output, the mini-bundler never falls back to
 * the legacy concatenated runtime; missing names are a hard error.
 *
 * NOTE on the effect re-run assertion: the ripple scheduler re-runs effects on
 * `set`+`flushSync` only when no microtask turn has elapsed since the effect's
 * initial run (verified identical against the esbuild bundle). The assertion
 * sequence below therefore keeps set/flush synchronous with no awaited turns.
 */
import { bundleClientRuntimeIife, bundleServerRuntime, hubExportMap, MiniBundleError } from './mini-bundler';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const __dirname = dirname(new URL(import.meta.url).pathname);
const root = resolve(__dirname, '..', '..', '..', '..');
const runtimeDir = resolve(root, 'packages', 'runtime', 'dist');
const compilerDir = resolve(root, 'packages', 'compiler', 'dist');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function assertThrows(fn: () => unknown, msg: string) {
  try {
    fn();
    failed++;
    console.log(`  ✗ ${msg} (no throw)`);
  } catch (e) {
    if (e instanceof MiniBundleError) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.log(`  ✗ ${msg} (wrong error: ${(e as Error).message})`);
    }
  }
}

async function runClientIife(names: string[]) {
  const code = bundleClientRuntimeIife(runtimeDir, names);
  const dir = mkdtempSync(join(tmpdir(), 'vsk-mini-rt-'));
  const out = join(dir, 'rt.mjs');
  writeFileSync(out, code);
  const m = await import(out + '?v=' + Date.now());
  rmSync(dir, { recursive: true });
  return { code, m };
}

async function main() {
  console.log('\n=== mini-bundler: client IIFE ===');

  const minimal = ['track', 'get', 'set', 'effect'];
  const { code, m } = await runClientIife(minimal);

  assert(code.includes('const __veskRuntime = (() => {'), 'closed IIFE global present');
  assert(/const\s*\{\s*track, get, set, effect\s*\}\s*=\s*__veskRuntime;/.test(code), 'destructure from IIFE global present');
  assert(/export\s*\{\s*track, get, set, effect\s*\};/.test(code), 'explicit `export { track, get, set, effect };` emitted');
  assert(!code.includes('// --- ripple-constants.js ---'), 'no legacy concat markers');
  assert(!code.includes('formIsSSR'), 'form module dropped (unused)');
  assert(!code.includes('getClientCache'), 'resource module dropped (unused)');
  assert(!code.includes('generateSrcset'), 'image module dropped (unused)');

  assert(minimal.every((n) => n in m), 'requested names resolve via ESM import');
  assert(Object.keys(m).length === 4, 'no extra exports leak out of the IIFE');

  console.log('\n=== mini-bundler: reactivity roundtrip ===');

  const { m: mr } = await runClientIife(['track', 'get', 'set', 'effect', 'derived', 'root', 'flushSync']);
  const c = mr.track(2);
  const d = mr.derived(() => mr.get(c) * 3);
  assert(mr.get(d) === 6, 'derived value computes from tracked cell');
  const log: string[] = [];
  let ran = false;
  mr.root(() => {
    mr.effect(() => {
      ran = true;
      log.push('v' + mr.get(d));
    });
  });
  mr.flushSync();
  const firstOk = ran && log.join(',') === 'v6';
  mr.set(c, 5);
  mr.flushSync();
  assert(firstOk, `effect runs inside root (got ${log[0] ?? 'none'})`);
  assert(log.join(',') === 'v6,v15', `effect re-runs on update (got ${log.join(',')})`);

  console.log('\n=== mini-bundler: resource shadowing (set) ===');

  const { m: m2 } = await runClientIife(['createResource', 'track', 'get', 'set']);
  const resource = m2.createResource(() => 'value');
  assert(resource && 'data' in resource, 'createResource bundles and returns a resource');
  assert(typeof resource.refresh === 'function' && typeof resource.abort === 'function', 'resource exposes refresh/abort API');
  assert(m2.get(m2.track(1)) === 1, 'track/get still work alongside resource');

  console.log('\n=== mini-bundler: full dev name set ===');

  const all = [...hubExportMap(runtimeDir).keys()];
  assert(all.length > 100, `available name set is > 100 (got ${all.length})`);
  const allCode = bundleClientRuntimeIife(runtimeDir, all);
  assert(!allCode.includes('// --- ripple-constants.js ---'), 'full set still uses the IIFE, not the legacy concat');
  for (const n of ['Form', 'Field', 'matchRoute', 'ensureChunk', 'reconcile']) {
    assert(new RegExp(`export \\{[^}]*\\b${n}\\b[^}]*\\};`).test(allCode), `full set explicitly exports ${n}`);
  }

  console.log('\n=== mini-bundler: missing name ===');

  assertThrows(
    () => bundleClientRuntimeIife(runtimeDir, ['track', 'notARealExport']),
    'missing name throws MiniBundleError (no legacy fallback)',
  );

  console.log('\n=== mini-bundler: server runtime ===');

  const entry = join(tmpdir(), `.runtime-entry-mini-${process.pid}.mjs`);
  const entryContent = `import { renderPage, renderFullPage, renderPageStream, compileFile, setRuntimeModule } from ${JSON.stringify(join(compilerDir, 'server-codegen.js'))};
import { parseCookies } from ${JSON.stringify(join(compilerDir, 'server-cookies.js'))};
import * as __veskRuntime from ${JSON.stringify(join(runtimeDir, 'index-server.js'))};

setRuntimeModule(__veskRuntime);

export function cookies() {
  const req = globalThis.__vesk_request;
  if (!req) return { get: () => null, getAll: () => [], set: () => {}, delete: () => {} };
  const c = req.cookies || {};
  return { get: (name) => c[name] || null, getAll: () => Object.entries(c).map(([n, v]) => ({ name: n, value: v })), set: () => {}, delete: () => {} };
}

export function headers() {
  const req = globalThis.__vesk_request;
  if (!req) return new Map();
  const h = req.headers || {};
  const m = new Map();
  for (const [k, v] of Object.entries(h)) m.set(k.toLowerCase(), String(v));
  m.get = m.get.bind(m);
  m.has = m.has.bind(m);
  m.forEach = m.forEach.bind(m);
  return m;
}

export function locals() {
  const req = globalThis.__vesk_request;
  if (!req) return {};
  return req.locals || {};
}

export { renderPage, renderFullPage, renderPageStream, compileFile, parseCookies };
export { withSsrStore } from ${JSON.stringify(join(compilerDir, 'ssr-store.js'))};
export function storeDataScriptGlobal(payload) {
  if (!payload || (!payload.props && !payload.ssrData)) return null;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const store = (globalThis.__vsk_ssr_data_store ||= {});
  store[token] = payload;
  const keys = Object.keys(store);
  if (keys.length > 100) { for (let i = 0; i < keys.length - 100; i++) delete store[keys[i]]; }
  return '/ssr-data.js?t=' + token;
}
export const VeskRequest = __veskRuntime.VeskRequest;
export const VeskResponse = __veskRuntime.VeskResponse;
`;
  writeFileSync(entry, entryContent);
  const serverCode = bundleServerRuntime(runtimeDir, compilerDir, entry);
  // The server bundle keeps non-project specifiers (acorn, esrap, node builtins)
  // external, so it must live where those resolve — inside the repo.
  const srvDir = mkdtempSync(join(root, '.mini-srv-tmp-'));
  const srvOut = join(srvDir, 'runtime.mjs');
  writeFileSync(srvOut, serverCode);
  const srv = (await import(srvOut + '?v=' + Date.now())) as Record<string, unknown>;
  rmSync(srvDir, { recursive: true });
  rmSync(entry);

  const expected = ['cookies', 'headers', 'locals', 'renderPage', 'renderFullPage', 'renderPageStream', 'compileFile', 'parseCookies', 'withSsrStore', 'storeDataScriptGlobal', 'VeskRequest', 'VeskResponse'];
  assert(expected.every((n) => typeof srv[n] === 'function'), 'server runtime exports all entry functions');
  assert(typeof srv.cookies().get === 'function', 'cookies() works without a request');
  assert(srv.headers() instanceof Map, 'headers() works without a request');
  assert(srv.storeDataScriptGlobal(null) === null, 'storeDataScriptGlobal(null) returns null');
  const cookieObj = (srv.parseCookies as (h: string) => Record<string, string>)('a=1; b=2');
  assert(cookieObj && cookieObj.b === '2', 'parseCookies parses cookie headers');
  assert(typeof srv.renderFullPage === 'function' && typeof srv.compileFile === 'function', 'render entry points are live functions');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed ? 1 : 0);
}

main();
