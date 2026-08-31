import { produceDiagnostics, BUNDLE_WARN_BYTES, type DiagnosticInput } from './dev-diagnostics';
import type { DiagnosticFinding } from '@vesk/adapter/src/dev-api';

function entry(over?: Partial<DiagnosticInput>): DiagnosticInput {
  return { bundleBytes: 0, configPluginNames: [], findings: [], ...over };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function codes(list: DiagnosticFinding[]): string[] {
  return list.map((f) => f.code);
}

// static findings are preserved, nothing appended when there is no signal
{
  const out = produceDiagnostics(entry({ findings: [{ severity: 'info', code: 'X', message: 'hello' }] }));
  assert(JSON.stringify(codes(out)) === JSON.stringify(['X']), 'preserves static findings, no derived signals');
}

// small bundle -> info
{
  const out = produceDiagnostics(entry({ bundleBytes: 10 * 1024 }));
  const b = out.find((f) => f.code === 'BUNDLE_SIZE');
  assert(!!b, 'bundle-size finding present');
  assert(b!.severity === 'info', 'small bundle severity = info');
  assert(b!.hint === null, 'small bundle has no hint');
}

// large bundle -> warning with hint
{
  const out = produceDiagnostics(entry({ bundleBytes: BUNDLE_WARN_BYTES + 1024 }));
  const b = out.find((f) => f.code === 'BUNDLE_SIZE');
  assert(!!b, 'bundle-size warning present');
  assert(b!.severity === 'warning', 'large bundle severity = warning');
  assert(typeof b!.hint === 'string' && b!.hint.length > 0, 'large bundle has a fix hint');
}

// duplicate plugin -> PLUGIN_CONFLICT, once, with hint
{
  const out = produceDiagnostics(entry({ configPluginNames: ['tailwind', 'tailwind'] }));
  const conflicts = out.filter((f) => f.code === 'PLUGIN_CONFLICT');
  assert(conflicts.length === 1, 'single PLUGIN_CONFLICT for one duplicate name');
  assert(conflicts[0].severity === 'warning', 'conflict severity = warning');
  assert(typeof conflicts[0].hint === 'string', 'conflict has a hint');
}

// unique plugins -> no conflict
{
  const out = produceDiagnostics(entry({ configPluginNames: ['a', 'b', 'c'] }));
  assert(codes(out).indexOf('PLUGIN_CONFLICT') === -1, 'no conflict for unique names');
}

console.log('dev-diagnostics.test.ts: all checks passed');
