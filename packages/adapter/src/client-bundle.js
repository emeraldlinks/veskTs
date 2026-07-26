import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRuntimeSrc(appDir) {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const monorepoRuntime = resolve(monorepoRoot, 'packages', 'runtime', 'src');
  if (existsSync(monorepoRuntime)) return monorepoRuntime;

  const projectRuntime = resolve(appDir, '..', 'node_modules', '@vesk/runtime', 'src');
  if (existsSync(projectRuntime)) return projectRuntime;

  const appRuntime = resolve(appDir, 'node_modules', '@vesk/runtime', 'src');
  if (existsSync(appRuntime)) return appRuntime;

  throw new Error('@vesk/runtime/src not found');
}

export async function generateClientBundle(routeTree, appDir, componentMap = new Map()) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const monorepoClient = resolve(__dirname, '..', '..', 'compiler', 'src', 'client-codegen.js');
  const { compileClient } = existsSync(monorepoClient)
    ? await import(monorepoClient)
    : await import('@vesk/compiler');
  const runtimeDir = findRuntimeSrc(appDir);

  const seen = new Set();
  let bundle = 'const __components = {};\n';
  const aliasLines = [];

  function walk(nodes) {
    for (const node of nodes) {
      const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
      if (node.page && existsSync(pagePath) && !seen.has(pagePath)) {
        seen.add(pagePath);
        const src = readFileSync(pagePath, 'utf-8');
        const code = compileClient(src, null, { hydrate: true, forceClient: true });
        if (code) {
          bundle += code.replace(/from\s+['"]@vesk\/runtime['"]/g, `from '/_vesk/static/client.js'`)
                        .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '') + '\n';
          const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
          if (actualName && actualName !== node.page) {
            aliasLines.push(`__components[${JSON.stringify(node.page)}] = __components[${JSON.stringify(actualName)}];`);
          }
        }
      }
      const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
      if (node.layout && existsSync(layoutPath) && !seen.has(layoutPath)) {
        seen.add(layoutPath);
        const src = readFileSync(layoutPath, 'utf-8');
        const code = compileClient(src, null, { hydrate: true, forceClient: true });
        if (code) {
          bundle += code.replace(/from\s+['"]@vesk\/runtime['"]/g, `from '/_vesk/static/client.js'`)
                        .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '') + '\n';
          const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
          if (actualName && actualName !== node.layout) {
            aliasLines.push(`__components[${JSON.stringify(node.layout)}] = __components[${JSON.stringify(actualName)}];`);
          }
        }
      }
      walk(node.children || []);
    }
  }
  walk(routeTree);

  // ── External component files (./components/) ──
  for (const [compName, compPath] of componentMap) {
    if (seen.has(compPath)) continue;
    seen.add(compPath);
    const src = readFileSync(compPath, 'utf-8');
    const code = compileClient(src, null, { hydrate: true, forceClient: true });
    if (code) {
      bundle += code.replace(/from\s+['"]@vesk\/runtime['"]/g, `from '/_vesk/static/client.js'`)
                    .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '') + '\n';
      const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
      if (actualName && actualName !== compName) {
        aliasLines.push(`__components[${JSON.stringify(compName)}] = __components[${JSON.stringify(actualName)}];`);
      }
    }
  }

  // Bundle client runtime — ripple reactivity first, then utilities
  const runtimeFiles = [
    'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
    'context.js', 'hydrate.js', 'resource.js',
    'reconcile.js', 'bindings.js', 'router.js',
    'portal.js', 'hmr-client.js',
    'seo.js', 'image.js', 'experiment.js', 'form.js',
  ];
  let runtimeCode = '';
  for (const f of runtimeFiles) {
    const p = join(runtimeDir, f);
    if (existsSync(p)) {
      let src = readFileSync(p, 'utf-8');
      src = src.replace(/^import\s+[\s\S]*?from\s+['"].\/.*?['"];?\n?/gm, '');
      src = src.replace(/^export\s+/gm, '');
      runtimeCode += `// --- ${f} ---\n${src}\n`;
    }
  }
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const exportNames = indexSrc.match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
    ?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim())) || [];

  runtimeCode += `// --- exports ---\n`;
  for (const name of [...new Set(exportNames)]) {
    if (name) runtimeCode += `export { ${name} };\n`;
  }

  const aliasCode = aliasLines.length > 0 ? aliasLines.join('\n') + '\n' : '';
  const fullBundle = runtimeCode + '\n' + bundle + '\n' +
    aliasCode +
    `globalThis.__components = __components;\n` +
    `function __resolveNames(nodes) {\n` +
    `  for (const n of nodes) {\n` +
    `    if (typeof n.page === 'string') {\n` +
    `      n._pageName = n.page;\n` +
    `      n.page = __components[n.page];\n` +
    `    }\n` +
    `    if (typeof n.layout === 'string') {\n` +
    `      n._layoutName = n.layout;\n` +
    `      n.layout = __components[n.layout];\n` +
    `    }\n` +
    `    if (n.children) __resolveNames(n.children);\n` +
    `  }\n` +
    `}\n` +
    `function __updateComponents(nodes) {\n` +
    `  for (const n of nodes) {\n` +
    `    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n` +
    `    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n` +
    `    if (n.children) __updateComponents(n.children);\n` +
    `  }\n` +
    `}\n` +
    `const __routeTree = ${JSON.stringify(routeTree)};\n` +
    `__resolveNames(__routeTree);\n` +
    `const __router = createFileRouter(__routeTree);\n` +
    `__router.__updateComponents = __updateComponents;\n` +
    `if (typeof document !== 'undefined') __router.start();\n`;

  return fullBundle;
}
