import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';
import { parse } from '@vesk/compiler/src/parser';
import { vskToTsx, generateVskDts } from '@vesk/compiler/src/vsk-tsx';

export interface TypecheckOptions {
  strict?: boolean;
  appDir?: string;
}

export interface TypecheckError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

const SKIP_DIRS = new Set(['node_modules', '.vesk', '.git', 'dist', 'tarballs', '.next']);
const SKIP_FILES = new Set(['__vesk_ambient.d.ts', '__vesk_runtime_override.d.ts']);

const AMBIENT = `
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: unknown;
  }
}
declare const Head: (props: { children?: unknown }) => unknown;
declare class Cell<T> {
  get(): T;
  set(value: T): boolean;
  peek(): T;
  update(fn: (current: T) => T): boolean;
  unsubscribe(effect: unknown): void;
}
declare function track<T>(initialValue: T): Cell<T>;
declare function derived<T>(fn: () => T): Cell<T>;
declare function effect(fn: () => void): unknown;
declare function untrack<T>(fn: () => T): T;
declare function peek<T>(fn: () => T): T;
declare function tick(): Promise<void>;
declare function flushSync(fn: () => void): void;
declare function on_destroy(fn: () => void): void;
declare function createContext<T>(defaultValue?: T): { id: symbol; defaultValue: T | undefined };
declare function useFetch<T = unknown>(...args: unknown[]): T;
declare function useRouter(): unknown;
declare function useParams(): Record<string, string>;
declare function usePathname(): string;
declare function useSearchParams(): URLSearchParams;
declare function useNavigate(): (to: string) => void;
declare function defineAction(...args: unknown[]): unknown;
declare const Form: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Field: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare function required(...args: unknown[]): unknown;
declare function email(...args: unknown[]): unknown;
declare function minLength(...args: unknown[]): unknown;
declare function maxLength(...args: unknown[]): unknown;
declare function pattern(...args: unknown[]): unknown;
declare function custom(...args: unknown[]): unknown;
declare const Link: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const NavLink: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Outlet: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Image: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Portal: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const Experiment: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const JsonLd: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const ArticleSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const ProductSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const FAQPageSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const BreadcrumbListSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const OrganizationSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const LocalBusinessSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare const VideoSchema: (props: { [k: string]: unknown; children?: unknown }) => unknown;
declare function redirect(...args: unknown[]): unknown;
declare function permanentRedirect(...args: unknown[]): unknown;
declare function notFound(...args: unknown[]): never;
declare class NotFoundError extends Error {}
declare function createResource(...args: unknown[]): unknown;
declare function getAction(...args: unknown[]): unknown;
declare function validateActionInput(...args: unknown[]): unknown;
declare function issuesToFieldMap(...args: unknown[]): unknown;
declare function isFormAction(...args: unknown[]): unknown;
`;

const RUNTIME_OVERRIDE = `
import '@vesk/runtime';
declare module '@vesk/runtime' {
  export function track<T>(initialValue: T): Cell<T>;
  export function derived<T>(fn: () => T): Cell<T>;
}
`;

function walkProjectFiles(projectRoot: string): { code: string[]; js: string[] } {
  const code: string[] = [];
  const js: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e)) continue;
        walk(p);
      } else if (e.endsWith('.vsk')) {
        code.push(p);
      } else if (e.endsWith('.ts') || e.endsWith('.tsx')) {
        if (SKIP_FILES.has(e) || e.endsWith('.vsk.d.ts')) continue;
        code.push(p);
      } else if (e.endsWith('.js')) {
        if (e.endsWith('.vsk.js')) continue;
        js.push(p);
      }
    }
  };
  walk(projectRoot);
  return { code, js };
}

function isUnder(dir: string, file: string): boolean {
  const base = resolve(dir);
  const abs = resolve(file);
  return abs === base || abs.startsWith(base + sep);
}

function structureWarning(rel: string, message: string): TypecheckError {
  return { file: rel, line: 1, column: 1, code: 'vesk-structure', message };
}

function checkStructureFile(appDir: string, file: string): TypecheckError | null {
  const rel = relative(appDir, file);
  const parts = rel.split('\\').join('/').split('/');
  const name = parts[parts.length - 1] ?? '';
  const isApi = parts.includes('api');
  if (name === 'middleware.vsk') {
    return structureWarning(
      rel,
      'middleware must live in a TypeScript file and was skipped: rename middleware.vsk to middleware.ts.'
    );
  }
  if (name === 'middleware.js') {
    return structureWarning(
      rel,
      'middleware must live in a TypeScript file: rename middleware.js to middleware.ts.'
    );
  }
  if (isApi && name === 'route.vsk') {
    return structureWarning(
      rel,
      'API routes must live in a TypeScript file and was skipped: rename route.vsk to route.ts.'
    );
  }
  if (isApi && name === 'route.js') {
    return structureWarning(
      rel,
      'API routes must be TypeScript (.ts): convert route.js to route.ts for typed request/response handling. Route was ignored.'
    );
  }
  return null;
}

function createTypecheckHost(projectRoot: string, appDir: string, vskFiles: Map<string, string>): ts.CompilerHost {
  const ambientPath = join(appDir, '__vesk_ambient.d.ts');
  const overridePath = join(appDir, '__vesk_runtime_override.d.ts');
  const cached = new Map<string, ts.SourceFile>();
  const scriptKindFor = (file: string): ts.ScriptKind =>
    file.endsWith('.vsk') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const host: ts.CompilerHost = {
    getSourceFile(file, langVersion, onError, shouldCreateNewSourceFile) {
      if (!shouldCreateNewSourceFile && cached.has(file)) return cached.get(file)!;
      let content: string | undefined;
      if (file === ambientPath) {
        content = AMBIENT;
      } else if (file === overridePath) {
        content = RUNTIME_OVERRIDE;
      } else if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        const src = vskFiles.get(vskPath) ?? (ts.sys.fileExists(vskPath) ? ts.sys.readFile(vskPath) : undefined);
        content = src !== undefined ? generateVskDts(src) : undefined;
      } else if (file.endsWith('.css.d.ts')) {
        content = '';
      } else if (vskFiles.has(file)) {
        content = vskToTsx(vskFiles.get(file)!);
      } else if (ts.sys.fileExists(file)) {
        content = ts.sys.readFile(file);
      }
      if (content === undefined) {
        if (onError) onError(`File not found: ${file}`);
        return undefined;
      }
      const sf = ts.createSourceFile(file, content, langVersion, true, scriptKindFor(file));
      cached.set(file, sf);
      return sf;
    },
    fileExists(file) {
      if (file === ambientPath) return true;
      if (file === overridePath) return true;
      if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        return vskFiles.has(vskPath) || ts.sys.fileExists(vskPath);
      }
      if (file.endsWith('.css.d.ts')) return true;
      if (vskFiles.has(file)) return true;
      return ts.sys.fileExists(file);
    },
    readFile(file) {
      if (file === ambientPath) return AMBIENT;
      if (file === overridePath) return RUNTIME_OVERRIDE;
      if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        const src = vskFiles.get(vskPath) ?? (ts.sys.fileExists(vskPath) ? ts.sys.readFile(vskPath) : undefined);
        return src !== undefined ? generateVskDts(src) : undefined;
      }
      if (file.endsWith('.css.d.ts')) return '';
      if (vskFiles.has(file)) return vskToTsx(vskFiles.get(file)!);
      return ts.sys.readFile(file);
    },
    writeFile: () => {},
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getDirectories: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(dir, d.name));
      } catch {
        return [];
      }
    },
    getCanonicalFileName: (f) => normalize(f),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n',
    resolveModuleNameLiterals(moduleLiterals, containingFile, redirectedReference, options) {
      return moduleLiterals.map(({ text }) => {
        if (text.endsWith('.vsk')) {
          const abs = normalize(join(dirname(containingFile), text));
          return {
            resolvedModule: {
              resolvedFileName: abs + '.d.ts',
              extension: ts.Extension.Dts,
              isExternalLibraryImport: false,
            },
            failedLookupLocations: [],
          };
        }
        if (text.endsWith('.css')) {
          const abs = normalize(join(dirname(containingFile), text));
          return {
            resolvedModule: {
              resolvedFileName: abs + '.d.ts',
              extension: ts.Extension.Dts,
              isExternalLibraryImport: false,
            },
            failedLookupLocations: [],
          };
        }
        const res = ts.resolveModuleName(text, containingFile, options, host);
        return { resolvedModule: res.resolvedModule, failedLookupLocations: [] };
      });
    },
  };
  return host;
}

export interface TypecheckResult {
  errors: TypecheckError[];
  warnings: TypecheckError[];
}

export function typecheckProject(projectRoot: string, opts: TypecheckOptions = {}): TypecheckResult {
  const appDir = opts.appDir ?? join(projectRoot, 'app');
  const vskFiles = new Map<string, string>();
  const parseErrors: TypecheckError[] = [];
  const warnings: TypecheckError[] = [];
  const walked = walkProjectFiles(projectRoot);
  const rootNames: string[] = [];
  for (const f of walked.js) {
    if (!isUnder(appDir, f)) continue;
    const warn = checkStructureFile(appDir, f);
    if (warn) warnings.push(warn);
  }
  for (const f of walked.code) {
    if (isUnder(appDir, f)) {
      const warn = checkStructureFile(appDir, f);
      if (warn) {
        warnings.push(warn);
        continue;
      }
    }
    if (f.endsWith('.vsk')) {
      const src = readFileSync(f, 'utf-8');
      try {
        parse(src);
      } catch (e) {
        parseErrors.push({
          file: relative(projectRoot, f),
          line: 1,
          column: 1,
          code: 'vesk-parse',
          message: `could not parse .vsk file: ${(e as Error).message}`,
        });
        continue;
      }
      vskFiles.set(f, src);
    }
    rootNames.push(f);
  }

  const ambientPath = join(appDir, '__vesk_ambient.d.ts');
  const overridePath = join(appDir, '__vesk_runtime_override.d.ts');
  rootNames.push(ambientPath);
  rootNames.push(overridePath);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: opts.strict !== false,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowImportingTsExtensions: true,
    allowNonTsExtensions: true,
    resolveJsonModule: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    allowJs: false,
  };

  const host = createTypecheckHost(projectRoot, appDir, vskFiles);
  const program = ts.createProgram({ rootNames, options, host });

  const rootSet = new Set(rootNames.map(normalize));
  const vskSet = new Set<string>();
  for (const p of vskFiles.keys()) vskSet.add(normalize(p));

  const errors: TypecheckError[] = [...parseErrors];
  for (const diag of ts.getPreEmitDiagnostics(program)) {
    const file = diag.file;
    if (!file) continue;
    let filePath = normalize(file.fileName);
    if (filePath.endsWith('.vsk.d.ts')) {
      filePath = filePath.slice(0, -'.d.ts'.length);
    }
    if (!rootSet.has(filePath) && !vskSet.has(filePath)) continue;
    const pos = file.getLineAndCharacterOfPosition(diag.start ?? 0);
    const code = typeof diag.code === 'number' ? `TS${diag.code}` : String(diag.code);
    errors.push({
      file: relative(projectRoot, filePath),
      line: pos.line + 1,
      column: pos.character + 1,
      code,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    });
  }

  return { errors, warnings };
}

export function formatTypecheckErrors(errors: TypecheckError[]): string {
  return errors
    .map((e) => `${e.file}(${e.line},${e.column}): ${e.code}: ${e.message}`)
    .join('\n');
}

export function formatTypecheckWarnings(warnings: TypecheckError[]): string {
  return warnings
    .map((w) => `${w.file}: ${w.code}: ${w.message}`)
    .join('\n');
}
