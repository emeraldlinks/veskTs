/**
 * DevTools API router — `createDevApiRouter` (B2 of plans/devtools.md).
 *
 * A self-contained, dependency-injectable router for ALL dev-panel HTTP
 * endpoints under `/__vesk/*`. It generalizes the earlier plugin-only router
 * into a capability-scoped surface:
 *
 *     config       GET/POST /__vesk/config
 *     plugins      GET /__vesk/plugins + POST activate/deactivate/install/
 *                  uninstall/update + GET search/icon/exports
 *     diagnostics  GET /__vesk/diagnostics
 *     build        POST /__vesk/build
 *     file.read    GET  /__vesk/file?path=
 *     command      POST /__vesk/command
 *
 * ARCHITECTURE: the Dev Server is the ONLY path from browser → project files /
 * build system. Every endpoint is gated by a capability in `CapabilityTable`
 * (server-enforced — the browser cannot bypass it). There is NO raw
 * `child_process` reach: commands route through the gated, allowlisted
 * `runCommand` hook, and file access is read-only + containment-checked.
 *
 * Pure (fake injectable inputs, no socket/listener), mirroring the shape of
 * `createPluginStateRouter`: returns `{ route(method, pathname, body, search) }`,
 * yielding `null` for non-`/__vesk/*` paths so the dev server falls through.
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getPluginRecords,
  setPluginActive,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  enrichPluginRecords,
  searchPlugins,
  introspectPlugin,
  findPluginIcon,
} from './plugins';
import { readConfig, writeConfigSource, applyConfigToggle, findConfigFile, addPluginToConfig, removePluginFromConfig } from './dev-config';
import type { DevHmrState } from './dev-server';
import { resolveWithin } from './paths';
import type { PluginRouterChangeEvent } from './dev-server';

export interface DiagnosticFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  file?: string | null;
  line?: number | null;
  column?: number | null;
  message: string;
  hint?: string | null;
}

export type CapabilityName =
  | 'config.read'
  | 'config.write'
  | 'plugins'
  | 'diagnostics'
  | 'build'
  | 'file.read'
  | 'command';

export type DevApiCapabilities = Record<CapabilityName, boolean>;

/** Default DevTools capability set — `command` is gated off by default. */
export const DEFAULT_CAPABILITIES: DevApiCapabilities = {
  'config.read': true,
  'config.write': true,
  'plugins': true,
  'diagnostics': true,
  'build': true,
  'file.read': true,
  'command': false,
};

/** Gated-command allowlist (read-only/status commands only by default). */
export const DEFAULT_COMMAND_ALLOWLIST: RegExp[] = [
  /^node -v$/,
  /^npm -v$/,
  /^git status/,
  /^git log/,
  /^git branch/,
  /^pwd$/,
  /^ls($|\s)/,
  /^cat($|\s)/,
  /^head($|\s)/,
];

/** Server-enforced capability/permission table. */
export class CapabilityTable {
  private caps: DevApiCapabilities;
  private commandAllowlist: RegExp[];

  constructor(caps?: Partial<DevApiCapabilities>, commandAllowlist: RegExp[] = DEFAULT_COMMAND_ALLOWLIST) {
    this.caps = { ...DEFAULT_CAPABILITIES, ...(caps || {}) };
    this.commandAllowlist = commandAllowlist;
  }

  allows(cap: CapabilityName): boolean {
    return this.caps[cap] === true;
  }

  commandAllowed(argv: string[]): boolean {
    const joined = argv.join(' ');
    return this.commandAllowlist.some((re) => re.test(joined));
  }
}

export interface DevPanelResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  encoding?: 'utf8' | 'base64';
  /** When set, `body`/`encoding` are ignored and this async iterable of
      (already-framed) strings is streamed to the client instead — used for
      SSE agent progress. */
  stream?: AsyncIterable<string>;
}

export interface RebuildResult {
  ok: boolean;
  error?: string;
  ms?: number;
}

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface DevApiRouterOptions {
  /** Directory containing app/ (parent of projectDir when config is at project root). */
  appDir: string;
  /** The `.vesk` state dir. */
  veskDir: string;
  /** Plugin names declared in config. */
  configPluginNames: string[];
  getHmrState?: () => DevHmrState;
  onPluginChange?: (event: PluginRouterChangeEvent) => void | Promise<void>;
  /** Capability overrides; `command` is off unless enabled + allowlisted. */
  caps?: Partial<DevApiCapabilities>;
  commandAllowlist?: RegExp[];
  /** Dir where vesk.config.{ts,js} lives (defaults to dirname(appDir)). */
  projectDir?: string;
  /** Trigger a full rebuild + HMR reload (POST /__vesk/build). */
  rebuild?: () => Promise<RebuildResult>;
  /** Live diagnostics snapshot (GET /__vesk/diagnostics). */
  getDiagnostics?: () => DiagnosticFinding[];
  /** Gated command executor (POST /__vesk/command). */
  runCommand?: (argv: string[]) => Promise<CommandResult>;
  /** Response body cap. */
  maxBodyBytes?: number;
}

export interface DevApiRouter {
  route: (
    method: string,
    pathname: string,
    body?: unknown,
    search?: string,
  ) => Promise<DevPanelResponse | null>;
}

function jsonStatus(status: number, data: unknown): DevPanelResponse {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

/**
 * Build the unified DevTools API router. Exportable and dependency-injectable
 * so the adapter + CLI dev servers can both route through it.
 */
export function createDevApiRouter(opts: DevApiRouterOptions): DevApiRouter {
  const veskDir = opts.veskDir;
  const caps = new CapabilityTable(opts.caps, opts.commandAllowlist);
  const projectDir = opts.projectDir || resolve(opts.appDir, '..');
  const getState = opts.getHmrState || (() => ({ status: 'up' as const, lastCompileMs: null, error: null, hasError: false, componentCount: 0 }));

  function denied(cap: CapabilityName): DevPanelResponse {
    return jsonStatus(403, { error: `capability denied: ${cap}` });
  }
  function badRequest(message: string): DevPanelResponse {
    return jsonStatus(400, { error: message });
  }

  async function onChanged(event: PluginRouterChangeEvent): Promise<void> {
    if (typeof opts.onPluginChange === 'function') await opts.onPluginChange(event);
  }

  async function route(method: string, pathname: string, body?: unknown, search?: string): Promise<DevPanelResponse | null> {
    // ── HMR state ──────────────────────────────────────────────────────────
    if (pathname === '/__vesk/hmr/state') {
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      return jsonStatus(200, getState());
    }

    // ── Config (B1) ────────────────────────────────────────────────────────
    if (pathname === '/__vesk/config' && method === 'GET') {
      if (!caps.allows('config.read')) return denied('config.read');
      try {
        const cfg = await readConfig(projectDir);
        return jsonStatus(200, { path: cfg.path, exists: cfg.exists, source: cfg.source, config: cfg.config });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/config' && method === 'POST') {
      if (!caps.allows('config.write')) return denied('config.write');
      const b = (body || {}) as Record<string, unknown>;
      try {
        if (typeof b.source === 'string') {
          const cfg = await writeConfigSource(projectDir, b.source);
          return jsonStatus(200, { ok: true, path: cfg.path, source: cfg.source, config: cfg.config });
        }
        if (typeof b.key === 'string' && b.key) {
          const { path, isTs } = findConfigFile(projectDir);
          if (!path) return badRequest('no vesk.config file to edit');
          if (!isTs) return badRequest('single-key toggle edits only apply to vesk.config.ts (use the source editor for .js)');
          const patched = applyConfigToggle(readFileSync(path, 'utf-8'), b.key, b.value);
          if (patched === null) return badRequest('could not safely edit the config object; use the source editor');
          const cfg = await writeConfigSource(projectDir, patched);
          return jsonStatus(200, { ok: true, path: cfg.path, source: cfg.source, config: cfg.config });
        }
        return badRequest('expected { source } or { key, value }');
      } catch (e) {
        return jsonStatus(400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── Diagnostics (B3) ───────────────────────────────────────────────────
    if (pathname === '/__vesk/diagnostics' && method === 'GET') {
      if (!caps.allows('diagnostics')) return denied('diagnostics');
      const list = typeof opts.getDiagnostics === 'function' ? opts.getDiagnostics() : [];
      return jsonStatus(200, { diagnostics: list });
    }

    // ── Build ──────────────────────────────────────────────────────────────
    if (pathname === '/__vesk/build' && method === 'POST') {
      if (!caps.allows('build')) return denied('build');
      if (typeof opts.rebuild !== 'function') return jsonStatus(503, { error: 'build hook unavailable' });
      try {
        const result = await opts.rebuild();
        return jsonStatus(200, { ok: result.ok, error: result.error || null, ms: result.ms ?? null });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── Read-only file access (B2) ─────────────────────────────────────────
    if (pathname === '/__vesk/file' && method === 'GET') {
      if (!caps.allows('file.read')) return denied('file.read');
      const target = new URLSearchParams(search ?? '').get('path') || '';
      if (!target) return badRequest('missing "path" query param');
      try {
        const resolved = resolveWithin(projectDir, target);
        if (!resolved) return jsonStatus(403, { error: 'path escapes project root' });
        if (!existsSync(resolved)) return jsonStatus(404, { error: 'not found' });
        if (statSync(resolved).isDirectory()) {
          const entries = readdirSync(resolved, { withFileTypes: true }).map((e) => e.name);
          return jsonStatus(200, { ok: true, path: target, directory: true, entries });
        }
        if (statSync(resolved).isFile()) {
          return jsonStatus(200, { ok: true, path: target, directory: false, content: readFileSync(resolved, 'utf-8') });
        }
        return badRequest('unsupported file type');
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── Gated command runner (B2) ──────────────────────────────────────────
    if (pathname === '/__vesk/command' && method === 'POST') {
      if (!caps.allows('command')) return denied('command');
      const b = (body || {}) as Record<string, unknown>;
      const argv = Array.isArray(b.argv) ? b.argv.filter((a): a is string => typeof a === 'string') : [];
      if (argv.length === 0) return badRequest('expected { argv: string[] }');
      if (!caps.commandAllowed(argv)) return jsonStatus(403, { error: 'command not in allowlist' });
      if (typeof opts.runCommand !== 'function') return jsonStatus(503, { error: 'command runner unavailable' });
      try {
        const result = await opts.runCommand(argv);
        return jsonStatus(200, { ok: result.ok, code: result.code, stdout: result.stdout, stderr: result.stderr });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── Plugins (existing surface, capability-gated) ───────────────────────
    if (pathname === '/__vesk/plugins' && method === 'GET') {
      if (!caps.allows('plugins')) return denied('plugins');
      try {
        const records = await enrichPluginRecords(getPluginRecords(opts.appDir, veskDir, opts.configPluginNames));
        return jsonStatus(200, { plugins: records });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/activate' && method === 'POST') {
      if (!caps.allows('plugins')) return denied('plugins');
      const name = (body as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !name) return badRequest('missing "name" in body');
      try {
        setPluginActive(veskDir, name, true);
        const record = getPluginRecords(opts.appDir, veskDir, opts.configPluginNames).find((r) => r.name === name);
        await onChanged({ type: 'activate', name });
        return jsonStatus(200, { ok: true, record: record || null });
      } catch (e) {
        return jsonStatus(400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/deactivate' && method === 'POST') {
      if (!caps.allows('plugins')) return denied('plugins');
      const name = (body as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !name) return badRequest('missing "name" in body');
      try {
        setPluginActive(veskDir, name, false);
        const record = getPluginRecords(opts.appDir, veskDir, opts.configPluginNames).find((r) => r.name === name);
        await onChanged({ type: 'deactivate', name });
        return jsonStatus(200, { ok: true, record: record || null });
      } catch (e) {
        return jsonStatus(400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/install' && method === 'POST') {
      if (!caps.allows('plugins')) return denied('plugins');
      const pkg = (body as { package?: unknown } | null)?.package;
      if (typeof pkg !== 'string' || !pkg) return badRequest('missing "package" in body');
      try {
        const record = await installPlugin(opts.appDir, veskDir, pkg);
        // auto-register in vesk.config.ts (best-effort, does not fail install)
        try { await addPluginToConfig(projectDir, pkg); } catch {}
        await onChanged({ type: 'install', name: record.name });
        return jsonStatus(200, { ok: true, record });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/uninstall' && method === 'POST') {
      if (!caps.allows('plugins')) return denied('plugins');
      const pkg = (body as { package?: unknown } | null)?.package;
      if (typeof pkg !== 'string' || !pkg) return badRequest('missing "package" in body');
      try {
        await uninstallPlugin(opts.appDir, veskDir, pkg);
        // auto-remove from vesk.config.ts (best-effort, surgical) + npm uninstall already done in uninstallPlugin
        try { await removePluginFromConfig(projectDir, pkg); } catch {}
        await onChanged({ type: 'uninstall', name: pkg });
        return jsonStatus(200, { ok: true });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/update' && method === 'POST') {
      if (!caps.allows('plugins')) return denied('plugins');
      const pkg = (body as { package?: unknown } | null)?.package;
      if (typeof pkg !== 'string' || !pkg) return badRequest('missing "package" in body');
      try {
        const record = await updatePlugin(opts.appDir, veskDir, pkg);
        await onChanged({ type: 'update', name: record.name });
        return jsonStatus(200, { ok: true, record });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (pathname === '/__vesk/plugins/search' && method === 'GET') {
      if (!caps.allows('plugins')) return denied('plugins');
      const q = new URLSearchParams(search ?? '').get('q') ?? '';
      const results = await searchPlugins(q);
      return jsonStatus(200, { results });
    }
    const perPlugin = /^\/__vesk\/plugins\/([^/]+)\/(icon|exports)$/.exec(pathname);
    if (perPlugin) {
      if (!caps.allows('plugins')) return denied('plugins');
      const pluginName = decodeURIComponent(perPlugin[1]);
      if (perPlugin[2] === 'icon') {
        if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
        const icon = findPluginIcon(opts.appDir, pluginName);
        if (!icon) return jsonStatus(404, { error: `no icon for plugin "${pluginName}"` });
        return {
          status: 200,
          headers: { 'Content-Type': icon.mime, 'Cache-Control': 'private, max-age=60' },
          body: readFileSync(icon.file).toString('base64'),
          encoding: 'base64',
        };
      }
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      return jsonStatus(200, introspectPlugin(opts.appDir, pluginName));
    }

    if (pathname.startsWith('/__vesk/')) {
      return jsonStatus(404, { error: 'Not found' });
    }
    return null;
  }

  return { route };
}
