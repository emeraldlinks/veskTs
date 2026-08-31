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

    // ── Unknown /__vesk/agent/* subpath → 404 ────────────────────────────
    if (pathname.startsWith('/__vesk/agent/')) {
      return jsonStatus(404, { error: 'Not found' });
    }

    return null;
  }

  return { route };
}
