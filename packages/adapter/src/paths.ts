import { resolve, sep } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';

/**
 * Resolves `relPath` against `baseDir` and returns the absolute path ONLY if
 * it stays strictly inside `baseDir` (never the directory itself, never a
 * sibling). Returns null otherwise. Single source of truth for static file
 * serving / prerender writes so traversal defenses cannot drift.
 */
export function resolveWithin(baseDir: string, relPath: string): string | null {
  const base = resolve(baseDir);
  const target = resolve(baseDir, relPath);
  const prefix = base + sep;
  if (!target.startsWith(prefix)) return null;
  return target;
}

/**
 * Installs `globalThis.__vsk_md_read_file` — the server-side backing of <Md>
 * runtime markdown-file loading. Reads ONLY `.md`/`.markdown` files strictly
 * inside one of the given public dirs (never above them, never other file
 * types) and returns null otherwise, so a client-supplied path can only ever
 * surface a public markdown file, never arbitrary filesystem content.
 */
export function installMdReadHook(publicDirs: string[]): void {
  const dirs = publicDirs.map((d) => resolve(d));
  (globalThis as Record<string, unknown>).__vsk_md_read_file = (p: string): string | null => {
    for (const dir of dirs) {
      try {
        let rel = String(p);
        while (rel.length > 0 && rel.charCodeAt(0) === 47) rel = rel.slice(1); // strip leading '/'
        const abs = resolveWithin(dir, rel);
        if (!abs) continue;
        const lower = abs.toLowerCase();
        if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) continue;
        if (existsSync(abs) && statSync(abs).isFile()) return readFileSync(abs, 'utf8');
      } catch {
        /* try the next public dir */
      }
    }
    return null;
  };
}

/**
 * True when an incoming WebSocket upgrade may connect: same-origin when the
 * client sends an Origin header, always allowed for non-browser clients that
 * omit it (matching the HMR threat model — cross-site pages always attach
 * Origin to WS handshakes). Loopback aliases (localhost / 127.0.0.1 / ::1)
 * are treated as equivalent so local dev works over either name.
 */
export function isAllowedWsUpgrade(headers: Record<string, unknown>): boolean {
  const origin = typeof headers['origin'] === 'string' ? headers['origin'] as string : '';
  if (!origin) return true;
  const host = typeof headers['host'] === 'string' ? headers['host'] as string : '';
  if (!host) return false;
  const originAuth = urlAuthority(origin);
  if (originAuth === host.toLowerCase().trim()) return true;
  const a = splitAuthority(originAuth);
  const b = splitAuthority(host.toLowerCase().trim());
  return a.port === b.port && isLoopback(a.hostname) && isLoopback(b.hostname);
}

function splitAuthority(authority: string): { hostname: string; port: string } {
  // bracketed IPv6 [::1]:3000
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close !== -1) {
      return { hostname: authority.slice(0, close + 1), port: authority.slice(close + 2) };
    }
  }
  const colon = authority.lastIndexOf(':');
  if (colon === -1) return { hostname: authority, port: '' };
  let multiColon = false;
  for (let i = 0; i < colon; i++) {
    if (authority[i] === ':') { multiColon = true; break; }
  }
  if (multiColon) return { hostname: authority, port: '' };
  return { hostname: authority.slice(0, colon), port: authority.slice(colon + 1) };
}

function isLoopback(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function urlAuthority(url: string): string {
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
