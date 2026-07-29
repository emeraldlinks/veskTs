/**
 * Vesk adapter — build API for production deployment.
 * Orchestrates runtime bundling, SSR function generation, API function generation,
 * static file copying, client bundle generation, and production server startup.
 * @module adapter
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bundleRuntime } from './runtime-bundle.js';
import { generateSsrFunction } from './ssr-function.js';
import { generateApiFunction } from './api-function.js';
import { compileMiddleware } from './middleware.js';
import { generateClientBundle } from './client-bundle.js';
import { generateManifest } from './manifest.js';
import { copyStaticAssets } from './static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveCompilerApi(name) {
  const monorepoSrc = resolve(__dirname, '..', '..', 'compiler', 'src');
  if (existsSync(monorepoSrc)) {
    return import(resolve(monorepoSrc, name));
  }
  return import(`@vesk/compiler/src/${name}`);
}

/**
 * Build the .vesk/ output directory.
 */
export async function build(appDir, options = {}) {
  const outDir = resolve(options.outDir || resolve(appDir, '..', '.vesk'));
  const publicDir = options.publicDir || resolve(appDir, '..', 'public');
  const plugins = options.plugins || [];

  // ── Plugin onBuildStart ──
  for (const plugin of plugins) {
    if (typeof plugin.onBuildStart === 'function') {
      await plugin.onBuildStart();
    }
  }

  console.error(`vesk build: output → ${outDir}`);

  // ── Setup output directories ──
  const dirs = [
    resolve(outDir, 'server', 'functions'),
    resolve(outDir, 'server', 'api'),
    resolve(outDir, 'static', 'public'),
    resolve(outDir, 'prerendered'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  // ── Scan routes ──
  const { scanRoutes, scanComponents } = await resolveCompilerApi('router.js');
  const { scanApiRoutes } = await resolveCompilerApi('api-routes.js');
  const { collectMiddlewareChain } = await resolveCompilerApi('middleware.js');

  const routeTree = scanRoutes(appDir);
  if (routeTree.length === 0) {
    console.error('vesk build: no routes found in', appDir);
    return;
  }

  // ── Scan external components from project root ./components/ ──
  const projectRoot = resolve(appDir, '..');
  const componentsDir = resolve(projectRoot, 'components');
  const componentMap = scanComponents(componentsDir);
  if (componentMap.size > 0) {
    console.error(`vesk build: ${componentMap.size} external components found in ${componentsDir}`);
  }

  const apiDir = resolve(appDir, 'api');
  const apiTree = existsSync(apiDir) ? scanApiRoutes(apiDir) : [];

  console.error(`vesk build: ${routeTree.length} root routes, ${apiTree.length} API routes`);

  // ── Bundle server runtime (parser + IR + codegen + hooks) ──
  console.error('vesk build: bundling server runtime...');
  await bundleRuntime(appDir, outDir);

  // ── Generate SSR functions ──
  const ssrRoutes = [];
  function walk(nodes, ancestorLayouts = []) {
    for (const node of nodes) {
      const childAncestorLayouts = node.layout
        ? [...ancestorLayouts, { sourceDir: node.sourceDir, layoutCompName: node.layout }]
        : ancestorLayouts;

      if (node.page) {
        const { funcPath, funcCode, name } = generateSsrFunction(node, appDir, outDir, componentMap, { ancestorLayouts });
        writeFileSync(funcPath, funcCode, 'utf-8');
        // Detect ISR config from page source
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (existsSync(pagePath)) {
          const src = readFileSync(pagePath, 'utf-8');
          const revalidateMatch = src.match(/export\s+const\s+revalidate\s*=\s*(\d+)/);
          if (revalidateMatch) node._revalidate = parseInt(revalidateMatch[1], 10);
          const tagsMatch = src.match(/export\s+const\s+isrTags\s*=\s*\[([^\]]*)\]/);
          if (tagsMatch) {
            node._isrTags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean);
          }
        }
        ssrRoutes.push(node);
        console.error(`vesk build: ssr  → server/functions/${name}.js  (${node.fullPath})`);
      }
      walk(node.children || [], childAncestorLayouts);
    }
  }
  walk(routeTree);

  // ── Generate API functions ──
  const apiRoutes = [];
  function walkApi(nodes) {
    for (const node of nodes) {
      if (node.filePath) {
        const { funcPath, funcCode, name } = generateApiFunction(node, apiDir, outDir);
        writeFileSync(funcPath, funcCode, 'utf-8');
        apiRoutes.push(node);
        console.error(`vesk build: api  → server/api/${name}.js  (${node.fullPath})`);
      }
      walkApi(node.children || []);
    }
  }
  walkApi(apiTree);

  // ── Compile middleware ──
  let middlewareEnabled = false;
  const mwChain = collectMiddlewareChain(routeTree, '/', appDir);
  if (mwChain.length > 0) {
    const mwCode = compileMiddleware(mwChain, appDir);
    if (mwCode) {
      writeFileSync(resolve(outDir, 'server', 'middleware.js'), mwCode, 'utf-8');
      middlewareEnabled = true;
      console.error(`vesk build: mw   → server/middleware.js  (${mwChain.length} middlewares)`);
    }
  }

  // ── Generate client bundle ──
  console.error('vesk build: bundling client runtime...');
  const bundleOpts = { ...(options.codeSplit ? { codeSplit: true } : {}), ...(options.hmr ? { hmr: true } : {}) };
  const { main, chunks } = await generateClientBundle(routeTree, appDir, componentMap, bundleOpts);
  writeFileSync(resolve(outDir, 'static', 'client.js'), main, 'utf-8');
  const mode = chunks.length > 0 ? 'code-split' : 'monolithic';
  console.error(`vesk build: client → static/client.js  (${main.length} bytes, ${mode})`);
  if (chunks.length > 0) {
    const staticDir = resolve(outDir, 'static');
    for (const chunk of chunks) {
      writeFileSync(resolve(staticDir, chunk.name), chunk.code, 'utf-8');
      console.error(`vesk build: chunk → static/${chunk.name}  (${chunk.code.length} bytes)`);
    }
  }

  // ── Copy public/ assets ──
  copyStaticAssets(publicDir, outDir);
  console.error(`vesk build: static → static/public/`);

  // ── Process CSS through plugin pipeline ──
  const srcDir = resolve(appDir, '..', 'src');
  const cssSrc = resolve(srcDir, 'global.css');
  const altCssSrc = resolve(srcDir, 'app.css');
  const cssTarget = resolve(outDir, 'static', 'global.css');

  let cssContent = null;
  let cssSourcePath = null;
  if (existsSync(cssSrc)) {
    cssContent = readFileSync(cssSrc, 'utf-8');
    cssSourcePath = cssSrc;
  } else if (existsSync(altCssSrc)) {
    cssContent = readFileSync(altCssSrc, 'utf-8');
    cssSourcePath = altCssSrc;
  }

  function stripTailwindDirectives(css) {
    const blockStart = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/;
    css = css.replace(/^\s*@import\s+['"]tailwindcss['"]\s*;?\s*$/gm, '');
    css = css.replace(/^\s*@source\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    const lines = css.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
      if (blockStart.test(lines[i].trim())) {
        let braceCount = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
        i++;
        while (i < lines.length && braceCount > 0) {
          braceCount += (lines[i].match(/\{/g) || []).length;
          braceCount -= (lines[i].match(/\}/g) || []).length;
          i++;
        }
        continue;
      }
      result.push(lines[i]);
      i++;
    }
    return result.join('\n').trim();
  }

  if (cssContent !== null) {
    // User CSS: strip tailwind directives
    const userCss = stripTailwindDirectives(cssContent);
    const userCssTarget = resolve(outDir, 'static', 'global.css');
    writeFileSync(userCssTarget, userCss, 'utf-8');
    console.error(`vesk build: css  → static/global.css  (${userCss.length} bytes)`);

    // Tailwind CSS: process through plugin pipeline
    let twCss = cssContent;
    for (const plugin of plugins) {
      if (typeof plugin.onCSS === 'function') {
        const result = await plugin.onCSS(twCss, cssSourcePath);
        if (result !== null && typeof result === 'string') {
          twCss = result;
        }
      }
    }
    const twCssTarget = resolve(outDir, 'static', '_tailwind.css');
    // Strip unresolved tailwind imports — if no plugin processed them, the
    // browser would 404 trying to resolve @import "tailwindcss" as a URL.
    const hasUnresolvedTailwindImport = /@import\s+['"]tailwindcss['"]/.test(twCss);
    if (hasUnresolvedTailwindImport) {
      const lines = twCss.split('\n').filter(l => !/^\s*@import\s+['"]tailwindcss['"]/.test(l));
      twCss = lines.join('\n').trim();
      if (twCss.length === 0) {
        // Nothing left — no tailwind output to serve
        writeFileSync(twCssTarget, '', 'utf-8');
        console.error(`vesk build: css  → static/_tailwind.css  (empty, tailwind unresolved)`);
      } else {
        writeFileSync(twCssTarget, twCss, 'utf-8');
        console.error(`vesk build: css  → static/_tailwind.css  (${twCss.length} bytes, tailwind partially unresolved)`);
      }
    } else {
      writeFileSync(twCssTarget, twCss, 'utf-8');
      console.error(`vesk build: css  → static/_tailwind.css  (${twCss.length} bytes)`);
    }
  }

  // ── SSG pre-rendering ──
  let prerenderedRoutes = [];
  if (options.ssg) {
    const { generateSsgRoutes } = await import('./static.js');
    prerenderedRoutes = await generateSsgRoutes(routeTree, appDir, outDir);
    console.error(`vesk build: ssg   → prerendered/  (${prerenderedRoutes.length} pages)`);
  }

  // ── Image optimization pipeline ──
  {
    const { optimizeImages } = await import('./image-pipeline.js');
    await optimizeImages(appDir, outDir);
  }

  // ── SEO audit (only with --seo flag) ──
  if (options.seo) {
    const { runSeoAudit } = await import('./seo-audit.js');
    const audit = runSeoAudit(appDir);
    if (options.strictSeo && audit.errors > 0) {
      throw new Error(`SEO audit failed with ${audit.errors} error(s) — fix them before deploying`);
    }
  }

  // ── Auto-generate SEO files (sitemap.xml + robots.txt) ──
  {
    const { optimizeImages } = await import('./image-pipeline.js');
    await optimizeImages(appDir, outDir);
  }

  // ── Auto-generate SEO files (sitemap.xml + robots.txt) ──
  {
    const { generateSitemap, generateRobotsTxt } = await import('./static.js');
    const publicDir = resolve(outDir, 'static', 'public');
    const siteUrl = options.siteUrl || 'http://localhost:3000';

    const sitemapOverride = resolve(publicDir, 'sitemap.xml');
    if (!existsSync(sitemapOverride)) {
      const sitemap = generateSitemap(routeTree, ssrRoutes, prerenderedRoutes, { siteUrl });
      writeFileSync(sitemapOverride, sitemap, 'utf-8');
      console.error(`vesk build: seo   → static/public/sitemap.xml (${sitemap.length} bytes)`);
    }

    const robotsOverride = resolve(publicDir, 'robots.txt');
    if (!existsSync(robotsOverride)) {
      const robots = generateRobotsTxt(siteUrl);
      writeFileSync(robotsOverride, robots, 'utf-8');
      console.error(`vesk build: seo   → static/public/robots.txt (${robots.length} bytes)`);
    }
  }

  // ── Write manifest ──
  const manifest = generateManifest(routeTree, ssrRoutes, apiRoutes, prerenderedRoutes, middlewareEnabled);
  writeFileSync(resolve(outDir, 'config.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.error(`vesk build: config → config.json`);

  // ── Plugin onBuildEnd ──
  for (const plugin of plugins) {
    if (typeof plugin.onBuildEnd === 'function') {
      await plugin.onBuildEnd();
    }
  }

  console.error(`\nvesk build: done (${outDir})`);
  return { routeTree, apiTree, ssrRoutes, apiRoutes, manifest };
}

export { startProdServer } from './prod-server.js';
