/**
 * @vesk/agentic — filesystem tools
 *
 * Zero-deps, node:fs only. Containment-checked via a local `resolveWithin`
 * helper (no import from @vesk/adapter). Every `execute` returns a JSON
 * string and never throws.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import type { Tool } from '../loop.js';

// ──────────────────────────────────────────────────────────────────────────────
// local containment helper — must stay in this file so the module is zero-deps
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `relPath` against `baseDir` and return the absolute path ONLY if
 * it stays strictly inside `baseDir` (never the directory itself, never
 * outside). Returns null otherwise.
 */
function resolveWithin(baseDir: string, relPath: string): string | null {
  const base = resolve(baseDir);
  const target = resolve(baseDir, relPath);
  const prefix = base + sep;
  if (target === base || !target.startsWith(prefix)) return null;
  return target;
}

function jsonOk(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

function jsonError(message: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, error: message, ...(extra || {}) });
}

// ──────────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────────

export function createFsTools(projectDir: string): Tool[] {
  const base = resolve(projectDir);

  const readTool: Tool = {
    name: 'filesystem.read',
    description: 'Read a file or directory inside the project. Containment-checked; paths outside the project are rejected.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path to read (e.g. "app/page.vsk" or "src/lib.ts")' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const rel = String((args as { path?: unknown }).path ?? '');
      if (!rel) return jsonError('missing required "path" parameter');
      const resolved = resolveWithin(base, rel);
      if (!resolved) return jsonError('path escapes project root', { path: rel });
      try {
        if (!existsSync(resolved)) return jsonError('not found', { path: rel });
        const st = statSync(resolved);
        if (st.isDirectory()) {
          const entries = readdirSync(resolved, { withFileTypes: true }).map((e) =>
            e.isDirectory() ? e.name + '/' : e.name,
          );
          return jsonOk({ ok: true, path: rel, directory: true, entries });
        }
        if (st.isFile()) {
          const content = readFileSync(resolved, 'utf-8');
          return jsonOk({ ok: true, path: rel, directory: false, content });
        }
        return jsonError('unsupported file type', { path: rel });
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : String(e), { path: rel });
      }
    },
  };

  const writeTool: Tool = {
    name: 'filesystem.write',
    description: 'Write (create or overwrite) a file inside the project. Containment-checked; paths outside the project are rejected. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path to write' },
        content: { type: 'string', description: 'File content (utf-8)' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const rel = String((args as { path?: unknown }).path ?? '');
      const content = String((args as { content?: unknown }).content ?? '');
      if (!rel) return jsonError('missing required "path" parameter');
      if ((args as { content?: unknown }).content === undefined) return jsonError('missing required "content" parameter');
      const resolved = resolveWithin(base, rel);
      if (!resolved) return jsonError('path escapes project root', { path: rel });
      try {
        mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, content, 'utf-8');
        return jsonOk({ ok: true, path: rel });
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : String(e), { path: rel });
      }
    },
  };

  const deleteTool: Tool = {
    name: 'filesystem.delete',
    description: 'Delete a file or directory inside the project. Containment-checked; paths outside the project are rejected.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path to delete' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const rel = String((args as { path?: unknown }).path ?? '');
      if (!rel) return jsonError('missing required "path" parameter');
      const resolved = resolveWithin(base, rel);
      if (!resolved) return jsonError('path escapes project root', { path: rel });
      try {
        if (!existsSync(resolved)) return jsonError('not found', { path: rel });
        const st = statSync(resolved);
        if (st.isDirectory()) {
          rmSync(resolved, { recursive: true, force: true });
        } else {
          unlinkSync(resolved);
        }
        return jsonOk({ ok: true, path: rel });
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : String(e), { path: rel });
      }
    },
  };

  return [readTool, writeTool, deleteTool];
}
