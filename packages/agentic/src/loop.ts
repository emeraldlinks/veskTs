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

export interface Provider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  listModels?(options: { apiKey?: string; baseUrl?: string }): Promise<string[]>;
}

export interface AgentOptions {
  provider: Provider;
  tools?: Tool[];
  system?: string;
  maxSteps?: number; // default 10
  onStep?: (step: number) => void | Promise<void>;
  onToolCall?: (call: ToolCall) => void | Promise<void>;
  onToolResult?: (call: ToolCall, output: string) => void | Promise<void>;
}

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
  private readonly onStep?: (step: number) => void | Promise<void>;
  private readonly onToolCall?: (call: ToolCall) => void | Promise<void>;
  private readonly onToolResult?: (call: ToolCall, output: string) => void | Promise<void>;

  constructor(options: AgentOptions) {
    const tools = options.tools ?? [];
    this.provider = options.provider;
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.toolSpecs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    this.system = options.system;
    this.maxSteps = options.maxSteps ?? 10;
    this.onStep = options.onStep;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
  }

  async run(prompt: string): Promise<AgentResult> {
    const messages: Message[] = [];
    if (this.system !== undefined) messages.push({ role: 'system', content: this.system });
    messages.push({ role: 'user', content: prompt });

    for (let step = 1; step <= this.maxSteps; step++) {
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
    throw new MaxStepsExceededError(this.maxSteps, messages);
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
