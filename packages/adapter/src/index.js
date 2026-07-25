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
  function walk(nodes) {
    for (const node of nodes) {
      if (node.page) {
        const { funcPath, funcCode, name } = generateSsrFunction(node, appDir, outDir, componentMap);
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
      walk(node.children || []);
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
  const clientCode = await generateClientBundle(routeTree, appDir, componentMap);
  writeFileSync(resolve(outDir, 'static', 'client.js'), clientCode, 'utf-8');
  console.error(`vesk build: client → static/client.js  (${clientCode.length} bytes)`);

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

  if (cssContent !== null) {
    for (const plugin of plugins) {
      if (typeof plugin.onCSS === 'function') {
        const result = await plugin.onCSS(cssContent, cssSourcePath);
        if (result !== null && typeof result === 'string') {
          cssContent = result;
        }
      }
    }
    writeFileSync(cssTarget, cssContent, 'utf-8');
    console.error(`vesk build: css  → static/global.css  (${cssContent.length} bytes)`);
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
