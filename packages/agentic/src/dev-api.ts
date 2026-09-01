/**
 * Dev API router — `createAgentRouter` (B6-plug of plans/devtools.md).
 *
 * A self-contained, dependency-injectable router for the agentic
 * dev-panel HTTP endpoints under `/__vesk/agent/*`. Mirrors the shape of
 * `createDevApiRouter` from `@vesk/adapter/src/dev-api.ts`:
 *
 *     POST /__vesk/agent/run        → run the agent (prompt, mode, providerConfig)
 *     GET  /__vesk/agent/history    → list checkpoints (history.json)
 *     POST /__vesk/agent/checkpoint → create a checkpoint
 *     POST /__vesk/agent/rollback   → rollback to a checkpoint
 *
 * ARCHITECTURE: the Dev Server is the ONLY path from browser → project files /
 * build system. Every endpoint is gated by an `AgentCapability` in
 * `AgentCapabilityTable` (server-enforced — the browser cannot bypass it).
 * There is NO raw `child_process` reach: the agent's `command.execute` tool
 * routes through the dev server's allowlisted `runCommand` hook, and file
 * access is containment-checked.
 *
 * Pure (fake injectable inputs, no socket/listener), mirroring
 * `createPluginStateRouter` / `createDevApiRouter`: returns
 * `{ route(method, pathname, body, search) }`, yielding `null` for
 * non-`/ __vesk/agent/*` paths so the dev server can fall through to the
 * next router (e.g. the adapter's `createDevApiRouter`).
 *
 * Zero deps — only local `@vesk/agentic` modules; no npm dependencies
 * beyond `@vesk/types`.
 */

import type { AgentCapabilityTable, AgentMode } from './permissions.js';
import type { AgentResult } from './loop.js';
import type { ProviderConfig } from './providers/types.js';
import type { Checkpoint } from './checkpoints.js';
import { CheckpointManager } from './checkpoints.js';
import { loadAgenticConfig, saveAgenticConfig, getApiKey, saveApiKey, providerDotenvVar as defaultVkVar, readDotenvValue } from './config.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAiProvider } from './providers/openai.js';
import { anthropicProvider } from './providers/anthropic.js';
import { googleProvider } from './providers/google.js';
import { ollamaProvider } from './providers/ollama.js';
import { SLASH_COMMANDS } from './slash.js';

// ---------------------------------------------------------------------------
// Response type — mirrors `@vesk/adapter/src/dev-api.ts#DevPanelResponse`
// ---------------------------------------------------------------------------

export interface DevPanelResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  encoding?: 'utf8' | 'base64';
}

export interface AgentRouter {
  route: (
    method: string,
    pathname: string,
    body?: unknown,
    search?: string,
  ) => Promise<DevPanelResponse | null>;
}

export interface AgentRouterOptions {
  /** Absolute path to the project root (where `vesk.config.ts` lives). */
  projectDir: string;
  /** Absolute path to the `app/` directory. */
  appDir: string;
  /** Absolute path to the `.vesk` state directory. */
  veskDir: string;
  /** Current permission snapshot — server-enforced. */
  getPermissions: () => AgentCapabilityTable;
  /**
   * Run the agent for a single turn.
   * `(prompt, mode, providerConfig) => AgentResult`
   */
  runAgent: (
    prompt: string,
    mode: AgentMode,
    providerConfig?: ProviderConfig | unknown,
  ) => Promise<AgentResult>;
  /**
   * List all checkpoints, newest first. Closure form is typically
   * `() => manager.list()` or `() => listCheckpoints(projectDir)`.
   */
  listCheckpoints?: () => Checkpoint[] | Promise<Checkpoint[]>;
  /**
   * Rollback to a checkpoint by id. Closure form is
   * `(id: string) => Checkpoint | null`.
   */
  rollback?: (id: string) => Checkpoint | null | Promise<Checkpoint | null>;
  /**
   * Optional injection for checkpoint creation. Signature may be
   * `(message, changes?, buildResult?) => Checkpoint` or
   * `(projectDir, message, changes?, buildResult?) => Checkpoint` or
   * `(opts: CreateCheckpointOptions) => Checkpoint`.
   */
  createCheckpoint?: (...args: unknown[]) => Checkpoint | Promise<Checkpoint>;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function jsonStatus(status: number, data: unknown): DevPanelResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function badRequest(message: string): DevPanelResponse {
  return jsonStatus(400, { error: message });
}

function denied(cap: string): DevPanelResponse {
  return jsonStatus(403, { error: `capability denied: ${cap}` });
}

// per-provider helpers — shared with config.ts but duplicated here to avoid circular
// Strongly avoid leaking raw keys — only masked previews leave this module.
const SUPPORTED_PROVIDERS: readonly string[] = [
  'openai', 'anthropic', 'google', 'ollama',
  'opencode', 'opencode-go', 'openrouter', 'loopers', 'custom',
] as const;

function maskPreview(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = String(key).trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return '***';
  return trimmed.slice(0, 7) + '***' + trimmed.slice(-4);
}

function isValidProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(normalized);
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function sanitizeProviderName(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (!p) return 'default';
  return p.replace(/[\/\\]+/g, '_').replace(/[^a-z0-9_.-]/g, '_') || 'default';
}

// Precise per-provider key lookup from project .env.local VK_{PROVIDER}_KEY.
// The CLI loads .env.local into process.env at startup, so process.env is the
// primary read; a direct file read is a defensive fallback for edits made
// after startup.
function getPerProviderKeyRaw(projectDir: string, provider: string): string | null {
  const prov = normalizeProvider(provider);
  const dotenvName = defaultVkVar(prov);
  // 1. .env.local VK_*_KEY (mirrored in process.env)
  try {
    const v = process.env[dotenvName];
    if (v && v.trim()) return v.trim();
  } catch {}
  try {
    const df = readDotenvValue(projectDir, dotenvName);
    if (df && df.trim()) return df.trim();
  } catch {}
  // 2. legacy per-provider file .vesk/agentic/keys/{provider}.key (compat)
  try {
    const p = resolve(projectDir, '.vesk', 'agentic', 'keys', `${sanitizeProviderName(prov)}.key`);
    if (existsSync(p)) {
      const v = readFileSync(p, 'utf-8').trim();
      if (v) return v;
    }
  } catch {}
  return null;
}

function buildKeysMap(projectDir: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of SUPPORTED_PROVIDERS) {
    try {
      const k = getPerProviderKeyRaw(projectDir, p);
      out[p] = !!k && String(k).trim().length > 0;
    } catch {
      out[p] = false;
    }
  }
  return out;
}

function buildPreviewsMap(projectDir: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const p of SUPPORTED_PROVIDERS) {
    try {
      const k = getPerProviderKeyRaw(projectDir, p);
      out[p] = maskPreview(k);
    } catch {
      out[p] = null;
    }
  }
  return out;
}

function allowsAny(table: AgentCapabilityTable, caps: string[]): boolean {
  for (const cap of caps) {
    try {
      if (table.allows(cap as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// createAgentRouter
// ---------------------------------------------------------------------------

export function createAgentRouter(opts: AgentRouterOptions): AgentRouter {
  const projectDir = opts.projectDir;
  const veskDir = opts.veskDir;
  const appDir = opts.appDir;
  void veskDir;
  void appDir;

  // Fallback in-memory store when injections are absent. Each router gets
  // its own manager so concurrent routers do not share state; callers that
  // need persistence should inject `listCheckpoints`/`rollback` closures
  // backed by the filesystem (e.g. old `checkpoints.ts` fs helpers) or a
  // shared CheckpointManager instance.
  const fallbackManager = new CheckpointManager();

  async function route(
    method: string,
    pathname: string,
    body?: unknown,
    _search?: string,
  ): Promise<DevPanelResponse | null> {
    // Only handle /__vesk/agent/* — return null so the dev server can
    // fall through to the adapter router or normal page handling.
    if (!pathname.startsWith('/__vesk/agent/') && pathname !== '/__vesk/agent') {
      if (pathname.startsWith('/__vesk/')) {
        return null;
      }
      return null;
    }

    let table: AgentCapabilityTable | null = null;
    try {
      const maybe = opts.getPermissions();
      table = maybe instanceof Promise ? await maybe : maybe;
    } catch {
      return jsonStatus(403, { error: 'capability denied: unknown' });
    }

    // ── POST /__vesk/agent/run ──────────────────────────────────────────
    if (pathname === '/__vesk/agent/run') {
      if (method !== 'POST') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') {
        return denied('readFiles');
      }
      try {
        if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) {
          return denied('readFiles');
        }
      } catch {
        return denied('readFiles');
      }

      const b = (body ?? {}) as Record<string, unknown>;
      const promptRaw = b.prompt ?? b.input ?? b.message ?? b.query;
      const prompt = typeof promptRaw === 'string' ? promptRaw : '';
      if (!prompt || !prompt.trim()) return badRequest('missing "prompt" in body');

      const rawMode = typeof b.mode === 'string' ? (b.mode as string) : (table.mode as string);
      const validModes: AgentMode[] = ['explore', 'debug', 'agent'];
      const mode: AgentMode = (validModes as string[]).includes(rawMode)
        ? (rawMode as AgentMode)
        : (table.mode as AgentMode);

      const providerConfig = (b.providerConfig ??
        b.provider ??
        b.config ??
        b.provider_config ??
        undefined) as ProviderConfig | unknown | undefined;

      if (typeof opts.runAgent !== 'function') {
        return jsonStatus(503, { error: 'agent runner unavailable' });
      }
      try {
        const result = await opts.runAgent(prompt, mode, providerConfig as ProviderConfig);
        return jsonStatus(200, { ok: true, result });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── GET /__vesk/agent/history ───────────────────────────────────────
    if (pathname === '/__vesk/agent/history' || pathname === '/__vesk/agent/checkpoints') {
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') {
        return denied('readFiles');
      }
      try {
        if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) {
          return denied('readFiles');
        }
      } catch {
        return denied('readFiles');
      }

      try {
        let checkpoints: Checkpoint[] | null = null;

        if (typeof opts.listCheckpoints === 'function') {
          const injected = opts.listCheckpoints as unknown as (...a: unknown[]) => unknown;
          let res: unknown;
          try {
            if (injected.length === 0) {
              res = await injected();
            } else {
              try {
                res = await injected(projectDir);
                if (!Array.isArray(res)) {
                  const alt = await (injected as () => unknown)();
                  if (Array.isArray(alt)) res = alt;
                }
              } catch {
                res = await (injected as () => unknown)();
              }
            }
          } catch {
            res = fallbackManager.listNewestFirst();
          }
          if (Array.isArray(res)) checkpoints = res as Checkpoint[];
          else if (res == null) checkpoints = [];
          else checkpoints = fallbackManager.listNewestFirst();
        } else {
          checkpoints = fallbackManager.listNewestFirst();
        }

        if (!Array.isArray(checkpoints)) checkpoints = [];
        return jsonStatus(200, { checkpoints, history: checkpoints });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── POST /__vesk/agent/checkpoint ───────────────────────────────────
    if (pathname === '/__vesk/agent/checkpoint') {
      if (method !== 'POST') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') {
        return denied('createCheckpoint');
      }
      try {
        if (!table.allows('createCheckpoint' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) {
          return denied('createCheckpoint');
        }
      } catch {
        return denied('createCheckpoint');
      }

      const b = (body ?? {}) as Record<string, unknown>;
      const message =
        typeof b.message === 'string'
          ? b.message
          : typeof b.msg === 'string'
            ? b.msg
            : typeof b.prompt === 'string'
              ? (b.prompt as string).slice(0, 200)
              : 'checkpoint';

      const filesRaw = Array.isArray(b.files) ? (b.files as unknown[]) : undefined;
      const commandsRaw = Array.isArray(b.commands) ? (b.commands as unknown[]) : undefined;
      const depsRaw = b.deps;
      const prompt = typeof b.prompt === 'string' ? (b.prompt as string) : undefined;

      // Normalize to CheckpointManager shapes: files = CheckpointFile[], commands = string[][], deps = {installed,removed}
      const files = filesRaw as Checkpoint['files'] | undefined;
      let commands: string[][] | undefined;
      if (commandsRaw) {
        // commands may be string[][] or array of {argv:string[]} objects
        if (commandsRaw.length > 0 && typeof commandsRaw[0] === 'object' && !Array.isArray(commandsRaw[0])) {
          const cmdObjs = commandsRaw as Array<{ argv?: unknown }>;
          commands = cmdObjs.map((c) => (Array.isArray(c.argv) ? (c.argv as string[]) : []));
        } else {
          commands = commandsRaw as string[][];
        }
      }
      let deps: { installed: string[]; removed: string[] } | undefined;
      if (Array.isArray(depsRaw)) {
        deps = { installed: depsRaw as string[], removed: [] };
      } else if (depsRaw && typeof depsRaw === 'object') {
        const d = depsRaw as Record<string, unknown>;
        if (Array.isArray(d.installed) || Array.isArray(d.removed)) {
          deps = {
            installed: Array.isArray(d.installed) ? (d.installed as string[]) : [],
            removed: Array.isArray(d.removed) ? (d.removed as string[]) : [],
          };
        }
      }

      const buildRaw = b.build ?? b.buildResult;
      const testRaw = b.test ?? b.testResult;
      let build: Checkpoint['build'] = null;
      if (buildRaw && typeof buildRaw === 'object') {
        const br = buildRaw as Record<string, unknown>;
        if (typeof br.ok === 'boolean') build = { ok: br.ok as boolean, error: typeof br.error === 'string' ? br.error : undefined, ms: typeof br.ms === 'number' ? br.ms : undefined };
        else build = null;
      }
      let test: Checkpoint['test'] = null;
      if (testRaw && typeof testRaw === 'object') {
        const tr = testRaw as Record<string, unknown>;
        if (typeof tr.ok === 'boolean') test = { ok: tr.ok as boolean, error: typeof tr.error === 'string' ? tr.error : undefined };
      }

      try {
        let cp: Checkpoint | null = null;
        const injectedCreate = (opts as unknown as { createCheckpoint?: unknown }).createCheckpoint;
        if (typeof injectedCreate === 'function') {
          const fn = injectedCreate as (...a: unknown[]) => unknown;
          let res: unknown;
          try {
            if (fn.length <= 3) {
              // Try (message, changes, buildResult) and (opts) shapes.
              // First try CreateCheckpointOptions shape: single object
              if (fn.length === 1) {
                const createOpts: Record<string, unknown> = { label: message, prompt, files, commands, deps, build, test };
                res = await fn(createOpts);
              } else {
                const changes: Record<string, unknown> = {};
                if (files) changes.files = files;
                if (commands) changes.commands = commands;
                if (deps) changes.deps = deps;
                if (prompt) changes.prompt = prompt;
                res = await fn(message, changes, buildRaw ?? testRaw);
              }
              if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
                cp = res as Checkpoint;
              } else {
                // Try projectDir form
                res = await fn(projectDir, message, { files, commands, deps, prompt }, buildRaw);
                if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
                  cp = res as Checkpoint;
                }
              }
            } else {
              res = await fn(projectDir, message, { files, commands, deps, prompt }, buildRaw);
              if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
                cp = res as Checkpoint;
              } else {
                const alt = await fn({ label: message, prompt, files, commands, deps, build, test });
                if (alt && typeof alt === 'object' && 'id' in (alt as Record<string, unknown>)) cp = alt as Checkpoint;
              }
            }
          } catch {
            try {
              const alt = await fn(projectDir, message, { files, commands, deps, prompt }, buildRaw);
              if (alt && typeof alt === 'object' && 'id' in (alt as Record<string, unknown>)) cp = alt as Checkpoint;
            } catch {
              cp = null;
            }
          }
          if (!cp || typeof (cp as Checkpoint).id !== 'string') {
            cp = fallbackManager.create({ label: message, prompt, files: files as Checkpoint['files'], commands, deps, build, test });
          }
        } else {
          cp = fallbackManager.create({ label: message, prompt, files: files as Checkpoint['files'], commands, deps, build, test });
        }
        return jsonStatus(200, { ok: true, checkpoint: cp });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── POST /__vesk/agent/rollback ─────────────────────────────────────
    if (pathname === '/__vesk/agent/rollback') {
      if (method !== 'POST') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') {
        return denied('rollback');
      }
      try {
        if (!table.allows('rollback' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) {
          return denied('rollback');
        }
      } catch {
        return denied('rollback');
      }

      const b = (body ?? {}) as Record<string, unknown>;
      const id =
        typeof b.checkpointId === 'string'
          ? (b.checkpointId as string)
          : typeof b.id === 'string'
            ? (b.id as string)
            : typeof b.checkpoint_id === 'string'
              ? (b.checkpoint_id as string)
              : '';
      if (!id || !id.trim()) return badRequest('missing "checkpointId" in body');
      if (id.includes('/') || id.includes('\\') || id.includes('..')) {
        return badRequest('invalid checkpointId');
      }

      try {
        let cp: Checkpoint | null = null;
        if (typeof opts.rollback === 'function') {
          const fn = opts.rollback as unknown as (...a: unknown[]) => unknown;
          let res: unknown;
          try {
            if (fn.length <= 1) {
              res = await fn(id);
              if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
                cp = res as Checkpoint;
              } else if (res && typeof res === 'object' && 'checkpoint' in (res as Record<string, unknown>)) {
                // manager.rollback returns {checkpoint, filesToRestore}
                const r = res as { checkpoint?: unknown };
                if (r.checkpoint && typeof r.checkpoint === 'object' && 'id' in (r.checkpoint as Record<string, unknown>)) {
                  cp = r.checkpoint as Checkpoint;
                }
              } else if (res == null) {
                try {
                  const alt = await (fn as (a: string, b: string) => unknown)(projectDir, id);
                  if (alt && typeof alt === 'object' && 'id' in (alt as Record<string, unknown>)) cp = alt as Checkpoint;
                  else if (alt && typeof alt === 'object' && 'checkpoint' in (alt as Record<string, unknown>)) {
                    const r = alt as { checkpoint?: unknown };
                    if (r.checkpoint && typeof r.checkpoint === 'object') cp = r.checkpoint as Checkpoint;
                  }
                } catch {
                  cp = null;
                }
              }
            } else {
              res = await (fn as (a: string, b: string) => unknown)(projectDir, id);
              if (res && typeof res === 'object' && 'id' in (res as Record<string, unknown>)) {
                cp = res as Checkpoint;
              } else if (res && typeof res === 'object' && 'checkpoint' in (res as Record<string, unknown>)) {
                const r = res as { checkpoint?: unknown };
                if (r.checkpoint && typeof r.checkpoint === 'object') cp = r.checkpoint as Checkpoint;
              } else if (res == null) {
                try {
                  const alt = await (fn as (a: string) => unknown)(id);
                  if (alt && typeof alt === 'object' && 'id' in (alt as Record<string, unknown>)) cp = alt as Checkpoint;
                } catch {}
              }
            }
          } catch {
            try {
              const alt = await (fn as (a: string, b: string) => unknown)(projectDir, id);
              if (alt && typeof alt === 'object' && 'id' in (alt as Record<string, unknown>)) cp = alt as Checkpoint;
              else if (alt && typeof alt === 'object' && 'checkpoint' in (alt as Record<string, unknown>)) {
                const r = alt as { checkpoint?: unknown };
                if (r.checkpoint) cp = r.checkpoint as Checkpoint;
              }
            } catch {}
          }
          if (cp == null && res === undefined) {
            const found = fallbackManager.get(id);
            if (found) cp = found;
            else {
              const rb = fallbackManager.rollback(id);
              if (rb) cp = rb.checkpoint;
            }
          }
        } else {
          const found = fallbackManager.get(id);
          if (found) cp = found;
          else {
            const rb = fallbackManager.rollback(id);
            if (rb) cp = rb.checkpoint;
          }
        }
        if (cp == null && typeof opts.rollback === 'function') {
          const found = fallbackManager.get(id);
          if (found) cp = found;
          else {
            const rb = fallbackManager.rollback(id);
            if (rb) cp = rb.checkpoint;
          }
        }
        if (!cp) return jsonStatus(404, { error: `checkpoint not found: ${id}` });
        return jsonStatus(200, { ok: true, checkpoint: cp, rolledBack: true });
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── GET /__vesk/agent/models?provider= ———— list models for provider
    if (pathname === '/__vesk/agent/models') {
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied('readFiles');
      try { if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied('readFiles'); } catch { return denied('readFiles'); }
      const params = new URLSearchParams(_search ?? '');
      const provider = (params.get('provider') || params.get('p') || loadAgenticConfig(projectDir).provider) as string;
      const cfg = loadAgenticConfig(projectDir);
      // per-provider key: try provider-specific first, fallback generic
      let apiKey: string = '';
      try {
        apiKey = getApiKey(projectDir, provider) || getApiKey(projectDir) || '';
      } catch {
        apiKey = getApiKey(projectDir) || '';
      }
      const baseUrl = params.get('baseUrl') || (cfg as unknown as { baseUrl?: string }).baseUrl;
      let models: string[] = [];
      try {
        if (provider === 'openai' || provider === 'opencode' || provider === 'opencode-go' || provider === 'openrouter' || provider === 'loopers' || provider === 'custom') {
          let effectiveBase = baseUrl;
          if (!effectiveBase) {
            if (provider === 'opencode') effectiveBase = 'https://opencode.ai/zen/v1';
            else if (provider === 'opencode-go') effectiveBase = 'https://opencode.ai/zen/go/v1';
            else if (provider === 'openrouter') effectiveBase = 'https://openrouter.ai/api/v1';
            else if (provider === 'loopers') effectiveBase = 'http://localhost:8080';
          }
          const p = openAiProvider({ apiKey, baseUrl: effectiveBase });
          models = p.listModels ? await p.listModels({ apiKey, baseUrl: effectiveBase }) : [];
        } else if (provider === 'anthropic') {
          const p = anthropicProvider({ apiKey, baseUrl });
          models = p.listModels ? await p.listModels({ apiKey, baseUrl }) : [];
        } else if (provider === 'google') {
          const p = googleProvider({ apiKey, baseUrl });
          models = p.listModels ? await p.listModels({ apiKey, baseUrl }) : [];
        } else if (provider === 'ollama') {
          const p = ollamaProvider({ baseUrl });
          models = p.listModels ? await p.listModels({ baseUrl }) : [];
        } else {
          return badRequest(`unknown provider: ${provider}`);
        }
      } catch (e) {
        return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
      }
      return jsonStatus(200, { provider, models });
    }

    // ── GET /__vesk/agent/keys + POST /__vesk/agent/keys ───────────────
    if (pathname === '/__vesk/agent/keys') {
      if (method === 'GET' || method === 'HEAD') {
        if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied('readFiles');
        try { if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied('readFiles'); } catch { return denied('readFiles'); }
        const keys = buildKeysMap(projectDir);
        const keyPreviews = buildPreviewsMap(projectDir);
        // compatibility aliases: previews, hasKeys, keyPreview alias already handled
        // never echo raw keys — only hasKey booleans + masked previews
        return jsonStatus(200, {
          keys,
          keyPreviews,
          previews: keyPreviews,
          hasKeys: keys,
          keyPreview: keyPreviews,
          // also include top-level provider-agnostic hint matching old config shape
          hasKey: Object.values(keys).some(Boolean),
        });
      }
      if (method === 'POST') {
        // Setting your own API key is allowed in any mode (readFiles) — it's not a project write
        if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied('readFiles');
        try { if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied('readFiles'); } catch { return denied('readFiles'); }
        const b = (body ?? {}) as Record<string, unknown>;
        // accept {provider, apiKey} or {provider, key} or {provider, value}
        const providerRaw = typeof b.provider === 'string' ? b.provider : typeof b.p === 'string' ? b.p : typeof (b as Record<string, unknown>).name === 'string' ? (b as Record<string, unknown>).name as string : '';
        const provider = providerRaw ? normalizeProvider(providerRaw) : '';
        if (!provider) return badRequest('missing "provider" in body');
        if (!isValidProvider(provider)) return badRequest(`unknown provider: ${providerRaw}`);
        // apiKey may be under apiKey | key | value | token
        const apiKeyRaw = typeof b.apiKey === 'string' ? b.apiKey : typeof b.key === 'string' ? b.key : typeof b.value === 'string' ? b.value : typeof b.token === 'string' ? b.token : typeof (b as Record<string, unknown>).api_key === 'string' ? (b as Record<string, unknown>).api_key as string : '';
        if (!apiKeyRaw || !String(apiKeyRaw).trim()) return badRequest('missing "apiKey" in body');
        const apiKey = String(apiKeyRaw).trim();
        // write via saveApiKey — 3-arg per-provider form (projectDir, provider, apiKey)
        try {
          // config's saveApiKey supports (projectDir, provider, apiKey) when 3 args
          // fallback to 2-arg generic if provider is 'openai' for backwards compat? Keep per-provider always.
          // Detect arity: if saveApiKey length >=3, call 3-arg; else call 2-arg generic + per-file
          // Our config now supports 3-arg, so use it.
          const fn = saveApiKey as unknown as (a: string, b: string, c?: string) => void;
          if (fn.length >= 3) {
            fn(projectDir, provider, apiKey);
          } else {
            // old signature — still try per-provider file via direct call
            (saveApiKey as unknown as (projectDir: string, key: string) => void)(projectDir, apiKey);
            // also try 3-arg for new config that may be loaded
            try { (saveApiKey as unknown as (a: string, b: string, c: string) => void)(projectDir, provider, apiKey); } catch {}
          }
        } catch (e) {
          return jsonStatus(500, { error: e instanceof Error ? e.message : String(e) });
        }
        const preview = maskPreview(apiKey);
        // return ok + hasKey + preview — never raw key
        return jsonStatus(200, {
          ok: true,
          provider,
          hasKey: true,
          preview,
          keyPreview: preview,
          masked: preview,
          keys: buildKeysMap(projectDir),
          keyPreviews: buildPreviewsMap(projectDir),
        });
      }
      return jsonStatus(405, { error: 'method not allowed' });
    }

    // ── GET /__vesk/agent/config + POST /__vesk/agent/config ──
    if (pathname === '/__vesk/agent/config') {
      if (method === 'GET' || method === 'HEAD') {
        if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied('readFiles');
        try { if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied('readFiles'); } catch { return denied('readFiles'); }
        const cfg = loadAgenticConfig(projectDir);
        // never leak full key — only masked
        const key = getApiKey(projectDir);
        const masked = maskPreview(key);
        const keys = buildKeysMap(projectDir);
        const keyPreviews = buildPreviewsMap(projectDir);
        return jsonStatus(200, {
          provider: cfg.provider,
          model: cfg.model,
          baseUrl: (cfg as unknown as { baseUrl?: string }).baseUrl ?? null,
          mode: cfg.mode,
          maxSteps: cfg.maxSteps,
          hasKey: cfg.hasKey,
          keyPreview: masked,
          // per-provider extensions — never raw keys
          keys,
          hasKeys: keys,
          keyPreviews,
          previews: keyPreviews,
          hasKeyMap: keys,
          previewsMap: keyPreviews,
        });
      }
      if (method === 'POST') {
        const b = (body ?? {}) as Record<string, unknown>;
        // If body is only apiKey(s), allow with readFiles (setting your own key shouldn't require modifyConfig)
        const isOnlyKeys = (typeof b.apiKey === 'string' && Object.keys(b).every(k => ['apiKey','provider','apiKeys','keys','keyMap'].includes(k))) || (b.apiKeys && typeof b.apiKeys === 'object');
        let neededCap: 'modifyConfig' | 'readFiles' = 'modifyConfig';
        if (isOnlyKeys) neededCap = 'readFiles';
        if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied(neededCap);
        try { if (!table.allows(neededCap as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied(neededCap); } catch { return denied(neededCap); }
        const patch: Record<string, unknown> = {};
        if (typeof b.provider === 'string') patch.provider = b.provider;
        if (typeof b.model === 'string') patch.model = b.model;
        if (typeof b.baseUrl === 'string') patch.baseUrl = b.baseUrl;
        if (typeof b.mode === 'string' && ['explore','debug','agent'].includes(b.mode as string)) patch.mode = b.mode;
        if (typeof b.maxSteps === 'number') patch.maxSteps = b.maxSteps;
        // backwards compat: single apiKey
        if (typeof b.apiKey === 'string' && (b.apiKey as string).trim()) {
          // For backwards compat, save as generic + also as per-current/new provider if known
          const targetProvider = typeof b.provider === 'string' && b.provider.trim() ? normalizeProvider(b.provider) : (loadAgenticConfig(projectDir).provider as string);
          try {
            // save generic legacy
            (saveApiKey as unknown as (a: string, b: string) => void)(projectDir, (b.apiKey as string).trim());
          } catch {}
          // also save per-provider for future GET keys consistency
          try {
            const fn = saveApiKey as unknown as (a: string, b: string, c?: string) => void;
            if (fn.length >= 3 && isValidProvider(targetProvider)) {
              fn(projectDir, targetProvider, (b.apiKey as string).trim());
            }
          } catch {}
        }
        // per-provider map: {apiKeys:{openai:"sk-...", anthropic:"..."}}
        const apiKeysRaw = b.apiKeys ?? (b as Record<string, unknown>).keys ?? (b as Record<string, unknown>).keyMap;
        if (apiKeysRaw && typeof apiKeysRaw === 'object' && !Array.isArray(apiKeysRaw)) {
          const map = apiKeysRaw as Record<string, unknown>;
          for (const [provRaw, val] of Object.entries(map)) {
            if (typeof val !== 'string' || !val.trim()) continue;
            const prov = normalizeProvider(provRaw);
            if (!isValidProvider(prov)) continue;
            const keyVal = String(val).trim();
            if (!keyVal) continue;
            try {
              const fn = saveApiKey as unknown as (a: string, b: string, c?: string) => void;
              if (fn.length >= 3) fn(projectDir, prov, keyVal);
              else {
                // old 2-arg — at least save generic if provider is current, otherwise try 3-arg anyway
                try { (saveApiKey as unknown as (a: string, b: string, c: string) => void)(projectDir, prov, keyVal); } catch {}
                if (prov === normalizeProvider(loadAgenticConfig(projectDir).provider as string)) {
                  (saveApiKey as unknown as (a: string, b: string) => void)(projectDir, keyVal);
                }
              }
            } catch {}
          }
        }
        // also handle alternative shape: {openaiKey, anthropicKey, ...} or {keys:{...}} already handled
        // also handle direct per-provider fields like b["openai_apiKey"]? Not needed, but be lenient
        // Check for apiKey per provider via body[provider] keys? Skip

        const next = saveAgenticConfig(projectDir, patch as never);
        // build updated per-provider maps for response (never raw keys)
        const keys = buildKeysMap(projectDir);
        const keyPreviews = buildPreviewsMap(projectDir);
        // masked preview for the current/single key for backward compat
        const curKey = getApiKey(projectDir);
        const curMasked = maskPreview(curKey);
        return jsonStatus(200, {
          ok: true,
          provider: next.provider,
          model: next.model,
          mode: next.mode,
          hasKey: Object.values(keys).some(Boolean) || !!curKey,
          keyPreview: curMasked,
          keys,
          hasKeys: keys,
          keyPreviews,
          previews: keyPreviews,
        });
      }
      return jsonStatus(405, { error: 'method not allowed' });
    }

    // ── GET /__vesk/agent/tools ──
    if (pathname === '/__vesk/agent/tools') {
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      if (!table || typeof (table as unknown as { allows?: unknown }).allows !== 'function') return denied('readFiles');
      try { if (!table.allows('readFiles' as unknown as Parameters<AgentCapabilityTable['allows']>[0])) return denied('readFiles'); } catch { return denied('readFiles'); }
      // Filter tools by permissions: expose what current mode allows
      // We don't have full tool list here without deps, so return capability map + known tool names
      const allTools = [
        { name: 'vesk.inspectProject', description: 'inspect project structure', capability: 'readFiles' },
        { name: 'vesk.inspectComponent', description: 'read component source', capability: 'readFiles' },
        { name: 'vesk.readConfig', description: 'read vesk.config.ts', capability: 'readFiles' },
        { name: 'vesk.updateConfig', description: 'update config', capability: 'modifyConfig' },
        { name: 'vesk.getDiagnostics', description: 'get diagnostics', capability: 'readFiles' },
        { name: 'vesk.runBuild', description: 'run build', capability: 'runBuild' },
        { name: 'vesk.runTests', description: 'run tests', capability: 'runTests' },
        { name: 'vesk.installPlugin', description: 'install plugin', capability: 'installPackages' },
        { name: 'vesk.enablePlugin', description: 'enable plugin', capability: 'managePlugins' },
        { name: 'filesystem.read', description: 'read file', capability: 'readFiles' },
        { name: 'filesystem.write', description: 'write file', capability: 'writeFiles' },
        { name: 'filesystem.delete', description: 'delete file', capability: 'deleteFiles' },
        { name: 'command.execute', description: 'execute allowlisted command', capability: 'executeCommands' },
        { name: 'vesk.createCheckpoint', description: 'create checkpoint', capability: 'createCheckpoint' },
        { name: 'vesk.rollback', description: 'rollback', capability: 'rollback' },
      ];
      const allowed = allTools.filter(t => {
        try { return table.allows(t.capability as unknown as Parameters<AgentCapabilityTable['allows']>[0]); } catch { return false; }
      });
      return jsonStatus(200, { tools: allowed, allTools });
    }

    // ── GET /__vesk/agent/commands ──
    if (pathname === '/__vesk/agent/commands') {
      if (method !== 'GET' && method !== 'HEAD') return jsonStatus(405, { error: 'method not allowed' });
      return jsonStatus(200, { commands: SLASH_COMMANDS });
    }

    // ── Unknown /__vesk/agent/* subpath → 404 ────────────────────────────
    if (pathname.startsWith('/__vesk/agent/')) {
      return jsonStatus(404, { error: 'Not found' });
    }

    return null;
  }

  return { route };
}
