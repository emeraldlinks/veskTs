import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { compileVskCodegen, generateVskDts } from '@vesk/compiler/src/vsk-tsx';

export interface IntelligenceProgramOptions {
  projectRoot: string;
  appDir?: string;
  exclude?: string[];
}

export interface IntelligenceProgramResult {
  program: ts.Program;
  compilerOptions: ts.CompilerOptions;
  rootFiles: string[];
  projectFiles: string[];
  vskFiles: Map<string, string>;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.vsk'];
const IGNORED_DIRECTORIES = ['node_modules', 'dist', '.git', '.vesk', '.next', 'coverage', 'build'];

function matchesExcluded(relativePath: string, exclude: string[]): boolean {
  for (const pattern of exclude) {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) return true;
    } else if (relativePath === pattern || relativePath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

function collectProjectFiles(directory: string, projectRoot: string, exclude: string[]): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(directory, entry.name);
    const rel = relative(projectRoot, full);
    if (IGNORED_DIRECTORIES.includes(entry.name)) continue;
    if (matchesExcluded(rel, [...exclude, ...IGNORED_DIRECTORIES])) continue;
    if (entry.isDirectory()) {
      files.push(...collectProjectFiles(full, projectRoot, exclude));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(full);
  }
  return files;
}

function loadCompilerOptions(projectRoot: string, tsconfigPath: string): ts.CompilerOptions {
  const config = ts.readConfigFile(tsconfigPath, (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  });
  if (config.error) return defaultCompilerOptions();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot, undefined, tsconfigPath);
  return parsed.options;
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
  };
}

function createHost(projectRoot: string, vskFiles: Map<string, string>): ts.CompilerHost {
  const cached = new Map<string, ts.SourceFile>();
  const readVirtual = (file: string): string | undefined => {
    if (file.endsWith('.vsk.d.ts')) {
      const vskPath = file.slice(0, -'.d.ts'.length);
      const source = vskFiles.get(vskPath) ?? (ts.sys.fileExists(vskPath) ? ts.sys.readFile(vskPath) : undefined);
      return source === undefined ? undefined : generateVskDts(source);
    }
    if (file.endsWith('.css.d.ts')) return '';
    const vskSource = vskFiles.get(file);
    if (vskSource !== undefined) return compileVskCodegen(vskSource).code;
    return ts.sys.fileExists(file) ? ts.sys.readFile(file) : undefined;
  };

  const host: ts.CompilerHost = {
    getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile) {
      if (!shouldCreateNewSourceFile && cached.has(file)) return cached.get(file)!;
      const content = readVirtual(file);
      if (content === undefined) {
        if (onError) onError(`File not found: ${file}`);
        return undefined;
      }
      const kind = file.endsWith('.vsk') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(file, content, languageVersion, true, kind);
      cached.set(file, sourceFile);
      return sourceFile;
    },
    fileExists(file) {
      if (file.endsWith('.vsk.d.ts')) {
        const vskPath = file.slice(0, -'.d.ts'.length);
        return vskFiles.has(vskPath) || ts.sys.fileExists(vskPath);
      }
      if (file.endsWith('.css.d.ts')) return true;
      if (vskFiles.has(file)) return true;
      return ts.sys.fileExists(file);
    },
    readFile: readVirtual,
    writeFile: () => {},
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n',
    directoryExists: (directory) => ts.sys.directoryExists(directory),
    getDirectories: (directory) => {
      try {
        return readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(directory, entry.name));
      } catch {
        return [];
      }
    },
    resolveModuleNameLiterals(moduleLiterals, containingFile, redirectedReference, options) {
      return moduleLiterals.map((literal) => {
        const text = literal.text.endsWith('.vsk') ? `${literal.text.slice(0, -'.vsk'.length)}.vsk.d.ts` : literal.text;
        const resolved = ts.resolveModuleName(text, containingFile, options, host, undefined, redirectedReference);
        return { resolvedModule: resolved.resolvedModule };
      });
    },
  };
  return host;
}

export function createIntelligenceProgram(options: IntelligenceProgramOptions): IntelligenceProgramResult {
  const projectRoot = resolve(options.projectRoot);
  const appDir = options.appDir ? resolve(projectRoot, options.appDir) : join(projectRoot, 'app');
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const compilerOptions = ts.sys.fileExists(tsconfigPath) ? loadCompilerOptions(projectRoot, tsconfigPath) : defaultCompilerOptions();
  const searchRoot = ts.sys.directoryExists(appDir) ? appDir : projectRoot;
  const projectFiles = collectProjectFiles(searchRoot, projectRoot, options.exclude ?? []).sort();
  const vskFiles = new Map<string, string>();
  for (const file of projectFiles) {
    if (file.endsWith('.vsk')) vskFiles.set(file, readFileSync(file, 'utf8'));
  }
  const rootFiles = [
    ...projectFiles,
    ...[...vskFiles.keys()].map((file) => `${file}.d.ts`),
  ].sort();
  const host = createHost(projectRoot, vskFiles);
  const program = ts.createProgram(rootFiles, { ...compilerOptions, noEmit: true }, host);
  return { program, compilerOptions, rootFiles, projectFiles, vskFiles };
}
