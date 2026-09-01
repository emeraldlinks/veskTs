/**
 * Provider types and config — fetch-only, zero deps.
 */
import type { CompletionRequest, CompletionResponse } from '../loop.js';
import type { Provider as BaseProvider } from '../loop.js';

export interface ListModelsOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface Provider extends BaseProvider {
  listModels?(options: ListModelsOptions): Promise<string[]>;
}

export interface ProviderWithModels extends Provider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  listModels?(options: ListModelsOptions): Promise<string[]>;
}

export type ProviderName = 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama' | 'opencode' | 'opencode-go' | 'openrouter' | 'loopers' | 'custom';

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
}

export const SUPPORTED_PROVIDERS: ProviderName[] = ['openai', 'openai-compatible', 'anthropic', 'google', 'ollama', 'opencode', 'opencode-go', 'openrouter', 'loopers', 'custom'];

export function describeProvider(name: ProviderName): string {
  switch (name) {
    case 'openai': return 'OpenAI (api.openai.com)';
    case 'openai-compatible': return 'OpenAI-compatible (Groq/Together/custom)';
    case 'anthropic': return 'Anthropic Claude (api.anthropic.com)';
    case 'google': return 'Google Gemini (generativelanguage.googleapis.com)';
    case 'ollama': return 'Ollama (localhost:11434, no key)';
    case 'opencode': return 'OpenCode Zen (opencode.ai/zen/v1)';
    case 'opencode-go': return 'OpenCode Go (opencode.ai/zen/go/v1)';
    case 'openrouter': return 'OpenRouter (openrouter.ai/api/v1)';
    case 'loopers': return 'Loopers (localhost:8080, lp-xxx)';
    case 'custom': return 'Custom (any OpenAI-compatible baseUrl)';
    default: return String(name);
  }
}

export type ProviderFactory = (config: ProviderConfig) => Provider;
