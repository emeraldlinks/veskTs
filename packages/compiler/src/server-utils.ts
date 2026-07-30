import type { IRNode } from './ir.js';
import { StaticNode, TextNode, DynamicBinding } from './ir.js';

const VOID_ELEMENTS = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['style','script','title']);

export let __vskHydrate = false;
export let __vskId = 0;
export let __vskImportedNames: Set<string> | null = null;

export function resetVskState(hydrate = false): void {
  __vskHydrate = hydrate;
  __vskId = 0;
}

export function setVskImportedNames(names: Set<string> | null): void {
  __vskImportedNames = names;
}

export function prettifyHtml(html: string): string {
  let out = '';
  let depth = 0;
  let inRaw = false;
  let rawTag = '';
  const tokens = html.replace(/>\s+</g, '><').split(/(<[^>]+>)/);
  for (const token of tokens) {
    if (!token) continue;
    if (!token.startsWith('<')) {
      const text = token.trim();
      if (inRaw) {
        out += token;
      } else if (text) {
        out += '\t'.repeat(depth) + text + '\n';
      }
      continue;
    }
    const isClose = token[1] === '/';
    const isComment = token.startsWith('<!--');
    if (isComment) {
      out += '\t'.repeat(depth) + token + '\n';
      continue;
    }
    const tagMatch = token.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!tagMatch) {
      out += token;
      continue;
    }
    const tag = tagMatch[1].toLowerCase();
    const selfClose = token.endsWith('/>');
    if (isClose) {
      if (inRaw && tag === rawTag) inRaw = false;
      depth = Math.max(0, depth - 1);
      out += '\t'.repeat(depth) + token + '\n';
    } else {
      out += '\t'.repeat(depth) + token + '\n';
      if (!selfClose && !VOID_ELEMENTS.has(tag)) {
        depth++;
        if (RAW_TEXT_ELEMENTS.has(tag)) {
          inRaw = true;
          rawTag = tag;
        }
      }
    }
  }
  return out.trimEnd();
}

export function isStatic(body: IRNode[]): boolean {
  for (const node of body) {
    if (node instanceof StaticNode) { if (!isStatic(node.children)) return false; }
    else if (!(node instanceof TextNode)) return false;
  }
  return true;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface SecretPattern {
  pattern: RegExp;
  replace: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { pattern: /(sk_live_[a-zA-Z0-9]{20,})/g, replace: 'sk_live_***' },
  { pattern: /(sk_test_[a-zA-Z0-9]{20,})/g, replace: 'sk_test_***' },
  { pattern: /(ghp_[a-zA-Z0-9]{36,})/g, replace: 'ghp_***' },
  { pattern: /(gho_[a-zA-Z0-9]{36,})/g, replace: 'gho_***' },
  { pattern: /(xox[bpsra]-[a-zA-Z0-9-]{20,})/g, replace: 'xox-***' },
  { pattern: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/g, replace: '$1***' },
  { pattern: /(Authorization:\s*Basic\s+)[a-zA-Z0-9+/=]{20,}/gi, replace: '$1***' },
  { pattern: /(-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----)[\s\S]*?(-----END\s+(?:RSA\s+)?PRIVATE KEY-----)/g, replace: '$1***$2' },
  { pattern: /(['"]?(?:api[_-]?key|secret|password|token|auth|private[_-]?key|access[_-]?key|session[_-]?secret)[, }\]'"*]*[:=]\s*['"]?)(?!.*\*\*\*)([^'"\s,}\]]{8,})(['"]?)/gi, replace: '$1***$3' },
];

export function redactLog(str: string): string {
  if (!str || typeof str !== 'string') return str;
  let result = str;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    result = result.replace(pattern, replace);
  }
  return result;
}

const _origConsoleError = console.error;
const _origConsoleLog = console.log;
let _redactEnabled = true;

export function setRedactLogging(enabled: boolean): void {
  _redactEnabled = enabled;
}

if (typeof console !== 'undefined') {
  console.error = function(...args: unknown[]) {
    _origConsoleError.apply(console, args.map(a =>
      typeof a === 'string' && _redactEnabled ? redactLog(a) : a
    ) as [string, ...unknown[]]);
  } as typeof console.error;
  console.log = function(...args: unknown[]) {
    _origConsoleLog.apply(console, args.map(a =>
      typeof a === 'string' && _redactEnabled ? redactLog(a) : a
    ) as [string, ...unknown[]]);
  } as typeof console.log;
}

export function raw(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

const __csrfSecrets = new Map<string, string>();

function csrfSecret(host?: string): string {
  if (!host) host = 'localhost';
  if (!__csrfSecrets.has(host)) {
    __csrfSecrets.set(host, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  }
  return __csrfSecrets.get(host)!;
}

function csrfHmac(value: string, secret: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < secret.length; i++) {
    h = ((h << 5) - h + secret.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function csrfToken(sessionId?: string, host?: string): string {
  const secret = csrfSecret(host);
  const value = sessionId || 'anonymous';
  const sig = csrfHmac(value, secret);
  return `${value}:${sig}`;
}

export function verifyCsrfToken(token: string, host?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split(':');
  if (parts.length !== 2) return false;
  const [value, sig] = parts;
  const secret = csrfSecret(host);
  const expected = csrfHmac(value, secret);
  return sig === expected;
}

export function csrfGuard(request: Record<string, unknown>, host?: string): void {
  if (!request || typeof request !== 'object') return;
  const method = ((request.method as string) || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const headers = request.headers as Record<string, unknown> | undefined;
  const token = (headers?.['x-csrf-token'] as string)
    || ((request.body as Record<string, unknown>)?._csrf as string)
    || '';
  const requestHost = host || (headers?.['host'] as string) || '';
  if (!verifyCsrfToken(token, requestHost)) {
    throw new Error('CSRF validation failed');
  }
}

const __cookieSecrets = new Map<string, string>();

function cookieSecret(host?: string): string {
  if (!host) host = 'localhost';
  if (!__cookieSecrets.has(host)) {
    __cookieSecrets.set(host, Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  }
  return __cookieSecrets.get(host)!;
}

export async function signCookie(name: string, value: string, host?: string): Promise<string> {
  const secret = cookieSecret(host);
  const payload = `${name}=${value}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
  return `${value}.${sigB64}`;
}

export async function unsignCookie(name: string, signedValue: string, host?: string): Promise<string | null> {
  if (!signedValue || typeof signedValue !== 'string') return null;
  const dot = signedValue.lastIndexOf('.');
  if (dot === -1) return null;
  const value = signedValue.slice(0, dot);
  const sig = signedValue.slice(dot + 1);
  let expectedSig: string;
  try {
    expectedSig = (await signCookie(name, value, host)).split('.').pop()!;
  } catch {
    return null;
  }
  return sig === expectedSig ? value : null;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
  maxAge?: number;
  domain?: string;
}

export async function setSignedCookie(name: string, value: string, options: CookieOptions = {}, host?: string): Promise<string> {
  const signed = await signCookie(name, value, host);
  const parts = [`${name}=${signed}`];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push('SameSite=' + (options.sameSite || 'Lax'));
  if (options.path !== undefined) parts.push('Path=' + options.path);
  else parts.push('Path=/');
  if (options.maxAge !== undefined) parts.push('Max-Age=' + options.maxAge);
  if (options.domain) parts.push('Domain=' + options.domain);
  return parts.join('; ');
}

export async function readSignedCookie(name: string, cookieString: string, host?: string): Promise<string | null> {
  if (!cookieString) return null;
  const cookies: Record<string, string> = {};
  for (const pair of cookieString.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const signed = cookies[name];
  if (!signed) return null;
  return await unsignCookie(name, signed, host);
}

export interface SecurityConfig {
  security?: {
    xFrameOptions?: string | false;
    referrerPolicy?: string | false;
    hsts?: string | false;
    contentSecurityPolicy?: string | false;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function securityHeaders(config: SecurityConfig = {}): Record<string, string> {
  const sec = config.security || {};
  const headers: Record<string, string> = {
    'X-Frame-Options': sec.xFrameOptions || 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': sec.referrerPolicy || 'strict-origin-when-cross-origin',
    ...(sec.hsts !== false ? { 'Strict-Transport-Security': sec.hsts as string || 'max-age=31536000; includeSubDomains' } : {}),
    'X-XSS-Protection': '0',
  };
  if (sec.contentSecurityPolicy !== false) {
    headers['Content-Security-Policy'] = sec.contentSecurityPolicy as string ||
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
  }
  return headers;
}

export interface CorsConfig {
  cors?: {
    origin: string | string[];
    methods?: string;
    headers?: string;
    credentials?: boolean;
    maxAge?: number;
  };
  [key: string]: unknown;
}

export function corsHeaders(security: CorsConfig = {}, requestOrigin = '', host = ''): Record<string, string> {
  if (!requestOrigin) return {};

  const originHost = (requestOrigin || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const localHost = (host || '').split(':')[0];
  if (originHost && localHost && originHost === localHost) {
    return {};
  }

  const cors = security?.cors;
  if (!cors || !cors.origin) return {};

  const allowedOrigins = Array.isArray(cors.origin) ? cors.origin : [cors.origin];
  const origin = allowedOrigins.includes('*')
    ? '*'
    : allowedOrigins.includes(requestOrigin) ? requestOrigin : null;

  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': cors.methods || 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': cors.headers || 'Content-Type,Authorization,X-CSRF-Token',
    ...(cors.credentials !== false ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
    'Access-Control-Max-Age': String(cors.maxAge || 86400),
  };
}

export function corsPreflight(request: Record<string, unknown>, security?: CorsConfig): boolean {
  if (((request.method as string) || 'GET').toUpperCase() !== 'OPTIONS') return false;
  const headers = request.headers as Record<string, string> | undefined;
  const origin = headers?.['origin'] || '';
  const host = headers?.['host'] || '';
  const corsRespHeaders = corsHeaders(security, origin, host);
  if (!corsRespHeaders['Access-Control-Allow-Origin']) return false;
  throw new CorsResponse(corsRespHeaders);
}

export class CorsResponse extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(headers: Record<string, string>) {
    super('CORS preflight');
    this.name = 'CorsResponse';
    this.status = 204;
    this.headers = { ...headers, 'Content-Length': '0' };
  }
}

export function securityComment(config: SecurityConfig = {}): string {
  const sec = config.security || {};
  const features: string[] = [];
  if (sec.autoEscape !== false) features.push('auto-escape');
  if (sec.csrf !== false) features.push('csrf');
  if (sec.xFrameOptions !== false) features.push('x-frame-options');
  if (sec.hsts !== false) features.push('hsts');
  if (sec.contentSecurityPolicy !== false) features.push('csp');
  if (sec.trustProxy) features.push('trust-proxy');
  return `<!-- vesk-sec: ${features.join(', ')} -->`;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  cleanupIntervalMs?: number;
}

export function createRateLimiter(options: RateLimitOptions = {}): {
  check: (key: string) => boolean;
  remaining: (key: string) => number;
  reset: (key: string) => void;
  getConfig: () => { windowMs: number; max: number };
  middleware: (request: Record<string, unknown>, response?: Record<string, unknown>) => boolean;
} {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const timestamps = new Map<string, number[]>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of timestamps) {
      const valid = times.filter(t => now - t < windowMs);
      if (valid.length === 0) timestamps.delete(key);
      else timestamps.set(key, valid);
    }
  }, options.cleanupIntervalMs || 60000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  function getClientIp(request: Record<string, unknown>): string {
    const headers = request?.headers as Record<string, string | string[]> | undefined;
    const forwarded = headers?.['x-forwarded-for'];
    if (forwarded) {
      const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : (forwarded as string[])[0]).trim();
      return ip;
    }
    const realIp = headers?.['x-real-ip'];
    const cfIp = headers?.['cf-connecting-ip'];
    return (typeof realIp === 'string' ? realIp : typeof cfIp === 'string' ? cfIp : 'unknown');
  }

  function _check(key?: string): boolean {
    if (!key) return true;
    const now = Date.now();
    const times = timestamps.get(key) || [];
    const valid = times.filter(t => now - t < windowMs);
    if (valid.length >= max) {
      timestamps.set(key, valid);
      return false;
    }
    valid.push(now);
    timestamps.set(key, valid);
    return true;
  }

  return {
    check(key: string) {
      return _check(key);
    },
    remaining(key: string) {
      if (!key) return max;
      const now = Date.now();
      const times = timestamps.get(key) || [];
      return Math.max(0, max - times.filter(t => now - t < windowMs).length);
    },
    reset(key: string) {
      timestamps.delete(key);
    },
    getConfig() {
      return { windowMs, max };
    },
    middleware(request: Record<string, unknown>, response?: Record<string, unknown>) {
      const ip = getClientIp(request);
      if (!_check(ip)) {
        if (response && typeof response.headers === 'object') {
          (response.headers as Record<string, string>)['Retry-After'] = String(Math.ceil(windowMs / 1000));
        }
        return false;
      }
      return true;
    },
  };
}

export function getClientIp(request: Record<string, unknown> | undefined, trustProxy: boolean | string = false): string {
  const headers = (request?.headers || {}) as Record<string, unknown>;
  if (trustProxy) {
    const forwarded = headers['x-forwarded-for'];
    if (forwarded) {
      const ips = (typeof forwarded === 'string' ? forwarded : String(forwarded)).split(',').map(s => s.trim());
      return ips[0] || 'unknown';
    }
    const realIp = headers['x-real-ip'];
    if (realIp) return typeof realIp === 'string' ? realIp : String(realIp);
  }
  if (headers['x-forwarded-for']) {
    const fwd = headers['x-forwarded-for'];
    return typeof fwd === 'string' ? fwd.split(',')[0].trim() : (fwd as string[])[0];
  }
  if (headers['x-real-ip']) return typeof headers['x-real-ip'] === 'string' ? headers['x-real-ip'] as string : String(headers['x-real-ip']);
  return 'unknown';
}

export function getClientProtocol(request: Record<string, unknown> | undefined, trustProxy: boolean | string = false): string {
  if (trustProxy) {
    const proto = (request?.headers as Record<string, string> | undefined)?.['x-forwarded-proto'];
    if (proto) return (typeof proto === 'string' ? proto.split(',')[0] : String(proto)).trim();
  }
  return (request?.headers as Record<string, string> | undefined)?.['x-forwarded-proto'] ? 'https' : 'http';
}

export function applyTrustProxy(ctx: Record<string, unknown>, trustProxy: boolean | string): void {
  if (!ctx || !trustProxy) return;
  ctx.ip = getClientIp(ctx as Record<string, unknown>, trustProxy);
  ctx.protocol = getClientProtocol(ctx as Record<string, unknown>, trustProxy);
  ctx.host = ((ctx.headers as Record<string, string>)?.['x-forwarded-host']) || ctx.host;
}

export function exprJS(raw: string): string {
  return `(${raw})`;
}

export function indent(code: string, level = 1): string {
  const tab = '\t';
  return code.split('\n').map(line => line ? tab.repeat(level) + line : line).join('\n');
}

export function tryEvalExpr(raw: string, props: Record<string, unknown>, locals: Record<string, unknown> = {}): unknown {
  try {
    const fn = new Function('props', 'return (' + raw + ')');
    return fn(props);
  } catch {
    const merged = { ...props, ...locals };
    try {
      const fn = new Function('props', 'return (' + raw + ')');
      return fn(merged);
    } catch {
      const paramNames = Object.keys({ ...props, ...locals });
      const paramValues = paramNames.map((k) => (k in props ? props[k] : locals[k]));
      try {
        const fn = new Function(...paramNames, 'return (' + raw + ')');
        return fn(...paramValues);
      } catch {
        throw new Error('Cannot evaluate: ' + raw);
      }
    }
  }
}

export function childrenToHTML(nodes: IRNode[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    if (n instanceof StaticNode) {
      const tag = n.tag;
      const attrs = n.attributes.map(a => ` ${a.name}="${escapeHtml(a.value)}"`).join('');
      if (n.selfClosing) {
        parts.push(`<${tag}${attrs}/>`);
      } else {
        const inner = childrenToHTML(n.children);
        parts.push(`<${tag}${attrs}>${inner}</${tag}>`);
      }
    } else if (n instanceof TextNode) {
      parts.push(escapeHtml(n.value));
    }
  }
  return parts.join('');
}

export function extractTopLevelNames(topLevelCode: string[]): string[] {
  const names: string[] = [];
  for (const code of topLevelCode) {
    const match = code.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)/);
    if (match) names.push(match[1]);
  }
  return names;
}

export function extractRuntimeNames(importStrs: string[]): string[] {
  const names: string[] = [];
  for (const imp of importStrs) {
    const match = imp.match(/import\s+\{([^}]+)\}\s+from\s+['"](?:@vesk\/runtime|@vesk\/reactivity)['"]/);
    if (match) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name) names.push(name);
      }
    }
  }
  return names;
}

export function buildParamInit(paramNames: string[]): string {
  if (paramNames.length === 1 && paramNames[0] === 'props') {
    return '';
  }
  if (paramNames.length === 0) return '';
  return `const { ${paramNames.join(', ')} } = props;`;
}

let __cachedRuntimeModule: Record<string, unknown> = {};

export function setRuntimeModule(mod: Record<string, unknown>): void {
  __cachedRuntimeModule = mod;
}

export function loadRuntimeImports(importStrs: string[]): Record<string, unknown> {
  const names = extractRuntimeNames(importStrs);
  const mod = __cachedRuntimeModule;
  if (mod) {
    const result: Record<string, unknown> = {};
    if (mod.getActiveComponent) result.getActiveComponent = mod.getActiveComponent;
    if (mod.setActiveComponent) result.setActiveComponent = mod.setActiveComponent;
    for (const name of names) {
      if (name in mod) result[name] = mod[name];
    }
    return result;
  }
  return {};
}

export function evalTopLevelCode(topLevelCode: string[], __vesk: Record<string, unknown>): void {
  for (const code of topLevelCode) {
    const constMatch = code.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(.+);?\s*$/s);
    if (constMatch) {
      try {
        const keys = Object.keys(__vesk);
        const params = [...keys, '__vesk', 'result'];
        const body = `result.value = ${constMatch[2]};`;
        const fn = new Function(...params, body);
        const result = { value: undefined as unknown };
        fn(...keys.map(k => __vesk[k]), __vesk, result);
        __vesk[constMatch[1]] = result.value;
      } catch {
        // skip evaluation errors
      }
      continue;
    }
    const fnMatch = code.match(/^(?:export\s+)?(async\s+)?function\s+(\w+)\s*([\s\S]*)$/);
    if (fnMatch) {
      try {
        const keys = Object.keys(__vesk);
        const params = [...keys, '__vesk'];
        const asyncKw = fnMatch[1] || '';
        const body = `__vesk['${fnMatch[2]}'] = ${asyncKw}function ${fnMatch[2]}${fnMatch[3]};`;
        const fn = new Function(...params, body);
        fn(...keys.map(k => __vesk[k]), __vesk);
      } catch {
        // skip evaluation errors
      }
    }
  }
}

export async function callStaticProps(fnSource: string): Promise<unknown> {
  const isAsync = fnSource.trimStart().startsWith('async');
  const wrapper = isAsync
    ? `return (async () => {\n${fnSource}\nreturn await getStaticProps();\n})()`
    : `return (() => {\n${fnSource}\nreturn getStaticProps();\n})()`;
  const fn = new Function(wrapper);
  const result = fn();
  const resolved = result && typeof result.then === 'function' ? await result : result;
  return resolved && resolved.props ? resolved.props : resolved;
}

export async function callLoadFunction(fnSource: string, currentProps: Record<string, unknown>, __vesk: Record<string, unknown>): Promise<unknown> {
  const isAsync = fnSource.trimStart().startsWith('async');
  const ctx = {
    params: (currentProps.params as Record<string, string>) || {},
    request: currentProps.request || null,
    fetch: globalThis.fetch,
    url: currentProps.url || '',
  };
  const ctxCode = `const __ctx = ${JSON.stringify(ctx)};\n`;
  const wrapper = isAsync
    ? `return (async () => {\n${ctxCode}\n${fnSource}\nreturn await load(__ctx);\n})()`
    : `return (() => {\n${ctxCode}\n${fnSource}\nreturn load(__ctx);\n})()`;
  const fn = new Function(wrapper);
  const result = fn();
  const resolved = result && typeof result.then === 'function' ? await result : result;
  return resolved;
}
