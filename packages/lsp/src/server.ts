import { TextDocument } from 'vscode-languageserver-textdocument';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { project, setProject, readSettings, connection, documents } from './context';
import { scanProject, parseExports, getVskComponents, parseDeclarations } from './project';
import { validateDocument } from './diagnostics';
import { registerCompletions } from './completions';
import { registerHover } from './hover';
import { registerNavigation } from './navigation';
import { registerSymbols } from './symbols';
import { registerFeatures } from './features';

connection.onInitialize((params) => {
  const rootUri = params.rootUri || params.rootPath || '';
  project.workspaceRoot = rootUri.replace(/^file:\/\//, '');
  if (params.initializationOptions) readSettings(params.initializationOptions);
  try {
    setProject(scanProject(project.workspaceRoot));
    connection.console.log(`Vesk LSP: scanned ${project.files.size} files, ${project.componentSources.size} components`);
  } catch (e: any) {
    connection.console.error(`Vesk LSP scan error: ${e.message}`);
  }

  return {
    capabilities: {
      textDocumentSync: 1,
      completionProvider: {
        triggerCharacters: ['<', '{', '/', '.', ' ', '"', "'", '`', 'c', 'e', 'i', 'l', 'f', 'w', 't', 's', '&', ':', '-'],
        resolveProvider: true,
      },
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: ['component', 'reactive', 'keyword', 'function', 'variable', 'property', 'type', 'event'],
          tokenModifiers: ['declaration', 'definition', 'readonly', 'async'],
        },
        full: true,
      },
      foldingRangeProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentHighlightProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      colorProvider: true,
      documentLinkProvider: { resolveProvider: false },
      codeActionProvider: { codeActionKinds: ['quickfix'] },
      workspace: {
        fileOperations: {
          didCreate: { filters: [{ pattern: { glob: '**/*.{vsk,ts,tsx,js,jsx}' } }] },
          didDelete: { filters: [{ pattern: { glob: '**/*.{vsk,ts,tsx,js,jsx}' } }] },
        },
      },
    },
  };
});

connection.onDidChangeConfiguration((params) => {
  readSettings((params as any).settings);
});

connection.onDidChangeWatchedFiles(async (params) => {
  for (const change of params.changes) {
    const path = change.uri.replace(/^file:\/\//, '');
    if (change.type === 2) {
      project.files.delete(path);
    } else {
      try {
        if (existsSync(path) && /\.(vsk|ts|tsx|js|jsx)$/.test(path)) {
          const source = readFileSync(path, 'utf-8');
          const ext = extname(path);
          const lang = ext === '.vsk' ? 'vsk' : ext;
          const exports2 = parseExports(source, lang);
          const components2 = lang === 'vsk' ? getVskComponents(source) : [];
          const declarations2 = parseDeclarations(source, lang);
          project.files.set(path, { uri: '', path, exports: exports2, components: components2, declarations: declarations2, lastModified: Date.now() });
        }
      } catch {}
    }
  }
});

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

registerCompletions();
registerHover();
registerNavigation();
registerSymbols();
registerFeatures();

documents.listen(connection);
connection.listen();
