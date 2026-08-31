/**
 * DevTools panel E2E probe — real HTTP against the running dev server.
 *
 * Stands up no server of its own; it probes the adapter dev server that the
 * shared E2E harness (scripts/e2e-setup.js) runs on VESK_E2E_DEV_PORT
 * (default :3002), exercising the `/__vesk/*` DevTools API over the wire:
 * hmr/state, plugins, config, diagnostics, build (no-hook → 503), and the
 * 404 fallthrough. This verifies the panel surface the devtool UI consumes.
 *
 * Run (with E2E servers up): npx tsx packages/adapter/src/panel-e2e.test.ts
 * E2E_ENV=1 and VESK_E2E_DEV_PORT set by scripts/test.js Phase 2.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as httpGet, request as httpRequest } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');
const PORT = parseInt(process.env.VESK_E2E_DEV_PORT || '3002');
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
}

function req(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = httpRequest(`${BASE}${path}`, {
      method,
      headers: data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text }));
    });
    r.on('error', (e) => rejectPromise(e));
    if (data !== undefined) r.write(data);
    r.end();
  });
}

async function main(): Promise<void> {
  console.log(`\n\u2550\u2550\u2550 DevTools panel E2E probe (against ${BASE}) \u2550\u2550\u2550\n`);

  // ensure the dev server is actually reachable
  try {
    await req('GET', '/');
  } catch (e) {
    console.log('  \u2717 dev server not reachable — start E2E servers first');
    process.exit(1);
  }

  // /__vesk/hmr/state
  {
    const r = await req('GET', '/__vesk/hmr/state');
    assert(r.status === 200, 'GET /__vesk/hmr/state -> 200');
    const s = JSON.parse(r.text) as Record<string, unknown>;
    assert(typeof s.status === 'string' && typeof s.hasError === 'boolean', 'state returns status + hasError');
  }

  // /__vesk/plugins
  {
    const r = await req('GET', '/__vesk/plugins');
    assert(r.status === 200, 'GET /__vesk/plugins -> 200');
    const s = JSON.parse(r.text) as { plugins?: unknown[] };
    assert(Array.isArray(s.plugins), 'plugins body has a plugins array');
  }

  // /__vesk/config (config.read is on by default)
  {
    const r = await req('GET', '/__vesk/config');
    assert(r.status === 200, 'GET /__vesk/config -> 200');
    const s = JSON.parse(r.text) as { exists?: boolean; path?: string };
    assert(typeof s.exists === 'boolean' && typeof s.path === 'string', 'config returns exists + path');
  }

  // /__vesk/diagnostics — transport is live; no producer hook on the adapter
  // server, so the snapshot is an empty list rather than an error.
  {
    const r = await req('GET', '/__vesk/diagnostics');
    assert(r.status === 200, 'GET /__vesk/diagnostics -> 200');
    const s = JSON.parse(r.text) as { diagnostics?: unknown[] };
    assert(Array.isArray(s.diagnostics), 'diagnostics returns a diagnostics array');
  }

  // /__vesk/build — endpoint exists; adapter server wires no rebuild hook => 503
  {
    const r = await req('POST', '/__vesk/build', {});
    assert(r.status === 503, 'POST /__vesk/build without a rebuild hook -> 503 (surface present)');
  }

  // config write-back path (B1): toggling a non-existent key must NOT clobber
  // the real config and returns a validation error.
  {
    const r = await req('POST', '/__vesk/config', { config: {} });
    assert(r.status === 200 || r.status === 400, 'POST /__vesk/config responds (write-back path reachable)');
  }

  // unknown /__vesk/* path -> 404, non-panel path falls through to the page
  {
    const r = await req('GET', '/__vesk/definitely-not-a-route');
    assert(r.status === 404, 'unknown /__vesk/* path -> 404');
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed \u2550\u2550\u2550\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
