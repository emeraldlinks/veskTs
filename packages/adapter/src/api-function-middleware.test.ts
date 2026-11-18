import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateApiFunction } from '@vesk/adapter/src/api-function';
import { compileMiddlewareCode } from '@vesk/adapter/src/middleware';
import type { ApiRouteNode } from '@vesk/adapter/src/types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const runtimeStub = `
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function toHeadersMap(source) {
  const out = new Map();
  if (source) source.forEach((value, name) => out.set(String(name).toLowerCase(), String(value)));
  return out;
}

export function assertSameOrigin() {}

export async function runHooks() {
  return undefined;
}

export class VeskResponse extends Response {
  constructor(body, init) {
    super(body, init);
    this._cookieHeaders = [];
  }

  static json(data, init) {
    return new VeskResponse(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
  }

  setCookie(name, value, opts = {}) {
    this._cookieHeaders.push(name + '=' + value + '; Path=' + (opts.path || '/'));
    return this;
  }

  clearCookie(name, opts = {}) {
    this._cookieHeaders.push(name + '=; Max-Age=0; Path=' + (opts.path || '/'));
    return this;
  }

  build() {
    for (const cookie of this._cookieHeaders) this.headers.append('set-cookie', cookie);
  }
}
`;

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'vesk-api-mw-'));
  const apiDir = join(root, 'app', 'api');
  const routeDir = join(apiDir, 'mw');
  const out = join(root, 'out');
  mkdirSync(routeDir, { recursive: true });
  mkdirSync(join(out, 'server', 'api'), { recursive: true });
  writeFileSync(join(out, 'server', 'package.json'), '{"type":"module"}', 'utf-8');
  writeFileSync(join(out, 'server', 'runtime.js'), runtimeStub, 'utf-8');
  writeFileSync(
    join(routeDir, 'route.ts'),
    "import { VeskResponse, parseCookies, runHooks } from '@vesk/runtime/server';\nexport const GET = () => {\n  void parseCookies;\n  void runHooks;\n  return VeskResponse.json({ ok: true });\n};\n",
    'utf-8',
  );

  const mwSource = `
export async function middleware(ctx, next) {
  const seenPrevious = ctx.previousRoute || 'none';
  ctx.previousRoute = '/emitted-from-middleware';
  const res = await next();
  if (res) {
    res.setCookie('api_seen', '1', { path: '/' });
    res.headers.set('x-api-mw', 'ok');
    res.headers.set('x-previous-seen', seenPrevious);
  }
  return res;
}
`;
  const middlewareCode = compileMiddlewareCode([mwSource]);
  assert(!!middlewareCode, 'middleware compiles');

  const route: ApiRouteNode = {
    path: 'mw',
    fullPath: '/api/mw',
    isDynamic: false,
    isCatchAll: false,
    filePath: join(routeDir, 'route.ts'),
    children: [],
  };

  const { funcPath, funcCode } = generateApiFunction(route, apiDir, out, { middlewareCode });
  assert(funcCode.includes('const __mwResult = await __executeMw(__ctx, (rewrite) =>'), 'generated wrapper runs the API route inside the middleware onion');
  writeFileSync(funcPath, funcCode, 'utf-8');

  const mod = await import(pathToFileURL(funcPath).href + '?t=' + Date.now()) as { handle: (request: Request) => Promise<Response> };
  const response = await mod.handle(new Request('http://localhost/api/mw', {
    headers: { 'x-vesk-previous-route': '/account?tab=security' },
  }));
  const body = await response.text();

  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.headers.get('x-api-mw') === 'ok', 'pass-through header reaches the API response');
  assert(response.headers.get('x-previous-seen') === '/account?tab=security', 'generated middleware ctx exposes the incoming previous route');
  assert(response.headers.get('x-vesk-previous-route') === '/emitted-from-middleware', 'setting ctx.previousRoute emits the previous-route response header');
  assert((response.headers.get('set-cookie') || '').includes('api_seen=1'), 'pass-through cookie reaches the API response');
  assert(body === '{"ok":true}', `unexpected body ${body}`);

  rmSync(root, { recursive: true, force: true });
}

try {
  await main();
  passed++;
  console.log('  ✓ API middleware wraps the route and applies pass-through cookie/header mutation');
} catch (e: unknown) {
  failed++;
  console.log(`  ✗ API middleware wraps the route and applies pass-through cookie/header mutation\n    ${(e as Error).message}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
