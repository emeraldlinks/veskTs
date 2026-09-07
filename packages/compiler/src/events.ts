import { existsSync } from 'fs';
import { join } from 'path';
import type { VeskEventHandlers } from '@vesk/compiler/src/types';

/**
 * App lifecycle + per-request events.
 *
 * Convention file: `app/_events.ts` (or `.js`), exporting `onStart`,
 * `onRequest` and/or `onStop` handlers:
 *
 * ```ts
 * // app/_events.ts
 * import type { ServerEventContext } from '@vesk/types';
 * export async function onStart(ctx: ServerEventContext) {
 *   await ctx.set('db', await connect());
 * }
 * export async function onRequest(ctx: ServerEventContext) { }
 * export async function onStop(ctx: ServerEventContext) { }
 * ```
 *
 * The `_` prefix marks the file private — it is never routed. Values `set()`
 * in `onStart` land in the server-wide context (`serverLocals()`) and are
 * pre-seeded into every request's `locals()`.
 */

export const EVENTS_FILE_NAMES = ['_events.ts', '_events.js'];

/** Resolve the app-level events file, if present. */
export function collectEventsFile(appDir: string): string | null {
  for (const name of EVENTS_FILE_NAMES) {
    const candidate = join(appDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function isEventsFile(path: string): boolean {
  for (const name of EVENTS_FILE_NAMES) {
    if (path.endsWith('/' + name)) return true;
  }
  return false;
}

/** Load an events file (cache-busted so dev edits reload without restart). */
export async function loadEvents(sourcePath: string): Promise<VeskEventHandlers> {
  try {
    const url = new URL('file://' + sourcePath);
    url.searchParams.set('t', String(Date.now()) + Math.random().toString(36).slice(2));
    const mod = (await import(url.href)) as Record<string, unknown>;
    const handlers: VeskEventHandlers = {};
    if (typeof mod.onStart === 'function') handlers.onStart = mod.onStart as VeskEventHandlers['onStart'];
    if (typeof mod.onRequest === 'function') handlers.onRequest = mod.onRequest as VeskEventHandlers['onRequest'];
    if (typeof mod.onStop === 'function') handlers.onStop = mod.onStop as VeskEventHandlers['onStop'];
    return handlers;
  } catch {
    return {};
  }
}

/** Run the handlers registered for one event, serially, in export order. */
export async function runEventHandlers(
  handlers: VeskEventHandlers,
  name: 'onStart' | 'onRequest' | 'onStop',
  ctx: Record<string, unknown>,
): Promise<void> {
  const fn = handlers[name];
  if (typeof fn !== 'function') return;
  await fn(ctx as never);
}