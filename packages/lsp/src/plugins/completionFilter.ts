/**
 * Filter server-only globals from TypeScript completion results.
 *
 * Vesk projects may include Node types for API routes and config files, but
 * `.vsk` component expressions run in the browser. TypeScript therefore can
 * legitimately know `process`, `Buffer`, and `require`; exposing those names
 * in component/tag completion is misleading and makes fatal-state fallback
 * completions especially noisy.
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';

const SERVER_ONLY_GLOBALS = new Set(['process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename']);

function filterCompletionResult(result: unknown): unknown {
  if (Array.isArray(result)) {
    return result.filter((item) => !isServerOnlyCompletion(item));
  }
  if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown[] }).items)) {
    return {
      ...(result as { items: unknown[] }),
      items: (result as { items: unknown[] }).items.filter((item) => !isServerOnlyCompletion(item)),
    };
  }
  return result;
}

function isServerOnlyCompletion(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const label = (item as { label?: unknown }).label;
  return typeof label === 'string' && SERVER_ONLY_GLOBALS.has(label);
}

export function createCompletionFilterPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-completion-filter',
    capabilities: {},
    create(context) {
      let originalProvider: LanguageServicePluginInstance['provideCompletionItems'] | undefined;
      let originalInstance: LanguageServicePluginInstance | undefined;

      for (const [plugin, instance] of context.plugins) {
        if (plugin.name === 'typescript-semantic') {
          originalInstance = instance;
          originalProvider = instance.provideCompletionItems;
          instance.provideCompletionItems = async function (...args: Parameters<NonNullable<typeof originalProvider>>) {
            const result = await originalProvider?.apply(originalInstance, args);
            return filterCompletionResult(result) as Awaited<ReturnType<NonNullable<typeof originalProvider>>>;
          };
          break;
        }
      }

      return {};
    },
  };
}
