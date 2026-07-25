export function generateManifest(routes, ssrRoutes, apiRoutes, staticRoutes, middlewareEnabled) {
  const routeEntries = [];

  for (const r of ssrRoutes) {
    const urlParts = r.fullPath.split('/').filter(Boolean);
    const name = urlParts.map(s => s.startsWith(':') ? s.slice(1) : s).join('_') || 'index';
    const entry = {
      path: r.fullPath,
      type: 'ssr',
      function: `server/functions/${name}.js`,
    };
    if (r._revalidate != null) entry.revalidate = r._revalidate;
    if (r._isrTags) entry.tags = r._isrTags;
    routeEntries.push(entry);
  }

  // API routes
  for (const r of apiRoutes) {
    const urlParts = r.fullPath.split('/').filter(Boolean);
    const name = urlParts.map(s => s.startsWith(':') ? s.slice(1) || 'param' : s).join('_') || 'index';
    routeEntries.push({
      path: r.fullPath.replace(/^/, '/api'),
      type: 'api',
      function: `server/api/${name}.js`,
    });
  }

  // SSG (pre-rendered static) routes
  const ssgEntries = [];
  for (const r of staticRoutes) {
    ssgEntries.push({
      path: r.path,
      file: `prerendered${r.path === '/' ? '/index' : r.path}.html`,
    });
  }

  return {
    version: 1,
    middleware: middlewareEnabled,
    routes: routeEntries,
    prerendered: ssgEntries,
    static: {
      prefix: '/_vesk/static',
      dir: 'static',
    },
  };
}
