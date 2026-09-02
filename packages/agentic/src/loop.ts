/**
 * @vesk/agentic — zero-deps agent loop
 *
 * Cloned from @narimangardi/agent-loop@0.3.0 (MIT, 20.7kB, zero deps).
 * MIT-compatible: credit to Nariman Gardi. Vesk owns this copy so
 * @vesk/agentic stays dependency-free and not tied to external publish.
 *
 * The whole thing is one class: ask LLM, run tools, feed results back,
 * repeat until answer or maxSteps. Bring your own Provider (fetch-only).
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface Tool<A extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: A): string | Promise<string>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: Message[];
  tools: ToolSpec[];
}

export type CompletionResponse =
  | { kind: 'message'; content: string }
  | { kind: 'tool_calls'; toolCalls: ToolCall[] };

/** Provider-level streaming event (one per `completeStream` invocation). */
export type StreamEvent =
  | { kind: 'delta'; content: string }
  | { kind: 'message'; content: string }
  | { kind: 'tool_calls'; toolCalls: ToolCall[] };

export interface Provider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  completeStream?(request: CompletionRequest): AsyncIterable<StreamEvent>;
  listModels?(options: { apiKey?: string; baseUrl?: string }): Promise<string[]>;
}

export interface AgentOptions {
  provider: Provider;
  tools?: Tool[];
  system?: string;
  /** Soft step budget. The agent finishes as soon as the model returns a plain
      message; once `step` passes this budget without a final message it either
      throws `MaxStepsExceededError` (when `autoExtend` is false) or keeps going
      (when `autoExtend` is true). Default 10. */
  maxSteps?: number;
  /** When true, tool-calling steps beyond `maxSteps` are allowed to continue up
      to `hardMaxSteps` instead of stopping, so multi-step tasks aren't cut off
      prematurely while progress is being made. Default false. */
  autoExtend?: boolean;
  /** Absolute step ceiling used when `autoExtend` is true. Defaults to
      `max(maxSteps * 4, maxSteps + 20)`. */
  hardMaxSteps?: number;
  onStep?: (step: number) => void | Promise<void>;
  onToolCall?: (call: ToolCall) => void | Promise<void>;
  onToolResult?: (call: ToolCall, output: string) => void | Promise<void>;
}

/** Agent-level streaming event (`runStream`). */
export type AgentStreamEvent =
  | { type: 'user'; content: string }
  | { type: 'step'; step: number; budget: number }
  | { type: 'assistant_start'; step: number }
  | { type: 'text_delta'; content: string }
  | { type: 'assistant_end'; step: number; content: string }
  | { type: 'tool_call'; step: number; call: ToolCall }
  | { type: 'tool_result'; step: number; call: ToolCall; output: string }
  | { type: 'done'; result: AgentResult }
  | { type: 'error'; message: string };

export interface AgentResult {
  text: string;
  steps: number;
  messages: Message[];
}

export class MaxStepsExceededError extends Error {
  readonly steps: number;
  readonly messages: Message[];
  constructor(steps: number, messages: Message[]) {
    super(`Agent did not finish within ${steps} steps`);
    this.steps = steps;
    this.messages = messages;
    this.name = 'MaxStepsExceededError';
  }
}

export function defineTool<A extends Record<string, unknown> = Record<string, unknown>>(tool: Tool<A>): Tool<A> {
  return tool;
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent
// ──────────────────────────────────────────────────────────────────────────────

export class Agent {
  private readonly provider: Provider;
  private readonly tools: Map<string, Tool>;
  private readonly toolSpecs: ToolSpec[];
  private readonly system?: string;
  private readonly maxSteps: number;
  private readonly stepBudget: number;
  private readonly onStep?: (step: number) => void | Promise<void>;
  private readonly onToolCall?: (call: ToolCall) => void | Promise<void>;
  private readonly onToolResult?: (call: ToolCall, output: string) => void | Promise<void>;

  constructor(options: AgentOptions) {
    const tools = options.tools ?? [];
    this.provider = options.provider;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.toolSpecs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    this.system = options.system;
    const softMax = Math.max(1, Math.floor(options.maxSteps ?? 10));
    this.maxSteps = softMax;
    if (options.autoExtend) {
      const hard = options.hardMaxSteps === undefined ? Math.max(softMax * 4, softMax + 20) : Math.max(softMax, Math.floor(options.hardMaxSteps));
      this.stepBudget = Math.min(hard, 10000);
    } else {
      this.stepBudget = softMax;
    }
    this.onStep = options.onStep;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
  }

  async run(prompt: string): Promise<AgentResult> {
    const messages: Message[] = [];
    if (this.system !== undefined) messages.push({ role: 'system', content: this.system });
    messages.push({ role: 'user', content: prompt });

    for (let step = 1; step <= this.stepBudget; step++) {
      await this.onStep?.(step);
      const response = await this.provider.complete({ messages, tools: this.toolSpecs });
      if (response.kind === 'message') {
        messages.push({ role: 'assistant', content: response.content });
        return { text: response.content, steps: step, messages };
      }
      messages.push({ role: 'assistant', content: null, toolCalls: response.toolCalls });
      const results = await Promise.all(
        response.toolCalls.map(async (call) => {
          await this.onToolCall?.(call);
          return { call, output: await this.runTool(call) };
        }),
      );
      for (const { call, output } of results) {
        await this.onToolResult?.(call, output);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
      }
    }
    throw new MaxStepsExceededError(this.stepBudget, messages);
  }

  /** Stream the agent run. Mirrors `run()` but yields progress events, including
      text deltas as the model generates them (via `provider.completeStream` when
      available; otherwise the final message is emitted as a single delta). */
  async *runStream(prompt: string): AsyncGenerator<AgentStreamEvent> {
    const messages: Message[] = [];
    if (this.system !== undefined) messages.push({ role: 'system', content: this.system });
    messages.push({ role: 'user', content: prompt });
    yield { type: 'user', content: prompt };

    for (let step = 1; step <= this.stepBudget; step++) {
      yield { type: 'step', step, budget: this.stepBudget };
      await this.onStep?.(step);

      if (this.provider.completeStream) {
        yield { type: 'assistant_start', step };
        let content = '';
        let term: StreamEvent = { kind: 'message', content: '' };
        try {
          for await (const ev of this.provider.completeStream({ messages, tools: this.toolSpecs })) {
            if (ev.kind === 'delta') {
              content += ev.content;
              yield { type: 'text_delta', content: ev.content };
            } else {
              term = ev;
            }
          }
        } catch (e) {
          yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
          return;
        }
        if (term.kind === 'message') {
          messages.push({ role: 'assistant', content });
          yield { type: 'assistant_end', step, content };
          yield { type: 'done', result: { text: content, steps: step, messages } };
          return;
        }
        const toolCalls = term.toolCalls ?? [];
        if (toolCalls.length === 0) {
          messages.push({ role: 'assistant', content });
          yield { type: 'assistant_end', step, content };
          yield { type: 'done', result: { text: content, steps: step, messages } };
          return;
        }
        messages.push({ role: 'assistant', content: null, toolCalls });
        const results = await Promise.all(
          toolCalls.map(async (call) => {
            await this.onToolCall?.(call);
            return { call, output: await this.runTool(call) };
          }),
        );
        for (const { call, output } of results) {
          await this.onToolResult?.(call, output);
          yield { type: 'tool_call', step, call };
          yield { type: 'tool_result', step, call, output };
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
        }
        continue;
      }

      let response: CompletionResponse;
      try {
        response = await this.provider.complete({ messages, tools: this.toolSpecs });
      } catch (e) {
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
        return;
      }
      if (response.kind === 'message') {
        yield { type: 'assistant_start', step };
        yield { type: 'text_delta', content: response.content };
        messages.push({ role: 'assistant', content: response.content });
        yield { type: 'assistant_end', step, content: response.content };
        yield { type: 'done', result: { text: response.content, steps: step, messages } };
        return;
      }
      messages.push({ role: 'assistant', content: null, toolCalls: response.toolCalls });
      const results = await Promise.all(
        response.toolCalls.map(async (call) => {
          await this.onToolCall?.(call);
          return { call, output: await this.runTool(call) };
        }),
      );
      for (const { call, output } of results) {
        await this.onToolResult?.(call, output);
        yield { type: 'tool_call', step, call };
        yield { type: 'tool_result', step, call, output };
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
      }
    }
    yield { type: 'error', message: `Agent did not finish within ${this.stepBudget} steps` };
  }

  private async runTool(call: ToolCall): Promise<string> {
    const tool = this.tools.get(call.name);
    if (tool === undefined) return `Error: unknown tool "${call.name}"`;
    try {
      return await tool.execute(call.arguments);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
