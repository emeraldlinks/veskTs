import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface AgenticConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'opencode' | 'opencode-go' | 'openrouter' | 'loopers' | 'custom';
  model: string;
  baseUrl?: string;
  mode: 'explore' | 'debug' | 'agent';
  maxSteps: number;
}

const DEFAULT_CONFIG: AgenticConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'explore',
  maxSteps: 10,
};

export const SUPPORTED_PROVIDERS: string[] = [
  'openai', 'anthropic', 'google', 'ollama',
  'opencode', 'opencode-go', 'openrouter', 'loopers', 'custom',
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function configPath(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', 'config.json');
}
function keysDir(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', 'keys');
}
function sanitizeProvider(provider: string): string {
  // keep lower-case, replace path separators and disallowed chars
  const p = provider.trim().toLowerCase();
  if (!p) return 'default';
  // replace any slash/backslash or .. and non-alnum except - _ .
  return p.replace(/[\/\\]+/g, '_').replace(/[^a-z0-9_.-]/g, '_') || 'default';
}
function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}
function providerKeyPath(projectDir: string, provider: string): string {
  return resolve(keysDir(projectDir), `${sanitizeProvider(provider)}.key`);
}

// ── .env.local provider keys (VK_{PROVIDER}_KEY) ────────────────────────────
// Primary key store: project `.env.local` holds one line per provider, e.g.
//   VK_OPENAI_KEY=sk-...
//   VK_OPENCODE_KEY=sk-...
//   VK_OPENCODE_GO_KEY=sk-...
// These are read into `process.env` at CLI startup via loadEnvFiles, so
// reading `process.env` reflects the file. Saving rewrites the file so the
// change persists for later `vesk dev`/`vesk start` runs.
export function providerDotenvVar(provider: string): string {
  const prov = sanitizeProvider(provider);
  // opencode-go -> VK_OPENCODE_GO_KEY
  return `VK_${prov.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;
}
export function dotenvPath(projectDir: string): string {
  return resolve(projectDir, '.env.local');
}

/**
 * Read a provider key from the project `.env.local` file.
 * Note: normally `process.env` already reflects `.env.local` (loaded at CLI
 * startup); this reads the file directly as a defensive fallback (e.g. when
 * the file changed after startup, or callers didn't go through loadEnvFiles).
 */
export function readDotenvValue(projectDir: string, key: string, def: string | null = null): string | null {
  try {
    const p = dotenvPath(projectDir);
    if (!existsSync(p)) return def;
    const content = readFileSync(p, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      return val;
    }
    return def;
  } catch {
    return def;
  }
}

/**
 * Set a `KEY=VALUE` line in the project `.env.local`, creating the file if
 * missing, updating in place if present. Also mirrors into `process.env` so
 * the current process sees it immediately. Returns true on success.
 */
export function writeDotenvValue(projectDir: string, key: string, value: string): boolean {
  const p = dotenvPath(projectDir);
  const pad = value && !value.startsWith('#');
  const newLine = `${key}=${pad && /^[A-Za-z0-9_@./:+-]+$/.test(value) ? value : JSON.stringify(value)}`;
  try {
    let out = '';
    let replaced = false;
    if (existsSync(p)) {
      const lines = readFileSync(p, 'utf-8').split('\n');
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        const eq = trimmed.indexOf('=');
        if (eq !== -1 && trimmed.slice(0, eq).trim() === key) {
          out += newLine + '\n';
          replaced = true;
        } else {
          out += rawLine + '\n';
        }
      }
    }
    if (!replaced) out += newLine + '\n';
    writeFileSync(p, out, { mode: 0o600 });
    try { chmodSync(p, 0o600); } catch {}
    process.env[key] = value;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config (non-secret)
// ---------------------------------------------------------------------------

export function loadAgenticConfig(projectDir: string): AgenticConfig & { hasKey: boolean } {
  const p = configPath(projectDir);
  let cfg: AgenticConfig = { ...DEFAULT_CONFIG };
  try { if (existsSync(p)) cfg = { ...cfg, ...JSON.parse(readFileSync(p, 'utf-8')) }; } catch {}
  // hasKey = true if any provider key is set (read from .env.local VK_*_KEY)
  let hasKey = false;
  try {
    for (const prov of SUPPORTED_PROVIDERS) {
      if (getProviderSpecificKey(projectDir, prov)) { hasKey = true; break; }
    }
  } catch {}
  return { ...cfg, hasKey };
}

export function saveAgenticConfig(projectDir: string, patch: Partial<AgenticConfig>): AgenticConfig {
  const p = configPath(projectDir);
  const current = loadAgenticConfig(projectDir);
  const next: AgenticConfig = { ...DEFAULT_CONFIG, ...current, ...patch } as AgenticConfig;
  // never store apiKey in config.json
  const toWrite: Record<string, unknown> = { provider: next.provider, model: next.model, mode: next.mode, maxSteps: next.maxSteps };
  if (next.baseUrl) toWrite.baseUrl = next.baseUrl;
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(toWrite, null, 2), 'utf-8'); } catch {}
  return next;
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

export function maskApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return '***';
  return trimmed.slice(0, 7) + '***' + trimmed.slice(-4);
}

// aliases for "masked preview per provider" requirement — multiple names for compatibility
export const maskKey = maskApiKey;
export const maskedPreview = maskApiKey;
export function getMaskedKey(projectDir: string, provider: string): string | null {
  return getKeyPreview(projectDir, provider);
}
export function getApiKeyPreview(projectDir: string, provider: string): string | null {
  return getKeyPreview(projectDir, provider);
}
export function getMaskedPreview(projectDir: string, provider: string): string | null {
  return getKeyPreview(projectDir, provider);
}
export function getKeyPreview(projectDir: string, provider: string): string | null {
  // preview per provider — mask the result of getApiKey (which includes fallback to legacy/generic)
  // This matches spec: getApiKey with provider checks env provider, file, legacy, generic
  const key = getApiKey(projectDir, provider);
  return maskApiKey(key);
}

// internal helper for per-provider direct lookup (no legacy/generic fallback)
function getProviderSpecificKey(projectDir: string, provider: string): string | null {
  if (!provider || !provider.trim()) return null;
  const prov = provider.trim();
  // 0. .env.local VK_*_KEY (primary) — process.env reflects the file at startup
  const dotenvName = providerDotenvVar(prov);
  const dotenvEnv = process.env[dotenvName];
  if (dotenvEnv && dotenvEnv.trim()) return dotenvEnv.trim();
  const dotenvFile = readDotenvValue(projectDir, dotenvName);
  if (dotenvFile && dotenvFile.trim()) return dotenvFile.trim();
  // 1. legacy per-provider file (compat fallback)
  try {
    const pp = providerKeyPath(projectDir, prov);
    if (existsSync(pp)) {
      const v = readFileSync(pp, 'utf-8').trim();
      if (v) return v;
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Per-provider keys
// ---------------------------------------------------------------------------

/**
 * Save an API key for a specific provider.
 *
 * Supports both new 3-arg form `saveApiKey(projectDir, provider, apiKey)`
 * and legacy 2-arg form `saveApiKey(projectDir, apiKey)` for backward compat.
 * Keys are stored in project `.env.local` as VK_{PROVIDER}_KEY (0600).
 * The legacy 2-arg form targets the currently-configured provider.
 */
export function saveApiKey(projectDir: string, providerOrApiKey: string, apiKeyMaybe?: string): void {
  let provider: string | null;
  let apiKey: string;
  if (apiKeyMaybe === undefined) {
    // legacy 2-arg — target the currently-configured provider
    provider = loadAgenticConfig(projectDir).provider;
    apiKey = providerOrApiKey;
  } else {
    provider = providerOrApiKey;
    apiKey = apiKeyMaybe;
  }
  if (typeof apiKey !== 'string') apiKey = String(apiKey ?? '');
  if (provider !== null) {
    provider = provider.trim();
    if (!provider) provider = null;
  }

  if (provider) {
    // Primary: write/update the provider line in project .env.local (VK_*_KEY)
    const dotenvName = providerDotenvVar(provider);
    writeDotenvValue(projectDir, dotenvName, apiKey);
  } else {
    // no provider configured — fall back to the openai line
    writeDotenvValue(projectDir, providerDotenvVar('openai'), apiKey);
  }
}

/**
 * Get API key for a provider.
 * Precedence:
 *   1. .env.local VK_{PROVIDER}_KEY (primary store; reflected in process.env)
 *   2. (fallback) legacy .vesk/agentic/keys/{provider}.key
 * If `provider` is omitted, returns the key for the currently-configured
 * provider, else null.
 */
export function getApiKey(projectDir: string, provider?: string): string | null {
  const hasProvider = typeof provider === 'string' && provider.trim().length > 0;
  if (hasProvider) {
    const prov = provider!.trim();
    const dotenvName = providerDotenvVar(prov);
    if (process.env[dotenvName] && process.env[dotenvName]!.trim()) return process.env[dotenvName]!.trim();
    try {
      const df = readDotenvValue(projectDir, dotenvName);
      if (df && df.trim()) return df.trim();
    } catch {}
    try {
      const pp = providerKeyPath(projectDir, prov);
      if (existsSync(pp)) {
        const v = readFileSync(pp, 'utf-8').trim();
        if (v) return v;
      }
    } catch {}
    return null;
  } else {
    const prov = normalizeProvider(loadAgenticConfig(projectDir).provider);
    const dotenvName = providerDotenvVar(prov);
    if (process.env[dotenvName] && process.env[dotenvName]!.trim()) return process.env[dotenvName]!.trim();
    try {
      const df = readDotenvValue(projectDir, dotenvName);
      if (df && df.trim()) return df.trim();
    } catch {}
    return null;
  }
}

// hasKey / hasApiKey — per-provider check

export function hasApiKey(projectDirOrProvider: string, providerMaybe?: string): boolean {
  let projectDir: string;
  let provider: string | undefined;
  if (providerMaybe !== undefined) {
    projectDir = projectDirOrProvider;
    provider = providerMaybe;
  } else {
    // single arg — could be provider name or projectDir
    const arg = projectDirOrProvider;
    // heuristic: if arg is a known provider or doesn't look like a path, treat as provider with cwd
    const isProviderName = SUPPORTED_PROVIDERS.includes(arg) || SUPPORTED_PROVIDERS.includes(arg.toLowerCase());
    const looksLikePath = arg.includes('/') || arg.includes('\\') || arg.startsWith('.') || arg.includes(':');
    if (isProviderName && !looksLikePath) {
      projectDir = process.cwd();
      provider = arg;
    } else if (!looksLikePath && /^[a-z0-9_.-]+$/i.test(arg) && arg.length < 30 && !existsSync(resolve(arg, '.vesk'))) {
      // ambiguous short string without path separators — treat as provider if it's in supported list or single word
      // but to avoid false positive for projectDir like "/tmp/foo", we check existsSync for .vesk fallback above.
      // If it doesn't look like a path and is known provider, already handled; otherwise treat as projectDir without provider
      // For safety, if arg matches provider pattern and is short, consider it provider.
      // We'll default to projectDir without provider for hasKey(projectDir) calls.
      // To cover both, check if arg is supported provider else treat as projectDir
      if (SUPPORTED_PROVIDERS.includes(arg.toLowerCase())) {
        projectDir = process.cwd();
        provider = arg;
      } else {
        projectDir = arg;
        provider = undefined;
      }
    } else {
      projectDir = arg;
      provider = undefined;
    }
  }
  return !!getApiKey(projectDir, provider);
}

// primary name "hasKey" per prompt
export const hasKey = hasApiKey;
// additional alias used in some codebases
export const hasApiKeys = hasApiKey;

// listApiKeys

export function listApiKeys(projectDir: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const seen = new Set<string>(SUPPORTED_PROVIDERS);
  // discover additional providers from .env.local VK_*_KEY lines
  try {
    const p = dotenvPath(projectDir);
    if (existsSync(p)) {
      for (const rawLine of readFileSync(p, 'utf-8').split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith('VK_') || !trimmed.endsWith('_KEY=') && !trimmed.includes('_KEY=')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        if (!k.startsWith('VK_') || !k.endsWith('_KEY')) continue;
        const prov = k.slice(3, -4).toLowerCase().replace(/_/g, '-');
        if (prov) seen.add(prov);
      }
    }
  } catch {}
  // also consider VK_*_KEY env vars not in seen
  try {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('VK_') && k.endsWith('_KEY')) {
        const prov = k.slice(3, -4).toLowerCase().replace(/_/g, '-');
        if (prov) seen.add(prov);
      }
    }
  } catch {}
  for (const p of seen) {
    try {
      out[p] = !!getApiKey(projectDir, p);
    } catch {
      out[p] = false;
    }
  }
  // Ensure supported providers always present
  for (const p of SUPPORTED_PROVIDERS) if (!(p in out)) out[p] = false;
  return out;
}
