/**
 * @vesk/agentic — loop.test.ts
 *
 * Zero-deps, no vitest. Runnable via: npx tsx packages/agentic/src/loop.test.ts
 * Throws on failure (non-zero exit). Validates the vendored @narimangardi/agent-loop clone.
 */
import { Agent, defineTool, MaxStepsExceededError } from './loop.js';
import type { Provider, CompletionResponse, Tool } from './loop.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
    if ((e as Error).stack) console.log(`    ${(e as Error).stack?.split('\n')[1]?.trim()}`);
  }
}

function expectThrows(fn: () => unknown, msg: string): void {
  try {
    fn();
    failed++;
    console.log(`  ✗ ${msg} — expected throw but none`);
  } catch {
    passed++;
    console.log(`  ✓ ${msg}`);
  }
}

// Helpers
function mockProvider(sequence: CompletionResponse[]): Provider {
  let i = 0;
  return {
    async complete({ messages, tools }) {
      // expose call metadata for capturers via closure tricks in individual tests
      void messages;
      void tools;
      const res = sequence[i++];
      if (!res) throw new Error(`mockProvider exhausted at call ${i}`);
      return res;
    },
  };
}

function msg(content: string): CompletionResponse {
  return { kind: 'message', content };
}

function toolCalls(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): CompletionResponse {
  return { kind: 'tool_calls', toolCalls: calls };
}

console.log('\n═══ @vesk/agentic — Agent loop tests ═══\n');

// ── 1: direct message, no tools ─────────────────────────────────────────────
await test('returns direct message without tools', async () => {
  const provider = mockProvider([msg('hello')]);
  const agent = new Agent({ provider });
  const result = await agent.run('hi');
  assert(result.text === 'hello', 'agent returns provider message text');
  assert(result.steps === 1, 'single step when no tool calls');
  assert(result.messages.length === 2, 'messages: user + assistant');
  assert(result.messages[0].role === 'user' && (result.messages[0] as { content: string }).content === 'hi', 'first message is user prompt');
  assert(result.messages[1].role === 'assistant' && (result.messages[1] as { content: string | null }).content === 'hello', 'assistant final message stored');
});

// ── 2: system prompt injection ──────────────────────────────────────────────
await test('injects system prompt as first message', async () => {
  let capturedMessages: unknown[] = [];
  const provider: Provider = {
    async complete(req) {
      capturedMessages = req.messages;
      return msg('ok');
    },
  };
  const agent = new Agent({ provider, system: 'you are helpful' });
  await agent.run('hey');
  assert((capturedMessages[0] as { role: string; content: string }).role === 'system', 'first message is system');
  assert((capturedMessages[0] as { role: string; content: string }).content === 'you are helpful', 'system content correct');
  assert((capturedMessages[1] as { role: string; content: string }).role === 'user', 'second message is user');
});

await test('no system message when not provided', async () => {
  let captured: unknown[] = [];
  const provider: Provider = {
    async complete(req) {
      captured = req.messages;
      return msg('ok');
    },
  };
  const agent = new Agent({ provider });
  await agent.run('hey');
  assert((captured[0] as { role: string }).role === 'user', 'first message is user when no system');
});

// ── 3: single tool call ─────────────────────────────────────────────────────
await test('executes single tool and feeds result back', async () => {
  const provider = mockProvider([
    toolCalls([{ id: 'c1', name: 'filesystem.read', arguments: { path: 'a.txt' } }]),
    msg('done'),
  ]);
  const read: Tool = { name: 'filesystem.read', description: 'read', parameters: { type: 'object' }, execute: async () => 'file content' };
  const agent = new Agent({ provider, tools: [read] });
  const result = await agent.run('read a.txt');
  assert(result.text === 'done', 'final answer after tool');
  assert(result.steps === 2, 'two steps: tool then message');
  const toolMsg = result.messages.find((m) => m.role === 'tool') as { role: string; content: string; name: string } | undefined;
  assert(toolMsg?.content === 'file content', 'tool result stored as tool message');
  assert(toolMsg?.name === 'filesystem.read', 'tool message carries tool name');
});

// ── 4: parallel tool calls ──────────────────────────────────────────────────
await test('executes parallel tool calls concurrently', async () => {
  const calls: string[] = [];
  const provider = mockProvider([
    toolCalls([
      { id: 'c1', name: 'a', arguments: {} },
      { id: 'c2', name: 'b', arguments: {} },
    ]),
    msg('both done'),
  ]);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => { calls.push('a'); return 'A'; } };
  const b: Tool = { name: 'b', description: 'b', parameters: {}, execute: async () => { calls.push('b'); return 'B'; } };
  const agent = new Agent({ provider, tools: [a, b] });
  const result = await agent.run('do both');
  assert(calls.includes('a') && calls.includes('b'), 'both tools executed');
  assert(result.text === 'both done', 'final message after parallel tools');
  const toolMessages = result.messages.filter((m) => m.role === 'tool');
  assert(toolMessages.length === 2, 'two tool result messages');
});

// ── 5: unknown tool ─────────────────────────────────────────────────────────
await test('unknown tool returns Error: unknown tool', async () => {
  const provider = mockProvider([
    toolCalls([{ id: 'c1', name: 'nope', arguments: {} }]),
    msg('recovered'),
  ]);
  const agent = new Agent({ provider, tools: [] });
  const result = await agent.run('call nope');
  const toolMsg = result.messages.find((m) => m.role === 'tool') as { content: string } | undefined;
  assert(toolMsg?.content === 'Error: unknown tool "nope"', 'unknown tool error text');
  assert(result.text === 'recovered', 'agent recovers after unknown tool');
});

// ── 6: thrown error variants ────────────────────────────────────────────────
await test('tool that throws Error returns Error: message', async () => {
  const provider = mockProvider([
    toolCalls([{ id: 'c1', name: 'bad', arguments: {} }]),
    msg('ok'),
  ]);
  const bad: Tool = { name: 'bad', description: 'bad', parameters: {}, execute: async () => { throw new Error('boom'); } };
  const agent = new Agent({ provider, tools: [bad] });
  const result = await agent.run('do bad');
  const toolMsg = result.messages.find((m) => m.role === 'tool') as { content: string } | undefined;
  assert(toolMsg?.content === 'Error: boom', 'thrown Error unwrapped');
});

await test('tool that throws non-Error coerces to string', async () => {
  const provider = mockProvider([
    toolCalls([{ id: 'c1', name: 'bad', arguments: {} }]),
    msg('ok'),
  ]);
  const bad: Tool = { name: 'bad', description: 'bad', parameters: {}, execute: async () => { throw 'oops'; } };
  const agent = new Agent({ provider, tools: [bad] });
  const result = await agent.run('do bad');
  const toolMsg = result.messages.find((m) => m.role === 'tool') as { content: string } | undefined;
  assert(toolMsg?.content === 'Error: oops', 'thrown string coerced');
});

// ── 7: MaxStepsExceededError ────────────────────────────────────────────────
await test('throws MaxStepsExceededError when not finished in maxSteps', async () => {
  const provider = mockProvider([
    toolCalls([{ id: 'c1', name: 'a', arguments: {} }]),
    toolCalls([{ id: 'c2', name: 'a', arguments: {} }]),
    toolCalls([{ id: 'c3', name: 'a', arguments: {} }]),
  ]);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => 'A' };
  const agent = new Agent({ provider, tools: [a], maxSteps: 2 });
  let caught: unknown;
  try {
    await agent.run('loop forever');
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof MaxStepsExceededError, 'throws MaxStepsExceededError');
  assert((caught as MaxStepsExceededError).steps === 2, 'error carries steps');
  assert((caught as MaxStepsExceededError).name === 'MaxStepsExceededError', 'error name correct');
  assert(Array.isArray((caught as MaxStepsExceededError).messages), 'error carries messages');
});

await test('MaxStepsExceededError message mentions steps', async () => {
  const e = new MaxStepsExceededError(5, []);
  assert(e.message.includes('5'), 'message mentions steps');
});

// ── 8: callbacks ────────────────────────────────────────────────────────────
await test('onStep called per step', async () => {
  const steps: number[] = [];
  const provider = mockProvider([toolCalls([{ id: 'c1', name: 'a', arguments: {} }]), msg('done')]);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => 'A' };
  const agent = new Agent({ provider, tools: [a], onStep: (s) => { steps.push(s); } });
  await agent.run('x');
  assert(steps.length === 2 && steps[0] === 1 && steps[1] === 2, 'onStep 1,2');
});

await test('onToolCall and onToolResult called with correct args', async () => {
  const calls: string[] = [];
  const results: Array<{ id: string; out: string }> = [];
  const provider = mockProvider([toolCalls([{ id: 'c1', name: 'a', arguments: { x: 1 } }]), msg('done')]);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => 'out' };
  const agent = new Agent({
    provider,
    tools: [a],
    onToolCall: (c) => { calls.push(c.name); },
    onToolResult: (c, out) => { results.push({ id: c.id, out }); },
  });
  await agent.run('x');
  assert(calls[0] === 'a', 'onToolCall receives call name');
  assert(results[0].out === 'out' && results[0].id === 'c1', 'onToolResult receives call and output');
});

// ── 9: defineTool passthrough ───────────────────────────────────────────────
await test('defineTool returns same object', async () => {
  const t = defineTool({ name: 'x', description: 'd', parameters: {}, execute: async () => 'hi' });
  assert(t.name === 'x' && t.description === 'd', 'defineTool identity');
});

// ── 10: default maxSteps ────────────────────────────────────────────────────
await test('defaults maxSteps to 10', async () => {
  // provider that always returns tool_calls 11 times; default should throw at 10
  const seq: CompletionResponse[] = Array.from({ length: 11 }, () => toolCalls([{ id: 'c', name: 'a', arguments: {} }]));
  const provider = mockProvider(seq);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => 'A' };
  const agent = new Agent({ provider, tools: [a] });
  let didThrow = false;
  try {
    await agent.run('x');
  } catch (e) {
    didThrow = e instanceof MaxStepsExceededError && (e as MaxStepsExceededError).steps === 10;
  }
  assert(didThrow, 'default maxSteps is 10');
});

// ── 11: tool specs passed to provider match tools array ─────────────────────
await test('provider receives tool specs derived from tools', async () => {
  let captured: unknown[] = [];
  const provider: Provider = {
    async complete(req) {
      captured = req.tools;
      return msg('ok');
    },
  };
  const t1: Tool = { name: 'filesystem.write', description: 'write file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => 'ok' };
  const t2: Tool = { name: 'command.execute', description: 'run cmd', parameters: { type: 'object' }, execute: async () => 'ok' };
  const agent = new Agent({ provider, tools: [t1, t2] });
  await agent.run('hi');
  assert(Array.isArray(captured) && captured.length === 2, 'two tool specs sent');
  assert((captured[0] as { name: string }).name === 'filesystem.write', 'spec name preserved');
  assert((captured[1] as { description: string }).description === 'run cmd', 'spec description preserved');
});

// ── 12: provider agnostic — same Agent works with any Provider shape ────────
await test('provider-agnostic: openai-like and anthropic-like providers both work', async () => {
  // Simulate two different provider impls behind same Provider interface
  const openaiLike: Provider = { async complete() { return msg('from openai'); } };
  const anthropicLike: Provider = { async complete() { return msg('from anthropic'); } };
  const a1 = new Agent({ provider: openaiLike });
  const a2 = new Agent({ provider: anthropicLike });
  const r1 = await a1.run('hi');
  const r2 = await a2.run('hi');
  assert(r1.text === 'from openai', 'openai provider works via abstraction');
  assert(r2.text === 'from anthropic', 'anthropic provider works via abstraction');
});

// ── 13: result.messages includes assistant toolCalls ────────────────────────
await test('assistant message with toolCalls preserved in history', async () => {
  const provider = mockProvider([toolCalls([{ id: 'c1', name: 'a', arguments: { v: 1 } }]), msg('done')]);
  const a: Tool = { name: 'a', description: 'a', parameters: {}, execute: async () => 'A' };
  const agent = new Agent({ provider, tools: [a] });
  const result = await agent.run('x');
  const assistantWithTools = result.messages.find((m) => m.role === 'assistant' && (m as { toolCalls?: unknown }).toolCalls) as { role: string; toolCalls?: Array<{ id: string }> } | undefined;
  assert(assistantWithTools?.toolCalls?.[0].id === 'c1', 'assistant toolCalls preserved');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) throw new Error(`${failed} tests failed`);
