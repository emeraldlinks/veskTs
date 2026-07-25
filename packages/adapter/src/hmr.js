import { WebSocketServer } from 'ws';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findCompilerApi(appDir) {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const monorepoCompiler = resolve(monorepoRoot, 'packages', 'compiler', 'src');
  if (existsSync(monorepoCompiler)) return monorepoCompiler;
  const projectCompiler = resolve(appDir, '..', 'node_modules', '@vesk/compiler', 'src');
  if (existsSync(projectCompiler)) return projectCompiler;
  return resolve(appDir, 'node_modules', '@vesk/compiler', 'src');
}

function findRouteForSource(routeTree, sourceDir) {
  for (const node of routeTree) {
    if (node.sourceDir === sourceDir) return node;
    if (node.children) {
      const found = findRouteForSource(node.children, sourceDir);
      if (found) return found;
    }
  }
  return null;
}

function extractComponentAssignments(code) {
  const assignments = [];
  const startRegex = /__components\["(\w+)"\]\s*=\s*/;
  const lines = code.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(startRegex);
    if (m) {
      const name = m[1];
      const startIdx = i;
      let braceDepth = 0;
      for (let j = 0; j < lines[i].length; j++) {
        if (lines[i][j] === '{') braceDepth++;
        if (lines[i][j] === '}') braceDepth--;
      }
      i++;
      while (i < lines.length && braceDepth > 0) {
        for (let j = 0; j < lines[i].length; j++) {
          if (lines[i][j] === '{') braceDepth++;
          if (lines[i][j] === '}') braceDepth--;
        }
        i++;
      }
      const fullAssignment = lines.slice(startIdx, i).join('\n');
      assignments.push({ name, raw: fullAssignment });
    } else {
      i++;
    }
  }
  return assignments;
}

function extractSourceDir(filename) {
  if (filename === 'page.vsk') return '';
  if (filename.endsWith('/page.vsk')) return filename.slice(0, -'/page.vsk'.length);
  if (filename === 'layout.vsk') return '';
  if (filename.endsWith('/layout.vsk')) return filename.slice(0, -'/layout.vsk'.length);
  return null;
}

function escapeSource(src) {
  return src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function extractCompName(src) {
  const m = src.match(/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/m);
  return m ? m[1] : null;
}

function routeName(segments) {
  const parts = segments.filter(Boolean).map(s => {
    if (s.startsWith(':')) return s.slice(1) || 'param';
    return s;
  });
  return parts.join('_') || 'index';
}

function buildParamExtraction(node, urlParts) {
  const parts = [];
  let partIdx = 0;
  function walk(n) {
    if (n.fullPath === '/') { for (const child of (n.children || [])) walk(child); return; }
    if (n.isGroup) { for (const child of (n.children || [])) walk(child); return; }
    if (partIdx >= urlParts.length) return;
    if (n.isCatchAll) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'slug';
      parts.push(`${JSON.stringify(paramName)}: urlParts.slice(${partIdx}).join('/')`);
      partIdx = urlParts.length; return;
    }
    if (n.isDynamic) {
      const paramName = n.path.startsWith(':') ? n.path.slice(1) : 'param';
      parts.push(`${JSON.stringify(paramName)}: urlParts[${partIdx}]`);
      partIdx++;
      for (const child of (n.children || [])) walk(child); return;
    }
    if (n.path === urlParts[partIdx]) { partIdx++; for (const child of (n.children || [])) walk(child); }
  }
  walk(node);
  return parts;
}

function regenerateSsrFunction(routeNode, appDir, outDir, componentMap = new Map()) {
  const pagePath = resolve(appDir, routeNode.sourceDir, 'page.vsk');
  const layoutPath = resolve(appDir, routeNode.sourceDir, 'layout.vsk');
  const globalCssPath = resolve(appDir, '..', 'src', 'global.css');
  const altCssPath = resolve(appDir, '..', 'src', 'app.css');
  const hasGlobalCss = existsSync(globalCssPath) || existsSync(altCssPath);
  const cssOption = hasGlobalCss ? ', cssUrl: "/_vesk/static/global.css"' : '';
  const parts = routeNode.fullPath.split('/').filter(Boolean);
  const name = routeName(parts);
  const funcDir = resolve(outDir, 'server', 'functions');
  const funcPath = resolve(funcDir, `${name}.js`);
  const hasLayout = routeNode.layout;
  const pageSrc = readFileSync(pagePath, 'utf-8');
  const pageComp = extractCompName(pageSrc) || 'Page';
  let src = '';
  if (hasLayout) {
    const layoutSrc = readFileSync(layoutPath, 'utf-8');
    const layoutComp = extractCompName(layoutSrc) || 'Layout';
    src = `const _layoutSrc = \`${escapeSource(layoutSrc)}\`;\nconst _pageSrc = \`${escapeSource(pageSrc)}\`;\n`;
    src += `const _layoutComp = ${JSON.stringify(layoutComp)};\nconst _pageComp = ${JSON.stringify(pageComp)};\n`;
  } else {
    src = `const _src = \`${escapeSource(pageSrc)}\`;\nconst _comp = ${JSON.stringify(pageComp)};\n`;
  }
  const urlParts = routeNode.fullPath.split('/').filter(Boolean);
  const paramExprs = buildParamExtraction(routeNode, urlParts);
  const paramsCode = paramExprs.length > 0 ? `const params = { ${paramExprs.join(', ')} };\n` : 'const params = {};\n';

  // Build registry for external components
  let registryCode = '';
  const compRegEntries = [];
  for (const [compName, compPath] of componentMap) {
    const src = readFileSync(compPath, 'utf-8');
    const escapedSrc = escapeSource(src);
    compRegEntries.push(`  registry.set(${JSON.stringify(compName)}, async (props, __registry, __vesk) => {\n    const _src = \`${escapedSrc}\`;\n    const _comp = ${JSON.stringify(compName)};\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true });\n    return result.body;\n  })`);
  }
  if (compRegEntries.length > 0) {
    registryCode = `const __componentRegistry = new Map();\n{\n${compRegEntries.join('\n')}\n}\n`;
  } else {
    registryCode = 'const __componentRegistry = new Map();\n';
  }

  const funcCode = [
    `import { renderFullPage, renderPage } from '../runtime.js';`,
    ``, registryCode, src, ``,
    `export async function handle(request) {`,
    `  const url = new URL(request.url);`,
    `  const urlParts = url.pathname.split('/').filter(Boolean);`,
    `  ${paramsCode}`,
    hasLayout ? [
      `  const page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true });`,
      `  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: page.body }, __componentRegistry, { hydrate: true${cssOption}, pageHead: page.head });`,
      `  return new Response(html, { headers: { 'Content-Type': 'text/html' } });`,
    ].join('\n') : [
      `  const html = await renderFullPage(_src, _comp, { params }, __componentRegistry, { hydrate: true${cssOption} });`,
      `  return new Response(html, { headers: { 'Content-Type': 'text/html' } });`,
    ].join('\n'),
    `}`,
  ].join('\n');
  writeFileSync(funcPath, funcCode, 'utf-8');
}

export function createHmrServer(httpServer, appDir, devDir, componentMap = new Map()) {
  const wss = new WebSocketServer({ server: httpServer, path: '/_vesk/hmr' });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, ...data });
    for (const ws of clients) {
      try { ws.send(msg); } catch { clients.delete(ws); }
    }
  }

  async function handleFileChange(filename, doFullBuild, routeTree) {
    if (!filename) return;

    broadcast('compiling');

    // --- .vsk file changes — incremental ---
    if (filename.endsWith('.vsk')) {
      const sourceDir = extractSourceDir(filename);
      const compilerRoot = findCompilerApi(appDir);
      const { compileClient } = await import(resolve(compilerRoot, 'client-codegen.js'));

      const fullPath = resolve(appDir, filename);
      if (!existsSync(fullPath)) return;

      try {
        const start = Date.now();
        const src = readFileSync(fullPath, 'utf-8');
        const code = compileClient(src, null, { hydrate: true, forceClient: true });
        const assignments = extractComponentAssignments(code);

        if (assignments.length > 0) {
          const isLayout = filename === 'layout.vsk' || filename.endsWith('/layout.vsk');
          const isPage = filename === 'page.vsk' || filename.endsWith('/page.vsk');
          for (const { name, raw } of assignments) {
            broadcast('component-update', {
              name,
              fnSource: raw,
              kind: isLayout ? 'layout' : (isPage ? 'page' : 'component'),
              time: Date.now() - start,
            });
          }
        }

        // Only regenerate SSR function for page/layout files
        if (sourceDir !== null) {
          const routeNode = findRouteForSource(routeTree, sourceDir);
          if (routeNode) {
            regenerateSsrFunction(routeNode, appDir, devDir, componentMap);
          }
        }

        console.error(`vesk hmr: ${assignments.map(a => a.name).join(', ')} (${Date.now() - start}ms)`);
      } catch (e) {
        broadcast('error', { message: e.message, file: filename });
        console.error(`vesk hmr: error — ${e.message}`);
      }
      return;
    }

    // --- API route changes (.ts/.js in app/api/) ---
    if (filename.includes('/api/') && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('full-reload', { reason: `API: ${filename}`, time: Date.now() - start });
        console.error(`vesk hmr: api ${filename} rebuilt (${Date.now() - start}ms)`);
      } catch (e) {
        broadcast('error', { message: e.message, file: filename });
      }
      return;
    }

    // --- Middleware changes (middleware.ts) ---
    if (filename === 'middleware.ts' || filename.endsWith('/middleware.ts')) {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('full-reload', { reason: `Middleware: ${filename}`, time: Date.now() - start });
        console.error(`vesk hmr: middleware ${filename} rebuilt (${Date.now() - start}ms)`);
      } catch (e) {
        broadcast('error', { message: e.message, file: filename });
      }
      return;
    }

    // --- Config changes (vesk.config.ts, tsconfig.json, etc.) ---
    if (filename === 'vesk.config.ts' || filename === 'vesk.config.js' ||
        filename === 'tsconfig.json' || filename === 'package.json') {
      const start = Date.now();
      try {
        await doFullBuild();
        broadcast('full-reload', { reason: `Config: ${filename}`, time: Date.now() - start });
        console.error(`vesk hmr: ${filename} rebuilt (${Date.now() - start}ms)`);
      } catch (e) {
        broadcast('error', { message: e.message, file: filename });
      }
      return;
    }

    // --- Fallback: full rebuild ---
    const start = Date.now();
    try {
      await doFullBuild();
      broadcast('full-reload', { reason: `${filename} changed`, time: Date.now() - start });
    } catch (e) {
      broadcast('error', { message: e.message, file: filename });
    }
  }

  return { broadcast, handleFileChange };
}
