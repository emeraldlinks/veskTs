import { writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { generatePlatformHandlerSource, bundlePlatformHandler, type PlatformBuildContext } from '@vesk/adapter/src/platform-handler';
import { ensureCleanDir, writePlatformStatic, writePrerenderedStatic, listStaticDir, mimeFor } from '@vesk/adapter/src/platform-output';
import type { SsgRouteResult } from '@vesk/adapter/src/types';
import type { Platform } from '@vesk/adapter/src/platform';

export interface DeployContext extends PlatformBuildContext {
  prerenderedRoutes: SsgRouteResult[];
}

interface Shell {
  /** Artifact root, relative to the project root. */
  root: string;
  /** Keep real node builtins (fs/path) — needed when the target runtime is Node. */
  nodeBuiltins: boolean;
  /** Static files: null/omitted = served by the platform CDN, 'embedded' = served by the handler. */
  staticMode: 'platform' | 'embedded';
  /** Where the static layout lives inside the artifact root ('' = artifact root, 'static' = static/). */
  staticSubdir?: string;
  /** How an embedded handler reads static: Deno file reads, Node fs, or inlined into the bundle. */
  staticServe?: 'disk-deno' | 'disk-node' | 'inline';
  /** Bundle output file (default index.js), or the function file when functionFile is set. */
  outfile?: string;
  /** Extra module imports prepended to the entry (e.g. node:fs for disk-node). */
  imports?: string;
  /** Platform function file (dir relative to artifact root) with an optional runtime config. */
  functionFile?: { dir: string; file: string };
  functionConfig?: Record<string, unknown>;
  /** Bootstrap appended after the universal handler. */
  bootstrap: string;
  /** Extra static files written into the artifact root after bundling. */
  extraFiles?: Array<{ path: string; content: string }>;
}

/**
 * Universal deployment emit. The handler, the bundle and the static layout are
 * shared across every platform — only the ~10-line shell each runtime mandates
 * differs (artifact directory, bootstrap, function config). Deno-based platforms
 * (Coxmos, Deno Deploy) share the exact same shell.
 *
 * Every artifact is written under `.vesk/<platform>/`; Vercel additionally gets
 * a gitignored `.vercel/output` symlink because the Build Output API is keyed on
 * that literal directory.
 */
export async function emitPlatformOutput(platform: Platform, ctx: DeployContext): Promise<string | null> {
  if (platform === 'node') return null;

  const prerenderedPaths = ctx.prerenderedRoutes.map(r => r.path);
  const handler = generatePlatformHandlerSource({
    ssrRoutes: ctx.ssrRoutes,
    apiRoutes: ctx.apiRoutes,
    prerenderedPaths,
    hasMiddleware: ctx.hasMiddleware,
  });

  const shell = shellFor(platform);
  const projectRoot = resolve(ctx.outDir, '..');
  const outRoot = resolve(projectRoot, shell.root);
  ensureCleanDir(outRoot);

  const staticDir = shell.staticSubdir === '' ? outRoot : resolve(outRoot, shell.staticSubdir || 'static');
  writePlatformStatic(resolve(ctx.outDir, 'static'), staticDir);
  writePrerenderedStatic(ctx.prerenderedRoutes, staticDir);

  const entry = resolve(ctx.outDir, '.platform-entry.mjs');
  let source = handler;
  if (shell.imports) source = `${shell.imports}\n${source}`;
  if (shell.staticMode === 'embedded') {
    if (shell.staticServe === 'disk-deno') source += `\n${denoStaticSource()}`;
    else if (shell.staticServe === 'disk-node') source += `\n${nodeStaticSource()}`;
    else if (shell.staticServe === 'inline') source += `\n${inlineStaticSource(staticDir)}`;
  }
  source += `\n${shell.bootstrap}\n`;
  writeFileSync(entry, source, 'utf-8');

  let handlerRel: string;
  if (shell.functionFile) {
    const funcDir = resolve(outRoot, shell.functionFile.dir);
    mkdirSync(funcDir, { recursive: true });
    if (shell.functionConfig) {
      writeFileSync(resolve(funcDir, '.vc-config.json'), JSON.stringify(shell.functionConfig, null, 2), 'utf-8');
    }
    handlerRel = `${shell.functionFile.dir}/${shell.functionFile.file}`;
    await bundlePlatformHandler({ entry, outfile: resolve(funcDir, shell.functionFile.file), nodeBuiltins: shell.nodeBuiltins });
  } else {
    handlerRel = shell.outfile || 'index.js';
    await bundlePlatformHandler({ entry, outfile: resolve(outRoot, handlerRel), nodeBuiltins: shell.nodeBuiltins });
  }

  for (const file of shell.extraFiles || []) {
    writeFileSync(resolve(outRoot, file.path), file.content, 'utf-8');
  }

  if (platform === 'vercel') {
    writeFileSync(resolve(outRoot, 'config.json'), vercelConfigJson(prerenderedPaths), 'utf-8');
  }

  writeFileSync(resolve(outRoot, 'manifest.json'), JSON.stringify({
    platform,
    runtime: shell.nodeBuiltins ? 'node' : 'edge',
    static: shell.staticMode,
    handler: handlerRel,
    routes: ctx.ssrRoutes.map(r => r.fullPath),
    apiRoutes: ctx.apiRoutes.map(r => '/api' + r.fullPath),
    prerendered: prerenderedPaths,
  }, null, 2), 'utf-8');

  if (platform === 'vercel') {
    const vercelDir = resolve(projectRoot, '.vercel');
    mkdirSync(vercelDir, { recursive: true });
    const linkPath = resolve(vercelDir, 'output');
    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(relative(dirname(linkPath), outRoot), linkPath, 'dir');
  }

  rmSync(entry, { force: true });
  return outRoot;
}

function vercelConfigJson(prerenderedPaths: string[]): string {
  const escapeRegex = (p: string): string => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prerenderRoutes = prerenderedPaths.map(p => {
    const htmlRel = p === '/' ? '/index.html' : `${p.replace(/\/$/, '')}.html`;
    return { src: `^${escapeRegex(p === '/' ? '/' : p)}/?$`, dest: `/_vesk/static/public${htmlRel}` };
  });
  return JSON.stringify({
    version: 3,
    routes: [
      ...prerenderRoutes,
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/__index' },
    ],
  }, null, 2);
}

function __relsSource(): string {
  return `function __rels(p) {
  if (p === '/' || p === '') return ['index.html'];
  if (p.startsWith('/_vesk/static/') || p === '/_vesk/runtime.js') return [p === '/_vesk/runtime.js' ? '_vesk/runtime.js' : p.slice(1)];
  if (p.endsWith('/')) return [p.slice(1) + 'index.html', p.slice(1, -1) + '.html'];
  return [p.slice(1), p.slice(1) + '.html', p.slice(1) + '/index.html'];
}`;
}

function __mimeSource(): string {
  return `function __mime(rel) {
  const i = rel.lastIndexOf('.');
  const ext = i === -1 ? '' : rel.slice(i).toLowerCase();
  const m = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.wasm': 'application/wasm', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
  };
  return m[ext] || 'application/octet-stream';
}`;
}

function denoStaticSource(): string {
  return `${__relsSource()}
${__mimeSource()}
const __staticUrl = new URL('./static/', import.meta.url);
async function serveEmbeddedStatic(request) {
  const __url = new URL(request.url);
  for (const rel of __rels(__url.pathname)) {
    try {
      const data = await Deno.readFile(new URL(rel, __staticUrl));
      return new Response(data, { headers: { 'Content-Type': __mime(rel) } });
    } catch {}
  }
  return null;
}`;
}

function nodeStaticSource(): string {
  return `${__relsSource()}
${__mimeSource()}
const __staticUrl = new URL('./static/', import.meta.url);
function serveEmbeddedStatic(request) {
  const __url = new URL(request.url);
  for (const rel of __rels(__url.pathname)) {
    try {
      return new Response(readFileSync(new URL(rel, __staticUrl)), { headers: { 'Content-Type': __mime(rel) } });
    } catch {}
  }
  return null;
}`;
}

function inlineStaticSource(staticDir: string): string {
  const files = listStaticDir(staticDir);
  const entries = files.map(f => {
    const t = mimeFor(f.rel);
    const isText = /\.(html|htm|js|mjs|css|json|svg|txt|xml|map|webmanifest)$/i.test(f.rel);
    return isText
      ? `${JSON.stringify(f.rel)}: { t: ${JSON.stringify(t)}, s: ${JSON.stringify(f.buffer.toString('utf8'))} }`
      : `${JSON.stringify(f.rel)}: { t: ${JSON.stringify(t)}, b: ${JSON.stringify(f.buffer.toString('base64'))} }`;
  });
  return `${__relsSource()}
const __STATIC = { ${entries.join(', ')} };
function __decode(e) {
  if (e.s !== undefined) return new TextEncoder().encode(e.s);
  return new Uint8Array(atob(e.b).split('').map(function (c) { return c.charCodeAt(0); }));
}
function serveEmbeddedStatic(request) {
  const __url = new URL(request.url);
  for (const rel of __rels(__url.pathname)) {
    const entry = __STATIC[rel];
    if (entry) return new Response(__decode(entry), { headers: { 'Content-Type': entry.t } });
  }
  return null;
}`;
}

function shellFor(platform: Platform): Shell {
  switch (platform) {
    case 'vercel':
      return {
        root: '.vesk/vercel',
        nodeBuiltins: true,
        staticMode: 'platform',
        staticSubdir: 'static',
        functionFile: {
          dir: 'functions/__index.func',
          file: 'index.js',
        },
        functionConfig: {
          runtime: 'nodejs22.x',
          handler: 'index.js',
          launcherType: 'Nodejs',
          shouldAddHelpers: false,
          shouldAddSourcemapSupport: false,
          supportsResponseStreaming: true,
        },
        bootstrap: [
          'export default async function veskNodeEntry(req, res) {',
          "  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));",
          "  const method = req.method || 'GET';",
          '  let body;',
          "  if (method !== 'GET' && method !== 'HEAD') {",
          '    body = await new Promise((resolveBody, reject) => {',
          '      const chunks = [];',
          "      req.on('data', (c) => chunks.push(c));",
          '      req.on("error", reject);',
          '      req.on("end", () => resolveBody(Buffer.concat(chunks)));',
          '    });',
          '  }',
          '  const headers = {};',
          '  for (const key in req.headers) headers[key] = req.headers[key];',
          '  const request = new Request(url, { method, headers, body });',
          '  const response = await handleRequest(request);',
          '  res.writeHead(response.status, Object.fromEntries(response.headers));',
          '  res.end(await response.text());',
          '}',
        ].join('\n'),
      };

    case 'netlify':
      return {
        root: '.vesk/netlify',
        nodeBuiltins: true,
        staticMode: 'platform',
        staticSubdir: '',
        functionFile: {
          dir: 'functions',
          file: '__index.js',
        },
        bootstrap: [
          'export default { fetch: handleRequest };',
          "export const config = { path: '/*', preferStatic: true };",
        ].join('\n'),
      };

    case 'cloudflare':
      return {
        root: '.vesk/cloudflare',
        nodeBuiltins: false,
        staticMode: 'platform',
        staticSubdir: '',
        outfile: '_worker.js',
        bootstrap: [
          'export default {',
          '  async fetch(request, env) {',
          '    const response = await handleRequest(request);',
          '    if (response.status !== 404) return response;',
          '    if (env && env.ASSETS) {',
          '      try {',
          '        const asset = await env.ASSETS.fetch(request);',
          '        if (asset.status !== 404) return asset;',
          '      } catch {}',
          '    }',
          '    return response;',
          '  }',
          '};',
        ].join('\n'),
      };

    case 'deno':
    case 'coxmos':
      return {
        root: platform === 'coxmos' ? '.vesk/coxmos' : '.vesk/deno',
        nodeBuiltins: false,
        staticMode: 'embedded',
        staticSubdir: 'static',
        staticServe: 'disk-deno',
        bootstrap: [
          'if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {',
          '  const __veskPort = Number(Deno.env.get("PORT") || 8000);',
          '  Deno.serve({ port: __veskPort }, async (request) => {',
          '    const staticResponse = await serveEmbeddedStatic(request);',
          '    if (staticResponse) return staticResponse;',
          '    return handleRequest(request);',
          '  });',
          '}',
          'export default handleRequest;',
        ].join('\n'),
      };

    case 'aws':
      return {
        root: '.vesk/aws',
        nodeBuiltins: true,
        staticMode: 'embedded',
        staticSubdir: 'static',
        staticServe: 'disk-node',
        imports: "import { readFileSync } from 'node:fs';",
        outfile: 'index.mjs',
        extraFiles: [
          {
            path: 'package.json',
            content: JSON.stringify({ name: 'vesk-aws-app', type: 'module', private: true }, null, 2),
          },
          {
            path: 'template.yaml',
            content: [
              "AWSTemplateFormatVersion: '2010-09-09'",
              'Transform: AWS::Serverless-2016-10-31',
              'Description: Vesk application deployed to AWS Lambda via SAM',
              '',
              'Resources:',
              '  VeskFunction:',
              '    Type: AWS::Serverless::Function',
              '    Properties:',
              '      CodeUri: ./',
              '      Handler: index.handler',
              '      Runtime: nodejs22.x',
              '      MemorySize: 512',
              '      Timeout: 30',
              '      Events:',
              '        HttpApiEvent:',
              '          Type: HttpApi',
              '          Properties:',
              '            Auth:',
              '              Authorizer: NONE',
              '            Path: $default',
              '            Method: ANY',
              '',
            ].join('\n'),
          },
        ],
        bootstrap: [
          'export async function handler(event) {',
          "  const url = new URL(event.rawPath || '/', 'http://' + (event.headers?.host || 'lambda.local'));",
          "  if (event.rawQueryString) url.search = event.rawQueryString;",
          '  const headers = {};',
          '  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = String(v);',
          '  let body;',
          '  if (event.body) {',
          "    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;",
          '  }',
          "  const request = new Request(url, { method: event.requestContext?.http?.method || event.httpMethod || 'GET', headers, body });",
          '  const response = await handleRequest(request);',
          "  return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.text()).toString('base64'), isBase64Encoded: true };",
          '}',
        ].join('\n'),
      };

    case 'edge':
      return {
        root: '.vesk/edge',
        nodeBuiltins: false,
        staticMode: 'embedded',
        staticSubdir: 'static',
        staticServe: 'inline',
        bootstrap: [
          'export async function handleEdgeRequest(request) {',
          '  const staticResponse = await serveEmbeddedStatic(request);',
          '  if (staticResponse) return staticResponse;',
          '  return handleRequest(request);',
          '}',
          'export default handleEdgeRequest;',
        ].join('\n'),
      };

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
