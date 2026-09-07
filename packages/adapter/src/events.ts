import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as esbuild from './esbuild-fallback.js';
import { collectEventsFile } from '@vesk/compiler/src/events';

let buildId = 0;

/**
 * Wrapper module bundled into `server/events.js`. It lifts the user's
 * `_events.ts` exports into `executeStart` / `executeRequest` / `executeStop`
 * entry points with a context that routes `set`/`get` into the process-wide
 * server context (`globalThis.__vesk_server_ctx`).
 *
 * The `__vesk_events_started` guard is global (not module-local) so lazy edge
 * isolates and the Node prod server share one lifetime; `onStop` clears it so
 * dev HMR reloads can boot a fresh module.
 */
function buildEntry(sourcePath: string): string {
  return [
    `import * as __events from ${JSON.stringify(sourcePath)};`,
    '',
    'const __store = () => (globalThis.__vesk_server_ctx ||= {});',
    '',
    'const __handlers = {};',
    "for (const __name of ['onStart', 'onRequest', 'onStop']) {",
    '  const __fn = __events[__name];',
    "  if (typeof __fn === 'function') __handlers[__name] = __fn;",
    '}',
    '',
    'function __makeCtx(base) {',
    '  const store = __store();',
    '  const start = base && typeof base === \'object\' ? base : {};',
    '  return Object.assign({}, start, {',
    '    server: start.server !== undefined ? start.server : null,',
    '    port: start.port !== undefined ? start.port : 0,',
    '    host: start.host,',
    '    serverLocals: store,',
    '    set(key, value) { store[key] = value; return value; },',
    '    get(key) { return store[key]; },',
    '  });',
    '}',
    '',
    'export async function executeStart(base) {',
    '  if (globalThis.__vesk_events_started) return;',
    '  globalThis.__vesk_events_started = true;',
    '  if (typeof __handlers.onStart === \'function\') await __handlers.onStart(__makeCtx(base));',
    '}',
    '',
    'export async function executeRequest(base) {',
    '  if (typeof __handlers.onRequest !== \'function\') return;',
    '  await __handlers.onRequest(__makeCtx(base));',
    '}',
    '',
    'export async function executeStop(base) {',
    '  if (typeof __handlers.onStop !== \'function\') return;',
    '  try {',
    '    await __handlers.onStop(__makeCtx(base));',
    '  } finally {',
    '    globalThis.__vesk_events_started = false;',
    '  }',
    '}',
    '',
    'export const onStart = __handlers.onStart;',
    'export const onRequest = __handlers.onRequest;',
    'export const onStop = __handlers.onStop;',
    '',
  ].join('\n');
}

/**
 * Compile the app's `_events.ts` (if present) into a self-contained
 * `server/events.js` next to the server runtime. Returns true when an events
 * file existed and was compiled. Relative imports inside `_events.ts` are
 * bundled by esbuild; node builtins stay external so node (prod-server) and
 * edge (platform handler) can both resolve them.
 */
export async function compileEvents(appDir: string, outDir: string): Promise<boolean> {
  const sourcePath = collectEventsFile(appDir);
  if (!sourcePath) return false;

  const serverDir = resolve(outDir, 'server');
  mkdirSync(serverDir, { recursive: true });
  const entryFile = resolve(serverDir, `.events-entry-${buildId++}.mjs`);
  writeFileSync(entryFile, buildEntry(sourcePath), 'utf-8');

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      platform: 'neutral' as const,
      format: 'esm',
      minify: true,
      outfile: resolve(serverDir, 'events.js'),
      external: ['fs', 'node:fs', 'path', 'node:path', 'module', 'node:module', 'node:async_hooks'],
      target: ['es2022'],
      treeShaking: true,
    });

    if (result.errors.length > 0) {
      throw new Error(`esbuild errors: ${result.errors.map((e: { text: string }) => e.text).join(', ')}`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.error('vesk build warning:', w.text);
    }

    return true;
  } finally {
    try { unlinkSync(entryFile); } catch { /* ignore */ }
  }
}