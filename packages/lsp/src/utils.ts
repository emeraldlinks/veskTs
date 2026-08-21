/**
 * Shared helpers for the vesk Volar language-server plugins.
 */

import { URI } from 'vscode-uri';
import type {
  LanguageServiceContext,
  Mapper,
  SourceScript,
} from '@volar/language-service';
import type { VirtualCode } from '@volar/language-core';

/** Master switch for verbose server-side logging. */
export const DEBUG = process.env.VESK_LSP_DEBUG === '1';

export function createLogging(label: string) {
  const prefix = label;
  const stamp = () => `[${new Date().toISOString().slice(11, 23)}]`;
  const log = (...args: unknown[]) => {
    // stderr only: stdout carries the LSP protocol.
    if (DEBUG) console.error(stamp(), prefix, ...args);
  };
  const logWarning = (...args: unknown[]) => {
    if (DEBUG) console.error(stamp(), prefix, ...args);
  };
  const logError = (...args: unknown[]) => {
    console.error(stamp(), prefix, ...args);
  };
  return { log, logWarning, logError };
}

export const VESK_EXTENSIONS = ['.vsk'];

export function isVeskDocument(documentUri: string): boolean {
  return VESK_EXTENSIONS.some((extension) => documentUri.endsWith(extension));
}

/**
 * Get the root virtual code of the source script behind a (possibly embedded)
 * document URI, plus the mapper back to the source.
 *
 * For regular (non-embedded) `.vsk` documents the "virtual code" is the root
 * code produced by the language plugin (`sourceScript.generated.root`).
 * For embedded documents it is the specific embedded code identified by
 * `virtualCodeId`.
 */
export function getVirtualCode(
  document: { uri: string },
  context: LanguageServiceContext,
): {
  virtualCode: VirtualCode | undefined;
  sourceUri: URI;
  sourceScript: SourceScript<URI> | undefined;
  sourceMap: Mapper | undefined;
} {
  const uri = URI.parse(document.uri);
  const decoded = context.decodeEmbeddedDocumentUri(uri);
  const sourceUri = decoded?.[0] ?? uri;
  const virtualCodeId = decoded?.[1];
  const sourceScript = context.language.scripts.get(sourceUri);
  if (!sourceScript?.generated) {
    return { virtualCode: undefined, sourceUri, sourceScript, sourceMap: undefined };
  }
  const virtualCode = virtualCodeId
    ? sourceScript.generated.embeddedCodes.get(virtualCodeId)
    : sourceScript.generated.root;
  const sourceMap =
    virtualCode ? context.language.maps.get(virtualCode, sourceScript) : undefined;
  return { virtualCode, sourceUri, sourceScript, sourceMap };
}

const IMPORT_EXPORT_REGEX = {
  import: {
    findBefore: /import\s+(?:\{[^}]*|\*\s+as\s+\w*|\w*)$/s,
    sameLine: /^import\s/,
  },
  export: {
    findBefore: /export\s+(?:\{[^}]*|\*\s+as\s+\w*|\w*)$/s,
    sameLine: /^export\s/,
  },
  from: /from\s*['"][^'"]*['"]\s*;?/,
};

function isInsideImportOrExport(
  type: 'import' | 'export',
  text: string,
  start: number,
): boolean {
  const textBeforeCursor = text.slice(0, start);

  const lastMatch = textBeforeCursor.match(IMPORT_EXPORT_REGEX[type].findBefore);
  if (!lastMatch) {
    const lineStart = textBeforeCursor.lastIndexOf('\n') + 1;
    const lineBeforeCursor = textBeforeCursor.slice(lineStart);
    return IMPORT_EXPORT_REGEX[type].sameLine.test(lineBeforeCursor.trim());
  }

  const importStart = textBeforeCursor.lastIndexOf(type);
  const textFromImport = text.slice(importStart);

  const fromMatch = textFromImport.match(IMPORT_EXPORT_REGEX.from);
  if (!fromMatch || fromMatch.index === undefined) {
    return true;
  }

  const importEndOffset = importStart + fromMatch.index + fromMatch[0].length;
  return start < importEndOffset;
}

export function isInsideImport(text: string, start: number): boolean {
  return isInsideImportOrExport('import', text, start);
}

export function isInsideExport(text: string, start: number): boolean {
  return isInsideImportOrExport('export', text, start);
}

const charAllowedWordRegex = /[\w\-$#]/;

/**
 * Find the word around a character offset in a text.
 */
export function getWordFromPosition(
  text: string,
  start: number,
): { word: string; start: number; end: number } {
  let s = start;
  while (s > 0 && charAllowedWordRegex.test(text[s - 1])) s--;
  let e = start;
  while (e < text.length && charAllowedWordRegex.test(text[e])) e++;
  return { word: text.slice(s, e), start: s, end: e };
}

export function concatMarkdownContents(...contents: string[]): string {
  return contents.join('\n\n<br>\n\n---\n\n<br><br>\n\n');
}
