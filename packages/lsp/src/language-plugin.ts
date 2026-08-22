/**
 * Vesk language plugin — turns `.vsk` source into a virtual TSX document via
 * `compileVskCodegen`, with generated↔source mappings and embedded CSS codes.
 */

import type {
  CodeMapping as VolarCodeMapping,
  IScriptSnapshot,
  LanguagePlugin,
  VirtualCode,
} from '@volar/language-core';
import ts from 'typescript';
import { URI } from 'vscode-uri';
import { compileVskCodegen } from '@vesk/compiler';
import type { VskCodegenError, CodeMapping as CompilerCodeMapping } from '@vesk/compiler';
import { createLogging } from './utils';

const { log, logError, logWarning } = createLogging('[Vesk Language Plugin]');

/** Source offset of the `&[name]` in `const &[name] = track(...)` (reactive-binding decls). */
const REACTIVE_DECL_PATTERN = /(?:^|\n)\s*const\s+&\[([\w$]+)/g;

/**
 * Default compiler options for the virtual TSX program. The fixture app has no
 * tsconfig, so these defaults make sure JSX and the DOM lib are enabled.
 */
export const resolveConfig = <T extends { options?: any }>(
  config: T,
): T & { options: ts.CompilerOptions } => {
  const baseOptions = config.options ?? ({} as ts.CompilerOptions);
  const options: ts.CompilerOptions = { ...baseOptions };

  if (options.target === undefined) {
    options.target = ts.ScriptTarget.ESNext;
  }
  if (options.jsx === undefined) {
    options.jsx = ts.JsxEmit.Preserve;
  }
  // Match `vesk typecheck`: don't auto-include every @types/* package from
  // node_modules (Node typings would flood completion lists with Buffer /
  // process / require at JSX positions). Users can still opt in via their
  // tsconfig "types" array.
  if (!options.types) {
    options.types = [];
  }
  // NOTE: no jsxImportSource default. The virtual code keeps JSX verbatim and
  // element typing comes from the global `JSX.IntrinsicElements` declared in
  // @vesk/compiler's AMBIENT file (injected by server.ts) — exactly like
  // `vesk typecheck`. Defaulting jsxImportSource here made TS hunt for
  // '@vesk/runtime/jsx-runtime' types that don't exist, producing TS2875
  // ("This JSX tag requires the module path…") in every editor session.

  const normalizeLibName = (libName: string): string | undefined => {
    if (typeof libName !== 'string' || libName.length === 0) {
      return undefined;
    }
    const trimmed = libName.trim();
    // Already a resolved path (e.g. from getDefaultLibFileName) — keep it
    // verbatim so repeated resolution never mangles it.
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return trimmed;
    }
    if (trimmed.startsWith('lib.')) {
      return trimmed.toLowerCase();
    }
    return `lib.${trimmed.toLowerCase().replace(/\s+/g, '').replace(/_/g, '.')}.d.ts`;
  };

  const normalizedLibs = new Set(
    (options.lib ?? []).map(normalizeLibName).filter((lib): lib is string => typeof lib === 'string'),
  );

  // ALWAYS union in an ES + DOM baseline. Two failure modes are covered:
  // - No tsconfig / no lib: without this the program would have no globals at
  //   all (`Error`, `console`, `Promise` → TS2304).
  // - A tsconfig whose `lib` omits ES entries (e.g. ["DOM"]): real tsc would
  //   honour that, but .vsk is a browser-first superset of TS — code like
  //   `throw new Error(...)` must always resolve, so we mirror what
  //   `vesk typecheck` guarantees (es2022 chain + DOM + DOM.Iterable).
  const host = ts.createCompilerHost(options);
  const rawDefaultLib = host.getDefaultLibFileName(options);
  const defaultLibFile =
    rawDefaultLib.split(/[\\/]/).pop() ?? rawDefaultLib;
  normalizedLibs.add(normalizeLibName(defaultLibFile)!);
  normalizedLibs.add('lib.dom.d.ts');
  normalizedLibs.add('lib.dom.iterable.d.ts');
  options.lib = [...normalizedLibs];

  return {
    ...config,
    options,
  };
};

function isVeskFile(fileName: string): boolean {
  return fileName.endsWith('.vsk');
}

/**
 * Accept both spellings of the language id: VS Code sends the contributed
 * grammar id `'vsk'` for opened documents, while this plugin's own
 * `getLanguageId` answers `'vesk'` for files that are not open. Volar passes
 * whichever it resolved straight into `createVirtualCode`, so both must map
 * to a virtual code or every opened file silently loses all features.
 */
function isVeskLanguage(languageId: string): boolean {
  return languageId === 'vsk' || languageId === 'vesk';
}

/**
 * @implements {VirtualCode}
 */
export class VeskVirtualCode implements VirtualCode {
  /** Compiler mappings (source↔generated) with vesk customData. */
  compilerMappings: CompilerCodeMapping[] = [];
  id = 'root';
  // Generated code is TSX. Must be a value volar-service-typescript's
  // isTsDocument() accepts ('javascript'|'typescript'|'javascriptreact'|
  // 'typescriptreact'), otherwise TS-backed features like document symbols
  // silently bail. Source files stay 'vsk'/'vesk' via the plugin routing.
  languageId = 'typescriptreact';
  codegenStacks: unknown[] = [];
  fileName: string;
  generatedCode = '';
  embeddedCodes: VirtualCode[] = [];
  mappings: VolarCodeMapping[] = [];
  fatalErrors: VskCodegenError[] = [];
  snapshot: IScriptSnapshot;
  sourceSnapshot: IScriptSnapshot;
  originalCode = '';
  private mappingGenToSource: Map<string, CompilerCodeMapping> | null = null;
  private mappingSourceToGen: Map<string, CompilerCodeMapping> | null = null;
  /** Last successfully compiled state — served during transient fatal states. */
  private lastGood: {
    generatedCode: string;
    compilerMappings: CompilerCodeMapping[];
    styleRegions: { start: number; end: number; content: string }[];
  } | null = null;

  constructor(fileName: string, snapshot: IScriptSnapshot) {
    this.fileName = fileName;
    this.snapshot = snapshot;
    this.sourceSnapshot = snapshot;
    this.originalCode = snapshot.getText(0, snapshot.getLength());
    this.update(snapshot);
  }

  update(snapshot: IScriptSnapshot): void {
    const newCode = snapshot.getText(0, snapshot.getLength());
    const changeRange = snapshot.getChangeRange(this.sourceSnapshot);
    this.sourceSnapshot = snapshot;

    this.mappingGenToSource = null;
    this.mappingSourceToGen = null;
    this.fatalErrors = [];

    const result = compileVskCodegen(newCode, { typedCells: true });

    const hasErrors = result.errors.length > 0;

    if (!hasErrors) {
      this.originalCode = newCode;
      this.generatedCode = result.code;
      this.compilerMappings = result.mappings ?? [];
      this.mappings = (result.mappings ?? []) as unknown as VolarCodeMapping[];
      this.embeddedCodes = this.createCssEmbeddedCodes(result.styleRegions);
      this.lastGood = {
        generatedCode: result.code,
        compilerMappings: result.mappings ?? [],
        styleRegions: result.styleRegions,
      };

      log(
        `Compiled ${this.fileName}: ${this.generatedCode.length} generated chars, ${this.mappings.length} mappings`,
      );
    } else if (this.lastGood) {
      // Transient error state (mid-typing an incomplete tag/expression): the
      // compiler still returns a PARTIAL code string here, but serving it
      // degrades completions/hover to scope-global junk over half-valid TSX.
      // Keep serving the last successfully compiled virtual code instead so
      // language features stay sane; the compile error itself is still
      // surfaced via fatalErrors (compileErrors plugin).
      logWarning(
        `Vesk compilation failed transiently for ${this.fileName} — keeping last good virtual code (${result.errors.length} errors)`,
      );
      this.originalCode = newCode;
      this.generatedCode = this.lastGood.generatedCode;
      this.compilerMappings = this.lastGood.compilerMappings;
      this.mappings = this.lastGood.compilerMappings as unknown as VolarCodeMapping[];
      this.fatalErrors = result.errors;
      this.embeddedCodes = this.createCssEmbeddedCodes(this.lastGood.styleRegions);
    } else if (typeof result.code === 'string') {
      // Broken on first open (no prior good state): serve the partial
      // generated code so TS surfaces the broken construct, keep completion
      // enabled so the user can still fix it.
      logWarning(
        `Vesk compilation failed for ${this.fileName} — using partial code (${result.errors.length} errors)`,
      );
      this.originalCode = newCode;
      this.generatedCode = result.code;
      this.compilerMappings = result.mappings ?? [];
      this.mappings = (result.mappings ?? []) as unknown as VolarCodeMapping[];
      this.fatalErrors = result.errors;
      this.embeddedCodes = this.createCssEmbeddedCodes(result.styleRegions ?? []);
    } else {
      // Total failure with no prior good state: feed the raw source back.
      logWarning(`Vesk compilation failed for ${this.fileName}`);
      this.originalCode = newCode;
      this.generatedCode = newCode;
      this.compilerMappings = [
        {
          sourceOffsets: [0],
          generatedOffsets: [0],
          lengths: [newCode.length],
          generatedLengths: [newCode.length],
          data: { completion: true, verification: true, customData: {} },
        },
      ];
      this.mappings = this.compilerMappings as unknown as VolarCodeMapping[];
      this.fatalErrors = result.errors;
      this.embeddedCodes = [];
    }

    this.snapshot = {
      getText: (start, end) => this.generatedCode.substring(start, end),
      getLength: () => this.generatedCode.length,
      getChangeRange: () => undefined,
    };

    // Keep changeRange-based incremental updates for callers that care.
    void changeRange;
  }

  private createCssEmbeddedCodes(styleRegions: { start: number; end: number; content: string }[]): VirtualCode[] {
    return styleRegions.map((region, index) => {
      const mapping: VolarCodeMapping = {
        sourceOffsets: [region.start],
        generatedOffsets: [0],
        lengths: [region.content.length],
        generatedLengths: [region.content.length],
        data: {
          verification: true,
          completion: true,
          semantic: true,
          navigation: true,
          structure: true,
          format: false,
        },
      };
      return {
        id: `style_${index}`,
        languageId: 'css',
        snapshot: {
          getText: (start, end) => region.content.substring(start, end),
          getLength: () => region.content.length,
          getChangeRange: () => undefined,
        },
        mappings: [mapping],
        embeddedCodes: [],
      };
    });
  }

  private buildMappingCache(): void {
    if (this.mappingGenToSource || this.mappingSourceToGen) {
      return;
    }
    this.mappingGenToSource = new Map();
    this.mappingSourceToGen = new Map();
    for (const mapping of this.compilerMappings) {
      const genStart = mapping.generatedOffsets[0];
      const genLength = mapping.generatedLengths?.[0] ?? mapping.lengths[0];
      this.mappingGenToSource.set(`${genStart}-${genStart + genLength}`, mapping);
      const sourceStart = mapping.sourceOffsets[0];
      const sourceLength = mapping.lengths[0];
      this.mappingSourceToGen.set(`${sourceStart}-${sourceStart + sourceLength}`, mapping);
    }
  }

  findMappingByGeneratedRange(start: number, end: number): CompilerCodeMapping | null {
    this.buildMappingCache();
    return this.mappingGenToSource?.get(`${start}-${end}`) ?? null;
  }

  findMappingBySourceRange(start: number, end: number): CompilerCodeMapping | null {
    this.buildMappingCache();
    return this.mappingSourceToGen?.get(`${start}-${end}`) ?? null;
  }

  findGeneratedRangeBySourceRange(start: number, end: number): [number, number] | null {
    let first: CompilerCodeMapping | null = null;
    let last: CompilerCodeMapping | null = null;
    for (const mapping of this.compilerMappings) {
      const sourceStart = mapping.sourceOffsets[0];
      const sourceEnd = sourceStart + mapping.lengths[0];
      if (sourceEnd <= start || sourceStart >= end) {
        continue;
      }
      if (!first || sourceStart < first.sourceOffsets[0]) {
        first = mapping;
      }
      if (!last || sourceEnd > last.sourceOffsets[0] + last.lengths[0]) {
        last = mapping;
      }
    }
    if (!first || !last) {
      return null;
    }
    const generatedStart =
      first.generatedOffsets[0] +
      Math.min(Math.max(start - first.sourceOffsets[0], 0), first.generatedLengths?.[0] ?? first.lengths[0]);
    const generatedEnd =
      last.generatedOffsets[0] +
      Math.min(Math.max(end - last.sourceOffsets[0], 0), last.generatedLengths?.[0] ?? last.lengths[0]);
    return [generatedStart, Math.max(generatedEnd, generatedStart + 1)];
  }

  /**
   * Map a position in the GENERATED virtual code back to the corresponding
   * position in the ORIGINAL .vsk source. Prefers the smallest (most precise)
   * mapping containing the offset so coarse whole-region chunks don't smear
   * positions across collapsed/reordered generated code. Returns null when
   * nothing covers the offset.
   */
  generatedOffsetToSourceOffset(genOffset: number): number | null {
    let best: CompilerCodeMapping | null = null;
    let bestGeneratedLength = Number.POSITIVE_INFINITY;
    for (const mapping of this.compilerMappings) {
      const genStart = mapping.generatedOffsets[0];
      const genLength = mapping.generatedLengths?.[0] ?? mapping.lengths[0];
      if (genOffset < genStart || genOffset > genStart + genLength) {
        continue;
      }
      if (genLength < bestGeneratedLength) {
        bestGeneratedLength = genLength;
        best = mapping;
      }
    }
    if (!best) {
      return null;
    }
    const delta = genOffset - best.generatedOffsets[0];
    const sourceLength = best.lengths[0];
    return best.sourceOffsets[0] + Math.min(delta, sourceLength);
  }
}

/**
 * Reactive binding names declared in the source, e.g. `const &[count] = track(0)`.
 */
export function scanReactiveBindings(source: string): string[] {
  const names: string[] = [];
  REACTIVE_DECL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REACTIVE_DECL_PATTERN.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Component tag usages, e.g. `<Card`, `<Typed`, `<Link` — lowercase intrinsic
 * tags are excluded.
 */
export function scanComponentUsages(source: string): Map<string, { attrs: Set<string>; count: number }> {
  const usages = new Map<string, { attrs: Set<string>; count: number }>();
  const tagPattern = /<([A-Z][\w$]*)(?:\s|\/|>)/g;
  const attrPattern = /[\w$]+(?=\s*=\s*(?:"[^"]*"|'[^']*'|\{))/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const name = match[1];
    if (!usages.has(name)) {
      usages.set(name, { attrs: new Set(), count: 0 });
    }
    const usage = usages.get(name)!;
    usage.count++;
    const tagStart = match.index;
    // Scan attributes within this single tag only. lastIndex must be relative
    // to `segment`, not to `source`: exec() runs against the slice.
    attrPattern.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    const end = source.indexOf('>', tagStart);
    const segment = source.slice(tagStart, end === -1 ? tagStart + match[0].length + 200 : end + 1);
    while ((attrMatch = attrPattern.exec(segment)) !== null) {
      usage.attrs.add(attrMatch[0]);
    }
  }
  return usages;
}

/**
 * @returns {LanguagePlugin<URI>}
 */
export function getVeskLanguagePlugin(): LanguagePlugin<URI> {
  return {
    getLanguageId(fileNameOrUri: URI | string): string | undefined {
      const fileName =
        typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath.replace(/\\/g, '/');
      if (isVeskFile(fileName)) {
        return 'vesk';
      }
    },
    createVirtualCode(fileNameOrUri: URI | string, languageId: string, snapshot: IScriptSnapshot): VirtualCode | undefined {
      if (isVeskLanguage(languageId)) {
        const fileName =
          typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath.replace(/\\/g, '/');
        try {
          return new VeskVirtualCode(fileName, snapshot);
        } catch (err) {
          logError('Failed to create virtual code for:', fileName, err);
          throw err;
        }
      }
      return undefined;
    },
    updateVirtualCode(
      fileNameOrUri: URI | string,
      virtualCode: VirtualCode,
      snapshot: IScriptSnapshot,
    ): VirtualCode | undefined {
      if (virtualCode instanceof VeskVirtualCode) {
        virtualCode.update(snapshot);
        return virtualCode;
      }
      return undefined;
    },
    typescript: {
      extraFileExtensions: [
        {
          extension: 'vsk',
          isMixedContent: false,
          scriptKind: ts.ScriptKind.TSX,
        },
      ],
      getServiceScript(rootCode: VirtualCode) {
        if (rootCode instanceof VeskVirtualCode) {
          return {
            code: rootCode,
            extension: '.tsx',
            scriptKind: ts.ScriptKind.TSX,
          };
        }
        return undefined;
      },
    },
  };
}
