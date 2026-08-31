/**
 * @vesk/agentic — Vesk-native tools
 *
 * Zero-deps, node:fs-only tools routed through the Dev Server capability gate.
 * All file access is containment-checked via a local `resolveWithin` helper.
 * Every `execute` returns a JSON string (never throws).
 *
 * Export: `createVeskTools(deps)` -> Tool[] (14 tools, covering the
 * `plans/devtools.md` Vesk-Native Agent Tools list).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import type { Tool } from '../loop.js';
import { createCheckpoint as createCheckpointImpl, rollback as rollbackImpl, getCheckpoint as getCheckpointImpl } from '../checkpoints.js';

// ──────────────────────────────────────────────────────────────────────────────
// helpers — containment + state
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `relPath` against `baseDir` and return the absolute path ONLY if
 * it stays strictly inside `baseDir`. Returns null otherwise.
 * Local copy so this module stays zero-deps (no import from @vesk/adapter).
 */
function resolveWithin(baseDir: string, relPath: string): string | null {
  const base = resolve(baseDir);
  const target = resolve(baseDir, relPath);
  const prefix = base + sep;
  if (target === base || !target.startsWith(prefix)) return null;
  return target;
}

interface PluginEntry {
  name: string;
  package: string;
  active: boolean;
}

interface PluginStateFile {
  version: 1;
  plugins: PluginEntry[];
}

const PLUGIN_STATE_FILENAME = 'plugins.json';

function stateFilePath(veskDir: string): string {
  return resolve(veskDir, PLUGIN_STATE_FILENAME);
}

function readPluginState(veskDir: string): PluginStateFile {
  const file = stateFilePath(veskDir);
  if (!existsSync(file)) return { version: 1, plugins: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return { version: 1, plugins: [] };
    if ((raw as { version?: unknown }).version !== 1) return { version: 1, plugins: [] };
    if (!Array.isArray((raw as { plugins?: unknown }).plugins)) return { version: 1, plugins: [] };
    const plugins = ((raw as { plugins: unknown[] }).plugins).filter(
      (p): p is PluginEntry =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as Record<string, unknown>).name === 'string' &&
        typeof (p as Record<string, unknown>).package === 'string' &&
        typeof (p as Record<string, unknown>).active === 'boolean',
    );
    return { version: 1, plugins };
  } catch {
    return { version: 1, plugins: [] };
  }
}

function writePluginState(veskDir: string, state: PluginStateFile): void {
  const file = stateFilePath(veskDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

function eqIgnoreCase(a: string, b: string): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function validatePackageSpec(pkg: string): string | null {
  if (typeof pkg !== 'string' || pkg.trim().length === 0) return 'package spec is empty';
  if (pkg !== pkg.trim()) return 'package spec must not have leading/trailing whitespace';
  if (/\s/.test(pkg)) return 'package spec must not contain spaces';
  if (pkg.includes('..')) return 'package spec must not contain ".."';
  if (/[\/\\][\/\\]/.test(pkg)) return 'invalid package spec';
  return null;
}

function findConfigFile(projectDir: string): { path: string | null; isTs: boolean } {
  const ts = resolve(projectDir, 'vesk.config.ts');
  if (existsSync(ts)) return { path: ts, isTs: true };
  const js = resolve(projectDir, 'vesk.config.js');
  if (existsSync(js)) return { path: js, isTs: false };
  return { path: null, isTs: false };
}

function checkpointDir(veskDir: string): string {
  return join(resolve(veskDir), 'checkpoints');
}

function tryParseJson<T>(v: unknown, fallback: T): T {
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

// Minimal key/value patch for vesk.config.ts — mirrors applyConfigToggle shape
// but implemented without importing compiler helpers (zero deps).
function findMatchingBrace(src: string, openIdx: number): number {
  let inStr: string | null = null;
  let esc = false;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function applySimpleConfigToggle(source: string, key: string, value: unknown): string | null {
  if (typeof key !== 'string' || !key) return null;
  if (/^[a-zA-Z_$][\w$]*$/.test(key) === false) return null;
  const marker = 'defineConfig(';
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const openBrace = source.indexOf('{', idx + marker.length);
  if (openBrace === -1) return null;
  const end = findMatchingBrace(source, openBrace);
  if (end === -1) return null;
  // Try to parse inner object via naive detection — if it contains `=` assignment bail to source-editor path
  const inner = source.slice(openBrace + 1, end);
  if (inner.includes('=') && inner.includes(':') === false) return null;
  // Replace or insert key
  // Look for existing key: `${key}:` or `${key} :` — without regex use indexOf
  // Search for `"key"` / `'key'` / bare key
  const candidates = [`${key}:`, `${key} :`, `"${key}":`, `'${key}':`, `"${key}" :`, `'${key}' :`];
  let existingStart = -1;
  let existingEnd = -1;
  for (const cand of candidates) {
    const pos = inner.indexOf(cand);
    if (pos !== -1) {
      existingStart = pos;
      // find end of value (until comma or end)
      let depth = 0;
      let inS: string | null = null;
      let esc2 = false;
      let j = pos + cand.length;
      while (j < inner.length) {
        const ch = inner[j];
        if (inS) {
          if (esc2) { esc2 = false; j++; continue; }
          if (ch === '\\') { esc2 = true; j++; continue; }
          if (ch === inS) inS = null;
          j++; continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inS = ch; j++; continue; }
        if (ch === '{' || ch === '[' || ch === '(') { depth++; j++; continue; }
        if (ch === '}' || ch === ']' || ch === ')') { depth = Math.max(0, depth - 1); j++; continue; }
        if (ch === ',' && depth === 0) { existingEnd = j; break; }
        j++;
      }
      if (existingEnd === -1) existingEnd = inner.length;
      break;
    }
  }
  const serialized = JSON.stringify(value);
  if (existingStart !== -1 && existingEnd !== -1) {
    const before = inner.slice(0, existingStart);
    const after = inner.slice(existingEnd);
    const keyPart = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    const newInner = before + `${keyPart}: ${serialized}` + after;
    return source.slice(0, openBrace + 1) + newInner + source.slice(end);
  }
  // Insert new key
  const trimmedInner = inner.trim();
  const prefix = trimmedInner ? ', ' : ' ';
  const keyPart = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
  const insertion = `${prefix}${keyPart}: ${serialized} `;
  return source.slice(0, end) + insertion + source.slice(end);
}

// ──────────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────────

export interface VeskToolsDeps {
  projectDir: string;
  appDir: string;
  veskDir: string;
  readConfig?: () => unknown | Promise<unknown>;
  getDiagnostics?: () => unknown[] | Promise<unknown[]>;
  runBuild?: () => Promise<unknown>;
  runTests?: () => Promise<unknown>;
}

function jsonOk(data: unknown): string {
  return JSON.stringify(data);
}

function jsonError(message: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, error: message, ...(extra || {}) });
}

export function createVeskTools(deps: VeskToolsDeps): Tool[] {
  const projectDir = resolve(deps.projectDir);
  const appDir = resolve(deps.appDir);
  const veskDir = resolve(deps.veskDir);

  const tools: Tool[] = [
    // 1. vesk.inspectProject
    {
      name: 'vesk.inspectProject',
      description: 'Inspect Vesk project structure: project/app/.vesk dirs, config file, package.json, plugins, diagnostics summary. Read-only.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          const projExists = existsSync(projectDir);
          const projEntries: string[] = projExists ? readdirSync(projectDir, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name)) : [];
          const appExists = existsSync(appDir);
          const appEntries: string[] = appExists ? readdirSync(appDir, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name)) : [];
          const veskExists = existsSync(veskDir);
          const veskEntries: string[] = veskExists ? readdirSync(veskDir, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name)) : [];
          const cfgInfo = findConfigFile(projectDir);
          let configSource: string | null = null;
          let configExists = false;
          if (cfgInfo.path && existsSync(cfgInfo.path)) {
            configExists = true;
            try { configSource = readFileSync(cfgInfo.path, 'utf-8').slice(0, 8000); } catch { configSource = null; }
          }
          let packageJson: Record<string, unknown> | null = null;
          const pkgPath = resolve(projectDir, 'package.json');
          if (existsSync(pkgPath)) {
            try { packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>; } catch { packageJson = null; }
          }
          let plugins: PluginEntry[] = [];
          try { plugins = readPluginState(veskDir).plugins; } catch { plugins = []; }
          let diagnostics: unknown[] = [];
          if (typeof deps.getDiagnostics === 'function') {
            try { const d = await Promise.resolve(deps.getDiagnostics()); diagnostics = Array.isArray(d) ? d : []; } catch { diagnostics = []; }
          }
          let configParsed: unknown = null;
          if (typeof deps.readConfig === 'function') {
            try { configParsed = await Promise.resolve(deps.readConfig()); } catch { configParsed = null; }
          }
          return jsonOk({
            ok: true,
            projectDir,
            appDir,
            veskDir,
            projectExists: projExists,
            appExists,
            veskExists,
            projectEntries: projEntries.slice(0, 200),
            appEntries: appEntries.slice(0, 200),
            veskEntries: veskEntries.slice(0, 200),
            configPath: cfgInfo.path,
            configExists,
            configSource,
            config: configParsed,
            packageJson: packageJson
              ? {
                  name: packageJson.name ?? null,
                  version: packageJson.version ?? null,
                  dependencies: packageJson.dependencies ? Object.keys(packageJson.dependencies as Record<string, unknown>) : [],
                  devDependencies: packageJson.devDependencies ? Object.keys(packageJson.devDependencies as Record<string, unknown>) : [],
                }
              : null,
            plugins,
            diagnosticsCount: diagnostics.length,
            diagnostics: diagnostics.slice(0, 20),
          });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 2. vesk.inspectComponent
    {
      name: 'vesk.inspectComponent',
      description: 'Inspect a single component/source file by relative path (project-root relative). Returns file content or directory listing. Containment-checked.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the component/file (e.g. "app/routes/index.vsk" or "app/components/Button.vsk")' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const rel = String((args as { path?: unknown }).path ?? '');
          if (!rel) return jsonError('missing required "path" parameter');
          // try projectDir first, then appDir
          let resolved: string | null = resolveWithin(projectDir, rel);
          if (!resolved) resolved = resolveWithin(appDir, rel);
          // also allow rel that is already relative to appDir but resolved via projectDir failed due to traversal? already handled
          if (!resolved) return jsonError('path escapes project root', { path: rel });
          if (!existsSync(resolved)) return jsonError('not found', { path: rel });
          const st = statSync(resolved);
          if (st.isDirectory()) {
            const entries = readdirSync(resolved, { withFileTypes: true }).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
            return jsonOk({ ok: true, path: rel, directory: true, entries: entries.slice(0, 200) });
          }
          if (st.isFile()) {
            const content = readFileSync(resolved, 'utf-8');
            // cap content
            const capped = content.length > 20000 ? content.slice(0, 20000) + '\n/* truncated */' : content;
            return jsonOk({ ok: true, path: rel, directory: false, content: capped, size: content.length });
          }
          return jsonError('unsupported file type', { path: rel });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 3. vesk.readConfig
    {
      name: 'vesk.readConfig',
      description: 'Read the Vesk project config (vesk.config.ts/js). Returns path, exists, source, and parsed config when available.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          if (typeof deps.readConfig === 'function') {
            try {
              const cfg = await Promise.resolve(deps.readConfig());
              // Normalize: if cfg already has shape { path, exists, source, config } return it, else wrap
              if (cfg && typeof cfg === 'object' && ('source' in (cfg as Record<string, unknown>) || 'config' in (cfg as Record<string, unknown>))) {
                return jsonOk({ ok: true, ...(cfg as Record<string, unknown>) });
              }
              return jsonOk({ ok: true, config: cfg });
            } catch (e) {
              return jsonError(e instanceof Error ? e.message : String(e));
            }
          }
          const info = findConfigFile(projectDir);
          if (!info.path || !existsSync(info.path)) {
            return jsonOk({ ok: true, path: null, exists: false, source: '', config: {} });
          }
          const source = readFileSync(info.path, 'utf-8');
          return jsonOk({ ok: true, path: info.path, exists: true, source, config: null });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 4. vesk.updateConfig
    {
      name: 'vesk.updateConfig',
      description: 'Update the Vesk config file. Either provide full { source } string to replace the file, or { key, value } to toggle a single defineConfig key. Validates before writing.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Full replacement source for vesk.config.ts' },
          key: { type: 'string', description: 'Single config key to set (e.g. "strictSeo")' },
          value: { description: 'Value for the single-key toggle (any JSON-serializable)' },
        },
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const a = args as { source?: unknown; key?: unknown; value?: unknown };
          if (typeof a.source === 'string') {
            const source = a.source;
            if (!source.trim()) return jsonError('source must not be empty');
            // basic validation: must contain defineConfig or export default
            // not strict — just ensure it parses as non-empty
            const info = findConfigFile(projectDir);
            let target: string;
            if (info.path) {
              target = info.path;
              const rel = target.startsWith(projectDir + sep) ? target.slice(projectDir.length + 1) : 'vesk.config.ts';
              const contained = resolveWithin(projectDir, rel);
              if (!contained && target !== resolve(projectDir, 'vesk.config.ts') && target !== resolve(projectDir, 'vesk.config.js')) {
                return jsonError('path escapes project root');
              }
            } else {
              target = resolve(projectDir, 'vesk.config.ts');
              const contained = resolveWithin(projectDir, 'vesk.config.ts');
              if (!contained) return jsonError('path escapes project root');
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, source, 'utf-8');
            return jsonOk({ ok: true, path: target, source });
          }
          if (typeof a.key === 'string' && a.key) {
            const key = a.key;
            if (/^[a-zA-Z_$][\w$]*$/.test(key) === false) return jsonError('invalid config key');
            const info = findConfigFile(projectDir);
            if (!info.path) return jsonError('no vesk.config file to edit');
            if (!info.isTs) return jsonError('single-key toggle edits only apply to vesk.config.ts (use source editor for .js)');
            const contained = resolveWithin(projectDir, info.path.slice(projectDir.length + 1));
            if (!contained) return jsonError('path escapes project root');
            const current = readFileSync(info.path, 'utf-8');
            const patched = applySimpleConfigToggle(current, key, a.value);
            if (patched === null) return jsonError('could not safely edit the config object; use the source editor');
            if (patched === current) return jsonOk({ ok: true, path: info.path, source: patched, unchanged: true });
            writeFileSync(info.path, patched, 'utf-8');
            return jsonOk({ ok: true, path: info.path, source: patched });
          }
          return jsonError('expected { source } or { key, value }');
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 5. vesk.getDiagnostics
    {
      name: 'vesk.getDiagnostics',
      description: 'Get current compiler/build diagnostics snapshot (severity, code, file, message, hint).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          let diagnostics: unknown[] = [];
          if (typeof deps.getDiagnostics === 'function') {
            const d = await Promise.resolve(deps.getDiagnostics());
            diagnostics = Array.isArray(d) ? d : [];
          }
          return jsonOk({ ok: true, diagnostics });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 6. vesk.getCompilerErrors
    {
      name: 'vesk.getCompilerErrors',
      description: 'Get compiler errors only (filtered diagnostics where severity is "error").',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          let diagnostics: unknown[] = [];
          if (typeof deps.getDiagnostics === 'function') {
            const d = await Promise.resolve(deps.getDiagnostics());
            diagnostics = Array.isArray(d) ? d : [];
          }
          const errors = diagnostics.filter((item) => {
            if (!item || typeof item !== 'object') return false;
            const r = item as Record<string, unknown>;
            return r.severity === 'error' || r.code === 'HMR_COMPILE' || r.code === 'BUILD';
          });
          return jsonOk({ ok: true, diagnostics: errors, total: diagnostics.length });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 7. vesk.runBuild
    {
      name: 'vesk.runBuild',
      description: 'Trigger a Vesk project build and return the result (ok, error, ms).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          if (typeof deps.runBuild !== 'function') return jsonError('build hook unavailable');
          const result = await Promise.resolve(deps.runBuild());
          if (result && typeof result === 'object') return jsonOk({ ok: true, ...(result as Record<string, unknown>) });
          return jsonOk({ ok: true, result });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 8. vesk.runTests
    {
      name: 'vesk.runTests',
      description: 'Run project tests and return the result.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute(_args: Record<string, unknown>): Promise<string> {
        try {
          if (typeof deps.runTests !== 'function') return jsonError('tests hook unavailable');
          const result = await Promise.resolve(deps.runTests());
          if (result && typeof result === 'object') return jsonOk({ ok: true, ...(result as Record<string, unknown>) });
          return jsonOk({ ok: true, result });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 9. vesk.installPlugin
    {
      name: 'vesk.installPlugin',
      description: 'Install a Vesk plugin package (update plugins.json state to active). Validates package spec; no shell execution here — state only.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string', description: 'npm package spec (e.g. "@vesk/plugin-tailwind" or "my-plugin@1.0.0")' },
        },
        required: ['package'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const pkg = String((args as { package?: unknown }).package ?? '');
          if (!pkg) return jsonError('missing "package" in body');
          const err = validatePackageSpec(pkg);
          if (err) return jsonError(err);
          const state = readPluginState(veskDir);
          // Derive display name from package spec (strip version/tag)
          let name = pkg;
          const at = pkg.lastIndexOf('@');
          if (at > 0) name = pkg.slice(0, at);
          // For scoped packages keep scope/name
          const existing = state.plugins.find((p) => eqIgnoreCase(p.package, pkg) || eqIgnoreCase(p.package, name) || eqIgnoreCase(p.name, name));
          if (existing) {
            existing.package = pkg;
            existing.name = name;
            existing.active = true;
          } else {
            state.plugins.push({ name, package: pkg, active: true });
          }
          writePluginState(veskDir, state);
          const record = { name, package: pkg, active: true, installed: true as const };
          return jsonOk({ ok: true, record });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 10. vesk.uninstallPlugin
    {
      name: 'vesk.uninstallPlugin',
      description: 'Uninstall a Vesk plugin package (remove from plugins.json state).',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string', description: 'npm package spec to uninstall' },
        },
        required: ['package'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const pkg = String((args as { package?: unknown }).package ?? '');
          if (!pkg) return jsonError('missing "package" in body');
          const err = validatePackageSpec(pkg);
          if (err) return jsonError(err);
          const state = readPluginState(veskDir);
          const normalized = pkg.includes('@', 1) ? pkg.slice(0, pkg.lastIndexOf('@')) : pkg;
          const before = state.plugins.length;
          state.plugins = state.plugins.filter(
            (p) => !eqIgnoreCase(p.package, pkg) && !eqIgnoreCase(p.package, normalized) && !eqIgnoreCase(p.name, pkg) && !eqIgnoreCase(p.name, normalized),
          );
          writePluginState(veskDir, state);
          return jsonOk({ ok: true, removed: before !== state.plugins.length });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 11. vesk.enablePlugin
    {
      name: 'vesk.enablePlugin',
      description: 'Enable (activate) an installed Vesk plugin by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plugin name to enable' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const name = String((args as { name?: unknown }).name ?? '');
          if (!name) return jsonError('missing "name" in body');
          const state = readPluginState(veskDir);
          const existing = state.plugins.find((p) => eqIgnoreCase(p.name, name) || eqIgnoreCase(p.package, name));
          if (existing) {
            existing.active = true;
          } else {
            state.plugins.push({ name, package: name, active: true });
          }
          writePluginState(veskDir, state);
          const record = state.plugins.find((p) => eqIgnoreCase(p.name, name) || eqIgnoreCase(p.package, name))!;
          return jsonOk({ ok: true, record });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 12. vesk.disablePlugin
    {
      name: 'vesk.disablePlugin',
      description: 'Disable (deactivate) an installed Vesk plugin by name. Inactive plugins are excluded from builds.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Plugin name to disable' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const name = String((args as { name?: unknown }).name ?? '');
          if (!name) return jsonError('missing "name" in body');
          const state = readPluginState(veskDir);
          const existing = state.plugins.find((p) => eqIgnoreCase(p.name, name) || eqIgnoreCase(p.package, name));
          if (existing) {
            existing.active = false;
          } else {
            state.plugins.push({ name, package: name, active: false });
          }
          writePluginState(veskDir, state);
          const record = state.plugins.find((p) => eqIgnoreCase(p.name, name) || eqIgnoreCase(p.package, name))!;
          return jsonOk({ ok: true, record });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 13. vesk.createCheckpoint
    {
      name: 'vesk.createCheckpoint',
      description: 'Create a checkpoint of the current project state for later rollback. Returns checkpointId.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Human-readable checkpoint message' },
        },
        required: [],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const message = typeof (args as { message?: unknown }).message === 'string' ? String((args as { message?: unknown }).message) : '';
          // Prefer canonical checkpoints impl (projectDir/.vesk/agentic) which supports file snapshots + history.
          try {
            const cp = createCheckpointImpl(projectDir, message || 'checkpoint', {}, undefined);
            return jsonOk({ ok: true, checkpointId: cp.id, message: cp.message, timestamp: cp.timestamp });
          } catch {}
          // Fallback: simple file in veskDir/checkpoints
          const dir = checkpointDir(veskDir);
          mkdirSync(dir, { recursive: true });
          const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const file = join(dir, `${id}.json`);
          const check = resolveWithin(dir, `${id}.json`);
          if (!check) return jsonError('path escapes project root');
          const payload = {
            id,
            message: message || null,
            timestamp: new Date().toISOString(),
            projectDir,
            appDir,
            veskDir,
          };
          writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
          return jsonOk({ ok: true, checkpointId: id, message: payload.message, timestamp: payload.timestamp });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // 14. vesk.rollback
    {
      name: 'vesk.rollback',
      description: 'Rollback project to a prior checkpoint by checkpointId.',
      parameters: {
        type: 'object',
        properties: {
          checkpointId: { type: 'string', description: 'Checkpoint ID from vesk.createCheckpoint' },
        },
        required: ['checkpointId'],
        additionalProperties: false,
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        try {
          const checkpointId = String((args as { checkpointId?: unknown }).checkpointId ?? '');
          if (!checkpointId) return jsonError('missing "checkpointId" in body');
          if (checkpointId.includes('/') || checkpointId.includes('\\') || checkpointId.includes('..')) {
            return jsonError('invalid checkpointId');
          }
          // Try canonical implementation first (projectDir/.vesk/agentic)
          try {
            const existing = getCheckpointImpl(projectDir, checkpointId);
            if (existing) {
              const rolled = rollbackImpl(projectDir, checkpointId);
              if (rolled) return jsonOk({ ok: true, checkpointId, checkpoint: rolled, rolledBack: true });
            }
          } catch {}
          // Fallback to legacy veskDir/checkpoints dir
          const dir = checkpointDir(veskDir);
          const file = join(dir, `${checkpointId}.json`);
          const contained = resolveWithin(dir, `${checkpointId}.json`);
          if (!contained) return jsonError('path escapes project root');
          if (!existsSync(file)) return jsonError(`checkpoint not found: ${checkpointId}`, { checkpointId });
          const raw = readFileSync(file, 'utf-8');
          let data: unknown;
          try { data = JSON.parse(raw); } catch { data = { raw }; }
          return jsonOk({ ok: true, checkpointId, checkpoint: data, rolledBack: true });
        } catch (e) {
          return jsonError(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];

  return tools;
}
