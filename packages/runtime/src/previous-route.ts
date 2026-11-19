import type { PreviousRouteInfo, PreviousRouteSource } from '@vesk/types';

export const PREVIOUS_ROUTE_HEADER = 'x-vesk-previous-route';
export const RETURN_TO_HEADER = 'x-return-to';
export const REFERRER_HEADER = 'referer';
export const PREVIOUS_ROUTE_QUERY_KEYS = ['next', 'returnTo'] as const;

type HeaderSource =
  | Headers
  | Map<string, string>
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function readHeader(source: HeaderSource, name: string): string | null {
  if (!source) return null;
  try {
    const getter = (source as Headers).get;
    if (typeof getter === 'function') {
      const value = getter.call(source, name);
      return value == null || value === '' ? null : String(value);
    }
  } catch {}
  const value = (source as Record<string, string | string[] | undefined>)[name];
  if (value == null) return null;
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function collectRelevantHeaders(source: HeaderSource): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of [PREVIOUS_ROUTE_HEADER, RETURN_TO_HEADER, REFERRER_HEADER]) {
    const value = readHeader(source, name);
    if (value != null) out.set(name, value);
  }
  return out;
}

function readQuery(source: QuerySource, name: string): string | null {
  if (!source) return null;
  if (typeof (source as URLSearchParams).get === 'function') {
    const value = (source as URLSearchParams).get(name);
    return value == null || value === '' ? null : value;
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  if (value == null) return null;
  return Array.isArray(value) ? value[0] || null : String(value);
}

function normalizedOrigin(origin: string | URL | undefined): URL {
  if (!origin) return new URL('http://vesk.local');
  try {
    return new URL(origin);
  } catch {
    return new URL('http://vesk.local');
  }
}

function sameRouteOrigin(value: URL, base: URL): boolean {
  if (value.protocol !== base.protocol) return false;
  const host = (input: string): string => {
    const lower = input.toLowerCase();
    return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '[::1]'
      ? 'loopback'
      : lower;
  };
  const port = (input: URL): string => input.port || (input.protocol === 'https:' ? '443' : '80');
  const valueHost = host(value.hostname);
  if (valueHost !== host(base.hostname)) return false;
  const valuePort = port(value);
  const basePort = port(base);
  if (valuePort === basePort) return true;
  return valueHost === 'loopback' && (valuePort === '80' || basePort === '80');
}

export function sanitizePreviousRoute(value: unknown, origin: string | URL = 'http://vesk.local'): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.startsWith('\\') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  const isPath = raw.charCodeAt(0) === 47;
  if (!isPath && raw.indexOf(':') === -1) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  try {
    const base = normalizedOrigin(origin);
    const url = new URL(raw, base);
    if (!sameRouteOrigin(url, base)) return null;
    if (url.pathname.startsWith('//') || url.pathname.startsWith('/\\')) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function resolvePreviousRoute(input: {
  headers?: HeaderSource;
  query?: QuerySource;
  origin?: string | URL;
} = {}): PreviousRouteInfo {
  const headers = collectRelevantHeaders(input.headers);
  const candidates: Array<{ source: PreviousRouteSource; value: string | null }> = [
    { source: PREVIOUS_ROUTE_HEADER, value: headers.get(PREVIOUS_ROUTE_HEADER) ?? null },
    { source: RETURN_TO_HEADER, value: headers.get(RETURN_TO_HEADER) ?? null },
    { source: 'query', value: readQuery(input.query, PREVIOUS_ROUTE_QUERY_KEYS[0]) || readQuery(input.query, PREVIOUS_ROUTE_QUERY_KEYS[1]) },
    { source: REFERRER_HEADER, value: headers.get(REFERRER_HEADER) ?? null },
  ];
  for (const candidate of candidates) {
    const route = sanitizePreviousRoute(candidate.value, input.origin);
    if (route) return { route, source: candidate.source, headers };
  }
  return { route: null, source: null, headers };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => (out[key] = value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    Object.assign(out, headers);
  }
  return out;
}

function currentRouteContext(): { origin: string; route: string } | null {
  const globals = globalThis as Record<string, unknown>;
  if (globals.__vsk_ssr) {
    const ctx = globals.__vesk_request as Record<string, unknown> | undefined;
    if (!ctx) return null;
    const request = ctx.request as Request | undefined;
    const raw = ctx.url instanceof URL
      ? ctx.url.href
      : typeof ctx.url === 'string'
        ? ctx.url
        : request?.url;
    if (!raw) return null;
    try {
      const url = new URL(raw, 'http://vesk.local');
      return { origin: url.origin, route: url.pathname + url.search + url.hash };
    } catch {
      return null;
    }
  }
  const loc = typeof location !== 'undefined'
    ? location
    : typeof window !== 'undefined'
      ? window.location
      : null;
  if (!loc) return null;
  return { origin: loc.origin, route: loc.pathname + loc.search + loc.hash };
}

export function currentRouteValue(): string | null {
  const ctx = currentRouteContext();
  return ctx ? sanitizePreviousRoute(ctx.route, ctx.origin) : null;
}

export function withPreviousRouteHeader(url: string, init?: RequestInit, previousRoute: string | null = currentRouteValue()): RequestInit {
  const headers = normalizeHeaders(init?.headers);
  const existing: Record<string, string> = {};
  for (const key of Object.keys(headers)) existing[key.toLowerCase()] = headers[key];
  if (existing[PREVIOUS_ROUTE_HEADER] !== undefined || existing[RETURN_TO_HEADER] !== undefined) {
    return init ?? {};
  }
  const ctx = currentRouteContext();
  if (!ctx || !previousRoute) return init ?? {};
  try {
    const target = new URL(url, ctx.origin);
    if (!sameRouteOrigin(target, new URL(ctx.origin))) return init ?? {};
  } catch {
    return init ?? {};
  }
  headers[PREVIOUS_ROUTE_HEADER] = previousRoute;

  return init ? { ...init, headers } : { headers };
}
