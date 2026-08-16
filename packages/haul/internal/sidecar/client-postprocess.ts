import { tokenizer, tokTypes } from 'acorn';
import { parse } from '@vesk/compiler/src/parser';

export interface PostprocessClientResult {
  code: string;
  runtimeImports: string[];
}

interface Tok {
  type: any;
  value: any;
  start: number;
  end: number;
}

interface ScaffoldRange {
  start: number;
  end: number;
}

/**
 * Post-process compiled client component output produced by the compiler's
 * `compileClient`: strips the generated scaffolding (the `@vesk/runtime`
 * import plus `.vsk` imports, the `const __components = {};` declaration,
 * the `__cleanup`/`__place` helper functions and the trailing
 * `export ... __components[...]` lines) and collects the runtime import
 * names, using acorn token positions so user code bytes are untouched.
 * This replaces the regex-based `collectRuntimeImports`/`stripRuntimeImport`/
 * `stripVskImports`/`stripExports` used by the Go bundler. A tokenizer is
 * used instead of a full parse because the compiler's own output can
 * redeclare imported bindings (generated runtime import + a user import of
 * the same names), which a strict AST parse rejects.
 */
export function postprocessClientCode(source: string): PostprocessClientResult {
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    // The tokenizer can't lex raw JSX (`</p>` reads as a regex). Fall back to
    // a full AST parse, which handles JSX but rejects duplicate bindings —
    // those two failure modes don't overlap for real compiler output.
    return postprocessViaAst(source);
  }

  const runtimeImports: string[] = [];
  const seen = new Set<string>();
  const removed: ScaffoldRange[] = [];

  let depth = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (depth === 0 && t.type === tokTypes._import && i + 1 < tokens.length && tokens[i + 1].type !== tokTypes.parenL) {
      const end = scanImportEnd(tokens, i);
      const sourceStr = importSource(tokens, i, end);
      if (sourceStr === '@vesk/runtime') {
        for (const name of importSpecifierNames(tokens, i, end)) {
          if (!seen.has(name)) {
            seen.add(name);
            runtimeImports.push(name);
          }
        }
        removed.push({ start: t.start, end: tokens[end - 1].end });
      } else if (sourceStr && sourceStr.endsWith('.vsk')) {
        removed.push({ start: t.start, end: tokens[end - 1].end });
      }
      i = end;
      continue;
    }

    if (depth === 0 && t.type === tokTypes._function && i + 1 < tokens.length) {
      const nameTok = tokens[i + 1];
      if (nameTok.type === tokTypes.name && (nameTok.value === '__cleanup' || nameTok.value === '__place')) {
        const end = scanFunctionEnd(tokens, i);
        removed.push({ start: t.start, end: tokens[end - 1].end });
        i = end;
        continue;
      }
    }

    if (depth === 0 && (isDeclKeyword(t))) {
      const end = scanStmtEnd(tokens, i);
      if (isEmptyComponentsDecl(tokens, i, end)) {
        removed.push({ start: t.start, end: tokens[end - 1].end });
      }
      i = end;
      continue;
    }

    if (depth === 0 && t.type === tokTypes._export) {
      const end = scanStmtEnd(tokens, i);
      if (isComponentsExport(tokens, i, end)) {
        removed.push({ start: t.start, end: tokens[end - 1].end });
      }
      i = end;
      continue;
    }

    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
    i++;
  }

  if (removed.length === 0) {
    return { code: source, runtimeImports };
  }

  let code = source;
  removed.sort((a, b) => b.start - a.start);
  for (const r of removed) {
    let after = r.end;
    while (after < code.length && (code[after] === ' ' || code[after] === '\t' || code[after] === '\n' || code[after] === '\r')) {
      after++;
    }
    code = code.slice(0, r.start) + code.slice(after);
  }
  return { code, runtimeImports };
}

/**
 * Rewrites every `@vesk/runtime` import specifier (bare or subpath) in API
 * route sources to `'../runtime.js'` so the generated server/api functions
 * resolve against the bundled server runtime. Token-position based literal
 * replacement.
 */
export function rewriteRuntimeImportSources(source: string): string {
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    return rewriteRuntimeImportsViaAst(source);
  }

  const edits: Array<[number, number, string]> = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === tokTypes._import && i + 1 < tokens.length && tokens[i + 1].type !== tokTypes.parenL) {
      const end = scanImportEnd(tokens, i);
      const srcTok = importSourceToken(tokens, i, end);
      if (srcTok && isRuntimeSpecifier(srcTok.value)) {
        edits.push([srcTok.start, srcTok.end, "'../runtime.js'"]);
      }
      i = end;
      continue;
    }
    if (t.type === tokTypes._export) {
      const end = scanStmtEnd(tokens, i);
      const srcTok = exportFromSourceToken(tokens, i, end);
      if (srcTok && isRuntimeSpecifier(srcTok.value)) {
        edits.push([srcTok.start, srcTok.end, "'../runtime.js'"]);
      }
      i = end;
      continue;
    }
    i++;
  }

  if (edits.length === 0) return source;

  let code = source;
  edits.sort((a, b) => b[0] - a[0]);
  for (const [start, end, replacement] of edits) {
    code = code.slice(0, start) + replacement + code.slice(end);
  }
  return code;
}

function isRuntimeSpecifier(value: string): boolean {
  return value === '@vesk/runtime' || value.startsWith('@vesk/runtime/');
}

function tokenize(source: string): Tok[] {
  let tokens: Tok[] = [];
  try {
    const tok = tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module' });
    while (true) {
      tok.next();
      if (tok.type === tokTypes.eof) break;
      tokens.push({ type: tok.type, value: tok.value, start: tok.start, end: tok.end });
    }
  } catch {
    return [];
  }
  return tokens;
}

function isOpen(t: Tok): boolean {
  return (
    t.type === tokTypes.braceL ||
    t.type === tokTypes.bracketL ||
    t.type === tokTypes.parenL ||
    t.type === tokTypes.dollarBraceL
  );
}

function isClose(t: Tok): boolean {
  return t.type === tokTypes.braceR || t.type === tokTypes.bracketR || t.type === tokTypes.parenR;
}

// `const`/`var` tokenize as keywords; `let` is a contextual `name` token.
function isDeclKeyword(t: Tok): boolean {
  return (
    t.type === tokTypes._const || t.type === tokTypes._var || (t.type === tokTypes.name && t.value === 'let')
  );
}

// Ends just past the last token of the statement.
function scanStmtEnd(tokens: Tok[], start: number): number {
  let depth = 0;
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
    if (t.type === tokTypes.semi && depth <= 0) return i + 1;
  }
  return tokens.length;
}

// Import statements terminate at their module source string literal (with an
// optional trailing `;`), never later: source files omit the semicolon, and a
// brace-depth scan would overrun into the following statement (e.g. a
// `const x = {...};` block), corrupting removed ranges and specifier names.
function scanImportEnd(tokens: Tok[], start: number): number {
  let depth = 0;
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === tokTypes.string) {
      return i + 1;
    }
    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
    if (t.type === tokTypes.semi && depth <= 0) return i + 1;
  }
  return tokens.length;
}

// Function declarations end at the `}` that returns the brace depth to zero.
function scanFunctionEnd(tokens: Tok[], start: number): number {
  let depth = 0;
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (isOpen(t)) depth++;
    else if (isClose(t)) {
      depth--;
      if (t.type === tokTypes.braceR && depth === 0) return i + 1;
    }
  }
  return tokens.length;
}

function isFromToken(t: Tok): boolean {
  return t.type === tokTypes.name && t.value === 'from';
}

// The source string literal of an import statement (null for e.g. `import {x} from "y"` parsing failures).
function importSourceToken(tokens: Tok[], start: number, end: number): Tok | null {
  for (let i = start + 1; i < end; i++) {
    const t = tokens[i];
    if (t.type === tokTypes.string) {
      if (isFromToken(tokens[i - 1])) return t;
      if (i === start + 1) return t;
      return null;
    }
  }
  return null;
}

function importSource(tokens: Tok[], start: number, end: number): string | null {
  const t = importSourceToken(tokens, start, end);
  return t ? t.value : null;
}

// The `from "..."` source string literal of an export statement.
function exportFromSourceToken(tokens: Tok[], start: number, end: number): Tok | null {
  for (let i = start + 1; i + 1 < end; i++) {
    if (isFromToken(tokens[i]) && tokens[i + 1].type === tokTypes.string) {
      return tokens[i + 1];
    }
  }
  return null;
}

// Names imported from the module, taken before any `as` alias, skipping
// type-only specifiers. Mirrors the old collectRuntimeImports.
function importSpecifierNames(tokens: Tok[], start: number, end: number): string[] {
  const names: string[] = [];
  let inSpecs = false;
  let specStart = -1;
  for (let i = start + 1; i < end; i++) {
    const t = tokens[i];
    if (t.type === tokTypes.braceL) {
      inSpecs = true;
      specStart = i + 1;
      continue;
    }
    if (t.type === tokTypes.braceR) {
      collectSpecifierGroup(tokens, specStart, i, names);
      inSpecs = false;
      continue;
    }
    if (inSpecs && t.type === tokTypes.comma) {
      collectSpecifierGroup(tokens, specStart, i, names);
      specStart = i + 1;
    }
  }
  return names;
}

function collectSpecifierGroup(tokens: Tok[], start: number, end: number, out: string[]): void {
  let firstWord: string | null = null;
  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.type === tokTypes._typeof || (t.type === tokTypes.name && t.value === 'typeof')) return;
    if (t.type === tokTypes.name) {
      firstWord = t.value;
      break;
    }
  }
  if (firstWord === null) return;
  if (firstWord === 'type' || firstWord === 'typeof') return;
  out.push(firstWord);
}

// `const __components = {};` (also `__hydrators`).
function isEmptyComponentsDecl(tokens: Tok[], start: number, end: number): boolean {
  if (end - start !== 6) return false;
  if (tokens[start + 1].type !== tokTypes.name) return false;
  const id = tokens[start + 1].value;
  if (id !== '__components' && id !== '__hydrators') return false;
  if (tokens[start + 2].type !== tokTypes.eq) return false;
  if (tokens[start + 3].type !== tokTypes.braceL) return false;
  if (tokens[start + 4].type !== tokTypes.braceR) return false;
  return tokens[start + 5].type === tokTypes.semi;
}

// `export default __components[...];` or `export const X = __components[...];`.
function isComponentsExport(tokens: Tok[], start: number, end: number): boolean {
  if (tokens[start + 1].type === tokTypes._default) {
    return isComponentsRefAt(tokens, start + 2);
  }
  if (isDeclKeyword(tokens[start + 1])) {
    if (tokens[start + 2].type !== tokTypes.name) return false;
    if (tokens[start + 3].type !== tokTypes.eq) return false;
    return isComponentsRefAt(tokens, start + 4);
  }
  return false;
}

function isComponentsRefAt(tokens: Tok[], idx: number): boolean {
  if (idx + 1 >= tokens.length) return false;
  const t = tokens[idx];
  if (t.type !== tokTypes.name || t.value !== '__components') return false;
  return tokens[idx + 1].type === tokTypes.bracketL;
}

// ---- AST fallback paths (used when the tokenizer fails on raw JSX) ----

function spliceRanges(source: string, ranges: Array<{ start: number; end: number }>): string {
  ranges.sort((a, b) => b.start - a.start);
  let code = source;
  for (const r of ranges) {
    let after = r.end;
    while (after < code.length && (code[after] === ' ' || code[after] === '\t' || code[after] === '\n' || code[after] === '\r')) {
      after++;
    }
    code = code.slice(0, r.start) + code.slice(after);
  }
  return code;
}

function isComponentsRefExpr(expr: any): boolean {
  return (
    expr?.type === 'MemberExpression' &&
    expr.computed === true &&
    expr.object?.type === 'Identifier' &&
    expr.object.name === '__components'
  );
}

function isEmptyComponentsDeclAst(decl: any): boolean {
  if (!decl || decl.type !== 'VariableDeclaration' || decl.declarations?.length !== 1) return false;
  const d = decl.declarations[0];
  if (d.id?.type !== 'Identifier') return false;
  if (d.id.name !== '__components' && d.id.name !== '__hydrators') return false;
  return d.init?.type === 'ObjectExpression' && d.init.properties?.length === 0;
}

function postprocessViaAst(source: string): PostprocessClientResult {
  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return { code: source, runtimeImports: [] };
  }

  const runtimeImports: string[] = [];
  const seen = new Set<string>();
  const removed: Array<{ start: number; end: number }> = [];

  for (const stmt of ast.body ?? []) {
    if (!stmt || typeof stmt.start !== 'number') continue;
    if (stmt.type === 'ImportDeclaration') {
      const src = stmt.source?.value;
      if (src === '@vesk/runtime') {
        for (const spec of stmt.specifiers ?? []) {
          if (spec.type !== 'ImportSpecifier') continue;
          if (spec.importKind === 'type' || spec.importKind === 'typeof') continue;
          const name = spec.imported?.name;
          if (name && !seen.has(name)) {
            seen.add(name);
            runtimeImports.push(name);
          }
        }
        removed.push({ start: stmt.start, end: stmt.end });
      } else if (typeof src === 'string' && src.endsWith('.vsk')) {
        removed.push({ start: stmt.start, end: stmt.end });
      }
    } else if (stmt.type === 'VariableDeclaration') {
      if (isEmptyComponentsDeclAst(stmt)) removed.push({ start: stmt.start, end: stmt.end });
    } else if (stmt.type === 'FunctionDeclaration') {
      const name = stmt.id?.name;
      if (name === '__cleanup' || name === '__place') removed.push({ start: stmt.start, end: stmt.end });
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      if (isComponentsRefExpr(stmt.declaration)) removed.push({ start: stmt.start, end: stmt.end });
    } else if (stmt.type === 'ExportNamedDeclaration') {
      if (isComponentsNamedExport(stmt.declaration)) removed.push({ start: stmt.start, end: stmt.end });
    }
  }

  if (removed.length === 0) {
    return { code: source, runtimeImports };
  }
  return { code: spliceRanges(source, removed), runtimeImports };
}

function isComponentsNamedExport(decl: any): boolean {
  if (!decl || decl.type !== 'VariableDeclaration' || decl.declarations?.length !== 1) return false;
  return isComponentsRefExpr(decl.declarations[0]?.init);
}

function rewriteRuntimeImportsViaAst(source: string): string {
  let ast: any;
  try {
    ast = parse(source, {});
  } catch {
    return source;
  }

  const edits: Array<[number, number, string]> = [];
  for (const stmt of ast.body ?? []) {
    if (!stmt || typeof stmt.start !== 'number') continue;
    if (stmt.type !== 'ImportDeclaration' && stmt.type !== 'ExportNamedDeclaration' && stmt.type !== 'ExportAllDeclaration') continue;
    const src = stmt.source;
    if (src && isRuntimeSpecifier(src.value)) {
      edits.push([src.start, src.end, "'../runtime.js'"]);
    }
  }

  if (edits.length === 0) return source;
  edits.sort((a, b) => b[0] - a[0]);
  let code = source;
  for (const [start, end, replacement] of edits) {
    code = code.slice(0, start) + replacement + code.slice(end);
  }
  return code;
}
