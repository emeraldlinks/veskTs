/**
 * Vesk language server — Volar-based LSP for `.vsk` files.
 *
 * `.vsk` source is compiled to virtual TSX via `compileVskCodegen`; TypeScript
 * semantics (hover, completion, diagnostics, navigation, symbols) come from
 * volar-service-typescript against the virtual code, with generated↔source
 * mapping back to the original file. vesk-specific plugins add what TS cannot
 * see: compile errors, reactive bindings, event-handler docs, and completion
 * fallbacks at token-boundary positions where TS is unavailable.
 */

import { URI } from 'vscode-uri';
import { createConnection, createServer, createTypeScriptProject } from '@volar/language-server/node';
import { create as createCssService } from 'volar-service-css';
import { AMBIENT as AMBIENT_CONTENT, RUNTIME_OVERRIDE as RUNTIME_OVERRIDE_CONTENT } from '@vesk/compiler';
import { createAutoInsertPlugin } from './plugins/autoInsert';
import { createCompletionPlugin } from './plugins/completion';
import { createCompileErrorDiagnosticPlugin } from './plugins/compileErrors';
import { createHoverPlugin } from './plugins/hover';
import { createTypeScriptDiagnosticFilterPlugin } from './plugins/diagnosticsFilter';
import { getVeskLanguagePlugin, resolveConfig } from './language-plugin';
import { createTypeScriptServices, patchUserPreferences } from './typescriptService';
import { formatVeskDocument } from './formatting';
import { createLogging } from './utils';

const { log, logError } = createLogging('[Vesk Language Server]');

const WORKSPACE_FILE_PATTERNS = [
  '**/*.vsk',
  '**/*.ts',
  '**/*.tsx',
  '**/*.cts',
  '**/*.mts',
  '**/*.js',
  '**/*.jsx',
  '**/*.cjs',
  '**/*.mjs',
  '**/*.json',
];

const AMBIENT_FILE_NAME = '__vesk_ambient.d.ts';
const RUNTIME_OVERRIDE_FILE_NAME = '__vesk_runtime_override.d.ts';

/**
 * Strip whole-document formatting capabilities from a Volar service plugin.
 * The bundled TS and CSS services advertise document formatting against the
 * virtual code; edits don't map back to `.vsk`, so formatting is owned by
 * Prettier + @vesk/prettier-plugin (registered after initialize).
 */
function stripDocumentFormatting<T extends { capabilities?: Record<string, unknown> }>(plugin: T): T {
  // On-type formatting is owned by the client (editor autoclose); document
  // formatting is owned by this server (prettier over `.vsk` source).
  const {
    documentFormattingProvider: _fmt,
    documentRangeFormattingProvider: _rangeFmt,
    documentOnTypeFormattingProvider: _onType,
    ...capabilities
  } = plugin.capabilities ?? {};
  return { ...plugin, capabilities };
}

export function createVeskLanguageServer() {
  const connection = createConnection();
  const server = createServer(connection);

  connection.listen();

  const wrappedFunctions = new WeakSet<Function>();

  /**
   * Ensure TypeScript hosts always see compiler options with vesk defaults.
   */
  function wrapCompilerOptionsProvider(target: unknown, method: string): void {
    if (!target) {
      return;
    }
    const host = target as Record<string, unknown>;
    const original = host[method];
    if (typeof original !== 'function' || wrappedFunctions.has(original)) {
      return;
    }

    let cachedInput: unknown;
    let cachedOutput: unknown;

    const wrapped = () => {
      const input = (original as () => unknown).call(host);
      if (cachedInput !== input) {
        cachedInput = input;
        cachedOutput = resolveConfig({ options: input as { options?: object } }).options;
      }
      return cachedOutput;
    };

    wrappedFunctions.add(original);
    wrappedFunctions.add(wrapped);
    host[method] = wrapped;
  }

  /**
   * Serve the synthetic ambient files (JSX namespace + `@vesk/runtime` module
   * declaration) through the language-service host so imports resolve without
   * node_modules and intrinsics/reactive declarations type-check.
   */
  function injectAmbientFiles(
    host: {
      getScriptFileNames?: () => string[];
      getScriptSnapshot?: (fileName: string) => unknown;
      readFile?: (fileName: string) => string | undefined;
      fileExists?: (fileName: string) => boolean;
    },
    ambientDir: string,
  ): void {
    const ambientPaths = [URI.file(`${ambientDir}/${AMBIENT_FILE_NAME}`).toString()];
    if (host.getScriptFileNames) {
      const original = host.getScriptFileNames.bind(host);
      host.getScriptFileNames = () => [...original(), ...ambientPaths];
    }
    if (host.getScriptSnapshot) {
      const original = host.getScriptSnapshot.bind(host);
      host.getScriptSnapshot = (fileName: string) => {
        const content = getAmbientContent(fileName);
        if (content !== undefined) {
          return {
            getText: (start: number, end: number) => content.substring(start, end),
            getLength: () => content.length,
            getChangeRange: () => undefined,
          };
        }
        return original(fileName);
      };
    }
    if (host.readFile) {
      const original = host.readFile.bind(host);
      host.readFile = (fileName: string) => {
        const content = getAmbientContent(fileName);
        if (content !== undefined) {
          return content;
        }
        return original(fileName);
      };
    }
    if (host.fileExists) {
      const original = host.fileExists.bind(host);
      host.fileExists = (fileName: string) => {
        if (getAmbientContent(fileName) !== undefined) {
          return true;
        }
        return original(fileName);
      };
    }
  }

  function getAmbientContent(fileName: string): string | undefined {
    if (fileName.endsWith(`/${AMBIENT_FILE_NAME}`)) {
      return AMBIENT_CONTENT;
    }
    if (fileName.endsWith(`/${RUNTIME_OVERRIDE_FILE_NAME}`)) {
      return RUNTIME_OVERRIDE_CONTENT;
    }
    return undefined;
  }

  connection.onInitialize(async (params) => {
    try {
      log('Initializing vesk language server...');

      const ts = await import('typescript');
      patchUserPreferences();

      const initResult = server.initialize(
        params,
        createTypeScriptProject(ts, undefined, ({ configFileName, projectHost, sys }) => {
          log(`TypeScript project create callback (configFileName=${configFileName})`);
          wrapCompilerOptionsProvider(projectHost, 'getCompilationSettings');
          const ambientDir = configFileName
            ? configFileName.replace(/[\\/][^\\/]*$/, '')
            : sys.getCurrentDirectory();

          const languagePlugin = getVeskLanguagePlugin();

          return {
            languagePlugins: [languagePlugin],
            setup({ project }) {
              log(`TypeScript project setup callback (project=${!!project})`);
              wrapCompilerOptionsProvider(project?.typescript?.languageServiceHost, 'getCompilationSettings');
              const lsHost = project?.typescript?.languageServiceHost as
                | {
                    getScriptFileNames?: () => string[];
                    getScriptSnapshot?: (fileName: string) => unknown;
                    readFile?: (fileName: string) => string | undefined;
                    fileExists?: (fileName: string) => boolean;
                    getCurrentDirectory?: () => string;
                  }
                | undefined;
              if (lsHost) {
                injectAmbientFiles(lsHost, ambientDir);
                log(`Ambient files injected into project root: ${ambientDir}`);
              }
            },
          };
        }),
        [
          createAutoInsertPlugin(),
          createCompletionPlugin(),
          createCompileErrorDiagnosticPlugin(),
          stripDocumentFormatting(createCssService()),
          ...createTypeScriptServices(ts).map(stripDocumentFormatting),
          // Must come after TypeScript services to intercept their providers.
          createTypeScriptDiagnosticFilterPlugin(),
          createHoverPlugin(),
        ],
      );

      log('Server initialization complete');
      // Formatting is owned by this server (prettier over the `.vsk` source),
      // advertised manually since no Volar service declares it.
      (initResult as { capabilities?: Record<string, unknown> }).capabilities = {
        ...(initResult as { capabilities?: Record<string, unknown> }).capabilities,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
      };
      return initResult;
    } catch (initError) {
      logError('Server initialization failed:', initError);
      throw initError;
    }
  });

  connection.onInitialized(async () => {
    log('Server initialized.');
    server.initialized();

    // Formatting is owned here: Volar's per-feature handlers don't advertise
    // document formatting, so registering on the connection after initialize
    // (last registration wins) gives us prettier over the `.vsk` source.
    connection.onDocumentFormatting(async (params) => {
      const document = server.documents.get(URI.parse(params.textDocument.uri));
      if (!document) {
        return [];
      }
      const formatted = await formatVeskDocument(document);
      if (!formatted) {
        return [];
      }
      const fullRange = {
        start: { line: 0, character: 0 },
        end: document.positionAt(document.getText().length),
      };
      return [{ range: fullRange, newText: formatted }];
    });
    connection.onDocumentRangeFormatting(async (params) => {
      const document = server.documents.get(URI.parse(params.textDocument.uri));
      if (!document) {
        return [];
      }
      const formatted = await formatVeskDocument(document);
      if (!formatted) {
        return [];
      }
      return [{ range: params.range, newText: formatted }];
    });

    try {
      await server.fileWatcher.watchFiles(WORKSPACE_FILE_PATTERNS);
      log('Workspace file watchers registered.');
    } catch (err) {
      logError('Failed to register file watchers:', err);
    }
  });

  process.on('uncaughtException', (err) => {
    logError('Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled rejection at:', promise, 'reason:', reason);
  });

  return { connection, server };
}
