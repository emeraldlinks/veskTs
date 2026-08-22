import { parse } from '@vesk/compiler/src/parser';
import { getPropsType } from '@vesk/compiler/src/ir-generator';
import {
  skipWhitespace,
  findBalancedEnd,
  splitTopLevel,
  startsWithIdentifier,
  stripDeclKeyword,
  stripTrailingSemicolons,
  isWhitespaceChar,
  isIdentStart,
  isIdentChar,
  htmlTagEnd,
  collapseNewlineWhitespace,
} from '@vesk/compiler/src/scan';
import { containsIdentifier, isIdentifierImported } from '@vesk/compiler/src/tokens';

/**
 * Segment-based TSX codegen. `vskToTsx` remains the byte-identical string
 * transform used by the typechecker; `compileVskCodegen` additionally
 * records `CodeMapping`s (source offset -> generated offset) so the
 * Volar-based LSP can map positions, hover, completions and diagnostics
 * between the user's `.vsk` source and the virtual TSX file TS actually
 * analyzes. Synthetic text (braces, semicolons, `.map` scaffolding) is
 * emitted without a mapping; verbatim user text is mapped 1:1.
 */

export interface CodeInfo {
  verification?: boolean;
  completion?: boolean | { isAdditional?: boolean };
  semantic?: boolean | { shouldHighlight?: boolean; shouldRename?: boolean };
  navigation?: boolean | { shouldRename?: boolean; resolveRenameNewName?: (newName: string) => string };
  structure?: boolean;
  format?: boolean;
  customData?: Record<string, unknown>;
}

export interface CodeMapping {
  sourceOffsets: number[];
  generatedOffsets: number[];
  lengths: number[];
  generatedLengths?: number[];
  data: CodeInfo;
}

export interface StyleRegion {
  /** Source range of the whole `<style>` element. */
  start: number;
  end: number;
  /** The CSS text between the opening and closing tags. */
  content: string;
}

export interface VskCodegenError {
  message: string;
  start: number;
  end: number;
}

export interface VskCodegenOptions {
  /**
   * When set, `&[count] = track(...)` declarations rewrite to
   * `const __cell = track(...); let count = __cell.get(); let rawCell =
   * __cell;` so TypeScript infers the cell's value type (hover shows
   * `number`, not `any`). Only used by the LSP — `vskToTsx` keeps the
   * plain `let count: any = ...` form.
   */
  typedCells?: boolean;
}

export interface VskCodegenResult {
  code: string;
  mappings: CodeMapping[];
  styleRegions: StyleRegion[];
  errors: VskCodegenError[];
}

const FULL_DATA: CodeInfo = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
};

const REACTIVE_DATA: CodeInfo = { ...FULL_DATA, customData: { vesk: { reactive: true } } };

class VskGen {
  code = '';
  mappings: CodeMapping[] = [];
  styleRegions: StyleRegion[] = [];
  /** Counts track-decl rewrites so typedCells cell names stay unique within a codegen run. */
  cellCount = 0;

  /** Appends `text`; when a source range is given, records a mapping. */
  add(text: string, srcStart?: number, srcEnd?: number, data: CodeInfo = FULL_DATA): void {
    const start = this.code.length;
    this.code += text;
    if (text.length > 0 && srcStart !== undefined && srcEnd !== undefined && srcEnd > srcStart) {
      this.mappings.push({
        sourceOffsets: [srcStart],
        generatedOffsets: [start],
        lengths: [srcEnd - srcStart],
        generatedLengths: [text.length],
        data,
      });
    }
  }

  /** Appends synthetic text with no source mapping. */
  addRaw(text: string): void {
    this.code += text;
  }

  prepend(text: string): void {
    this.code = text + this.code;
    for (const m of this.mappings) {
      m.generatedOffsets = m.generatedOffsets.map((o) => o + text.length);
    }
  }

  recordStyle(start: number, end: number, content: string): void {
    this.styleRegions.push({ start, end, content });
  }
}

function getComponents(ast: any): Array<{ node: any; exported: boolean; defaultExport: boolean; start: number }> {
  const out: Array<{ node: any; exported: boolean; defaultExport: boolean; start: number }> = [];
  for (const stmt of ast.body || []) {
    if (stmt.type === 'ComponentDeclaration') {
      out.push({ node: stmt, exported: false, defaultExport: false, start: stmt.start });
    } else if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'ComponentDeclaration') {
      out.push({ node: stmt.declaration, exported: true, defaultExport: false, start: stmt.start });
    } else if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration?.type === 'ComponentDeclaration') {
      out.push({ node: stmt.declaration, exported: true, defaultExport: true, start: stmt.start });
    }
  }
  return out;
}

interface ForClauseAnnotation {
  kind: string;
  clauseStart: number;
  clauseEnd: number;
}

function blankForClauses(source: string, ast: any): string {
  const annotations = (ast as { __vskAnnotations?: ForClauseAnnotation[] }).__vskAnnotations ?? [];
  let out = source;
  for (const ann of annotations) {
    if (ann.kind !== 'for-clause') continue;
    out = out.slice(0, ann.clauseStart) + ' '.repeat(ann.clauseEnd - ann.clauseStart) + out.slice(ann.clauseEnd);
  }
  return out;
}

function extractForHeader(text: string): string | null {
  if (!startsWithIdentifier(text, 'for')) return null;
  const i = skipWhitespace(text, 3);
  if (text[i] !== '(') return null;
  const end = findBalancedEnd(text, i);
  return text.slice(i + 1, end);
}

function getJSXTagName(el: any): string | null {
  const name = el?.openingElement?.name ?? el?.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return name.object.name + '.' + name.property.name;
  if (name.type === 'JSXNamespacedName') return name.namespace.name + ':' + name.name.name;
  return null;
}

/** Collapses newline+whitespace runs to single spaces and records the raw index of every kept character. */
function collapseWithMap(value: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === '\n') {
      out += ' ';
      map.push(i);
      while (i < value.length && isWhitespaceChar(value[i])) i++;
      continue;
    }
    out += c;
    map.push(i);
    i++;
  }
  return { text: out, map };
}

function isStatementMode(node: any): boolean {
  const stmts = node.body?.body ?? [];
  return !(stmts.length === 1 && stmts[0].type === 'ReturnStatement');
}

/** Index of the first whole-word occurrence of `word` in `text`, or -1. */
function findFirstKeyword(text: string, word: string): number {
  let i = 0;
  while (i < text.length) {
    if (isIdentStart(text[i])) {
      let j = i + 1;
      while (j < text.length && isIdentChar(text[j])) j++;
      if (text.slice(i, j) === word) return i;
      i = j;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Removes a trailing `client` keyword (plus surrounding whitespace) from a
 * component header, replacing it with a single trailing space. Returns the
 * kept text and the length of the source range it covers.
 */
function stripTrailingClientRange(text: string): { text: string; end: number } {
  let end = text.length;
  while (end > 0 && isWhitespaceChar(text[end - 1])) end--;
  let wordStart = end;
  while (wordStart > 0 && isIdentChar(text[wordStart - 1])) wordStart--;
  if (text.slice(wordStart, end) === 'client') {
    return { text: text.slice(0, wordStart).trimEnd() + ' ', end: wordStart };
  }
  return { text, end: text.length };
}

/** Index of the first depth-0 whole-word occurrence of `sep` in `text`, or -1 (splitTopLevel semantics). */
function findTopLevelSep(text: string, sep: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        const q = text[j];
        if (q === '\\') { j += 2; continue; }
        if (q === c) { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      let j = i + 2;
      if (text[i + 1] === '/') {
        while (j < text.length && text[j] !== '\n') j++;
      } else {
        while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
        j = Math.min(j + 2, text.length);
      }
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth > 0) depth--;
    } else if (depth === 0 && c === sep[0] && text.slice(i, i + sep.length) === sep) {
      const before = i === 0 ? ' ' : text[i - 1];
      const after = i + sep.length < text.length ? text[i + sep.length] : ' ';
      if (!isIdentChar(before) && !isIdentChar(after)) return i;
    }
    i++;
  }
  return -1;
}

function trailingWsLen(text: string): number {
  let n = 0;
  while (n < text.length && isWhitespaceChar(text[text.length - 1 - n])) n++;
  return n;
}

function leadingWsLen(text: string): number {
  let n = 0;
  while (n < text.length && isWhitespaceChar(text[n])) n++;
  return n;
}

interface TrackCells {
  n: number;
}

function isTrackDeclStatement(stmt: any): boolean {
  if (!stmt || stmt.type !== 'VariableDeclaration') return false;
  return (stmt.declarations || []).some(
    (d: any) => d && d.id && d.id.type === 'ArrayPattern' && d.id.lazy === true && d.init
  );
}

/**
 * Emits the rewrite for a `const &[count] = track(0)` declarator. Mirrors
 * the exact text produced by the previous string-level rewrite: the first
 * declarator absorbs the statement's `const`/`let`/`var` keyword, the
 * replacement always ends with `;` unless the source statement already
 * provides a terminator (checked on the emitted statement text, exactly
 * like the old `wrapped[end] === ';'` rule).
 */
function emitTrackDeclStatement(
  g: VskGen,
  source: string,
  stmt: any,
  indent: string,
  isLast: boolean,
  opts: VskCodegenOptions
): void {
  const fullText = stripTrailingSemicolons(source.slice(stmt.start, stmt.end).trimEnd());
  const text = fullText + (!fullText.endsWith('}') && !isLast ? ';' : '');
  const decls = stmt.declarations || [];
  g.add(indent);
  let prevEnd = stmt.start;
  for (let di = 0; di < decls.length; di++) {
    const decl = decls[di];
    const id = decl.id;
    const isLazy = id && id.type === 'ArrayPattern' && id.lazy === true && decl.init;
    if (!isLazy) {
      g.addRaw(source.slice(prevEnd, decl.start));
      g.add(source.slice(decl.start, decl.end), decl.start, decl.end);
      prevEnd = decl.end;
      continue;
    }
    if (di > 0) g.addRaw(source.slice(prevEnd, decl.start));
    const ch = text[decl.end - stmt.start] ?? ' ';
    const elements = (id.elements || []) as any[];
    const names = elements
      .map((el: any) => (el ? el.name : null))
      .filter((n: any): n is string => typeof n === 'string');
    const initText = source.slice(decl.init.start, decl.init.end);
    if (names.length === 0) {
      g.add('let _ = ');
      g.add(initText, decl.init.start, decl.init.end);
      if (ch !== ';') g.addRaw(';');
      prevEnd = decl.end;
      continue;
    }    const annotation = id.typeAnnotation?.typeAnnotation
      ? source.slice(id.typeAnnotation.typeAnnotation.start, id.typeAnnotation.typeAnnotation.end).trim()
      : decl.init.typeArguments
        ? source.slice(decl.init.typeArguments.start + 1, decl.init.typeArguments.end - 1).trim()
        : '';
    const annStart = id.typeAnnotation?.typeAnnotation
      ? id.typeAnnotation.typeAnnotation.start
      : decl.init.typeArguments
        ? decl.init.typeArguments.start + 1
        : -1;
    const annEnd = id.typeAnnotation?.typeAnnotation
      ? id.typeAnnotation.typeAnnotation.end
      : decl.init.typeArguments
        ? decl.init.typeArguments.end - 1
        : -1;
    const first = names[0]!;
    const firstRange: [number, number] = [elements[0].start, elements[0].end];
    const dropLastSemi = ch === ';';

    if (opts.typedCells) {
      const cellName = g.cellCount === 0 ? '__cell' : `__cell${g.cellCount}`;
      g.cellCount++;
      // The cell holds a Tracked<T>, NOT a T — leave its type to inference
      // from `track<T>(init)` so raw-cell aliases stay correctly typed too.
      // Annotating it with the value annotation made `&[v, cell]` emit
      // `cell: T = <Tracked>` (unsound), and broke passing `cell` to APIs
      // expecting `Tracked<unknown>` (e.g. useFetch `into`).
      g.add(`const ${cellName} = `);
      g.add(initText, decl.init.start, decl.init.end);
      g.add(';');
      // First binding: the VALUE read from the cell.
      g.add(' let ');
      g.add(first, firstRange[0], firstRange[1], REACTIVE_DATA);
      if (annotation) {
        g.add(': ');
        g.add(annotation, annStart, annEnd);
      }
      g.add(` = ${cellName}.get();`);
      // Raw-cell aliases: inferred Tracked<T>, never the value annotation.
      for (let n = 1; n < names.length; n++) {
        g.add(' let ');
        g.add(names[n], elements[n].start, elements[n].end, REACTIVE_DATA);
        g.add(` = ${cellName};`);
      }
      if (dropLastSemi) g.code = g.code.slice(0, -1);
    } else {
      if (annotation) {
        g.add('let ');
        g.add(first, firstRange[0], firstRange[1], REACTIVE_DATA);
        g.add(': ');
        g.add(annotation, annStart, annEnd);
        g.add(' = (');
        g.add(initText, decl.init.start, decl.init.end);
        g.add(' as unknown as ');
        g.add(annotation, annStart, annEnd);
        g.add(');');
      } else {
        g.add('let ');
        g.add(first, firstRange[0], firstRange[1], REACTIVE_DATA);
        g.add(': any = ');
        g.add(initText, decl.init.start, decl.init.end);
        g.add(';');
      }
      for (let n = 1; n < names.length; n++) {
        g.add(' let ');
        g.add(names[n], elements[n].start, elements[n].end, REACTIVE_DATA);
        g.add(': any = ');
        g.add(first, firstRange[0], firstRange[1]);
        g.add(';');
        if (n === names.length - 1 && dropLastSemi) g.code = g.code.slice(0, -1);
      }
      if (names.length === 1 && dropLastSemi) g.code = g.code.slice(0, -1);
    }
    prevEnd = decl.end;
  }
  if (!isLast) g.addRaw(';');
}

function emitBlock(g: VskGen, source: string, body: any, indent: string, opts: VskCodegenOptions): void {
  const stmts = body && body.type === 'BlockStatement'
    ? body.body
    : body ? (Array.isArray(body) ? body : [body]) : [];
  g.addRaw('{\n');
  emitBody(g, source, stmts, indent + '  ', opts);
  g.addRaw('\n');
  g.add(indent);
  g.addRaw('}');
}

function emitJSXAttr(g: VskGen, source: string, attr: any): void {
  if (attr.type === 'JSXSpreadAttribute') {
    g.add(source.slice(attr.start, attr.end), attr.start, attr.end);
    return;
  }
  const name = attr.name;
  g.add(source.slice(name.start, name.end), name.start, name.end);
  const v = attr.value;
  if (!v) return;
  g.add(source.slice(name.end, v.start), name.end, v.start);
  if (v.type === 'JSXExpressionContainer') {
    g.add(source.slice(v.start, v.expression.start), v.start, v.expression.start);
    g.add(source.slice(v.expression.start, v.expression.end), v.expression.start, v.expression.end);
    g.add(source.slice(v.expression.end, v.end), v.expression.end, v.end);
  } else {
    g.add(source.slice(v.start, v.end), v.start, v.end);
  }
}

function emitJSXElement(g: VskGen, source: string, el: any, opts: VskCodegenOptions): void {
  const op = el.openingElement;
  const name = op.name;
  let prev: number;
  if (name) {
    g.add(source.slice(op.start, name.start), op.start, name.start);
    g.add(source.slice(name.start, name.end), name.start, name.end);
    prev = name.end;
  } else {
    prev = op.start + 1;
  }
  for (const attr of op.attributes ?? []) {
    g.add(source.slice(prev, attr.start), prev, attr.start);
    emitJSXAttr(g, source, attr);
    prev = attr.end;
  }
  g.add(source.slice(prev, op.end), prev, op.end);
  if (op.selfClosing) return;
  emitJSXChildren(g, source, el.children ?? [], opts);
  if (el.closingElement) {
    g.add(source.slice(el.closingElement.start, el.closingElement.end), el.closingElement.start, el.closingElement.end);
  }
}

function emitJSXExprBody(g: VskGen, source: string, expr: any, opts: VskCodegenOptions): void {
  if (expr.type === 'JSXElement') return emitJSXElement(g, source, expr, opts);
  if (expr.type === 'JSXFragment') return emitJSXFragment(g, source, expr, opts);
  g.add(source.slice(expr.start, expr.end), expr.start, expr.end);
}

function emitJSXFragment(g: VskGen, source: string, frag: any, opts: VskCodegenOptions): void {
  g.addRaw('<>');
  emitJSXChildren(g, source, frag.children ?? [], opts);
  g.addRaw('</>');
}

/**
 * Emits the `.map(...)` scaffolding for a `for (... of ...)` / `for (... in
 * ...)` clause inside JSX text, mapping the array/object expression to its
 * source range. `clauseStart` is the collapsed-text offset of the clause's
 * first character (inside `text`) and `map` translates collapsed offsets
 * back to raw source offsets.
 */
function emitForClauseMap(
  g: VskGen,
  source: string,
  child: any,
  text: string,
  map: number[],
  clauseStart: number,
  bodyEmit: () => void,
  emptyEmit: (() => void) | null
): boolean {
  const clauseEnd = findBalancedEnd(text, clauseStart - 1);
  const clause = text.slice(clauseStart, clauseEnd);
  const ofIdx = findTopLevelSep(clause, 'of');
  const inIdx = ofIdx === -1 ? findTopLevelSep(clause, 'in') : -1;
  if (ofIdx === -1 && inIdx === -1) return false;
  const sepIdx = ofIdx === -1 ? inIdx : ofIdx;
  const lhs = clause.slice(0, sepIdx);
  const rhs = clause.slice(sepIdx + 2);
  const arrExpr = rhs.trim();
  const arrStartCollapsed = clauseStart + sepIdx + 2 + leadingWsLen(rhs);
  const arrEndCollapsed = clauseStart + sepIdx + 2 + rhs.length - trailingWsLen(rhs);
  const arrStart = arrStartCollapsed < map.length ? child.start + map[arrStartCollapsed] : child.start;
  const arrEnd =
    arrEndCollapsed > 0 && arrEndCollapsed - 1 < map.length
      ? child.start + map[arrEndCollapsed - 1] + 1
      : child.start;
  const itemVar = stripDeclKeyword(lhs).trim();
  if (ofIdx !== -1) {
    if (emptyEmit) {
      g.addRaw('{ (() => { const _v = ');
      g.add(arrExpr, arrStart, arrEnd);
      g.addRaw('; return _v.length === 0 ? (');
      emptyEmit();
      g.addRaw(') : _v.map((');
      g.addRaw(itemVar);
      g.addRaw(': (typeof _v)[number]) => (');
      bodyEmit();
      g.addRaw(')); })() }');
    } else {
      g.addRaw('{ ');
      g.add(arrExpr, arrStart, arrEnd);
      g.addRaw('.map((');
      g.addRaw(itemVar);
      g.addRaw(': (typeof ');
      g.add(arrExpr, arrStart, arrEnd);
      g.addRaw(')[number]) => (');
      bodyEmit();
      g.addRaw(')) }');
    }
  } else {
    g.addRaw('{ Object.keys(');
    g.add(arrExpr, arrStart, arrEnd);
    g.addRaw(').map((');
    g.addRaw(itemVar);
    g.addRaw(') => (');
    bodyEmit();
    g.addRaw(')) }');
  }
  return true;
}

function emitJSXChildren(g: VskGen, source: string, children: any[], opts: VskCodegenOptions): void {
  let i = 0;
  let forPending = false;
  while (i < children.length) {
    const child = children[i];
    if (child.type !== 'JSXText') forPending = false;
    if (child.type === 'JSXText') {
      const { text, map } = collapseWithMap(child.value);
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//')) { i++; continue; }

      const forDecl = extractForHeader(trimmed);
      const nextChild = children[i + 1];
      if (forDecl !== null && nextChild !== undefined && (
        nextChild.type === 'JSXExpressionContainer' ||
        nextChild.type === 'JSXElement' ||
        nextChild.type === 'JSXFragment'
      )) {
        const trimmedStartCollapsed = leadingWsLen(text);
        const parenIdx = skipWhitespace(text, trimmedStartCollapsed + 3);
        if (text[parenIdx] === '(') {
          const clauseStartCollapsed = parenIdx + 1;
          let consumed = 2;
          let emptyEmit: (() => void) | null = null;
          const emptyTextNode = children[i + 2];
          const emptyContainer = children[i + 3];
          if (
            emptyTextNode && emptyTextNode.type === 'JSXText' &&
            ['#empty', 'empty'].includes(emptyTextNode.value.trim()) &&
            emptyContainer && emptyContainer.type === 'JSXExpressionContainer' &&
            emptyContainer.expression.type !== 'JSXEmptyExpression'
          ) {
            consumed = 4;
            emptyEmit = () => emitJSXExprBody(g, source, emptyContainer.expression, opts);
          }
          let matched = false;
          if (nextChild.type === 'JSXExpressionContainer') {
            const exprNode = nextChild.expression;
            if (exprNode.type === 'JSXEmptyExpression') { g.add(text, child.start, child.end); i++; continue; }
            matched = emitForClauseMap(
              g, source, child, text, map, clauseStartCollapsed,
              () => emitJSXExprBody(g, source, exprNode, opts),
              emptyEmit
            );
          } else if (nextChild.type === 'JSXFragment') {
            matched = emitForClauseMap(
              g, source, child, text, map, clauseStartCollapsed,
              () => emitJSXFragment(g, source, nextChild, opts),
              emptyEmit
            );
          } else {
            matched = emitForClauseMap(
              g, source, child, text, map, clauseStartCollapsed,
              () => emitJSXElement(g, source, nextChild, opts),
              emptyEmit
            );
          }
          if (matched) {
            i += consumed;
            forPending = true;
            continue;
          }
        }
      }

      if (forPending && trimmed === '}') { forPending = false; i++; continue; }
      forPending = false;
      g.add(text, child.start, child.end);
      i++;
    } else if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'JSXEmptyExpression') { i++; continue; }
      g.addRaw('{');
      g.add(source.slice(child.expression.start, child.expression.end), child.expression.start, child.expression.end);
      g.addRaw('}');
      i++;
    } else if (child.type === 'JSXElement') {
      if (getJSXTagName(child) === 'style') {
        const openEnd = child.openingElement?.end ?? child.start;
        const closeStart = child.closingElement?.start ?? child.end;
        g.recordStyle(child.start, child.end, source.slice(openEnd, closeStart));
        i++;
        continue;
      }
      emitJSXElement(g, source, child, opts);
      i++;
    } else if (child.type === 'JSXFragment') {
      emitJSXFragment(g, source, child, opts);
      i++;
    } else {
      i++;
    }
  }
}

function emitIf(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('if (');
  g.add(source.slice(stmt.test.start, stmt.test.end), stmt.test.start, stmt.test.end);
  g.addRaw(') ');
  emitBlock(g, source, stmt.consequent, indent, opts);
  if (stmt.alternate) {
    g.addRaw(' else ');
    emitBlock(g, source, stmt.alternate, indent, opts);
  }
}

function emitForOf(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('for (');
  g.add(source.slice(stmt.left.start, stmt.left.end), stmt.left.start, stmt.left.end);
  g.addRaw(' of ');
  g.add(source.slice(stmt.right.start, stmt.right.end), stmt.right.start, stmt.right.end);
  g.addRaw(') ');
  emitBlock(g, source, stmt.body, indent, opts);
}

function emitForIn(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('for (');
  g.add(source.slice(stmt.left.start, stmt.left.end), stmt.left.start, stmt.left.end);
  g.addRaw(' in ');
  g.add(source.slice(stmt.right.start, stmt.right.end), stmt.right.start, stmt.right.end);
  g.addRaw(') ');
  emitBlock(g, source, stmt.body, indent, opts);
}

function emitFor(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('for (');
  if (stmt.init) g.add(source.slice(stmt.init.start, stmt.init.end), stmt.init.start, stmt.init.end);
  g.addRaw('; ');
  if (stmt.test) g.add(source.slice(stmt.test.start, stmt.test.end), stmt.test.start, stmt.test.end);
  g.addRaw('; ');
  if (stmt.update) g.add(source.slice(stmt.update.start, stmt.update.end), stmt.update.start, stmt.update.end);
  g.addRaw(') ');
  emitBlock(g, source, stmt.body, indent, opts);
}

function emitWhile(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('while (');
  g.add(source.slice(stmt.test.start, stmt.test.end), stmt.test.start, stmt.test.end);
  g.addRaw(') ');
  emitBlock(g, source, stmt.body, indent, opts);
}

function emitDoWhile(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('do ');
  emitBlock(g, source, stmt.body, indent, opts);
  g.addRaw(' while (');
  g.add(source.slice(stmt.test.start, stmt.test.end), stmt.test.start, stmt.test.end);
  g.addRaw(');');
}

function emitSwitch(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('switch (');
  g.add(source.slice(stmt.discriminant.start, stmt.discriminant.end), stmt.discriminant.start, stmt.discriminant.end);
  g.addRaw(') {');
  let firstCase = true;
  for (const c of stmt.cases ?? []) {
    g.addRaw(firstCase ? '\n' : '\n');
    firstCase = false;
    g.add(indent);
    g.addRaw('  ');
    if (c.test) {
      g.addRaw('case ');
      g.add(source.slice(c.test.start, c.test.end), c.test.start, c.test.end);
      g.addRaw(':');
    } else {
      g.addRaw('default:');
    }
    const before = g.code.length;
    emitBody(g, source, c.consequent, indent + '    ', opts);
    if (g.code.length > before) g.addRaw('\n');
  }
  g.addRaw('\n');
  g.add(indent);
  g.addRaw('}');
}

function emitTry(g: VskGen, source: string, stmt: any, indent: string, opts: VskCodegenOptions): void {
  g.add(indent);
  g.addRaw('try ');
  emitBlock(g, source, stmt.block, indent, opts);
  if (stmt.handler) {
    g.addRaw(' catch');
    if (stmt.handler.param) {
      g.addRaw(' (');
      g.add(source.slice(stmt.handler.param.start, stmt.handler.param.end), stmt.handler.param.start, stmt.handler.param.end);
      g.addRaw(')');
    }
    g.addRaw(' ');
    emitBlock(g, source, stmt.handler.body, indent, opts);
  }
  if (stmt.finalizer) {
    g.addRaw(' finally ');
    emitBlock(g, source, stmt.finalizer, indent, opts);
  }
}

function emitPlainStatement(g: VskGen, source: string, stmt: any, indent: string, isLast: boolean): void {
  let text = stripTrailingSemicolons(source.slice(stmt.start, stmt.end).trimEnd());
  if (text === '') return;
  g.add(indent);
  g.add(text, stmt.start, stmt.end);
  if (!text.endsWith('}') && !isLast) g.addRaw(';');
}

function emitStatement(
  g: VskGen,
  source: string,
  stmt: any,
  indent: string,
  isLast: boolean,
  opts: VskCodegenOptions
): void {
  switch (stmt.type) {
    case 'JSXElement':
      if (getJSXTagName(stmt) === 'style') {
        const openEnd = stmt.openingElement?.end ?? stmt.start;
        const closeStart = stmt.closingElement?.start ?? stmt.end;
        g.recordStyle(stmt.start, stmt.end, source.slice(openEnd, closeStart));
        return;
      }
      g.add(indent);
      emitJSXElement(g, source, stmt, opts);
      if (!isLast) g.addRaw(';');
      return;
    case 'JSXFragment':
      g.add(indent);
      emitJSXFragment(g, source, stmt, opts);
      if (!isLast) g.addRaw(';');
      return;
    case 'JSXExpressionContainer': {
      if (stmt.expression.type === 'JSXEmptyExpression') return;
      g.add(indent);
      g.addRaw('{');
      g.add(source.slice(stmt.expression.start, stmt.expression.end), stmt.expression.start, stmt.expression.end);
      g.addRaw('}');
      if (!isLast) g.addRaw(';');
      return;
    }
    case 'VeskBlock': {
      if (stmt.tag === 'empty') return;
      const innerStmts = stmt.body ?? [];
      let firstLine = true;
      for (let i = 0; i < innerStmts.length; i++) {
        const before = g.code.length;
        emitStatement(g, source, innerStmts[i], indent, isLast && i === innerStmts.length - 1, opts);
        if (g.code.length > before) {
          if (!firstLine) g.addRaw('\n');
          firstLine = false;
        }
      }
      return;
    }
    case 'VariableDeclaration':
      if (isTrackDeclStatement(stmt)) {
        emitTrackDeclStatement(g, source, stmt, indent, isLast, opts);
        return;
      }
      return emitPlainStatement(g, source, stmt, indent, isLast);
    case 'IfStatement':
      return emitIf(g, source, stmt, indent, opts);
    case 'ForOfStatement':
      return emitForOf(g, source, stmt, indent, opts);
    case 'ForInStatement':
      return emitForIn(g, source, stmt, indent, opts);
    case 'ForStatement':
      return emitFor(g, source, stmt, indent, opts);
    case 'WhileStatement':
      return emitWhile(g, source, stmt, indent, opts);
    case 'DoWhileStatement':
      return emitDoWhile(g, source, stmt, indent, opts);
    case 'SwitchStatement':
      return emitSwitch(g, source, stmt, indent, opts);
    case 'TryStatement':
      return emitTry(g, source, stmt, indent, opts);
    case 'LabeledStatement': {
      g.add(indent);
      g.add(stmt.label.name, stmt.label.start, stmt.label.end);
      g.addRaw(':\n');
      emitStatement(g, source, stmt.body, indent, isLast, opts);
      return;
    }
    default:
      return emitPlainStatement(g, source, stmt, indent, isLast);
  }
}

function emitBody(g: VskGen, source: string, stmts: any[], indent: string, opts: VskCodegenOptions): void {
  let firstLine = true;
  let i = 0;
  while (i < stmts.length) {
    const stmt = stmts[i];
    const isLast = i === stmts.length - 1;
    if (
      stmt.type === 'ForOfStatement' &&
      stmts[i + 1] && stmts[i + 1].type === 'VeskBlock' && stmts[i + 1].tag === 'empty'
    ) {
      const empty = stmts[i + 1];
      if (!firstLine) g.addRaw('\n');
      firstLine = false;
      emitForOf(g, source, stmt, indent, opts);
      const inner = empty.body ?? [];
      if (inner.length > 0) {
        g.addRaw('\n');
        g.add(indent);
        g.add(source.slice(stmt.right.start, stmt.right.end), stmt.right.start, stmt.right.end);
        g.addRaw('.length === 0 && (() => {');
        g.addRaw('\n');
        emitBody(g, source, inner, indent + '  ', opts);
        g.addRaw('\n');
        g.add(indent);
        g.addRaw('})();');
      }
      i += 2;
      continue;
    }
    const before = g.code.length;
    emitStatement(g, source, stmt, indent, isLast, opts);
    if (g.code.length > before) {
      if (!firstLine) g.addRaw('\n');
      firstLine = false;
    }
    i++;
  }
}

/**
 * Emits `source[start, end)` as a mapped chunk, skipping any `<style>`
 * blocks (recorded as style regions). Used for expression-mode bodies and
 * the gaps around statements/expressions.
 */
function emitChunkMapped(g: VskGen, source: string, start: number, end: number): void {
  if (end <= start) return;
  let pos = start;
  let i = start;
  while (i < end) {
    if (source[i] === '<' && source.slice(i, i + 6) === '<style') {
      const next = i + 6;
      if (next < end && (isWhitespaceChar(source[next]) || source[next] === '>' || source[next] === '/')) {
        const openEnd = htmlTagEnd(source, i);
        if (openEnd !== -1 && openEnd <= end) {
          const closeIdx = source.indexOf('</style>', openEnd);
          if (closeIdx !== -1 && closeIdx + 8 <= end) {
            g.add(source.slice(pos, i), pos, i);
            g.recordStyle(i, closeIdx + 8, source.slice(openEnd, closeIdx));
            pos = closeIdx + 8;
            i = closeIdx + 8;
            continue;
          }
        }
      }
    }
    i++;
  }
  g.add(source.slice(pos, end), pos, end);
}

function emitReturn(g: VskGen, source: string, stmt: any, opts: VskCodegenOptions): void {
  g.add(source.slice(stmt.start, stmt.start + 6), stmt.start, stmt.start + 6);
  const arg = stmt.argument;
  if (!arg) {
    emitChunkMapped(g, source, stmt.start + 6, stmt.end);
    return;
  }
  emitChunkMapped(g, source, stmt.start + 6, arg.start);
  if (arg.type === 'JSXElement') emitJSXElement(g, source, arg, opts);
  else if (arg.type === 'JSXFragment') emitJSXFragment(g, source, arg, opts);
  else emitChunkMapped(g, source, arg.start, arg.end);
  emitChunkMapped(g, source, arg.end, stmt.end);
}

/**
 * Emits a statement-mode component body (bare JSX, control flow,
 * guard-clause returns). The body text starts directly with the first
 * statement (no leading whitespace) and the `{ ... }` wrapping is emitted
 * by the caller.
 */
function emitBodyCore(g: VskGen, source: string, stmts: any[], opts: VskCodegenOptions): void {
  emitBody(g, source, stmts, '', opts);
}

/** Emits an expression-mode component body (`return <jsx>` or a bare expression). */
function emitExpressionBody(
  g: VskGen,
  source: string,
  coreStart: number,
  coreEnd: number,
  stmts: any[],
  opts: VskCodegenOptions
): void {
  let pos = coreStart;
  for (const stmt of stmts) {
    if (!stmt) continue;
    emitChunkMapped(g, source, pos, stmt.start);
    pos = stmt.start;
    if (isTrackDeclStatement(stmt)) {
      emitTrackDeclStatement(g, source, stmt, '', true, opts);
    } else if (stmt.type === 'ReturnStatement') {
      emitReturn(g, source, stmt, opts);
    } else {
      emitChunkMapped(g, source, stmt.start, stmt.end);
    }
    pos = stmt.end;
  }
  emitChunkMapped(g, source, pos, coreEnd);
}

/**
 * Emits `text` (covering source range [base, end)) with its first
 * identifier split into its own mapping so hover/rename/definition land
 * exactly on the component name.
 */
function emitRestMapped(g: VskGen, text: string, base: number, end: number): void {
  let i = 0;
  while (i < text.length && !isIdentStart(text[i])) i++;
  if (i >= text.length) {
    g.add(text, base, end);
    return;
  }
  let j = i + 1;
  while (j < text.length && isIdentChar(text[j])) j++;
  g.add(text.slice(0, i), base, base + i);
  g.add(text.slice(i, j), base + i, base + j);
  g.add(text.slice(j), base + j, end);
}

function emitComponentHeader(g: VskGen, source: string, start: number, bodyStart: number): void {
  const h = source.slice(start, bodyStart);
  const k = findFirstKeyword(h, 'component');
  if (k === -1) {
    const { text, end } = stripTrailingClientRange(h);
    if (!text.includes('(')) {
      const trimmed = text.trimEnd();
      g.add(trimmed, start, start + end - (text.length - trimmed.length));
      g.addRaw('() ');
    } else {
      g.add(text, start, start + end);
    }
    return;
  }
  g.add(h.slice(0, k), start, start + k);
  g.add('function', start + k, start + k + 'component'.length);
  const restBase = start + k + 'component'.length;
  const { text: rest, end } = stripTrailingClientRange(h.slice(k + 'component'.length));
  const transformed = h.slice(0, k) + 'function' + rest;
  if (!transformed.includes('(')) {
    const trimmed = rest.trimEnd();
    emitRestMapped(g, trimmed, restBase, restBase + end - (rest.length - trimmed.length));
    g.addRaw('() ');
  } else {
    emitRestMapped(g, rest, restBase, restBase + end);
  }
}

function emitComponent(
  g: VskGen,
  source: string,
  node: any,
  start: number,
  opts: VskCodegenOptions
): void {
  const body = node.body;
  if (!body || body.start == null || body.end == null) return;
  emitComponentHeader(g, source, start, body.start);
  const statementMode = isStatementMode(node);
  const stmts = body.body ?? [];
  if (statementMode) {
    g.addRaw('{ ');
    emitBodyCore(g, source, stmts, opts);
    g.addRaw(' }');
  } else {
    const raw = source.slice(body.start, body.end);
    const rawLen = raw.length;
    let s = 0;
    let e = rawLen;
    while (s < e && isWhitespaceChar(raw[s])) s++;
    while (e > s && isWhitespaceChar(raw[e - 1])) e--;
    const hasBraces = raw[s] === '{' && raw[e - 1] === '}';
    let coreStart: number;
    let coreEnd: number;
    if (hasBraces) {
      coreStart = body.start + s + 1;
      coreEnd = body.start + e - 1;
    } else {
      coreStart = body.start + s;
      coreEnd = body.start + e;
    }
    while (coreStart < coreEnd && isWhitespaceChar(source[coreStart])) coreStart++;
    while (coreEnd > coreStart && isWhitespaceChar(source[coreEnd - 1])) coreEnd--;
    if (hasBraces) g.addRaw('{ ');
    emitExpressionBody(g, source, coreStart, coreEnd, stmts, opts);
    if (hasBraces) g.addRaw(' }');
  }
}

function isModuleAst(ast: any): boolean {
  return (ast.body || []).some(
    (s: any) =>
      s.type === 'ImportDeclaration' ||
      s.type === 'ExportNamedDeclaration' ||
      s.type === 'ExportDefaultDeclaration' ||
      s.type === 'ExportAllDeclaration'
  );
}

export function compileVskCodegen(source: string, opts: VskCodegenOptions = {}): VskCodegenResult {
  let ast: any;
  try {
    ast = parse(source);
  } catch (e) {
    const pos = (e as { pos?: number }).pos ?? 0;
    return {
      code: source,
      mappings: [
        {
          sourceOffsets: [0],
          generatedOffsets: [0],
          lengths: [source.length],
          generatedLengths: [source.length],
          data: FULL_DATA,
        },
      ],
      styleRegions: [],
      errors: [{ message: (e as Error).message, start: pos, end: pos + 1 }],
    };
  }

  const clean = blankForClauses(source, ast);
  const g = new VskGen();
  const components = getComponents(ast).sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const { node, start } of components) {
    const body = node.body;
    if (!body || body.start == null || body.end == null) continue;
    g.add(clean.slice(pos, start), pos, start);
    emitComponent(g, clean, node, start, opts);
    pos = body.end;
  }
  g.add(clean.slice(pos), pos, source.length);

  let code = g.code;
  if (isModuleAst(ast) && containsIdentifier(code, 'Head') && !isIdentifierImported(code, 'Head')) {
    g.prepend('declare const Head: (props: { children?: unknown }) => unknown;\n');
    code = g.code;
  }

  return { code, mappings: g.mappings, styleRegions: g.styleRegions, errors: [] };
}

export function vskToTsx(source: string): string {
  return compileVskCodegen(source).code;
}

function isTypeDecl(stmt: any): boolean {
  return (
    stmt.type === 'TSInterfaceDeclaration' ||
    stmt.type === 'TSTypeAliasDeclaration' ||
    (stmt.type === 'ExportNamedDeclaration' &&
      (stmt.declaration?.type === 'TSInterfaceDeclaration' || stmt.declaration?.type === 'TSTypeAliasDeclaration'))
  );
}

export function generateVskDts(source: string): string {
  let ast: any;
  try {
    ast = parse(source);
  } catch {
    return '';
  }

  const lines: string[] = ['/* generated by vesk — do not edit */', ''];
  const typeDeclNames = new Set<string>();

  for (const stmt of ast.body || []) {
    if (isTypeDecl(stmt)) {
      const name = stmt.id?.name || stmt.declaration?.id?.name;
      if (name) typeDeclNames.add(name);
      lines.push(source.slice(stmt.start, stmt.end), '');
    }
  }

  for (const stmt of ast.body || []) {
    if (stmt.type === 'ImportDeclaration') {
      const src = stmt.source?.value;
      if (typeof src === 'string' && !src.endsWith('.css')) {
        lines.push(source.slice(stmt.start, stmt.end), '');
      }
    }
  }

  for (const { node, defaultExport } of getComponents(ast)) {
    const name = node.id?.name;
    if (!name) continue;
    const propsType = getPropsType(node.params, source);
    const typeName = `${name}Props`;
    const hasType = propsType !== null && propsType !== undefined;
    const collision = typeDeclNames.has(typeName);
    const signature = hasType
      ? (collision ? propsType : typeName) + ' & { children?: unknown }'
      : 'any';
    if (hasType && !collision) {
      lines.push(`export type ${typeName} = ${propsType};`, '');
    } else if (!hasType && !collision) {
      lines.push(`export type ${typeName} = any;`, '');
    }
    if (defaultExport) {
      lines.push(`export default function ${name}(props: ${signature}): unknown;`, '');
    } else {
      lines.push(`export declare function ${name}(props: ${signature}): unknown;`, '');
    }
  }

  return lines.join('\n');
}