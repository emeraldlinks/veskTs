import type { CompletionRequest, CompletionResponse, Message, Provider } from '../loop.js';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

export function anthropicProvider(options: AnthropicOptions): Provider {
  const { apiKey, model = 'claude-sonnet-4-6', maxTokens = 1024, baseUrl = 'https://api.anthropic.com/v1' } = options;
  return {
    async complete({ messages, tools }: CompletionRequest): Promise<CompletionResponse> {
      const { system, messages: anthropicMessages } = toAnthropic(messages);
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: anthropicMessages,
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        }),
      });
      if (!res.ok) throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as AnthropicResponse;
      const toolUses = data.content.filter((b) => b.type === 'tool_use');
      if (toolUses.length > 0) {
        return {
          kind: 'tool_calls',
          toolCalls: toolUses.map((b) => ({ id: b.id, name: b.name, arguments: b.input })),
        };
      }
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { kind: 'message', content: text };
    },
  };
}

function toAnthropic(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') { system = m.content; continue; }
    if (m.role === 'user') { out.push({ role: 'user', content: m.content }); continue; }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const blocks: AnthropicBlock[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content ?? '' });
      }
      continue;
    }
    const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
    const last = out[out.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      (last.content as AnthropicBlock[]).push(block);
    } else {
      out.push({ role: 'user', content: [block] });
    }
  }
  return { system, messages: out };
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage { role: 'user' | 'assistant'; content: string | AnthropicBlock[]; }
interface AnthropicResponse { content: AnthropicBlock[]; }
