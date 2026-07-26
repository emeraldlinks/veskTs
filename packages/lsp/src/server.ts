import { parse } from '@vesk/compiler';
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  TextDocumentSyncKind,
  Hover,
  HoverParams,
  MarkupKind,
  SymbolInformation,
  SymbolKind,
  Position,
  FoldingRange,
  FoldingRangeParams,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

function parseVsk(source: string) {
  const errors: { message: string; line: number; column: number }[] = [];
  let ast: any = null;
  try {
    ast = parse(source, {});
  } catch (e: any) {
    const msg = e.message || String(e);
    const match = msg.match(/\((\d+):(\d+)\)/);
    if (match) {
      errors.push({ message: msg, line: parseInt(match[1]) - 1, column: parseInt(match[2]) - 1 });
    } else {
      const lineMatch = msg.match(/line (\d+)/i);
      const colMatch = msg.match(/col (\d+)/i);
      errors.push({
        message: msg,
        line: lineMatch ? parseInt(lineMatch[1]) - 1 : 0,
        column: colMatch ? parseInt(colMatch[1]) - 1 : 0,
      });
    }
  }
  return { ast, errors };
}

function findAllComponents(ast: any): { name: string; line: number; column: number }[] {
  const components: { name: string; line: number; column: number }[] = [];
  if (!ast?.body) return components;
  for (const node of ast.body) {
    let target = node;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      target = node.declaration;
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      target = node.declaration;
    }
    if (target.type === 'ComponentDeclaration' && target.id) {
      components.push({
        name: target.id.name,
        line: (target.loc?.start?.line || 1) - 1,
        column: target.loc?.start?.column || 0,
      });
    }
  }
  return components;
}

function getComponentFoldRanges(body: any[]): { startLine: number; endLine: number }[] {
  const ranges: { startLine: number; endLine: number }[] = [];
  if (!body) return ranges;
  for (const node of body) {
    let target = node;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      target = node.declaration;
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      target = node.declaration;
    }
    if (target.type === 'ComponentDeclaration' && target.body) {
      const start = (target.body.loc?.start?.line || target.loc?.start?.line || 1) - 1;
      const end = (target.body.loc?.end?.line || target.loc?.end?.line || 1) - 1;
      if (end > start + 1) ranges.push({ startLine: start, endLine: end });
    }
  }
  return ranges;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ['<', '{', '/', 'c', 'e', 'i', 'l', 'f', 'w', 't', 's', '&'] },
      hoverProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
    },
  };
});

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

function validateDocument(document: TextDocument): void {
  const source = document.getText();
  const { ast, errors } = parseVsk(source);

  const diagnostics: Diagnostic[] = errors.map((err) => {
    const lines = source.split('\n');
    const endCol = lines[err.line]?.length || 0;
    return {
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: err.line, character: err.column },
        end: { line: err.line, character: endCol },
      },
      message: err.message,
      source: 'vesk',
    };
  });

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

connection.onCompletion(async (_params): Promise<CompletionItem[]> => {
  return [
    {
      label: 'component',
      kind: CompletionItemKind.Keyword,
      detail: 'Declare a Vesk component',
      insertText: 'component ${1:Name}(${2:props}) {\n\t$0\n}',
      insertTextFormat: 2,
    },
    {
      label: 'export component',
      kind: CompletionItemKind.Keyword,
      detail: 'Export a Vesk component',
      insertText: 'export component ${1:Name}(${2:props}) {\n\t$0\n}',
      insertTextFormat: 2,
    },
    {
      label: 'export default component',
      kind: CompletionItemKind.Keyword,
      detail: 'Export default a Vesk component',
      insertText: 'export default component ${1:Name} {\n\t$0\n}',
      insertTextFormat: 2,
    },
    { label: 'import', kind: CompletionItemKind.Keyword, insertText: 'import { ${1} } from "${2}"', insertTextFormat: 2 },
    { label: 'from', kind: CompletionItemKind.Keyword },
    { label: 'let', kind: CompletionItemKind.Keyword, insertText: 'let &[${1}] = track(${2})', insertTextFormat: 2 },
    { label: 'const', kind: CompletionItemKind.Keyword },
    { label: 'return', kind: CompletionItemKind.Keyword },
    { label: 'if', kind: CompletionItemKind.Keyword, insertText: 'if (${1}) {\n\t$0\n}', insertTextFormat: 2 },
    { label: 'else', kind: CompletionItemKind.Keyword },
    { label: 'for', kind: CompletionItemKind.Keyword, insertText: 'for (${1} of ${2}) {\n\t$0\n}', insertTextFormat: 2 },
    { label: 'while', kind: CompletionItemKind.Keyword, insertText: 'while (${1}) {\n\t$0\n}', insertTextFormat: 2 },
    { label: 'try', kind: CompletionItemKind.Keyword, insertText: 'try {\n\t$0\n} catch(e) {\n\t\n}', insertTextFormat: 2 },
    { label: 'catch', kind: CompletionItemKind.Keyword },
    { label: 'track', kind: CompletionItemKind.Function, detail: 'Create a reactive signal' },
    { label: 'Head', kind: CompletionItemKind.Class, detail: 'Document head element' },
    { label: 'slot', kind: CompletionItemKind.Keyword },
    { label: '{#client}', kind: CompletionItemKind.Snippet, insertText: '{#client}\n\t$0\n{/client}', insertTextFormat: 2 },
    { label: '{#server}', kind: CompletionItemKind.Snippet, insertText: '{#server}\n\t$0\n{/server}', insertTextFormat: 2 },
  ];
});

connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const source = document.getText();
  const { ast } = parseVsk(source);
  if (!ast) return null;

  const components = findAllComponents(ast);
  const pos = params.position;

  for (const comp of components) {
    if (comp.line === pos.line) {
      const range = getWordRange(document, pos);
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${comp.name}** component — declared at line ${comp.line + 1}.`,
        },
        range,
      };
    }
  }
  return null;
});

connection.onDocumentSymbol(async (params): Promise<SymbolInformation[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const source = document.getText();
  const { ast } = parseVsk(source);
  if (!ast) return [];

  const components = findAllComponents(ast);
  return components.map((comp) => ({
    name: comp.name,
    kind: SymbolKind.Function,
    location: {
      uri: document.uri,
      range: {
        start: { line: comp.line, character: comp.column },
        end: { line: comp.line + 1, character: 0 },
      },
    },
  }));
});

connection.onFoldingRanges(async (params: FoldingRangeParams): Promise<FoldingRange[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const source = document.getText();
  const { ast } = parseVsk(source);
  if (!ast) return [];

  const ranges: FoldingRange[] = [];

  const foldRanges = getComponentFoldRanges(ast.body);
  for (const r of foldRanges) {
    ranges.push({ startLine: r.startLine, endLine: r.endLine, kind: 'region' });
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
});

function getWordRange(document: TextDocument, position: Position) {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return undefined;

  let start = position.character;
  let end = position.character;

  while (start > 0 && /\w/.test(line[start - 1])) start--;
  while (end < line.length && /\w/.test(line[end])) end++;

  if (start === end) return undefined;
  return { start: { line: position.line, character: start }, end: { line: position.line, character: end } };
}

documents.listen(connection);
connection.listen();
