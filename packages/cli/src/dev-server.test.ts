/**
 * CLI dev server — dev-panel endpoints + dev-script injection.
 *
 * `vesk dev` runs `packages/cli/src/dev-server.ts` (NOT the adapter's dev
 * server). Its `/__vesk/*` panel routes through the shared adapter
 * `createDevApiRouter` via the `routeDevPanel` Node req/res wrapper, and its
 * SSR shapes inject the `DEV_SCRIPTS` pair through `injectDevScripts`. This
 * test drives `routeDevPanel` with fake req/res + a real temp project dir
 * (real `.vesk/plugins.json` reads/writes) and asserts `injectDevScripts`
 * output for every SSR shape.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeDevPanel, injectDevScripts, injectSsrErrorMarker, DEV_SCRIPTS, buildDevErrorPayload } from './dev-server.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function makeReq(method: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  let i = 0;
  return {
    method,
    [Symbol.asyncIterator]() {
      return {
        next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
      };
    },
  } as unknown as IncomingMessage;
}

/** Returns a live recorder: read rec.status / rec.body AFTER awaiting. */
function makeRes() {
  const rec: { status: number; body: string } = { status: 0, body: '' };
  const res = {
    writeHead(status: number) { rec.status = status; return res; },
    end(data?: string) { rec.body = data || ''; },
  } as unknown as ServerResponse;
  return { res, rec };
}

let tmpProject: string;
let veskDir: string;

async function main() {
  console.log('\n=== CLI dev server: dev-panel endpoints + script injection ===');

  tmpProject = mkdtempSync(join(tmpdir(), 'vesk-dev-srv-'));
  veskDir = join(tmpProject, '.vesk');
  mkdirSync(veskDir, { recursive: true });
  writeFileSync(join(veskDir, 'plugins.json'), JSON.stringify({ version: 1, plugins: [] }));

  const deps = () => ({
    projectDir: tmpProject,
    veskDir,
    configNames: () => ['tailwind', 'image-optimizer'],
    getHmrState: () => ({ status: 'up', lastCompileMs: 12, error: null, hasError: false, nonce: 'abc' }),
    maxBodyBytes: 1024 * 1024,
  });

  // ---- GET /__vesk/hmr/state ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/hmr/state'), deps());
    assert(rec.status === 200, 'GET /__vesk/hmr/state -> 200');
    const state = JSON.parse(rec.body) as Record<string, unknown>;
    assert(state.status === 'up' && state.lastCompileMs === 12 && state.hasError === false && state.error === null, 'state shape has status/lastCompileMs/error/hasError/nonce');
    assert(state.nonce === 'abc', 'state carries the HMR nonce for the overlay');
  }

  // ---- GET /__vesk/plugins ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/plugins'), deps());
    assert(rec.status === 200, 'GET /__vesk/plugins -> 200');
    const parsed = JSON.parse(rec.body) as { plugins: Array<Record<string, unknown>> };
    assert(Array.isArray(parsed.plugins), 'plugins payload is { plugins: [...] } (shared router contract)');
    assert(parsed.plugins.length === 2, `config plugins listed as records (got ${parsed.plugins.length})`);
    const tw = parsed.plugins.find(m => m.name === 'tailwind');
    assert(!!tw, 'tailwind record present by name');
    assert(tw!.source === 'config' && tw!.installed === false, 'config plugin marked source=config, not installed (shared contract)');
  }

  // ---- POST activate/deactivate round-trip (real plugins.json) ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST', { name: 'tailwind' }), res, new URL('http://x/__vesk/plugins/deactivate'), deps());
    assert(rec.status === 200, 'POST /__vesk/plugins/deactivate -> 200');
    const state = JSON.parse(readFileSync(join(veskDir, 'plugins.json'), 'utf-8')) as { plugins: Array<Record<string, unknown>> };
    assert(state.plugins.length === 1 && state.plugins[0].name === 'tailwind' && state.plugins[0].active === false, 'deactivate writes active=false to .vesk/plugins.json');

    const r2 = makeRes();
    await routeDevPanel(makeReq('POST', { name: 'tailwind' }), r2.res, new URL('http://x/__vesk/plugins/activate'), deps());
    assert(r2.rec.status === 200, 'POST /__vesk/plugins/activate -> 200');
    const refreshed = JSON.parse(r2.rec.body) as { record: Record<string, unknown> };
    assert(!!refreshed.record && refreshed.record.name === 'tailwind', 'activate response reflects the live record by name');

    const state2 = JSON.parse(readFileSync(join(veskDir, 'plugins.json'), 'utf-8')) as { plugins: Array<Record<string, unknown>> };
    assert(state2.plugins[0].active === true, 'activate writes active=true to state file');
  }

  // ---- POST activate without name ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST', {}), res, new URL('http://x/__vesk/plugins/deactivate'), deps());
    assert(rec.status === 400 && /name/.test(JSON.parse(rec.body).error), 'deactivate without name -> 400 with "name" error');
  }

  // ---- POST install validation error (no npm run) ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST', { package: 'not a valid spec' }), res, new URL('http://x/__vesk/plugins/install'), deps());
    assert(rec.status === 500, 'install with invalid package spec -> 500 without running npm');
  }

  // ---- POST uninstall without package ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST', {}), res, new URL('http://x/__vesk/plugins/uninstall'), deps());
    assert(rec.status === 400, 'uninstall without package -> 400');
  }

  // ---- GET /__vesk/config (shared surface) ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/config'), deps());
    assert(rec.status === 200, 'GET /__vesk/config -> 200 (config.read capability wired in CLI)');
    const parsed = JSON.parse(rec.body) as { exists: boolean };
    assert(parsed.exists === false, 'config endpoint reaches the shared router');
  }

  // ---- POST /__vesk/build without a hook -> 503 ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST'), res, new URL('http://x/__vesk/build'), deps());
    assert(rec.status === 503, 'build without a hook -> 503 (build surface wired, no hook in CLI panel test)');
  }

  // ---- POST /__vesk/build with a rebuild hook -> 200 + reload broadcast ----
  {
    let rebuilt = 0;
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST'), res, new URL('http://x/__vesk/build'), {
      ...deps(),
      rebuild: async () => { rebuilt++; return { ok: true, ms: 7 }; },
    });
    assert(rec.status === 200 && JSON.parse(rec.body).ok === true, 'build with a hook -> 200 ok');
    assert(JSON.parse(rec.body).ms === 7 && rebuilt === 1, 'rebuild hook invoked once, ms echoed');
  }

  // ---- GET /__vesk/diagnostics returns the injected findings ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/diagnostics'), {
      ...deps(),
      getDiagnostics: () => ([{ severity: 'warning' as const, code: 'BUNDLE_SIZE', message: 'large page bundle' }]),
    });
    assert(rec.status === 200, 'GET /__vesk/diagnostics -> 200');
    const parsed = JSON.parse(rec.body) as { diagnostics: Array<{ code: string }> };
    assert(Array.isArray(parsed.diagnostics) && parsed.diagnostics[0].code === 'BUNDLE_SIZE', 'diagnostics surface the injected finding');
  }

  // ---- unknown endpoint ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/nope'), deps());
    assert(rec.status === 404, 'unknown /__vesk/* endpoint -> 404');
  }

  // ---- body beyond maxBodyBytes is dropped ----
  {
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('POST', { name: 'tailwind' }), res, new URL('http://x/__vesk/plugins/activate'), { ...deps(), maxBodyBytes: 8 });
    assert(rec.status === 413, 'oversized body is dropped -> 413');
  }

  // ---- injectDevScripts ----
  {
    const clean = '<html><head></head><body><div>hi</div></body></html>';
    const out = injectDevScripts(clean);
    const count = (out.match(/\/_vesk\/(client|hmr)\.js/g) || []).length;
    assert(count === 2 && out.includes(DEV_SCRIPTS), 'injects client.js + hmr.js exactly once before </body>');
    assert(out.split(DEV_SCRIPTS).length === 2, 'dev-script pair appears exactly once');

    const noBody = '<html><body>no closing tag here';
    assert(injectDevScripts(noBody) === noBody, 'no-op when </body> is absent (streamed partial/plain responses)');
  }

  // ---- injection reaches every SSR shape ----
  {
    const shapes: string[] = [
      injectDevScripts('<!DOCTYPE html><html><head></head><body>\n<div id="root"></div>\n</body>\n</html>'), // layout
      injectDevScripts('<!DOCTYPE html><html><head></head><body><h1>404</h1></body></html>'), // not-found
      injectDevScripts('<!DOCTYPE html><html><head></head><body><h1>err</h1></body></html>'), // error page
    ];
    for (let i = 0; i < shapes.length; i++) {
      const leaks = (shapes[i].split('/_vesk/').length - 1);
      assert(leaks === 2, `single dev-script pair in shape ${i} (leaks=${leaks})`);
    }
  }

  // ---- buildDevErrorPayload (canonical HMR error payload for the CLI path) ----
  {
    const appDir = join(tmpProject, 'app');
    mkdirSync(appDir, { recursive: true });
    const srcLines: string[] = [];
    for (let i = 1; i <= 21; i++) {
      srcLines.push(i === 11 ? 'const {{{ broken' : `const line${i} = ${i};`);
    }
    const src = srcLines.join('\n');
    const file = join(appDir, 'page.vsk');
    writeFileSync(file, src, 'utf-8');

    const veskErr = Object.assign(new Error(`Unexpected token in ${file}`), {
      name: 'VeskError',
      line: 11,
      column: 3,
      file,
      tip: 'Check for missing or extra brackets.',
      suggestions: ['Remove the extra braces', 'Close the block'],
      nextSteps: ['Fix the syntax error and save'],
      code: '11 | const {{{ broken\n   |   ^',
    });

    const p = buildDevErrorPayload({
      err: veskErr,
      errorMessage: veskErr.message,
      filename: 'page.vsk',
      fullPath: file,
      appDir,
      fileExists: true,
    });

    assert(p.message === 'Unexpected token', 'payload strips the redundant " in <abs file>" suffix from the message');
    assert(p.file === 'page.vsk', 'payload keeps the watcher-relative file name');
    assert(p.line === 11 && p.column === 3, 'payload keeps the VeskError line/column');
    assert(p.codeframe !== undefined && Array.isArray(p.codeframe.code), 'payload carries a structured codeframe (not a plain string)');
    assert(p.codeframe!.code.length === 11, 'payload codeframe spans 5 above + error line + 5 below');
    const errLines = p.codeframe!.code.filter((l) => l.isError);
    assert(errLines.length === 1 && errLines[0].no === 11, 'payload codeframe highlights exactly the error line');
    assert(p.codeframe!.file === 'page.vsk', 'payload codeframe names the watcher-relative file');
    assert(!!p.tips && p.tips[0] === 'Check for missing or extra brackets.', 'payload promotes the VeskError tip first');
    assert(!!p.suggestions && p.suggestions.length === 2, 'payload keeps the VeskError suggestions');
    assert(!!p.nextSteps && p.nextSteps.length === 1, 'payload keeps the VeskError nextSteps');
  }

  // ---- buildDevErrorPayload: foreign shape fallback (regex line/col scan) ----
  {
    const appDir = join(tmpProject, 'app');
    const src = Array.from({ length: 10 }, (_, i) => `const n${i + 1} = ${i + 1};`).join('\n');
    writeFileSync(join(appDir, 'page.vsk'), src, 'utf-8');
    const p = buildDevErrorPayload({
      err: new Error('Parse failed at line 6 column 2'),
      errorMessage: 'Parse failed at line 6 column 2',
      filename: 'page.vsk',
      fullPath: join(appDir, 'page.vsk'),
      appDir,
      fileExists: true,
    });
    assert(p.line === 6 && p.column === 2, 'foreign shape: line/column recovered from a message keyword scan');
    assert(
      p.codeframe !== undefined && p.codeframe!.code.filter((l) => l.isError)[0].no === 6,
      'foreign shape: codeframe is rebuilt from the on-disk source',
    );
    assert(!!p.tips && Array.isArray(p.tips) && p.tips.length >= 1, 'foreign shape: tips populated from the message');
  }

  // ---- SSR-error fallback page carries BOTH the dev script pair and the
  // SSR-error marker (refresh of a broken page without error.vsk must still
  // get the overlay + an HMR socket, so the fix reaches the tab) ----
  {
    const fallback = injectDevScripts('<!DOCTYPE html><html><body><h1>500</h1><pre>Unexpected token</pre></body></html>');
    const page = injectSsrErrorMarker(fallback, new Error('Unexpected token'));
    assert(page.includes('vesk-ssr-error:'), 'fallback error page bakes the SSR error marker for hmr-client');
    assert((page.split('/_vesk/').length - 1) === 2, 'fallback error page carries client.js + hmr.js so HMR reconnects after refresh');
    assert(page.indexOf('vesk-ssr-error:') > page.indexOf('<body'), 'marker sits inside the body so the comment walker finds it');
    assert(
      injectSsrErrorMarker('<html><body><h1>500</h1></body></html>', new Error('boom')).includes('vesk-ssr-error:boom'),
      'marker encodes the raw server error message for the overlay on load',
    );
  }

  // ---- getHmrState: full HmrErrorPayload (with codeframe) passes through the
  // /__vesk/hmr/state replay surface ----
  {
    const fullPayload = buildDevErrorPayload({
      err: new Error('Parse failed at line 6 column 2'),
      errorMessage: 'Parse failed at line 6 column 2',
      filename: 'page.vsk',
      fullPath: join(join(tmpProject, 'app'), 'page.vsk'),
      appDir: join(tmpProject, 'app'),
      fileExists: true,
    });
    const { res, rec } = makeRes();
    await routeDevPanel(makeReq('GET'), res, new URL('http://x/__vesk/hmr/state'), {
      ...deps(),
      getHmrState: () => ({ status: 'error', lastCompileMs: null, error: fullPayload, hasError: true, componentCount: 0 }),
    });
    assert(rec.status === 200, 'GET /__vesk/hmr/state with a full error payload -> 200');
    const state = JSON.parse(rec.body) as { error: { message: string; file?: string; codeframe?: unknown; line?: number | null } };
    assert(state.error.message === 'Parse failed at line 6 column 2', 'state passes the raw compile error through');
    assert(state.error.codeframe !== undefined && state.error.line === 6, 'state replays the structured codeframe so a refreshed page restores the red error line');
  }

  rmSync(tmpProject, { recursive: true, force: true });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) { console.log('All tests passed!'); process.exit(0); }
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
