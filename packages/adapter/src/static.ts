import { mkdirSync, copyFileSync, readdirSync, statSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import type { RouteNode, SsgRouteResult } from './types';

export function copyStaticAssets(publicDir: string, outDir: string): void {
  const targetDir = resolve(outDir, 'static', 'public');
  mkdirSync(targetDir, { recursive: true });

  if (!existsSync(publicDir)) return;

  function copyDir(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const st = statSync(srcPath);
      if (st.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(publicDir, targetDir);
}

export async function generateSsgRoutes(routeTree: RouteNode[], appDir: string, outDir: string): Promise<SsgRouteResult[]> {
  const { ssg } = await import('../../compiler/src/server-render.js') as { ssg: (source: string, componentName: string | null, customProps: Record<string, unknown> | undefined, options: Record<string, unknown>) => Promise<{ html: string; body: string; head: string; props: string; clientCode: string; static: boolean; staticLists: boolean }> };
  const prerenderDir = resolve(outDir, 'prerendered');
  mkdirSync(prerenderDir, { recursive: true });

  const results: SsgRouteResult[] = [];

  async function evaluateExport(src: string, exportName: string): Promise<unknown> {
    try {
      const match = src.match(new RegExp(`export\\s+async\\s+function\\s+${exportName}\\s*\\(([^)]*)\\)\\s*{([\\s\\S]*?\\n})`));
      if (!match) return null;
      const params = match[1].split(',').map(p => p.trim()).filter(Boolean);
      const body = match[2];
      const fn = new Function(...params, `return (async () => { ${body} })()`) as (...args: unknown[]) => Promise<unknown>;
      return await fn();
    } catch {
      return null;
    }
  }

  async function walk(nodes: RouteNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.page) {
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        const src = readFileSync(pagePath, 'utf-8');
        const hasStaticProps = src.includes('getStaticProps');
        const hasStaticPaths = src.includes('getStaticPaths');

        if (hasStaticPaths) {
          const paths = await evaluateExport(src, 'getStaticPaths');
          if (paths && Array.isArray(paths)) {
            for (const entry of paths) {
              try {
                const params: Record<string, string> = (entry as Record<string, unknown>).params as Record<string, string> || {};
                const result = await ssg(src, null, params, {});
                const urlPath = (entry as Record<string, unknown>).path as string || node.fullPath;
                const htmlPath = resolve(prerenderDir, urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}.html`);
                mkdirSync(resolve(htmlPath, '..'), { recursive: true });
                writeFileSync(htmlPath, result.html);
                results.push({ path: urlPath, html: htmlPath, static: result.static, params });
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error(`vesk: SSG failed for ${pagePath} (path: ${(entry as Record<string, unknown>).path || node.fullPath}): ${message}`);
              }
            }
          }
        } else if (hasStaticProps) {
          try {
            const result = await ssg(src, null, undefined, {});
            const htmlPath = resolve(prerenderDir, node.fullPath === '/' ? 'index.html' : `${node.fullPath.slice(1)}.html`);
            mkdirSync(resolve(htmlPath, '..'), { recursive: true });
            writeFileSync(htmlPath, result.html);
            results.push({ path: node.fullPath, html: htmlPath, static: result.static });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`vesk: SSG failed for ${pagePath}: ${message}`);
          }
        }
      }
      await walk(node.children || []);
    }
  }

  await walk(routeTree);
  return results;
}

export function generateSitemap(
  _routeTree: RouteNode[],
  ssrRoutes: RouteNode[],
  prerenderedRoutes: SsgRouteResult[],
  { siteUrl = 'http://localhost:3000' }: { siteUrl?: string } = {},
): string {
  const urls: Array<{ loc: string; priority: string; changefreq: string }> = [];
  const seen = new Set<string>();

  function addUrl(path: string, priority: string, changefreq: string): void {
    if (seen.has(path)) return;
    seen.add(path);
    const cleanPath = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
    urls.push({ loc: `${siteUrl}${cleanPath}`, priority, changefreq });
  }

  for (const r of prerenderedRoutes) {
    addUrl(r.path, '0.80', 'weekly');
  }

  function walk(nodes: RouteNode[]): void {
    for (const node of nodes) {
      if (node.page && !node.fullPath.includes(':')) {
        addUrl(node.fullPath, '0.64', 'daily');
      }
      walk(node.children || []);
    }
  }
  walk(ssrRoutes);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const u of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${u.loc}</loc>\n`;
    xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
    xml += `    <priority>${u.priority}</priority>\n`;
    xml += '  </url>\n';
  }
  xml += '</urlset>\n';
  return xml;
}

export function generateRobotsTxt(siteUrl = 'http://localhost:3000'): string {
  return `User-agent: *
Allow: /
Sitemap: ${siteUrl}/sitemap.xml
`;
}
