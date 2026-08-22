/**
 * Compile-error diagnostic plugin — surfaces vesk compile errors (fatal mode)
 * as LSP diagnostics mapped back to source positions.
 */

import type { LanguageServicePlugin } from '@volar/language-service';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import { getVirtualCode, createLogging } from '../utils';
import { VeskVirtualCode } from '../language-plugin';

const { log } = createLogging('[Vesk Compile Error Plugin]');

export function createCompileErrorDiagnosticPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-compile-errors',
    capabilities: {
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
    create(context) {
      return {
        async provideDiagnostics(document, _token) {
          if (!document.uri.endsWith('.vsk')) {
            return undefined;
          }

          const { virtualCode } = getVirtualCode(document, context);
          if (!(virtualCode instanceof VeskVirtualCode)) {
            return undefined;
          }

          if (virtualCode.fatalErrors.length === 0) {
            return undefined;
          }

          // Compile errors are reported in source offsets; map them straight to
          // source positions (no generated-range round-trip needed).
          const diagnostics: any[] = [];
          for (const error of virtualCode.fatalErrors) {
            const start = Math.max(0, error.start);
            const end = Math.min(document.getText().length, error.end);
            log(`Compile error at ${start}:${end}: ${error.message}`);
            diagnostics.push({
              range: {
                start: document.positionAt(start),
                end: document.positionAt(end),
              },
              severity: DiagnosticSeverity.Error,
              source: 'vesk',
              code: 'vesk-parse-error',
              message: error.message,
            });
          }
          return diagnostics;
        },
      };
    },
  };
}
