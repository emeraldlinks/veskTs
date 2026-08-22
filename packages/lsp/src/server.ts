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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const { log, logError, logWarning } = createLogging('[Vesk Language Server]');

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
 * Served only when NO real TypeScript lib directory can be located (see
 * findTypescriptLibDir). Without lib d.ts files the program has no ES/DOM
 * globals at all (`Error`, `console`, `Promise` → TS2304 everywhere); this
 * minimal fallback keeps the most common globals defined. When real libs are
 * found this file is never injected (its declarations would collide).
 */
const LIB_FALLBACK_FILE_NAME = '__vesk_lib_fallback.d.ts';
const LIB_FALLBACK_CONTENT = `
type AnyFunction = (...args: any[]) => any;
interface Error { name?: string; message?: string; stack?: string; }
interface ErrorConstructor { new (message?: string): Error; (message?: string): Error; prototype: Error; }
declare var Error: ErrorConstructor;
declare var console: {
  log: AnyFunction; error: AnyFunction; warn: AnyFunction; info: AnyFunction;
  debug: AnyFunction; trace: AnyFunction; table: AnyFunction; dir: AnyFunction;
  group: AnyFunction; groupEnd: AnyFunction; time: AnyFunction; timeEnd: AnyFunction;
  assert: AnyFunction; count: AnyFunction;
};
`;

/**
 * Locate the `typescript/lib` directory that ships the lib.*.d.ts files.
 *
 * The LSP server bundle INLINES the typescript package, so inside the bundle
 * `ts.getDefaultLibFilePath()` resolves relative to the bundle location
 * (`lsp-server/index.mjs`) where no lib files exist — every global then fails
 * with TS2304 ("Cannot find name 'Error'"). We must therefore resolve the REAL
 * on-disk lib directory ourselves and patch it onto the language service host.
 *
 * Resolution order:
 * 1. Walk up from each candidate root (workspace folders, tsconfig dir, cwd)
 *    looking for node_modules/typescript/lib — the project's own TypeScript.
 * 2. import.meta.resolve('typescript') — works when running from a checkout.
 * 3. `<bundle dir>/libs` — lib files copied next to the bundle at build time
 *    by scripts/build-lsp.js, so packaged extensions work standalone.
 */
function findTypescriptLibDir(candidateRoots: string[]): string | null {
  for (const root of candidateRoots) {
    if (!root) continue;
    let dir = root;
    // Walk up to the filesystem root looking for node_modules/typescript/lib.
    for (;;) {
      const libDir = join(dir, 'node_modules', 'typescript', 'lib');
      if (existsSync(join(libDir, 'lib.dom.d.ts'))) {
        return libDir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  try {
    // Available in Node >= 20.6 without flags; engines require >= 20.
    const resolved = import.meta.resolve('typescript');
    const pkgDir = join(dirname(fileURLToPath(resolved)));
    if (existsSync(join(pkgDir, 'lib.dom.d.ts'))) {
      return pkgDir;
    }
  } catch {
    // Not resolvable from here (bundled context) — fall through.
  }

  try {
    const shipped = join(fileURLToPath(import.meta.url), '..', 'libs');
    if (existsSync(join(shipped, 'lib.dom.d.ts'))) {
      return shipped;
    }
  } catch {
    // ignore
  }

  return null;
}

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
        const o = cachedOutput as { target?: unknown; jsx?: unknown; lib?: string[]; types?: string[] };
        log(
          `getCompilationSettings resolved: target=${o.target} jsx=${o.jsx} lib=[${(o.lib ?? []).join(',')}] types=[${(o.types ?? []).join(',')}]`,
        );
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
    includeLibFallback = false,
  ): void {
    const ambientPaths = [URI.file(`${ambientDir}/${AMBIENT_FILE_NAME}`).toString()];
    if (includeLibFallback) {
      ambientPaths.push(URI.file(`${ambientDir}/${LIB_FALLBACK_FILE_NAME}`).toString());
    }
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
    } else {
      // The volar TS service host may not implement readFile at all; without
      // it, `/// <reference lib="...">` chains inside lib.d.ts files (esnext
      // is a pure hub of them) cannot resolve and ES globals stay missing.
      host.readFile = (fileName: string) => {
        const content = getAmbientContent(fileName);
        if (content !== undefined) {
          return content;
        }
        if (hasUriScheme(fileName)) {
          return undefined;
        }
        try {
          return readFileSync(fileName, 'utf8');
        } catch {
          return undefined;
        }
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
    } else {
      host.fileExists = (fileName: string) => {
        if (getAmbientContent(fileName) !== undefined) {
          return true;
        }
        if (hasUriScheme(fileName)) {
          return false;
        }
        return existsSync(fileName);
      };
    }
  }

  /** True for `file://…`-style URIs (as opposed to plain fs paths). */
  function hasUriScheme(fileName: string): boolean {
    const colon = fileName.indexOf(':');
    if (colon <= 0) {
      return false;
    }
    for (let i = 0; i < colon; i++) {
      const c = fileName.charCodeAt(i);
      const isAlpha = (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
      const isDigit = c >= 48 && c <= 57;
      const isSpecial = c === 43 || c === 45 || c === 46; // + - .
      if (!(isAlpha || (i > 0 && (isDigit || isSpecial)))) {
        return false;
      }
    }
    return true;
  }

  function getAmbientContent(fileName: string): string | undefined {
    if (fileName.endsWith(`/${AMBIENT_FILE_NAME}`)) {
      return AMBIENT_CONTENT;
    }
    if (fileName.endsWith(`/${RUNTIME_OVERRIDE_FILE_NAME}`)) {
      return RUNTIME_OVERRIDE_CONTENT;
    }
    if (fileName.endsWith(`/${LIB_FALLBACK_FILE_NAME}`)) {
      return LIB_FALLBACK_CONTENT;
    }
    return undefined;
  }

  connection.onInitialize(async (params) => {
    try {
      log('Initializing vesk language server...');

      const ts = await import('typescript');
      patchUserPreferences();

      const workspaceRoots: string[] = [];
      for (const folder of params.workspaceFolders ?? []) {
        try {
          workspaceRoots.push(URI.parse(folder.uri).fsPath);
        } catch {
          // ignore malformed folder URIs
        }
      }

      const tsLibDir = findTypescriptLibDir(workspaceRoots);
      if (tsLibDir) {
        log(`TypeScript lib directory resolved: ${tsLibDir}`);
      } else {
        logWarning(
          'No TypeScript lib directory found — serving minimal global fallback. ' +
            'Install typescript in the workspace (npm i -D typescript) for full typings.',
        );
      }

      const initResult = server.initialize(
        params,
        createTypeScriptProject(ts, undefined, ({ configFileName, projectHost, sys }) => {
          log(`TypeScript project create callback (configFileName=${configFileName})`);
          wrapCompilerOptionsProvider(projectHost, 'getCompilationSettings');
          const ambientDir = configFileName
            ? configFileName.replace(/[\\/][^\\/]*$/, '')
            : sys.getCurrentDirectory();

          const languagePlugin = getVeskLanguagePlugin();
          const candidateRoots = [...workspaceRoots, ambientDir];

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
                    getDefaultLibFileName?: (options: unknown) => string;
                  }
                | undefined;
              if (lsHost) {
                // The bundle inlines typescript, so the host's default
                // getDefaultLibFileName points at <bundle dir>/lib.*.d.ts
                // which does not exist → every ES/DOM global is "Cannot find
                // name". Redirect lib resolution to the real on-disk lib dir.
                const effectiveLibDir = existsSync(join(ambientDir, 'node_modules', 'typescript', 'lib', 'lib.dom.d.ts'))
                  ? join(ambientDir, 'node_modules', 'typescript', 'lib')
                  : (tsLibDir ?? findTypescriptLibDir(candidateRoots));
                if (effectiveLibDir && typeof lsHost.getDefaultLibFileName === 'function') {
                  const originalGetDefaultLibFile = lsHost.getDefaultLibFileName.bind(lsHost);
                  // volar's host already returns an ABSOLUTE path here
                  // (ts.getDefaultLibFilePath). Take the basename before
                  // re-rooting, otherwise join() produces a double path and
                  // lib reference resolution breaks.
                  lsHost.getDefaultLibFileName = (options: unknown) => {
                    const raw = originalGetDefaultLibFile(options);
                    const base = raw.split(/[\\/]/).pop() ?? raw;
                    return join(effectiveLibDir, base);
                  };
                  // Also advertise the location: TS resolves options.lib
                  // entries AND `/// <reference lib="…">` chains (the es
                  // libs are pure hubs of them) against this.
                  const hostWithLibLocation = lsHost as { getDefaultLibLocation?: () => string };
                  hostWithLibLocation.getDefaultLibLocation = () => effectiveLibDir;
                  log(`Language service host libs redirected to: ${effectiveLibDir}`);
                }
                if (effectiveLibDir && typeof lsHost.getScriptFileNames === 'function') {
                  // options.lib entries are not reliably resolved by the
                  // embedded program, so add concrete lib d.ts files as root
                  // files from disk. Raw paths (not URIs): the underlying
                  // host reads them via fs. We inject every content-bearing
                  // leaf lib (hubs like lib.es2015.d.ts only contain
                  // ///-references), so ES/DOM globals resolve regardless of
                  // whether reference chains resolve in this environment.
                  const bareEraHubs = new Set([
                    'es6',
                    'es7',
                    'es2015',
                    'es2016',
                    'es2017',
                    'es2018',
                    'es2019',
                    'es2020',
                    'es2021',
                    'es2022',
                    'es2023',
                    'es2024',
                    'esnext',
                    'dom.asynciterable',
                  ]);
                  let libFiles: string[] = [];
                  try {
                    libFiles = readdirSync(effectiveLibDir)
                      .filter(
                        (name) =>
                          name.startsWith('lib.') &&
                          name.endsWith('.d.ts') &&
                          !name.endsWith('.full.d.ts') &&
                          name !== 'lib.d.ts' &&
                          (() => {
                            const stem = name.slice('lib.'.length, -'.d.ts'.length);
                            return !bareEraHubs.has(stem);
                          })(),
                      )
                      .map((f) => join(effectiveLibDir, f));
                  } catch {
                    libFiles = [];
                  }
                  if (libFiles.length > 0) {
                    const originalGetScriptFileNames = lsHost.getScriptFileNames.bind(lsHost);
                    lsHost.getScriptFileNames = () => [...originalGetScriptFileNames(), ...libFiles];
                    log(`Lib d.ts files injected as root files: ${libFiles.length}`);
                  }
                }
                injectAmbientFiles(lsHost, ambientDir, !effectiveLibDir);
                log(`Ambient files injected into project root: ${ambientDir}`);
              }
            },
          };
        }),
        [
          createCompletionPlugin(),
          createCompileErrorDiagnosticPlugin(),
          stripDocumentFormatting(createCssService()),
          ...createTypeScriptServices(ts).map(stripDocumentFormatting),
          // Must come after TypeScript services to intercept their providers.
          createTypeScriptDiagnosticFilterPlugin(),
          createHoverPlugin(),
          // Must come after TypeScript services: its create() disables
          // `typescript-syntactic`'s competing auto-insert snippets.
          createAutoInsertPlugin(),
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
