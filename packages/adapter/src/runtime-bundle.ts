import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from './esbuild-fallback.js';

let buildId = 0;

const __dirname = dirname(fileURLToPath(import.meta.url));

function findCompilerSrc(appDir: string): string {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const candidates = [
    resolve(monorepoRoot, 'packages', 'compiler', 'dist'),
    resolve(appDir, '..', 'node_modules', '@vesk/compiler'),
    resolve(appDir, 'node_modules', '@vesk/compiler'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'server-codegen.js'))) return dir;
    }
  }
  throw new Error('@vesk/compiler/dist not found — run "npm run build" first');
}

function findRuntimeSrc(appDir: string): string {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const candidates = [
    resolve(monorepoRoot, 'packages', 'runtime', 'dist'),
    resolve(appDir, '..', 'node_modules', '@vesk/runtime'),
    resolve(appDir, 'node_modules', '@vesk/runtime'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'index-server.js'))) return dir;
    }
  }
  throw new Error('@vesk/runtime/dist not found — run "npm run build" first');
}

export async function bundleRuntime(appDir: string, outDir: string): Promise<string> {
  const compilerRoot = findCompilerSrc(appDir);
  const runtimeRoot = findRuntimeSrc(appDir);

  const entryFile = resolve(outDir, 'server', `.runtime-entry-${buildId++}.mjs`);
  const entryContent = [
    `import { renderPage, renderFullPage, renderPageStream, compileFile, setRuntimeModule, setVskHydrate, hydratePrecompile, assertSameOrigin } from ${JSON.stringify(resolve(compilerRoot, 'server-codegen.js'))};`,
    `import { parseCookies } from ${JSON.stringify(resolve(compilerRoot, 'server-cookies.js'))};`,
    `import * as __veskRuntime from ${JSON.stringify(resolve(runtimeRoot, 'index-server.js'))};`,
    '',
    '// Inject runtime module so server-codegen can find components like NavLink, Link, etc.',
    'setRuntimeModule(__veskRuntime);',
    '',
    '// Server-side runtime hooks — read from globalThis.__vesk_request',
    'export function cookies() {',
    '  const req = globalThis.__vesk_request;',
    "  if (!req) return { get: () => null, getAll: () => [], set: () => {}, delete: () => {} };",
    '  const c = req.cookies || {};',
    '  return {',
    '    get: (name) => c[name] || null,',
    '    getAll: () => Object.entries(c).map(([n, v]) => ({ name: n, value: v })),',
    '    set: () => {},',
    '    delete: () => {},',
    '  };',
    '}',
    '',
    'export function headers() {',
    '  const req = globalThis.__vesk_request;',
    '  if (!req) return new Map();',
    '  const h = req.headers || {};',
    '  const m = new Map();',
    '  for (const [k, v] of Object.entries(h)) m.set(k.toLowerCase(), String(v));',
    '  m.get = m.get.bind(m);',
    '  m.has = m.has.bind(m);',
    '  m.forEach = m.forEach.bind(m);',
    '  return m;',
    '}',
    '',
    'export function locals() {',
    '  const req = globalThis.__vesk_request;',
    "  if (!req) return {};",
    '  return req.locals || {};',
    '}',
    '',
    'export { renderPage, renderFullPage, renderPageStream, compileFile, setVskHydrate, hydratePrecompile, parseCookies, assertSameOrigin };',
    'export { withSsrStore } from "@vesk/compiler/src/ssr-store";',
    '',
    '// Deliver hydration data as an origin-served script so strict CSP (no unsafe-inline)',
    '// does not block it. The prod server serves /ssr-data.js from the global store.',
    'export function storeDataScriptGlobal(payload) {',
    "  if (!payload || (!payload.props && !payload.ssrData)) return null;",
    '  // CSPRNG token — this URL gates access to the page\'s hydration payload',
    '  const bytes = new Uint8Array(12);',
    '  crypto.getRandomValues(bytes);',
    "  let tk = '';",
    "  for (const b of bytes) tk += b.toString(16).padStart(2, '0');",
    '  const token = tk;',
    "  const store = (globalThis.__vsk_ssr_data_store ||= {});",
    "  store[token] = payload;",
    '  // Bound the store: if the browser never fetches /ssr-data.js the entry',
    '  // would otherwise linger forever. Evict the oldest entry past 100.',
    "  const keys = Object.keys(store);",
    '  if (keys.length > 100) {',
    '    for (let i = 0; i < keys.length - 100; i++) {',
    '      delete store[keys[i]];',
    '    }',
    '  }',
    "  return '/ssr-data.js?t=' + token;",
    '}',
    '',
    '// Re-export runtime classes used by API routes',
    'export const VeskRequest = __veskRuntime.VeskRequest;',
    'export const PayloadTooLargeError = __veskRuntime.PayloadTooLargeError;',
    'export const DEFAULT_MAX_BODY_BYTES = __veskRuntime.DEFAULT_MAX_BODY_BYTES;',
    'export const VeskResponse = __veskRuntime.VeskResponse;',
    '',
    '// Server actions',
    'export const defineAction = __veskRuntime.defineAction;',
    'export const getAction = __veskRuntime.getAction;',
    'export const clearActions = __veskRuntime.clearActions;',
    'export const validateActionInput = __veskRuntime.validateActionInput;',
    'export const issuesToFieldMap = __veskRuntime.issuesToFieldMap;',
    '',
    '// API-route surface. `@vesk/runtime/server` imports in app/api/**/route.ts',
    '// are rewritten to this bundle, so anything a route is documented to',
    '// import must be re-exported here — otherwise it resolves in dev (which',
    '// imports the real barrel) and fails only in a production build.',
    'export const redirect = __veskRuntime.redirect;',
    'export const permanentRedirect = __veskRuntime.permanentRedirect;',
    'export const notFound = __veskRuntime.notFound;',
    'export const NotFoundError = __veskRuntime.NotFoundError;',
    'export const useParams = __veskRuntime.useParams;',
    'export const useBody = __veskRuntime.useBody;',
    'export const useRequest = __veskRuntime.useRequest;',
    'export const withValidation = __veskRuntime.withValidation;',
    'export const cors = __veskRuntime.cors;',
    'export const webhook = __veskRuntime.webhook;',
    'export const signCookie = __veskRuntime.signCookie;',
    'export const unsignCookie = __veskRuntime.unsignCookie;',
    'export const setSignedCookie = __veskRuntime.setSignedCookie;',
    'export const readSignedCookie = __veskRuntime.readSignedCookie;',
    'export const HttpError = __veskRuntime.HttpError;',
    'export const TimeoutError = __veskRuntime.TimeoutError;',
    'export const mutate = __veskRuntime.mutate;',
    'export const runHooks = __veskRuntime.runHooks;',
    '',
    '// ISR (server-only; revalidate*/clear* are no-ops outside a request).',
    'export const isr = __veskRuntime.isr;',
    'export const pageIsr = __veskRuntime.pageIsr;',
    'export const componentIsr = __veskRuntime.componentIsr;',
    'export const revalidatePath = __veskRuntime.revalidatePath;',
    'export const revalidateTag = __veskRuntime.revalidateTag;',
    'export const revalidateComponent = __veskRuntime.revalidateComponent;',
    'export const clearIsrCache = __veskRuntime.clearIsrCache;',
    'export const isrConfigToRevalidate = __veskRuntime.isrConfigToRevalidate;',
    '',
    '// Server-wide context store (server events)',
    'export const serverLocals = __veskRuntime.serverLocals;',
    'export const getServerContext = __veskRuntime.getServerContext;',
    'export const setServerContext = __veskRuntime.setServerContext;',
    'export const clearServerContext = __veskRuntime.clearServerContext;',
    'export const server_locals = __veskRuntime.server_locals;',
    'export const get_server_context = __veskRuntime.get_server_context;',
    'export const set_server_context = __veskRuntime.set_server_context;',
    'export const clear_server_context = __veskRuntime.clear_server_context;',
  ].join('\n');
  writeFileSync(entryFile, entryContent, 'utf-8');

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      platform: 'neutral' as const,
      format: 'esm',
      minify: true,
      outfile: resolve(outDir, 'server', 'runtime.js'),
      external: ['fs', 'node:fs', 'path', 'node:path', 'module', 'node:module', 'node:async_hooks'],
      target: ['es2022'],
      treeShaking: true,
    });

    if (result.errors.length > 0) {
      throw new Error(`esbuild errors: ${result.errors.map((e: { text: string }) => e.text).join(', ')}`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.error('vesk build warning:', w.text);
    }

    return resolve(outDir, 'server', 'runtime.js');
  } finally {
    try { unlinkSync(entryFile); } catch { /* ignore */ }
  }
}
