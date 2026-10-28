import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RouteNode, ApiRouteNode } from '@vesk/adapter/src/types';
// Relative (not `@vesk/adapter/src/...`) so the compiled module keeps working
// when the dist is copied into a registry-style node_modules layout — see
// platform-handler.test.ts. No other runtime import in this file, so the pack
// stays standalone.
import { renderDefaultNotFoundPage } from './default-pages';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PlatformHandlerInput {
  ssrRoutes: RouteNode[];
  apiRoutes: ApiRouteNode[];
  prerenderedPaths: string[];
  hasMiddleware: boolean;
  hasEvents?: boolean;
  /** Project root (app dir) — used to resolve @vesk/compiler from node_modules. */
  appDir: string;
}

export function routeName(segments: string[]): string {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

export function apiRouteName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.map(s => (s.startsWith(':') ? s.slice(1) || 'param' : s)).join('_') || 'index';
}

export function toId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_/, '');
}

function findCompilerSrc(appDir: string): string {
  const candidates = [
    resolve(__dirname, '..', '..', '..', 'packages', 'compiler', 'dist'),
    resolve(appDir, '..', 'node_modules', '@vesk/compiler'),
    resolve(appDir, 'node_modules', '@vesk/compiler'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'server-cookies.js'))) return dir;
    }
  }
  throw new Error('@vesk/compiler/dist not found — run "npm run build" first');
}

/**
 * Generate a self-contained platform handler: a `handleRequest(request: Request)`
 * that routes SSR pages, API routes and middleware for any edge/serverless runtime.
 * The output references server functions via relative imports so it can be bundled
 * with esbuild for each target platform.
 */
export function generatePlatformHandlerSource(input: PlatformHandlerInput): string {
  const { ssrRoutes, apiRoutes, prerenderedPaths, hasMiddleware, appDir } = input;
  const hasEvents = !!input.hasEvents;

  let imports = '';
  // route entry + its routing specificity: static routes must be matched
  // before dynamic/catch-all routes so a catch-all like
  // /api/auth/[...path] never shadows a static sibling such as
  // /api/auth/login. Without this, readdirSync order (ASCII '[' < 'l') can
  // place the catch-all first and every static route under it 404s with
  // the catch-all's "Unknown auth endpoint."
  type RouteEntry = { path: string; entry: string; specificity: number };
  const routeEntries: RouteEntry[] = [];

  const routeSpecificity = (path: string): number => {
    if (/:path\b|:rest\b|\[\.\.\./.test(path)) return 3; // catch-all
    if (/:/.test(path)) return 2; // dynamic param
    return 1; // static
  };

  const pushEntry = (path: string, type: string, handler: string, extra: string) => {
    const entry = `{ path: ${JSON.stringify(path)}, type: '${type}', handler: ${handler}${extra}}`;
    routeEntries.push({ path, entry, specificity: routeSpecificity(path) });
  };

  for (const r of ssrRoutes) {
    const name = routeName(r.fullPath.split('/').filter(Boolean));
    const id = `__ssr_${toId(name)}`;
    const funcPath = `./server/functions/${name}.js`;
    imports += `import { handle as ${id} } from ${JSON.stringify(funcPath)};\n`;
    const revalidate = r._revalidate != null ? `revalidate: ${r._revalidate}, ` : '';
    const tags = r._isrTags ? `tags: ${JSON.stringify(r._isrTags)}, ` : '';
    pushEntry(r.fullPath, 'ssr', id, `, ${revalidate}${tags}`);
  }

  for (const r of apiRoutes) {
    const name = apiRouteName(r.fullPath);
    const id = `__api_${toId(name)}`;
    const funcPath = `./server/api/${name}.js`;
    imports += `import { handle as ${id} } from ${JSON.stringify(funcPath)};\n`;
    pushEntry('/api' + r.fullPath, 'api', id, '}');
  }

  routeEntries.sort((a, b) => a.specificity - b.specificity);

  const mwImport = hasMiddleware ? "import { execute as __executeMw } from './server/middleware.js';" : '';
  const hasMwLiteral = hasMiddleware ? 'true' : 'false';
  const eventsImport = hasEvents ? "import { executeStart as __eventsStart, executeRequest as __eventsRequest } from './server/events.js';" : '';

  const prerenderedList = prerenderedPaths.length > 0
    ? `const __prerendered = new Set(${JSON.stringify(prerenderedPaths)});\n`
    : 'const __prerendered = new Set();\n';

  const isrCache = 'const __isrCache = new Map();';

  const defaultNotFoundLine = `const __defaultNotFoundHtml = ${JSON.stringify(renderDefaultNotFoundPage())};`;

  const serverStoreLine = hasEvents ? 'const __serverStore = globalThis.__vesk_server_ctx || {};' : '';
  const eventsStartLine = hasEvents ? '  await __eventsStart({ server: null });' : '';
  const eventsRequestLine = hasEvents ? '  await __eventsRequest(mwCtx);' : '';
  const localsSeed = hasEvents ? 'Object.assign({}, __serverStore)' : '{}';

  const compilerSrc = findCompilerSrc(appDir);
  const parseCookiesImport = hasMiddleware
    ? `import { parseCookies } from ${JSON.stringify(resolve(compilerSrc, 'server-cookies.js'))};`
    : '';

  return `
${imports}
${parseCookiesImport}
${mwImport}
${eventsImport}
${prerenderedList}
${isrCache}
${defaultNotFoundLine}
const __routes = [${routeEntries.map((e) => e.entry).join(',\n')}];

async function __invokeRoute(route, request) {
  try {
    return await route.handler(request);
  } catch (e) {
    if (e && typeof e === 'object' && e.name === 'Redirect') {
      return new Response(null, {
        status: Number(e.status) || 302,
        headers: { Location: String(e.url || '/') },
      });
    }
    if (e && typeof e === 'object' && e.name === 'NotFoundError') {
      return new Response(__defaultNotFoundHtml, {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    throw e;
  }
}

function __escapeScript(json) {
  return json.split('<').join('\\u003c').split('\\u2028').join('\\u2028').split('\\u2029').join('\\u2029');
}

function __matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  let pi = 0, pp = 0;
  const params = {};
  while (pi < pathParts.length && pp < patternParts.length) {
    const seg = patternParts[pp];
    // A "*name" segment is a catch-all and absorbs the rest of the path.
    if (seg.startsWith('*')) { params[seg.slice(1)] = pathParts.slice(pi).join('/'); pi = pathParts.length; pp++; }
    else if (seg.startsWith(':')) {
      params[seg.slice(1)] = pathParts[pi];
      pi++; pp++;
    } else if (seg === pathParts[pi]) {
      pi++; pp++;
    } else {
      return null;
    }
  }
  // A trailing catch-all still matches an empty tail; the loop above exits as
  // soon as the URL is exhausted, so without this it was never reached.
  if (pp === patternParts.length - 1 && patternParts[pp].startsWith('*')) { params[patternParts[pp].slice(1)] = pathParts.slice(pi).join('/'); pp++; }
  if (pp === patternParts.length && pi === pathParts.length) return params;
  return null;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const isDataRequest = request.headers.get('x-vesk-data') === '1';
${serverStoreLine}

  if (__prerendered.has(pathname) && !isDataRequest) {
    return new Response(null, { status: 308, headers: { Location: '/_vesk/static/public' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname + '.html') } });
  }

  // Serve the SSR-data handoff the page references (script tag /ssr-data.js?t=...).
  // The render stashed the payload in the shared global store — mirror the node
  // prod/dev servers so edge/serverless hydration never re-fetches resources that
  // SSR already resolved. Entry is consumed on read (bound store).
  if (pathname === '/ssr-data.js') {
    const dataToken = url.searchParams.get('t') || '';
    const dataStore = (globalThis.__vsk_ssr_payload_store || {});
    const payload = dataStore[dataToken];
    if (payload) delete dataStore[dataToken];
    const dataLines = [];
    if (payload && payload.props) dataLines.push('globalThis.__vesk_props = ' + __escapeScript(JSON.stringify(payload.props)) + ';');
    if (payload && payload.ssrData) dataLines.push('globalThis.__vsk_ssr_data = ' + __escapeScript(JSON.stringify(payload.ssrData)) + ';');
    return new Response(dataLines.join('\\n') || '// no ssr data', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' },
    });
  }

  // Persisted-store pre-paint payload (buildStorePrePaintPayload) — same
  // token-stash/consume contract as /ssr-data.js, own store so neither handoff
  // can eat the other.
  if (pathname === '/store-init.js') {
    const initToken = url.searchParams.get('t') || '';
    const initStore = (globalThis.__vsk_store_init_payload_store || {});
    const initPayload = initStore[initToken];
    if (initPayload !== undefined) delete initStore[initToken];
    return new Response(initPayload ?? '// no store init', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' },
    });
  }

${eventsStartLine}
  let mwCtx = { params: {}, url, locals: ${localsSeed}, cookies: {}, request, resolveUrl(u) { return new URL(u, request.url).href; }, set() {}, get() { return undefined; } };
  if (${hasMwLiteral}) {
    mwCtx = {
      request,
      params: {},
      url,
      locals: ${localsSeed},
      cookies: typeof parseCookies !== 'undefined' ? parseCookies(request.headers.get('cookie') || '') : {},
      resolveUrl(u) { return new URL(u, request.url).href; },
      set(key, value) { this.locals[key] = value; },
      get(key) { return this.locals[key]; },
    };
  }
${eventsRequestLine}
  if (${hasMwLiteral}) {
    const mwResult = await __executeMw(mwCtx);
    if (mwResult.response) return mwResult.response;
    if (mwResult.rewriteUrl) url.pathname = mwResult.rewriteUrl;
  }
  // Expose root middleware locals to API/SSR handlers (which seed their own
  // ctx.locals from this before running route-level middleware).
  globalThis.__vesk_request = mwCtx;

  for (const route of __routes) {
    const params = __matchPath(route.path, url.pathname);
    if (!params) continue;

    if (route.type === 'api') {
      return await __invokeRoute(route, request);
    }

    if (route.revalidate && route.revalidate > 0 && !isDataRequest) {
      const cached = __isrCache.get(url.pathname);
      if (cached && Date.now() - cached.ts < route.revalidate * 1000) {
        return new Response(cached.html, {
          status: 200,
          headers: { 'Content-Type': 'text/html', ...cached.headers },
        });
      }
    }

    const response = await __invokeRoute(route, request);

    if (route.revalidate && route.revalidate > 0 && !isDataRequest) {
      const html = await response.clone().text();
      __isrCache.set(url.pathname, { html, headers: Object.fromEntries(response.headers), ts: Date.now() });
    }

    return response;
  }

  return new Response(__defaultNotFoundHtml, {
    status: 404,
    headers: { 'Content-Type': 'text/html' },
  });
}
`;
}

export interface BundlePlatformOptions {
  /** Keep real node builtins (node:fs, node:path) in the bundle. */
  nodeBuiltins?: boolean;
  outfile: string;
  entry: string;
}

export async function bundlePlatformHandler(options: BundlePlatformOptions): Promise<void> {
  const { nodeBuiltins = false, outfile, entry } = options;
  const { build } = await import('./esbuild-fallback.js');
  const plugins = [];
  if (!nodeBuiltins) {
    plugins.push({
      name: 'empty-node-builtins',
      setup(build: any) {
        const builtins = /^(node:)?(fs|module|path|child_process|os|crypto|net|stream|buffer|events|util|url|querystring|http|https|zlib|tty|async_hooks)$/;
        build.onResolve({ filter: builtins }, (args: any) => {
          return { path: args.path, namespace: 'empty-node' };
        });
        build.onLoad({ filter: /.*/, namespace: 'empty-node' }, (args: any) => {
          // async_hooks needs a usable AsyncLocalStorage shape (constructor +
          // run/getStore), not a callable-Proxy stub — the runtime's
          // per-request SSR data isolation instantiates it.
          if (/async_hooks$/.test(args.path)) {
            return {
              contents: `
export class AsyncLocalStorage {
  run(_store, fn) { return fn(); }
  getStore() { return null; }
  enterWith() {}
  exit(fn) { return fn(); }
}
`,
              loader: 'js',
            };
          }
          const contents = `
const __m = typeof Proxy !== 'undefined' ? new Proxy({}, {
  get(_, key) { return typeof key === 'string' ? () => {} : undefined; },
  has() { return true; },
}) : {};
export default __m;
export const readFileSync = () => {};
export const writeFileSync = () => {};
export const existsSync = () => {};
export const statSync = () => {};
export const realpathSync = () => '';
export const readdirSync = () => {};
export const mkdirSync = () => {};
export const unlinkSync = () => {};
export const rmSync = () => {};
export const copyFileSync = () => {};
export const accessSync = () => {};
// node:module — createRequire is server-only dead code in the browser bundle;
// the stub keeps esbuild from failing on the named import.
export const createRequire = () => () => undefined;
export const join = (...a) => a.join('/');
export const resolve = (...a) => a.join('/');
export const isAbsolute = () => false;
export const dirname = () => '';
export const basename = () => '';
export const extname = () => '';
export const relative = () => '';
export const sep = '/';
export const delimiter = ':';
export const spawnSync = () => ({ status: 0 });
export const execSync = () => '';
export const randomBytes = () => ({});
export const createHash = () => ({ update: () => {}, digest: () => '' });
`;
          return {
            contents,
            loader: 'js',
          };
        });
      },
    });
  }
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: nodeBuiltins ? 'node' : 'neutral',
    format: 'esm',
    target: ['es2022'],
    outfile,
    minify: false,
    sourcemap: false,
    // Edge targets have no node_modules so every package is bundled. Node
    // targets bundle everything too — self-contained functions avoid the
    // "Cannot find package" failures that externalization causes on hosts that
    // don't install dependencies for Build Output API functions.
    // Bundled CJS modules (e.g. pg's internals via slintorm) call
    // require('events') etc. esbuild rewrites those into its `__require`
    // shim, which throws 'Dynamic require of "events" is not supported' in
    // ESM output. Define a real `require` anchored at the bundle URL before
    // the shim initializes so Node loads builtins and node_modules for real.
    // `node:module` stays external (platform: 'node'), so Node resolves it
    // natively at runtime. Edge targets keep the empty-node builtin stubs and
    // must not get this banner (it would collide with their stubbed
    // `createRequire`).
    ...(nodeBuiltins
      ? {
          banner: {
            js:
              'import { createRequire } from "node:module";\n' +
              'const require = createRequire(import.meta.url);\n',
          },
        }
      : {}),
    logOverride: { 'direct-eval': 'silent' },
    plugins,
  });
  if (result.errors.length > 0) {
    throw new Error(`Platform bundle errors: ${result.errors.map((e: any) => e.text).join(', ')}`);
  }
}

export interface PlatformBuildContext {
  outDir: string;
  ssrRoutes: RouteNode[];
  apiRoutes: ApiRouteNode[];
  prerenderedPaths: string[];
  hasMiddleware: boolean;
  hasEvents?: boolean;
}
