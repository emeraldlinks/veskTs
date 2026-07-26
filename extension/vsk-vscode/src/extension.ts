import * as path from 'path';
import * as fs from 'fs';
import { ExtensionContext, window, commands, OutputChannel } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | null = null;
let outputChannel: OutputChannel;

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

  client = new LanguageClient('vesk', 'Vesk Language Server', serverOptions, clientOptions);

  client.start().then(() => {
    outputChannel.appendLine('Vesk LSP server started');
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
