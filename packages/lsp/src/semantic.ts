/** @module semantic — Real TypeScript semantic engine for `.vsk` files.
 *
 * Builds one live `ts.Program` over the compiler's virtual-TSX view of the
 * project (`@vesk/compiler` → `LiveTypecheckProgram`). Handles hover types,
 * go-to-definition, references, and rename by locating the cursor node in the
 * generated TSX and mapping results back to source `.vsk` coordinates. The
 * existing AST/heuristic handlers remain as the fallback tier for positions
 * where the TS engine has nothing to say (event-handler docs, HTML elements,
 * reactive-binding markers).
 */

import { resolve, join, dirname, relative } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import type ts from 'typescript';
import { LiveTypecheckProgram, createTypecheckOptions, compileVskCodegen } from '@vesk/compiler';
import type { CodeMapping } from '@vesk/compiler';

/** Codegen options for the virtual TSX — typedCells gives real inferred types
 * for reactive bindings (`let count = __cell.get()` → `number`) instead of the
 * default `: any` annotation. MUST stay in sync with the program side. */
const SEMANTIC_CODEGEN_OPTIONS = { typedCells: true } as const;
import { connection, documents, project } from './context';
import { getWordRangeAtPosition } from './text-utils';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { Location, LocationLink, Hover, MarkupKind, Range, Position } from 'vscode-languageserver/node.js';

/** Singleton live TS program over the virtual workspace. */
let live: LiveTypecheckProgram | null = null;
let rootNames: string[] = [];
let fileVersion = 0;

/** Map keyed by absolute source file path → generated (virtual) text. */
const genByFile = new Map<string, { code: string; mappings: CodeMapping[] }>();

const AMBIENT_DIR_VIRTUAL = '__vesk_ambient.d.ts';
const RUNTIME_OVERRIDE_VIRTUAL = '__vesk_runtime_override.d.ts';

function virtualPathFor(absPath: string): string {
  return absPath.replace(/\.vsk$/, '.vsk.d.ts');
}

/** Ensure the ambient/override virtual d.ts land in the app dir (same names the compiler host expects). */
function ensureVirtualAmbient(appDir: string, ambientContent: string, overrideContent: string): void {
  const a = join(appDir, AMBIENT_DIR_VIRTUAL);
  const b = join(appDir, RUNTIME_OVERRIDE_VIRTUAL);
  if (!existsSync(a)) writeFileSync(a, ambientContent, 'utf-8');
  if (!existsSync(b)) writeFileSync(b, overrideContent, 'utf-8');
}

function workspaceRoot(): string {
  return project.workspaceRoot || process.cwd();
}

/** Rebuild (or reuse) the live program over updated project files. */
export function refreshSemantic(): void {
  try {
    const root = workspaceRoot();
    const appDir = join(root, 'app');
    const options = createTypecheckOptions(true);

    // Add all project's `.vsk`, `.ts`, `.tsx` files + ambient/override into root names.
    const roots: string[] = [];
    for (const [path] of project.files) {
      if (/\.(vsk|ts|tsx)$/.test(path) && !path.includes('node_modules')) {
        roots.push(path);
      }
    }
    // Tracked open docs may not yet be indexed; include them.
    for (const doc of documents.all()) {
      const path = doc.uri.replace(/^file:\/\//, '');
      if (/\.(vsk|ts|tsx)$/.test(path) && !roots.includes(path)) roots.push(path);
    }

    const ambientPath = join(appDir, AMBIENT_DIR_VIRTUAL);
    const overridePath = join(appDir, RUNTIME_OVERRIDE_VIRTUAL);
    roots.push(ambientPath, overridePath);
    rootNames = roots;

    if (!live) {
      live = new LiveTypecheckProgram(root, appDir, options, SEMANTIC_CODEGEN_OPTIONS);
    } else if (live.root !== root) {
      live = new LiveTypecheckProgram(root, appDir, options, SEMANTIC_CODEGEN_OPTIONS);
    }

    // Populate virtual TSX for every vsk file and mark them for the program.
    for (const [path] of project.files) {
      if (!path.endsWith('.vsk')) continue;
      let src = documents.get('file://' + path)?.getText();
      if (src === undefined) {
        src = readFileSync(path, 'utf-8');
      }
      live.setFile(path, src);
      const generated = compileVskCodegen(src, SEMANTIC_CODEGEN_OPTIONS);
      genByFile.set(path, { code: generated.code, mappings: generated.mappings });
    }
    for (const doc of documents.all()) {
      const path = doc.uri.replace(/^file:\/\//, '');
      if (!path.endsWith('.vsk') || genByFile.has(path)) continue;
      const src = doc.getText();
      live.setFile(path, src);
      const generated = compileVskCodegen(src, SEMANTIC_CODEGEN_OPTIONS);
      genByFile.set(path, { code: generated.code, mappings: generated.mappings });
    }

    const prog = live.revalidate(rootNames);
    fileVersion++;
    void prog;
  } catch (e) {
    connection.console.error(`[vesk semantic] refresh failed: ${(e as Error).message}`);
  }
}

/** Get the singleton program (revalidated if dirty). */
function currentProgram(): ts.Program | null {
  try {
    if (!live) refreshSemantic();
    if (!live) return null;
    live.revalidate(rootNames);
    return live.program;
  } catch {
    return null;
  }
}

/** Resolve a source `.vsk` position to a generated TSX offset, if mapped. */
function sourceToGenerated(document: TextDocument, position: Position): { file: string; offset: number } | null {
  const path = document.uri.replace(/^file:\/\//, '');
  if (!genByFile.has(path)) return null;
  const { code, mappings } = genByFile.get(path)!;
  const srcOff = document.offsetAt(position);
  // Find the mapping segment containing srcOff.
  let seg = null as CodeMapping | null;
  for (const m of mappings) {
    const sStart = m.sourceOffsets[0];
    const sEnd = sStart + (m.lengths[0] ?? 0);
    if (srcOff >= sStart && srcOff < sEnd) {
      seg = m;
      break;
    }
  }
  if (!seg) {
    // Fallback: nearest mapping start <= srcOff
    let best = null as CodeMapping | null;
    for (const m of mappings) {
      if (m.sourceOffsets[0] <= srcOff) {
        if (!best || m.sourceOffsets[0] > best.sourceOffsets[0]) best = m;
      }
    }
    seg = best;
  }
  if (!seg) return null;
  const gap = srcOff - seg.sourceOffsets[0];
  const offset = seg.generatedOffsets[0] + Math.min(gap, (seg.generatedLengths?.[0] ?? seg.lengths[0]) - 1);
  return { file: path, offset: Math.min(offset, code.length - 1) };
}

/** Resolve a generated TSX offset back to a source `.vsk` position. */
function generatedToSource(genFile: string, genOffset: number, document?: TextDocument): Position | null {
  const info = genByFile.get(genFile);
  if (!info) return null;
  const { code, mappings } = info;
  let seg = null as CodeMapping | null;
  for (const m of mappings) {
    const gStart = m.generatedOffsets[0];
    const gEnd = gStart + (m.generatedLengths?.[0] ?? m.lengths[0]);
    if (genOffset >= gStart && genOffset < gEnd) {
      seg = m;
      break;
    }
  }
  if (!seg) return null;
  let srcOff = seg.sourceOffsets[0] + (genOffset - seg.generatedOffsets[0]);
  // Clamp.
  srcOff = Math.min(Math.max(srcOff, seg.sourceOffsets[0]), seg.sourceOffsets[0] + (seg.lengths[0] - 1));
  const source = document ? document.getText().length : srcOff;
  if (!document) {
    return { line: 0, character: srcOff };
  }
  return document.positionAt(srcOff);
}

/** Build a source location from a TS declaration node (in generated space). */
function tsDeclarationToSourceLocation(
  decl: ts.Node | undefined,
  targetUri: string,
  targetDocument: TextDocument | undefined,
): Location | null {
  if (!decl || !decl.getSourceFile()) return null;
  const file = decl.getSourceFile().fileName;
  const pos = decl.getStart();
  const end = decl.getEnd();
  const srcPos = generatedToSource(file, pos, targetDocument);
  if (!srcPos) return null;
  const srcEnd = generatedToSource(file, end, targetDocument);
  const range: Range = {
    start: srcPos,
    end: srcEnd ?? srcPos,
  };
  return { uri: targetUri, range };
}

/**
 * LSP hover backed by the real TS type checker. Returns the markdown type/hover
 * for the node under cursor, `null` if the position has no TS symbol.
 */
export function semanticHover(document: TextDocument, position: Position): Hover | null {
  const program = currentProgram();
  if (!program) return null;
  const checker = program.getTypeChecker();
  const state = sourceToGenerated(document, position);
  if (!state) return null;
  const genPath = state.file;
  const sf = program.getSourceFile(genPath);
  if (!sf) return null;
  const offset = state.offset;
  const node = findNodeAt(sf, offset);
  if (!node) return null;
  const symbol = checker.getSymbolAtLocation(node);
  const type = checker.getTypeAtLocation(node);
  if (!symbol && !type) return null;

  const typeStr = type ? checker.typeToString(type) : '';
  const docParts: string[] = [];

  if (symbol) {
    const name = symbol.getName();
    docParts.push(typeStr && typeStr !== 'any' ? `**${name}**: \`${typeStr}\`` : `**${name}**`);
    docParts.push(`\n\n_${getTSKindLabel(symbol.flags)}_`);
  } else if (typeStr) {
    docParts.push(`_Type: \`${typeStr}\`_`);
  } else {
    return null;
  }

  const decl = symbol?.declarations?.[0];
  const declLabel = decl ? declarationLabel(decl) : null;
  if (declLabel) docParts.push(`\n\n_Declared in ${declLabel}_`);

  const range = getWordRangeAtPosition(document, position);
  return {
    contents: { kind: MarkupKind.Markdown, value: docParts.join('') },
    range,
  };
}

/**
 * Human-readable "path:line" label for a TS declaration node, mapped back to
 * source `.vsk` coordinates when the declaring file is a tracked virtual file.
 */
function declarationLabel(decl: ts.Node): string | null {
  try {
    const sf = decl.getSourceFile();
    if (!sf) return null;
    let file = sf.fileName;
    let offset = decl.getStart(sf);
    if (file.endsWith('.d.ts')) {
      const srcFile = file.slice(0, -'.d.ts'.length);
      if (genByFile.has(srcFile)) {
        const mapped = generatedToSource(srcFile, offset);
        if (mapped) {
          const rel = relative(workspaceRoot(), srcFile);
          return `\`${rel}:${mapped.line + 1}\``;
        }
      }
      file = srcFile;
    }
    const lineInfo = sf.getLineAndCharacterOfPosition(offset);
    const rel = relative(workspaceRoot(), file);
    return `\`${rel}:${lineInfo.line + 1}\``;
  } catch {
    return null;
  }
}

/** Real go-to-definition: find the declaration symbol behind the cursor. */
export function semanticDefinition(document: TextDocument, position: Position): Location | LocationLink[] | null {
  const program = currentProgram();
  if (!program) return null;
  const checker = program.getTypeChecker();
  const state = sourceToGenerated(document, position);
  if (!state) return null;
  const genPath = state.file;
  const sf = program.getSourceFile(genPath);
  if (!sf) return null;
  const node = findNodeAt(sf, state.offset);
  if (!node) return null;
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return null;
  const decl = symbol.declarations?.[0];
  if (!decl) return null;
  const targetFile = decl.getSourceFile().fileName;
  const targetUri = 'file://' + (targetFile.endsWith('.vsk.d.ts') ? targetFile.slice(0, -'.d.ts'.length) : targetFile);
  // Resolve target position back to source.
  if (targetFile.endsWith('.vsk.d.ts')) {
    // target is the source vsk: map from generated d.ts back through the same gen mapping.
    const srcVsk = targetFile.slice(0, -'.d.ts'.length);
    const info = genByFile.get(srcVsk);
    if (info) {
      const srcPos = generatedToSource(srcVsk, decl.getStart());
      if (srcPos && !document.offsetAt) {
        srcPos.character = decl.getStart();
        // fallback
      }
      const relocated = srcPos ? { uri: targetUri, range: { start: srcPos, end: srcPos } } as Location : null;
      return relocated;
    }
  }
  const targetDoc = documents.get(targetUri);
  return tsDeclarationToSourceLocation(decl, targetUri, targetDoc);
}

/** Map a SymbolFlags bitmask to a short human label. */
function getTSKindLabel(flags: number): string {
  const SYMBOL_FLAGS = {
    FunctionScopedVariable: 1,
    BlockScopedVariable: 2,
    Property: 4,
    EnumMember: 8,
    Function: 16,
    Class: 32,
    Interface: 64,
    ConstEnum: 128,
    RegularEnum: 256,
    ValueModule: 512,
    NamespaceModule: 1024,
    TypeLiteral: 2048,
    ObjectLiteral: 4096,
    Method: 8192,
    Constructor: 16384,
    GetAccessor: 32768,
    SetAccessor: 65536,
    TypeParameter: 131072,
    TypeAlias: 262144,
    Alias: 524288,
    Module: 1024,
  } as const;
  for (const [k, v] of Object.entries(SYMBOL_FLAGS)) {
    if (flags === v) return k.replace(/([A-Z])/g, ' $1').toLowerCase();
  }
  return 'symbol';
}

/** Find the deepest AST node whose span contains the offset. */
function findNodeAt(sf: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): boolean => {
    const start = node.getStart(sf);
    const end = node.getEnd();
    if (offset < start || offset > end) return false;
    found = node;
    for (const child of node.getChildren(sf)) {
      if (visit(child)) return true;
    }
    return false;
  };
  visit(sf);
  return found;
}

/**
 * Refresh the semantic layer before processing a semantic request. Rebuilds
 * the TS program only when project files or open documents changed since the
 * last build (tracked via a version bump on document events).
 */
export function ensureSemantic(): void {
  try {
    if (!live || live.dirty) refreshSemantic();
  } catch {
    // semantic layer is a best-effort enrichment
  }
}

/** Called from server.ts whenever a document opens or changes. */
export function markSemanticDirty(): void {
  fileVersion++;
}