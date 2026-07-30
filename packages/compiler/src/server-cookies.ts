export function parseCookies(str: string): Record<string, string> {
  const obj: Record<string, string> = {};
  if (!str) return obj;
  for (const pair of str.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) obj[k] = v;
  }
  return obj;
}
