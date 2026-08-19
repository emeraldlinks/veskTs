/**
 * Diagnostics filter plugin — wraps typescript-semantic's `provideDiagnostics`
 * to suppress TS diagnostics while the file has a vesk compile error (the
 * virtual code is then raw source and TS noise). Must load after the
 * TypeScript services.
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import { getVirtualCode, createLogging } from '../utils';
import { VeskVirtualCode } from '../language-plugin';

const { log, logError } = createLogging('[Vesk Diagnostics Filter Plugin]');

export function createTypeScriptDiagnosticFilterPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-typescript-diagnostics-filter',
    capabilities: {},
    create(context) {
      let originalProvider: LanguageServicePluginInstance['provideDiagnostics'] | undefined;
      let originalInstance: LanguageServicePluginInstance | undefined;

      for (const [plugin, instance] of context.plugins) {
        if (plugin.name === 'typescript-semantic') {
          originalInstance = instance;
          originalProvider = instance.provideDiagnostics;
          instance.provideDiagnostics = async function (document, token) {
            const diagnostics = await originalProvider?.call(originalInstance, document, token);
            if (!document.uri.endsWith('.vsk')) {
              return diagnostics;
            }
            const { virtualCode } = getVirtualCode(document, context);
            if (!(virtualCode instanceof VeskVirtualCode) || virtualCode.fatalErrors.length === 0) {
              return diagnostics;
            }
            log(`Suppressing TS diagnostics for ${document.uri} (${virtualCode.fatalErrors.length} compile errors)`);
            return [];
          };
          break;
        }
      }

      if (!originalProvider) {
        logError(
          "'typescript-semantic plugin' was not found or has no 'provideDiagnostics'. " +
            'This plugin must be loaded after TypeScript services.',
        );
      }

      return {};
    },
  };
}