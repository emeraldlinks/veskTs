import type { CompletionRequest, CompletionResponse, Message, Provider, ToolCall } from '../loop.js';

export interface GoogleOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export function googleProvider(options: GoogleOptions): Provider {
  const { apiKey, model = 'gemini-2.0-flash', baseUrl = 'https://generativelanguage.googleapis.com' } = options;
  return {
    async complete({ messages, tools }: CompletionRequest): Promise<CompletionResponse> {
      const { systemInstruction, contents } = toGoogle(messages);
      const body: Record<string, unknown> = { contents, systemInstruction };
      if (tools.length > 0) {
        body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
      }
      const res = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google request failed: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as GoogleResponse;
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const calls: ToolCall[] = [];
      let text = '';
      for (const p of parts) {
        if (p.functionCall) calls.push({ id: `${p.functionCall.name}-${calls.length}`, name: p.functionCall.name, arguments: (p.functionCall.args as Record<string, unknown>) ?? {} });
        if (p.text) text += p.text;
      }
      if (calls.length > 0) return { kind: 'tool_calls', toolCalls: calls };
      return { kind: 'message', content: text };
    },
  };
}

function toGoogle(messages: Message[]): { systemInstruction?: unknown; contents: unknown[] } {
  let systemInstruction: unknown | undefined;
  const contents: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') { systemInstruction = { parts: [{ text: m.content }] }; continue; }
    if (m.role === 'user') { contents.push({ role: 'user', parts: [{ text: m.content }] }); continue; }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.arguments } });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'model', parts: [{ text: m.content ?? '' }] });
      }
      continue;
    }
    // tool -> user with functionResponse
    contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name, response: { content: m.content } } }] });
  }
  return { systemInstruction, contents };
}

interface GoogleResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: unknown } }> } }>;
}
