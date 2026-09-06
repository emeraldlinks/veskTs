import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

/**
 * CLI hmm dev-server recovery integration test.
 *
 * Spawns the real `vesk dev` (packages/cli/dist/cli.js) inside the repo's
 * test-app and drives a full break/fix cycle over the HMR WebSocket:
 *
 *  1. a broken app at BOOT must NOT kill the dev server — it serves the error
 *     and replays it on ws connect + /__vesk/hmr/state;
 *  2. breaking a file broadcasts `error` and clears on... no — sets state;
 *  3. the first SUCCESSFUL build after an error broadcasts `reload` (not a
 *     plain `update`) so the page reboots onto a consistent fixed app;
 *  4. a normal (error-free) edit still broadcasts `update`.
 *
 * Run: npx tsx packages/cli/src/dev-hmr-recovery.test.ts  (needs a fresh
 * packages/cli/dist/cli.js — run `npx tsx packages/cli/build.ts` first).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..', '..');
const CLI = resolve(root, 'packages', 'cli', 'dist', 'cli.js');
const APP = resolve(root, 'test-app');
const pagePath = resolve(APP, 'app', 'page.vsk');

const CLEAN = `import { track } from "@vesk/runtime"\n\ncomponent Home {\n\tconst &[count] = track(0)\n\treturn <div>\n\t\t<h1>Ok {count}</h1>\n\t\t<button onClick={() => count++}>+</button>\n\t</div>\n}\n`;
const BROKEN = `import { track } from "@vesk/runtime"\n\ncomponent Home {\n\tconst &[count] = track(0)\n\treturn <div>\n\t\t<p class="x">bad {}\n\t</div>\n}\n`;

let passed = 0;
let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 ${msg}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  try {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
  } catch {
    return { status: 0, text: '' };
  }
}

interface DevServer {
  proc: ReturnType<typeof spawn>;
  port: number;
  events: string[];
  close(): void;
}

async function startDev(port: number): Promise<DevServer> {
  const proc = spawn('node', [CLI, 'dev', '-p', String(port)], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!(await waitFor(port, async () => (await fetchText(`http://127.0.0.1:${port}/__vesk/hmr/state`)).status === 200, 40))) {
    proc.kill('SIGTERM');
    throw new Error(`dev server on :${port} never came up`);
  }
  const events: string[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/_vesk/hmr`);
  const t0 = Date.now() / 1000;
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    events.push(`${(Date.now() / 1000 - t0).toFixed(1)}s ${m.type}${m.fnSources ? ' [fnSources]' : ''}`);
  });
  await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', (e) => j(e)); });
  return {
    proc,
    port,
    events,
    close() { try { ws.close(); } catch {} try { proc.kill('SIGTERM'); } catch {} },
  };
}

async function waitFor(port: number, probe: () => Promise<boolean>, tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await probe()) return true;
    await sleep(500);
  }
  return false;
}

async function main() {
  const original = readFileSync(pagePath, 'utf-8');
  let server: DevServer | undefined;
  try {
    // ── Scenario 1: broken app at boot must not kill the dev server ──
    console.log('\n=== broken-at-boot: server survives, error served + replayed, fix => reload ===');
    writeFileSync(pagePath, BROKEN);
    const port1 = 3101;
    server = await startDev(port1);
    assert(await waitFor(port1, async () => (await fetchText(`http://127.0.0.1:${port1}/__vesk/hmr/state`)).status === 200), 'dev server responds after booting with a broken app');
    const st1 = JSON.parse((await fetchText(`http://127.0.0.1:${port1}/__vesk/hmr/state`)).text);
    assert(!!st1.error && /Unexpected token/.test(st1.error.message), `/__vesk/hmr/state carries the boot error (${(st1.error || {}).message?.slice(0, 40)})`);
    const bootPage = await fetchText(`http://127.0.0.1:${port1}/`);
    assert(bootPage.status === 500, `broken page serves an SSR 500 (got ${bootPage.status})`);
    assert(server.proc.exitCode === null, 'dev server process is still alive despite the boot error');
    assert(server.events.some((e) => e.includes('error')), 'ws replay reaches a fresh client after boot error');
    writeFileSync(pagePath, CLEAN);
    assert(await waitFor(port1, () => Promise.resolve(server!.events.some((e) => e.includes('reload'))), 40), 'first successful fix after a boot error broadcasts reload');
    const st1b = JSON.parse((await fetchText(`http://127.0.0.1:${port1}/__vesk/hmr/state`)).text);
    assert(st1b.error === null, 'state error cleared after the fix');
    server.close(); server = undefined;

    // ── Scenario 2: clean boot, normal edit = update; break = error; fix = reload ──
    console.log('\n=== clean boot: normal edit => update, break => error, fix-after-error => reload ===');
    writeFileSync(pagePath, CLEAN);
    const port2 = 3102;
    server = await startDev(port2);
    assert(await waitFor(port2, async () => (await fetchText(`http://127.0.0.1:${port2}/`)).status === 200), 'sane boot serves 200');
    writeFileSync(pagePath, CLEAN.replace('Ok {count}', 'Okay {count}'));
    assert(await waitFor(port2, () => Promise.resolve(server!.events.some((e) => e.includes('update'))), 40), 'valid edit without a prior error broadcasts update (in-place HMR kept)');
    assert(!server.events.some((e) => e.includes('reload')), 'no reload on a normal edit');
    writeFileSync(pagePath, BROKEN);
    assert(await waitFor(port2, () => Promise.resolve(server!.events.some((e) => e.includes('error'))), 40), 'broken edit broadcasts error');
    writeFileSync(pagePath, CLEAN);
    assert(await waitFor(port2, () => Promise.resolve(server!.events.some((e) => e.includes('reload'))), 40), 'fix after an error broadcasts reload (instead of a plain update)');
    const lastErrorIdx = server.events.map((e) => e.includes('error')).lastIndexOf(true);
    const afterRecovery = server.events.slice(lastErrorIdx);
    assert(!afterRecovery.some((e) => e.includes('update') && e.includes('fnSources')), 'recovery is a reload, not a masked in-place update');
    server.close(); server = undefined;

  } finally {
    try { server?.close(); } catch {}
    writeFileSync(pagePath, original);
  }

  console.log(`\n\u2550\u2550\u2550 Results: ${passed} passed, ${failed} failed \u2550\u2550\u2550`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('test error:', e); process.exit(1); });