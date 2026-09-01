import type { CompletionRequest, CompletionResponse, Message, Provider } from '../loop.js';

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const OPENAI_FALLBACK_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'] as const;

export async function listModels(options: { apiKey?: string; baseUrl?: string } = {}): Promise<string[]> {
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${options.apiKey ?? ''}` },
    });
    if (!res.ok) return [...OPENAI_FALLBACK_MODELS];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    if (Array.isArray(data.data) && data.data.length > 0) {
      const ids = data.data.map((m) => m.id).filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (ids.length > 0) return ids;
    }
    return [...OPENAI_FALLBACK_MODELS];
  } catch {
    return [...OPENAI_FALLBACK_MODELS];
  }
}

function sanitizeToolName(name: string): string {
  return name.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function openAiProvider(options: OpenAiOptions): Provider {
  const { apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1' } = options;
  return {
    listModels: (opts: { apiKey?: string; baseUrl?: string } = {}) => listModels({ apiKey: opts.apiKey ?? apiKey, baseUrl: opts.baseUrl ?? baseUrl }),
    async complete({ messages, tools }: CompletionRequest): Promise<CompletionResponse> {
      // Sanitize tool names for OpenAI (only alphanum _ - allowed)
      const nameMap = new Map<string, string>();
      const sanitizedTools = tools.map((t) => {
        const sane = sanitizeToolName(t.name);
        nameMap.set(sane, t.name);
        return { name: sane, description: t.description, parameters: t.parameters };
      });
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(toOpenAiMessage),
          tools: sanitizedTools.length > 0 ? sanitizedTools.map((t) => ({ type: 'function', function: t })) : undefined,
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
            name: nameMap.get(c.function.name) || c.function.name,
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
