import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './esbuild-fallback.js';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import { compileClient, compileClientBoth } from '@vesk/compiler/src/client-codegen';
import { resolveComponentName } from '@vesk/compiler/src/server-codegen';
import { collectVskImportPaths, vskImportLines } from '@vesk/compiler/src/vsk-imports';
import { inlineMdContentAttrs, guessProjectRoots } from '@vesk/compiler/src/md-inline';
import type { RouteNode, ClientBundleOptions, ClientBundleResult, ChunkEntry, MonolithicBundleParts } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fileUnchanged(filePath: string, cached: { mtimeMs: number; size: number }): boolean {
  try {
    const st = statSync(filePath);
    return st.mtimeMs === cached.mtimeMs && st.size === cached.size;
  } catch {
    return false;
  }
}

function buildRouterOpts(options?: ClientBundleOptions): string {
  const ttl = options?.routeDataCache;
  if (typeof ttl === 'number' && ttl > 0) {
    return `, { routeDataCache: ${ttl} }`;
  }
  return '';
}

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
  const cache = options?.cache;
  const only = options?.only && options.only.length > 0 ? new Set(options.only) : null;
  const returnEdited = !!options?.returnEditedSources && !!only;
  const editedSources = returnEdited ? new Map<string, string>() : undefined;
  const editedNames = returnEdited ? new Map<string, string | null>() : undefined;
  let cachedFileHits = 0;
  let compiledFiles = 0;
  let mainFromCache = false;

  function mustReuseWithoutStat(filePath: string): boolean {
    return !!only && !only.has(filePath);
  }

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
               .replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, '')
               .replace(/^function __place\(start, end, nodes, fallback\) \{[\s\S]*?\n\}\s*\n?/gm, '');
  }

  function stripVskImports(code: string): string {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*\.vsk['"];?\s*\n?/gm, '');
  }

  function resolveVskImports(filePath: string, compile: (path: string, resolvedName: string | null) => void): string[] {
    const src = readFileSync(filePath, 'utf-8');
    const resolved: string[] = [];
    for (const importPath of collectVskImportPaths(vskImportLines(src), filePath)) {
      try {
        readFileSync(importPath);
      } catch {
        continue;
      }
      // resolvedName is intentionally null: compileFile derives the same
      // name from its own IR pass, and the alias branch is unreachable
      // when resolvedName matches — this avoids a second full parse of
      // every imported file.
      resolved.push(importPath);
      compile(importPath, null);
    }
    return resolved;
  }

  function stripExports(code: string): string {
    return code
      .replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, '')
      .replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, '');
  }

  function compileFile(filePath: string, resolvedName: string | null, output: string[]): void {
    if (seen.has(filePath)) return;
    seen.add(filePath);

    // Cache-hit fast path: replay the entry's recorded contribution with no
    // file reads or parses. Deps recurse through the same path so each hit
    // costs one stat call (zero with `only`).
    const cachedEntry = cache?.files.get(filePath);
    // If one of this file's .md dependencies was the edited target, its
    // inlined content is stale by definition — force a recompile.
    let dependsOnEdited = false;
    if (cachedEntry && only && !only.has(filePath)) {
      for (const p of only) {
        if (cachedEntry.imports.includes(p)) { dependsOnEdited = true; break; }
      }
    }
    const cacheUsable = !!cachedEntry && !dependsOnEdited &&
      (mustReuseWithoutStat(filePath) || fileUnchanged(filePath, cachedEntry));
    const cached = cacheUsable ? cachedEntry : undefined;
    if (cached && cacheUsable) {
      cachedFileHits++;
      for (const dep of cached.imports) compileFile(dep, cache?.files.get(dep)?.actualName ?? '', output);
      if (cached.compCode) output.push(cached.compCode);
      if (cached.hydCode) output.push(cached.hydCode);
      for (const n of cached.runtimeNames) runtimeImportNames.add(n);
      if (cached.actualName && resolvedName !== null && cached.actualName !== resolvedName) {
        output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(cached.actualName)}], configurable: true });`);
        output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(cached.actualName)}], configurable: true });`);
      }
      return;
    }

    compiledFiles++;
    let src = readFileSync(filePath, 'utf-8');
    if (/content=["'][^"']*\.md["']/i.test(src)) {
      src = inlineMdContentAttrs(src, dirname(filePath), guessProjectRoots(appDir));
    }
    const namesBefore = cache ? new Set(runtimeImportNames) : null;

    const importedPaths = resolveVskImports(filePath, (p, n) => compileFile(p, n || '', output));

    // One parse/IR pass feeds both client modes AND the component-name
    // lookup — the dev hot path pays the acorn+TS parse once per edit
    // instead of three times.
    const { comp: rawComp, hyd: rawHyd, name: actualName } = compileClientBoth(src, null);
    const compCode = rawComp ? stripExports(stripVskImports(stripRuntimeImport(rawComp))).replace(/^\n+/, '').replace(/\n+$/, '') : '';
    const hydCode = rawHyd ? stripExports(stripVskImports(stripRuntimeImport(rawHyd))).replace(/__components/g, '__hydrators').replace(/^\n+/, '').replace(/\n+$/, '') : '';
    if (rawComp) collectRuntimeImports(rawComp);
    if (rawHyd) collectRuntimeImports(rawHyd);

    if (returnEdited && only!.has(filePath)) {
      // Mirrors the HMR fnSources preparation in the dev servers: drop every
      // remaining top-level import so the snippet can be eval'd in the page
      // context where runtime globals already exist.
      const bare = rawComp
        ? stripExports(stripVskImports(stripRuntimeImport(rawComp)))
            .replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?\s*\n?/gm, '')
        : '';
      editedSources!.set(filePath, bare);
      editedNames!.set(filePath, actualName);
    }

    if (compCode) output.push(compCode);
    if (hydCode) output.push(hydCode);
    if (actualName && resolvedName !== null && actualName !== resolvedName) {
      output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
      output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
    }

    if (cache && namesBefore) {
      const st = statSync(filePath);
      cache.files.set(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        compCode,
        hydCode,
        actualName,
        runtimeNames: [...runtimeImportNames].filter((n) => !namesBefore.has(n)),
        imports: importedPaths,
      });
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
        const offlinePath = resolve(appDir, node.sourceDir, 'offline.vsk');
        if (node.offline && existsSync(offlinePath)) {
          compileFile(offlinePath, node.offline, chunkCode);
        }
        const networkPath = resolve(appDir, node.sourceDir, 'network.vsk');
        if (node.network && existsSync(networkPath)) {
          compileFile(networkPath, node.network, chunkCode);
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

    const mainKey = JSON.stringify(routeTree) + '|' + [...runtimeImportNames].sort().join(',') + `|${!!options?.hmr}|${!!options?.importRuntime}|${options?.routeDataCache ?? ''}`;
    let main: string;
    if (cache?.mainBundle && cache.mainBundle.key === mainKey) {
      mainFromCache = true;
      main = cache.mainBundle.code;
    } else {
      main = await buildMainBundle(routeTree, runtimeDir, true, {}, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
      if (cache) cache.mainBundle = { key: mainKey, code: main };
    }
    return { main, chunks, cachedFileHits, compiledFiles, mainFromCache, editedSources, editedNames };
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
        const offlinePath = resolve(appDir, node.sourceDir, 'offline.vsk');
        if (node.offline && existsSync(offlinePath)) compileFileMono(offlinePath, node.offline);
        const networkPath = resolve(appDir, node.sourceDir, 'network.vsk');
        if (node.network && existsSync(networkPath)) compileFileMono(networkPath, node.network);
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

    const main = await buildMainBundle(routeTree, runtimeDir, false, {
      componentLines, hydratorLines, aliasLines, hydratorAliasLines,
    }, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
    // Mono (non-codeSplit) builds are the production path — no incremental cache.
    return { main, chunks: [] };
  }
}

function stripTypes(code: string): string {
  return stripCodeTypes(code);
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
      src = src.replace(/^export\s*\{\s*[\s\S]*?\}\s*from\s+['"][^'"]+['"];?\n?/gm, '');
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

/**
 * Names the client runtime actually exports, so the tree-shaken bundle only
 * emits the modules reachable from the used set.
 */
export function runtimeExportNames(runtimeDir: string): Set<string> {
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const names = new Set<string>();
  for (const m of indexSrc.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

let runtimeEntryId = 0;

/**
 * Builds a single self-contained runtime module for the given used names.
 *
 * The runtime's real module graph is bundled by esbuild into one IIFE whose
 * scope is fully closed, so its internal identifiers can never collide with
 * page code. Only the exact names the app uses are re-exported as module-scope
 * const bindings. This replaces the old regex-based file concatenation, which
 * leaked runtime module-scope names into the page scope.
 */
export async function buildTreeShakenRuntime(runtimeDir: string, usedNames: string[]): Promise<string> {
  const unique = [...new Set(usedNames)];
  const available = runtimeExportNames(runtimeDir);
  const missing = unique.filter((n) => !available.has(n));
  if (missing.length > 0) {
    console.error(`vesk: runtime names not exported — ${missing.join(', ')}; falling back to full runtime`);
    return buildRuntimeCode(runtimeDir);
  }
  const entry = join(runtimeDir, `.runtime-tree-entry-${runtimeEntryId++}.mjs`);
  try {
    writeFileSync(entry, `export { ${unique.join(', ')} } from './index-client.js';\n`);
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      globalName: '__veskRuntime',
      platform: 'browser',
      target: ['es2022'],
      treeShaking: true,
      minify: true,
      write: false,
      logLevel: 'silent',
    });
    const bundle = result.outputFiles[0].text;
    return `${bundle}\nconst { ${unique.join(', ')} } = __veskRuntime;\nexport { ${unique.join(', ')} };\n`;
  } catch (e) {
    console.error('vesk: runtime tree-shake failed, falling back to full runtime:', (e as Error).message);
    return buildRuntimeCode(runtimeDir);
  } finally {
    try { unlinkSync(entry); } catch { /* ignore */ }
  }
}

function appendHmrGlobals(code: string): string {
  return code +
    "globalThis.__vesk_hmr_eval = (code) => eval(code);\n";
}

async function buildMainBundle(
  routeTree: RouteNode[],
  runtimeDir: string,
  codeSplit: boolean,
  mono?: Partial<MonolithicBundleParts>,
  hmr?: boolean,
  importRuntime?: boolean,
  runtimeImportNames?: Set<string>,
  routeDataCache?: number,
): Promise<string> {
  const baseRuntimeImports = ['createFileRouter', 'get', 'set', 'effect', 'track', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'NavLink', 'Link', 'reactiveProps', 'matchRoute', 'ensureChunk'];
  const allRuntimeImports = runtimeImportNames && runtimeImportNames.size > 0
    ? [...new Set([...baseRuntimeImports, ...runtimeImportNames])]
    : baseRuntimeImports;

  const runtimeGlobals = [
    'reconcile', 'createHydrateWalker', 'needsHydration', 'hydrate',
    'hydrateViewport', 'hydrateIdle', 'hydrateOnInteraction', 'collectVskMarkers',
    'matchRoute', 'ensureChunk',
  ];
  const usedRuntimeNames = [...new Set([...baseRuntimeImports, ...allRuntimeImports, ...runtimeGlobals])];
  const runtimeCode = importRuntime ? '' : await buildTreeShakenRuntime(runtimeDir, usedRuntimeNames);

  const preamble = importRuntime
    ? `import { ${allRuntimeImports.join(', ')} } from '/_vesk/runtime.js';\n\n`
    : runtimeCode + '\n';

  const cleanupFn = 'function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n';

  const placeFn = 'function __place(start, end, nodes, fallback) {\n' +
    '\tif (start.parentNode !== null) {\n' +
    '\t\tconst p = start.parentNode;\n' +
    '\t\tfor (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);\n' +
    '\t\treturn;\n' +
    '\t}\n' +
    '\tif (nodes.length > 0 && nodes[0].parentNode) {\n' +
    '\t\tconst p = nodes[0].parentNode;\n' +
    '\t\tp.insertBefore(start, nodes[0]);\n' +
    '\t\tp.insertBefore(end, nodes[nodes.length - 1].nextSibling);\n' +
    '\t\treturn;\n' +
    '\t}\n' +
    '\tfallback.appendChild(start);\n' +
    '\tfallback.appendChild(end);\n' +
    '\tfor (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);\n' +
    '}\n';

  const updateComponentsFn = 'function __updateComponents(nodes) {\n' +
    '  for (const n of nodes) {\n' +
    "    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n" +
    "    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n" +
    "    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n" +
    "    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n" +
    "    if (n._offlineName && __components[n._offlineName]) n.offline = __components[n._offlineName];\n" +
    "    if (n._networkName && __components[n._networkName]) n.network = __components[n._networkName];\n" +
    '    if (n.children) __updateComponents(n.children);\n' +
    '  }\n' +
    '}\n';

  const routeTreeJson = JSON.stringify(routeTree);

  if (codeSplit) {
    const resolveNamesFn = 'function __resolveNames(nodes) {\n' +
      '  for (const n of nodes) {\n' +
      "    if (n.chunk) n._chunk = n.chunk;\n" +
      "    if (n.chunkError) n._chunkError = n.chunkError;\n" +
      "    if (typeof n.page === 'string') n._pageName = n.page;\n" +
      "    if (typeof n.layout === 'string') n._layoutName = n.layout;\n" +
      "    if (typeof n.error === 'string') n._errorName = n.error;\n" +
      "    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;\n" +
      "    if (typeof n.offline === 'string') n._offlineName = n.offline;\n" +
      "    if (typeof n.network === 'string') n._networkName = n.network;\n" +
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

    const routerOpts = buildRouterOpts({ routeDataCache });

    const startRouterCode =
      'const __startRouter = function() {\n' +
      '  __updateComponents(__routeTree);\n' +
      `  const __router = createFileRouter(__routeTree${routerOpts});\n` +
      '  __router.__hydrators = __hydrators;\n' +
      '  __router.__updateComponents = __updateComponents;\n' +
      '  globalThis.__vesk_router = __router;\n' +
      "  if (typeof document !== 'undefined') __router.start();\n" +
      '};\n' +
      "if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {\n" +
      "  Promise.all(__pendChunks.map(u => ensureChunk(u).catch(() => undefined))).then(__startRouter);\n" +
      '} else {\n' +
      '  __startRouter();\n' +
      '}\n';

    // Chunks execute as classic scripts, so the bootstrap's chunk loader
    // and route matcher must exist on globalThis before any chunk loads.
    // Runtime names are only emitted when a chunk's compiled code imports
    // them — otherwise an app without (say) keyed maps would reference an
    // unimported `reconcile` and kill the whole module.
    const globalNames = [
      'reactiveProps', 'getActiveComponent', 'setActiveComponent', 'track',
      'set', 'get', 'effect', 'destroy_block', 'reconcile', 'NavLink', 'Link',
      'createHydrateWalker', 'needsHydration', 'hydrate', 'hydrateViewport',
      'hydrateIdle', 'hydrateOnInteraction', 'collectVskMarkers',
      'matchRoute', 'ensureChunk',
    ];
    const importedSet = new Set(allRuntimeImports);
    const runtimeGlobals =
      globalNames
        .filter(n => importedSet.has(n))
        .map(n => `globalThis.${n} = ${n};\n`)
        .join('') +
      'globalThis.__runtime_comps = __runtime_comps;\n' +
      'globalThis.__cleanup = __cleanup;\n' +
      'globalThis.__place = __place;\n\n';

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
      placeFn +
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

  const routerOpts = buildRouterOpts({ routeDataCache });

  const code = preamble +
    'const __components = {};\n' +
    'const __hydrators = {};\n' +
    'const __runtime_comps = __components;\n\n' +
    componentLines.join('\n\n') + '\n' +
    aliasCode +
    hydratorLines.join('\n\n') + '\n' +
    hydratorAliasCode +
    cleanupFn +
    placeFn +
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
    "    if (typeof n.offline === 'string') n.offline = __components[n.offline];\n" +
    "    if (typeof n.network === 'string') n.network = __components[n.network];\n" +
    '    if (n.children) __resolveNames(n.children);\n' +
    '  }\n' +
    '}\n' +
    updateComponentsFn +
    'const __routeTree = ' + routeTreeJson + ';\n' +
    '__resolveNames(__routeTree);\n' +
    `const __router = createFileRouter(__routeTree${routerOpts});\n` +
    'globalThis.__vesk_router = __router;\n' +
    '__router.__hydrators = __hydrators;\n' +
    '__router.__updateComponents = __updateComponents;\n' +
    "if (typeof document !== 'undefined') __router.start();\n";
  return hmr ? appendHmrGlobals(code) : code;
}
