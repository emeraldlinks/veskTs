import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileFile,
  renderPage,
  renderFullPage,
  prettifyHtml,
  resolveComponentName,
} from '@vesk/compiler/src/server-codegen';
import { matchUrl, type MatchResult } from '@vesk/compiler/src/router';
import { buildWebRequest } from '@vesk/compiler/src/api-routes';
import { assertSameOrigin, DEFAULT_MAX_BODY_BYTES } from '@vesk/compiler/src/server-utils';
import { parseCookies } from '@vesk/compiler/src/server-cookies';
import { getAction, validateActionInput, issuesToFieldMap } from '@vesk/runtime/src/action';
import type { RouteNode } from '@vesk/compiler/src/types';

export interface ActionHandlerContext {
  url: URL;
  appDirPath: string;
  routeTree: RouteNode[];
  security?: Record<string, unknown>;
  maxBodyBytes?: number;
}

function chainForPath(routeTree: RouteNode[], pathname: string): RouteNode[] {
  const match = matchUrl(routeTree, pathname);
  if (!match) return [];
  const urlParts = pathname.split('/').filter(Boolean);
  const chain: RouteNode[] = [];
  let segIdx = 0;
  for (const node of match.nodes) {
    if (node.fullPath === '/') {
      chain.push(node);
    } else if (!node.isGroup && (node.segmentCount as number) > 0) {
      if (segIdx < urlParts.length) {
        chain.push(node);
        segIdx++;
      }
    } else {
      chain.push(node);
    }
  }
  return chain;
}

function pageSourcesFor(appDirPath: string, routeTree: RouteNode[]): string[] {
  const out: string[] = [];
  function walk(nodes: RouteNode[]): void {
    for (const node of nodes) {
      if (node.page) out.push(resolve(appDirPath, node.sourceDir as string, 'page.vsk'));
      if (node.layout) out.push(resolve(appDirPath, node.sourceDir as string, 'layout.vsk'));
      walk(node.children);
    }
  }
  walk(routeTree);
  return out;
}

function walkVskFiles(dir: string, out: string[], seen: Set<string>): void {
  if (!existsSync(dir)) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as unknown as import('node:fs').Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (seen.has(full)) continue;
    seen.add(full);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vesk') continue;
      walkVskFiles(full, out, seen);
    } else if (entry.isFile() && entry.name.endsWith('.vsk')) {
      out.push(full);
    }
  }
}

function candidateSources(appDirPath: string, routeTree: RouteNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of pageSourcesFor(appDirPath, routeTree)) {
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  const projectRoot = resolve(appDirPath, '..');
  for (const dir of [resolve(projectRoot, 'components'), appDirPath, projectRoot]) {
    walkVskFiles(dir, out, seen);
  }
  return out;
}

function registerSource(sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  try {
    compileFile(readFileSync(sourcePath, 'utf-8'), { sourcePath });
  } catch {
    // ignore compile errors while probing for the action owner
  }
}

function ensureActionRegistered(actionId: string, pagePathname: string, appDirPath: string, routeTree: RouteNode[]): void {
  if (getAction(actionId)) return;
  const match = matchUrl(routeTree, pagePathname);
  if (match) {
    for (let i = match.nodes.length - 1; i >= 0; i--) {
      registerSource(resolve(appDirPath, match.nodes[i].sourceDir as string, 'page.vsk'));
      registerSource(resolve(appDirPath, match.nodes[i].sourceDir as string, 'layout.vsk'));
    }
  }
  if (getAction(actionId)) return;
  for (const sourcePath of candidateSources(appDirPath, routeTree)) {
    if (getAction(actionId)) break;
    registerSource(sourcePath);
  }
}

function securityMeta(security?: Record<string, unknown>): string {
  if (!security) return '';
  let meta = '';
  if (security.referrerPolicy !== false) meta += `\t<meta name="referrer" content="${(security.referrerPolicy as string) || 'strict-origin-when-cross-origin'}" />\n`;
  if (security.contentSecurityPolicy !== false) meta += `\t<meta http-equiv="Content-Security-Policy" content="${((security.contentSecurityPolicy as string) || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
  if (security.autoEscape !== false) meta += '\t<!-- vesk: auto-escape enabled -->\n';
  return meta;
}

async function renderPageHtml(pagePathname: string, params: Record<string, string>, ctx: ActionHandlerContext): Promise<string | null> {
  const chain = chainForPath(ctx.routeTree, pagePathname);
  if (chain.length === 0) return null;

  let body = '';
  let head = '';
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    const pageFilePath = resolve(ctx.appDirPath, node.sourceDir as string, 'page.vsk');
    const layoutFilePath = resolve(ctx.appDirPath, node.sourceDir as string, 'layout.vsk');

    if (i === chain.length - 1 && node.page && existsSync(pageFilePath)) {
      const src = readFileSync(pageFilePath, 'utf-8');
      const compName = resolveComponentName(src) || (node.page as string);
      const result = await renderPage(src, compName, { params }, new Map(), { hydrate: true, sourcePath: pageFilePath });
      body = result.body;
      head = result.head || '';
    }

    if (node.layout && existsSync(layoutFilePath)) {
      const src = readFileSync(layoutFilePath, 'utf-8');
      const compName = resolveComponentName(src) || (node.layout as string);
      const result = await renderPage(src, compName, { children: body }, new Map(), { hydrate: true, sourcePath: layoutFilePath });
      body = result.body;
      head = (result.head || '') + head;
    }
  }

  const hasLayout = chain.some(n => n.layout && existsSync(resolve(ctx.appDirPath, n.sourceDir as string, 'layout.vsk')));
  if (hasLayout) {
    const secMeta = securityMeta(ctx.security);
    return `<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />\n\t<link rel="stylesheet" href="/_vesk/static/global.css" />\n${secMeta}${head ? '\t' + head.split('\n').join('\n\t') + '\n' : ''}</head>\n<body>\n<div id="root">\n${prettifyHtml(body)}\n</div>\n\t<script type="module" src="/_vesk/client.js"></script>\n\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>\n</html>`;
  }

  const leaf = chain.find(n => n.page);
  if (!leaf) return null;
  const src = readFileSync(resolve(ctx.appDirPath, leaf.sourceDir as string, 'page.vsk'), 'utf-8');
  const compName = resolveComponentName(src) || (leaf.page as string);
  const html = await renderFullPage(src, compName, { params }, new Map(), { hydrate: true, clientScriptUrl: '/_vesk/client.js', cssUrls: ['/_vesk/static/_tailwind.css', '/_vesk/static/global.css'], security: ctx.security, sourcePath: resolve(ctx.appDirPath, leaf.sourceDir as string, 'page.vsk') });
  return html.replace('</body>', '\t<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
}

/**
 * Handle a `/_vesk/action/:id` request in the dev server.
 *
 * Mirrors the production `handleAction` behaviour: parse the request body by
 * content-type, validate the action input, and either re-render the referer
 * page with field errors or execute the action and redirect / return JSON.
 *
 * Returns `false` when the request is not an action request, so the caller can
 * fall through to normal routing.
 */
export async function handleActionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ActionHandlerContext,
): Promise<boolean> {
  const { url, appDirPath, routeTree } = ctx;
  if (!url.pathname.startsWith('/_vesk/action/')) return false;

  // CSRF defense: reject cross-site browser submissions before any work.
  try {
    assertSameOrigin({ method: req.method, headers: req.headers });
  } catch {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Cross-origin request blocked' }));
    return true;
  }

  const actionId = url.pathname.replace('/_vesk/action/', '');

  const chunks: Buffer[] = [];
  let bodyTotal = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    bodyTotal += (chunk as Buffer).byteLength;
    if (bodyTotal > (ctx.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)) { tooLarge = true; break; }
    chunks.push(chunk as Buffer);
  }
  if (tooLarge) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Request body exceeds limit (${ctx.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES} bytes)` }));
    return true;
  }
  const bodyBuffer = Buffer.concat(chunks);

  const webRequest = buildWebRequest(req, req.url || url.href, bodyBuffer.length ? bodyBuffer : null);

  const referer = String(req.headers.referer || '');
  let refererUrl: URL | null = null;
  try {
    if (referer) refererUrl = new URL(referer);
  } catch {
    refererUrl = null;
  }
  const pagePathname = refererUrl ? refererUrl.pathname : '/';

  ensureActionRegistered(actionId, pagePathname, appDirPath, routeTree);

  const action = getAction(actionId);
  if (!action) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Action not found' }));
    return true;
  }

  let input: Record<string, unknown> = {};
  const ct = webRequest.headers.get('content-type') || '';
  if (ct.includes('json')) {
    input = await webRequest.json().catch(() => ({}));
  } else if (ct.includes('multipart/form-data') || ct.includes('x-www-form-urlencoded')) {
    const fd = await webRequest.formData().catch(() => null);
    if (fd) input = Object.fromEntries(fd.entries());
  } else {
    const text = await webRequest.text().catch(() => '');
    if (text) {
      try { input = JSON.parse(text); } catch { /* ignore */ }
    }
  }

  const issues = validateActionInput(action, input);
  const isFetch = !(req.headers.accept || '').includes('text/html');
  const match = matchUrl(routeTree, pagePathname);
  const params = match ? match.params : {};

  if (issues.length > 0) {
    if (isFetch) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, issues }));
      return true;
    }
    const prevReq = (globalThis as Record<string, unknown>).__vesk_request;
    (globalThis as Record<string, unknown>).__vesk_action_errors = issuesToFieldMap(issues);
    try {
      const html = await renderPageHtml(pagePathname, params, ctx);
      if (html === null) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Action validation failed and the referer page could not be rendered');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }
    } finally {
      (globalThis as Record<string, unknown>).__vesk_action_errors = undefined;
      (globalThis as Record<string, unknown>).__vesk_request = prevReq;
    }
    return true;
  }

  const actionUrl = new URL(url.href);
  const prevReq = (globalThis as Record<string, unknown>).__vesk_request;
  (globalThis as Record<string, unknown>).__vesk_request = {
    request: webRequest,
    params,
    url: actionUrl,
    locals: {},
    cookies: parseCookies(String(req.headers.cookie || '')),
  };
  try {
    const result = await action.execute(input, {
      request: webRequest,
      params,
      url: actionUrl.href,
      headers: () => {
        const m = new Map<string, string>();
        for (const [k, v] of webRequest.headers.entries()) m.set(k.toLowerCase(), String(v));
        return m;
      },
      cookies: () => parseCookies(String(req.headers.cookie || '')),
      locals: () => {
        const cur = (globalThis as Record<string, unknown>).__vesk_request as { locals?: Record<string, unknown> } | undefined;
        return cur && cur.locals ? cur.locals : {};
      },
      redirect: (u: string, status?: number) => new Response(null, { status: status || 303, headers: { Location: u } }),
    });
    if (isFetch) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: result ?? null }));
      return true;
    }
    const location = pagePathname + (refererUrl ? refererUrl.search : '');
    res.writeHead(303, { Location: location });
    res.end();
    return true;
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Action failed';
    if (isFetch) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }));
      return true;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(message);
    return true;
  } finally {
    (globalThis as Record<string, unknown>).__vesk_request = prevReq;
  }
}
