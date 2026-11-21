export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  let pi = 0, pp = 0;
  const params: Record<string, string> = {};
  while (pi < pathParts.length && pp < patternParts.length) {
    const seg = patternParts[pp];
    if (seg.startsWith('*')) {
      params[seg.slice(1)] = pathParts.slice(pi).join('/');
      pi = pathParts.length;
      pp++;
    } else if (seg.startsWith(':')) {
      params[seg.slice(1)] = pathParts[pi];
      pi++;
      pp++;
    } else if (seg === pathParts[pi]) {
      pi++;
      pp++;
    } else {
      return null;
    }
  }
  if (pp === patternParts.length - 1 && patternParts[pp].startsWith('*')) {
    params[patternParts[pp].slice(1)] = pathParts.slice(pi).join('/');
    pp++;
  }
  if (pp === patternParts.length && pi === pathParts.length) return params;
  return null;
}
