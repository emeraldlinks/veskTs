import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { resolveComponentName } from '@vesk/compiler/src/server-codegen';
import { collectVskImportPaths, vskImportLines } from '@vesk/compiler/src/vsk-imports';
import type { RouteNode, ClientBundleOptions, ClientBundleResult, ChunkEntry, MonolithicBundleParts } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRuntimeSrc(appDir: string): string {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const candidates = [
    resolve(monorepoRoot, 'packages', 'runtime', 'dist'),
    resolve(appDir, '..', 'node_modules', '@vesk/runtime'),
    resolve(appDir, 'node_modules', '@vesk/runtime'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'index-client.js'))) return dir;
    }
  }
  throw new Error('@vesk/runtime/dist not found — run "npm run build" first');
}

export async function generateClientBundle(
  routeTree: RouteNode[],
  appDir: string,
  componentMap?: Map<string, string>,
  options?: ClientBundleOptions,
): Promise<ClientBundleResult> {
  const runtimeDir = findRuntimeSrc(appDir);

  const seen = new Set<string>();
  const chunks: ChunkEntry[] = [];
  const runtimeImportNames = new Set<string>();

  function collectRuntimeImports(code: string): void {
    const re = /^import\s*\{([^}]*)\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm;
    for (const m of code.matchAll(re)) {
      for (const name of m[1].split(',')) {
        const trimmed = name.trim().replace(/^(\w+)\s+as\s+.*$/, '$1');
        if (!trimmed || /^(type|typeof)\s/.test(trimmed)) continue;
        runtimeImportNames.add(trimmed);
      }
    }
  }

  function stripRuntimeImport(code: string): string {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, '')
               .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '')
               .replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '');
  }

  function stripVskImports(code: string): string {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*\.vsk['"];?\s*\n?/gm, '');
  }

  function resolveVskImports(filePath: string, compile: (path: string, resolvedName: string | null) => void): void {
    const src = readFileSync(filePath, 'utf-8');
    for (const importPath of collectVskImportPaths(vskImportLines(src), filePath)) {
      let importedName: string | null = null;
      try {
        importedName = resolveComponentName(readFileSync(importPath, 'utf-8'));
      } catch {
        continue;
      }
      compile(importPath, importedName);
    }
  }

  function stripExports(code: string): string {
    return code
      .replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, '')
      .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
  }

  function compileFile(filePath: string, resolvedName: string, output: string[]): void {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    const src = readFileSync(filePath, 'utf-8');

    resolveVskImports(filePath, (p, n) => compileFile(p, n || '', output));

    const compCode = compileClient(src, null, { forceClient: true });
    if (compCode) {
      collectRuntimeImports(compCode);
      const stripped = stripExports(stripVskImports(stripRuntimeImport(compCode)));
      output.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
    }

    const hydCode = compileClient(src, null, { hydrate: true, forceClient: true, includeTopLevel: false });
    if (hydCode) {
      collectRuntimeImports(hydCode);
      const stripped = stripExports(stripVskImports(stripRuntimeImport(hydCode)))
        .replace(/__components/g, '__hydrators');
      output.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
    }

    const actualName = resolveComponentName(src);
    if (actualName && actualName !== resolvedName) {
      output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
      output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
    }
  }

  function buildChunkName(node: RouteNode): string {
    const dir = relative(appDir, node.sourceDir || '');
    const parts = dir.split(sep).filter(Boolean);
    const slug = parts.length > 0 ? parts.join('-') : 'index';
    return slug.replace(/[\[\]]/g, '_');
  }

  const codeSplit = !!(options?.codeSplit);

  if (codeSplit) {
    const chunkEntries: Array<{ name: string; code: string; node: RouteNode }> = [];

    function walkSplit(nodes: RouteNode[], _chain: RouteNode[]): void {
      for (const node of nodes) {
        const chunkCode: string[] = [];
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) {
          compileFile(pagePath, node.page, chunkCode);
        }
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) {
          compileFile(layoutPath, node.layout, chunkCode);
        }
        const errorPath = resolve(appDir, node.sourceDir, 'error.vsk');
        if (node.error && existsSync(errorPath)) {
          compileFile(errorPath, node.error, chunkCode);
        }
        const notFoundPath = resolve(appDir, node.sourceDir, 'not-found.vsk');
        if (node.notFound && existsSync(notFoundPath)) {
          compileFile(notFoundPath, node.notFound, chunkCode);
        }
        const loadingPath = resolve(appDir, node.sourceDir, 'loading.vsk');
        if (node.loading && existsSync(loadingPath)) {
          compileFile(loadingPath, node.loading, chunkCode);
        }
        if (chunkCode.length > 0) {
          const chunkName = `page-${buildChunkName(node)}.js`;
          chunkEntries.push({ name: chunkName, code: chunkCode.join('\n\n'), node });
        }
        walkSplit(node.children || [], [..._chain, node]);
      }
    }
    walkSplit(routeTree, []);

    const sharedCode: string[] = [];
    const compMap = componentMap || new Map();
    for (const [compName, compPath] of compMap) {
      compileFile(compPath, compName, sharedCode);
    }
    if (sharedCode.length > 0) {
      chunkEntries.push({ name: 'shared.js', code: sharedCode.join('\n\n'), node: null as unknown as RouteNode });
    }

    for (const entry of chunkEntries) {
      if (entry.code.trim()) {
        chunks.push({
          name: entry.name,
          code: `(()=>{\nconst __components = globalThis.__components || (globalThis.__components = {});\nconst __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n${entry.code}\n})();\n`,
        });
      }
    }

    function annotate(nodes: RouteNode[]): void {
      for (const node of nodes) {
        const chunkName = `page-${buildChunkName(node)}.js`;
        const hasEntry = chunkEntries.some(e => e.name === chunkName && e.code.trim());
        if (hasEntry) node.chunk = `/_vesk/static/${chunkName}`;
        annotate(node.children || []);
      }
    }
    annotate(routeTree);

    const main = buildMainBundle(routeTree, runtimeDir, true, {}, !!options?.hmr, !!options?.importRuntime, runtimeImportNames);
    return { main, chunks };
  } else {
    let componentLines: string[] = [];
    let hydratorLines: string[] = [];
    let aliasLines: string[] = [];
    let hydratorAliasLines: string[] = [];

    function compileFileMono(filePath: string, resolvedName: string): void {
      if (seen.has(filePath)) return;
      seen.add(filePath);
      const src = readFileSync(filePath, 'utf-8');

      resolveVskImports(filePath, (p, n) => compileFileMono(p, n || ''));

      const compCode = compileClient(src, null, { forceClient: true });
      if (compCode) {
        collectRuntimeImports(compCode);
        const stripped = stripExports(stripVskImports(stripRuntimeImport(compCode)));
        componentLines.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
      }

      const hydCode = compileClient(src, null, { hydrate: true, forceClient: true, includeTopLevel: false });
      if (hydCode) {
        collectRuntimeImports(hydCode);
        const stripped = stripExports(stripVskImports(stripRuntimeImport(hydCode)))
          .replace(/__components/g, '__hydrators');
        hydratorLines.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
      }

      const actualName = resolveComponentName(src);
      if (actualName && actualName !== resolvedName) {
        aliasLines.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
        hydratorAliasLines.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
      }
    }

    function walkMono(nodes: RouteNode[]): void {
      for (const node of nodes) {
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) compileFileMono(pagePath, node.page);
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) compileFileMono(layoutPath, node.layout);
        const errorPath = resolve(appDir, node.sourceDir, 'error.vsk');
        if (node.error && existsSync(errorPath)) compileFileMono(errorPath, node.error);
        const notFoundPath = resolve(appDir, node.sourceDir, 'not-found.vsk');
        if (node.notFound && existsSync(notFoundPath)) compileFileMono(notFoundPath, node.notFound);
        const loadingPath = resolve(appDir, node.sourceDir, 'loading.vsk');
        if (node.loading && existsSync(loadingPath)) compileFileMono(loadingPath, node.loading);
        walkMono(node.children || []);
      }
    }
    walkMono(routeTree);

    const compMap = componentMap || new Map();
    for (const [compName, compPath] of compMap) {
      compileFileMono(compPath, compName);
    }

    const main = buildMainBundle(routeTree, runtimeDir, false, {
      componentLines, hydratorLines, aliasLines, hydratorAliasLines,
    }, !!options?.hmr, !!options?.importRuntime, runtimeImportNames);
    return { main, chunks: [] };
  }
}

function stripTypes(code: string): string {
  return transformSync(code, { loader: 'ts' }).code;
}

export function buildRuntimeCode(runtimeDir: string): string {
  const runtimeFiles = [
    'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
    'context.js', 'hydrate.js', 'resource.js',
    'reconcile.js', 'bindings.js', 'router-match.js', 'router-components.js', 'router.js',
    'portal.js',
    'seo.js', 'image.js', 'experiment.js', 'form.js', 'action.js',
  ];
  let code = '';
  for (const f of runtimeFiles) {
    const p = join(runtimeDir, f);
    if (existsSync(p)) {
      let src = readFileSync(p, 'utf-8');
      src = stripTypes(src);
      src = src.replace(/^import\s+[\s\S]*?from\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, '');
      src = src.replace(/^import\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, '');
      src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, '');
      src = src.replace(/^export\s+/gm, '');
      code += `// --- ${f} ---\n${src}\n`;
    }
  }
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const exportNames: string[] = stripTypes(indexSrc).match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
    ?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim())) || [];

  code += '// --- exports ---\n';
  for (const name of [...new Set(exportNames)]) {
    if (name) code += `export { ${name} };\n`;
  }
  return code;
}

function appendHmrGlobals(code: string): string {
  return code +
    "globalThis.__vesk_hmr_eval = (code) => eval(code);\n";
}

function buildMainBundle(
  routeTree: RouteNode[],
  runtimeDir: string,
  codeSplit: boolean,
  mono?: Partial<MonolithicBundleParts>,
  hmr?: boolean,
  importRuntime?: boolean,
  runtimeImportNames?: Set<string>,
): string {
  const runtimeCode = buildRuntimeCode(runtimeDir);

  const baseRuntimeImports = ['createFileRouter', 'get', 'set', 'effect', 'track', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'NavLink', 'Link', 'reactiveProps'];
  const allRuntimeImports = runtimeImportNames && runtimeImportNames.size > 0
    ? [...new Set([...baseRuntimeImports, ...runtimeImportNames])]
    : baseRuntimeImports;

  const preamble = importRuntime
    ? `import { ${allRuntimeImports.join(', ')} } from '/_vesk/runtime.js';\n\n`
    : runtimeCode + '\n';

  const cleanupFn = 'function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n';

  const updateComponentsFn = 'function __updateComponents(nodes) {\n' +
    '  for (const n of nodes) {\n' +
    "    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n" +
    "    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n" +
    "    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n" +
    "    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n" +
    '    if (n.children) __updateComponents(n.children);\n' +
    '  }\n' +
    '}\n';

  const routeTreeJson = JSON.stringify(routeTree);

  if (codeSplit) {
    const resolveNamesFn = 'function __resolveNames(nodes) {\n' +
      '  for (const n of nodes) {\n' +
      "    if (n.chunk) n._chunk = n.chunk;\n" +
      "    if (typeof n.page === 'string') n._pageName = n.page;\n" +
      "    if (typeof n.layout === 'string') n._layoutName = n.layout;\n" +
      "    if (typeof n.error === 'string') n._errorName = n.error;\n" +
      "    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;\n" +
      '    if (n.children) __resolveNames(n.children);\n' +
      '  }\n' +
      '}\n';

    const pendCode =
      'const __pendChunks = [];\n' +
      "const __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';\n" +
      "if (typeof matchRoute === 'function') {\n" +
      '  const __currentMatch = matchRoute(__routeTree, __currentPath);\n' +
      '  if (__currentMatch) {\n' +
      '    for (const n of __currentMatch.matchChain) {\n' +
      "      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);\n" +
      '    }\n' +
      '  }\n' +
      '}\n';

    const startRouterCode =
      'const __startRouter = function() {\n' +
      '  __updateComponents(__routeTree);\n' +
      '  const __router = createFileRouter(__routeTree);\n' +
      '  __router.__hydrators = __hydrators;\n' +
      '  __router.__updateComponents = __updateComponents;\n' +
      '  globalThis.__vesk_router = __router;\n' +
      "  if (typeof document !== 'undefined') __router.start();\n" +
      '};\n' +
      "if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {\n" +
      '  Promise.all(__pendChunks.map(ensureChunk)).then(__startRouter);\n' +
      '} else {\n' +
      '  __startRouter();\n' +
      '}\n';

    const runtimeGlobals =
      'globalThis.reactiveProps = reactiveProps;\n' +
      'globalThis.getActiveComponent = getActiveComponent;\n' +
      'globalThis.setActiveComponent = setActiveComponent;\n' +
      'globalThis.track = track;\n' +
      'globalThis.set = set;\n' +
      'globalThis.get = get;\n' +
      'globalThis.effect = effect;\n' +
      'globalThis.destroy_block = destroy_block;\n' +
      'globalThis.reconcile = reconcile;\n' +
      'globalThis.NavLink = NavLink;\n' +
      'globalThis.Link = Link;\n' +
      'globalThis.createHydrateWalker = createHydrateWalker;\n' +
      'globalThis.needsHydration = needsHydration;\n' +
      'globalThis.hydrate = hydrate;\n' +
      'globalThis.hydrateViewport = hydrateViewport;\n' +
      'globalThis.hydrateIdle = hydrateIdle;\n' +
      'globalThis.hydrateOnInteraction = hydrateOnInteraction;\n' +
      'globalThis.collectVskMarkers = collectVskMarkers;\n' +
      'globalThis.__runtime_comps = __runtime_comps;\n' +
      'globalThis.__cleanup = __cleanup;\n\n';

    const extraGlobals = [...(runtimeImportNames || [])]
      .filter(n => n && n !== 'default')
      .map(n => `globalThis.${n} = ${n};\n`)
      .join('');

    const code = preamble +
      'const __components = globalThis.__components || (globalThis.__components = {});\n' +
      'const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n' +
      'const __runtime_comps = __components;\n\n' +
      runtimeGlobals + extraGlobals +
      cleanupFn +
      'globalThis.__components = __components;\n' +
      resolveNamesFn +
      updateComponentsFn +
      'const __routeTree = ' + routeTreeJson + ';\n' +
      '__resolveNames(__routeTree);\n' +
      pendCode +
      startRouterCode;
    return hmr ? appendHmrGlobals(code) : code;
  }

  const componentLines = mono?.componentLines || [];
  const hydratorLines = mono?.hydratorLines || [];
  const aliasLines = mono?.aliasLines || [];
  const hydratorAliasLines = mono?.hydratorAliasLines || [];

  const aliasCode = aliasLines.length > 0 ? aliasLines.join('\n') + '\n' : '';
  const hydratorAliasCode = hydratorAliasLines.length > 0 ? hydratorAliasLines.join('\n') + '\n' : '';

  const code = preamble +
    'const __components = {};\n' +
    'const __hydrators = {};\n' +
    'const __runtime_comps = __components;\n\n' +
    componentLines.join('\n\n') + '\n' +
    aliasCode +
    hydratorLines.join('\n\n') + '\n' +
    hydratorAliasCode +
    cleanupFn +
    'globalThis.__components = __components;\n' +
    'function __resolveNames(nodes) {\n' +
    '  for (const n of nodes) {\n' +
    "    if (typeof n.page === 'string') {\n" +
    '      n._pageName = n.page;\n' +
    '      n.page = __components[n.page];\n' +
    '    }\n' +
    "    if (typeof n.layout === 'string') {\n" +
    '      n._layoutName = n.layout;\n' +
    '      n.layout = __components[n.layout];\n' +
    '    }\n' +
    "    if (typeof n.error === 'string') n.error = __components[n.error];\n" +
    "    if (typeof n.notFound === 'string') n.notFound = __components[n.notFound];\n" +
    '    if (n.children) __resolveNames(n.children);\n' +
    '  }\n' +
    '}\n' +
    updateComponentsFn +
    'const __routeTree = ' + routeTreeJson + ';\n' +
    '__resolveNames(__routeTree);\n' +
    'const __router = createFileRouter(__routeTree);\n' +
    'globalThis.__vesk_router = __router;\n' +
    '__router.__hydrators = __hydrators;\n' +
    '__router.__updateComponents = __updateComponents;\n' +
    "if (typeof document !== 'undefined') __router.start();\n";
  return hmr ? appendHmrGlobals(code) : code;
}
