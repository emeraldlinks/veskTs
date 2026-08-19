/**
 * Document formatting — vesk files are formatted with prettier's vesk parser.
 * Registered on the connection after `initialize` so Volar's per-feature
 * handlers don't override ours (last registration wins).
 */

import prettier from 'prettier';
import * as veskPlugin from '@vesk/prettier-plugin';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export const prettierOptions = {
  parser: 'vesk',
  plugins: [veskPlugin],
  semi: false,
  singleQuote: false,
  trailingComma: 'es5' as const,
  tabWidth: 2,
  printWidth: 100,
};

export async function formatVeskDocument(document: TextDocument): Promise<string | null> {
  const source = document.getText();
  try {
    const formatted = await prettier.format(source, {
      ...prettierOptions,
      filepath: document.uri.replace(/^file:\/\//, ''),
    });
    return formatted === source ? null : formatted;
  } catch (err) {
    console.error('[Vesk Format] prettier failed:', err);
    return null;
  }
}