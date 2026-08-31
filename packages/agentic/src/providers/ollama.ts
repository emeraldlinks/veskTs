import type { CompletionRequest, CompletionResponse, Message, Provider } from '../loop.js';

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
}

export function ollamaProvider(options: OllamaOptions = {}): Provider {
  const { model = 'llama3.1', baseUrl = 'http://localhost:11434' } = options;
  return {
    async complete({ messages, tools }: CompletionRequest): Promise<CompletionResponse> {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages.map(toOllamaMessage),
          tools: tools.length > 0 ? tools : undefined,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as OllamaResponse;
      if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
        return {
          kind: 'tool_calls',
          toolCalls: data.message.tool_calls.map((c) => ({
            id: `${c.function.name}-${Math.random().toString(36).slice(2, 6)}`,
            name: c.function.name,
            arguments: c.function.arguments as Record<string, unknown>,
          })),
        };
      }
      return { kind: 'message', content: data.message?.content ?? '' };
    },
  };
}

function toOllamaMessage(m: Message): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
  if (m.role === 'assistant' && m.toolCalls) {
    return { role: 'assistant', content: m.content ?? '', tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) };
  }
  return { role: m.role, content: m.content };
}

interface OllamaResponse {
  message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
}
