import type { RouteNode, ApiRouteNode, Manifest, ManifestRouteEntry, ManifestPrerenderedEntry, ManifestActionEntry, SsgRouteResult } from '@vesk/adapter/src/types';

export function generateManifest(
  routes: RouteNode[],
  ssrRoutes: RouteNode[],
  apiRoutes: ApiRouteNode[],
  staticRoutes: SsgRouteResult[],
  middlewareEnabled: boolean,
  actionMap?: Record<string, string>,
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

  for (const r of apiRoutes) {
    const urlParts = r.fullPath.split('/').filter(Boolean);
    const name = urlParts.map(s => s.startsWith(':') ? s.slice(1) || 'param' : s).join('_') || 'index';
    routeEntries.push({
      path: `/api${r.fullPath}`,
      type: 'api',
      function: `server/api/${name}.js`,
    });
  }

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
  };
}
