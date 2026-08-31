import type { DiagnosticFinding } from '@vesk/adapter/src/dev-api';

export const BUNDLE_WARN_BYTES = 300 * 1024;

export interface DiagnosticInput {
  /** Latest measured client-bundle bytes (0 = not measured yet). */
  bundleBytes: number;
  /** Plugin names declared in vesk.config.ts `plugins`. */
  configPluginNames: string[];
  /** Live compile/build findings (recorded by the dev loop). */
  findings: DiagnosticFinding[];
}

/**
 * Aggregate a diagnostic snapshot: the live compile/build findings plus the
 * derived bundle-size and plugin-conflict signals. Pure and deterministic so
 * the dev server's `getDiagnostics` can be unit-tested.
 */
export function produceDiagnostics(input: DiagnosticInput): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = [...input.findings];
  if (input.bundleBytes > 0) {
    const kb = (input.bundleBytes / 1024).toFixed(1);
    if (input.bundleBytes >= BUNDLE_WARN_BYTES) {
      out.push({
        severity: 'warning', code: 'BUNDLE_SIZE', file: null,
        message: `Client bundle is ${kb} KB; consider lazy-loading routes or trimming heavy imports.`,
        hint: 'Code-split large pages or tree-shake heavy dependencies to reduce the initial payload.',
      });
    } else {
      out.push({
        severity: 'info', code: 'BUNDLE_SIZE', file: null,
        message: `Client bundle is ${kb} KB.`, hint: null,
      });
    }
  }
  const seen = new Set<string>();
  for (const name of input.configPluginNames) {
    if (seen.has(name)) {
      out.push({
        severity: 'warning', code: 'PLUGIN_CONFLICT', file: null,
        message: `Plugin "${name}" is declared more than once in vesk.config.ts.`,
        hint: 'Remove the duplicate entry; only one instance can be active.',
      });
    }
    seen.add(name);
  }
  return out;
}
