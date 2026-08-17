/** @module symbols — LSP document/workspace symbols and folding ranges. */

import { connection, documents, project } from './context';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { SymbolInformation, SymbolKind, FoldingRange, FoldingRangeParams, DocumentLink, SemanticTokensParams, SemanticTokens, Range, Position } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Register document symbol, workspace symbol, and folding range handlers. */
export function registerSymbols(): void {
  connection.onDocumentSymbol(async (params) => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const source = document.getText();
    const symbols: SymbolInformation[] = [];

    const compRe = /(?:export\s+)?(?:default\s+)?(?:async\s+)?component\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = compRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      symbols.push({
        name: m[1],
        kind: SymbolKind.Function,
        location: {
          uri: document.uri,
          range: {
            start: { line, character: m.index - source.lastIndexOf('\n', m.index) - 1 },
            end: { line: line + 1, character: 0 },
          },
        },
      });
    }

    const fnRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
    while ((m = fnRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      symbols.push({
        name: m[1],
        kind: SymbolKind.Function,
        location: {
          uri: document.uri,
          range: {
            start: { line, character: m.index - source.lastIndexOf('\n', m.index) - 1 },
            end: { line: line + 1, character: 0 },
          },
        },
      });
    }

    return symbols;
    } catch { return []; }
  });

  connection.onWorkspaceSymbol(async (params) => {
    try {
    const query = params.query.toLowerCase();
    const symbols: SymbolInformation[] = [];

    for (const [filePath, file] of project.files) {
      try {
        const source = readFileSync(filePath, 'utf-8');
        const lines = source.split('\n');
        const uri = `file://${filePath}`;

        for (const comp of file.components) {
          if (comp.name.toLowerCase().includes(query)) {
            symbols.push({
              name: `${comp.name}${comp.exported ? '' : ' (private)'}`,
              kind: SymbolKind.Function,
              location: { uri, range: { start: { line: comp.line, character: comp.column }, end: { line: comp.line + 1, character: 0 } } },
            });
          }
        }

        for (const decl of file.declarations) {
          if (decl.name.toLowerCase().includes(query)) {
            symbols.push({ name: decl.name, kind: decl.kind === 'class' ? SymbolKind.Class : decl.kind === 'component' ? SymbolKind.Function : SymbolKind.Variable, location: { uri, range: { start: { line: decl.line, character: decl.column }, end: { line: decl.line + 1, character: 0 } } } });
          }
        }
      } catch {}
    }

    return symbols;
    } catch { return []; }
  });

  connection.onFoldingRanges(async (params: FoldingRangeParams): Promise<FoldingRange[]> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const source = document.getText();
    const ranges: FoldingRange[] = [];

    const compBodyRe = /(?:export\s+)?(?:default\s+)?(?:async\s+)?component\s+\w+/g;
    let m: RegExpExecArray | null;
    while ((m = compBodyRe.exec(source)) !== null) {
      const startLine = source.substring(0, m.index).split('\n').length - 1;
      let braceCount = 0;
      let i = m.index + m[0].length;
      while (i < source.length && source[i] !== '{') i++;
      if (i >= source.length) continue;
      braceCount = 1;
      i++;
      while (i < source.length && braceCount > 0) {
        if (source[i] === '{') braceCount++;
        else if (source[i] === '}') braceCount--;
        i++;
      }
      const endLine = source.substring(0, Math.min(i, source.length)).split('\n').length - 1;
      if (endLine > startLine + 1) {
        ranges.push({ startLine, endLine, kind: 'region' });
      }
    }

    const lines = source.split('\n');
    let importStart = -1;
    let importEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith('import ')) {
        if (importStart === -1) importStart = i;
        importEnd = i;
      }
    }
    if (importStart >= 0 && importEnd > importStart) {
      ranges.push({ startLine: importStart, endLine: importEnd, kind: 'imports' });
    }

    return ranges;
    } catch { return []; }
  });
}