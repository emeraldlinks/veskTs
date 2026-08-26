import type { IRNode } from '@vesk/compiler/src/ir';
import { StaticNode, TextNode, DynamicBinding } from '@vesk/compiler/src/ir';
import * as __defaultRuntimeModule from '@vesk/runtime/src/index-server';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { htmlTagName, htmlTagEnd } from '@vesk/compiler/src/scan';
import { importModuleTarget, extractImportNames } from '@vesk/compiler/src/tokens';

const VOID_ELEMENTS = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['style','script','title']);

export let __vskHydrate = false;
export let __vskId = 0;
export let __vskForceClaim = false;
export let __vskImportedNames: Set<string> | null = null;

export function resetVskState(hydrate = false): void {
  __vskHydrate = hydrate;
  __vskId = 0;
  __vskForceClaim = false;
}

export function setVskHydrate(v: boolean): void {
  __vskHydrate = v;
}

export function setVskImportedNames(names: Set<string> | null): void {
  __vskImportedNames = names;
}

export function setVskForceClaim(v: boolean): void {
  __vskForceClaim = v;
}

export function takeVskForceClaim(): boolean {
  const v = __vskForceClaim;
  __vskForceClaim = false;
  return v;
}

export function nextVskId(): number {
  return __vskId++;
}

export function prettifyHtml(html: string): string {
  let out = '';
  let depth = 0;
  let inRaw = false;
  let rawTag = '';
  for (const token of htmlTokenize(html)) {
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
    const tagName = htmlTagName(token);
    if (!tagName) {
      out += token;
      continue;
    }
    const tag = tagName.toLowerCase();
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

/**
 * Splits HTML into text and tag tokens. `>` inside quoted attribute values
 * does not end a tag, so `alt="a > b"` and `data-x="1>0"` are kept intact
 * (the old `split(/(<[^>]+>)/)` approach could not do this).
 */
function htmlTokenize(html: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const close = html.indexOf('-->', i + 4);
        const end = close === -1 ? html.length : close + 3;
        tokens.push(html.slice(i, end));
        i = end;
        continue;
      }
      const end = htmlTagEnd(html, i);
      if (end === -1) {
        tokens.push(html.slice(i));
        break;
      }
      tokens.push(html.slice(i, end));
      i = end;
    } else {
      const next = html.indexOf('<', i);
      if (next === -1) {
        tokens.push(html.slice(i));
        break;
      }
      tokens.push(html.slice(i, next));
      i = next;
    }
  }
  return tokens;
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
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

/** Escapes double quotes for embedding text inside a double-quoted attribute. */
export function quoteAttr(str: string): string {
  return str.split('"').join('&quot;');
}

/**
 * Makes JSON output safe to embed inside an inline <script> block.
 * Escapes `<` (breaks out of script context via `</script>`), line
 * separators U+2028/U+2029 (valid JSON but invalid JS string literals).
 */
export function safeJsonForScript(json: string): string {
  return json
    .split('<').join('\\u003c')
    .split('\u2028').join('\\u2028')
    .split('\u2029').join('\\u2029');
}

/** Cryptographically strong random hex token (WebCrypto CSPRNG). */
export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let hex = '';
  for (const b of buf) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Default request-body cap (bytes) for servers and action/API handlers. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

// ── Log redaction (char-scan, no regex — repo compiler rule) ──────

interface TokenPrefix {
  match: (s: string, i: number) => string | null;
  /** Replacement emitted when a long-enough body follows the prefix. */
  emit: (keep: string) => string;
  minLen: number;
}

function isAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Token body charset: alnum plus base64url/JWT punctuation. */
function isTokenChar(code: number): boolean {
  return isAlnum(code) || code === 46 /* . */ || code === 95 /* _ */ || code === 45 /* - */ || code === 43 /* + */ || code === 47 /* / */ || code === 61 /* = */;
}

const TOKEN_PREFIXES: TokenPrefix[] = [
  { // sk_live_/sk_test_ keys
    match: (s, i) => {
      if (!s.startsWith('sk_', i)) return null;
      if (s.startsWith('sk_live_', i)) return 'sk_live_';
      if (s.startsWith('sk_test_', i)) return 'sk_test_';
      return null;
    },
    emit: (keep) => keep + '***',
    minLen: 20,
  },
  { // ghp_/gho_ GitHub tokens
    match: (s, i) => {
      if (s.startsWith('ghp_', i)) return 'ghp_';
      if (s.startsWith('gho_', i)) return 'gho_';
      return null;
    },
    emit: (keep) => keep + '***',
    minLen: 36,
  },
  { // xox[bpsra]- Slack tokens (redacted shape matches the original output)
    match: (s, i) => {
      if (!s.startsWith('xox', i) || i + 4 >= s.length) return null;
      const c = s[i + 3];
      if (c !== 'b' && c !== 'p' && c !== 's' && c !== 'r' && c !== 'a') return null;
      if (s[i + 4] !== '-') return null;
      return 'xox' + c + '-';
    },
    emit: () => 'xox-***',
    minLen: 20,
  },
];

const LOWER = (c: string): string => c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c;

function ciStartsWith(s: string, word: string, i: number): boolean {
  if (i + word.length > s.length) return false;
  for (let j = 0; j < word.length; j++) {
    if (LOWER(s[i + j]) !== word[j]) return false;
  }
  return true;
}

/**
 * Replaces known secret token shapes with `prefix***`. Char-scan pass over
 * the whole string (no regex). Returns a new string.
 */
function scanSecretTokens(str: string): string {
  let out = '';
  let i = 0;
  while (i < str.length) {
    // PEM private key blocks: BEGIN header kept, body collapsed, END kept.
    if (str.startsWith('-----BEGIN ', i)) {
      let hdrEnd = -1;
      for (let j = i + 11; j + 5 <= str.length; j++) {
        if (str.startsWith('-----', j)) { hdrEnd = j; break; }
      }
      const endIdx = str.indexOf('-----END ', i + 11);
      if (hdrEnd !== -1 && endIdx !== -1 && endIdx > hdrEnd) {
        let closeIdx = -1;
        for (let j = endIdx + 9; j + 5 <= str.length; j++) {
          if (str.startsWith('-----', j)) { closeIdx = j; break; }
        }
        if (closeIdx !== -1) {
          out += str.slice(i, hdrEnd + 5) + '***' + str.slice(endIdx, closeIdx + 5);
          i = closeIdx + 5;
          continue;
        }
      }
    }

    let matched = false;
    for (const tp of TOKEN_PREFIXES) {
      const keep = tp.match(str, i);
      if (keep !== null) {
        let j = i + keep.length;
        while (j < str.length && isTokenChar(str.charCodeAt(j))) j++;
        if (j - (i + keep.length) >= tp.minLen) {
          out += tp.emit(keep);
          i = j;
          matched = true;
        }
        break;
      }
    }
    if (matched) continue;

    // Bearer <token> / Authorization: Basic <token>
    const prevIsWord = i > 0 && isAlnum(str.charCodeAt(i - 1));
    if (!prevIsWord && ciStartsWith(str, 'bearer', i)) {
      let j = i + 6;
      let spaces = 0;
      while (j < str.length && (str[j] === ' ' || str[j] === '\t')) { j++; spaces++; }
      if (spaces > 0) {
        let k = j;
        while (k < str.length && isTokenChar(str.charCodeAt(k))) k++;
        if (k - j >= 20) {
          out += 'Bearer ***';
          i = k;
          continue;
        }
      }
    }
    if (!prevIsWord && ciStartsWith(str, 'basic', i)) {
      let j = i + 5;
      let spaces = 0;
      while (j < str.length && (str[j] === ' ' || str[j] === '\t')) { j++; spaces++; }
      if (spaces > 0) {
        let k = j;
        while (k < str.length && isTokenChar(str.charCodeAt(k))) k++;
        if (k - j >= 20) {
          out += 'Basic ***';
          i = k;
          continue;
        }
      }
    }

    out += str[i];
    i++;
  }
  return out;
}

const SECRET_KEY_NAMES = [
  'api_key', 'api-key', 'apikey',
  'secret', 'password', 'token', 'auth',
  'private_key', 'private-key',
  'access_key', 'access-key',
  'session_secret',
];

function lowerRun(s: string): string {
  let out = '';
  for (const c of s) out += LOWER(c);
  return out;
}

function isValueStopChar(c: string): boolean {
  return c === "'" || c === '"' || c === ' ' || c === '\t' || c === '\n' || c === '\r'
    || c === ',' || c === '}' || c === ']';
}

/**
 * Second redaction pass: `<secret-ish key>` followed by `:` or `=` gets its
 * value collapsed to `***` unless the value already contains `***` (already
 * handled by the token pass).
 */
function scanKeyValueSecrets(str: string): string {
  let out = '';
  let i = 0;
  while (i < str.length) {
    let keyHit: { nameLen: number } | null = null;
    if (i === 0 || !(isAlnum(str.charCodeAt(i - 1)) || str[i - 1] === '_' || str[i - 1] === '-')) {
      const run = lowerRun(str.slice(i, i + 16));
      for (const name of SECRET_KEY_NAMES) {
        if (run.startsWith(name)) { keyHit = { nameLen: name.length }; break; }
      }
    }
    if (keyHit) {
      let j = i + keyHit.nameLen;
      // filler chars between key and separator: , space } ] ' " *
      while (j < str.length && (str[j] === ',' || str[j] === ' ' || str[j] === '}' || str[j] === ']' || str[j] === "'" || str[j] === '"' || str[j] === '*')) j++;
      if (str[j] === ':' || str[j] === '=') {
        j++; // separator
        while (j < str.length && (str[j] === ' ' || str[j] === '\t')) j++;
        let openQuote = '';
        if (str[j] === "'" || str[j] === '"') { openQuote = str[j]; j++; }
        let k = j;
        while (k < str.length && !isValueStopChar(str[k])) k++;
        const value = str.slice(j, k);
        if (k - j >= 8 && !value.includes('***')) {
          out += str.slice(i, j) + '***';
          if (openQuote && k < str.length && str[k] === openQuote) { out += openQuote; k++; }
          else if (openQuote) out += openQuote;
          i = k;
          continue;
        }
      }
    }
    out += str[i];
    i++;
  }
  return out;
}

export function redactLog(str: string): string {
  if (!str || typeof str !== 'string') return str;
  return scanKeyValueSecrets(scanSecretTokens(str));
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

// ── SHA-256 / HMAC (pure JS, sync — works in Node and browsers) ───

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const paddedLen = (((len + 9) + 63) >> 6) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(paddedLen - 4, bitLen >>> 0);

  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(off + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let j = 0; j < 64; j++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[j] + w[j]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0); odv.setUint32(4, h1); odv.setUint32(8, h2); odv.setUint32(12, h3);
  odv.setUint32(16, h4); odv.setUint32(20, h5); odv.setUint32(24, h6); odv.setUint32(28, h7);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function hmacSha256(keyBytes: Uint8Array, message: Uint8Array): Uint8Array {
  const key = keyBytes.length > 64 ? sha256Bytes(keyBytes) : keyBytes;
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  ipad.fill(0x36);
  opad.fill(0x5c);
  for (let i = 0; i < key.length; i++) {
    ipad[i] ^= key[i];
    opad[i] ^= key[i];
  }
  return sha256Bytes(concatBytes(opad, sha256Bytes(concatBytes(ipad, message))));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const __csrfSecrets = new Map<string, string>();

function csrfSecret(host?: string): string {
  if (!host) host = 'localhost';
  if (!__csrfSecrets.has(host)) {
    __csrfSecrets.set(host, randomToken(32));
  }
  return __csrfSecrets.get(host)!;
}

/** HMAC-SHA256 over `value` keyed by `secret`, hex-encoded. */
export function csrfHmac(value: string, secret: string): string {
  return toHex(hmacSha256(utf8(secret), utf8(value)));
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

// ── Same-origin enforcement (default CSRF defense for actions/API) ──

/** Reads a header from either a plain record or a Headers-like object. */
function readHeader(headers: unknown, name: string): string {
  if (!headers) return '';
  const h = headers as { get?: (n: string) => unknown } & Record<string, unknown>;
  if (typeof h.get === 'function') return String(h.get(name) ?? '');
  return String(h[name] ?? '');
}

/** Extracts the authority (host[:port]) part of an absolute URL. */
export function urlAuthority(url: string): string {
  const schemeIdx = url.indexOf('://');
  if (schemeIdx === -1) return '';
  let rest = url.slice(schemeIdx + 3);
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '/' || c === '?' || c === '#') { end = i; break; }
  }
  rest = rest.slice(0, end);
  const at = rest.lastIndexOf('@');
  if (at !== -1) rest = rest.slice(at + 1);
  return rest.toLowerCase();
}

function hostName(authority: string): string {
  const colon = authority.lastIndexOf(':');
  if (colon === -1) return authority;
  // bare IPv6 without brackets has multiple colons — keep whole authority
  let isIpv6 = false;
  for (let i = 0; i < authority.length; i++) {
    if (authority[i] === ':' && i !== colon) { isIpv6 = true; break; }
  }
  return isIpv6 ? authority : authority.slice(0, colon);
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Default CSRF defense: unsafe methods must present an Origin or Referer
 * whose authority matches the request Host. Browsers always attach Origin
 * to cross-site POSTs, so mismatches are blocked; non-browser clients that
 * send no Origin/Referer are allowed (they cannot be CSRF'd).
 * Throws a 403-status error on mismatch.
 */
export function assertSameOrigin(request: Record<string, unknown>): void {
  if (!request || typeof request !== 'object') return;
  const method = String(request.method || 'GET').toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return;
  const headers = request.headers;
  const origin = readHeader(headers, 'origin');
  const source = origin || readHeader(headers, 'referer');
  if (!source) return; // non-browser client — no CSRF risk
  const hostHeader = readHeader(headers, 'host').toLowerCase().trim();
  if (!hostHeader) return;
  const sourceAuthority = urlAuthority(source);
  if (sourceAuthority === hostHeader) return;
  // Tolerate one-sided port presence (e.g. proxy strips port from Host),
  // but never a different hostname.
  const srcHost = hostName(sourceAuthority);
  if (srcHost && srcHost === hostName(hostHeader)) {
    const srcHasPort = sourceAuthority.length > srcHost.length;
    const dstHasPort = hostHeader.length > hostName(hostHeader).length;
    if (srcHasPort !== dstHasPort) return;
  }
  const err = new Error('Cross-origin request blocked') as Error & { status?: number };
  err.status = 403;
  throw err;
}

const __cookieSecrets = new Map<string, string>();

function cookieSecret(host?: string): string {
  if (!host) host = 'localhost';
  if (!__cookieSecrets.has(host)) {
    __cookieSecrets.set(host, randomToken(32));
  }
  return __cookieSecrets.get(host)!;
}

export async function signCookie(name: string, value: string, host?: string): Promise<string> {
  const secret = cookieSecret(host);
  const payload = `${name}=${value}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigChars = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // strip trailing '=' padding without regex
  let sigEnd = sigChars.length;
  while (sigEnd > 0 && sigChars[sigEnd - 1] === '=') sigEnd--;
  return `${value}.${sigChars.slice(0, sigEnd)}`;
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

  const originHost = stripScheme(requestOrigin).split('/')[0].split(':')[0];
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

  // Credentials are opt-in: `*` origins can never carry credentials, and
  // defaulting this on silently exposed credentialed responses cross-origin.
  const allowCredentials = cors.credentials === true && origin !== '*';

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': cors.methods || 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': cors.headers || 'Content-Type,Authorization,X-CSRF-Token',
    ...(allowCredentials ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
    'Access-Control-Max-Age': String(cors.maxAge || 86400),
  };
}

function stripScheme(url: string): string {
  if (url.startsWith('https://')) return url.slice(8);
  if (url.startsWith('http://')) return url.slice(7);
  return url;
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
  /** Only honor proxy headers (x-forwarded-for etc.) when explicitly trusted. */
  trustProxy?: boolean;
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
    if (!options.trustProxy) return 'unknown';
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

/**
 * Resolves the client IP. Proxy headers (`x-forwarded-for`, `x-real-ip`) are
 * only honored when `trustProxy` is explicitly enabled — otherwise any
 * client could spoof its identity (and defeat rate limiting) with a header.
 */
export function getClientIp(request: Record<string, unknown> | undefined, trustProxy: boolean | string = false): string {
  if (!trustProxy) return 'unknown';
  const headers = (request?.headers || {}) as Record<string, unknown>;
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : String(forwarded)).split(',').map(s => s.trim());
    if (ips[0]) return ips[0];
  }
  const realIp = headers['x-real-ip'];
  if (realIp) return typeof realIp === 'string' ? realIp : String(realIp);
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp) return typeof cfIp === 'string' ? cfIp : String(cfIp);
  return 'unknown';
}

export function getClientProtocol(request: Record<string, unknown> | undefined, trustProxy: boolean | string = false): string {
  if (trustProxy) {
    const proto = (request?.headers as Record<string, string> | undefined)?.['x-forwarded-proto'];
    if (proto) return (typeof proto === 'string' ? proto.split(',')[0] : String(proto)).trim();
  }
  return 'http';
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
    const ast = tryParseTopLevel(code);
    if (ast) {
      for (const stmt of ast.body as any[]) {
        const target = unwrapExport(stmt);
        if (!target) continue;
        if (target.type === 'VariableDeclaration') {
          for (const d of target.declarations) {
            if (d.id && d.id.type === 'Identifier') names.push(d.id.name);
          }
        } else if (target.type === 'FunctionDeclaration' && target.id) {
          names.push(target.id.name);
        } else if (target.type === 'ClassDeclaration' && target.id) {
          names.push(target.id.name);
        }
      }
    }
  }
  return names;
}

function unwrapExport(stmt: any): any | null {
  if (stmt.type === 'ExportNamedDeclaration') return stmt.declaration;
  if (stmt.type === 'ExportDefaultDeclaration') return stmt.declaration;
  return stmt;
}

function tryParseTopLevel(code: string): any | null {
  try {
    return parse(code, { filename: 'top-level.mjs' });
  } catch {
    return null;
  }
}

export function extractRuntimeNames(importStrs: string[]): string[] {
  const names: string[] = [];
  for (const imp of importStrs) {
    const ast = tryParseImport(imp);
    if (ast) {
      for (const stmt of ast.body as any[]) {
        if (stmt.type !== 'ImportDeclaration') continue;
        const src = stmt.source?.value;
        if (typeof src !== 'string' || (src !== '@vesk/runtime' && src !== '@vesk/reactivity')) continue;
        for (const spec of stmt.specifiers || []) {
          if (spec.importKind === 'type') continue;
          if (spec.type === 'ImportSpecifier') {
            const name = spec.local?.name || spec.imported?.name;
            if (name) names.push(name);
          } else if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
            if (spec.local?.name) names.push(spec.local.name);
          }
        }
      }
      continue;
    }
    const target = importModuleTarget(imp);
    if (target === '@vesk/runtime' || target === '@vesk/reactivity') {
      for (const name of extractImportNames(imp)) names.push(name);
    }
  }
  return names;
}

function tryParseImport(code: string): any | null {
  try {
    return parse(code, { filename: 'import.mjs' });
  } catch {
    return null;
  }
}

export function buildParamInit(paramNames: string[]): string {
  if (paramNames.length === 1 && paramNames[0] === 'props') {
    return '';
  }
  if (paramNames.length === 0) return '';
  return `const { ${paramNames.join(', ')} } = props;`;
}

export function resolveComponentName(source: string): string | null {
  try {
    const ir = generateIR(parse(source), source);
    const defaultComp = ir.components.find((c) => c.defaultExport);
    if (defaultComp) return defaultComp.name;
    if (ir.components.length > 0) return ir.components[0].name;
    const exportedComp = ir.components.find((c) => c.exported);
    if (exportedComp) return exportedComp.name;
    return null;
  } catch {
    return null;
  }
}

let __cachedRuntimeModule: Record<string, unknown> | null = null;

export function setRuntimeModule(mod: Record<string, unknown>): void {
  __cachedRuntimeModule = mod;
}

export function loadRuntimeImports(importStrs: string[]): Record<string, unknown> {
  const names = extractRuntimeNames(importStrs);
  const mod: Record<string, unknown> = __cachedRuntimeModule || __defaultRuntimeModule as unknown as Record<string, unknown>;
  if (mod) {
    const result: Record<string, unknown> = {};
    if (mod.getActiveComponent) result.getActiveComponent = mod.getActiveComponent;
    if (mod.setActiveComponent) result.setActiveComponent = mod.setActiveComponent;
    for (const name of ['get', 'set', 'track']) {
      if (name in mod) result[name] = mod[name];
    }
    for (const name of names) {
      if (name in mod) result[name] = mod[name];
    }
    return result;
  }
  return {};
}

export function evalTopLevelCode(topLevelCode: string[], __vesk: Record<string, unknown>): void {
  for (const code of topLevelCode) {
    const ast = tryParseTopLevel(code);
    if (ast && ast.body.length > 0) {
      let handled = false;
      for (const stmt of ast.body as any[]) {
        const target = unwrapExport(stmt);
        if (!target) continue;
        if (target.type === 'VariableDeclaration') {
          for (const d of target.declarations) {
            if (!d.id || d.id.type !== 'Identifier') continue;
            const initSrc = d.init ? code.slice(d.init.start, d.init.end) : 'undefined';
            try {
              const keys = Object.keys(__vesk);
              const params = [...keys, '__vesk', 'result'];
              const body = `result.value = (${initSrc});`;
              const fn = new Function(...params, body);
              const result = { value: undefined as unknown };
              fn(...keys.map(k => __vesk[k]), __vesk, result);
              __vesk[d.id.name] = result.value;
            } catch {
              // skip evaluation errors
            }
          }
          handled = true;
        } else if (target.type === 'FunctionDeclaration' && target.id) {
          try {
            const keys = Object.keys(__vesk);
            const params = [...keys, '__vesk'];
            const paramSrc = target.params.length
              ? code.slice(target.params[0].start, target.params[target.params.length - 1].end)
              : '';
            const bodySrc = code.slice(target.body.start, target.body.end);
            const asyncKw = target.async ? 'async ' : '';
            const fn = new Function(...params, `__vesk['${target.id.name}'] = ${asyncKw}function ${target.id.name}(${paramSrc}) ${bodySrc};`);
            fn(...keys.map(k => __vesk[k]), __vesk);
          } catch {
            // skip evaluation errors
          }
          handled = true;
        }
      }
      if (handled) continue;
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
