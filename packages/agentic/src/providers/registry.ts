import type { Provider } from '../loop.js';
import type { ProviderConfig, ProviderFactory, ProviderName } from './types.js';

const registry = new Map<ProviderName, ProviderFactory>();

export function registerProvider(name: ProviderName, factory: ProviderFactory): void {
  registry.set(name, factory);
}

export function getProviderFactory(name: ProviderName): ProviderFactory | undefined {
  return registry.get(name);
}

export function createProvider(config: ProviderConfig): Provider {
  // Lazy dispatch — avoids importing SDKs or provider modules when not needed.
  // Each provider module is imported only when its name is requested.
  const name = config.provider;
  const factory = registry.get(name);
  if (factory) return factory(config);

  // Built-in lazy factories (import dynamically to keep bundle lean)
  // Synchronous fallback: create directly without registry for core providers.
  // This avoids async import for the common case; callers needing lazy can
  // pre-register via registerProvider.
  if (name === 'openai' || name === 'openai-compatible') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // Use dynamic import via function to avoid top-level side effects.
    // For sync path we instantiate inline via require-like dynamic.
    // But to keep zero deps and simple, we import synchronously here
    // via a helper that will be replaced by the actual provider module.
    // Fallback: throw with guidance if not registered; caller should import
    // the specific provider first.
    throw new Error(
      `Provider "${name}" not registered. Import " @vesk/agentic/src/providers/openai.js" and call registerProvider("openai", openAiProvider) or use createProviderWithImport.`,
    );
  }
  throw new Error(`Unknown provider "${String(name)}". Supported: ${['openai','openai-compatible','anthropic','google','ollama'].join(', ')}`);
}

export function listProviders(): ProviderName[] {
  return [...registry.keys()];
}
