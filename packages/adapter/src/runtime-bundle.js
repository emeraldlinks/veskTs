import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

let buildId = 0;

const __dirname = dirname(fileURLToPath(import.meta.url));

function findCompilerSrc(appDir) {
  // Try monorepo layout first (adapter is at packages/adapter, compiler at packages/compiler)
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const monorepoCompiler = resolve(monorepoRoot, 'packages', 'compiler', 'src');
  if (existsSync(monorepoCompiler)) return monorepoCompiler;

  // Try project's node_modules
  const projectCompiler = resolve(appDir, '..', 'node_modules', '@vesk/compiler', 'src');
  if (existsSync(projectCompiler)) return projectCompiler;

  // Try app's own node_modules (for when appDir is the root)
  const appCompiler = resolve(appDir, 'node_modules', '@vesk/compiler', 'src');
  if (existsSync(appCompiler)) return appCompiler;

  throw new Error('@vesk/compiler/src not found — tried monorepo layout and node_modules');
}

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

export async function bundleRuntime(appDir, outDir) {
  const compilerRoot = findCompilerSrc(appDir);
  const runtimeRoot = findRuntimeSrc(appDir);

  const entryFile = resolve(outDir, 'server', `.runtime-entry-${buildId++}.mjs`);
  const entryContent = [
    `import { renderPage, renderFullPage, renderPageStream, setRuntimeModule } from ${JSON.stringify(resolve(compilerRoot, 'server-codegen.js'))};`,
    `import { parseCookies } from ${JSON.stringify(resolve(compilerRoot, 'api-routes.js'))};`,
    `import * as __veskRuntime from ${JSON.stringify(resolve(runtimeRoot, 'index-server.js'))};`,
    ``,
    `// Inject runtime module so server-codegen can find components like NavLink, Link, etc.`,
    `setRuntimeModule(__veskRuntime);`,
    ``,
    `// Server-side runtime hooks — read from globalThis.__vesk_request`,
    `export function cookies() {`,
    `  const req = globalThis.__vesk_request;`,
    `  if (!req) return { get: () => null, getAll: () => [], set: () => {}, delete: () => {} };`,
    `  const c = req.cookies || {};`,
    `  return {`,
    `    get: (name) => c[name] || null,`,
    `    getAll: () => Object.entries(c).map(([n, v]) => ({ name: n, value: v })),`,
    `    set: () => {},`,
    `    delete: () => {},`,
    `  };`,
    `}`,
    ``,
    `export function headers() {`,
    `  const req = globalThis.__vesk_request;`,
    `  if (!req) return new Map();`,
    `  const h = req.headers || {};`,
    `  const m = new Map();`,
    `  for (const [k, v] of Object.entries(h)) m.set(k.toLowerCase(), String(v));`,
    `  m.get = m.get.bind(m);`,
    `  m.has = m.has.bind(m);`,
    `  m.forEach = m.forEach.bind(m);`,
    `  return m;`,
    `}`,
    ``,
    `export function locals() {`,
    `  const req = globalThis.__vesk_request;`,
    `  if (!req) return {};`,
    `  return req.locals || {};`,
    `}`,
    ``,
    `export { renderPage, renderFullPage, renderPageStream, parseCookies };

// Re-export runtime classes used by API routes
export const VeskRequest = __veskRuntime.VeskRequest;
export const VeskResponse = __veskRuntime.VeskResponse;`,
  ].join('\n');
  writeFileSync(entryFile, entryContent, 'utf-8');

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      minify: true,
      outfile: resolve(outDir, 'server', 'runtime.js'),
      external: ['module', 'node:module', 'fs', 'node:fs', 'path', 'node:path', 'crypto', 'node:crypto'],
      target: ['es2022'],
      treeShaking: true,
    });

    if (result.errors.length > 0) {
      throw new Error(`esbuild errors: ${result.errors.map(e => e.text).join(', ')}`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.error('vesk build warning:', w.text);
    }

    return resolve(outDir, 'server', 'runtime.js');
  } finally {
    try { unlinkSync(entryFile); } catch {}
  }
}
