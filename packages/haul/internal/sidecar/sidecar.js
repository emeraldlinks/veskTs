var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/adapter/dist/esbuild-fallback.js
async function loadNative() {
  if (_nativeBuild && _nativeTransform)
    return;
  try {
    const m = await import("esbuild");
    _nativeBuild = m.build.bind(m);
    _nativeTransform = m.transformSync.bind(m);
  } catch {
  }
}
async function getWasm() {
  if (_wasm)
    return _wasm;
  if (!_wasmReady) {
    _wasmReady = import("esbuild-wasm").then((m) => {
      _wasm = m;
      return m;
    }).catch(() => {
      _wasmReady = null;
      throw new Error("esbuild-wasm not available");
    });
  }
  return _wasmReady;
}
async function build(options) {
  await loadNative();
  if (_nativeBuild) {
    try {
      return await _nativeBuild(options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("SIGILL") || msg.includes("illegal hardware instruction") || msg.includes("cannot execute binary file")) {
        console.warn("vesk: native esbuild failed, falling back to esbuild-wasm:", msg);
      } else {
        throw e;
      }
    }
  }
  const wasm = await getWasm();
  return wasm.build(options);
}
function transformSync(code, options) {
  if (_nativeTransform) {
    try {
      return _nativeTransform(code, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("SIGILL") || msg.includes("illegal hardware instruction") || msg.includes("cannot execute binary file")) {
        throw new Error("esbuild-wasm fallback for transformSync not yet implemented \u2014 use native esbuild or convert to async transform");
      }
      throw e;
    }
  }
  throw new Error("esbuild not installed \u2014 run `npm install esbuild` or use `vesk build` which falls back to esbuild-wasm for bundling");
}
var _nativeBuild, _nativeTransform, _wasm, _wasmReady;
var init_esbuild_fallback = __esm({
  "packages/adapter/dist/esbuild-fallback.js"() {
    "use strict";
    _nativeBuild = null;
    _nativeTransform = null;
    _wasm = null;
    _wasmReady = null;
  }
});

// packages/adapter/dist/client-bundle.js
var client_bundle_exports = {};
__export(client_bundle_exports, {
  buildRuntimeCode: () => buildRuntimeCode,
  buildTreeShakenRuntime: () => buildTreeShakenRuntime,
  generateClientBundle: () => generateClientBundle,
  runtimeExportNames: () => runtimeExportNames
});
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileClient } from "@vesk/compiler/src/client-codegen";
import { resolveComponentName } from "@vesk/compiler/src/server-codegen";
import { collectVskImportPaths, vskImportLines } from "@vesk/compiler/src/vsk-imports";
function buildRouterOpts(options) {
  const ttl = options?.routeDataCache;
  if (typeof ttl === "number" && ttl > 0) {
    return `, { routeDataCache: ${ttl} }`;
  }
  return "";
}
function findRuntimeSrc(appDir) {
  const monorepoRoot = resolve(__dirname, "..", "..", "..");
  const candidates = [
    resolve(monorepoRoot, "packages", "runtime", "dist"),
    resolve(appDir, "..", "node_modules", "@vesk/runtime"),
    resolve(appDir, "node_modules", "@vesk/runtime")
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, "dist")]) {
      if (existsSync(join(dir, "index-client.js")))
        return dir;
    }
  }
  throw new Error('@vesk/runtime/dist not found \u2014 run "npm run build" first');
}
async function generateClientBundle(routeTree, appDir, componentMap, options) {
  const runtimeDir2 = findRuntimeSrc(appDir);
  const seen = /* @__PURE__ */ new Set();
  const chunks = [];
  const runtimeImportNames = /* @__PURE__ */ new Set();
  function collectRuntimeImports(code) {
    const re = /^import\s*\{([^}]*)\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm;
    for (const m of code.matchAll(re)) {
      for (const name of m[1].split(",")) {
        const trimmed = name.trim().replace(/^(\w+)\s+as\s+.*$/, "$1");
        if (!trimmed || /^(type|typeof)\s/.test(trimmed))
          continue;
        runtimeImportNames.add(trimmed);
      }
    }
  }
  function stripRuntimeImport(code) {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"]@vesk\/runtime['"];?\s*\n?/gm, "").replace(/const\s+__components\s*=\s*\{\};\s*\n?/g, "").replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/gm, "").replace(/^function __place\(start, end, nodes, fallback\) \{[\s\S]*?\n\}\s*\n?/gm, "");
  }
  function stripVskImports(code) {
    return code.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*\.vsk['"];?\s*\n?/gm, "");
  }
  function resolveVskImports(filePath, compile) {
    const src = readFileSync(filePath, "utf-8");
    for (const importPath of collectVskImportPaths(vskImportLines(src), filePath)) {
      let importedName = null;
      try {
        importedName = resolveComponentName(readFileSync(importPath, "utf-8"));
      } catch {
        continue;
      }
      compile(importPath, importedName);
    }
  }
  function stripExports(code) {
    return code.replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, "").replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, "");
  }
  function compileFile(filePath, resolvedName, output) {
    if (seen.has(filePath))
      return;
    seen.add(filePath);
    const src = readFileSync(filePath, "utf-8");
    resolveVskImports(filePath, (p, n) => compileFile(p, n || "", output));
    const compCode = compileClient(src, null, { forceClient: true });
    if (compCode) {
      collectRuntimeImports(compCode);
      const stripped = stripExports(stripVskImports(stripRuntimeImport(compCode)));
      output.push(stripped.replace(/^\n+/, "").replace(/\n+$/, ""));
    }
    const hydCode = compileClient(src, null, { hydrate: true, forceClient: true, includeTopLevel: false });
    if (hydCode) {
      collectRuntimeImports(hydCode);
      const stripped = stripExports(stripVskImports(stripRuntimeImport(hydCode))).replace(/__components/g, "__hydrators");
      output.push(stripped.replace(/^\n+/, "").replace(/\n+$/, ""));
    }
    const actualName = resolveComponentName(src);
    if (actualName && actualName !== resolvedName) {
      output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
      output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
    }
  }
  function buildChunkName(node) {
    const dir = relative(appDir, node.sourceDir || "");
    const parts = dir.split(sep).filter(Boolean);
    const slug = parts.length > 0 ? parts.join("-") : "index";
    return slug.replace(/[\[\]]/g, "_");
  }
  const codeSplit = !!options?.codeSplit;
  if (codeSplit) {
    let walkSplit2 = function(nodes, _chain) {
      for (const node of nodes) {
        const chunkCode = [];
        const pagePath = resolve(appDir, node.sourceDir, "page.vsk");
        if (node.page && existsSync(pagePath)) {
          compileFile(pagePath, node.page, chunkCode);
        }
        const layoutPath = resolve(appDir, node.sourceDir, "layout.vsk");
        if (node.layout && existsSync(layoutPath)) {
          compileFile(layoutPath, node.layout, chunkCode);
        }
        const errorPath = resolve(appDir, node.sourceDir, "error.vsk");
        if (node.error && existsSync(errorPath)) {
          compileFile(errorPath, node.error, chunkCode);
        }
        const notFoundPath = resolve(appDir, node.sourceDir, "not-found.vsk");
        if (node.notFound && existsSync(notFoundPath)) {
          compileFile(notFoundPath, node.notFound, chunkCode);
        }
        const loadingPath = resolve(appDir, node.sourceDir, "loading.vsk");
        if (node.loading && existsSync(loadingPath)) {
          compileFile(loadingPath, node.loading, chunkCode);
        }
        if (chunkCode.length > 0) {
          const chunkName = `page-${buildChunkName(node)}.js`;
          chunkEntries.push({ name: chunkName, code: chunkCode.join("\n\n"), node });
        }
        walkSplit2(node.children || [], [..._chain, node]);
      }
    }, annotate2 = function(nodes) {
      for (const node of nodes) {
        const chunkName = `page-${buildChunkName(node)}.js`;
        const hasEntry = chunkEntries.some((e) => e.name === chunkName && e.code.trim());
        if (hasEntry)
          node.chunk = `/_vesk/static/${chunkName}`;
        annotate2(node.children || []);
      }
    };
    var walkSplit = walkSplit2, annotate = annotate2;
    const chunkEntries = [];
    walkSplit2(routeTree, []);
    const sharedCode = [];
    const compMap = componentMap || /* @__PURE__ */ new Map();
    for (const [compName, compPath] of compMap) {
      compileFile(compPath, compName, sharedCode);
    }
    if (sharedCode.length > 0) {
      chunkEntries.push({ name: "shared.js", code: sharedCode.join("\n\n"), node: null });
    }
    for (const entry of chunkEntries) {
      if (entry.code.trim()) {
        chunks.push({
          name: entry.name,
          code: `(()=>{
const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
${entry.code}
})();
`
        });
      }
    }
    annotate2(routeTree);
    const main = await buildMainBundle(routeTree, runtimeDir2, true, {}, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
    return { main, chunks };
  } else {
    let compileFileMono2 = function(filePath, resolvedName) {
      if (seen.has(filePath))
        return;
      seen.add(filePath);
      const src = readFileSync(filePath, "utf-8");
      resolveVskImports(filePath, (p, n) => compileFileMono2(p, n || ""));
      const compCode = compileClient(src, null, { forceClient: true });
      if (compCode) {
        collectRuntimeImports(compCode);
        const stripped = stripExports(stripVskImports(stripRuntimeImport(compCode)));
        componentLines.push(stripped.replace(/^\n+/, "").replace(/\n+$/, ""));
      }
      const hydCode = compileClient(src, null, { hydrate: true, forceClient: true, includeTopLevel: false });
      if (hydCode) {
        collectRuntimeImports(hydCode);
        const stripped = stripExports(stripVskImports(stripRuntimeImport(hydCode))).replace(/__components/g, "__hydrators");
        hydratorLines.push(stripped.replace(/^\n+/, "").replace(/\n+$/, ""));
      }
      const actualName = resolveComponentName(src);
      if (actualName && actualName !== resolvedName) {
        aliasLines.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
        hydratorAliasLines.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
      }
    }, walkMono2 = function(nodes) {
      for (const node of nodes) {
        const pagePath = resolve(appDir, node.sourceDir, "page.vsk");
        if (node.page && existsSync(pagePath))
          compileFileMono2(pagePath, node.page);
        const layoutPath = resolve(appDir, node.sourceDir, "layout.vsk");
        if (node.layout && existsSync(layoutPath))
          compileFileMono2(layoutPath, node.layout);
        const errorPath = resolve(appDir, node.sourceDir, "error.vsk");
        if (node.error && existsSync(errorPath))
          compileFileMono2(errorPath, node.error);
        const notFoundPath = resolve(appDir, node.sourceDir, "not-found.vsk");
        if (node.notFound && existsSync(notFoundPath))
          compileFileMono2(notFoundPath, node.notFound);
        const loadingPath = resolve(appDir, node.sourceDir, "loading.vsk");
        if (node.loading && existsSync(loadingPath))
          compileFileMono2(loadingPath, node.loading);
        walkMono2(node.children || []);
      }
    };
    var compileFileMono = compileFileMono2, walkMono = walkMono2;
    let componentLines = [];
    let hydratorLines = [];
    let aliasLines = [];
    let hydratorAliasLines = [];
    walkMono2(routeTree);
    const compMap = componentMap || /* @__PURE__ */ new Map();
    for (const [compName, compPath] of compMap) {
      compileFileMono2(compPath, compName);
    }
    const main = await buildMainBundle(routeTree, runtimeDir2, false, {
      componentLines,
      hydratorLines,
      aliasLines,
      hydratorAliasLines
    }, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
    return { main, chunks: [] };
  }
}
function stripTypes(code) {
  return transformSync(code, { loader: "ts" }).code;
}
function buildRuntimeCode(runtimeDir2) {
  const runtimeFiles = [
    "ripple-constants.js",
    "ripple-utils.js",
    "ripple-runtime.js",
    "ripple-blocks.js",
    "context.js",
    "hydrate.js",
    "resource.js",
    "reconcile.js",
    "bindings.js",
    "router-match.js",
    "router-components.js",
    "router.js",
    "portal.js",
    "seo.js",
    "image.js",
    "experiment.js",
    "form.js",
    "action.js"
  ];
  let code = "";
  for (const f of runtimeFiles) {
    const p = join(runtimeDir2, f);
    if (existsSync(p)) {
      let src = readFileSync(p, "utf-8");
      src = stripTypes(src);
      src = src.replace(/^import\s+[\s\S]*?from\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, "");
      src = src.replace(/^import\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, "");
      src = src.replace(/^export\s*\{\s*[\s\S]*?\}\s*from\s+['"][^'"]+['"];?\n?/gm, "");
      src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, "");
      src = src.replace(/^export\s+/gm, "");
      code += `// --- ${f} ---
${src}
`;
    }
  }
  const indexSrc = readFileSync(join(runtimeDir2, "index-client.js"), "utf-8");
  const exportNames = stripTypes(indexSrc).match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)?.flatMap((m) => m.replace(/export\s*\{\s*|\s*\}\s*from/g, "").split(",").map((s) => s.trim())) || [];
  code += "// --- exports ---\n";
  for (const name of [...new Set(exportNames)]) {
    if (name)
      code += `export { ${name} };
`;
  }
  return code;
}
function runtimeExportNames(runtimeDir2) {
  const indexSrc = readFileSync(join(runtimeDir2, "index-client.js"), "utf-8");
  const names = /* @__PURE__ */ new Set();
  for (const m of indexSrc.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(",")) {
      const n = raw.trim().split(/\s+as\s+/).pop().trim();
      if (n)
        names.add(n);
    }
  }
  return names;
}
async function buildTreeShakenRuntime(runtimeDir2, usedNames) {
  const unique = [...new Set(usedNames)];
  const available = runtimeExportNames(runtimeDir2);
  const missing = unique.filter((n) => !available.has(n));
  if (missing.length > 0) {
    console.error(`vesk: runtime names not exported \u2014 ${missing.join(", ")}; falling back to full runtime`);
    return buildRuntimeCode(runtimeDir2);
  }
  const entry = join(runtimeDir2, `.runtime-tree-entry-${runtimeEntryId++}.mjs`);
  try {
    writeFileSync(entry, `export { ${unique.join(", ")} } from './index-client.js';
`);
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "iife",
      globalName: "__veskRuntime",
      platform: "browser",
      target: ["es2022"],
      treeShaking: true,
      minify: true,
      write: false,
      logLevel: "silent"
    });
    const bundle = result.outputFiles[0].text;
    return `${bundle}
const { ${unique.join(", ")} } = __veskRuntime;
export { ${unique.join(", ")} };
`;
  } catch (e) {
    console.error("vesk: runtime tree-shake failed, falling back to full runtime:", e.message);
    return buildRuntimeCode(runtimeDir2);
  } finally {
    try {
      unlinkSync(entry);
    } catch {
    }
  }
}
function appendHmrGlobals(code) {
  return code + "globalThis.__vesk_hmr_eval = (code) => eval(code);\n";
}
async function buildMainBundle(routeTree, runtimeDir2, codeSplit, mono, hmr, importRuntime, runtimeImportNames, routeDataCache) {
  const baseRuntimeImports = ["createFileRouter", "get", "set", "effect", "track", "destroy_block", "getActiveComponent", "setActiveComponent", "NavLink", "Link", "reactiveProps", "matchRoute", "ensureChunk"];
  const allRuntimeImports = runtimeImportNames && runtimeImportNames.size > 0 ? [.../* @__PURE__ */ new Set([...baseRuntimeImports, ...runtimeImportNames])] : baseRuntimeImports;
  const runtimeGlobals = [
    "reconcile",
    "createHydrateWalker",
    "needsHydration",
    "hydrate",
    "hydrateViewport",
    "hydrateIdle",
    "hydrateOnInteraction",
    "collectVskMarkers",
    "matchRoute",
    "ensureChunk"
  ];
  const usedRuntimeNames = [.../* @__PURE__ */ new Set([...baseRuntimeImports, ...allRuntimeImports, ...runtimeGlobals])];
  const runtimeCode = importRuntime ? "" : await buildTreeShakenRuntime(runtimeDir2, usedRuntimeNames);
  const preamble = importRuntime ? `import { ${allRuntimeImports.join(", ")} } from '/_vesk/runtime.js';

` : runtimeCode + "\n";
  const cleanupFn = "function __cleanup(start, end) {\n	let n = start.nextSibling;\n	while (n && n !== end) {\n		const next = n.nextSibling;\n		n.remove();\n		n = next;\n	}\n}\n";
  const placeFn = "function __place(start, end, nodes, fallback) {\n	if (start.parentNode !== null) {\n		const p = start.parentNode;\n		for (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);\n		return;\n	}\n	if (nodes.length > 0 && nodes[0].parentNode) {\n		const p = nodes[0].parentNode;\n		p.insertBefore(start, nodes[0]);\n		p.insertBefore(end, nodes[nodes.length - 1].nextSibling);\n		return;\n	}\n	fallback.appendChild(start);\n	fallback.appendChild(end);\n	for (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);\n}\n";
  const updateComponentsFn = "function __updateComponents(nodes) {\n  for (const n of nodes) {\n    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n    if (n.children) __updateComponents(n.children);\n  }\n}\n";
  const routeTreeJson = JSON.stringify(routeTree);
  if (codeSplit) {
    const resolveNamesFn = "function __resolveNames(nodes) {\n  for (const n of nodes) {\n    if (n.chunk) n._chunk = n.chunk;\n    if (n.chunkError) n._chunkError = n.chunkError;\n    if (typeof n.page === 'string') n._pageName = n.page;\n    if (typeof n.layout === 'string') n._layoutName = n.layout;\n    if (typeof n.error === 'string') n._errorName = n.error;\n    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;\n    if (n.children) __resolveNames(n.children);\n  }\n}\n";
    const pendCode = "const __pendChunks = [];\nconst __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';\nif (typeof matchRoute === 'function') {\n  const __currentMatch = matchRoute(__routeTree, __currentPath);\n  if (__currentMatch) {\n    for (const n of __currentMatch.matchChain) {\n      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);\n    }\n  }\n}\n";
    const routerOpts2 = buildRouterOpts({ routeDataCache });
    const startRouterCode = `const __startRouter = function() {
  __updateComponents(__routeTree);
  const __router = createFileRouter(__routeTree${routerOpts2});
  __router.__hydrators = __hydrators;
  __router.__updateComponents = __updateComponents;
  globalThis.__vesk_router = __router;
  if (typeof document !== 'undefined') __router.start();
};
if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {
  Promise.all(__pendChunks.map(u => ensureChunk(u).catch(() => undefined))).then(__startRouter);
} else {
  __startRouter();
}
`;
    const runtimeGlobals2 = "globalThis.reactiveProps = reactiveProps;\nglobalThis.getActiveComponent = getActiveComponent;\nglobalThis.setActiveComponent = setActiveComponent;\nglobalThis.track = track;\nglobalThis.set = set;\nglobalThis.get = get;\nglobalThis.effect = effect;\nglobalThis.destroy_block = destroy_block;\nglobalThis.reconcile = reconcile;\nglobalThis.NavLink = NavLink;\nglobalThis.Link = Link;\nglobalThis.createHydrateWalker = createHydrateWalker;\nglobalThis.needsHydration = needsHydration;\nglobalThis.hydrate = hydrate;\nglobalThis.hydrateViewport = hydrateViewport;\nglobalThis.hydrateIdle = hydrateIdle;\nglobalThis.hydrateOnInteraction = hydrateOnInteraction;\nglobalThis.collectVskMarkers = collectVskMarkers;\nglobalThis.matchRoute = matchRoute;\nglobalThis.ensureChunk = ensureChunk;\nglobalThis.__runtime_comps = __runtime_comps;\nglobalThis.__cleanup = __cleanup;\nglobalThis.__place = __place;\n\n";
    const extraGlobals = [...runtimeImportNames || []].filter((n) => n && n !== "default").map((n) => `globalThis.${n} = ${n};
`).join("");
    const code2 = preamble + "const __components = globalThis.__components || (globalThis.__components = {});\nconst __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\nconst __runtime_comps = __components;\n\n" + runtimeGlobals2 + extraGlobals + cleanupFn + placeFn + "globalThis.__components = __components;\n" + resolveNamesFn + updateComponentsFn + "const __routeTree = " + routeTreeJson + ";\n__resolveNames(__routeTree);\n" + pendCode + startRouterCode;
    return hmr ? appendHmrGlobals(code2) : code2;
  }
  const componentLines = mono?.componentLines || [];
  const hydratorLines = mono?.hydratorLines || [];
  const aliasLines = mono?.aliasLines || [];
  const hydratorAliasLines = mono?.hydratorAliasLines || [];
  const aliasCode = aliasLines.length > 0 ? aliasLines.join("\n") + "\n" : "";
  const hydratorAliasCode = hydratorAliasLines.length > 0 ? hydratorAliasLines.join("\n") + "\n" : "";
  const routerOpts = buildRouterOpts({ routeDataCache });
  const code = preamble + "const __components = {};\nconst __hydrators = {};\nconst __runtime_comps = __components;\n\n" + componentLines.join("\n\n") + "\n" + aliasCode + hydratorLines.join("\n\n") + "\n" + hydratorAliasCode + cleanupFn + placeFn + "globalThis.__components = __components;\nfunction __resolveNames(nodes) {\n  for (const n of nodes) {\n    if (typeof n.page === 'string') {\n      n._pageName = n.page;\n      n.page = __components[n.page];\n    }\n    if (typeof n.layout === 'string') {\n      n._layoutName = n.layout;\n      n.layout = __components[n.layout];\n    }\n    if (typeof n.error === 'string') n.error = __components[n.error];\n    if (typeof n.notFound === 'string') n.notFound = __components[n.notFound];\n    if (n.children) __resolveNames(n.children);\n  }\n}\n" + updateComponentsFn + "const __routeTree = " + routeTreeJson + `;
__resolveNames(__routeTree);
const __router = createFileRouter(__routeTree${routerOpts});
globalThis.__vesk_router = __router;
__router.__hydrators = __hydrators;
__router.__updateComponents = __updateComponents;
if (typeof document !== 'undefined') __router.start();
`;
  return hmr ? appendHmrGlobals(code) : code;
}
var __dirname, runtimeEntryId;
var init_client_bundle = __esm({
  "packages/adapter/dist/client-bundle.js"() {
    "use strict";
    init_esbuild_fallback();
    __dirname = dirname(fileURLToPath(import.meta.url));
    runtimeEntryId = 0;
  }
});

// packages/haul/internal/sidecar/server.ts
import { createServer } from "node:http";
import { readFileSync as readFileSync2, existsSync as existsSync2, writeFileSync as writeFileSync2, mkdirSync, statSync, readdirSync } from "node:fs";
import { resolve as resolve2, dirname as dirname2, extname, join as join2, basename } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { extractMiddlewareParts } from "@vesk/compiler/src/router";
import { createRequire } from "node:module";
var __dirname2 = dirname2(fileURLToPath2(import.meta.url));
var require2 = createRequire(import.meta.url);
function resolveInstalledPackage(spec) {
  try {
    return dirname2(require2.resolve(`${spec}/package.json`));
  } catch {
    return "";
  }
}
function findCompilerSrc() {
  const candidates = [
    resolveInstalledPackage("@vesk/compiler"),
    resolve2(process.cwd(), "node_modules", "@vesk/compiler"),
    resolve2(__dirname2, "..", "..", "node_modules", "@vesk/compiler"),
    "/root/vesk/packages/compiler/dist",
    resolve2(__dirname2, "..", "..", "..", "..", "..", "packages", "compiler", "dist"),
    resolve2(__dirname2, "..", "..", "..", "packages", "compiler", "dist")
  ];
  for (const base of candidates) {
    for (const dir of [base, join2(base, "dist")]) {
      if (existsSync2(join2(dir, "index.js")) || existsSync2(join2(dir, "index.ts"))) return dir;
    }
  }
  throw new Error("@vesk/compiler/dist not found");
}
var compilerDir = findCompilerSrc();
function findRuntimeSrc2() {
  const candidates = [
    resolveInstalledPackage("@vesk/runtime"),
    resolve2(process.cwd(), "node_modules", "@vesk/runtime"),
    resolve2(__dirname2, "..", "..", "node_modules", "@vesk/runtime"),
    "/root/vesk/packages/runtime/dist",
    resolve2(__dirname2, "..", "..", "..", "..", "..", "packages", "runtime", "dist"),
    resolve2(__dirname2, "..", "..", "..", "packages", "runtime", "dist")
  ];
  for (const base of candidates) {
    for (const dir of [base, join2(base, "dist")]) {
      if (existsSync2(join2(dir, "index-client.js")) || existsSync2(join2(dir, "index-client.ts"))) return dir;
    }
  }
  throw new Error("@vesk/runtime/dist not found");
}
var runtimeDir = findRuntimeSrc2();
function loadCompilerModule(name) {
  const tsPath = resolve2(compilerDir, name.replace(/\.js$/, ".ts"));
  const jsPath = resolve2(compilerDir, name);
  const path = existsSync2(tsPath) ? tsPath : jsPath;
  return import(path);
}
var compileClient2;
var compileServer;
var generateVskDts;
var vskToTsx;
var typecheckProject;
var scanRoutes;
var scanApiRoutes;
var collectMiddlewareChain;
async function ensureModules() {
  if (compileClient2) return;
  console.log("sidecar: loading client-codegen");
  const clientCodegen = await loadCompilerModule("client-codegen.js");
  console.log("sidecar: loading server-codegen");
  const serverCodegen = await loadCompilerModule("server-codegen.js");
  console.log("sidecar: loading vsk-tsx");
  const vskTsx = await loadCompilerModule("vsk-tsx.js");
  console.log("sidecar: loading typecheck");
  const typecheck = await loadCompilerModule("typecheck.js");
  console.log("sidecar: loading router");
  const router = await loadCompilerModule("router.js");
  console.log("sidecar: loading middleware");
  const middleware = await loadCompilerModule("middleware.js");
  console.log("sidecar: loading api-routes");
  const apiRoutes = await loadCompilerModule("api-routes.js");
  console.log("sidecar: all modules loaded");
  compileClient2 = clientCodegen.compileClient;
  compileServer = serverCodegen.compileServer;
  generateVskDts = vskTsx.generateVskDts;
  vskToTsx = vskTsx.vskToTsx;
  typecheckProject = typecheck.typecheckProject;
  scanRoutes = router.scanRoutes;
  scanApiRoutes = apiRoutes.scanApiRoutes;
  collectMiddlewareChain = middleware.collectMiddlewareChain;
}
async function processCssWithPlugins(css, filePath, projectDir) {
  const baseDir = projectDir || process.cwd();
  const veskConfigPath = resolve2(baseDir, "vesk.config.ts");
  const veskConfigTsxPath = resolve2(baseDir, "vesk.config.tsx");
  let plugins = [];
  if (existsSync2(veskConfigPath) || existsSync2(veskConfigTsxPath)) {
    const configPath = existsSync2(veskConfigTsxPath) ? veskConfigTsxPath : veskConfigPath;
    try {
      const config = await import(configPath);
      const configObj = config.default || config;
      plugins = configObj?.plugins || [];
    } catch (e) {
      console.error("on_css: failed to load vesk.config:", e);
    }
  }
  let result = css;
  for (const plugin of plugins) {
    if (typeof plugin.onCSS === "function") {
      try {
        const processed = await plugin.onCSS(result, filePath);
        if (processed !== null && typeof processed === "string") {
          result = processed;
        }
      } catch (e) {
        console.error("on_css error:", e);
      }
    }
  }
  return result;
}
function err(id, message) {
  return { jsonrpc: "2.0", id, error: { code: 1, message } };
}
function serveStatic(req, res, filePath, contentType) {
  if (!existsSync2(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const data = readFileSync2(filePath, "utf-8");
  res.writeHead(200, { "Content-Type": contentType });
  res.end(data);
}
var devMods = null;
var devState = null;
async function loadDevModules() {
  if (devMods) return devMods;
  const [sc, ar, mw, cg, ru, store, util, cb, act, cfg, rt] = await Promise.all([
    import("@vesk/compiler/src/server-codegen"),
    import("@vesk/compiler/src/api-routes"),
    import("@vesk/compiler/src/middleware"),
    import("@vesk/compiler/src/client-codegen"),
    import("@vesk/compiler/src/router"),
    import("@vesk/compiler/src/ssr-store"),
    import("@vesk/compiler/src/server-utils"),
    Promise.resolve().then(() => (init_client_bundle(), client_bundle_exports)),
    import("@vesk/runtime/src/action"),
    import("@vesk/compiler/src/config"),
    import("@vesk/runtime/src/index-server")
  ]);
  devMods = {
    ...sc,
    ...ar,
    ...mw,
    ...cg,
    ...ru,
    ...store,
    ...util,
    ...cb,
    ...act,
    ...cfg,
    runtimeServer: rt
  };
  return devMods;
}
function resolveRuntimeDir(projectDir) {
  const pkgDir = resolve2(projectDir, "node_modules", "@vesk/runtime");
  if (existsSync2(join2(pkgDir, "ripple-runtime.js"))) return pkgDir;
  const distDir = join2(pkgDir, "dist");
  if (existsSync2(join2(distDir, "ripple-runtime.js"))) return distDir;
  if (existsSync2(join2(runtimeDir, "ripple-runtime.js"))) return runtimeDir;
  return null;
}
function loadEnvFiles(projectDir) {
  const files = [join2(projectDir, ".env"), join2(projectDir, ".env.local")];
  for (const filePath of files) {
    if (!existsSync2(filePath)) continue;
    const content = readFileSync2(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      let key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
async function loadConfig(projectDir) {
  const { defineConfig, definePlugin, preset, validateConfig } = devMods;
  loadEnvFiles(projectDir);
  const jsPath = join2(projectDir, "vesk.config.js");
  const tsPath = join2(projectDir, "vesk.config.ts");
  let configPath = null;
  if (existsSync2(jsPath)) configPath = jsPath;
  else if (existsSync2(tsPath)) configPath = tsPath;
  if (!configPath) return {};
  let raw;
  if (configPath.endsWith(".ts")) {
    const { transpile } = await import("typescript");
    const src = readFileSync2(configPath, "utf-8");
    let js = transpile(src, { module: 99, target: 99 });
    js = js.replace(/import\s+\{[^}]*\}\s*from\s+['"]@vesk\/compiler['"]\s*;?\s*/g, "");
    js = `const { defineConfig, definePlugin, preset } = globalThis.__vesk_inject;
` + js;
    const tmpFile = join2(projectDir, ".vesk", "config.tmp.js");
    mkdirSync(dirname2(tmpFile), { recursive: true });
    writeFileSync2(tmpFile, js, "utf-8");
    globalThis.__vesk_inject = { defineConfig, definePlugin, preset };
    raw = (await import(tmpFile)).default;
    delete globalThis.__vesk_inject;
  } else {
    raw = (await import(configPath)).default;
  }
  const config = typeof defineConfig === "function" ? defineConfig(raw) : raw;
  if (typeof validateConfig === "function") validateConfig(config);
  const sec = config.security;
  if (sec !== void 0 && sec !== false && typeof sec === "object" && sec.redactLogs !== false) {
    try {
      devMods.setRedactLogging(true);
    } catch {
    }
  }
  return config;
}
var TAILWIND_BLOCK = /^\s*@(theme\s*\{|layer\s+(components|utilities)\s*\{|utility\s+\w+\s*\{)/;
function stripTailwindDirectives(css) {
  const lines = css.split("\n");
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("@import 'tailwindcss'") || line.startsWith('@import "tailwindcss"')) {
      i++;
      continue;
    }
    if (line.startsWith("@source ")) {
      i++;
      continue;
    }
    if (TAILWIND_BLOCK.test(line)) {
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
  return result.join("\n").trim();
}
function relaxCspForDev(sec) {
  if (!sec || sec.contentSecurityPolicy === false || sec.contentSecurityPolicy === "off") return sec;
  let csp = sec.contentSecurityPolicy;
  if (csp === true) {
    csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
  }
  if (typeof csp === "string" && csp.includes("script-src 'self'")) {
    csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
  }
  return { ...sec, contentSecurityPolicy: csp };
}
function countPages(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.page) n++;
    if (node.children.length > 0) n += countPages(node.children);
  }
  return n;
}
function collectRoutePaths(nodes, out = []) {
  for (const node of nodes) {
    if (node.page && node.fullPath) out.push(node.fullPath);
    if (node.children.length > 0) collectRoutePaths(node.children, out);
  }
  return out;
}
function countFilesNamed(dir, name) {
  if (!existsSync2(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join2(dir, entry.name);
    if (entry.isDirectory()) n += countFilesNamed(p, name);
    else if (entry.name === name) n++;
  }
  return n;
}
function buildRequestContext(req) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(", ") : v === void 0 || v === null ? "" : String(v);
  }
  const cookies = {};
  const raw = headers.cookie || "";
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) cookies[k] = v;
  }
  return { headers, url: req.url, method: req.method || "GET", cookies, locals: {}, ip: void 0 };
}
function makeWebRequest(req, url) {
  const parsedUrl = new URL(url.href);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(", ") : v === void 0 || v === null ? "" : String(v);
  }
  const webRequest = new Request(parsedUrl, {
    method: req.method || "GET",
    headers,
    body: req.__bodyBuffer && req.__bodyBuffer.length > 0 ? req.__bodyBuffer : null
  });
  return webRequest;
}
function extractCompName(src) {
  return devMods.resolveComponentName(src);
}
function securityMeta(security) {
  if (!security) return "";
  let meta = "";
  if (security.referrerPolicy !== false) meta += `	<meta name="referrer" content="${security.referrerPolicy || "strict-origin-when-cross-origin"}" />
`;
  if (security.contentSecurityPolicy !== false) meta += `	<meta http-equiv="Content-Security-Policy" content="${(security.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, "&quot;")}" />
`;
  if (security.autoEscape !== false) meta += "	<!-- vesk: auto-escape enabled -->\n";
  return meta;
}
function storeDataScript(payload) {
  if (!payload.props && !payload.ssrData) return null;
  const store = devState.ssrDataStore;
  if (store.size >= 100) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set(token, payload);
  return "/_vesk/ssr-data.js?t=" + token;
}
function chainForPath(routeTree, pathname) {
  const match = devMods.matchUrl(routeTree, pathname);
  if (!match) return [];
  const urlParts = pathname.split("/").filter(Boolean);
  const chain = [];
  let segIdx = 0;
  for (const node of match.nodes) {
    if (node.fullPath === "/") {
      chain.push(node);
    } else if (!node.isGroup && node.segmentCount > 0) {
      if (segIdx < urlParts.length) {
        chain.push(node);
        segIdx++;
      }
    } else {
      chain.push(node);
    }
  }
  return chain;
}
function pageSourcesFor(appDirPath, routeTree) {
  const out = [];
  function walk(nodes) {
    for (const node of nodes) {
      if (node.page) out.push(resolve2(appDirPath, node.sourceDir, "page.vsk"));
      if (node.layout) out.push(resolve2(appDirPath, node.sourceDir, "layout.vsk"));
      walk(node.children);
    }
  }
  walk(routeTree);
  return out;
}
function walkVskFiles(dir, out, seen) {
  if (!existsSync2(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve2(dir, entry.name);
    if (seen.has(full)) continue;
    seen.add(full);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".vesk") continue;
      walkVskFiles(full, out, seen);
    } else if (entry.isFile() && entry.name.endsWith(".vsk")) {
      out.push(full);
    }
  }
}
function candidateSources(appDirPath, routeTree) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const src of pageSourcesFor(appDirPath, routeTree)) {
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  const projectRoot = resolve2(appDirPath, "..");
  for (const dir of [resolve2(projectRoot, "components"), appDirPath, projectRoot]) {
    walkVskFiles(dir, out, seen);
  }
  return out;
}
function registerSource(sourcePath) {
  if (!existsSync2(sourcePath)) return;
  try {
    devMods.compileFile(readFileSync2(sourcePath, "utf-8"), { sourcePath });
  } catch {
  }
}
function ensureActionRegistered(actionId, pagePathname, appDirPath, routeTree) {
  if (devMods.getAction(actionId)) return;
  const match = devMods.matchUrl(routeTree, pagePathname);
  if (match) {
    for (let i = match.nodes.length - 1; i >= 0; i--) {
      registerSource(resolve2(appDirPath, match.nodes[i].sourceDir, "page.vsk"));
      registerSource(resolve2(appDirPath, match.nodes[i].sourceDir, "layout.vsk"));
    }
  }
  if (devMods.getAction(actionId)) return;
  for (const sourcePath of candidateSources(appDirPath, routeTree)) {
    if (devMods.getAction(actionId)) break;
    registerSource(sourcePath);
  }
}
async function renderPageHtml(pagePathname, params) {
  const { appDirPath, routeTree, security } = devState;
  const chain = chainForPath(routeTree, pagePathname);
  if (chain.length === 0) return null;
  let body = "";
  let head = "";
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    const pageFilePath = resolve2(appDirPath, node.sourceDir, "page.vsk");
    const layoutFilePath = resolve2(appDirPath, node.sourceDir, "layout.vsk");
    if (i === chain.length - 1 && node.page && existsSync2(pageFilePath)) {
      const src2 = readFileSync2(pageFilePath, "utf-8");
      const compName2 = extractCompName(src2) || node.page;
      const result = await devMods.renderPage(src2, compName2, { params }, /* @__PURE__ */ new Map(), { hydrate: true, sourcePath: pageFilePath });
      body = result.body;
      head = result.head || "";
    }
    if (node.layout && existsSync2(layoutFilePath)) {
      const src2 = readFileSync2(layoutFilePath, "utf-8");
      const compName2 = extractCompName(src2) || node.layout;
      const result = await devMods.renderPage(src2, compName2, { children: body }, /* @__PURE__ */ new Map(), { hydrate: true, sourcePath: layoutFilePath });
      body = result.body;
      head = (result.head || "") + head;
    }
  }
  const hasLayout = chain.some((n) => n.layout && existsSync2(resolve2(appDirPath, n.sourceDir, "layout.vsk")));
  if (hasLayout) {
    const secMeta = securityMeta(security);
    return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />
	<link rel="stylesheet" href="/_vesk/static/global.css" />
${secMeta}${head ? "	" + head.split("\n").join("\n	") + "\n" : ""}</head>
<body>
<div id="root">
${devMods.prettifyHtml(body)}
</div>
	<script type="module" src="/_vesk/client.js"></script>
	<script type="module" src="/_vesk/hmr.js"></script>
</body>
</html>`;
  }
  const leaf = chain.find((n) => n.page);
  if (!leaf) return null;
  const src = readFileSync2(resolve2(appDirPath, leaf.sourceDir, "page.vsk"), "utf-8");
  const compName = extractCompName(src) || leaf.page;
  const html = await devMods.renderFullPage(src, compName, { params }, /* @__PURE__ */ new Map(), {
    hydrate: true,
    clientScriptUrl: "/_vesk/client.js",
    cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
    security,
    externalDataScript: storeDataScript,
    sourcePath: resolve2(appDirPath, leaf.sourceDir, "page.vsk")
  });
  return html.replace("</body>", '	<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
}
async function handleDevAction(req, url, bodyBuffer) {
  const { appDirPath, routeTree, security } = devState;
  if (!url.pathname.startsWith("/_vesk/action/")) return null;
  const actionId = url.pathname.replace("/_vesk/action/", "");
  const webRequest = makeWebRequest({ ...req, __bodyBuffer: bodyBuffer }, url);
  const referer = String(req.headers.referer || "");
  let refererUrl = null;
  try {
    if (referer) refererUrl = new URL(referer);
  } catch {
    refererUrl = null;
  }
  const pagePathname = refererUrl ? refererUrl.pathname : "/";
  ensureActionRegistered(actionId, pagePathname, appDirPath, routeTree);
  const action = devMods.getAction(actionId);
  if (!action) {
    return { status: 404, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: "Action not found" })).toString("base64") };
  }
  let input = {};
  const ct = webRequest.headers.get("content-type") || "";
  if (ct.includes("json")) {
    input = await webRequest.json().catch(() => ({}));
  } else if (ct.includes("multipart/form-data") || ct.includes("x-www-form-urlencoded")) {
    const fd = await webRequest.formData().catch(() => null);
    if (fd) input = Object.fromEntries(fd.entries());
  } else {
    const text = await webRequest.text().catch(() => "");
    if (text) {
      try {
        input = JSON.parse(text);
      } catch {
      }
    }
  }
  const issues = devMods.validateActionInput(action, input);
  const isFetch = !(req.headers.accept || "").includes("text/html");
  const match = devMods.matchUrl(routeTree, pagePathname);
  const params = match ? match.params : {};
  if (issues.length > 0) {
    if (isFetch) {
      return { status: 200, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, issues })).toString("base64") };
    }
    const prevReq2 = globalThis.__vesk_request;
    globalThis.__vesk_action_errors = devMods.issuesToFieldMap(issues);
    try {
      const html = await renderPageHtml(pagePathname, params);
      if (html === null) {
        return { status: 500, headers: [["Content-Type", "text/plain"]], bodyB64: Buffer.from("Action validation failed and the referer page could not be rendered").toString("base64") };
      }
      return { status: 200, headers: [["Content-Type", "text/html"]], bodyB64: Buffer.from(html).toString("base64") };
    } finally {
      globalThis.__vesk_action_errors = void 0;
      globalThis.__vesk_request = prevReq2;
    }
  }
  const actionUrl = new URL(url.href);
  const prevReq = globalThis.__vesk_request;
  globalThis.__vesk_request = {
    request: webRequest,
    params,
    url: actionUrl,
    locals: {},
    cookies: devMods.parseCookies(String(req.headers.cookie || ""))
  };
  try {
    const result = await action.execute(input, {
      request: webRequest,
      params,
      url: actionUrl.href,
      headers: () => {
        const m = /* @__PURE__ */ new Map();
        for (const [k, v] of webRequest.headers.entries()) m.set(k.toLowerCase(), String(v));
        return m;
      },
      cookies: () => devMods.parseCookies(String(req.headers.cookie || "")),
      locals: () => {
        const cur = globalThis.__vesk_request;
        return cur && cur.locals ? cur.locals : {};
      },
      redirect: (u, status) => new Response(null, { status: status || 303, headers: { Location: u } })
    });
    if (isFetch) {
      return { status: 200, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: true, data: result ?? null })).toString("base64") };
    }
    const location = pagePathname + (refererUrl ? refererUrl.search : "");
    return { status: 303, headers: [["Location", location]], bodyB64: "" };
  } catch (err2) {
    const message = err2 && typeof err2 === "object" && "message" in err2 ? String(err2.message) : "Action failed";
    if (isFetch) {
      return { status: 500, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: message })).toString("base64") };
    }
    return { status: 500, headers: [["Content-Type", "text/plain"]], bodyB64: Buffer.from(message).toString("base64") };
  } finally {
    globalThis.__vesk_request = prevReq;
  }
}
async function handleDevApi(req, url, bodyBuffer) {
  const { appDirPath, routeTree } = devState;
  if (!url.pathname.startsWith("/api")) return null;
  const apiDirPath = join2(appDirPath, "api");
  if (!existsSync2(apiDirPath)) return null;
  const mwChain = devMods.collectMiddlewareChain(routeTree, url.pathname, appDirPath);
  const apiRoutes = await devMods.scanApiRoutes(apiDirPath);
  const apiMatch = devMods.matchApiUrl(apiRoutes, req.url || url.pathname);
  if (!apiMatch) return null;
  const requestUrl = req.url ? `http://localhost:${devState.port}${req.url.startsWith("/") ? req.url : "/" + req.url}` : url.href;
  let apiLocals = {};
  if (mwChain.length > 0) {
    const mwReq = new Request(requestUrl, { headers: req.headers, method: req.method || "GET" });
    try {
      const mwResult = await devMods.executeMiddlewareChain(mwChain, mwReq, apiMatch.params, {
        plugins: devState.config.plugins || [],
        onLast: async () => new Response(null)
      });
      apiLocals = mwResult.locals || {};
    } catch (e) {
      const err2 = e;
      if (err2.name === "NotFoundError") {
        return { status: 404, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ error: "Not Found" })).toString("base64") };
      }
      throw e;
    }
  }
  const webRequest = devMods.buildWebRequest(req, req.url || url.pathname, bodyBuffer.length ? bodyBuffer : null);
  const response = await devMods.executeApiRoute(
    apiMatch.node.filePath,
    (req.method || "GET").toUpperCase(),
    webRequest,
    apiMatch.params,
    apiLocals,
    devState.apiWatchCache
  );
  if (!response) {
    return { status: 500, headers: [["Content-Type", "text/plain"]], bodyB64: Buffer.from("API route returned no response").toString("base64") };
  }
  const body = await response.text();
  const headers = [];
  for (const [k, v] of response.headers.entries()) headers.push([k, v]);
  return { status: response.status, headers, bodyB64: Buffer.from(body).toString("base64") };
}
async function handleDevSsr(req, url) {
  const { routeTree, appDirPath, security, config, port: port2 } = devState;
  const forData = req.headers["x-vesk-data"] === "1";
  const match = devMods.matchUrl(routeTree, url.pathname);
  const rawCtx = buildRequestContext(req);
  if (security?.trustProxy) {
    devMods.applyTrustProxy(rawCtx, security.trustProxy);
  }
  if (req.__clientIp && !rawCtx.ip) rawCtx.ip = req.__clientIp;
  const ctx = rawCtx;
  async function renderSSR() {
    return devMods.withSsrStore(async () => {
      const chain = cleanChain;
      let body = "";
      let head = "";
      let props;
      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const pageFilePath = resolve2(appDirPath, node.sourceDir, "page.vsk");
        const layoutFilePath = resolve2(appDirPath, node.sourceDir, "layout.vsk");
        if (i === chain.length - 1 && node.page && existsSync2(pageFilePath)) {
          const src = readFileSync2(pageFilePath, "utf-8");
          const compName = extractCompName(src) || node.page;
          const result = await devMods.renderPage(src, compName, { params: match.params }, /* @__PURE__ */ new Map(), { hydrate: true, sourcePath: pageFilePath });
          body = result.body;
          head = result.head || "";
          props = result.props;
        }
        if (node.layout && existsSync2(layoutFilePath)) {
          const src = readFileSync2(layoutFilePath, "utf-8");
          const compName = extractCompName(src) || node.layout;
          const result = await devMods.renderPage(src, compName, { children: body }, /* @__PURE__ */ new Map(), { hydrate: true, sourcePath: layoutFilePath });
          body = result.body;
          head = (result.head || "") + head;
        }
      }
      if (forData) {
        return { html: "", props: props || { params: match.params }, head };
      }
      const hasLayout = chain.some((n) => n.layout && existsSync2(resolve2(appDirPath, n.sourceDir, "layout.vsk")));
      let html;
      if (hasLayout) {
        const ssrData = devMods.ssrSink.snapshot();
        const dataScripts = devMods.buildDataScripts(props, ssrData || {}, storeDataScript);
        const dataScriptBlock = dataScripts.length > 0 ? "\n" + dataScripts.join("\n") + "\n" : "";
        let secMeta = "";
        if (security) {
          if (security.referrerPolicy !== false) secMeta += `	<meta name="referrer" content="${security.referrerPolicy || "strict-origin-when-cross-origin"}" />
`;
          if (security.contentSecurityPolicy !== false) secMeta += `	<meta http-equiv="Content-Security-Policy" content="${(security.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, "&quot;")}" />
`;
          if (security.autoEscape !== false) secMeta += "	<!-- vesk: auto-escape enabled -->\n";
        }
        html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />
	<link rel="stylesheet" href="/_vesk/static/global.css" />
${secMeta}${head ? "	" + head.split("\n").join("\n	") + "\n" : ""}</head>
<body>
<div id="root">
${devMods.prettifyHtml(body)}
</div>${dataScriptBlock}	<script type="module" src="/_vesk/client.js"></script>
	<script type="module" src="/_vesk/hmr.js"></script>
</body>
</html>`;
      } else {
        const leaf = chain.find((n) => n.page);
        if (leaf) {
          const src = readFileSync2(resolve2(appDirPath, leaf.sourceDir, "page.vsk"), "utf-8");
          const compName = extractCompName(src) || leaf.page;
          html = await devMods.renderFullPage(src, compName, { params: match.params }, /* @__PURE__ */ new Map(), {
            hydrate: true,
            clientScriptUrl: "/_vesk/client.js",
            cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
            security,
            externalDataScript: storeDataScript,
            sourcePath: resolve2(appDirPath, leaf.sourceDir, "page.vsk")
          });
          html = html.replace("</body>", '	<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } else {
          throw new Error("No page or layout matched");
        }
      }
      return { html, props: props || { params: match.params }, head };
    });
  }
  if (!match) {
    const rootNode = routeTree.find((n) => n.fullPath === "/");
    let notFoundHtml = null;
    if (rootNode && rootNode.notFound) {
      const nfPath = resolve2(appDirPath, rootNode.sourceDir, "not-found.vsk");
      if (existsSync2(nfPath)) {
        try {
          const nfSrc = readFileSync2(nfPath, "utf-8");
          const nfCompName = extractCompName(nfSrc) || rootNode.notFound;
          notFoundHtml = await devMods.renderFullPage(nfSrc, nfCompName, { params: {}, url: url.pathname }, /* @__PURE__ */ new Map(), {
            hydrate: true,
            cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
            security,
            externalDataScript: storeDataScript,
            sourcePath: nfPath
          });
          notFoundHtml = notFoundHtml.replace("</body>", '	<script type="module" src="/_vesk/client.js"></script>\n	<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
        } catch {
        }
      }
    }
    return {
      status: 404,
      headers: [["Content-Type", "text/html"]],
      bodyB64: Buffer.from(notFoundHtml || `<!DOCTYPE html><html><body><h1>404</h1><p>${url.pathname}</p></body></html>`).toString("base64")
    };
  }
  const urlParts = url.pathname.split("/").filter(Boolean);
  const cleanChain = [];
  let segIdx = 0;
  for (const node of match.nodes) {
    if (node.fullPath === "/") {
      cleanChain.push(node);
    } else if (!node.isGroup && node.segmentCount > 0) {
      if (segIdx < urlParts.length) {
        cleanChain.push(node);
        segIdx++;
      }
    } else {
      cleanChain.push(node);
    }
  }
  const mwChain = devMods.collectMiddlewareChain(routeTree, url.pathname, appDirPath);
  const toDevResponse = (status, headers, body) => {
    const h = Object.entries(headers);
    if (security) {
      const secHeaders = devMods.securityHeaders({ security });
      for (const [k, v] of Object.entries(secHeaders)) h.push([k, v]);
    }
    return { status, headers: h, bodyB64: Buffer.from(body).toString("base64") };
  };
  try {
    if (mwChain.length > 0) {
      const mwReq = new Request(`http://localhost:${port2}${url.pathname}${url.search}`, {
        headers: req.headers,
        method: req.method || "GET"
      });
      const mwResult = await devMods.executeMiddlewareChain(mwChain, mwReq, match.params, {
        plugins: config.plugins || [],
        onLast: async (rewrite) => {
          if (rewrite) url.pathname = rewrite;
          const prev = globalThis.__vesk_request;
          globalThis.__vesk_request = ctx;
          try {
            try {
              const rendered = await renderSSR();
              if (forData) {
                return new Response(JSON.stringify({ path: url.pathname, params: match.params, props: rendered.props, head: rendered.head }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "x-vesk-data" } });
              }
              return new Response(rendered.html, { headers: { "Content-Type": "text/html" } });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (forData) {
                return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "x-vesk-data" } });
              }
              throw e;
            }
          } finally {
            globalThis.__vesk_request = prev;
          }
        }
      });
      if (mwResult.response) {
        const body = await mwResult.response.text();
        const headers = [];
        for (const [k, v] of mwResult.response.headers.entries()) headers.push([k, v]);
        if (security) {
          const secHeaders = devMods.securityHeaders({ security });
          for (const [k, v] of Object.entries(secHeaders)) headers.push([k, v]);
        }
        return { status: mwResult.response.status, headers, bodyB64: Buffer.from(body).toString("base64") };
      }
      return { status: 204, headers: [], bodyB64: "" };
    } else {
      const prev = globalThis.__vesk_request;
      globalThis.__vesk_request = ctx;
      try {
        if (forData) {
          try {
            const rendered2 = await renderSSR();
            return toDevResponse(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "x-vesk-data" }, JSON.stringify({ path: url.pathname, params: match.params, props: rendered2.props, head: rendered2.head }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return toDevResponse(500, { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "x-vesk-data" }, JSON.stringify({ error: msg }));
          }
        }
        const rendered = await renderSSR();
        return toDevResponse(200, { "Content-Type": "text/html; charset=utf-8" }, rendered.html);
      } finally {
        globalThis.__vesk_request = prev;
      }
    }
  } catch (e) {
    const err2 = e;
    if (err2.name === "Redirect") {
      const status = err2.status || 302;
      return { status, headers: [["Location", String(err2.url)]], bodyB64: Buffer.from(`<!DOCTYPE html><html><body><a href="${err2.url}">Redirect</a></body></html>`).toString("base64") };
    }
    if (err2.name === "NotFoundError") {
      let notFoundHtml = null;
      if (match && match.nodes) {
        for (let i = match.nodes.length - 1; i >= 0; i--) {
          const node = match.nodes[i];
          if (node.notFound) {
            const nfPath = resolve2(appDirPath, node.sourceDir, "not-found.vsk");
            if (existsSync2(nfPath)) {
              try {
                const nfSrc = readFileSync2(nfPath, "utf-8");
                const nfCompName = extractCompName(nfSrc) || node.notFound;
                const html = await devMods.renderFullPage(nfSrc, nfCompName, { params: match.params, url: url.pathname }, /* @__PURE__ */ new Map(), {
                  hydrate: true,
                  cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
                  security,
                  externalDataScript: storeDataScript,
                  sourcePath: nfPath
                });
                notFoundHtml = html.replace("</body>", '	<script type="module" src="/_vesk/client.js"></script>\n	<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
              } catch {
              }
            }
            break;
          }
        }
      }
      return { status: 404, headers: [["Content-Type", "text/html"]], bodyB64: Buffer.from(notFoundHtml || "<!DOCTYPE html><html><body><h1>404 \u2014 Not Found</h1></body></html>").toString("base64") };
    }
    let errorHtml = null;
    if (match && match.nodes) {
      for (let i = match.nodes.length - 1; i >= 0; i--) {
        const node = match.nodes[i];
        if (node.error) {
          const errPath = resolve2(appDirPath, node.sourceDir, "error.vsk");
          if (existsSync2(errPath)) {
            try {
              const errSrc = readFileSync2(errPath, "utf-8");
              const errCompName = extractCompName(errSrc) || node.error;
              const errProps = { error: err2.message, stack: err2.stack, statusCode: 500, url: url.pathname };
              const html = await devMods.renderFullPage(errSrc, errCompName, errProps, /* @__PURE__ */ new Map(), {
                hydrate: true,
                cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
                security,
                externalDataScript: storeDataScript,
                sourcePath: errPath
              });
              errorHtml = html.replace("</body>", '	<script type="module" src="/_vesk/client.js"></script>\n	<script type="module" src="/_vesk/hmr.js"></script>\n</body>');
            } catch {
            }
          }
          break;
        }
      }
    }
    const message = err2.message || String(e);
    const stack = err2.stack || "";
    return {
      status: 500,
      headers: [["Content-Type", "text/html"]],
      bodyB64: Buffer.from(errorHtml || `<!DOCTYPE html><html><body><h1>500</h1><pre>${message}
${stack}</pre></body></html>`).toString("base64")
    };
  }
}
async function handleDevRequest(p) {
  const state = devState;
  if (!state) {
    return { status: 500, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ error: "dev server not initialized" })).toString("base64") };
  }
  const url = new URL(p.url, `http://localhost:${p.port || state.port}`);
  const bodyBuffer = p.bodyB64 ? Buffer.from(p.bodyB64, "base64") : Buffer.alloc(0);
  const reqHost = p.headers.host || `localhost:${p.port || state.port}`;
  const reqOrigin = p.headers.origin || "";
  const corsAllowed = devMods.corsHeaders(state.security || {}, reqOrigin, reqHost);
  if (corsAllowed["Access-Control-Allow-Origin"] && p.method === "OPTIONS") {
    const headers = Object.entries({ ...corsAllowed, "Content-Length": "0" });
    return { status: 204, headers, bodyB64: "" };
  }
  const proto = p.headers["x-forwarded-proto"] && state.security?.trustProxy ? p.headers["x-forwarded-proto"] : "http";
  globalThis.__vesk_ssr_base_url = `${proto}://${reqHost}`;
  const req = {
    method: p.method,
    url: url.pathname + url.search,
    headers: p.headers,
    socket: { remoteAddress: p.clientIp || "127.0.0.1" },
    __bodyBuffer: bodyBuffer,
    __clientIp: p.clientIp
  };
  const withCors = (resp) => {
    if (!corsAllowed || Object.keys(corsAllowed).length === 0) return resp;
    const seen = new Set(resp.headers.map(([k]) => k.toLowerCase()));
    for (const [k, v] of Object.entries(corsAllowed)) {
      if (!seen.has(k.toLowerCase())) resp.headers.push([k, v]);
    }
    return resp;
  };
  if (url.pathname === "/_vesk/ssr-data.js") {
    const token = url.searchParams.get("t") || "";
    const payload = state.ssrDataStore.get(token);
    if (payload) state.ssrDataStore.delete(token);
    const lines = [];
    if (payload?.props) lines.push(`globalThis.__vesk_props = ${JSON.stringify(payload.props)};`);
    if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${JSON.stringify(payload.ssrData)};`);
    return withCors({ status: 200, headers: [["Content-Type", "application/javascript"], ["Cache-Control", "no-store"]], bodyB64: Buffer.from(lines.join("\n") || "// no ssr data").toString("base64") });
  }
  if (url.pathname.startsWith("/_vesk/action/")) {
    return withCors(await handleDevAction(req, url, bodyBuffer));
  }
  const apiResp = await handleDevApi(req, url, bodyBuffer);
  if (apiResp) return withCors(apiResp);
  return withCors(await handleDevSsr(req, url));
}
function updateSourceMapping() {
  const { routeTree, sourceToComponents } = devState;
  sourceToComponents.clear();
  for (const [compName, sourcePath] of devMods.collectSources(routeTree)) {
    const existing = sourceToComponents.get(sourcePath) || [];
    existing.push(compName);
    sourceToComponents.set(sourcePath, existing);
  }
}
function readRawCss(projectDir) {
  const cssPath = join2(projectDir, "src", "global.css");
  const altCssPath = join2(projectDir, "src", "app.css");
  if (existsSync2(cssPath)) return { raw: readFileSync2(cssPath, "utf-8"), cssPath };
  if (existsSync2(altCssPath)) return { raw: readFileSync2(altCssPath, "utf-8"), cssPath: altCssPath };
  return { raw: "", cssPath };
}
async function rebuildTailwindCss() {
  const { rawCss, cssPath, plugins } = devState;
  if (!rawCss) {
    devState.cssGlobal = "";
    devState.cssTailwind = "";
    return;
  }
  try {
    devState.cssGlobal = stripTailwindDirectives(rawCss);
    devState.cssTailwind = rawCss;
    for (const plugin of plugins) {
      if (typeof plugin.onCSS === "function") {
        const result = await plugin.onCSS(rawCss, cssPath);
        if (result !== null && typeof result === "string") {
          devState.cssTailwind = result;
        }
      }
    }
    if (devState.cssGlobal === devState.cssTailwind || devState.cssGlobal === rawCss) {
      devState.cssTailwind = devState.cssGlobal;
    }
  } catch (e) {
    console.error("sidecar: CSS rebuild error:", e);
  }
}
function runtimeImportNamesFrom(clientJs) {
  const m = clientJs.match(/^import\s*\{([^}]*)\}\s*from\s*['"]\/_vesk\/runtime\.js['"];?\s*$/m);
  if (!m) return null;
  const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 ? names : null;
}
async function bundleRuntime() {
  const { runtimeDir: runtimeDir2 } = devState;
  try {
    const used = runtimeImportNamesFrom(devState.clientBundle || "") ?? [...devMods.runtimeExportNames(runtimeDir2)].filter((n) => !!n);
    devState.runtimeBundle = await devMods.buildTreeShakenRuntime(runtimeDir2, used);
  } catch (e) {
    console.error("sidecar: runtime bundle error:", e.message);
  }
}
async function buildClientBundle() {
  const { routeTree, appDirPath, config } = devState;
  const opts = { importRuntime: true, hmr: true, codeSplit: true };
  if (config.routeDataCache !== void 0) opts.routeDataCache = config.routeDataCache;
  const { main, chunks } = await devMods.generateClientBundle(routeTree, appDirPath, /* @__PURE__ */ new Map(), opts);
  devState.clientBundle = main;
  const next = /* @__PURE__ */ new Map();
  for (const c of chunks) next.set(`/_vesk/static/${c.name}`, c.code);
  devState.clientChunks = next;
}
async function buildClientChunks() {
  const { routeTree, appDirPath } = devState;
  try {
    const { chunks } = await devMods.generateClientBundle(routeTree, appDirPath, /* @__PURE__ */ new Map(), {
      importRuntime: true,
      hmr: true,
      codeSplit: true
    });
    const next = /* @__PURE__ */ new Map();
    for (const c of chunks) next.set(`/_vesk/static/${c.name}`, c.code);
    devState.clientChunks = next;
    return null;
  } catch (e) {
    return e;
  }
}
function hmrClientJs() {
  const candidates = [
    join2(devState.runtimeDir, "hmr-client.js"),
    join2(devState.runtimeDir, "hmr-client.ts"),
    join2(runtimeDir, "hmr-client.js")
  ];
  for (const p of candidates) {
    if (existsSync2(p)) return readFileSync2(p, "utf-8");
  }
  return "// hmr client unavailable";
}
function richErrorPayload(err2, fullPath, errorMessage) {
  let line = 0, col = 0, file = "";
  const suggestions = [];
  const nextSteps = [];
  let tip = "";
  const errDetails = err2;
  if (errDetails?.name === "VeskError") {
    line = errDetails.line || 0;
    col = errDetails.column || 0;
    file = errDetails.file || fullPath.replace(devState.projectDir, "").replace(/^\//, "") || basename(fullPath) || "";
    if (errDetails.suggestions) suggestions.push(...errDetails.suggestions);
    if (errDetails.nextSteps) nextSteps.push(...errDetails.nextSteps);
    tip = errDetails.tip || "";
  } else {
    const lineMatch = errorMessage.match(/(?:line|at\s+line)\s*(\d+)/i);
    const colMatch = errorMessage.match(/(?:column|col)\s*(\d+)/i);
    line = lineMatch ? parseInt(lineMatch[1]) : 0;
    col = colMatch ? parseInt(colMatch[1]) : 0;
    file = fullPath.replace(devState.projectDir, "").replace(/^\//, "") || basename(fullPath) || "";
  }
  let code = "";
  if (line > 0 && existsSync2(fullPath)) {
    try {
      const src = readFileSync2(fullPath, "utf-8");
      const lines = src.split("\n");
      const start = Math.max(0, line - 3);
      const end = Math.min(lines.length, line + 2);
      code = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
    } catch {
    }
  }
  const tips = [];
  if (tip) tips.push(tip);
  if (errorMessage.toLowerCase().includes("unexpected token")) tips.push("Check for missing or extra brackets, parentheses, or quotes.");
  if (errorMessage.toLowerCase().includes("unexpected identifier")) tips.push("A keyword or identifier is in an unexpected position.");
  if (errorMessage.toLowerCase().includes("expected")) tips.push("Check the syntax around the reported line.");
  if (errorMessage.toLowerCase().includes("not defined") || errorMessage.toLowerCase().includes("is not defined")) tips.push("The variable or component may not be imported or declared.");
  if (errorMessage.toLowerCase().includes("invalid")) tips.push("Check the expression syntax.");
  if (errorMessage.toLowerCase().includes("component") && errorMessage.toLowerCase().includes("not")) tips.push("Ensure the component is properly defined.");
  if (nextSteps.length) tips.push(...nextSteps);
  if (tips.length === 0) tips.push("Review the code around the reported line.");
  return { type: "error", message: errorMessage, file, line, column: col, code, stack: err2?.stack || "", tips, suggestions, nextSteps };
}
async function devInit(params) {
  await loadDevModules();
  const { appDir, projectDir, publicDir, port: port2 } = params;
  devMods.setRuntimeModule(devMods.runtimeServer);
  const config = await loadConfig(projectDir);
  const plugins = config.plugins || [];
  const security = relaxCspForDev(config.security);
  let rateLimiter = null;
  if (security?.rateLimit) {
    const rlConfig = security.rateLimit;
    rateLimiter = devMods.createRateLimiter({ windowMs: rlConfig.windowMs || 6e4, max: rlConfig.max || 100 });
  }
  const { raw, cssPath } = readRawCss(projectDir);
  devState = {
    appDirPath: appDir,
    projectDir,
    publicDir,
    port: port2,
    config,
    plugins,
    security,
    rateLimiter,
    rawCss: raw,
    cssPath,
    routeTree: [],
    clientBundle: "",
    clientChunks: /* @__PURE__ */ new Map(),
    runtimeBundle: "",
    hmrClientJs: "",
    cssGlobal: "",
    cssTailwind: "",
    sourceToComponents: /* @__PURE__ */ new Map(),
    apiWatchCache: /* @__PURE__ */ new Map(),
    ssrDataStore: /* @__PURE__ */ new Map(),
    runtimeDir: resolveRuntimeDir(projectDir) || runtimeDir
  };
  devState.routeTree = devMods.scanRoutes(appDir);
  updateSourceMapping();
  await rebuildTailwindCss();
  await buildClientBundle();
  await bundleRuntime();
  devState.hmrClientJs = hmrClientJs();
  const apiCount = countFilesNamed(join2(appDir, "api"), "route.ts");
  return {
    ok: true,
    routes: collectRoutePaths(devState.routeTree),
    pageCount: countPages(devState.routeTree),
    apiCount,
    runtimeBundle: devState.runtimeBundle,
    clientBundle: devState.clientBundle,
    clientChunks: Object.fromEntries(devState.clientChunks),
    hmrClientJs: devState.hmrClientJs,
    cssGlobal: devState.cssGlobal,
    cssTailwind: devState.cssTailwind,
    rateLimit: security?.rateLimit || null
  };
}
async function devRebuild(params) {
  const state = devState;
  if (!state) return { messages: [] };
  const fullPath = params.filePath || "";
  const filename = basename(fullPath);
  const fileExists = existsSync2(fullPath);
  const messages = [];
  const assets = {};
  const isApiFile = /\/api\//.test(fullPath.replace(/\\/g, "/")) && (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".tsx"));
  if (filename.endsWith(".vsk")) {
    const t0 = Date.now();
    try {
      const stripAnnots = (t) => JSON.stringify(t, (k, v) => k === "chunk" || k === "chunkError" ? void 0 : v);
      const prevTree = stripAnnots(state.routeTree);
      state.routeTree = devMods.scanRoutes(state.appDirPath);
      updateSourceMapping();
      const changedComponents = state.sourceToComponents.get(fullPath) || [];
      const treeChanged = prevTree !== stripAnnots(state.routeTree);
      let bundleError = null;
      if (treeChanged) {
        try {
          await buildClientBundle();
          await bundleRuntime();
        } catch (e) {
          bundleError = e;
        }
      } else {
        const chunkErr = await buildClientChunks();
        if (chunkErr) bundleError = chunkErr;
      }
      if (changedComponents.length > 0) {
        let fnSources;
        let errorMessage = bundleError ? bundleError.message : "";
        if (fileExists && !bundleError) {
          try {
            const src = readFileSync2(fullPath, "utf-8");
            let compCode = devMods.compileClient(src, null, { forceClient: true });
            compCode = compCode.replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?\s*\n?/gm, "");
            compCode = compCode.replace(/^const __components = \{\};\s*\n?/m, "");
            compCode = compCode.replace(/^function __cleanup\(start, end\) \{[\s\S]*?\n\}\s*\n?/m, "");
            compCode = compCode.replace(/^export\s+default\s+__components\[.*?\];?\s*\n?/gm, "");
            compCode = compCode.replace(/^export\s+(const|let|var)\s+\w+\s*=\s*__components\[.*?\];?\s*\n?/gm, "");
            const actualName = devMods.resolveComponentName(src);
            for (const cname of changedComponents) {
              if (actualName && actualName !== cname) {
                compCode += `
Object.defineProperty(__components, ${JSON.stringify(cname)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });
`;
              }
            }
            if (compCode.trim()) fnSources = { _raw: compCode };
          } catch (e) {
            errorMessage = e.message;
          }
        }
        if (fnSources) {
          messages.push({
            type: "update",
            time: Date.now() - t0,
            components: Object.fromEntries(changedComponents.map((name) => [name, true])),
            fnSources
          });
        } else if (errorMessage) {
          messages.push(richErrorPayload(bundleError || new Error(errorMessage), fullPath, errorMessage));
        } else {
          messages.push({ type: "reload" });
        }
      } else {
        messages.push({ type: "reload" });
      }
      await rebuildTailwindCss();
      messages.push({ type: "css-update" });
      assets.clientBundle = state.clientBundle;
      assets.clientChunks = Object.fromEntries(state.clientChunks);
      assets.cssGlobal = state.cssGlobal;
      assets.cssTailwind = state.cssTailwind;
      return { messages, assets };
    } catch (e) {
      messages.push({ type: "error", message: e.message, file: filename });
      return { messages, assets };
    }
  }
  if (filename.endsWith(".css")) {
    if (fileExists) {
      const content = readFileSync2(fullPath, "utf-8");
      if (fullPath === state.cssPath || fullPath.replace(/\\/g, "/") === state.cssPath.replace(/\\/g, "/")) {
        state.rawCss = content;
      }
    }
    await rebuildTailwindCss();
    messages.push({ type: "css-update" });
    assets.cssGlobal = state.cssGlobal;
    assets.cssTailwind = state.cssTailwind;
    return { messages, assets };
  }
  if (isApiFile && fileExists) {
    state.apiWatchCache.set(fullPath, Date.now());
    return { messages, assets };
  }
  if (filename === "vesk.config.ts" || filename === "vesk.config.js" || filename === "tsconfig.json" || filename === "package.json") {
    try {
      const config = await loadConfig(state.projectDir);
      state.config = config;
      state.plugins = config.plugins || [];
      state.security = relaxCspForDev(config.security);
      if (state.security?.rateLimit) {
        const rlConfig = state.security.rateLimit;
        state.rateLimiter = devMods.createRateLimiter({ windowMs: rlConfig.windowMs || 6e4, max: rlConfig.max || 100 });
      } else {
        state.rateLimiter = null;
      }
    } catch (e) {
      messages.push({ type: "error", message: e.message, file: filename });
    }
  }
  state.routeTree = devMods.scanRoutes(state.appDirPath);
  updateSourceMapping();
  await buildClientBundle();
  await bundleRuntime();
  await rebuildTailwindCss();
  messages.push({ type: "reload", reason: `${filename} changed` });
  assets.clientBundle = state.clientBundle;
  assets.clientChunks = Object.fromEntries(state.clientChunks);
  assets.cssGlobal = state.cssGlobal;
  assets.cssTailwind = state.cssTailwind;
  return { messages, assets };
}
var prodState = null;
function prodMatchPath(pattern, pathname) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  let pi = 0, pp = 0;
  const params = {};
  while (pi < pathParts.length && pp < patternParts.length) {
    if (patternParts[pp].startsWith(":")) {
      params[patternParts[pp].slice(1)] = pathParts[pi];
      pi++;
      pp++;
    } else if (patternParts[pp] === pathParts[pi]) {
      pi++;
      pp++;
    } else {
      return null;
    }
  }
  if (pp === patternParts.length && pi === pathParts.length) return params;
  return null;
}
function prodMime(ext) {
  const mime = {
    ".svg": "image/svg+xml",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".html": "text/html",
    ".json": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm"
  };
  return mime[ext] || "application/octet-stream";
}
function prodStaticResponse(filePath) {
  if (!existsSync2(filePath) || !statSync(filePath).isFile()) return null;
  const ext = extname(filePath);
  return { status: 200, headers: [["Content-Type", prodMime(ext)]], bodyB64: readFileSync2(filePath).toString("base64") };
}
async function prodInit(params) {
  await loadDevModules();
  const { outDir, projectDir, port: port2 } = params;
  const configPath = join2(outDir, "config.json");
  if (!existsSync2(configPath)) throw new Error(`no build found at ${outDir}`);
  const buildConfig = JSON.parse(readFileSync2(configPath, "utf-8"));
  let securityConfig = {};
  try {
    const config = await loadConfig(projectDir);
    securityConfig = { security: config.security };
  } catch (e) {
    console.error("prod_init: config load error:", e.message);
  }
  let rateLimiter = null;
  const security = securityConfig.security || {};
  if (security.rateLimit) {
    const rl = security.rateLimit;
    rateLimiter = devMods.createRateLimiter({ windowMs: rl.windowMs || 6e4, max: rl.max || 100 });
  }
  let middlewareMod = null;
  const mwPath = join2(outDir, "server", "middleware.js");
  if (existsSync2(mwPath)) {
    try {
      middlewareMod = await import(`${mwPath}?t=${Date.now()}`);
    } catch (e) {
      console.error("prod_init: middleware load error:", e.message);
    }
  }
  prodState = {
    outDir,
    projectDir,
    port: port2,
    buildConfig,
    securityConfig,
    rateLimiter,
    middlewareMod,
    functionCache: /* @__PURE__ */ new Map()
  };
  const routes = buildConfig.routes || [];
  return {
    ok: true,
    routes: routes.filter((r) => r.type === "ssr").map((r) => r.path),
    pageCount: routes.filter((r) => r.type === "ssr").length,
    apiCount: routes.filter((r) => r.type === "api").length,
    actionCount: (buildConfig.actions || []).length,
    middleware: !!middlewareMod
  };
}
async function prodLoadFunction(funcPath) {
  const state = prodState;
  if (state.functionCache.has(funcPath)) return state.functionCache.get(funcPath);
  const fullPath = resolve2(state.outDir, funcPath);
  if (!existsSync2(fullPath)) return null;
  try {
    const mod = await import(`${fullPath}?t=${Date.now()}`);
    state.functionCache.set(funcPath, mod);
    return mod;
  } catch (e) {
    console.error("prod: load function error", funcPath, e.message);
    return null;
  }
}
async function prodRenderNotFound(urlPath) {
  const state = prodState;
  const appDir = join2(state.projectDir, "app");
  const nfPath = join2(appDir, "not-found.vsk");
  if (!existsSync2(nfPath)) return null;
  try {
    const rtMod = await import(`${join2(state.outDir, "server", "runtime.js")}?t=${Date.now()}`);
    const src = readFileSync2(nfPath, "utf-8");
    const compName = devMods.resolveComponentName(src) || "NotFound";
    return await rtMod.renderFullPage(src, compName, { params: {}, url: urlPath }, /* @__PURE__ */ new Map(), {
      hydrate: true,
      cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
      security: state.securityConfig.security || {},
      sourcePath: nfPath
    });
  } catch (e) {
    console.error("prod: not-found render error:", e.message);
    return null;
  }
}
async function prodRenderError(props) {
  const state = prodState;
  const appDir = join2(state.projectDir, "app");
  const errPath = join2(appDir, "error.vsk");
  if (!existsSync2(errPath)) return null;
  try {
    const rtMod = await import(`${join2(state.outDir, "server", "runtime.js")}?t=${Date.now()}`);
    const src = readFileSync2(errPath, "utf-8");
    const compName = devMods.resolveComponentName(src) || "Error";
    return await rtMod.renderFullPage(src, compName, props, /* @__PURE__ */ new Map(), {
      hydrate: true,
      cssUrls: ["/_vesk/static/_tailwind.css", "/_vesk/static/global.css"],
      security: state.securityConfig.security || {},
      sourcePath: errPath
    });
  } catch (e) {
    console.error("prod: error render error:", e.message);
    return null;
  }
}
async function handleProdRequest(p) {
  const state = prodState;
  if (!state) {
    return { status: 500, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ error: "prod server not initialized" })).toString("base64") };
  }
  const url = new URL(p.url, `http://localhost:${p.port || state.port}`);
  const bodyBuffer = p.bodyB64 ? Buffer.from(p.bodyB64, "base64") : Buffer.alloc(0);
  const req = {
    method: p.method,
    url: url.pathname + url.search,
    headers: p.headers,
    socket: { remoteAddress: p.clientIp || "127.0.0.1" },
    __bodyBuffer: bodyBuffer,
    __clientIp: p.clientIp
  };
  const reqHost = p.headers.host || `localhost:${p.port || state.port}`;
  const security = state.securityConfig.security || {};
  const trustProxy = security.trustProxy;
  const proto = p.headers["x-forwarded-proto"] && trustProxy ? p.headers["x-forwarded-proto"] : "http";
  globalThis.__vesk_ssr_base_url = `${proto}://${reqHost}`;
  const secHeaders = {};
  try {
    const sh = devMods.securityHeaders({ security });
    for (const [k, v] of Object.entries(sh)) secHeaders[k] = v;
  } catch {
  }
  const withSec = (resp) => {
    const seen = new Set(resp.headers.map(([k]) => k.toLowerCase()));
    for (const [k, v] of Object.entries(secHeaders)) {
      if (!seen.has(k.toLowerCase())) resp.headers.push([k, v]);
    }
    return resp;
  };
  if (state.rateLimiter && !state.rateLimiter.check(p.clientIp || "127.0.0.1")) {
    const rl = security.rateLimit || {};
    const retryAfter = Math.ceil((rl.windowMs || 6e4) / 1e3);
    return { status: 429, headers: [["Content-Type", "application/json"], ["Retry-After", String(retryAfter)]], bodyB64: Buffer.from(JSON.stringify({ error: "Too Many Requests" })).toString("base64") };
  }
  const staticDir = join2(state.outDir, "static");
  const publicDir = join2(staticDir, "public");
  const sanitized = url.pathname.replace(/\.\./g, "");
  const rootFile = resolve2(publicDir, sanitized.slice(1));
  if (rootFile.startsWith(publicDir)) {
    const s = prodStaticResponse(rootFile);
    if (s) return withSec(s);
  }
  if (url.pathname === "/ssr-data.js") {
    const token = url.searchParams.get("t") || "";
    const store = globalThis.__vsk_ssr_data_store;
    const payload = store?.[token];
    if (payload) delete store[token];
    const lines = [];
    if (payload?.props) lines.push(`globalThis.__vesk_props = ${JSON.stringify(payload.props)};`);
    if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${JSON.stringify(payload.ssrData)};`);
    return { status: 200, headers: [["Content-Type", "application/javascript"], ["Cache-Control", "no-store"]], bodyB64: Buffer.from(lines.join("\n") || "// no ssr data").toString("base64") };
  }
  if (url.pathname === "/_vesk/runtime.js") {
    const clientPath = join2(staticDir, "client.js");
    const s = prodStaticResponse(clientPath);
    if (s) return withSec(s);
  }
  if (url.pathname.startsWith("/_vesk/static/")) {
    const relPath = url.pathname.replace("/_vesk/static/", "").replace(/\.\./g, "");
    const staticPath = resolve2(staticDir, relPath);
    if (!staticPath.startsWith(staticDir)) {
      return { status: 403, headers: [["Content-Type", "text/plain"]], bodyB64: Buffer.from("Forbidden").toString("base64") };
    }
    const s = prodStaticResponse(staticPath);
    if (s) return withSec(s);
  }
  if (state.buildConfig.prerendered) {
    const prerendered = state.buildConfig.prerendered.find((r) => r.path === url.pathname);
    if (prerendered) {
      const htmlPath = join2(state.outDir, prerendered.file);
      const s = prodStaticResponse(htmlPath);
      if (s) {
        s.headers = s.headers.map(([k, v]) => k === "Content-Type" ? [k, "text/html"] : [k, v]);
        return withSec(s);
      }
    }
  }
  if (state.middlewareMod && state.middlewareMod.execute) {
    const mwCtx = {
      request: new Request(url.href, { headers: p.headers, method: p.method || "GET" }),
      params: {},
      url,
      locals: {},
      cookies: {},
      set(key, value) {
        this.locals[key] = value;
      },
      get(key) {
        return this.locals[key];
      }
    };
    try {
      const mwResult = await state.middlewareMod.execute(mwCtx);
      if (mwResult.response) {
        const body = await mwResult.response.text();
        const headers = [];
        for (const [k, v] of mwResult.response.headers.entries()) headers.push([k, v]);
        return withSec({ status: mwResult.response.status, headers, bodyB64: Buffer.from(body).toString("base64") });
      }
      if (mwResult.rewriteUrl) url.pathname = mwResult.rewriteUrl;
    } catch (e) {
      console.error("prod: middleware error:", e.message);
    }
  }
  if (url.pathname.startsWith("/_vesk/action/")) {
    const actionId = url.pathname.replace("/_vesk/action/", "");
    const actionEntry = state.buildConfig.actions && state.buildConfig.actions.find((a) => a.id === actionId);
    if (!actionEntry) {
      return withSec({ status: 404, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: "Action not found" })).toString("base64") });
    }
    const mod = await prodLoadFunction(actionEntry.function);
    if (!mod || !mod.handleAction) {
      return withSec({ status: 404, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: "Action not found" })).toString("base64") });
    }
    try {
      const webRequest = makeWebRequest(req, url);
      const response = await mod.handleAction(webRequest, actionId);
      const body = await response.text();
      const headers = [];
      for (const [k, v] of response.headers.entries()) headers.push([k, v]);
      return withSec({ status: response.status, headers, bodyB64: Buffer.from(body).toString("base64") });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return withSec({ status: 500, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ ok: false, error: message })).toString("base64") });
    }
  }
  if (url.pathname.startsWith("/api")) {
    for (const route of state.buildConfig.routes) {
      if (route.type === "api") {
        const params = prodMatchPath(route.path, url.pathname);
        if (params) {
          const mod = await prodLoadFunction(route.function);
          if (mod) {
            try {
              const webRequest = makeWebRequest(req, url);
              const response = await mod.handle(webRequest);
              const body = await response.text();
              const headers = [];
              for (const [k, v] of response.headers.entries()) headers.push([k, v]);
              return withSec({ status: response.status, headers, bodyB64: Buffer.from(body).toString("base64") });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              return withSec({ status: 500, headers: [["Content-Type", "application/json"]], bodyB64: Buffer.from(JSON.stringify({ error: message })).toString("base64") });
            }
          }
        }
      }
    }
  }
  let notFoundHtml = null;
  try {
    notFoundHtml = await prodRenderNotFound(url.pathname);
  } catch {
  }
  for (const route of state.buildConfig.routes) {
    if (route.type === "ssr") {
      const params = prodMatchPath(route.path, url.pathname);
      if (params) {
        const mod = await prodLoadFunction(route.function);
        if (mod) {
          try {
            const webRequest = makeWebRequest(req, url);
            let cachedResult = null;
            if (route.revalidate && route.revalidate > 0) {
              cachedResult = await devMods.runtimeServer.pageIsr(url.pathname, async () => {
                const response2 = await mod.handle(webRequest);
                return { html: await response2.text(), headers: Object.fromEntries(response2.headers) };
              }, { revalidate: route.revalidate, tags: route.tags || [] });
            }
            if (cachedResult) {
              const headers2 = Object.entries(cachedResult.headers || { "Content-Type": "text/html" });
              return withSec({ status: 200, headers: headers2, bodyB64: Buffer.from(cachedResult.html).toString("base64") });
            }
            const response = await mod.handle(webRequest);
            const headers = Object.fromEntries(response.headers);
            if (!headers["content-type"] && !headers["Content-Type"]) headers["Content-Type"] = "text/html";
            const body = await response.text();
            return withSec({ status: response.status, headers: Object.entries(headers), bodyB64: Buffer.from(body).toString("base64") });
          } catch (e) {
            const err2 = e instanceof Error ? e : new Error(String(e));
            if (err2.name === "NotFoundError") {
              return withSec({ status: 404, headers: [["Content-Type", "text/html"]], bodyB64: Buffer.from(notFoundHtml || "<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>").toString("base64") });
            }
            console.error("haul ssr error:", err2.message);
            let errorHtml = null;
            try {
              errorHtml = await prodRenderError({ error: err2.message, stack: err2.stack, statusCode: 500, url: url.pathname });
            } catch {
            }
            return withSec({ status: 500, headers: [["Content-Type", "text/html"]], bodyB64: Buffer.from(errorHtml || "<!DOCTYPE html><html><body><h1>500</h1><pre>Internal Server Error</pre></body></html>").toString("base64") });
          }
        }
      }
    }
  }
  return withSec({ status: 404, headers: [["Content-Type", "text/html"]], bodyB64: Buffer.from(notFoundHtml || "<!DOCTYPE html><html><body><h1>404</h1><p>Not Found</p></body></html>").toString("base64") });
}
var server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.method === "GET" && req.url === "/runtime.js") {
    const candidates = [
      resolve2(runtimeDir, "index-client.js"),
      resolve2(runtimeDir, "index-server.js")
    ];
    for (const p of candidates) {
      if (existsSync2(p)) return serveStatic(req, res, p, "application/javascript");
    }
    res.writeHead(404);
    res.end("runtime not found");
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let rpcReq;
    try {
      rpcReq = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("invalid json");
      return;
    }
    const respond = (response) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    };
    (async () => {
      try {
        await ensureModules();
        switch (rpcReq.method) {
          case "compile_client": {
            const { source, filePath, options } = rpcReq.params[0] || {};
            const code = compileClient2(source, filePath || null, options || { forceClient: true });
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { code } });
            return;
          }
          case "compile_server": {
            const { source, filePath, options } = rpcReq.params[0] || {};
            const code = compileServer(source, filePath || null, options || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { code } });
            return;
          }
          case "compile_middleware_code": {
            const { sources } = rpcReq.params[0] || {};
            const parts = [];
            for (let i = 0; i < (sources || []).length; i++) {
              const extracted = extractMiddlewareParts(sources[i]);
              if (!extracted) continue;
              parts.push(`async function mw_${i}(${extracted.params}) {
${extracted.body}
}`);
            }
            if (parts.length === 0) {
              respond({ jsonrpc: "2.0", id: rpcReq.id, result: { code: null } });
              return;
            }
            const code = [
              "// \u2500\u2500 Middleware chain (inline) \u2500\u2500",
              "",
              parts.join("\n\n"),
              "",
              `const __mwChain = [${parts.map((_, i) => `mw_${i}`).join(", ")}];`,
              "",
              "async function __executeMw(ctx) {",
              "  let rewriteUrl = null;",
              "  async function run(index) {",
              "    if (index >= __mwChain.length) return null;",
              "    const fn = __mwChain[index];",
              "    let nc = false;",
              "    async function next(rewrite) {",
              "      if (nc) return null;",
              "      nc = true;",
              "      if (rewrite) rewriteUrl = rewrite;",
              "      return run(index + 1);",
              "    }",
              "    const result = await fn(ctx, next);",
              "    if (result instanceof Response) return result;",
              "    if (!nc) return run(index + 1);",
              "    return null;",
              "  }",
              "  const response = await run(0);",
              "  return { response, rewriteUrl };",
              "}",
              ""
            ].join("\n");
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { code } });
            return;
          }
          case "generate_dts": {
            const { source, filePath } = rpcReq.params[0] || {};
            const dts = generateVskDts(source, filePath || null);
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { dts } });
            return;
          }
          case "vsk_to_tsx": {
            const { source } = rpcReq.params[0] || {};
            const tsx = vskToTsx(source);
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { tsx } });
            return;
          }
          case "typecheck": {
            const { projectRoot, strict } = rpcReq.params[0];
            const root = projectRoot || process.cwd();
            const diagnostics = typecheckProject(root, { strict: strict ?? true });
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { diagnostics } });
            return;
          }
          case "resolve_runtime": {
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { compilerDir, runtimeDir } });
            return;
          }
          case "scan_routes": {
            const { appDir } = rpcReq.params[0] || {};
            const routes = scanRoutes(appDir);
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { routes } });
            return;
          }
          case "scan_api_routes": {
            const { apiDir } = rpcReq.params[0] || {};
            const routes = scanApiRoutes(apiDir);
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { routes } });
            return;
          }
          case "collect_action_ids": {
            const { paths } = rpcReq.params[0] || {};
            const actionsMod = await import("@vesk/compiler/src/actions");
            const ids = [];
            const seen = /* @__PURE__ */ new Set();
            for (const p of paths || []) {
              if (!existsSync2(p)) continue;
              try {
                const src = readFileSync2(p, "utf-8");
                for (const id of actionsMod.collectActionIds(src)) {
                  if (!seen.has(id)) {
                    seen.add(id);
                    ids.push(id);
                  }
                }
              } catch (e) {
                console.error("collect_action_ids error for", p, e.message);
              }
            }
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { ids } });
            return;
          }
          case "on_css": {
            const { cssContent, filePath, projectDir } = rpcReq.params[0] || {};
            const result = await processCssWithPlugins(cssContent, filePath, projectDir);
            respond({ jsonrpc: "2.0", id: rpcReq.id, result: { css: result } });
            return;
          }
          case "dev_init": {
            const result = await devInit(rpcReq.params[0] || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result });
            return;
          }
          case "dev_render": {
            const result = await handleDevRequest(rpcReq.params[0] || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result });
            return;
          }
          case "dev_rebuild": {
            const result = await devRebuild(rpcReq.params[0] || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result });
            return;
          }
          case "prod_init": {
            const result = await prodInit(rpcReq.params[0] || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result });
            return;
          }
          case "prod_render": {
            const result = await handleProdRequest(rpcReq.params[0] || {});
            respond({ jsonrpc: "2.0", id: rpcReq.id, result });
            return;
          }
          default:
            console.log("sidecar: unknown method", rpcReq.method);
            respond(err(rpcReq.id, `unknown method: ${rpcReq.method}`));
        }
      } catch (e) {
        console.error("sidecar error:", e);
        respond(err(rpcReq.id, e instanceof Error ? e.message : String(e)));
      }
    })();
  });
});
var port = process.env.VESK_SIDECAR_PORT ? Number(process.env.VESK_SIDECAR_PORT) : 0;
server.listen(port, () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  console.log(JSON.stringify({ port: actualPort }));
});
