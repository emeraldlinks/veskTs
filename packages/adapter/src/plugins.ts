import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, join, extname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolveWithin } from '@vesk/adapter/src/paths';

/**
 * Dev-side plugin ("module") manager for Vesk.
 *
 * The user-facing surface is a Nuxt-like flow: INSTALL/UNINSTALL packages and
 * ACTIVATE/DEACTIVATE plugins. Active/installed state lives in a state file
 * (`.vesk/<PLUGIN_STATE_FILENAME>`) that the build-enforcement agent consumes
 * so that INACTIVE plugins never ship in a production build. The dev panel
 * talks to dev-server HTTP endpoints which call into this module.
 *
 * No compiler/runtime imports: this module only touches node built-ins.
 */

export interface PluginRecord {
  name: string; // display name (package.json.name or local dir name)
  package: string; // npm package spec (name for local plugins)
  path: string | null; // resolved entry path if known
  active: boolean; // RESOLVED build participation = (state.active ?? config default) && installed
  installed: boolean; // resolvable in node_modules (or local dir exists)
  version: string | null; // installed version from package.json
  latest: string | null; // npm registry latest (null if registry unreachable)
  description: string | null;
  author: string | null; // string name or "Name <email>"
  license: string | null;
  homepage: string | null;
  repository: string | null; // git URL
  updatedAt: string | null; // last publish time (registry) — ISO or null
  keywords: string[];
  iconUrl: string | null; // relative: '/__vesk/plugins/<enc-name>/icon' when a meta icon exists, else null
  metaSource: 'vesk.meta.json' | 'package.json' | 'none';
  source: 'config' | 'state';
  error: string | null; // e.g. "may not be a Vesk plugin", "not installed"
}

export interface PluginStateFile {
  version: 1;
  plugins: { name: string; package: string; active: boolean }[];
}

export interface PluginSearchResult {
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
  date: string | null;
  keywords: string[];
  links: Record<string, string> | null;
}

export interface PluginExportsInfo {
  ok: boolean;
  name: string;
  entry: string | null;
  packageJsonExports: Record<string, string> | null;
  dtsPath: string | null;
  dtsExports: string[];
}

export const PLUGIN_STATE_FILENAME = 'plugins.json';

const STATE_VERSION = 1;

const REGISTRY_FETCH_TIMEOUT_MS = 6000;
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;

const registryCache = new Map<string, { at: number; value: unknown }>();

function defaultState(): PluginStateFile {
  return { version: STATE_VERSION, plugins: [] };
}

function eqIgnoreCase(a: string, b: string): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function stateFilePath(veskDir: string): string {
  return resolve(veskDir, PLUGIN_STATE_FILENAME);
}

/**
 * Read the plugin state file. Tolerates a missing file (returns defaults) and
 * a corrupt file (mismatched version or invalid JSON → reseed to defaults).
 */
export function readPluginState(veskDir: string): PluginStateFile {
  const file = stateFilePath(veskDir);
  if (!existsSync(file)) return defaultState();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return defaultState();
  }
  if (!raw || typeof raw !== 'object') return defaultState();
  const obj = raw as Record<string, unknown>;
  if (obj.version !== STATE_VERSION) return defaultState();
  if (!Array.isArray(obj.plugins)) return defaultState();
  return {
    version: STATE_VERSION,
    plugins: (obj.plugins as unknown[]).filter(
      (p): p is PluginStateFile['plugins'][number] =>
        !!p && typeof p === 'object' &&
        typeof (p as Record<string, unknown>).name === 'string' &&
        typeof (p as Record<string, unknown>).package === 'string' &&
        typeof (p as Record<string, unknown>).active === 'boolean',
    ),
  };
}

/** Write the plugin state file. */
export function writePluginState(veskDir: string, state: PluginStateFile): void {
  const file = stateFilePath(veskDir);
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

interface ResolvedPackage {
  installed: boolean;
  path: string | null;
  dir: string | null; // package root dir (holds package.json / vesk.meta.json / icon)
  packageJson: Record<string, unknown> | null;
}

/**
 * Probe whether a package is resolvable from the app directory, returning its
 * resolved entry path, package root dir and package.json (if any). For a local
 * plugin the `package` value may be the plugin name itself, resolved against
 * app-local dirs as a fallback.
 */
function resolvePackage(appDir: string, pkg: string): ResolvedPackage {
  const require = createRequire(resolve(appDir, 'package.json'));
  let entryPath: string | null = null;
  let pkgJsonPath: string | null = null;
  let pkgJson: Record<string, unknown> | null = null;

  // 1. Resolve the package.json via the package spec (does not run module code).
  try {
    pkgJsonPath = require.resolve(`${pkg}/package.json`);
  } catch {
    try {
      // Fall back to resolving the package entry, then walk up to the nearest
      // package.json — the entry may live in dist/ while package.json sits at
      // the package root (exports-mapped packages block `<pkg>/package.json`).
      // The walk never crosses outside the package's own dir tree: the first
      // package.json found above the resolved entry IS the package's own, and
      // we stop at the containing `node_modules` boundary / filesystem root.
      entryPath = require.resolve(pkg);
      let cur = dirname(entryPath);
      const seen = new Set<string>();
      while (cur && cur !== dirname(cur) && !seen.has(cur)) {
        seen.add(cur);
        const candidate = join(cur, 'package.json');
        if (existsSync(candidate)) { pkgJsonPath = candidate; break; }
        // Never walk above the `node_modules` directory that holds this package.
        const parent = dirname(cur);
        if (parent !== cur && basename(cur) === 'node_modules') break;
        cur = parent;
      }
    } catch {
      // not resolvable — try app-local dirs below
    }
  }

  if (pkgJsonPath && existsSync(pkgJsonPath)) {
    pkgJson = readJsonFile<Record<string, unknown>>(pkgJsonPath);
    const main = (pkgJson?.main || pkgJson?.module || 'index.js') as string;
    entryPath = resolve(dirname(pkgJsonPath), main);
  }

  // 2. Fall back to app-local directory checks (e.g. `./plugins/foo` or a bare
  //    local plugin name that is built-in to the app, not in node_modules).
  let localPath: string | null = localDir(appDir, pkg);
  if (!localPath) {
    // maybe an app-local bare name under src/plugins etc.
    for (const sub of ['src/plugins', 'plugins', 'lib/plugins']) {
      const candidate = localDir(resolve(appDir, sub), pkg);
      if (candidate) { localPath = candidate; break; }
    }
  }
  if (localPath) {
    const localJson = join(localPath, 'package.json');
    let json: Record<string, unknown> | null = null;
    if (existsSync(localJson)) {
      json = readJsonFile<Record<string, unknown>>(localJson);
    }
    return { installed: true, path: localPath, dir: localPath, packageJson: json ?? pkgJson };
  }

  const installed = !!pkgJsonPath && existsSync(pkgJsonPath);
  return { installed, path: entryPath, dir: installed ? dirname(pkgJsonPath as string) : null, packageJson: pkgJson };
}

function localDir(base: string, pkg: string): string | null {
  if (pkg.startsWith('@')) {
    // scoped: `@scope/name` → `@scope/name`
    const parts = pkg.split('/');
    const p = resolve(base, parts[0], parts[1] ?? '');
    if (existsSync(p)) return p;
    return null;
  }
  const p = resolve(base, pkg);
  if (existsSync(p)) return p;
  return null;
}

// ─── field coercion helpers ────────────────────────────────────────────────

function readJsonFile<T>(file: string): T | null {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    /* ignore corrupt JSON */
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function asKeywords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const k of v) {
    if (typeof k === 'string' && k.trim().length > 0) out.push(k);
  }
  return [...new Set(out)];
}

function authorToString(a: unknown): string | null {
  if (typeof a === 'string') return str(a);
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    const name = str(o.name);
    const email = str(o.email);
    const url = str(o.url);
    if (name && email) return `${name} <${email}>`;
    if (name && url) return `${name} (${url})`;
    return name;
  }
  return null;
}

function repositoryToString(r: unknown): string | null {
  if (typeof r === 'string') return str(r);
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    return str(o.url) ?? str(o.repository);
  }
  return null;
}

interface AssemblyMeta {
  metaSource: PluginRecord['metaSource'];
  version: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  repository: string | null;
  keywords: string[];
  iconFile: string | null; // absolute icon path when a vesk.meta.json icon exists and is present
}

/**
 * Metadata precedence (contract): `vesk.meta.json` first (description,
 * author, license, homepage, repository, keywords, icon), then the installed
 * package.json fields. Registry enrichment (latest/updatedAt etc.) happens
 * separately in `enrichPluginRecords` (async, best-effort).
 */
function assemblePluginMeta(probe: ResolvedPackage): AssemblyMeta {
  const pkgJson = probe.packageJson || {};
  const dir = probe.dir;
  const meta = dir ? readJsonFile<Record<string, unknown>>(resolve(dir, 'vesk.meta.json')) : null;
  const hasMeta = !!meta && Object.keys(meta).length > 0;
  const m = meta || {};

  const metaSource: PluginRecord['metaSource'] = hasMeta ? 'vesk.meta.json' : (probe.packageJson ? 'package.json' : 'none');

  const iconFile = dir ? findIconFile(dir, m) : null;

  return {
    metaSource,
    version: str(pkgJson.version) ?? str(m.version),
    description: str(m.description) ?? str(pkgJson.description),
    author: authorToString(m.author ?? pkgJson.author),
    license: str(m.license) ?? str(pkgJson.license),
    homepage: str(m.homepage) ?? str(pkgJson.homepage),
    repository: repositoryToString(m.repository ?? pkgJson.repository),
    keywords: asKeywords(m.keywords ?? pkgJson.keywords),
    iconFile,
  };
}

/**
 * Build one fully-populated PluginRecord. `active` is the RESOLVED build
 * participation: the effective state value (config plugins default active)
 * AND-ed with `installed` — a non-installed plugin must never report
 * active:true. Registry-backed fields (latest/updatedAt) start null here and
 * are filled by `enrichPluginRecords`.
 */
function buildRecord(opts: {
  name: string;
  pkg: string;
  source: PluginRecord['source'];
  activeRaw: boolean;
  error: string | null;
}, appDir: string): PluginRecord {
  const probe = resolvePackage(appDir, opts.pkg);
  const meta = assemblePluginMeta(probe);
  const installed = probe.installed;
  const active = opts.activeRaw && installed;
  const error = opts.error ?? (installed ? null : 'not installed');
  let iconUrl: string | null = null;
  if (meta.iconFile) {
    iconUrl = `/__vesk/plugins/${encodeURIComponent(opts.name)}/icon`;
  }
  return {
    name: opts.name,
    package: opts.pkg,
    path: probe.path,
    active,
    installed,
    version: meta.version,
    latest: null,
    description: meta.description,
    author: meta.author,
    license: meta.license,
    homepage: meta.homepage,
    repository: meta.repository,
    updatedAt: null,
    keywords: meta.keywords,
    iconUrl,
    metaSource: meta.metaSource,
    source: opts.source,
    error,
  };
}

/**
 * Merge config-declared plugins and state-only entries into a unified record
 * list.
 *
 * Precedence: a state entry (matched by name OR package, case-insensitive)
 * overrides a config plugin's activation. Config plugins default to ACTIVE
 * unless a matching state entry deactivates them. Entries that exist only in
 * the state file are reported as source 'state'. `active` is the resolved
 * build participation — always AND-ed with `installed`.
 */
export function getPluginRecords(
  appDir: string,
  veskDir: string,
  configPluginNames: string[],
): PluginRecord[] {
  const state = readPluginState(veskDir);
  const records: PluginRecord[] = [];

  for (const name of configPluginNames) {
    if (typeof name !== 'string' || !name) continue;
    const stateEntry = state.plugins.find(
      (p) => eqIgnoreCase(p.name, name) || eqIgnoreCase(p.package, name),
    );
    records.push(buildRecord({
      name,
      pkg: name,
      source: 'config',
      activeRaw: stateEntry ? stateEntry.active : true,
      error: null,
    }, appDir));
  }

  for (const entry of state.plugins) {
    const isConfigPlugin = configPluginNames.some((n) =>
      eqIgnoreCase(n, entry.name) || eqIgnoreCase(n, entry.package),
    );
    if (isConfigPlugin) continue; // already represented as a config record
    records.push(buildRecord({
      name: entry.name,
      pkg: entry.package || entry.name,
      source: 'state',
      activeRaw: entry.active,
      error: null,
    }, appDir));
  }

  return records;
}

/** Toggle a plugin's active flag in the state file (matched by name). Returns the new state. */
export function setPluginActive(
  veskDir: string,
  name: string,
  active: boolean,
): PluginStateFile {
  const state = readPluginState(veskDir);
  const existing = state.plugins.find((p) => eqIgnoreCase(p.name, name));
  if (existing) {
    existing.active = active;
  } else {
    state.plugins.push({ name, package: name, active });
  }
  writePluginState(veskDir, state);
  return state;
}

/** Validate a package spec string loosely: non-empty, no spaces, no `..`. */
function validatePackageSpec(pkg: string): string | null {
  if (typeof pkg !== 'string' || pkg.trim().length === 0) {
    return 'package spec is empty';
  }
  if (pkg !== pkg.trim()) return 'package spec must not have leading/trailing whitespace';
  if (/\s/.test(pkg)) return 'package spec must not contain spaces';
  if (pkg.includes('..')) return 'package spec must not contain ".."';
  if (/[\/\\][\/\\]/.test(pkg)) return 'invalid package spec';
  return null;
}

/** Is the resolved package.json plausibly a Vesk plugin? */
function plausibleVeskPlugin(pkgJson: Record<string, unknown> | null): boolean {
  if (!pkgJson) return false;
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : '';
  if (name.startsWith('@vesk/plugin-')) return true;
  if (pkgJson.vesk === true) return true;
  // category field (e.g. "vesk-plugin" / "vk-plugin") — some registries use `category`
  const cat = (pkgJson as Record<string, unknown>).category;
  if (typeof cat === 'string' && /^(vesk-plugin|vk-plugin)$/i.test(cat.trim())) return true;
  const keywords = pkgJson.keywords;
  if (Array.isArray(keywords)) {
    for (const k of keywords) {
      const kw = String(k).toLowerCase().trim();
      if (kw === 'vesk' || kw === 'vesk-plugin' || kw === 'vk-plugin') return true;
    }
  }
  return false;
}

async function runNpm(
  appDir: string,
  args: string[],
  timeoutMs = 180_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', args, {
      cwd: appDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`npm ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Install a package into the app and register it as an active plugin in the
 * state file. The package spec is validated first; then it is verified to be
 * a Vesk plugin (via its package.json, never by importing module code). A
 * plausible-but-unflagged package is still registered but flagged with an
 * `error` noting it may not be a Vesk plugin.
 */
export async function installPlugin(
  appDir: string,
  veskDir: string,
  pkg: string,
): Promise<PluginRecord> {
  const validationError = validatePackageSpec(pkg);
  if (validationError) {
    throw new Error(`[vesk] cannot install plugin: ${validationError}`);
  }
  const result = await __internals.runNpm(appDir, ['install', pkg]);
  if (result.code !== 0) {
    throw new Error(
      `npm install ${pkg} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim()}`,
    );
  }

  const probe = resolvePackage(appDir, pkg);
  let error: string | null = null;
  if (!plausibleVeskPlugin(probe.packageJson)) {
    error = `"${pkg}" may not be a Vesk plugin (missing @vesk/plugin- prefix, "vesk":true, or "vesk" keyword)`;
  }

  const state = readPluginState(veskDir);
  const name = (probe.packageJson?.name as string | undefined) || pkg;
  const existing = state.plugins.find(
    (p) => eqIgnoreCase(p.package, pkg) || eqIgnoreCase(p.name, name),
  );
  if (existing) {
    existing.package = pkg;
    existing.name = name;
    existing.active = true;
  } else {
    state.plugins.push({ name, package: pkg, active: true });
  }
  writePluginState(veskDir, state);
  return buildRecord({ name, pkg, source: 'state', activeRaw: true, error }, appDir);
}

/** Uninstall a package from the app and drop all state entries whose package matches. */
export async function uninstallPlugin(
  appDir: string,
  veskDir: string,
  pkg: string,
): Promise<void> {
  const validationError = validatePackageSpec(pkg);
  if (validationError) {
    throw new Error(`[vesk] cannot uninstall plugin: ${validationError}`);
  }
  const result = await __internals.runNpm(appDir, ['uninstall', pkg]);
  if (result.code !== 0) {
    throw new Error(
      `npm uninstall ${pkg} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  const state = readPluginState(veskDir);
  state.plugins = state.plugins.filter(
    (p) => !eqIgnoreCase(p.package, pkg) && !eqIgnoreCase(p.package, pkg.replace(/^@[^/]+\//, '')),
  );
  writePluginState(veskDir, state);
}

/**
 * Update (reinstall at latest) an installed plugin and refresh its state entry.
 * Returns the fresh record. `npm install <pkg>@latest` runs through the
 * `runNpm` seam; the state entry keeps its activation, and the record is
 * re-resolved against the freshly installed package.
 */
export async function updatePlugin(
  appDir: string,
  veskDir: string,
  pkg: string,
): Promise<PluginRecord> {
  const validationError = validatePackageSpec(pkg);
  if (validationError) {
    throw new Error(`[vesk] cannot update plugin: ${validationError}`);
  }
  const result = await __internals.runNpm(appDir, ['install', `${pkg}@latest`]);
  if (result.code !== 0) {
    throw new Error(
      `npm update ${pkg} failed (exit ${result.code}): ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  const probe = resolvePackage(appDir, pkg);
  const state = readPluginState(veskDir);
  const name = (probe.packageJson?.name as string | undefined) || pkg;
  const existing = state.plugins.find(
    (p) => eqIgnoreCase(p.package, pkg) || eqIgnoreCase(p.name, name),
  );
  if (existing) {
    existing.package = pkg;
    existing.name = name;
  } else {
    state.plugins.push({ name, package: pkg, active: true });
  }
  writePluginState(veskDir, state);
  return buildRecord({
    name,
    pkg,
    source: 'state',
    activeRaw: existing ? existing.active : true,
    error: null,
  }, appDir);
}

/**
 * Filter the config-declared plugin array down to the active set.
 *
 * Rule (source of truth = records): for each config plugin whose `name`
 * matches an ACTIVE record → keep; matched INACTIVE record → drop (never
 * ships); config plugin with no matching record → keep (defaults active).
 */
export function filterActivePlugins(configPlugins: unknown[], records: PluginRecord[]): unknown[] {
  return (configPlugins || []).filter((plugin) => {
    if (!plugin || typeof plugin !== 'object') return true;
    const name = (plugin as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name) return true;
    const record = records.find((r) => eqIgnoreCase(r.name, name));
    if (!record) return true; // no matching record → keep (defaults active)
    return record.active;
  });
}

// ─── icon + introspection ──────────────────────────────────────────────────

/**
 * Resolve the icon a plugin declares in `vesk.meta.json` (e.g. `icon.png` /
 * `icon.ico`) from its package dir. Returns the absolute file plus MIME, or
 * null when nothing is declared/present. Never falls back to a default image.
 */
/**
 * Resolve a plugin's icon file from its package dir. Priority:
 *   1. `vesk.meta.json` → explicit `icon` field (absolute/relative path),
 *   2. conventional `icon.png` / `icon.ico` next to the plugin entry.
 * Returns the absolute icon path or null when none exists. No default image.
 */
function findIconFile(dir: string, meta: Record<string, unknown> | null): string | null {
  const explicit = str(meta?.icon);
  if (explicit) {
    const p = resolveWithin(dir, explicit);
    if (p && existsSync(p) && statSync(p).isFile()) return p;
  }
  for (const name of ['icon.png', 'icon.ico']) {
    const p = resolve(dir, name);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Resolve the icon a plugin declares in `vesk.meta.json` (or conventional
 * `icon.png`/`icon.ico`) from its package dir. Returns the absolute file plus
 * MIME, or null when nothing is declared/present. Never a default image. */
export function findPluginIcon(appDir: string, name: string): { file: string; mime: string } | null {
  const probe = resolvePackage(appDir, name);
  const dir = probe.dir;
  if (!dir) return null;
  const meta = readJsonFile<Record<string, unknown>>(resolve(dir, 'vesk.meta.json'));
  const iconPath = findIconFile(dir, meta);
  if (!iconPath) return null;
  const ext = extname(iconPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
  return { file: iconPath, mime };
}

/** Flatten package.json `exports` into a subpath → file-string map. */
function flattenPackageExports(exportsField: unknown): Record<string, string> | null {
  if (exportsField == null) return null;
  if (typeof exportsField === 'string') return { '.': exportsField };
  if (typeof exportsField !== 'object' || Array.isArray(exportsField)) return null;
  const out: Record<string, string> = {};
  for (const [subpath, value] of Object.entries(exportsField)) {
    const target = pickExportTarget(value);
    if (target) out[subpath] = target;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pickExportTarget(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = pickExportTarget(v);
      if (t) return t;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['types', 'import', 'default', 'require', 'node', 'browser']) {
      const t = pickExportTarget(obj[key]);
      if (t) return t;
    }
    return '';
  }
  return '';
}

/** Resolve the plugin's `.d.ts`: package.json `types`/`typesVersions`, else a
 * sibling `index.d.ts` / `main + '.d.ts'`. Returns null when nothing is found. */
function resolveDtsPath(probe: ResolvedPackage, pkgJson: Record<string, unknown>): string | null {
  const dir = probe.dir;
  if (!dir) return null;
  const candidates: string[] = [];
  const types = str(pkgJson.types) ?? str(pkgJson.typings);
  if (types) candidates.push(types);
  const typesVersions = pkgJson.typesVersions;
  if (!types && typesVersions && typeof typesVersions === 'object') {
    for (const mapped of Object.values(typesVersions as Record<string, unknown>)) {
      if (!mapped || typeof mapped !== 'object') continue;
      const star = (mapped as Record<string, unknown>)['*'];
      if (typeof star === 'string') { candidates.push(star); break; }
    }
  }
  const mainOrModule = str(pkgJson.main) ?? str(pkgJson.module);
  if (mainOrModule) {
    candidates.push(mainOrModule.replace(/\.[A-Za-z0-9]+$/, '.d.ts'));
    candidates.push(`${mainOrModule}.d.ts`);
  }
  candidates.push('index.d.ts');
  for (const rel of candidates) {
    if (!rel) continue;
    const abs = resolveWithin(dir, rel);
    if (abs && existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function isIdentStrict(t: string): boolean {
  return typeof t === 'string' && t.length > 0 &&
    IDENT_START.test(t[0]) && !t.includes('"') && !t.includes("'") && !t.includes('`');
}

function normalizeName(t: string): string {
  const s = String(t ?? '');
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'" || s[0] === '`') && s[s.length - 1] === s[0]) {
    return s.slice(1, -1);
  }
  return s;
}

function skipStringLiteral(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === '\\') { j += 2; continue; }
    if (source[j] === quote) return j + 1;
    j++;
  }
  return source.length;
}

function isDotAccess(source: string, start: number): boolean {
  if (start === 0) return false;
  const prev = source[start - 1];
  return prev === '.' || IDENT_PART.test(prev);
}

/** Scan to the end of one top-level statement (`;` at depth 0, or the closing
 * `}` of a bare declaration such as an interface with no trailing semi). */
function findStatementEnd(source: string, i: number): number {
  const len = source.length;
  let depth = 0;
  while (i < len) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && c !== ')' && c !== ']') {
        const next = i + 1 < len ? source[i + 1] : '';
        if (next !== '.' && next !== '(' && next !== '[' && next !== '<') return i + 1;
      }
      i++;
      continue;
    }
    if (c === ';' && depth === 0) return i + 1;
    i++;
  }
  return len;
}

function tokenizeStatement(rest: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && rest[i + 1] === '/') {
      const nl = rest.indexOf('\n', i);
      i = nl === -1 ? rest.length : nl + 1;
      continue;
    }
    if (c === '/' && rest[i + 1] === '*') {
      const end = rest.indexOf('*/', i + 2);
      i = end === -1 ? rest.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < rest.length && rest[j] !== quote) {
        if (rest[j] === '\\') j += 2; else j++;
      }
      tokens.push(rest.slice(i, Math.min(j + 1, rest.length)));
      i = j + 1;
      continue;
    }
    if (c === '.' && rest[i + 1] === '.' && rest[i + 2] === '.') { tokens.push('...'); i += 3; continue; }
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < rest.length && IDENT_PART.test(rest[i])) i++;
      tokens.push(rest.slice(start, i));
      continue;
    }
    tokens.push(c);
    i++;
  }
  return tokens;
}

/** Names exported by a `export { ... }` / `export type { ... }` list. */
function namesFromExportList(tokens: string[], startIdx: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (n: string): void => {
    const v = normalizeName(n);
    if (v && !seen.has(v)) { seen.add(v); names.push(v); }
  };
  let i = startIdx;
  while (i < tokens.length && tokens[i] !== '}') {
    const cur = tokens[i];
    const next = tokens[i + 1];
    if (cur === ',' || cur === 'type') { i++; continue; }
    if (next === 'as') { add(tokens[i + 2]); i += 3; continue; }
    if (cur !== 'as' && cur !== '}') { add(cur); i += 1; continue; }
    i++;
  }
  return names;
}

/** Binding names of a `const`/`let`/`var` export declaration. */
function declNames(tokens: string[], startIdx: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (n: string): void => {
    const v = normalizeName(n);
    if (v && !seen.has(v)) { seen.add(v); names.push(v); }
  };
  const isOpen = (t: string) => t === '{' || t === '(' || t === '[';
  const isClose = (t: string) => t === '}' || t === ')' || t === ']';
  const patternStack: string[] = [];
  let depth = 0;
  let seenEquals = false;
  let inType = false;
  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === ';') break;
    if (inType) {
      if (tok === '=' && depth === 0) { inType = false; seenEquals = true; }
      else if (isOpen(tok)) depth++;
      else if (isClose(tok)) depth = Math.max(0, depth - 1);
      continue;
    }
    if (isOpen(tok)) {
      depth++;
      if (!seenEquals) patternStack.push(tok);
      continue;
    }
    if (isClose(tok)) {
      depth = Math.max(0, depth - 1);
      if (!seenEquals && patternStack.length) patternStack.pop();
      continue;
    }
    if (depth === 0 && tok === ':' && !seenEquals) { inType = true; continue; }
    if (depth === 0 && tok === '=') { seenEquals = true; continue; }
    if (depth === 0 && tok === ',') { seenEquals = false; continue; }
    if (tok === '...') {
      if (!seenEquals && isIdentStrict(tokens[i + 1] as string)) add(tokens[i + 1] as string);
      i++;
      continue;
    }
    if (!seenEquals && isIdentStrict(tok)) add(tok);
  }
  return names;
}

/** Names exported by one top-level `export ...` statement body (after the keyword). */
function namesFromExportStatement(statementText: string): string[] {
  const tokens = tokenizeStatement(statementText);
  if (tokens.length === 0) return [];
  let idx = 0;
  const MODIFIERS = new Set(['declare', 'abstract', 'async', 'readonly', 'global']);
  while (idx < tokens.length && MODIFIERS.has(tokens[idx])) idx++;
  const kw = tokens[idx];
  if (kw === '{') return namesFromExportList(tokens, idx + 1);
  if (kw === '*') {
    if (tokens[idx + 1] === 'as' && isIdentStrict(tokens[idx + 2] as string)) return [tokens[idx + 2] as string];
    return [];
  }
  if (kw === '=') return [];
  if (kw === 'as') {
    const nsIdx = tokens.indexOf('namespace', idx + 1);
    if (nsIdx !== -1 && isIdentStrict(tokens[nsIdx + 1] as string)) return [tokens[nsIdx + 1] as string];
    return [];
  }
  if (kw === 'default') return ['default'];
  if (kw === 'import') return [];
  if (kw === 'type') {
    if (tokens[idx + 1] === '{') return namesFromExportList(tokens, idx + 2);
    if (isIdentStrict(tokens[idx + 1] as string)) return [tokens[idx + 1] as string];
    return [];
  }
  if (kw === 'var' || kw === 'let') return declNames(tokens, idx + 1);
  if (kw === 'const') {
    if (tokens[idx + 1] === 'enum') {
      if (isIdentStrict(tokens[idx + 2] as string)) return [tokens[idx + 2] as string];
      return [];
    }
    return declNames(tokens, idx + 1);
  }
  if (kw === 'function' || kw === 'class' || kw === 'interface' ||
      kw === 'enum' || kw === 'namespace' || kw === 'module') {
    let nameIdx = idx + 1;
    if (tokens[nameIdx] === '*') nameIdx++;
    if (isIdentStrict(tokens[nameIdx] as string)) return [tokens[nameIdx] as string];
    return [];
  }
  return [];
}

/**
 * Parse top-level `export ...` declarations from a `.d.ts` source into the
 * exported-name list (adapter text processing — no module execution). Wildcard
 * re-exports contribute nothing; `export { a as b }` yields `b`.
 */
export function parseDtsExports(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (n: string): void => {
    const v = normalizeName(n);
    if (v && !seen.has(v)) { seen.add(v); names.push(v); }
  };
  const len = source.length;
  let i = 0;
  let depth = 0;
  while (i < len) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipStringLiteral(source, i);
      continue;
    }
    if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth = Math.max(0, depth - 1); i++; continue; }
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < len && IDENT_PART.test(source[i])) i++;
      const word = source.slice(start, i);
      if (depth === 0 && word === 'export' && !isDotAccess(source, start)) {
        const stmtEnd = findStatementEnd(source, i);
        const exported = namesFromExportStatement(source.slice(i, stmtEnd));
        for (const n of exported) add(n);
        i = stmtEnd;
        continue;
      }
      continue;
    }
    i++;
  }
  return names;
}

/**
 * Introspect an installed plugin's public surface WITHOUT importing/executing
 * it: resolved entry (package.json main/module), flat package.json `exports`
 * map, and the `.d.ts`-parsed export names.
 */
export function introspectPlugin(appDir: string, name: string): PluginExportsInfo {
  const probe = resolvePackage(appDir, name);
  if (!probe.installed || !probe.packageJson) {
    return { ok: false, name, entry: null, packageJsonExports: null, dtsPath: null, dtsExports: [] };
  }
  const pkgJson = probe.packageJson;
  const pkgName = str(pkgJson.name) ?? name;
  const exportsMap = flattenPackageExports(pkgJson.exports);
  const dtsPath = resolveDtsPath(probe, pkgJson);
  const dtsExports = dtsPath ? parseDtsExports(readFileSync(dtsPath, 'utf-8')) : [];
  return {
    ok: true,
    name: pkgName,
    entry: probe.path,
    packageJsonExports: exportsMap,
    dtsPath,
    dtsExports,
  };
}

// ─── npm registry (best-effort, bounded, cached) ───────────────────────────

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

async function fetchWithSignal(url: string): Promise<Response | null> {
  const fetchFn = __internals.fetch;
  if (typeof fetchFn !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    return await fetchFn(url, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRegistryJson(url: string): Promise<unknown | null> {
  const cached = registryCache.get(url);
  const now = Date.now();
  if (cached && now - cached.at < REGISTRY_CACHE_TTL_MS) return cached.value;
  const res = await fetchWithSignal(url);
  let value: unknown = null;
  if (res && res.ok) {
    try { value = await res.json(); } catch { value = null; }
  }
  // only cache successful responses; a failed/timed-out fetch must be retried
  // on the next request instead of returning a stale empty result for 5 min
  if (value !== null && res && res.ok) registryCache.set(url, { at: now, value });
  return value;
}

/** Strip a version/tag suffix (`foo@1.2.3` → `foo`, keep `@scope/name`). */
function normalizeRegistryName(pkg: string): string {
  const name = String(pkg || '');
  if (!name) return name;
  const at = name.lastIndexOf('@');
  if (at > 0) return name.slice(0, at);
  return name;
}

/**
 * Best-effort npm-registry enrichment for a single package. Non-fatal: any
 * fetch/timeout/json failure yields null so a record stays readable.
 */
async function fetchPackageRegistryInfo(pkg: string): Promise<{
  latest: string | null;
  updatedAt: string | null;
  author: string | null;
  repository: string | null;
  license: string | null;
  description: string | null;
} | null> {
  const name = normalizeRegistryName(pkg);
  if (!name) return null;
  const url = `https://registry.npmjs.org/${name.split('/').map(encodeURIComponent).join('/')}`;
  const data = await fetchRegistryJson(url);
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const distTags = obj['dist-tags'];
  const time = obj.time;
  let latest: string | null = null;
  if (distTags && typeof distTags === 'object') {
    latest = str((distTags as Record<string, unknown>).latest);
  }
  let updatedAt: string | null = null;
  if (time && typeof time === 'object') {
    updatedAt = str((time as Record<string, unknown>).modified);
  }
  return {
    latest,
    updatedAt,
    author: authorToString(obj.author),
    repository: repositoryToString(obj.repository),
    license: str(obj.license),
    description: str(obj.description),
  };
}

/**
 * Fill registry-backed fields (latest, updatedAt, and any still-empty
 * author/repository/license/description) on the given records, best-effort and
 * cached so repeated GETs never hang. Returns the same array (mutated).
 */
export async function enrichPluginRecords(records: PluginRecord[]): Promise<PluginRecord[]> {
  for (const record of records) {
    if (!record.installed) continue;
    const info = await fetchPackageRegistryInfo(record.package);
    if (!info) continue;
    if (record.latest === null && info.latest) record.latest = info.latest;
    if (record.updatedAt === null && info.updatedAt) record.updatedAt = info.updatedAt;
    if (record.author === null) record.author = info.author;
    if (record.repository === null) record.repository = info.repository;
    if (record.license === null) record.license = info.license;
    if (record.description === null) record.description = info.description;
  }
  return records;
}

/**
 * Search the npm registry (proxied). Empty `q` surfaces a curated `@vesk/*`
 * scope set (`scope:vesk`). Best-effort: an unreachable registry yields `[]`.
 */
export async function searchPlugins(q: string): Promise<PluginSearchResult[]> {
  const query = q && q.trim() ? q.trim() : 'scope:vesk';
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}`;
  const data = await fetchRegistryJson(url);
  if (!data || typeof data !== 'object') return [];
  const objects = (data as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) return [];
  const out: PluginSearchResult[] = [];
  for (const obj of objects) {
    const pkgField = (obj as Record<string, unknown>)?.package;
    if (!pkgField || typeof pkgField !== 'object') continue;
    const p = pkgField as Record<string, unknown>;
    const links = p.links && typeof p.links === 'object' ? p.links as Record<string, string> : null;
    out.push({
      name: str(p.name) ?? '',
      version: str(p.version),
      description: str(p.description),
      author: authorToString(p.author),
      date: str(p.date),
      keywords: asKeywords(p.keywords),
      links: links ? { ...links } : null,
    });
  }
  return out;
}

// ─── internals (test seam) ──────────────────────────────────────────────────
export const __internals = {
  runNpm,
  fetch: ((url: string, init?: RequestInit) => globalThis.fetch(url, init)) as FetchLike,
  clearRegistryCache: (): void => { registryCache.clear(); },
};