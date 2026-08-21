/** @module text-utils — Cursor position helpers, JSDoc extraction, and import text edits. */

import { Position, Range, TextEdit } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ProjectIndex } from './types';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { project } from './context';

/** Return the word range (identifier) surrounding the given position, or undefined if none. */
export function getWordRangeAtPosition(document: TextDocument, position: Position): Range | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  if (offset < 0 || offset >= text.length) return undefined;
  let start = offset;
  let end = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  if (start === end) return undefined;
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

/** Return the word string at the given cursor position, or empty string if none. */
export function getWordAtPosition(document: TextDocument, position: Position): string {
  const range = getWordRangeAtPosition(document, position);
  if (!range) return '';
  return document.getText(range);
}

/** Return true if the cursor is inside a `class` or `className` attribute value string. */
export function isInClassAttribute(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 200), offset);
  const classMatch = before.match(/(?:class|className)\s*=\s*["'`][^"'`]*$/);
  return classMatch !== null;
}

/** Return true if the cursor is inside any attribute value string (quoted). */
export function isInAttributeValue(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 300), offset);
  const attrMatch = before.match(/(\w+)\s*=\s*["'`][^"'`]*$/);
  return attrMatch !== null;
}

/** Extract the nearest enclosing opening tag name before the cursor, or null. */
export function getOpeningTagName(document: TextDocument, position: Position): string | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 200), offset);
  const match = before.match(/<([A-Za-z_$@]\w*(?:[.-]\w+)*)([\s>][^>]*)?$/);
  if (!match) return null;
  return match[1];
}

/** Extract the JSDoc or `//` comment block preceding a given source line number. */
export function getJSDoc(source: string, line: number): string {
  const lines = source.split('\n');
  const commentLines: string[] = [];
  let i = line - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('*')) {
      commentLines.unshift(trimmed.replace(/^\s*\*\s?/, ''));
    } else if (trimmed.startsWith('/**')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\*\*\s?/, ''));
      break;
    } else if (trimmed.startsWith('//')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\/\s?/, ''));
    } else if (trimmed === '' || trimmed.startsWith('import') || trimmed.startsWith('export')) {
      break;
    } else {
      break;
    }
    i--;
  }
  return commentLines.join('\n').replace(/\*\//g, '').trim();
}

/** Find a symbol in a file by name and return its JSDoc comment, or null. */
export function getJSDocForFile(filePath: string, symbolName: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const source = readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(`(?:component|function|const|let|var|class|interface|type)\\s+${symbolName}\\b`);
      if (re.test(lines[i])) {
        return getJSDoc(source, i) || null;
      }
    }
  } catch {}
  return null;
}

/** Create a TextEdit that inserts an import statement at the top of the document (no-op if already imported). */
export function makeImportEdit(document: TextDocument, names: string[], fromPath: string, isDefault: boolean = false): TextEdit | null {
  const source = document.getText();
  for (const name of names) {
    const importRe = new RegExp(`import\\s+[\\s\\S]*?\\b${name}\\b[\\s\\S]*?from\\s+['"]`);
    if (importRe.test(source)) return null;
  }
  const relPath = relative(dirname(document.uri.replace(/^file:\/\//, '')), fromPath);
  const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
  const specifier = isDefault ? names[0] : `{ ${names.join(', ')} }`;
  const formatted = `import ${specifier} from '${importPath.replace(/\.(vsk|ts|tsx|js|jsx)$/, '')}';\n`;
  return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: formatted };
}
