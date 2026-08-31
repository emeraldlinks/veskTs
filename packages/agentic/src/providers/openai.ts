import type { CompletionRequest, CompletionResponse, Message, Provider } from '../loop.js';

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export function openAiProvider(options: OpenAiOptions): Provider {
  const { apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1' } = options;
  return {
    async complete({ messages, tools }: CompletionRequest): Promise<CompletionResponse> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(toOpenAiMessage),
          tools: tools.length > 0 ? tools.map((t) => ({ type: 'function', function: t })) : undefined,
        }),
      });
      if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as ChatCompletion;
      const msg = data.choices[0]?.message;
      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        return {
          kind: 'tool_calls',
          toolCalls: msg.tool_calls.map((c) => ({
            id: c.id,
            name: c.function.name,
            arguments: JSON.parse(c.function.arguments) as Record<string, unknown>,
          })),
        };
      }
      return { kind: 'message', content: msg?.content ?? '' };
    },
  };
}

function toOpenAiMessage(m: Message): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.arguments) },
              })),
            }
          : {}),
      };
    default:
      return { role: m.role, content: m.content };
  }
}

interface ChatCompletion {
  choices: Array<{
    message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  }>;
}
