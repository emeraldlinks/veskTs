import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname, relative, sep } from 'path';
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

export async function generateClientBundle(routeTree, appDir, componentMap = new Map(), options = {}) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const monorepoClient = resolve(__dirname, '..', '..', 'compiler', 'src', 'client-codegen.js');
  const { compileClient } = existsSync(monorepoClient)
    ? await import(monorepoClient)
    : await import('@vesk/compiler');
  const runtimeDir = findRuntimeSrc(appDir);

  const seen = new Set();
  const chunks = [];

  function stripRuntimeImport(code) {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, '')
               .replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, '')
               .replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '');
  }

  function compileFile(filePath, resolvedName, output) {
    if (seen.has(filePath)) return;
    seen.add(filePath);
    const src = readFileSync(filePath, 'utf-8');

    const compCode = compileClient(src, null, { forceClient: true });
    if (compCode) {
      const stripped = stripRuntimeImport(compCode)
        .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
      output.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
    }

    const hydCode = compileClient(src, null, { hydrate: true, forceClient: true });
    if (hydCode) {
      const stripped = stripRuntimeImport(hydCode)
        .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '')
        .replace(/__components/g, '__hydrators');
      output.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
    }

    const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
    if (actualName && actualName !== resolvedName) {
      output.push(`__components[${JSON.stringify(resolvedName)}] = __components[${JSON.stringify(actualName)}];`);
      output.push(`__hydrators[${JSON.stringify(resolvedName)}] = __hydrators[${JSON.stringify(actualName)}];`);
    }
  }

  function buildChunkName(node) {
    const dir = relative(appDir, node.sourceDir || '');
    const parts = dir.split(sep).filter(Boolean);
    const slug = parts.length > 0 ? parts.join('-') : 'index';
    return slug;
  }

  function routeKey(node) {
    return node.sourceDir || node.fullPath || '';
  }

  if (options.codeSplit) {
    // ── Code-split mode: emit one chunk per route node ──
    const chunkEntries = [];

    function walkSplit(nodes, chain) {
      for (const node of nodes) {
        const chunkCode = [];
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) {
          compileFile(pagePath, node.page, chunkCode);
        }
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) {
          compileFile(layoutPath, node.layout, chunkCode);
        }
        if (chunkCode.length > 0) {
          const chunkName = `page-${buildChunkName(node)}.js`;
          chunkEntries.push({ name: chunkName, code: chunkCode.join('\n\n'), node });
        }
        walkSplit(node.children || [], [...chain, node]);
      }
    }
    walkSplit(routeTree, []);

    // ── External component files (./components/) go into a shared chunk ──
    const sharedCode = [];
    for (const [compName, compPath] of componentMap) {
      compileFile(compPath, compName, sharedCode);
    }
    if (sharedCode.length > 0) {
      chunkEntries.push({ name: 'shared.js', code: sharedCode.join('\n\n'), node: null });
    }

    // Generate the chunk files — each chunk assigns to globalThis.__components
    for (const entry of chunkEntries) {
      if (entry.code.trim()) {
        chunks.push({
          name: entry.name,
          code: `(()=>{\nconst __components = globalThis.__components || (globalThis.__components = {});\nconst __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n${entry.code}\n})();\n`,
        });
      }
    }

    // Annotate route tree with chunk URLs
    function annotate(nodes) {
      for (const node of nodes) {
        const chunkName = `page-${buildChunkName(node)}.js`;
        const hasEntry = chunkEntries.some(e => e.name === chunkName && e.code.trim());
        if (hasEntry) node.chunk = `/_vesk/static/${chunkName}`;
        annotate(node.children || []);
      }
    }
    annotate(routeTree);

    // Build main bundle (runtime + route tree + bootstrap)
    const main = buildMainBundle(routeTree, runtimeDir, true, {}, options.hmr, options.importRuntime);
    return { main, chunks };

  } else {
    // ── Monolithic mode (existing behavior) ──
    let componentLines = [];
    let hydratorLines = [];
    let aliasLines = [];
    let hydratorAliasLines = [];

    function compileFileMono(filePath, resolvedName) {
      if (seen.has(filePath)) return;
      seen.add(filePath);
      const src = readFileSync(filePath, 'utf-8');

      const compCode = compileClient(src, null, { forceClient: true });
      if (compCode) {
        const stripped = stripRuntimeImport(compCode)
          .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
        componentLines.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
      }

      const hydCode = compileClient(src, null, { hydrate: true, forceClient: true });
      if (hydCode) {
        const stripped = stripRuntimeImport(hydCode)
          .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '')
          .replace(/__components/g, '__hydrators');
        hydratorLines.push(stripped.replace(/^\n+/, '').replace(/\n+$/, ''));
      }

      const actualName = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m)?.[1];
      if (actualName && actualName !== resolvedName) {
        aliasLines.push(`__components[${JSON.stringify(resolvedName)}] = __components[${JSON.stringify(actualName)}];`);
        hydratorAliasLines.push(`__hydrators[${JSON.stringify(resolvedName)}] = __hydrators[${JSON.stringify(actualName)}];`);
      }
    }

    function walkMono(nodes) {
      for (const node of nodes) {
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) compileFileMono(pagePath, node.page);
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) compileFileMono(layoutPath, node.layout);
        walkMono(node.children || []);
      }
    }
    walkMono(routeTree);

    for (const [compName, compPath] of componentMap) {
      compileFileMono(compPath, compName);
    }

    const main = buildMainBundle(routeTree, runtimeDir, false, {
      componentLines, hydratorLines, aliasLines, hydratorAliasLines,
    }, options.hmr, options.importRuntime);
    return { main, chunks: [] };
  }
}

function buildRuntimeCode(runtimeDir) {
  const runtimeFiles = [
    'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
    'context.js', 'hydrate.js', 'resource.js',
    'reconcile.js', 'bindings.js', 'router-match.js', 'router-components.js', 'router.js',
    'portal.js',
    'seo.js', 'image.js', 'experiment.js', 'form.js',
  ];
  let code = '';
  for (const f of runtimeFiles) {
    const p = join(runtimeDir, f);
    if (existsSync(p)) {
      let src = readFileSync(p, 'utf-8');
      src = src.replace(/^import\s+[\s\S]*?from\s+['"].\/.*?['"];?\n?/gm, '');
      src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, '');
      src = src.replace(/^export\s+/gm, '');
      code += `// --- ${f} ---\n${src}\n`;
    }
  }
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const exportNames = indexSrc.match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
    ?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim())) || [];

  code += `// --- exports ---\n`;
  for (const name of [...new Set(exportNames)]) {
    if (name) code += `export { ${name} };\n`;
  }
  return code;
}

function appendHmrGlobals(code) {
  return code +
    `globalThis.__vesk_router = __router;\n` +
    `globalThis.__vesk_hmr_eval = (code) => eval(code);\n`;
}

function buildMainBundle(routeTree, runtimeDir, codeSplit, mono = {}, hmr = false, importRuntime = false) {
  const runtimeCode = buildRuntimeCode(runtimeDir);

  const preamble = importRuntime
    ? `import { createFileRouter, get, set, effect, track, destroy_block, getActiveComponent, setActiveComponent, NavLink, Link, reactiveProps } from '/_vesk/runtime.js';\n\n`
    : runtimeCode + '\n';

  const cleanupFn = `function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n`;

  const updateComponentsFn = `function __updateComponents(nodes) {\n` +
    `  for (const n of nodes) {\n` +
    `    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n` +
    `    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n` +
    `    if (n.children) __updateComponents(n.children);\n` +
    `  }\n` +
    `}\n`;

  const routeTreeJson = JSON.stringify(routeTree);

  if (codeSplit) {
    const resolveNamesFn = `function __resolveNames(nodes) {\n` +
      `  for (const n of nodes) {\n` +
      `    if (n.chunk) n._chunk = n.chunk;\n` +
      `    if (typeof n.page === 'string') n._pageName = n.page;\n` +
      `    if (typeof n.layout === 'string') n._layoutName = n.layout;\n` +
      `    if (n.children) __resolveNames(n.children);\n` +
      `  }\n` +
      `}\n`;

    const pendCode =
      `const __pendChunks = [];\n` +
      `const __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';\n` +
      `if (typeof matchRoute === 'function') {\n` +
      `  const __currentMatch = matchRoute(__routeTree, __currentPath);\n` +
      `  if (__currentMatch) {\n` +
      `    for (const n of __currentMatch.matchChain) {\n` +
      `      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);\n` +
      `    }\n` +
      `  }\n` +
      `}\n`;

    const startRouterCode =
      `const __startRouter = function() {\n` +
      `  __updateComponents(__routeTree);\n` +
      `  const __router = createFileRouter(__routeTree);\n` +
      `  __router.__hydrators = __hydrators;\n` +
      `  __router.__updateComponents = __updateComponents;\n` +
      `  if (typeof document !== 'undefined') __router.start();\n` +
      `};\n` +
      `if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {\n` +
      `  Promise.all(__pendChunks.map(ensureChunk)).then(__startRouter);\n` +
      `} else {\n` +
      `  __startRouter();\n` +
      `}\n`;

    const runtimeGlobals =
      `globalThis.reactiveProps = reactiveProps;\n` +
      `globalThis.getActiveComponent = getActiveComponent;\n` +
      `globalThis.setActiveComponent = setActiveComponent;\n` +
      `globalThis.track = track;\n` +
      `globalThis.set = set;\n` +
      `globalThis.get = get;\n` +
      `globalThis.effect = effect;\n` +
      `globalThis.destroy_block = destroy_block;\n` +
      `globalThis.NavLink = NavLink;\n` +
      `globalThis.Link = Link;\n` +
      `globalThis.createHydrateWalker = createHydrateWalker;\n` +
      `globalThis.__runtime_comps = __runtime_comps;\n` +
      `globalThis.__cleanup = __cleanup;\n\n`;

    const code = preamble +
      `const __components = globalThis.__components || (globalThis.__components = {});\n` +
      `const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n` +
      `const __runtime_comps = __components;\n\n` +
      runtimeGlobals +
      cleanupFn +
      `globalThis.__components = __components;\n` +
      resolveNamesFn +
      updateComponentsFn +
      `const __routeTree = ${routeTreeJson};\n` +
      `__resolveNames(__routeTree);\n` +
      pendCode +
      startRouterCode;
    return hmr ? appendHmrGlobals(code) : code;
  }

  const componentLines = mono.componentLines || [];
  const hydratorLines = mono.hydratorLines || [];
  const aliasLines = mono.aliasLines || [];
  const hydratorAliasLines = mono.hydratorAliasLines || [];

  const aliasCode = aliasLines.length > 0 ? aliasLines.join('\n') + '\n' : '';
  const hydratorAliasCode = hydratorAliasLines.length > 0 ? hydratorAliasLines.join('\n') + '\n' : '';

  const code = preamble +
    `const __components = {};\n` +
    `const __hydrators = {};\n` +
    `const __runtime_comps = __components;\n\n` +
    componentLines.join('\n\n') + '\n' +
    aliasCode +
    hydratorLines.join('\n\n') + '\n' +
    hydratorAliasCode +
    cleanupFn +
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
    updateComponentsFn +
    `const __routeTree = ${routeTreeJson};\n` +
    `__resolveNames(__routeTree);\n` +
    `const __router = createFileRouter(__routeTree);\n` +
    `__router.__hydrators = __hydrators;\n` +
    `__router.__updateComponents = __updateComponents;\n` +
    `if (typeof document !== 'undefined') __router.start();\n`;
  return hmr ? appendHmrGlobals(code) : code;
}
