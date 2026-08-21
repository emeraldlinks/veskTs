import { format as prettierFormat, type Options as PrettierOptions } from 'prettier';
import veskPlugin from '@vesk/prettier-plugin';
import { TextEdit } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export const prettierOptions: PrettierOptions = {
  parser: 'vesk',
  plugins: [veskPlugin as never],
  semi: false,
  singleQuote: false,
  trailingComma: 'es5',
  tabWidth: 2,
  printWidth: 100,
};

export function fullDocumentEdit(document: TextDocument, formatted: string): TextEdit {
  return TextEdit.replace(
    { start: document.positionAt(0), end: document.positionAt(document.getText().length) },
    formatted,
  );
}

export function formatVesk(source: string, indentSize: number = 2): string {
  const lines = source.split('\n');
  const result: string[] = [];
  let indent = 0;
  const indentStr = ' '.repeat(indentSize);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { result.push(''); continue; }

    const isStartBlock = /component\s+\w+|try\s*\{|catch\s*\(|else\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(/.test(trimmed) && /\{$/.test(trimmed);
    const isEndBlock = /^\}/.test(trimmed);
    const isStartEnd = isStartBlock && isEndBlock;

    if (isEndBlock && !isStartEnd) indent = Math.max(0, indent - 1);

    result.push(indentStr.repeat(indent) + trimmed);

    if (isStartBlock && !isStartEnd) indent++;
    else if (trimmed.endsWith('{') && !trimmed.includes('}')) indent++;
    else if (trimmed === '}') indent = Math.max(0, indent - 1);

    const allOpens = (trimmed.match(/<[A-Za-z]/g) || []).length;
    const selfCloses = (trimmed.match(/\/>/g) || []).length;
    const voidOpens = (trimmed.match(/<(?:img|br|hr|input|meta|link|source|area|base|col|embed|param|track|wbr)\b/gi) || []).length;
    const jsxCloseCount = (trimmed.match(/<\/[A-Za-z]/g) || []).length;
    indent += allOpens - selfCloses - voidOpens - jsxCloseCount;
    indent = Math.max(0, indent);
  }

  return result.join('\n');
}