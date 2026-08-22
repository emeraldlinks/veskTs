import * as path from 'path';
import * as fs from 'fs';
import {
  ExtensionContext,
  window,
  workspace,
  commands,
  OutputChannel,
  TextDocumentChangeEvent,
  TextDocumentChangeReason,
  SnippetString,
  Position,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | null = null;
let outputChannel: OutputChannel;

/** Trigger characters advertised by the server's experimental autoInsertionProvider. */
let autoInsertTriggerChars: string[] = ['>'];

/**
 * Client side of Volar's tag auto-insertion ("type `>` after `<div` and get
 * `</div>`"). The server advertises an experimental autoInsertionProvider and
 * answers the custom `volar/client/autoInsert` request, but vanilla
 * vscode-languageclient never sends that request — we drive it here.
 */
async function handleAutoInsert(event: TextDocumentChangeEvent) {
  if (!client || event.document.languageId !== 'vsk') {
    return;
  }
  if (event.reason === TextDocumentChangeReason.Undo || event.reason === TextDocumentChangeReason.Redo) {
    return;
  }
  const config = workspace.getConfiguration('vesk', event.document.uri);
  if (config.get<boolean>('autoCloseTags', true) === false) {
    return;
  }
  // Pure typing only: one empty-range insertion whose text ends with a trigger.
  if (event.contentChanges.length !== 1) {
    return;
  }
  const change = event.contentChanges[0];
  if (change.rangeLength !== 0 || change.text.length === 0) {
    return;
  }
  const lastChar = change.text[change.text.length - 1];
  if (!autoInsertTriggerChars.includes(lastChar)) {
    return;
  }

  const editor = window.activeTextEditor;
  if (!editor || editor.document !== event.document) {
    return;
  }

  // Caret position AFTER the inserted text, in the post-change document.
  const caretOffset = change.rangeOffset + change.text.length;
  const position = event.document.positionAt(caretOffset);

  let snippet: string | null | undefined;
  try {
    snippet = await client.sendRequest<string | null | undefined>('volar/client/autoInsert', {
      textDocument: { uri: event.document.uri.toString() },
      selection: { line: position.line, character: position.character },
      change: {
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      },
    });
  } catch {
    return; // server restarting / request cancelled — ignore
  }
  if (!snippet || editor !== window.activeTextEditor) {
    return;
  }

  // Only insert while the caret still sits exactly where the snippet belongs,
  // so a slow response can't inject a closing tag after the user kept typing.
  if (
    editor.selections.length !== 1 ||
    !editor.selection.isEmpty ||
    editor.document.offsetAt(editor.selection.active) !== caretOffset
  ) {
    return;
  }

  await editor.insertSnippet(new SnippetString(snippet.replace(/\$/g, '$$')), new Position(position.line, position.character));
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
  };

  context.subscriptions.push(
    workspace.onDidChangeTextDocument(handleAutoInsert),
  );

  client = new LanguageClient('vesk', 'Vesk Language Server', serverOptions, clientOptions);

  client.start().then(() => {
    outputChannel.appendLine('Vesk LSP server started');
    const caps = client?.initializeResult?.capabilities as
      | { experimental?: { autoInsertionProvider?: { triggerCharacters?: string[] } } }
      | undefined;
    const chars = caps?.experimental?.autoInsertionProvider?.triggerCharacters;
    if (chars && chars.length > 0) {
      autoInsertTriggerChars = chars;
    }
    outputChannel.appendLine(`Tag auto-insert trigger characters: ${autoInsertTriggerChars.join(', ')}`);
  });

  context.subscriptions.push(
    commands.registerCommand('vesk.restartLsp', async () => {
      if (client) {
        await client.stop();
      }
      client = new LanguageClient('vesk', 'Vesk Language Server', serverOptions, clientOptions);
      client.start().then(() => {
        window.showInformationMessage('Vesk Language Server restarted');
      });
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
