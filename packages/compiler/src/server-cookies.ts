import type { MiddlewareCookies } from '@vesk/types';

/**
 * Install the canonical `cookies.get(name)` accessor on a plain cookie record.
 *
 * The `get` property is non-enumerable so `{ ...ctx.cookies }` and JSON output
 * keep looking like the original cookie map. A cookie whose literal name is
 * `get` is still reachable through the accessor: the value snapshot is taken
 * before the helper shadows the own property.
 */
export function attachCookieGet(cookies: Record<string, string | undefined>): MiddlewareCookies {
  const values: Record<string, string | undefined> = { ...cookies };
  Object.defineProperty(cookies, 'get', {
    value: (name: string) => {
      const value = cookies[name];
      return typeof value === 'function' && Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : value;
    },
    enumerable: false,
    configurable: true,
  });
  return cookies as MiddlewareCookies;
}

export function parseCookies(str: string): MiddlewareCookies {
  const obj: Record<string, string> = {};
  if (!str) return attachCookieGet(obj);
  for (const pair of str.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) obj[k] = v;
  }
  return attachCookieGet(obj);
}
