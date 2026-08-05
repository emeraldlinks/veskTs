import * as path from 'path';
import * as fs from 'fs';
import {
  ExtensionContext,
  window,
  commands,
  workspace,
  OutputChannel,
  StatusBarAlignment,
  StatusBarItem,
  TextDocument,
  TextDocumentContentChangeEvent,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  State,
} from 'vscode-languageclient/node';

let client: LanguageClient | null = null;
let outputChannel: OutputChannel;
let statusBar: StatusBarItem;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Client-side tag auto-close that behaves like Emmet / HTML auto-close.
 *
 * Emmet implements auto-closing tags by listening to text document changes on
 * the client, rather than via an LSP `documentOnTypeFormatting` request. That
 * approach is deterministic: every time a `>` is typed after a tag name the
 * closing tag is inserted, regardless of completion-widget state, undo history
 * or previously rejected suggestions.
 */
function activateTagAutoClose(context: ExtensionContext) {
  let autoCloseEnabled = () => workspace.getConfiguration('vesk').get<boolean>('tagAutoClose', true);
  let typing = false;

  context.subscriptions.push(
    workspace.onDidChangeTextDocument((e) => {
      if (typing) return;
      if (e.document.languageId !== 'vsk') return;
      if (!autoCloseEnabled()) return;

      const editor = window.activeTextEditor;
      if (!editor || editor.document !== e.document) return;
      if (e.contentChanges.length !== 1) return;

      const change = e.contentChanges[0];
      if (change.text !== '>' || change.rangeLength !== 0) return;

      const doc = e.document;
      const line = doc.lineAt(change.range.end.line);
      const before = line.text.substring(0, change.range.end.character);
      const after = line.text.substring(change.range.end.character);

      const tag = matchOpeningTag(before);
      if (!tag) return;

      if (VOID_ELEMENTS.has(tag.toLowerCase())) return;
      if (isSelfClosing(before)) return;
      if (before.endsWith('</') || /<\/\s*$/.test(before)) return;
      if (restOfLineHasClose(after, tag)) return;
      // Don't fire when the tag was typed inside a comment or <style> block.
      if (insideCommentOrStyle(doc, doc.offsetAt(change.range.end))) return;
      // Don't fire when the `>` is inside a quoted attribute value.
      if (insideQuotedValue(before)) return;

      typing = true;
      void editor
        .edit((edit) => edit.insert(change.range.end, `</${tag}>`))
        .then(
          () => {
            typing = false;
          },
          () => {
            typing = false;
          }
        );
    })
  );
}

function matchOpeningTag(before: string): string | null {
  const m = /<([a-zA-Z][\w.:$-]*)([\s>][^>]*)?$/.exec(before);
  if (!m) return null;
  return m[1];
}

function isSelfClosing(before: string): boolean {
  return /<[^>]*\/\s*$/.test(before);
}

function restOfLineHasClose(after: string, tag: string): boolean {
  return after.trimStart().startsWith(`</${tag}>`);
}

function insideQuotedValue(before: string): boolean {
  // Find the last `<` and make sure there is no unclosed quote after it.
  const lt = before.lastIndexOf('<');
  const afterLt = lt === -1 ? before : before.slice(lt);
  const dq = (afterLt.match(/"/g) || []).length;
  const sq = (afterLt.match(/'/g) || []).length;
  return dq % 2 === 1 || sq % 2 === 1;
}

function insideCommentOrStyle(doc: TextDocument, offset: number): boolean {
  const text = doc.getText();
  const upTo = text.substring(0, offset);
  const lineComments = (upTo.match(/\/\/[^\n]*$/g) || []).length;
  if (lineComments > 0 && upTo.match(/\/\/[^\n]*$/)) return true;
  if (isInside(upTo, '<!--', '-->')) return true;
  if (isInside(upTo, '<style', '</style>')) return true;
  if (isInside(upTo, '/*', '*/')) return true;
  return false;
}

function isInside(upTo: string, startToken: string, endToken: string): boolean {
  const lastStart = upTo.lastIndexOf(startToken);
  if (lastStart === -1) return false;
  const afterStart = upTo.slice(lastStart + startToken.length);
  return !afterStart.includes(endToken);
}

export function activate(context: ExtensionContext) {
  outputChannel = window.createOutputChannel('Vesk LSP');

  const serverModule = path.resolve(__dirname, '..', 'lsp-server', 'index.mjs');

  if (!fs.existsSync(serverModule)) {
    window.showErrorMessage(`Vesk LSP server not found at ${serverModule}`);
    return;
  }

  outputChannel.appendLine(`Starting Vesk LSP from: ${serverModule}`);

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ['--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'vsk' }],
    outputChannel,
    synchronize: {
      configurationSection: 'vesk',
    },
    initializationOptions: {
      vesk: {
        'tailwind.completion': workspace.getConfiguration('vesk').get('tailwind.completion', true),
        'tagAutoClose': workspace.getConfiguration('vesk').get('tagAutoClose', true),
      },
    },
  };

  client = new LanguageClient('vesk', 'Vesk Language Server', serverOptions, clientOptions);

  statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  statusBar.text = '$(symbol-namespace) Vesk';
  statusBar.tooltip = 'Vesk Language Server';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const disposeClient = () => {
    if (client) {
      void client.stop();
      client = null;
    }
    if (statusBar) {
      statusBar.text = '$(circle-slash) Vesk';
      statusBar.tooltip = 'Vesk Language Server stopped';
    }
  };

  client.onDidChangeState((e) => {
    if (e.newState === State.Running) {
      statusBar.text = '$(check) Vesk';
      statusBar.tooltip = 'Vesk Language Server running';
    } else if (e.newState === State.Stopped) {
      statusBar.text = '$(circle-slash) Vesk';
      statusBar.tooltip = 'Vesk Language Server stopped';
    }
  });

  client.start().then(() => {
    outputChannel.appendLine('Vesk LSP server started');
  });

  context.subscriptions.push(
    commands.registerCommand('vesk.restartLsp', async () => {
      await disposeClient();
      client = new LanguageClient('vesk', 'Vesk Language Server', serverOptions, clientOptions);
      client.onDidChangeState((e) => {
        if (e.newState === State.Running) {
          statusBar.text = '$(check) Vesk';
          statusBar.tooltip = 'Vesk Language Server running';
        } else if (e.newState === State.Stopped) {
          statusBar.text = '$(circle-slash) Vesk';
          statusBar.tooltip = 'Vesk Language Server stopped';
        }
      });
      client.start().then(() => {
        window.showInformationMessage('Vesk Language Server restarted');
      });
    })
  );

  context.subscriptions.push(
    commands.registerCommand('vesk.formatDocument', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'vsk') {
        window.showWarningMessage('No active .vsk document to format');
        return;
      }
      await commands.executeCommand('editor.action.formatDocument');
    })
  );

  activateTagAutoClose(context);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
