export interface SsrDataPayload {
  props?: Record<string, unknown>;
  ssrData?: Record<string, unknown>;
}

export function escapeForScript(json: string): string {
  return json
    .split('<').join('\\u003c')
    .split('\u2028').join('\\u2028')
    .split('\u2029').join('\\u2029');
}

export function buildSsrDataScript(payload: SsrDataPayload | null | undefined): string {
  const lines: string[] = [];
  if (payload?.props) lines.push(`globalThis.__vesk_props = ${escapeForScript(JSON.stringify(payload.props))};`);
  if (payload?.ssrData) lines.push(`globalThis.__vsk_ssr_data = ${escapeForScript(JSON.stringify(payload.ssrData))};`);
  return lines.join('\n') || '// no ssr data';
}
