import { mkdirSync, copyFileSync, readdirSync, statSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join, relative, extname } from 'path';

export function copyStaticAssets(publicDir, outDir) {
  const targetDir = resolve(outDir, 'static', 'public');
  mkdirSync(targetDir, { recursive: true });

  if (!existsSync(publicDir)) return;

  function copyDir(src, dest) {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const stat = statSync(srcPath);
      if (stat.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(publicDir, targetDir);
}

export async function generateSsgRoutes(routeTree, appDir, outDir) {
  const { ssg, compileClient } = await import('@vesk/compiler/src/server-codegen.js');
  const prerenderDir = resolve(outDir, 'prerendered');
  mkdirSync(prerenderDir, { recursive: true });

  const results = [];

  async function evaluateExport(src, exportName) {
    try {
      const match = src.match(new RegExp(`export\\s+async\\s+function\\s+${exportName}\\s*\\(([^)]*)\\)\\s*{([\\s\\S]*?\\n})`));
      if (!match) return null;
      const params = match[1].split(',').map(p => p.trim()).filter(Boolean);
      const body = match[2];
      const fn = new Function(...params, `return (async () => { ${body} })()`);
      return await fn();
    } catch { return null; }
  }

  async function walk(nodes) {
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
                const params = entry.params || {};
                const result = await ssg(src, null, params, {});
                const urlPath = entry.path || node.fullPath;
                const htmlPath = resolve(prerenderDir, urlPath === '/' ? 'index.html' : `${urlPath.replace(/^\//, '')}.html`);
                mkdirSync(resolve(htmlPath, '..'), { recursive: true });
                writeFileSync(htmlPath, result.html);
                results.push({ path: urlPath, html: htmlPath, static: result.static, params });
              } catch (e) {
                console.error(`vesk: SSG failed for ${pagePath} (path: ${entry.path || node.fullPath}): ${e.message}`);
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
            console.error(`vesk: SSG failed for ${pagePath}: ${e.message}`);
          }
        }
      }
      await walk(node.children || []);
    }
  }

  await walk(routeTree);
  return results;
}

export function generateSitemap(routeTree, ssrRoutes, prerenderedRoutes, { siteUrl = 'http://localhost:3000' } = {}) {
  const urls = [];
  const seen = new Set();

  function addUrl(path, priority, changefreq) {
    if (seen.has(path)) return;
    seen.add(path);
    const cleanPath = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
    urls.push({ loc: `${siteUrl}${cleanPath}`, priority, changefreq });
  }

  for (const r of prerenderedRoutes) {
    addUrl(r.path, '0.80', 'weekly');
  }

  function walk(nodes) {
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

export function generateRobotsTxt(siteUrl = 'http://localhost:3000') {
  return `User-agent: *
Allow: /
Sitemap: ${siteUrl}/sitemap.xml
`;
}
