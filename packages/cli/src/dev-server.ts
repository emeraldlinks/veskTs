import { readFileSync, watch, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import { transformSync } from 'esbuild';
import { renderPage, renderFullPage, renderPageStream, securityHeaders, corsHeaders, corsPreflight, createRateLimiter, applyTrustProxy, prettifyHtml, resolveComponentName } from '@vesk/compiler/src/server-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { scanRoutes, matchUrl, collectSources } from '@vesk/compiler/src/router';
import { scanApiRoutes, matchApiUrl, buildWebRequest, executeApiRoute } from '@vesk/compiler/src/api-routes';
import { collectMiddlewareChain, executeMiddlewareChain } from '@vesk/compiler/src/middleware';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import type { RouteNode, VeskPlugin } from '@vesk/compiler/src/types';

const LOG = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  dim: '\x1b[2m',
  method(m: string) {
    const colors: Record<string, string> = { GET: '\x1b[32m', POST: '\x1b[34m', PUT: '\x1b[33m', PATCH: '\x1b[33m', DELETE: '\x1b[31m', HEAD: '\x1b[90m', OPTIONS: '\x1b[36m' };
    return (colors[m] || '\x1b[37m') + m + '\x1b[0m';
  },
  status(s: number) {
    if (s < 300) return '\x1b[32m' + s + '\x1b[0m';
    if (s < 400) return '\x1b[36m' + s + '\x1b[0m';
    if (s < 500) return '\x1b[33m' + s + '\x1b[0m';
    return '\x1b[31m' + s + '\x1b[0m';
  },
  info(...args: unknown[]) { console.log('\x1b[2mvesk:\x1b[0m', ...args); },
  ok(...args: unknown[]) { console.log('\x1b[32mvesk:\x1b[0m', ...args); },
  warn(...args: unknown[]) { console.log('\x1b[33mvesk:\x1b[0m', ...args); },
  err(...args: unknown[]) { console.log('\x1b[31mvesk:\x1b[0m', ...args); },
  request(method: string, pathname: string, status: number, ms?: number) {
    const m = LOG.method(method);
    const s = LOG.status(status);
    const t = ms !== undefined ? ` \x1b[2m${ms}ms\x1b[0m` : '';
    console.log(`  ${m} ${pathname} ${s}${t}`);
  },
};

export async function startDevServer(port: number, projectDir: string, config: Record<string, unknown>): Promise<void> {

  const appDirPath = join(projectDir, 'app');
  const publicDir = join(projectDir, 'public');
  const runtimeDir = resolve(projectDir, 'node_modules', '@vesk/runtime');
  if (!existsSync(join(runtimeDir, 'ripple-runtime.js'))) {
    LOG.err('@vesk/runtime not built. Run "npm run build" (or packages/cli/build-packages.ts) first.');
    process.exit(1);
  }
  const devPlugins = (config.plugins || []) as { onBuildStart?: () => Promise<void>; onCSS?: (css: string, path: string) => Promise<string | null> }[];

  let devUserCssContent = '';
  let devTailwindCssContent = '';
  const srcDir = join(projectDir, 'src');
  const cssPath = join(srcDir, 'global.css');
  const altCssPath = join(srcDir, 'app.css');
  let rawCss = '';
  if (existsSync(cssPath)) {
    rawCss = readFileSync(cssPath, 'utf-8');
  } else if (existsSync(altCssPath)) {
    rawCss = readFileSync(altCssPath, 'utf-8');
  }
  if (rawCss) {
    for (const plugin of devPlugins) {
      if (typeof plugin.onBuildStart === 'function') {
        await plugin.onBuildStart();
      }
    }
    devUserCssContent = stripTailwindDirectives(rawCss);
    devTailwindCssContent = rawCss;
    for (const plugin of devPlugins) {
      if (typeof plugin.onCSS === 'function') {
        const result = await plugin.onCSS(rawCss, cssPath);
        if (result !== null && typeof result === 'string') {
          devTailwindCssContent = result;
        }
      }
    }
    if (devUserCssContent === devTailwindCssContent || devUserCssContent === rawCss) {
      devTailwindCssContent = devUserCssContent;
    }
  }

  let routeTree: RouteNode[] = scanRoutes(appDirPath);
  let clientBundle = '';
  let runtimeBundle = '';

  function bundleRuntime() {
    try {
      const files = [
        'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
        'context.js', 'hydrate.js', 'resource.js', 'portal.js',
        'reconcile.js', 'bindings.js', 'router-match.js', 'router-components.js', 'router.js',
        'seo.js', 'image.js', 'experiment.js', 'form.js',
      ];
      let code = '';
      for (const f of files) {
        const p = join(runtimeDir, f);
        if (existsSync(p)) {
          let src = readFileSync(p, 'utf-8');
          src = transformSync(src, { loader: 'ts' }).code;
          src = src.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\n?/gm, '');
          src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, '');
          src = src.replace(/^export\s+/gm, '');
          code += `// --- ${f} ---\n${src}\n`;
        }
      }
      const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
      const indexCompiled = transformSync(indexSrc, { loader: 'ts' }).code;
      const exportNames = indexCompiled.match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
        ?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim())) || [];
      code += '// --- exports ---\n';
      for (const name of [...new Set(exportNames)]) {
        if (name) code += `export { ${name} };\n`;
      }
      runtimeBundle = code;
      LOG.info(`runtime bundle: ${code.length} bytes`);
    } catch (e) {
      LOG.err(`runtime bundle error:`, (e as Error).message);
    }
  }

  async function buildClientBundle() {
    try {
      const { main } = await generateClientBundle(routeTree, appDirPath, new Map(), {
        importRuntime: true,
        hmr: true,
      });
      clientBundle = main;
      LOG.info(`client bundle: ${clientBundle.length} bytes`);
    } catch (e) {
      LOG.err(`client build error:`, (e as Error).message);
      throw e;
    }
  }

  bundleRuntime();
  await buildClientBundle();

  const sourceToComponents = new Map<string, string[]>();

  function updateSourceMapping() {
    sourceToComponents.clear();
    for (const [compName, sourcePath] of collectSources(routeTree)) {
      const existing = sourceToComponents.get(sourcePath) || [];
      existing.push(compName);
      sourceToComponents.set(sourcePath, existing);
    }
  }
  updateSourceMapping();

  async function rebuildTailwindCss() {
    if (!rawCss) return;
    try {
      devUserCssContent = stripTailwindDirectives(rawCss);
      devTailwindCssContent = rawCss;
      for (const plugin of devPlugins) {
        if (typeof plugin.onCSS === 'function') {
          const result = await plugin.onCSS(rawCss, cssPath);
          if (result !== null && typeof result === 'string') {
            devTailwindCssContent = result;
          }
        }
      }
    } catch (e) {
      LOG.err(`CSS rebuild error:`, (e as Error).message);
    }
  }

  const apiWatchCache = new Map<string, number>();
  try {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cssDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watchDirs = [appDirPath];
    if (existsSync(srcDir)) watchDirs.push(srcDir);
    for (const watchDir of watchDirs) {
      watch(watchDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const isVsk = filename.endsWith('.vsk');
        const isCss = filename.endsWith('.css');
        const isApiRoute = filename.endsWith('.ts') || filename.endsWith('.js') || filename.endsWith('.tsx');
        if (!isVsk && !isCss && !isApiRoute) return;

        const fullPath = filename.startsWith('/') ? filename : join(watchDir, filename);
        const fileExists = existsSync(fullPath);

        if (isVsk) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            const t0 = Date.now();
            try {
              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'compiling' });
              }

              routeTree = scanRoutes(appDirPath);
              updateSourceMapping();
              const changedComponents = sourceToComponents.get(fullPath) || [];

              clientBundle = '';
              let bundleError: Error | null = null;
              try {
                await buildClientBundle();
              } catch (e) {
                bundleError = e as Error;
                LOG.err(`client build error:`, (e as Error).message);
              }

              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                if (changedComponents.length > 0) {
                  let fnSources: Record<string, string> | undefined;
                  let errorMessage = bundleError ? bundleError.message : '';
                  if (fileExists && !bundleError) {
                    try {
                      const src = readFileSync(fullPath, 'utf-8');
                      let compCode = compileClient(src, null, { forceClient: true });
                      compCode = compCode.replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?\s*\n?/gm, '');
                      compCode = compCode.replace(/^const __components = \{\};\s*\n?/m, '');
                      compCode = compCode.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/m, '');
                      compCode = compCode.replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, '');
                      compCode = compCode.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
                      const actualName = extractCompName(src);
                      for (const cname of changedComponents) {
                        if (actualName && actualName !== cname) {
                          compCode += `\nObject.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });\n`;
                        }
                      }
                      if (compCode.trim()) fnSources = { _raw: compCode };
                    } catch (e) {
                      errorMessage = (e as Error).message;
                      LOG.err(`HMR compile error for ${filename}:`, (e as Error).message);
                    }
                  } else {
                    LOG.warn(`HMR source not found: ${fullPath}`);
                  }
                  if (fnSources) {
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({
                      type: 'update',
                      time: Date.now() - t0,
                      components: Object.fromEntries(changedComponents.map(name => [name, true])),
                      fnSources
                    });
                  } else if (errorMessage) {
                    const err = bundleError;
                    let line = 0, col = 0, file = '';
                    const suggestions: string[] = [];
                    const nextSteps: string[] = [];
                    let tip = '';
                    const errDetails = err ? (err as unknown as Record<string, unknown>) : undefined;
                    if (errDetails?.name === 'VeskError') {
                      line = (errDetails.line as number) || 0;
                      col = (errDetails.column as number) || 0;
                      file = (errDetails.file as string) || fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
                      if (errDetails.suggestions) suggestions.push(...(errDetails.suggestions as string[]));
                      if (errDetails.nextSteps) nextSteps.push(...(errDetails.nextSteps as string[]));
                      tip = (errDetails.tip as string) || '';
                    } else {
                      const lineMatch = errorMessage.match(/(?:line|at\s+line)\s*(\d+)/i);
                      const colMatch = errorMessage.match(/(?:column|col)\s*(\d+)/i);
                      const fileMatch = errorMessage.match(/(?:in|at)\s+['"]?([^'":\s]+(?:\.[a-z]+))['"]?/i);
                      line = lineMatch ? parseInt(lineMatch[1]) : 0;
                      col = colMatch ? parseInt(colMatch[1]) : 0;
                      file = fullPath.replace(projectDir, '').replace(/^\//, '') || filename || '';
                      if (fileMatch) file = fileMatch[1];
                    }
                    let code = '';
                    if (line > 0 && fileExists) {
                      try {
                        const src = readFileSync(fullPath, 'utf-8');
                        const lines = src.split('\n');
                        const start = Math.max(0, line - 3);
                        const end = Math.min(lines.length, line + 2);
                        code = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
                      } catch {}
                    }
                    const tips: string[] = [];
                    if (tip) tips.push(tip);
                    if (errorMessage.toLowerCase().includes('unexpected token')) tips.push('Check for missing or extra brackets, parentheses, or quotes.');
                    if (errorMessage.toLowerCase().includes('unexpected identifier')) tips.push('A keyword or identifier is in an unexpected position.');
                    if (errorMessage.toLowerCase().includes('expected')) tips.push('Check the syntax around the reported line.');
                    if (errorMessage.toLowerCase().includes('not defined') || errorMessage.toLowerCase().includes('is not defined')) tips.push('The variable or component may not be imported or declared.');
                    if (errorMessage.toLowerCase().includes('invalid')) tips.push('Check the expression syntax.');
                    if (errorMessage.toLowerCase().includes('component') && errorMessage.toLowerCase().includes('not')) tips.push('Ensure the component is properly defined.');
                    if (nextSteps.length) tips.push(...nextSteps);
                    if (tips.length === 0) tips.push('Review the code around the reported line.');
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({
                      type: 'error',
                      message: errorMessage,
                      file,
                      line,
                      column: col,
                      code,
                      stack: err?.stack || '',
                      tips,
                      suggestions,
                      nextSteps,
                    });
                  } else {
                    ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'reload' });
                  }
                } else {
                  ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'reload' });
                }
              }
              await rebuildTailwindCss();
              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'css-update' });
              }
              LOG.info(`rebuilt (${filename}) — ${Date.now() - t0}ms`);
            } catch (e) {
              LOG.err(`rebuild error:`, (e as Error).message);
            }
          }, 200);
        } else if (isCss) {
          if (cssDebounceTimer) clearTimeout(cssDebounceTimer);
          cssDebounceTimer = setTimeout(async () => {
            try {
              if (fileExists) {
                rawCss = readFileSync(fullPath, 'utf-8');
              }
              await rebuildTailwindCss();
              if (typeof (globalThis as Record<string, unknown>).__vesk_broadcastHmr === 'function') {
                ((globalThis as Record<string, unknown>).__vesk_broadcastHmr as (msg: Record<string, unknown>) => void)({ type: 'css-update' });
              }
              LOG.info('CSS rebuilt');
            } catch (e) {
              LOG.err(`CSS rebuild error:`, (e as Error).message);
            }
          }, 200);
        } else if (isApiRoute) {
          const isInApi = fullPath.includes('/api/');
          if (isInApi && fileExists) {
            apiWatchCache.set(fullPath, Date.now());
          }
        }
      });
    }
  } catch (e) {
    LOG.warn('file watching unavailable, serving without auto-rebuild');
  }

  const MIME: Record<string, string> = {
    '.svg': 'image/svg+xml', '.css': 'text/css', '': 'application/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.html': 'text/html', '.json': 'application/json',
  };

  const hmrJsPath = join(runtimeDir, 'hmr-client.js');
  const hmrTsPath = join(runtimeDir, 'hmr-client.ts');
  const hmrClientPath = existsSync(hmrJsPath) ? hmrJsPath : (existsSync(hmrTsPath) ? hmrTsPath : null);

  function extractCompName(src: string): string | null {
    return resolveComponentName(src);
  }

  function relaxCspForDev(sec: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!sec || sec.contentSecurityPolicy === false || sec.contentSecurityPolicy === 'off') return sec;
    let csp = sec.contentSecurityPolicy;
    if (csp === true) {
      csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
    }
    if (typeof csp === 'string' && csp.includes("script-src 'self'")) {
      csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
    }
    return { ...sec, contentSecurityPolicy: csp };
  }

  let rateLimiter: { check: (ip: string) => boolean } | null = null;
  const security = relaxCspForDev(config.security as Record<string, unknown> | undefined);
  if (security?.rateLimit) {
    const rlConfig = security.rateLimit as Record<string, unknown>;
    rateLimiter = createRateLimiter({ windowMs: (rlConfig.windowMs as number) || 60000, max: (rlConfig.max as number) || 100 });
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const reqStart = Date.now();
    const reqHost = req.headers.host || `localhost:${port}`;
    (globalThis as Record<string, unknown>).__vesk_ssr_base_url = `http://${reqHost}`;

    const logRequest = (status: number) => {
      if (url.pathname.startsWith('/_vesk')) return;
      LOG.request(req.method || 'GET', url.pathname, status, Date.now() - reqStart);
    };

    const rawCtx = buildRequestContext(req);
    if (security?.trustProxy) {
      applyTrustProxy(rawCtx, security.trustProxy as boolean | string);
    }

    if (rateLimiter) {
      const clientIp = (rawCtx.ip as string) || req.socket?.remoteAddress || 'unknown';
      if (!rateLimiter.check(clientIp)) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(((security?.rateLimit as Record<string, unknown>)?.windowMs as number || 60000) / 1000)),
        });
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: Math.ceil(((security?.rateLimit as Record<string, unknown>)?.windowMs as number || 60000) / 1000) }));
        return;
      }
    }

    const reqOrigin = req.headers['origin'] || '';
    const corsAllowed = corsHeaders(security || {}, reqOrigin, reqHost);
    if (corsAllowed['Access-Control-Allow-Origin'] && req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsAllowed, 'Content-Length': '0' });
      res.end();
      return;
    }
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = ((statusCode: number, headers?: Record<string, string | number | string[]>) => {
      return origWriteHead(statusCode, { ...headers, ...corsAllowed } as Record<string, string | number | string[]>);
    }) as typeof res.writeHead;

    if (url.pathname === '/_vesk/runtime' || url.pathname === '/_vesk/runtime.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(runtimeBundle);
      return;
    }
    if (url.pathname === '/_vesk/client' || url.pathname === '/_vesk/client.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(clientBundle);
      return;
    }
    if (url.pathname === '/_vesk/static/global.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(devUserCssContent);
      return;
    }
    if (url.pathname === '/_vesk/static/_tailwind.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(devTailwindCssContent);
      return;
    }
    if (url.pathname === '/_vesk/hmr' || url.pathname === '/_vesk/hmr.js') {
      if (hmrClientPath) {
        let hmrContent = readFileSync(hmrClientPath, 'utf-8');
        if (hmrClientPath.endsWith('.ts')) {
          hmrContent = transformSync(hmrContent, { loader: 'ts' }).code;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(hmrContent);
        return;
      }
    }

    if (url.pathname !== '/') {
      const staticPath = join(publicDir, url.pathname);
      if (existsSync(staticPath) && statSync(staticPath).isFile()) {
        const ext = extname(staticPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(staticPath));
        return;
      }
    }

    const mwChain = collectMiddlewareChain(routeTree, url.pathname, appDirPath);

    const apiDirPath = join(appDirPath, 'api');
    if (url.pathname.startsWith('/api') && existsSync(apiDirPath)) {
      const apiRoutes = await scanApiRoutes(apiDirPath);
      const apiMatch = matchApiUrl(apiRoutes, req.url || url.pathname);
      if (apiMatch) {
        const bodyChunks: Buffer[] = [];
        for await (const chunk of req) bodyChunks.push(chunk as Buffer);
        const bodyBuffer = Buffer.concat(bodyChunks);
        const requestUrl = req.url ? `http://localhost:${port}${req.url.startsWith('/') ? req.url : '/' + req.url}` : url.href;
        const rawHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          rawHeaders[k] = Array.isArray(v) ? v.join(', ') : (v || '');
        }

        let apiLocals: Record<string, unknown> = {};
        if (mwChain.length > 0) {
          const mwReq = new Request(requestUrl, { headers: rawHeaders, method: req.method || 'GET' });
          const mwResult = await executeMiddlewareChain(mwChain, mwReq, apiMatch.params, {
            plugins: (config.plugins || []) as VeskPlugin[],
            onLast: async () => new Response(null),
          });
          apiLocals = mwResult.locals || {};
        }

        const webRequest = buildWebRequest(req, req.url || url.pathname, bodyBuffer.length ? bodyBuffer : null);
        const response = await executeApiRoute(apiMatch.node.filePath!, (req.method || 'GET').toUpperCase(), webRequest, apiMatch.params, apiLocals, apiWatchCache);
        if (!response) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('API route returned no response');
          return;
        }
        logRequest(response.status);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        const body = await response.text();
        res.end(body);
        return;
      }
    }

    const ctx = rawCtx;

    const match = matchUrl(routeTree, url.pathname);

    if (!match) {
      const rootNode = routeTree.find(n => (n.fullPath as string) === '/');
      let notFoundHtml: string | null = null;
      if (rootNode && rootNode.notFound) {
        const nfPath = resolve(appDirPath, rootNode.sourceDir as string, 'not-found.vsk');
        if (existsSync(nfPath)) {
          try {
            const nfSrc = readFileSync(nfPath, 'utf-8');
            const nfCompName = extractCompName(nfSrc) || (rootNode.notFound as string);
            notFoundHtml = await renderFullPage(nfSrc, nfCompName, { params: {}, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security });
          } catch {}
        }
      }
      logRequest(404);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(notFoundHtml || `<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`);
      return;
    }

    const urlParts = url.pathname.split('/').filter(Boolean);
    const cleanChain: RouteNode[] = [];
    let segIdx = 0;
    for (const node of match.nodes) {
      if (node.fullPath === '/') {
        cleanChain.push(node);
      } else if (!node.isGroup && (node.segmentCount as number) > 0) {
        if (segIdx < urlParts.length) {
          cleanChain.push(node);
          segIdx++;
        }
      } else {
        cleanChain.push(node);
      }
    }
    const matched = match;

    async function renderSSR() {
      const chain = cleanChain;
      let body = '';
      let head = '';

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
        const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

        if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
          const src = readFileSync(pageFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.page as string);
          const result = await renderPage(src, compName, { params: matched.params }, new Map(), { hydrate: true });
          body = result.body;
          head = result.head || '';
        }

        if (node.layout && existsSync(layoutFilePath)) {
          const src = readFileSync(layoutFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.layout as string);
          const result = await renderPage(src, compName, { children: body }, new Map(), { hydrate: true });
          body = result.body;
          head = (result.head || '') + head;
        }
      }

      const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));
      let html: string;
      if (hasLayout) {
        let secMeta = '';
        if (security) {
          if (security.referrerPolicy !== false) secMeta += `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
          if (security.contentSecurityPolicy !== false) secMeta += `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
          if (security.autoEscape !== false) secMeta += '\t<!-- vesk: auto-escape enabled -->\n';
        }
        html = `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
      } else {
        const leaf = chain.find(n => n.page);
        if (leaf) {
          const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
          const compName = extractCompName(src) || (leaf.page as string);
          html = await renderFullPage(src, compName, { params: matched.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security });
          html = html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } else {
          throw new Error('No page or layout matched');
        }
      }
      return html;
    }

    async function* renderSSRStream() {
      const chain = cleanChain;
      const hasLayout = chain.some(n => n.layout && existsSync(resolve(appDirPath, n.sourceDir as string, 'layout.vsk')));

      if (!hasLayout) {
        const leaf = chain.find(n => n.page);
        if (leaf) {
          const src = readFileSync(resolve(appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
          const compName = extractCompName(src) || (leaf.page as string);
          yield* renderPageStream(src, compName, { params: matched.params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security });
        } else {
          throw new Error('No page or layout matched');
        }
        return;
      }

      let body = '';
      let head = '';

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve(appDirPath, node.sourceDir as string, 'page.vsk');
        const layoutFilePath = resolve(appDirPath, node.sourceDir as string, 'layout.vsk');

        if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
          const src = readFileSync(pageFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.page as string);
          const result = await renderPage(src, compName, { params: matched.params }, new Map(), { hydrate: true });
          body = result.body;
          head = result.head || '';
        }

        if (node.layout && existsSync(layoutFilePath)) {
          const src = readFileSync(layoutFilePath, 'utf-8');
          const compName = extractCompName(src) || (node.layout as string);
          const result = await renderPage(src, compName, { children: body }, new Map(), { hydrate: true });
          body = result.body;
          head = (result.head || '') + head;
        }
      }

      yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n';
      if (security) {
        if (security.referrerPolicy !== false) yield `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
        if (security.contentSecurityPolicy !== false) yield `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
        if (security.autoEscape !== false) yield '\t<!-- vesk: auto-escape enabled -->\n';
      }
      if (head) yield '\t' + head.split('\n').join('\n\t') + '\n';
      yield '</head>\n<body>\n<div id="root">\n';
      yield prettifyHtml(body);
      yield '\n</div>\n</body>\n</html>';
    }

    let mwLocals: Record<string, unknown> = {};
    try {
      if (mwChain.length > 0) {
        const mwReq = new Request(`http://localhost${url.pathname}${url.search}`, {
          headers: req.headers as Record<string, string>,
          method: req.method || 'GET',
        });
        const mwResult = await executeMiddlewareChain(mwChain, mwReq, match.params, {
          plugins: (config.plugins || []) as VeskPlugin[],
          onLast: async (rewrite: string | null) => {
            if (rewrite) url.pathname = rewrite;
            const prev = (globalThis as Record<string, unknown>).__vesk_request;
            (globalThis as Record<string, unknown>).__vesk_request = ctx;
            try {
              const html = await renderSSR();
              const secHeaders = security ? securityHeaders({ security }) : {};
              return new Response(html, { headers: { 'Content-Type': 'text/html', ...secHeaders } });
            } finally {
              (globalThis as Record<string, unknown>).__vesk_request = prev;
            }
          },
        });
        mwLocals = mwResult.locals;
        if (mwResult.response) {
          const respRecord = mwResult.response as unknown as Record<string, unknown>;
          if (typeof respRecord.build === 'function') (respRecord.build as () => void)();
          logRequest(mwResult.response.status);
          res.writeHead(mwResult.response.status, Object.fromEntries(mwResult.response.headers));
          res.end(await mwResult.response.text());
          return;
        }
      } else {
        const prev = (globalThis as Record<string, unknown>).__vesk_request;
        (globalThis as Record<string, unknown>).__vesk_request = ctx;
        try {
          const stream = renderSSRStream();
          const secHeaders = security ? securityHeaders({ security }) : {};
          logRequest(200);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Transfer-Encoding': 'chunked', ...secHeaders });
          for await (const chunk of stream) {
            if (chunk.includes('</body>')) {
              res.write(chunk.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>'));
            } else {
              res.write(chunk);
            }
          }
          res.end();
        } finally {
          (globalThis as Record<string, unknown>).__vesk_request = prev;
        }
        return;
      }
    } catch (e) {
      const err = e as Error & { name: string; status?: number; url?: string; stack?: string };
      if (err.name === 'Redirect') {
        const status = err.status || 302;
        logRequest(status);
        res.writeHead(status, { Location: err.url });
        res.end(`<!DOCTYPE html><html><body><a href="${err.url}">Redirect</a></body></html>`);
      } else if (err.name === 'NotFoundError') {
        let notFoundHtml: string | null = null;
        if (match && match.nodes) {
          for (let i = match.nodes.length - 1; i >= 0; i--) {
            const node = match.nodes[i];
            if (node.notFound) {
              const nfPath = resolve(appDirPath, node.sourceDir as string, 'not-found.vsk');
              if (existsSync(nfPath)) {
                try {
                  const nfSrc = readFileSync(nfPath, 'utf-8');
                  const nfCompName = extractCompName(nfSrc) || (node.notFound as string);
                  const html = await renderFullPage(nfSrc, nfCompName, { params: match.params, url: url.pathname }, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security });
                  notFoundHtml = html.replace('</body>',
                    `\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
                } catch {}
              }
              break;
            }
          }
        }
        logRequest(404);
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(notFoundHtml || '<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>');
      } else {
        let errorHtml: string | null = null;
        if (match && match.nodes) {
          for (let i = match.nodes.length - 1; i >= 0; i--) {
            const node = match.nodes[i];
            if (node.error) {
              const errPath = resolve(appDirPath, node.sourceDir as string, 'error.vsk');
              if (existsSync(errPath)) {
                try {
                  const errSrc = readFileSync(errPath, 'utf-8');
                  const errCompName = extractCompName(errSrc) || (node.error as string);
                  const errProps = { error: err.message, stack: err.stack, statusCode: 500, url: url.pathname };
                  const html = await renderFullPage(errSrc, errCompName, errProps, new Map(), { hydrate: true, cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security });
                  errorHtml = html.replace('</body>', `\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>`);
                } catch (e2) {
                  LOG.err(`error page render failed:`, (e2 as Error).message);
                }
              }
              break;
            }
          }
        }
        logRequest(500);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(errorHtml || `<!DOCTYPE html><html><body><h1>500</h1><pre>${err.message}\n${err.stack}</pre></body></html>`);
      }
    }
  });

  server.listen(port, () => {
    LOG.ok(`dev server at http://localhost:${port}`);
  });

  updateSourceMapping();

  const hmrClients = new Set<import('ws').WebSocket>();
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    hmrClients.add(ws);
    ws.on('close', () => hmrClients.delete(ws));
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/_vesk/hmr') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  (globalThis as Record<string, unknown>).__vesk_broadcastHmr = (update: Record<string, unknown>) => {
    const msg = JSON.stringify(update);
    for (const ws of hmrClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  };

  await new Promise(() => {});
}

function stripTailwindDirectives(css: string): string {
  const blockStart = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/;
  css = css.replace(/^\s*@import\s+['"]tailwindcss['"]\s*;?\s*$/gm, '');
  css = css.replace(/^\s*@source\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  const lines = css.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (blockStart.test(lines[i].trim())) {
      let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      i++;
      while (i < lines.length && braceCount > 0) {
        braceCount += (lines[i].match(/\{/g) || []).length;
        braceCount -= (lines[i].match(/\}/g) || []).length;
        i++;
      }
      continue;
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n').trim();
}

function buildRequestContext(req: IncomingMessage): {
  headers: Record<string, string>;
  url: string | undefined;
  method: string;
  cookies: Record<string, string>;
  locals: Record<string, unknown>;
  ip?: string;
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(', ') : (v || '');
  }
  const cookies: Record<string, string> = {};
  const raw = req.headers.cookie || '';
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) cookies[k] = v;
  }
  return { headers, url: req.url, method: req.method || 'GET', cookies, locals: {}, ip: undefined };
}
