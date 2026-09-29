/**
 * The production error-reporting seam.
 *
 * Production never leaks a stack trace to the client (that is the right
 * default), which used to mean an adopter had two bad options: show the stack,
 * or replace the adapter's error handling. This is the supported middle: a
 * plugin's `onError` hook receives the error, the route and the build id.
 *
 * Design rules:
 *   - a hook that throws is caught and logged, never turned into a second
 *     failure (a reporting outage must not take down the page that was already
 *     failing);
 *   - one failing hook does not stop the others;
 *   - nothing is reported twice for one request.
 */
import type { ServerErrorContext, VeskPlugin } from '@vesk/types';

export interface BuildConfigLike {
  version?: number;
  buildId?: string;
  veskVersion?: string;
  [key: string]: unknown;
}

/** Process-wide hook list; the config's plugins are registered at boot. */
const hooks: Array<(err: unknown, ctx: ServerErrorContext) => void | Promise<void>> = [];
const reported = new WeakSet<object>();

export function registerErrorReporter(fn: (err: unknown, ctx: ServerErrorContext) => void | Promise<void>): void {
  if (typeof fn === 'function') hooks.push(fn);
}

export function clearErrorReporters(): void {
  hooks.length = 0;
}

export function errorReporterCount(): number {
  return hooks.length;
}

/** Register every plugin that declares `onError`. */
export function registerErrorHooks(plugins: VeskPlugin[] | null | undefined): void {
  for (const plugin of plugins || []) {
    if (plugin && typeof plugin.onError === 'function') registerErrorReporter(plugin.onError);
  }
}

export interface ReportOptions {
  url?: string;
  routePath?: string;
  target: ServerErrorContext['target'];
  status?: number;
  durationMs?: number;
  buildConfig?: BuildConfigLike | null;
  /** Suppress a duplicate report for the same error object. */
  dedupe?: boolean;
}

/**
 * Report a production failure. Never throws: a failure to report is logged and
 * swallowed, because the caller is already handling a worse problem.
 */
export async function reportServerError(err: unknown, options: ReportOptions): Promise<void> {
  if (options.dedupe !== false && err && typeof err === 'object') {
    if (reported.has(err as object)) return;
    reported.add(err as object);
  }
  const cfg = options.buildConfig || null;
  const ctx: ServerErrorContext = {
    url: options.url,
    routePath: options.routePath,
    target: options.target,
    status: options.status ?? 500,
    durationMs: options.durationMs,
    version: typeof cfg?.veskVersion === 'string' ? cfg.veskVersion : undefined,
    buildId: typeof cfg?.buildId === 'string' ? cfg.buildId : undefined,
    errorName: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  for (const hook of hooks) {
    try {
      await hook(err, ctx);
    } catch (e) {
      console.error('vesk: an onError hook threw and was ignored:', (e as Error)?.message ?? e);
    }
  }
}
