/**
 * @vesk/agentic — dev-api.test.ts
 *
 * Zero-deps, no vitest. Runnable via: npx tsx packages/agentic/src/dev-api.test.ts
 * Throws on failure (non-zero exit). Exercises `createAgentRouter` with fake
 * injectables — no socket, no listener.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createAgentRouter, type DevPanelResponse } from './dev-api.js';
import type { AgentResult, AgentStreamEvent } from './loop.js';
import { AgentCapabilityTable } from './permissions.js';

let passed = 0;
let failed = 0;

function pass(msg: string): void {
  passed++;
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): void {
  failed++;
  console.log(`  ✗ ${msg}`);
}
function assert(cond: unknown, msg: string): void {
  if (cond) pass(msg);
  else fail(msg);
}
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    fail(`${name} — ${(e as Error).message}`);
  }
}

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'vesk-agentic-deveapi-'));
  mkdirSync(resolve(dir, '.vesk', 'agentic'), { recursive: true });
  writeFileSync(
    resolve(dir, '.vesk', 'agentic', 'config.json'),
    JSON.stringify({ provider: 'openai', model: 'gpt-4o', mode: 'agent', maxSteps: 25 }),
  );
  return dir;
}

interface RouterHarness {
  dir: string;
  runAgentCalls: Array<{ prompt: string; mode: string; providerConfig: unknown }>;
  runAgentStreamCalls: Array<{ prompt: string; mode: string; providerConfig: unknown }>;
  router: ReturnType<typeof createAgentRouter>;
  streamProvider?: (prompt: string, mode: string, providerConfig?: unknown) => AsyncIterable<AgentStreamEvent>;
}

async function makeHarness(opts: { stream?: boolean } = {}): Promise<RouterHarness> {
  const dir = makeProjectDir();
  const runAgentCalls: RouterHarness['runAgentCalls'] = [];
  const runAgentStreamCalls: RouterHarness['runAgentStreamCalls'] = [];
  let streamProvider: RouterHarness['streamProvider'] = undefined;
  const router = createAgentRouter({
    projectDir: dir,
    appDir: resolve(dir, 'app'),
    veskDir: resolve(dir, '.vesk'),
    getPermissions: () => new AgentCapabilityTable('agent'),
    runAgent: async (prompt: string, mode: string, providerConfig?: unknown): Promise<AgentResult> => {
      runAgentCalls.push({ prompt, mode, providerConfig });
      return { text: 'plain reply', steps: 1, messages: [] };
    },
    runAgentStream: opts.stream
      ? async function* (prompt: string, mode: string, providerConfig?: unknown): AsyncGenerator<AgentStreamEvent> {
          runAgentStreamCalls.push({ prompt, mode, providerConfig });
          yield { type: 'step', step: 1, budget: 25 };
          yield { type: 'assistant_start', step: 1 };
          yield { type: 'text_delta', content: 'stream' };
          yield { type: 'text_delta', content: 'ed reply' };
          yield { type: 'assistant_end', step: 1, content: 'streamed reply' };
          yield { type: 'done', result: { text: 'streamed reply', steps: 1, messages: [] } };
        }
      : undefined,
    listCheckpoints: () => [],
    rollback: () => null,
    createCheckpoint: () => ({} as never),
  });
  return { dir, runAgentCalls, runAgentStreamCalls, router, streamProvider };
}

async function collect(res: DevPanelResponse): Promise<string> {
  if (!res.stream) return res.body;
  let out = '';
  for await (const chunk of res.stream) out += chunk;
  return out;
}

function parseSse(raw: string): Array<{ event: string; data: unknown }> {
  const frames: Array<{ event: string; data: unknown }> = [];
  const blocks = raw.split('\n\n').filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.indexOf('event:') === 0) event = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) data = line.slice(5).trim();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
    frames.push({ event, data: parsed });
  }
  return frames;
}

console.log('\n═══ @vesk/agentic — dev-api router tests ═══\n');

// ── 1: non-stream run path ──────────────────────────────────────────────────
await test('POST /run with a providerConfig returns { ok, result }', async () => {
  const h = await makeHarness();
  const res = await h.router.route('POST', '/__vesk/agent/run', {
    prompt: 'what is 2+2',
    providerConfig: { provider: 'openai', model: 'gpt-4o' },
  });
  assert(res !== null, 'route matched');
  assert(res!.status === 200, 'status 200');
  const body = JSON.parse(await collect(res!)) as { ok?: boolean; result?: { text?: string } };
  assert(body.ok === true, 'ok true');
  assert(body.result?.text === 'plain reply', 'result text relayed');
  assert(h.runAgentCalls.length === 1, 'runAgent invoked once');
});

await test('POST /run merges maxSteps into providerConfig', async () => {
  const h = await makeHarness();
  const res = await h.router.route('POST', '/__vesk/agent/run', {
    prompt: 'do the thing',
    maxSteps: 60,
    providerConfig: { provider: 'opencode', model: 'claude-sonnet-4-6' },
  });
  assert(res!.status === 200, 'status 200');
  const pc = h.runAgentCalls[0]?.providerConfig as Record<string, unknown> | undefined;
  assert(pc?.maxSteps === 60, 'maxSteps threaded into providerConfig for the runner');
});

await test('POST /run without prompt returns 400', async () => {
  const h = await makeHarness();
  const res = await h.router.route('POST', '/__vesk/agent/run', {});
  assert(res?.status === 400, 'missing prompt → 400');
});

// ── 2: streaming path ───────────────────────────────────────────────────────
await test('POST /run stream:true produces SSE event framing', async () => {
  const h = await makeHarness({ stream: true });
  const res = await h.router.route('POST', '/__vesk/agent/run', { prompt: 'hi', stream: true, maxSteps: 25 });
  assert(res !== null, 'route matched');
  assert(res!.status === 200, 'status 200');
  assert((res!.headers['Content-Type'] ?? '').indexOf('text/event-stream') === 0, 'SSE content-type');
  assert(res!.stream !== undefined, 'stream iterable present');
  const raw = await collect(res!);
  const frames = parseSse(raw);
  const types = frames.map((f) => f.event);
  assert(types.includes('step'), 'step frame emitted');
  assert(types.filter((t) => t === 'text_delta').length === 2, 'two text_delta frames');
  assert(types[types.length - 1] === 'done', 'done is the final frame');
  const delta = frames.find((f) => f.event === 'text_delta')?.data as { content?: string };
  assert(delta?.content === 'stream', 'text_delta frame carries content');
});

await test('streaming forwards maxSteps to the stream runner', async () => {
  const h = await makeHarness({ stream: true });
  const res = await h.router.route('POST', '/__vesk/agent/run', { prompt: 'hi', stream: true, maxSteps: 77 });
  await collect(res!);
  const pc = h.runAgentStreamCalls[0]?.providerConfig as Record<string, unknown> | undefined;
  assert(pc?.maxSteps === 77, 'maxSteps threaded into streaming providerConfig');
});

await test('stream runner starts lazily — route returns before first iteration', async () => {
  const h = await makeHarness({ stream: true });
  const res = await h.router.route('POST', '/__vesk/agent/run', { prompt: 'hi', stream: true });
  assert(res !== null && res!.stream !== undefined, 'SSE response produced');
  assert(h.runAgentStreamCalls.length === 0, 'stream runner not invoked until client consumes');
  await collect(res!);
  assert(h.runAgentStreamCalls.length === 1, 'stream runner starts on consumption');
});

await test('POST /run with stream:true but no stream runner falls back to runAgent', async () => {
  const h = await makeHarness({ stream: false });
  const res = await h.router.route('POST', '/__vesk/agent/run', { prompt: 'hi', stream: true, maxSteps: 5 });
  assert(res !== null, 'route matched');
  assert((res!.headers['Content-Type'] ?? '').indexOf('text/event-stream') === -1, 'not SSE when runner unavailable');
  const body = JSON.parse(await collect(res!)) as { ok?: boolean };
  assert(body.ok === true, 'JSON fallback ok');
  assert(h.runAgentCalls.length === 1, 'runAgent used as fallback');
});

// ── 3: streaming error propagation ──────────────────────────────────────────
await test('a throw inside the stream runner becomes an error frame', async () => {
  const dir = makeProjectDir();
  const router = createAgentRouter({
    projectDir: dir,
    appDir: resolve(dir, 'app'),
    veskDir: resolve(dir, '.vesk'),
    getPermissions: () => new AgentCapabilityTable('agent'),
    runAgent: async (): Promise<AgentResult> => ({ text: '', steps: 0, messages: [] }),
    runAgentStream: async function* (): AsyncGenerator<AgentStreamEvent> {
      throw new Error('stream exploded');
    },
  });
  const res = await router.route('POST', '/__vesk/agent/run', { prompt: 'hi', stream: true });
  assert(res !== null && res!.stream !== undefined, 'SSE response produced');
  const raw = await collect(res!);
  const frames = parseSse(raw);
  const errFrame = frames.find((f) => f.event === 'error');
  assert(errFrame !== undefined, 'error frame emitted');
  assert((errFrame?.data as { message?: string })?.message === 'stream exploded', 'error message carried');
});

// ── 4: capability gating ────────────────────────────────────────────────────
await test('denied when permissions table lacks readFiles', async () => {
  const dir = makeProjectDir();
  const router = createAgentRouter({
    projectDir: dir,
    appDir: resolve(dir, 'app'),
    veskDir: resolve(dir, '.vesk'),
    getPermissions: () => new AgentCapabilityTable('explore', { readFiles: false }),
    runAgent: async (): Promise<AgentResult> => ({ text: '', steps: 0, messages: [] }),
  });
  const res = await router.route('POST', '/__vesk/agent/run', { prompt: 'hi' });
  assert(res?.status === 403, 'readFiles denied → 403');
});

await test('non-agent paths fall through to null', async () => {
  const h = await makeHarness();
  const res = await h.router.route('GET', '/__vesk/something-else', null);
  assert(res === null, 'null for unrelated paths');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) throw new Error(`${failed} tests failed`);