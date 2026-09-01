import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

function configPath(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', 'config.json');
}
function keyPath(projectDir: string): string {
  return resolve(projectDir, '.vesk', 'agentic', '.key');
}

export function loadAgenticConfig(projectDir: string): AgenticConfig & { hasKey: boolean } {
  const p = configPath(projectDir);
  let cfg: AgenticConfig = { ...DEFAULT_CONFIG };
  try { if (existsSync(p)) cfg = { ...cfg, ...JSON.parse(readFileSync(p, 'utf-8')) }; } catch {}
  const hasKey = existsSync(keyPath(projectDir)) || !!process.env.VESK_AGENTIC_API_KEY || !!process.env.OPENCODE_API_KEY;
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

export function saveApiKey(projectDir: string, apiKey: string): void {
  const p = keyPath(projectDir);
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, apiKey, { mode: 0o600 }); } catch {}
  // also set env for current process
  process.env.VESK_AGENTIC_API_KEY = apiKey;
}

export function getApiKey(projectDir: string): string | null {
  if (process.env.VESK_AGENTIC_API_KEY) return process.env.VESK_AGENTIC_API_KEY;
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  try { const p = keyPath(projectDir); if (existsSync(p)) return readFileSync(p, 'utf-8').trim(); } catch {}
  return null;
}
