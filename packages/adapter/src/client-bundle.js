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

export async function generateClientBundle(routeTree, appDir) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const monorepoClient = resolve(__dirname, '..', '..', 'compiler', 'src', 'client-codegen.js');
  const { compileClient } = existsSync(monorepoClient)
    ? await import(monorepoClient)
    : await import('@vesk/compiler');
  const runtimeDir = findRuntimeSrc(appDir);

  const seen = new Set();
  let bundle = '';

  function walk(nodes) {
    for (const node of nodes) {
      const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
      if (node.page && existsSync(pagePath) && !seen.has(pagePath)) {
        seen.add(pagePath);
        const src = readFileSync(pagePath, 'utf-8');
        const code = compileClient(src, null, { hydrate: true, forceClient: true });
        if (code) {
          bundle += code.replace(/from\s+['"]@vesk\/runtime['"]/g, `from '/_vesk/static/client.js'`) + '\n';
        }
      }
      const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
      if (node.layout && existsSync(layoutPath) && !seen.has(layoutPath)) {
        seen.add(layoutPath);
        const src = readFileSync(layoutPath, 'utf-8');
        const code = compileClient(src, null, { hydrate: true, forceClient: true });
        if (code) {
          bundle += code.replace(/from\s+['"]@vesk\/runtime['"]/g, `from '/_vesk/static/client.js'`) + '\n';
        }
      }
      walk(node.children || []);
    }
  }
  walk(routeTree);

  // Bundle client runtime
  const runtimeFiles = [
    'track.js', 'context.js', 'hydrate.js', 'resource.js',
    'reconcile.js', 'bindings.js', 'router.js', 'request.js',
    'hmr-client.js',
  ];
  let runtimeCode = '';
  for (const f of runtimeFiles) {
    const p = join(runtimeDir, f);
    if (existsSync(p)) {
      let src = readFileSync(p, 'utf-8');
      src = src.replace(/^import\s+.*?from\s+['"].\/.*?['"];?\n?/gm, '');
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

  const fullBundle = runtimeCode + '\n' + bundle + '\n' +
    `const __routeTree = ${JSON.stringify(routeTree)};\n` +
    `const __router = createFileRouter(__routeTree);\n` +
    `if (typeof document !== 'undefined') __router.start();\n`;

  return fullBundle;
}
