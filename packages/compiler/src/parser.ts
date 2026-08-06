import * as acorn from 'acorn';
import type { Options } from 'acorn';
import type { Program } from 'estree';
import { tsPlugin } from './acorn-ts-plugin/index.js';
import { VeskParserPlugin } from '@vesk/compiler/src/vesk-plugin';
import { containsForOfIn } from '@vesk/compiler/src/scan';

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

export function createBaseParser(): typeof acorn.Parser {
  return acorn.Parser.extend(tsPlugin({}) as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser, VeskParserPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser);
}

export function parse(source: string, options: ParseOptions = {}): Program {
  const ParserClass = createBaseParser();
  const { code, annotations } = preprocessForClauses(source);
  const ast = (ParserClass as unknown as { parse(input: string, opts: Options): Program }).parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    ...(options.filename ? { sourceFilename: options.filename } : {}),
  } as Options);
  if (annotations.length > 0) {
    (ast as unknown as { __vskAnnotations?: VeskAnnotation[] }).__vskAnnotations = annotations;
  }
  return ast;
}
