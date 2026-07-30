import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import type { RouteNode, ApiRouteNode } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function routeName(segments: string[]): string {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

function apiRouteName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.map(s => s.startsWith(':') ? s.slice(1) || 'param' : s).join('_') || 'index';
}

function toId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_/, '');
}

function findCompilerSrc(): string {
  const monorepo = resolve(__dirname, '..', '..', '..', 'packages', 'compiler', 'src');
  if (existsSync(monorepo)) return monorepo;
  throw new Error('@vesk/compiler/src not found');
}

function findRuntimeSrc(): string {
  const monorepo = resolve(__dirname, '..', '..', '..', 'packages', 'runtime', 'src');
  if (existsSync(monorepo)) return monorepo;
  throw new Error('@vesk/runtime/src not found');
}

export async function generateEdgeEntry(
  outDir: string,
  ssrRoutes: RouteNode[],
  apiRoutes: ApiRouteNode[],
  prerenderedPaths: string[],
  hasMiddleware: boolean,
): Promise<string> {
  const entryFile = resolve(outDir, '.edge-entry.mjs');

  let imports = '';
  const routeEntries: string[] = [];

  for (const r of ssrRoutes) {
    const name = routeName(r.fullPath.split('/').filter(Boolean));
    const id = `__ssr_${toId(name)}`;
    const funcPath = `./server/functions/${name}.js`;
    imports += `import { handle as ${id} } from ${JSON.stringify(funcPath)};\n`;
    const revalidate = r._revalidate != null ? `revalidate: ${r._revalidate}, ` : '';
    const tags = r._isrTags ? `tags: ${JSON.stringify(r._isrTags)}, ` : '';
    routeEntries.push(`{ path: ${JSON.stringify(r.fullPath)}, type: 'ssr', handler: ${id}, ${revalidate}${tags}}`);
  }

  for (const r of apiRoutes) {
    const name = apiRouteName(r.fullPath);
    const id = `__api_${toId(name)}`;
    const funcPath = `./server/api/${name}.js`;
    imports += `import { handle as ${id} } from ${JSON.stringify(funcPath)};\n`;
    routeEntries.push(`{ path: ${JSON.stringify('/api' + r.fullPath)}, type: 'api', handler: ${id} }`);
  }

  const mwImport = hasMiddleware
    ? 'import { execute as __executeMw } from \'./server/middleware.js\';'
    : '';
  const hasMwLiteral = hasMiddleware ? 'true' : 'false';

  const prerenderedList = prerenderedPaths.length > 0
    ? `const __prerendered = new Set(${JSON.stringify(prerenderedPaths)});\n`
    : 'const __prerendered = new Set();\n';

  const isrCache = 'const __isrCache = new Map();';

  // Import parseCookies for middleware from source.
  // SSR/API functions import the runtime themselves from ../runtime.js.
  const compilerSrc = findCompilerSrc();
  const parseCookiesImport = hasMiddleware
    ? `import { parseCookies } from ${JSON.stringify(resolve(compilerSrc, 'server-cookies.ts'))};`
    : '';

  const code = `
${imports}
${parseCookiesImport}
${mwImport}
${prerenderedList}
${isrCache}
const __routes = [${routeEntries.join(',\n')}];

function __matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  let pi = 0, pp = 0;
  const params = {};
  while (pi < pathParts.length && pp < patternParts.length) {
    if (patternParts[pp].startsWith(':')) {
      const name = patternParts[pp].slice(1);
      params[name] = pathParts[pi];
      pi++; pp++;
    } else if (patternParts[pp] === pathParts[pi]) {
      pi++; pp++;
    } else {
      return null;
    }
  }
  if (pp === patternParts.length && pi === pathParts.length) return params;
  return null;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (__prerendered.has(pathname)) {
    return new Response(null, { status: 308, headers: { Location: '/_vesk/static/public' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname + '.html') } });
  }

  if (${hasMwLiteral}) {
    const mwCtx = {
      request,
      params: {},
      url,
      locals: {},
      cookies: typeof parseCookies !== 'undefined' ? parseCookies(request.headers.get('cookie') || '') : {},
      set(key, value) { this.locals[key] = value; },
      get(key) { return this.locals[key]; },
    };
    const mwResult = await __executeMw(mwCtx);
    if (mwResult.response) return mwResult.response;
    if (mwResult.rewriteUrl) url.pathname = mwResult.rewriteUrl;
  }

  for (const route of __routes) {
    const params = __matchPath(route.path, url.pathname);
    if (!params) continue;

    if (route.type === 'api') {
      return await route.handler(request);
    }

    if (route.revalidate && route.revalidate > 0) {
      const cached = __isrCache.get(url.pathname);
      if (cached && Date.now() - cached.ts < route.revalidate * 1000) {
        return new Response(cached.html, {
          status: 200,
          headers: { 'Content-Type': 'text/html', ...cached.headers },
        });
      }
    }

    const response = await route.handler(request);

    if (route.revalidate && route.revalidate > 0) {
      const html = await response.clone().text();
      __isrCache.set(url.pathname, { html, headers: Object.fromEntries(response.headers), ts: Date.now() });
    }

    return response;
  }

  return new Response('<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>', {
    status: 404,
    headers: { 'Content-Type': 'text/html' },
  });
}
`;

  writeFileSync(entryFile, code, 'utf-8');
  return entryFile;
}

export async function bundleEdgeEntry(entryFile: string, outDir: string): Promise<string> {
  const outfile = resolve(outDir, 'edge.js');
  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: ['es2022'],
    outfile,
    minify: false,
    sourcemap: false,
    logOverride: { 'direct-eval': 'silent' },
    plugins: [{
      name: 'empty-node-builtins',
      setup(build) {
        const builtins = /^(fs|path|node:fs|node:path|child_process|os|crypto|net|stream|buffer|events|util|url|querystring|http|https|zlib|tty)$/;
        build.onResolve({ filter: builtins }, () => {
          return { path: 'node-builtin-empty', namespace: 'empty-node' };
        });
        build.onLoad({ filter: /.*/, namespace: 'empty-node' }, () => ({
          contents: `
const __m = typeof Proxy !== 'undefined' ? new Proxy({}, {
  get(_, key) { return typeof key === 'string' ? () => {} : undefined; },
  has() { return true; },
}) : {};
export default __m;
export const readFileSync = () => {};
export const writeFileSync = () => {};
export const existsSync = () => {};
export const statSync = () => {};
export const readdirSync = () => {};
export const mkdirSync = () => {};
export const unlinkSync = () => {};
export const rmSync = () => {};
export const copyFileSync = () => {};
export const accessSync = () => {};
export const join = (...a) => a.join('/');
export const resolve = (...a) => a.join('/');
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
`,
          loader: 'js',
        }));
      },
    }],
  });
  if (result.errors.length > 0) {
    throw new Error(`Edge bundle errors: ${result.errors.map(e => e.text).join(', ')}`);
  }
  return outfile;
}
