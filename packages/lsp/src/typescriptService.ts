/**
 * TypeScript service patch — injects vesk defaults into the TS language
 * service user preferences (auto-import style, etc.), mirroring Ripple's
 * approach.
 *
 * The patch replaces the `getUserPreferences` export of the shared
 * `volar-service-typescript/lib/configs/getUserPreferences` module, which
 * `volar-service-typescript`'s own plugins import. The bundler MUST keep
 * `volar-service-typescript` external so every consumer hits the same module
 * cache entry (`scripts/build-lsp.js`).
 */

import { createRequire } from 'node:module';
import type { LanguageServicePlugin } from '@volar/language-service';
import { createLogging } from './utils';

const { log } = createLogging('[Vesk TS Service]');

const require = createRequire(import.meta.url);

/**
 * Create TypeScript services with vesk-specific enhancements.
 * @param {typeof import('typescript')} ts
 */
export function createTypeScriptServices(ts: typeof import('typescript')): LanguageServicePlugin[] {
  const { create } = require('volar-service-typescript') as {
    create: (ts: typeof import('typescript')) => LanguageServicePlugin[];
  };
  return create(ts);
}

/**
 * Patch `getUserPreferences` so all TS service features see vesk's defaults.
 * Call once before the language server starts serving requests.
 */
export function patchUserPreferences(): void {
  try {
    const getUserPreferencesModule = require('volar-service-typescript/lib/configs/getUserPreferences') as {
      getUserPreferences: (ctx: unknown, document: unknown) => Promise<Record<string, unknown>>;
    };
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