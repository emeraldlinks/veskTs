/**
 * Server events pipeline: `compileEvents` bundles `app/_events.ts` into a
 * self-contained `server/events.js` that routes set/get into the process-wide
 * server context.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileEvents } from './events.js';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string) { if (c) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.log(`  ✗ ${msg}`); } }

function writeFixture(files: Record<string, string>): string {
  const tmp = mkdtempSync(join(tmpdir(), 'vesk-events-adapter-'));
  for (const [p, content] of Object.entries(files)) {
    const full = resolve(tmp, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return tmp;
}

const g = globalThis as Record<string, unknown>;

async function main() {
  console.log('\n=== compileEvents: _events.ts -> server/events.js ===');

  // no events file -> false, no output
  {
    const tmp = writeFixture({
      'app/page.vsk': '',
      'server/.keep': '',
    });
    const ok = await compileEvents(join(tmp, 'app'), join(tmp, 'build'));
    assert(ok === false, 'returns false when no _events file');
    assert(!existsSync(join(tmp, 'build', 'server', 'events.js')), 'no events.js emitted without events file');
    rmSync(tmp, { recursive: true, force: true });
  }

  // compile a TS events file with a relative import; execute start/request/stop
  {
    const tmp = writeFixture({
      'app/_events.ts': [
        "import type { ServerEventContext } from '@vesk/types';",
        "import { greeting } from './lib/msg';",
        'export async function onStart(ctx: ServerEventContext) {',
        "  await ctx.set('db', 'connected');",
        "  ctx.set('greet', greeting());",
        '}',
        'export async function onRequest(ctx: ServerEventContext) {',
        "  ctx.set('lastPath', ctx.url?.pathname ?? '');",
        '}',
        'export function onStop() {',
        '  return;',
        '}',
      ].join('\n'),
      'app/lib/msg.ts': 'export function greeting() { return "hi"; }',
    });
    const ok = await compileEvents(join(tmp, 'app'), join(tmp, 'build'));
    assert(ok === true, 'compiles when _events.ts exists');
    const eventsPath = join(tmp, 'build', 'server', 'events.js');
    assert(existsSync(eventsPath), 'emits server/events.js');
    assert(statSync(eventsPath).size > 100, 'events.js is non-trivial');

    const mod = await import(pathToFileURL(eventsPath) + `?t=${Date.now()}`);
    assert(typeof mod.executeStart === 'function', 'exports executeStart');
    assert(typeof mod.executeRequest === 'function', 'exports executeRequest');
    assert(typeof mod.executeStop === 'function', 'exports executeStop');
    assert(typeof mod.onStart === 'function', 're-exports onStart');
    assert(typeof mod.onRequest === 'function', 're-exports onRequest');
    assert(typeof mod.onStop === 'function', 're-exports onStop');

    const bootCtx = { server: { listen: () => {} }, port: 3000, host: '0.0.0.0' };
    await mod.executeStart(bootCtx);
    assert((g.__vesk_server_ctx as Record<string, unknown>)?.db === 'connected', 'onStart set() lands in server ctx');
    assert((g.__vesk_server_ctx as Record<string, unknown>)?.greet === 'hi', 'relative import bundled into events.js');
    assert(typeof mod.onStart === 'function', 'onStart export present');

    const reqCtx = { url: new URL('http://localhost/blog'), params: {}, locals: {} };
    await mod.executeRequest(reqCtx);
    assert((g.__vesk_server_ctx as Record<string, unknown>)?.lastPath === '/blog', 'onRequest set() lands in server ctx');

    // guard: second executeStart must not re-run onStart
    (g.__vesk_events_started) = true;
    await mod.executeStart(bootCtx);
    assert((g.__vesk_server_ctx as Record<string, unknown>).bootCount === undefined, 'executeStart idempotent under guard');

    await mod.executeStop(bootCtx);
    assert(g.__vesk_events_started === false, 'executeStop clears the started guard');

    try {
      if (g.__vesk_server_ctx) for (const k of Object.keys(g.__vesk_server_ctx as object)) delete (g.__vesk_server_ctx as Record<string, unknown>)[k];
      g.__vesk_server_ctx = undefined;
      g.__vesk_events_started = undefined;
      rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
  console.log('All adapter events tests passed!');
}

main().catch((e) => { console.error(e); process.exit(1); });