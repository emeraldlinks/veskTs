/** @module navigation — LSP go-to-definition, references, highlight, rename. */

import { connection, documents, project } from './context';
import { getWordAtPosition, getWordRangeAtPosition } from './text-utils';
import { analyzeDocument, walkNode } from './analysis';
import { resolveImportPath, resolveNodeModule, findSymbolInPackage, parseDeclarations, findFileByExportName, findComponentSource } from './project';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse } from '@vesk/compiler';
import { Location, LocationLink, ReferenceParams, DocumentHighlight, DocumentHighlightKind, PrepareRenameParams, RenameParams, WorkspaceEdit, TextEdit, Range, Position } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Register definition, references, highlight, prepare-rename, and rename handlers. */
export function registerNavigation(): void {
  connection.onDefinition(async (params): Promise<Location | LocationLink[] | null> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const importDef = findImportDefinition(document, params.position);
    if (importDef) return importDef;

    const srcPath = project.componentSources.get(word);
    if (srcPath && existsSync(srcPath)) {
      const source = readFileSync(srcPath, 'utf-8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`component ${word}`)) {
          return {
            uri: `file://${srcPath}`,
            range: {
              start: { line: i, character: lines[i].indexOf(word) },
              end: { line: i, character: lines[i].indexOf(word) + word.length },
            },
          };
        }
      }
    }

    const file = findFileByExportName(word);
    if (file) {
      const expInfo = file.exports.find(e => e.name === word);
      if (expInfo) {
        return {
          uri: `file://${file.path}`,
          range: {
            start: { line: expInfo.line, character: expInfo.column },
            end: { line: expInfo.line, character: expInfo.column + word.length },
          },
        };
      }
      const source = readFileSync(file.path, 'utf-8');
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(word) && /export/.test(lines[i])) {
          return {
            uri: `file://${file.path}`,
            range: {
              start: { line: i, character: lines[i].indexOf(word) },
              end: { line: i, character: lines[i].indexOf(word) + word.length },
            },
          };
        }
      }
    }

    const localSource = document.getText();
    const localLines = localSource.split('\n');
    for (let i = 0; i < localLines.length; i++) {
      if (localLines[i].includes(word) && /(?:component|function|const|let|var|class)\s+\w+/.test(localLines[i])) {
        const nameMatch = localLines[i].match(/(?:component|function|const|let|var|class)\s+(\w+)/);
        if (nameMatch && nameMatch[1] === word) {
          return {
            uri: params.textDocument.uri,
            range: {
              start: { line: i, character: localLines[i].indexOf(word) },
              end: { line: i, character: localLines[i].indexOf(word) + word.length },
            },
          };
        }
      }
    }

    const analysis = analyzeDocument(localSource);
    const decls = analysis.symbols.get(word);
    if (decls && decls.length > 0) {
      const d = decls[0];
      return {
        uri: params.textDocument.uri,
        range: {
          start: document.positionAt(d.start),
          end: document.positionAt(d.end),
        },
      };
    }

    return null;
    } catch { return null; }
  });

  connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const word = getWordAtPosition(document, params.position);
    if (!word) return [];

    const locations: Location[] = [];
    const uri = params.textDocument.uri;

    const source = document.getText();
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let idx = 0;
      while (true) {
        const pos = lines[i].indexOf(word, idx);
        if (pos === -1) break;
        locations.push({
          uri,
          range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
        });
        idx = pos + 1;
      }
    }

    return locations;
    } catch { return []; }
  });

  connection.onDocumentHighlight(async (params): Promise<DocumentHighlight[]> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const word = getWordAtPosition(document, params.position);
    if (!word) return [];

    const highlights: DocumentHighlight[] = [];
    const source = document.getText();
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let idx = 0;
      while (true) {
        const pos = lines[i].indexOf(word, idx);
        if (pos === -1) break;
        if (i === params.position.line && pos === params.position.character) {
          idx = pos + 1;
          continue;
        }
        highlights.push({
          range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
          kind: DocumentHighlightKind.Text,
        });
        idx = pos + 1;
      }
    }

    return highlights;
    } catch { return []; }
  });

  connection.onPrepareRename(async (params: PrepareRenameParams): Promise<Range | null> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    const word = getWordAtPosition(document, params.position);
    if (!word) return null;
    return getWordRangeAtPosition(document, params.position) || null;
    } catch { return null; }
  });

  connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | null> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const changes: Record<string, TextEdit[]> = {};
    const allFiles = [params.textDocument.uri, ...Array.from(project.files.keys()).map(f => `file://${f}`)];

    for (const uri of allFiles) {
      try {
        const doc = uri === params.textDocument.uri ? document : documents.get(uri);
        let text: string;
        if (doc) {
          text = doc.getText();
        } else {
          const path = uri.replace(/^file:\/\//, '');
          if (!existsSync(path)) continue;
          text = readFileSync(path, 'utf-8');
        }

        const edits: TextEdit[] = [];
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          let idx = 0;
          while (true) {
            const pos = lines[i].indexOf(word, idx);
            if (pos === -1) break;
            edits.push({
              range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
              newText: params.newName,
            });
            idx = pos + 1;
          }
        }
        if (edits.length > 0) {
          changes[uri] = edits;
        }
      } catch {}
    }

    return { changes };
    } catch { return null; }
  });
}

function findImportDefinition(document: TextDocument, position: Position): Location | null {
  const source = document.getText();
  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return null;
  }
  const offset = document.offsetAt(position);
  const docPath = document.uri.replace(/^file:\/\//, '');

  let found: Location | null = null;
  walkNode(ast, (node: any) => {
    if (found) return;
    if (node.type !== 'ImportDeclaration') return;

    const src = node.source;
    if (src && typeof src.start === 'number' && offset >= src.start && offset <= src.end) {
      const resolved = resolveImportPath(String(src.value), docPath, project);
      if (resolved && existsSync(resolved)) {
        found = {
          uri: `file://${resolved}`,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        };
      }
      return;
    }

    for (const spec of node.specifiers || []) {
      const local = spec.local;
      if (local && typeof local.start === 'number' && offset >= local.start && offset <= local.end) {
        const resolved = resolveImportPath(String(src.value), docPath, project);
        if (!resolved || !existsSync(resolved)) return;
        const importedName = spec.imported?.name || local.name;
        let target = findDeclarationInFile(resolved, importedName);
        let targetFile = resolved;
        if (!target) {
          const pkgRoot = resolveNodeModule(String(src.value), docPath);
          if (pkgRoot) {
            const symbolFile = findSymbolInPackage(pkgRoot, importedName);
            if (symbolFile) {
              target = findDeclarationInFile(symbolFile, importedName);
              targetFile = symbolFile;
            }
          }
        }
        if (target) {
          found = {
            uri: `file://${targetFile}`,
            range: {
              start: { line: target.line, character: target.column },
              end: { line: target.line, character: target.column + importedName.length },
            },
          };
        }
      }
    }
  });
  return found;
}

function findDeclarationInFile(filePath: string, name: string): { line: number; column: number } | null {
  const source = readFileSync(filePath, 'utf-8');
  const exported = project.files.get(filePath)?.exports.find(e => e.name === name);
  if (exported) return { line: exported.line, column: exported.column };
  const decl = parseDeclarations(source, 'vsk').find(d => d.name === name);
  if (decl) return { line: decl.line, column: decl.column };
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:component|function|class|interface|type|const|let|var)\\s+${name}\\b`));
    if (m) {
      return { line: i, column: lines[i].indexOf(name) };
    }
  }
  return null;
}