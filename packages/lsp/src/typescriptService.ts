/**
 * TypeScript service factory + user-preferences patch.
 *
 * Both imports are STATIC: the bundler inlines `volar-service-typescript`
 * into the LSP server bundle (`scripts/build-lsp.js` uses `external: []`),
 * which is what makes the monkey-patch below safe — every consumer inside
 * the bundle resolves to the same single copy of
 * `lib/configs/getUserPreferences`, and its plugins call through the
 * module's `exports` object (`getUserPreferences_1.getUserPreferences(…)`),
 * so replacing that property is observed by all of them.
 *
 * (Historical note: this file once used `createRequire` + runtime
 * `require('volar-service-typescript')` because the old build kept the
 * package external. Shipping externals in the vsix is what broke the
 * original extension — see bcf654d.)
 */

import { create } from 'volar-service-typescript';
import type { LanguageServicePlugin } from '@volar/language-service';
import type * as Ts from 'typescript';
import getUserPreferencesModule from 'volar-service-typescript/lib/configs/getUserPreferences';
import { createLogging } from './utils';

const { log } = createLogging('[Vesk TS Service]');

/**
 * Create TypeScript services with vesk-specific enhancements.
 * @param ts The TypeScript module shared with the language server.
 */
export function createTypeScriptServices(ts: typeof Ts): LanguageServicePlugin[] {
  return create(ts);
}

/**
 * Patch `getUserPreferences` so all TS service features see vesk's defaults.
 * Call once before the language server starts serving requests.
 */
export function patchUserPreferences(): void {
  try {
    const originalGetUserPreferences = getUserPreferencesModule.getUserPreferences;

    getUserPreferencesModule.getUserPreferences = async function (ctx, document) {
      const origPreferences = await originalGetUserPreferences.call(this, ctx, document);
      return {
        preferTypeOnlyAutoImports: true,
        ...origPreferences,
      };
    };
    log('Patched getUserPreferences');
  } catch (err) {
    log('Failed to patch getUserPreferences:', err);
  }
}
