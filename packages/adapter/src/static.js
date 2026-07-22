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

  async function walk(nodes) {
    for (const node of nodes) {
      if (node.page) {
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        const src = readFileSync(pagePath, 'utf-8');
        const hasStaticProps = src.includes('getStaticProps');

        if (hasStaticProps) {
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
