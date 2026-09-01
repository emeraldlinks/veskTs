import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface AgenticConfig {
  provider: 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama';
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

export const SUPPORTED_PROVIDERS: string[] = ['openai', 'openai-compatible', 'anthropic', 'google', 'ollama'];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function configPath(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', 'config.json');
}
function keyPath(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', '.key');
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
function providerKeyPath(projectDir: string, provider: string): string {
  return resolve(keysDir(projectDir), `${sanitizeProvider(provider)}.key`);
}
function providerEnvVar(provider: string): string {
  return `VESK_AGENTIC_API_KEY_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

// ---------------------------------------------------------------------------
// Config (non-secret)
// ---------------------------------------------------------------------------

export function loadAgenticConfig(projectDir: string): AgenticConfig & { hasKey: boolean } {
  const p = configPath(projectDir);
  let cfg: AgenticConfig = { ...DEFAULT_CONFIG };
  try { if (existsSync(p)) cfg = { ...cfg, ...JSON.parse(readFileSync(p, 'utf-8')) }; } catch {}
  // hasKey = true if any key exists (per-provider or legacy or env)
  let hasKey = false;
  try {
    if (existsSync(keyPath(projectDir))) hasKey = true;
    else if (process.env.VESK_AGENTIC_API_KEY && process.env.VESK_AGENTIC_API_KEY.trim()) hasKey = true;
    else if (process.env.OPENCODE_API_KEY && process.env.OPENCODE_API_KEY.trim()) hasKey = true;
    else {
      // check per-provider env/files
      for (const prov of SUPPORTED_PROVIDERS) {
        const envName = providerEnvVar(prov);
        if (process.env[envName] && process.env[envName]!.trim()) { hasKey = true; break; }
        if (existsSync(providerKeyPath(projectDir, prov))) { hasKey = true; break; }
      }
      if (!hasKey) {
        try {
          const dir = keysDir(projectDir);
          if (existsSync(dir)) {
            const files = readdirSync(dir);
            if (files.some(f => f.endsWith('.key') && f.trim() !== '')) {
              // verify at least one file non-empty
              for (const f of files) {
                if (!f.endsWith('.key')) continue;
                try {
                  const full = resolve(dir, f);
                  const v = readFileSync(full, 'utf-8').trim();
                  if (v) { hasKey = true; break; }
                } catch {}
              }
            }
          }
        } catch {}
      }
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
  const envName = providerEnvVar(prov);
  const specific = process.env[envName];
  if (specific && specific.trim()) return specific.trim();
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
 * Per-provider keys are stored at `.vesk/agentic/keys/{provider}.key` with 0600.
 * Legacy form writes to `.vesk/agentic/.key`.
 */
export function saveApiKey(projectDir: string, providerOrApiKey: string, apiKeyMaybe?: string): void {
  let provider: string | null;
  let apiKey: string;
  if (apiKeyMaybe === undefined) {
    // legacy 2-arg
    provider = null;
    apiKey = providerOrApiKey;
  } else {
    provider = providerOrApiKey;
    apiKey = apiKeyMaybe;
  }
  if (typeof apiKey !== 'string') apiKey = String(apiKey ?? '');
  // normalize provider
  if (provider !== null) {
    provider = provider.trim();
    if (!provider) provider = null;
  }

  if (provider) {
    const p = providerKeyPath(projectDir, provider);
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, apiKey, { mode: 0o600 });
      try { chmodSync(p, 0o600); } catch {}
    } catch {}
    // set per-provider env for current process
    try {
      const envName = providerEnvVar(provider);
      process.env[envName] = apiKey;
      // also set generic env for backward compat if not already set? Do not overwrite generic if it already points elsewhere;
      // but ensure generic is set for callers that use old getApiKey() without provider.
      // We set generic only if provider is 'openai' or if generic not set — to avoid cross-contamination, prefer per-provider env only.
      // For safety, also set generic when legacy file doesn't exist and generic env empty:
      // (uncomment if needed)
      // if (!process.env.VESK_AGENTIC_API_KEY) process.env.VESK_AGENTIC_API_KEY = apiKey;
    } catch {}
  } else {
    // legacy
    const p = keyPath(projectDir);
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, apiKey, { mode: 0o600 });
      try { chmodSync(p, 0o600); } catch {}
    } catch {}
    try { process.env.VESK_AGENTIC_API_KEY = apiKey; } catch {}
  }
}

/**
 * Get API key. With `provider`, precedence:
 *   1. VESK_AGENTIC_API_KEY_{PROVIDER} env (uppercased, non-alnum -> _)
 *   2. .vesk/agentic/keys/{provider}.key
 *   3. legacy .vesk/agentic/.key
 *   4. VESK_AGENTIC_API_KEY env (generic)
 *   5. OPENCODE_API_KEY env (legacy alias)
 * Without provider: generic env -> legacy file -> null
 */
export function getApiKey(projectDir: string, provider?: string): string | null {
  const hasProvider = typeof provider === 'string' && provider.trim().length > 0;
  if (hasProvider) {
    const prov = provider!.trim();
    // 1. per-provider env
    const envName = providerEnvVar(prov);
    const specific = process.env[envName];
    if (specific && specific.trim()) return specific.trim();
    // 2. per-provider file
    try {
      const pp = providerKeyPath(projectDir, prov);
      if (existsSync(pp)) {
        const v = readFileSync(pp, 'utf-8').trim();
        if (v) return v;
      }
    } catch {}
    // 3. legacy .key
    try {
      const lp = keyPath(projectDir);
      if (existsSync(lp)) {
        const v = readFileSync(lp, 'utf-8').trim();
        if (v) return v;
      }
    } catch {}
    // 4. generic env
    if (process.env.VESK_AGENTIC_API_KEY && process.env.VESK_AGENTIC_API_KEY.trim()) return process.env.VESK_AGENTIC_API_KEY.trim();
    if (process.env.OPENCODE_API_KEY && process.env.OPENCODE_API_KEY.trim()) return process.env.OPENCODE_API_KEY.trim();
    return null;
  } else {
    // no provider — legacy behavior + also check if any provider env? Keep old order: env then legacy
    if (process.env.VESK_AGENTIC_API_KEY && process.env.VESK_AGENTIC_API_KEY.trim()) return process.env.VESK_AGENTIC_API_KEY.trim();
    if (process.env.OPENCODE_API_KEY && process.env.OPENCODE_API_KEY.trim()) return process.env.OPENCODE_API_KEY.trim();
    try {
      const lp = keyPath(projectDir);
      if (existsSync(lp)) {
        const v = readFileSync(lp, 'utf-8').trim();
        if (v) return v;
      }
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
  // discover additional providers from keys directory
  try {
    const dir = keysDir(projectDir);
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const f of files) {
        if (f.endsWith('.key')) {
          const name = f.slice(0, -4);
          if (name) seen.add(name);
        }
      }
    }
  } catch {}
  // also consider env vars for providers not in seen? Scan process.env for VESK_AGENTIC_API_KEY_* 
  try {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('VESK_AGENTIC_API_KEY_') && k !== 'VESK_AGENTIC_API_KEY') {
        const prov = k.slice('VESK_AGENTIC_API_KEY_'.length).toLowerCase().replace(/_/g, '-');
        seen.add(prov);
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
