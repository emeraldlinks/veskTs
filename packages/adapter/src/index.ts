import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRuntime } from '@vesk/adapter/src/runtime-bundle';
import { generateSsrFunction } from '@vesk/adapter/src/ssr-function';
import { generateApiFunction } from '@vesk/adapter/src/api-function';
import { compileMiddleware, compileMiddlewareCode } from '@vesk/adapter/src/middleware';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { generateManifest } from '@vesk/adapter/src/manifest';
import { copyStaticAssets } from '@vesk/adapter/src/static';
import type {
  RouteNode, ApiRouteNode, BuildOptions, BuildResult, AncestorLayout,
  MiddlewareChainItem, VeskPlugin, Manifest,
} from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function resolveCompilerApi<T = Record<string, unknown>>(name: string): Promise<T> {
  const monorepoSrc = resolve(__dirname, '..', '..', 'compiler', 'src');
  if (existsSync(monorepoSrc)) {
    const tsFile = resolve(monorepoSrc, name.replace(/\.js$/, '.ts'));
    if (existsSync(tsFile)) {
      return import(tsFile) as Promise<T>;
    }
    return import(resolve(monorepoSrc, name)) as Promise<T>;
  }
  return import(`@vesk/compiler/src/${name}`) as Promise<T>;
}

export async function build(appDir: string, options?: BuildOptions): Promise<BuildResult | undefined> {
  appDir = resolve(appDir);
  const outDir = resolve(options?.outDir || resolve(appDir, '..', '.vesk'));
  const publicDir = options?.publicDir || resolve(appDir, '..', 'public');
  const plugins: VeskPlugin[] = options?.plugins || [];

  for (const plugin of plugins) {
    if (typeof plugin.onBuildStart === 'function') {
      await plugin.onBuildStart();
    }
  }

  console.error(`vesk build: output → ${outDir}`);

  const dirs = [
    resolve(outDir, 'server', 'functions'),
    resolve(outDir, 'server', 'api'),
    resolve(outDir, 'static', 'public'),
    resolve(outDir, 'prerendered'),
  ];
  for (const d of dirs) mkdirSync(d, { recursive: true });

  const { scanRoutes, scanComponents } = await resolveCompilerApi<{
    scanRoutes: (appDir: string, options?: Record<string, unknown>) => RouteNode[];
    scanComponents: (componentsDir: string) => Map<string, string>;
  }>('router.js');
  const { scanApiRoutes } = await resolveCompilerApi<{
    scanApiRoutes: (apiDir: string) => ApiRouteNode[];
  }>('api-routes.js');
  const { collectMiddlewareChain } = await resolveCompilerApi<{
    collectMiddlewareChain: (routeTree: RouteNode[], url: string, appDir: string) => MiddlewareChainItem[];
  }>('middleware.js');

  const routeTree = scanRoutes(appDir);
  if (routeTree.length === 0) {
    console.error('vesk build: no routes found in', appDir);
    return;
  }

  const projectRoot = resolve(appDir, '..');
  const componentsDir = resolve(projectRoot, 'components');
  const componentMap = scanComponents(componentsDir);
  if (componentMap.size > 0) {
    console.error(`vesk build: ${componentMap.size} external components found in ${componentsDir}`);
  }

  const apiDir = resolve(appDir, 'api');
  const apiTree = existsSync(apiDir) ? scanApiRoutes(apiDir) : [];

  console.error(`vesk build: ${routeTree.length} root routes, ${apiTree.length} API routes`);

  console.error('vesk build: bundling server runtime...');
  await bundleRuntime(appDir, outDir);

  const ssrRoutes: RouteNode[] = [];
  function walk(nodes: RouteNode[], ancestorLayouts: AncestorLayout[] = []): void {
    for (const node of nodes) {
      const childAncestorLayouts = node.layout
        ? [...ancestorLayouts, { sourceDir: node.sourceDir, layoutCompName: node.layout }]
        : ancestorLayouts;

      if (node.page) {
        const mwChain = collectMiddlewareChain(routeTree, node.fullPath, appDir);
        let mwCode: string | null = null;
        if (mwChain.length > 0) {
          const mwSources = mwChain.map((m: MiddlewareChainItem) => readFileSync(m.sourcePath, 'utf-8'));
          mwCode = compileMiddlewareCode(mwSources);
        }
        const { funcPath, funcCode, name } = generateSsrFunction(node, appDir, outDir, componentMap, { ancestorLayouts, middlewareCode: mwCode });
        writeFileSync(funcPath, funcCode, 'utf-8');
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
        console.error(`vesk build: ssr  → server/functions/${name}.js  (${node.fullPath})${mwCode ? ' [mw]' : ''}`);
      }
      walk(node.children || [], childAncestorLayouts);
    }
  }
  walk(routeTree);

  const apiRoutes: ApiRouteNode[] = [];
  function walkApi(nodes: ApiRouteNode[]): void {
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

  console.error('vesk build: bundling client runtime...');
  const bundleOpts: { codeSplit?: boolean; hmr?: boolean } = {};
  if (options?.codeSplit) bundleOpts.codeSplit = true;
  if (options?.hmr) bundleOpts.hmr = true;
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

  copyStaticAssets(publicDir, outDir);
  console.error('vesk build: static → static/public/');

  const srcDir = resolve(appDir, '..', 'src');
  const cssSrc = resolve(srcDir, 'global.css');
  const altCssSrc = resolve(srcDir, 'app.css');

  let cssContent: string | null = null;
  let cssSourcePath: string | null = null;
  if (existsSync(cssSrc)) {
    cssContent = readFileSync(cssSrc, 'utf-8');
    cssSourcePath = cssSrc;
  } else if (existsSync(altCssSrc)) {
    cssContent = readFileSync(altCssSrc, 'utf-8');
    cssSourcePath = altCssSrc;
  }

  function stripTailwindDirectives(css: string): string {
    const blockStart = /^\s*@(theme\s*\{|layer\s+(base|components|utilities)\s*\{|utility\s+\w+\s*\{)/;
    let result = css.replace(/^\s*@import\s+['"]tailwindcss['"]\s*;?\s*$/gm, '');
    result = result.replace(/^\s*@source\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    const lines = result.split('\n');
    const output: string[] = [];
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
      output.push(lines[i]);
      i++;
    }
    return output.join('\n').trim();
  }

  if (cssContent !== null) {
    const userCss = stripTailwindDirectives(cssContent);
    const userCssTarget = resolve(outDir, 'static', 'global.css');
    writeFileSync(userCssTarget, userCss, 'utf-8');
    console.error(`vesk build: css  → static/global.css  (${userCss.length} bytes)`);

    let twCss = cssContent;
    for (const plugin of plugins) {
      if (typeof plugin.onCSS === 'function') {
        const result = await plugin.onCSS(twCss, cssSourcePath!);
        if (result !== null && typeof result === 'string') {
          twCss = result;
        }
      }
    }
    const twCssTarget = resolve(outDir, 'static', '_tailwind.css');
    const hasUnresolvedTailwindImport = /@import\s+['"]tailwindcss['"]/.test(twCss);
    if (hasUnresolvedTailwindImport) {
      const lines = twCss.split('\n').filter(l => !/^\s*@import\s+['"]tailwindcss['"]/.test(l));
      twCss = lines.join('\n').trim();
      if (twCss.length === 0) {
        writeFileSync(twCssTarget, '', 'utf-8');
        console.error('vesk build: css  → static/_tailwind.css  (empty, tailwind unresolved)');
      } else {
        writeFileSync(twCssTarget, twCss, 'utf-8');
        console.error(`vesk build: css  → static/_tailwind.css  (${twCss.length} bytes, tailwind partially unresolved)`);
      }
    } else {
      writeFileSync(twCssTarget, twCss, 'utf-8');
      console.error(`vesk build: css  → static/_tailwind.css  (${twCss.length} bytes)`);
    }
  }

  let prerenderedRoutes: Array<{ path: string; html: string; static: boolean; params?: Record<string, string> }> = [];
  if (options?.ssg) {
    const { generateSsgRoutes } = await import('./static.js') as { generateSsgRoutes: typeof import('./static.js').generateSsgRoutes };
    prerenderedRoutes = await generateSsgRoutes(routeTree, appDir, outDir);
    console.error(`vesk build: ssg   → prerendered/  (${prerenderedRoutes.length} pages)`);
  }

  {
    const { optimizeImages } = await import('./image-pipeline.js') as { optimizeImages: typeof import('./image-pipeline.js').optimizeImages };
    await optimizeImages(appDir, outDir);
  }

  if (options?.seo) {
    const { runSeoAudit } = await import('./seo-audit.js') as { runSeoAudit: typeof import('./seo-audit.js').runSeoAudit };
    const audit = runSeoAudit(appDir);
    if (options?.strictSeo && audit.errors > 0) {
      throw new Error(`SEO audit failed with ${audit.errors} error(s) — fix them before deploying`);
    }
  }

  {
    const { optimizeImages } = await import('./image-pipeline.js') as { optimizeImages: typeof import('./image-pipeline.js').optimizeImages };
    await optimizeImages(appDir, outDir);
  }

  {
    const { generateSitemap, generateRobotsTxt } = await import('./static.js') as {
      generateSitemap: typeof import('./static.js').generateSitemap;
      generateRobotsTxt: typeof import('./static.js').generateRobotsTxt;
    };
    const publicDirResolved = resolve(outDir, 'static', 'public');
    const siteUrl = options?.siteUrl || 'http://localhost:3000';

    const sitemapOverride = resolve(publicDirResolved, 'sitemap.xml');
    if (!existsSync(sitemapOverride)) {
      const sitemap = generateSitemap(routeTree, ssrRoutes, prerenderedRoutes, { siteUrl });
      writeFileSync(sitemapOverride, sitemap, 'utf-8');
      console.error(`vesk build: seo   → static/public/sitemap.xml (${sitemap.length} bytes)`);
    }

    const robotsOverride = resolve(publicDirResolved, 'robots.txt');
    if (!existsSync(robotsOverride)) {
      const robots = generateRobotsTxt(siteUrl);
      writeFileSync(robotsOverride, robots, 'utf-8');
      console.error(`vesk build: seo   → static/public/robots.txt (${robots.length} bytes)`);
    }
  }

  const manifest = generateManifest(routeTree, ssrRoutes, apiRoutes, prerenderedRoutes, middlewareEnabled);
  writeFileSync(resolve(outDir, 'config.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.error('vesk build: config → config.json');

  if (options?.target === 'edge') {
    const { generateEdgeEntry, bundleEdgeEntry } = await import('@vesk/adapter/src/edge-entry') as {
      generateEdgeEntry: typeof import('@vesk/adapter/src/edge-entry').generateEdgeEntry;
      bundleEdgeEntry: typeof import('@vesk/adapter/src/edge-entry').bundleEdgeEntry;
    };
    const prerenderedPaths = prerenderedRoutes.map(r => r.path);
    const entryFile = await generateEdgeEntry(outDir, ssrRoutes, apiRoutes, prerenderedPaths, middlewareEnabled);
    const edgeFile = await bundleEdgeEntry(entryFile, outDir);
    console.error(`vesk build: edge → edge.js  (${edgeFile})`);
  }

  for (const plugin of plugins) {
    if (typeof plugin.onBuildEnd === 'function') {
      await plugin.onBuildEnd();
    }
  }

  console.error(`\nvesk build: done (${outDir})`);
  return { routeTree, apiTree, ssrRoutes, apiRoutes, manifest };
}

export { startProdServer } from '@vesk/adapter/src/prod-server';
