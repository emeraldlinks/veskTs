import type { RouteNode, ApiRouteNode, Manifest, ManifestRouteEntry, ManifestPrerenderedEntry, ManifestActionEntry, SsgRouteResult } from '@vesk/adapter/src/types';

/**
 * Specificity key for a route pattern, compared segment by segment: a literal
 * segment outranks a dynamic one, so `/users/me` is tried before
 * `/users/:id`.
 *
 * Every consumer of the manifest — prod-server, adapter dev-server, platform
 * handler — scans `routes` in order and takes the FIRST match, so the order
 * written here IS the routing precedence. Entries came out in directory-scan
 * order, which puts `[id]` ahead of `me`, leaving a static API route
 * permanently unreachable in a production build while the dev tree matcher
 * (which sorts siblings) answered correctly.
 */
function specificityKey(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    // `:x` is one segment, `*x` is the rest of the path — so `*` sorts below
    // `:` and both below a literal.
    .map(seg => (seg.startsWith('*') ? '2' + seg : seg.startsWith(':') ? '1' + seg : '0' + seg));
}

function compareSpecificity(a: string, b: string): number {
  const ka = specificityKey(a);
  const kb = specificityKey(b);
  const len = Math.min(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  }
  return kb.length - ka.length;
}

export function generateManifest(
  routes: RouteNode[],
  ssrRoutes: RouteNode[],
  apiRoutes: ApiRouteNode[],
  staticRoutes: SsgRouteResult[],
  middlewareEnabled: boolean,
  actionMap?: Record<string, string>,
  headExtra?: string,
  eventsEnabled = false
): Manifest {
  const routeEntries: ManifestRouteEntry[] = [];

  for (const r of ssrRoutes) {
    const urlParts = r.fullPath.split('/').filter(Boolean);
    const name = urlParts.map(s => s.startsWith(':') ? s.slice(1) : s).join('_') || 'index';
    const entry: ManifestRouteEntry = {
      path: r.fullPath,
      type: 'ssr',
      function: `server/functions/${name}.js`,
    };
    if (r._revalidate != null) entry.revalidate = r._revalidate;
    if (r._isrTags) entry.tags = r._isrTags;
    routeEntries.push(entry);
  }

  const apiEntries: ManifestRouteEntry[] = [];
  for (const r of apiRoutes) {
    const urlParts = r.fullPath.split('/').filter(Boolean);
    // A catch-all segment is emitted as `*name`, not `:name`. They were both
    // written as `:name`, which made `[...rest]` and `[id]` indistinguishable
    // in the manifest — and since every consumer treats `:` as exactly ONE
    // segment, a catch-all API route could never match more than one segment
    // in a production build (`/api/files/a/b/c` never reached `[...rest]`,
    // while the dev tree matcher handled it correctly).
    const parts = urlParts.map((s, i) => {
      const last = i === urlParts.length - 1;
      if (last && r.isCatchAll && s.startsWith(':')) return '*' + s.slice(1);
      return s;
    });
    // Strip the `:name` / `*name` prefix from DYNAMIC AND CATCH-ALL segments
    // only. A blanket `slice(1)` also decapitates static segments, which made
    // `/api/posts` point at `server/api/osts.js` while the file on disk is
    // `posts.js` — so every static API route 404'd in a production build.
    const name = parts
      .map(s => (s.startsWith(':') || s.startsWith('*')) ? s.slice(1) || 'param' : s)
      .join('_') || 'index';
    apiEntries.push({
      path: parts.length ? `/api/${parts.join('/')}` : '/api',
      type: 'api',
      function: `server/api/${name}.js`,
    });
  }
  apiEntries.sort((a, b) => compareSpecificity(a.path, b.path));
  routeEntries.push(...apiEntries);

  const ssgEntries: ManifestPrerenderedEntry[] = [];
  for (const r of staticRoutes) {
    ssgEntries.push({
      path: r.path,
      file: `prerendered${r.path === '/' ? '/index' : r.path}.html`,
    });
  }

  const actionEntries: ManifestActionEntry[] = actionMap
    ? Object.entries(actionMap).map(([id, fn]) => ({ id, function: fn }))
    : [];

  return {
    version: 1,
    middleware: middlewareEnabled,
    routes: routeEntries,
    prerendered: ssgEntries,
    static: {
      prefix: '/_vesk/static',
      dir: 'static',
    },
    ...(actionEntries.length > 0 ? { actions: actionEntries } : {}),
    ...(headExtra ? { headExtra } : {}),
    ...(eventsEnabled ? { events: true } : {}),
  };
}
