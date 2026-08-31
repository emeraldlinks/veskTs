/**
 * @vesk/agentic — checkpoints & transactions
 *
 * Zero-deps checkpoint system for agent operations.
 *
 * Two complementary surfaces in one module (both zero-deps):
 *
 *  1. `CheckpointManager` — in-memory, browser-safe manager for `Preview → Approve → Execute → Validate → Checkpoint`
 *     flows inside the agent loop. Persists only metadata; caller restores files.
 *
 *  2. File-system store — `createCheckpoint(projectDir, message, changes, buildResult)` and friends
 *     persisting to `<projectDir>/.vesk/agentic/history.json` + `checkpoints/{id}/checkpoint.json`.
 *     Used by `@vesk/agentic` Dev Server router (`createAgentRouter`) and `vesk.*` tools (`createVeskTools`).
 *
 * Both surfaces share the same unified `Checkpoint` shape (superset of manager + file-system fields)
 * so the Dev Server router and in-memory tests interoperate without type drift.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { randomUUID as nodeRandomUUID } from 'node:crypto';

// ── Core file types (shared) ─────────────────────────────────────────────────

export interface CheckpointFile {
  path: string;
  before: string | null; // null = did not exist before
  after: string | null; // null = deleted after
}

export interface CheckpointDeps {
  installed: string[];
  removed: string[];
}

export interface CheckpointBuild {
  ok: boolean;
  error?: string;
  ms?: number;
}

export interface CheckpointTest {
  ok: boolean;
  error?: string;
}

// File-system command shape (persisted store) — manager uses string[][] for the same logical data.
export interface CheckpointCommand {
  argv: string[];
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface CheckpointBuildResult {
  success: boolean;
  output?: string;
  errors?: string[];
  [k: string]: unknown;
}

// Unified checkpoint — superset of manager (createdAt/label) + file-system (timestamp/message) fields.
// Every checkpoint produced by either surface populates BOTH aliases so consumers can read whichever they prefer.
export interface Checkpoint {
  id: string;
  // Dual timestamp: numeric (file-system) + ISO string (manager) — both always set.
  timestamp: number;
  createdAt: string; // ISO-8601
  // Dual message: file-system `message` + manager `label` — both populated from the same input (message ?? label).
  message: string;
  label?: string;
  prompt?: string;
  files: CheckpointFile[];
  // Commands: manager stores string[][]; file-system stores CheckpointCommand[]. Persisted shape may be either;
  // consumers handle both via Array.isArray and typeof element checks.
  commands: string[][] | CheckpointCommand[];
  // Deps: manager stores object {installed, removed}; file-system stores string[].
  deps: CheckpointDeps | string[];
  build: CheckpointBuild | null;
  test: CheckpointTest | null;
  buildResult?: unknown;
  parentId?: string;
}

export interface CreateCheckpointOptions {
  id?: string;
  label?: string;
  message?: string;
  prompt?: string;
  files?: CheckpointFile[];
  commands?: string[][] | CheckpointCommand[];
  deps?: Partial<CheckpointDeps> | string[];
  build?: CheckpointBuild | null;
  test?: CheckpointTest | null;
  buildResult?: unknown;
  parentId?: string;
  createdAt?: string;
  timestamp?: number;
}

// File-system change bag (as used by createCheckpoint(projectDir, message, changes, buildResult))
export interface CheckpointChanges {
  files?: CheckpointFile[];
  commands?: CheckpointCommand[] | string[][];
  deps?: string[] | CheckpointDeps;
  parentId?: string;
  prompt?: string;
}

export interface TransactionPreview {
  files: CheckpointFile[];
  commands?: CheckpointCommand[] | string[][];
  deps?: string[] | CheckpointDeps;
  message?: string;
  prompt?: string;
}

export interface TransactionOptions {
  message: string;
  prompt?: string;
  parentId?: string;
  preview: () => TransactionPreview | Promise<TransactionPreview>;
  approve: (preview: TransactionPreview) => boolean | Promise<boolean>;
  execute: () => { files?: CheckpointFile[]; commands?: CheckpointCommand[] | string[][]; deps?: string[] | CheckpointDeps } | void | Promise<{ files?: CheckpointFile[]; commands?: CheckpointCommand[] | string[][]; deps?: string[] | CheckpointDeps } | void>;
  validate?: () => unknown | Promise<unknown>;
}

function generateId(): string {
  // Prefer crypto.randomUUID when available (Node 19+, browsers), fallback to Math.random.
  try {
    const c = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  try { return nodeRandomUUID(); } catch {}
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class CheckpointManager {
  private store = new Map<string, Checkpoint>();
  private order: string[] = [];
  private readonly maxKeep: number | undefined;

  constructor(opts?: { maxKeep?: number }) {
    this.maxKeep = opts?.maxKeep;
  }

  create(opts: CreateCheckpointOptions = {}): Checkpoint {
    const id = opts.id ?? generateId();
    const createdAt = opts.createdAt ?? new Date().toISOString();
    const timestamp = opts.timestamp ?? (Date.parse(createdAt) || Date.now());
    // message/label are aliases — populate both from whichever is provided
    const rawMessage = opts.message ?? opts.label ?? '';
    const label = opts.label ?? (rawMessage || undefined);
    const message = rawMessage || (opts.label ?? '');
    // Normalize deps: object {installed, removed} or string[] → union kept as-is but object is canonical for manager
    let deps: CheckpointDeps | string[] = { installed: [], removed: [] };
    if (Array.isArray(opts.deps)) deps = [...opts.deps];
    else if (opts.deps && typeof opts.deps === 'object') {
      const d = opts.deps as Partial<CheckpointDeps>;
      deps = { installed: d.installed ? [...d.installed] : [], removed: d.removed ? [...d.removed] : [] };
    }
    // Normalize commands: keep as provided (string[][] or CheckpointCommand[])
    let commands: string[][] | CheckpointCommand[] = [];
    if (Array.isArray(opts.commands)) {
      // Detect which shape by inspecting first element
      const first = (opts.commands as unknown[])[0] as unknown;
      if (first && typeof first === 'object' && !Array.isArray(first) && 'argv' in (first as Record<string, unknown>)) {
        commands = (opts.commands as CheckpointCommand[]).map((c) => ({ ...c }));
      } else {
        commands = (opts.commands as string[][]).map((c) => [...c]);
      }
    }
    const checkpoint: Checkpoint = {
      id,
      timestamp,
      createdAt,
      message,
      label,
      prompt: opts.prompt,
      files: opts.files ? opts.files.map((f) => ({ ...f })) : [],
      commands,
      deps,
      build: opts.build !== undefined ? (opts.build ? { ...opts.build } : null) : null,
      test: opts.test !== undefined ? (opts.test ? { ...opts.test } : null) : null,
      ...(opts.buildResult !== undefined ? { buildResult: opts.buildResult } : {}),
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    } as Checkpoint;

    // If id already exists, remove old position (idempotent update)
    if (this.store.has(id)) {
      this.order = this.order.filter((x) => x !== id);
    }
    this.store.set(id, checkpoint);
    this.order.push(id);

    // Prune oldest when over maxKeep
    if (this.maxKeep !== undefined && this.order.length > this.maxKeep) {
      const excess = this.order.length - this.maxKeep;
      for (let i = 0; i < excess; i++) {
        const oldest = this.order.shift()!;
        this.store.delete(oldest);
      }
    }

    return checkpoint;
  }

  list(): Checkpoint[] {
    // Oldest-first (insertion order) — callers can reverse for newest-first UI.
    return this.order.map((id) => this.store.get(id)!);
  }

  listNewestFirst(): Checkpoint[] {
    return [...this.list()].reverse();
  }

  get(id: string): Checkpoint | undefined {
    return this.store.get(id);
  }

  has(id: string): boolean {
    return this.store.has(id);
  }

  delete(id: string): boolean {
    const ok = this.store.delete(id);
    if (ok) this.order = this.order.filter((x) => x !== id);
    return ok;
  }

  clear(): void {
    this.store.clear();
    this.order = [];
  }

  size(): number {
    return this.store.size;
  }

  /**
   * Rollback plan for a checkpoint: returns the files that must be restored
   * to their `before` state. Caller is responsible for actually writing/deleting files.
   * Returns null if checkpoint does not exist.
   */
  rollback(id: string): { id: string; checkpoint: Checkpoint; filesToRestore: CheckpointFile[] } | null {
    const cp = this.store.get(id);
    if (!cp) return null;
    return {
      id,
      checkpoint: cp,
      filesToRestore: cp.files.map((f) => ({ ...f })),
    };
  }

  /**
   * Helper: build a rollback summary describing what filesystem actions are required.
   */
  static describeRollback(files: CheckpointFile[]): { writes: number; deletes: number; creates: number } {
    let writes = 0;
    let deletes = 0;
    let creates = 0;
    for (const f of files) {
      if (f.before === null && f.after !== null) deletes++; // file was created → delete it
      else if (f.before !== null && f.after === null) creates++; // file was deleted → recreate
      else if (f.before !== null) writes++; // modified → overwrite
      // before===null && after===null → no-op (should not happen)
    }
    return { writes, deletes, creates };
  }
}

// ── File-system store (persisted) ────────────────────────────────────────────
// Mirrors the original file-system implementation (now unified with Manager's shape)
// so `createVeskTools` and `createAgentRouter` keep working.

export function getAgenticDir(projectDir: string): string {
  return join(resolve(projectDir), '.vesk', 'agentic');
}
export function getHistoryPath(projectDir: string): string {
  return join(getAgenticDir(projectDir), 'history.json');
}
export function getCheckpointDir(projectDir: string, id: string): string {
  return join(getAgenticDir(projectDir), 'checkpoints', id);
}
export function getCheckpointPath(projectDir: string, id: string): string {
  return join(getCheckpointDir(projectDir, id), 'checkpoint.json');
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, 'utf-8');
    if (raw.trim() === '') return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try { renameSync(tmp, filePath); } catch {
    try { writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); try { unlinkSync(tmp); } catch {} } catch {}
  }
}
function readHistory(projectDir: string): Checkpoint[] {
  const p = getHistoryPath(projectDir);
  const data = readJson<Checkpoint[]>(p, []);
  return Array.isArray(data) ? data : [];
}
function writeHistory(projectDir: string, history: Checkpoint[]): void {
  writeJsonAtomic(getHistoryPath(projectDir), history);
}

export function createCheckpoint(
  projectDir: string,
  message: string,
  changes: CheckpointChanges = {},
  buildResult?: unknown,
): Checkpoint {
  const id = generateId();
  const timestamp = Date.now();
  const createdAt = new Date(timestamp).toISOString();
  const files = changes.files ? changes.files.map((f) => ({ ...f })) : [];
  // Normalize commands/deps
  let commands: CheckpointCommand[] | string[][] = [];
  if (changes.commands) {
    const first = (changes.commands as unknown[])[0] as unknown;
    if (first && typeof first === 'object' && !Array.isArray(first) && 'argv' in (first as Record<string, unknown>)) {
      commands = (changes.commands as CheckpointCommand[]).map((c) => ({ ...c }));
    } else {
      commands = (changes.commands as string[][]).map((c) => [...(c as string[])]);
    }
  }
  let deps: string[] | CheckpointDeps = [];
  if (Array.isArray(changes.deps)) deps = [...(changes.deps as string[])];
  else if (changes.deps && typeof changes.deps === 'object') {
    const d = changes.deps as Partial<CheckpointDeps>;
    deps = { installed: d.installed ? [...d.installed] : [], removed: d.removed ? [...d.removed] : [] };
  }
  const checkpoint: Checkpoint = {
    id,
    timestamp,
    createdAt,
    message,
    label: message,
    prompt: changes.prompt,
    files,
    commands,
    deps,
    build: null,
    test: null,
    ...(buildResult !== undefined ? { buildResult } : {}),
    ...(changes.parentId ? { parentId: changes.parentId } : {}),
  } as Checkpoint;

  const agenticDir = getAgenticDir(projectDir);
  ensureDir(agenticDir);
  ensureDir(join(agenticDir, 'checkpoints'));
  const cpDir = getCheckpointDir(projectDir, id);
  ensureDir(cpDir);
  writeJsonAtomic(getCheckpointPath(projectDir, id), checkpoint);
  const history = readHistory(projectDir);
  history.unshift(checkpoint);
  writeHistory(projectDir, history);
  return checkpoint;
}

export function listCheckpoints(projectDir: string): Checkpoint[] {
  const history = readHistory(projectDir);
  return [...history].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

export function getCheckpoint(projectDir: string, id: string): Checkpoint | null {
  const cpPath = getCheckpointPath(projectDir, id);
  const fromFile = readJson<Checkpoint | null>(cpPath, null);
  if (fromFile && typeof fromFile === 'object' && (fromFile as Checkpoint).id === id) return fromFile;
  const history = readHistory(projectDir);
  return history.find((c) => c.id === id) ?? null;
}

export function rollback(projectDir: string, id: string): Checkpoint | null {
  const cp = getCheckpoint(projectDir, id);
  if (!cp) return null;
  const projectRoot = resolve(projectDir);
  for (const f of cp.files) {
    if (!f.path || !f.path.trim()) continue;
    const abs = resolve(projectRoot, f.path);
    if (f.before === null) {
      try {
        if (existsSync(abs)) {
          const s = statSync(abs);
          if (s.isDirectory()) rmSync(abs, { recursive: true, force: true });
          else unlinkSync(abs);
        }
      } catch {}
    } else {
      try { ensureDir(dirname(abs)); writeFileSync(abs, f.before, 'utf-8'); } catch {}
    }
  }
  return cp;
}

export async function withTransaction(projectDir: string, options: TransactionOptions): Promise<Checkpoint | null> {
  const preview = await options.preview();
  const approved = await options.approve(preview);
  if (!approved) return null;
  const executedRaw = await options.execute();
  const executed = (executedRaw ?? {}) as { files?: CheckpointFile[]; commands?: CheckpointCommand[] | string[][]; deps?: string[] | CheckpointDeps };
  const files = executed.files ?? preview.files ?? [];
  const commands = executed.commands ?? preview.commands ?? [];
  const deps = executed.deps ?? preview.deps ?? [];
  let buildResult: unknown;
  if (options.validate) {
    const v = await options.validate();
    buildResult = typeof v === 'boolean' ? { success: v } : v;
  }
  let parentId = options.parentId;
  if (!parentId) {
    const latest = listCheckpoints(projectDir)[0];
    if (latest) parentId = latest.id;
  }
  const message = options.message;
  const changes: CheckpointChanges = {
    files,
    commands: commands as CheckpointCommand[] | string[][],
    deps: deps as string[] | CheckpointDeps,
    ...(parentId ? { parentId } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(preview.prompt ? { prompt: preview.prompt } : {}),
  };
  return createCheckpoint(projectDir, message, changes, buildResult);
}

export function deleteCheckpoint(projectDir: string, id: string): boolean {
  const cpDir = getCheckpointDir(projectDir, id);
  let existed = false;
  try { if (existsSync(cpDir)) { rmSync(cpDir, { recursive: true, force: true }); existed = true; } } catch {}
  const history = readHistory(projectDir);
  const next = history.filter((c) => c.id !== id);
  if (next.length !== history.length) { writeHistory(projectDir, next); existed = true; }
  else {
    const cpPath = getCheckpointPath(projectDir, id);
    if (existsSync(cpPath)) { try { unlinkSync(cpPath); } catch {} existed = true; }
  }
  return existed;
}

export function clearCheckpoints(projectDir: string): void {
  const agenticDir = getAgenticDir(projectDir);
  const historyPath = getHistoryPath(projectDir);
  try { if (existsSync(historyPath)) unlinkSync(historyPath); } catch {}
  const checkpointsRoot = join(agenticDir, 'checkpoints');
  try { if (existsSync(checkpointsRoot)) rmSync(checkpointsRoot, { recursive: true, force: true }); } catch {}
}

export function ensureAgenticStore(projectDir: string): void {
  const dir = getAgenticDir(projectDir);
  ensureDir(dir);
  ensureDir(join(dir, 'checkpoints'));
  const hp = getHistoryPath(projectDir);
  if (!existsSync(hp)) writeJsonAtomic(hp, []);
}

// Ensure sep is used (avoid unused import warning)
void sep;
