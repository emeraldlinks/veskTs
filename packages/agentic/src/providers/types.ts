/**
 * Provider types and config — fetch-only, zero deps.
 */
import type { Provider } from '../loop.js';

export type ProviderName = 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama';

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
}

export const SUPPORTED_PROVIDERS: ProviderName[] = ['openai', 'openai-compatible', 'anthropic', 'google', 'ollama'];

export function describeProvider(name: ProviderName): string {
  switch (name) {
    case 'openai': return 'OpenAI (api.openai.com)';
    case 'openai-compatible': return 'OpenAI-compatible (Groq/Together/OpenRouter/custom)';
    case 'anthropic': return 'Anthropic Claude (api.anthropic.com)';
    case 'google': return 'Google Gemini (generativelanguage.googleapis.com)';
    case 'ollama': return 'Ollama (localhost:11434, no key)';
    default: return String(name);
  }
}

export type ProviderFactory = (config: ProviderConfig) => Provider;
