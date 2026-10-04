import * as acorn from 'acorn';
import type { Options } from 'acorn';
import type { Program } from 'estree';
import { tsPlugin } from './acorn-ts-plugin/index.js';
import { VeskParserPlugin } from '@vesk/compiler/src/vesk-plugin';
import { blankComments, containsForOfIn } from '@vesk/compiler/src/scan';
import { VeskError, codeFrame } from '@vesk/compiler/src/errors';
import { findSpecifierExports, hasTopLevelValueDeclaration } from '@vesk/compiler/src/tokens';

export interface ParseOptions {
  filename?: string;
  [key: string]: unknown;
}

/**
 * Compiler annotations discovered while preprocessing the source.
 * `for (...; key X)` and `for (...; index i)` clauses are blanked out
 * (replaced with spaces to preserve all source offsets) so the plain
 * JS parser accepts the loop; the annotation records the original
 * ranges so the IR generator can recover the key/index clauses.
 */
export interface VeskAnnotation {
  kind: 'for-clause';
  /** Absolute position of the `for` keyword. */
  forStart: number;
  /** Absolute start of the `; key ...` / `; index ...` clause. */
  clauseStart: number;
  /** Absolute end of the clause (exclusive). */
  clauseEnd: number;
  /** Range of the key expression within the clause, when `key` was used. */
  keyRange?: [number, number];
  /** The index variable name, when `index` was used. */
  indexName?: string;
}

function isIdentChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 95 || code === 36
  );
}

function isWhitespaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff';
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * Scans the source and blanks `; key <expr>` / `; index <ident>` clauses
 * found in `for (...)` headers, returning the rewritten code (same length
 * as the input, so every source offset is preserved) plus annotations.
 */
export function preprocessForClauses(source: string): { code: string; annotations: VeskAnnotation[] } {
  const annotations: VeskAnnotation[] = [];
  const chars: string[] = source.split('');

  const isString = (ch: string) => ch === '"' || ch === "'" || ch === '`';

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // Skip strings and comments (nested backtick templates keep depth).
    if (isString(ch)) {
      const quote = ch;
      let j = i + 1;
      let tplDepth = 0;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') { j += 2; continue; }
        if (quote === '`' && c === '$' && source[j + 1] === '{') { tplDepth++; j += 2; continue; }
        if (quote === '`' && c === '}' && tplDepth > 0) { tplDepth--; j++; continue; }
        if (c === quote && tplDepth === 0) { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      let j = i + 2;
      while (j < source.length && source[j] !== '\n') j++;
      i = j;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      let j = i + 2;
      while (j < source.length && !(source[j] === '*' && source[j + 1] === '/')) j++;
      i = Math.min(j + 2, source.length);
      continue;
    }

    // `for` keyword followed by `(` — scan the header.
    if (ch === 'f' && source.startsWith('for', i)) {
      const before = i === 0 ? ' ' : source[i - 1];
      if (!isIdentChar(source.charCodeAt(i + 3) || 0) && (i === 0 || !isIdentChar(before.charCodeAt(0)))) {
        let p = i + 3;
        while (p < source.length && isWhitespaceChar(source[p])) p++;
        if (source[p] === '(') {
          let depth = 0;
          let j = p;
          while (j < source.length) {
            const c = source[j];
            if (isString(c)) {
              const quote = c;
              let k = j + 1;
              while (k < source.length) {
                if (source[k] === '\\') { k += 2; continue; }
                if (source[k] === quote) { k++; break; }
                k++;
              }
              j = k;
              continue;
            }
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') {
              depth--;
              if (c === ')' && depth === 0) break;
            }
            j++;
          }
          const headerEnd = Math.min(j, source.length - 1);

          // Only `for (... of ...)` / `for (... in ...)` headers may carry
          // `; key` / `; index` clauses. Classic for-loops keep their `;`
          // separated clauses untouched (`for (let key = 0; key < 5; ...)`
          // must not be blanked).
          let firstSemi = -1;
          let depth1 = 0;
          for (let q = p + 1; q < headerEnd; q++) {
            const c = source[q];
            if (c === '(' || c === '[' || c === '{') depth1++;
            else if (c === ')' || c === ']' || c === '}') depth1--;
            else if (c === ';' && depth1 === 0) { firstSemi = q; break; }
          }
          const preSemi = source.slice(p + 1, firstSemi === -1 ? headerEnd : firstSemi);
          if (!containsForOfIn(preSemi)) {
            i = headerEnd;
            continue;
          }

          // Collect top-level `;` clause starts inside the header.
          const clauseStarts: number[] = [];
          let depth2 = 0;
          for (let q = p + 1; q < headerEnd; q++) {
            const c = source[q];
            if (isString(c)) {
              const quote = c;
              let k = q + 1;
              while (k < source.length) {
                if (source[k] === '\\') { k += 2; continue; }
                if (source[k] === quote) { k++; break; }
                k++;
              }
              q = k - 1;
              continue;
            }
            if (c === '(' || c === '[' || c === '{') depth2++;
            else if (c === ')' || c === ']' || c === '}') depth2--;
            else if (c === ';' && depth2 === 0) clauseStarts.push(q);
          }

          for (let c = 0; c < clauseStarts.length; c++) {
            const start = clauseStarts[c];
            const end = c + 1 < clauseStarts.length ? clauseStarts[c + 1] : headerEnd;
            // `clause` includes the leading `;` — it must be blanked too,
            // otherwise the header no longer parses as a for-of/for-in.
            const clause = source.slice(start, end);
            let clauseCode = clause;
            let keyRange: [number, number] | undefined;
            let indexName: string | undefined;

            // `clause` starts with the `;` — parse the keyword by hand so no
            // regex is involved: `; key <expr>` or `; index <ident>`.
            let q = start;
            if (source[q] === ';') q++;
            while (q < end && isWhitespaceChar(source[q])) q++;
            let kwStart = q;
            while (q < end && isIdentChar(source.charCodeAt(q))) q++;
            const keyword = source.slice(kwStart, q);
            if (keyword === 'key') {
              let k = q;
              while (k < end && isWhitespaceChar(source[k])) k++;
              const expr = source.slice(k, end).trim();
              if (expr) {
                if (expr[0] === ':') {
                  // `; key : <expr>` / `; key: <expr>` (colon form) is not valid
                  // Vesk: the clause is `; key <expr>`, and passing the colon
                  // through used to emit a broken reconciliation key.
                  const { line, column } = offsetToLineCol(source, start);
                  throw new VeskError(
                    `Invalid \`; key\` clause — write the key expression after \`key\` without a colon: \`key ${expr.slice(1).trim()}\`.`,
                    {
                      line,
                      column,
                      code: codeFrame(source, line, column),
                      nextSteps: [
                        'Use `; key <expr>` (no colon), e.g. `for (const item of items; key item.id)`.',
                        'For the iteration index use `; index <name>`, e.g. `for (const item of items; key item.id; index i)`.',
                      ],
                    },
                  );
                }
                keyRange = [k, start + clause.length];
                clauseCode = ' '.repeat(clause.length);
              }
            } else if (keyword === 'index') {
              let k = q;
              while (k < end && isWhitespaceChar(source[k])) k++;
              const identStart = k;
              while (k < end && isIdentChar(source.charCodeAt(k))) k++;
              const ident = source.slice(identStart, k);
              let m = k;
              while (m < end && isWhitespaceChar(source[m])) m++;
              if (ident && m === end) {
                indexName = ident;
                clauseCode = ' '.repeat(clause.length);
              }
            }

            if (keyRange || indexName) {
              for (let q = 0; q < clause.length; q++) chars[start + q] = clauseCode[q];
              annotations.push({
                kind: 'for-clause',
                forStart: i,
                clauseStart: start,
                clauseEnd: end,
                ...(keyRange ? { keyRange } : {}),
                ...(indexName !== undefined ? { indexName } : {}),
              });
            }
          }
          i = headerEnd;
          continue;
        }
      }
    }
    i++;
  }

  return { code: chars.join(''), annotations };
}

/**
 * Blanks the type parameter list of a GENERIC ARROW function:
 *
 *   const read = <T,>(key: string, fallback: T): T => fallback;
 *
 * The list is type-only information the TS stripper deletes anyway, and it is
 * unrepresentable in the tokenizer this parser uses: a `<` in expression
 * position is read as `jsxTagStart`, and inside it the tokenizer emits
 * `jsxName` / `jsxTagEnd` — never type tokens. So the construct could not be
 * parsed at all, while `function f<T>(…)` and `async <T,>(…)` both could.
 *
 * That failure was silent rather than loud. `readSsrSource` treats a parse
 * error as "not a module we understand" and substitutes the RAW, untranspiled
 * source, so the parse error surfaced much later as
 * `Unexpected token ':'` while the emitted module was being evaluated.
 *
 * Blanked IN PLACE — same character length, so every source offset, and
 * therefore every AST node position, is preserved. This runs alongside the
 * `{#clause}` and specifier-export passes for the same reason.
 *
 * The disambiguation is structural, not textual: the `>` must be followed by the
 * arrow's PARAMETER list and then (after an optional return type) by `=>`. That
 * is what separates `const f = <T,>(k: T): T => k` from the JSX
 * `const a = <div>(hi)</div>`, where the `>` is also followed by `(` but never
 * by `=>`. Type arguments (`f<T>(x)`) and comparisons fail the same test, so
 * they are left untouched. A `<` inside a string, template or comment is
 * skipped by the lexical scan before any of this runs.
 */
export function blankGenericArrowTypeParams(source: string): string {
  let changed = false;
  const chars = source.split('');
  let i = 0;

  const isSpace = (ch: string): boolean => isSpaceChar(ch);

  while (i < source.length) {
    const ch = source[i];
    // Skip strings, templates and comments — the same lexical discipline the
    // clause pass uses, so a `<T,>` inside a string or comment is never touched.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === quote) { j++; break; }
        if (quote === '`' && source[j] === '$' && source[j + 1] === '{') {
          let depth = 1; j += 2;
          while (j < source.length && depth > 0) {
            if (source[j] === '{') depth++;
            else if (source[j] === '}') depth--;
            j++;
          }
          continue;
        }
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch !== '<') { i++; continue; }

    // A candidate `<` in expression position: find the matching `>`, tracking
    // angle depth and skipping bracketed groups (a `>` inside `(…)`/`[…]`/`{…}`
    // is a comparison or a nested type argument, never the terminator).
    let j = i + 1;
    let angle = 1;
    let end = -1;
    let bail = false;
    while (j < source.length) {
      const c = source[j];
      if (c === '<') { angle++; j++; continue; }
      if (c === '>') {
        angle--;
        j++;
        if (angle === 0) { end = j; break; }
        continue;
      }
      if (c === '(' || c === '[' || c === '{') {
        const close = c === '(' ? ')' : c === '[' ? ']' : '}';
        let depth = 0;
        while (j < source.length) {
          const d = source[j];
          if (d === c) depth++;
          else if (d === close) { depth--; if (depth === 0) { j++; break; } }
          j++;
        }
        continue;
      }
      if (c === ';' || c === '\n') { bail = true; break; }
      j++;
    }
    if (bail || end < 0) { i++; continue; }

    // Must be an arrow: `>` then a parameter list, then an optional return
    // type, then `=>`. Scanning to the `=>` is what distinguishes this from a
    // JSX element that happens to be followed by a parenthesized text run.
    if (!isArrowParameterList(source, end)) { i = end; continue; }

    for (let p = i; p < end; p++) {
      if (chars[p] !== '\n') chars[p] = ' ';
    }
    changed = true;
    i = end;
  }

  return changed ? chars.join('') : source;
}

/**
 * True when `source` continues from `from` with `( … )` — optionally followed
 * by a `: ReturnType` — and then `=>`. Balances brackets so the arrow inside a
 * default value (`(cb = () => 1) => …`) is not mistaken for the terminator.
 */
function isArrowParameterList(source: string, from: number): boolean {
  let i = from;
  while (i < source.length && isSpaceChar(source[i])) i++;
  if (source[i] !== '(') return false;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      i++;
      if (depth === 0) break;
      continue;
    }
    i++;
  }
  if (depth !== 0) return false;
  while (i < source.length && isSpaceChar(source[i])) i++;
  // Optional return type: `: T` up to the `=>` at depth zero.
  if (source[i] === ':') {
    i++;
    let tdepth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '(' || ch === '[' || ch === '{') { tdepth++; i++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (tdepth === 0) return false;
        tdepth--;
        i++;
        continue;
      }
      if (tdepth === 0 && ch === '=' && source[i + 1] === '>') return true;
      // A statement boundary ends the scan ONLY at depth zero. An object
      // LITERAL type is full of them and is perfectly legal inside a return
      // annotation: `{ roles: R[]; changed: boolean }` has a `;` (and, when it
      // wraps, a newline) inside the braces. Bailing on those is what made
      // `<R extends { id: string }>(a: R[], b: R[]): { roles: R[]; changed:
      // boolean } => a` the one generic-arrow shape that still failed — it needs
      // a generic arrow AND a braced constraint AND a return annotation, which
      // is why dropping any ONE of the three parsed cleanly.
      if (tdepth === 0 && (ch === ';' || ch === '\n')) return false;
      i++;
    }
    return false;
  }
  return source[i] === '=' && source[i + 1] === '>';
}

function isSpaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

export function createBaseParser(): typeof acorn.Parser {
  return acorn.Parser.extend(tsPlugin({}) as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser, VeskParserPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser);
}

/**
 * Parse GENERATED JavaScript with plain acorn — no TypeScript plugin, no
 * `{#clause}` preprocessing, no comment blanking.
 *
 * The build parses every emitted module several times over (strip imports,
 * strip exports, collect runtime names, fold chunk imports), and on a CPU
 * profile of a 28-route build that parsing was two thirds of the whole build.
 * None of those passes need the `.vsk` pipeline: they only read top-level
 * import/export nodes out of code the code generator just produced, and acorn
 * reports the same offsets either way (blankComments and friends preserve
 * length). Measured on a 43 KB emitted chunk: 180 ms with the `.vsk` parser,
 * 36 ms here.
 *
 * Returns `null` when the source is not plain ES — anything with JSX, type
 * syntax or `{#clause}` markers — so callers fall back to `parse()` and keep
 * exactly the behaviour they had.
 */
export function parseGeneratedJs(source: string): Program | null {
  try {
    return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Program;
  } catch {
    return null;
  }
}

export function parse(source: string, options: ParseOptions = {}): Program {
  const ParserClass = createBaseParser();
  const { code, annotations } = preprocessForClauses(blankGenericArrowTypeParams(blankComments(source)));
  // Acorn validates that every `export { X }` names a real top-level binding.
  // A `.vsk` component is a registry entry, not a binding, so acorn rejects
  // `export { MyComponent }`. Remove only those specifier lists — one whose
  // local IS a real declaration keeps native module semantics — and carry the
  // pairs on the AST; the IR generator turns them into registry aliases.
  const vskSource = !options.filename || String(options.filename).endsWith('.vsk');
  const specifierExports = vskSource
    ? findSpecifierExports(code).filter((e) => !hasTopLevelValueDeclaration(code, e.local))
    : [];
  let parseable = code;
  if (specifierExports.length > 0) {
    const edits = specifierExports
      .map((e) => code.slice(e.start, e.end))
      .map((text) => text.split('').map((ch) => (ch === '\n' ? '\n' : ' ')).join(''));
    let cut = 0;
    for (const spec of specifierExports) {
      const blanked = edits[cut++];
      parseable = parseable.slice(0, spec.start) + blanked + parseable.slice(spec.end);
    }
  }
  try {
    const ast = (ParserClass as unknown as { parse(input: string, opts: Options): Program }).parse(parseable, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      ranges: true,
      ...(options.filename ? { sourceFilename: options.filename } : {}),
    } as Options);
    if (annotations.length > 0) {
      (ast as unknown as { __vskAnnotations?: VeskAnnotation[] }).__vskAnnotations = annotations;
    }
    if (specifierExports.length > 0) {
      (ast as unknown as { __vskSpecifierExports?: Array<{ local: string; exported: string }> }).__vskSpecifierExports = specifierExports.map(
        (e) => ({ local: e.local, exported: e.exported })
      );
    }
    return ast;
  } catch (e) {
    const err = e as SyntaxError & { loc?: { line: number; column: number }; pos?: number };
    // Acorn's SyntaxError already contains "(line:column)" in message and loc
    let line = 0;
    let column = 0;
    if (err.loc && typeof err.loc.line === 'number') {
      line = err.loc.line;
      column = (err.loc.column ?? 0) + 1;
    } else {
      const m = err.message.match(/\((\d+):(\d+)\)/);
      if (m) {
        line = parseInt(m[1], 10);
        column = parseInt(m[2], 10) + 1;
      }
    }
    const filename = (options.filename as string) || '';
    const cleanMessage = err.message.replace(/\s*\(\d+:\d+\)\s*$/, '');
    const frame = line > 0 ? codeFrame(source, line, column, 5, 5) : '';
    const hint = filename ? ` in ${filename}` : '';
    throw new VeskError(`${cleanMessage}${hint}`, {
      file: filename,
      line,
      column,
      code: frame,
      nextSteps: [
        'Check the line indicated by the ^ marker for missing brackets, quotes, or JSX syntax.',
        'If you wrote literal { or } inside JSX text, escape them as {\'{\'} and {\'}\'} or use &lbrace; &rbrace;.',
        'Ensure all JSX tags are properly closed and component names start with an uppercase letter.',
      ],
    });
  }
}
