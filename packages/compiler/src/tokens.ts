/**
 * Token-based syntax analysis built on the acorn tokenizer (via the Vesk
 * TS/JSX parser). The tokenizer understands generics, JSX, template
 * literals and the `&[...]` track-declaration sugar, so identifier-call
 * detection and import parsing no longer need regexes. Every helper falls
 * back to a character-level scan when the input cannot be tokenized (e.g.
 * mid-edit content or partial fragments), so callers never crash on
 * unparsable text.
 */

import { createBaseParser } from '@vesk/compiler/src/parser';
import {
  skipString,
  skipComment,
  skipWhitespace,
  skipTrackGeneric,
  isIdentStart,
  isIdentChar,
} from '@vesk/compiler/src/scan';

export interface CodeToken {
  label: string;
  value: string;
  start: number;
  end: number;
}

/**
 * Tokenizes `code` with the Vesk parser's tokenizer. Returns an array of
 * tokens (excluding EOF), or `null` when the input cannot be tokenized.
 * `value` holds identifier/keyword/string text; punctuation tokens expose
 * their span so callers can read the actual character via `code[start]`.
 */
export function tokenizeCode(code: string): CodeToken[] | null {
  try {
    const ParserClass = createBaseParser();
    const tok = (ParserClass as unknown as { tokenizer(input: string, opts: unknown): { getToken(): any } }).tokenizer(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
    const out: CodeToken[] = [];
    let t: any;
    while ((t = tok.getToken()) && t.type && t.type.label !== 'eof') {
      out.push({
        label: t.type.label,
        value: typeof t.value === 'string' ? t.value : '',
        start: t.start,
        end: t.end,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Returns the set of identifiers in `code` that are called — an identifier
 * token immediately followed by `(` or by a `<...>` generic clause and then
 * `(`. Member accesses (`obj.fn(`, `obj?.fn(`) are excluded so methods are
 * not mistaken for imported runtime functions.
 */
export function collectCalledIdentifiers(code: string): Set<string> {
  const tokens = tokenizeCode(code);
  if (tokens !== null) {
    const result = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.label !== 'name') continue;
      const prev = i > 0 ? tokens[i - 1] : null;
      if (prev && (prev.label === '.' || prev.label === '?.')) continue;
      const next = tokens[i + 1];
      if (!next) continue;
      const nextCh = code[next.start];
      if (nextCh === '(' || nextCh === '<') result.add(t.value);
    }
    return result;
  }
  return manualCollectCalledIdentifiers(code);
}

/**
 * True when `code` contains the identifier `name` (as a plain identifier or
 * a JSX name), outside strings and comments.
 */
export function containsIdentifier(code: string, name: string): boolean {
  const tokens = tokenizeCode(code);
  if (tokens !== null) {
    for (const t of tokens) {
      if ((t.label === 'name' || t.label === 'jsxName') && t.value === name) return true;
    }
    return false;
  }
  return manualContainsIdentifier(code, name);
}

/**
 * True when an `import` statement in `code` imports the name `name`.
 */
export function isIdentifierImported(code: string, name: string): boolean {
  const tokens = tokenizeCode(code);
  if (tokens !== null) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].label !== 'import') continue;
      let j = i + 1;
      while (
        j < tokens.length &&
        tokens[j].label !== ';' &&
        !(tokens[j].label === 'name' && tokens[j].value === 'from')
      ) {
        j++;
      }
      for (let k = i + 1; k < j; k++) {
        if ((tokens[k].label === 'name' || tokens[k].label === 'jsxName') && tokens[k].value === name) return true;
      }
      i = j;
    }
    return false;
  }
  return manualIsIdentifierImported(code, name);
}

/**
 * Extracts the locally-bound names from a single import statement
 * (`import { a as b, type C } from 'm'` → `['b']`; `import X from 'm'` and
 * `import * as X from 'm'` → `['X']`). Type-only specifiers are dropped.
 */
export function extractImportNames(importText: string): string[] {
  const tokens = tokenizeCode(importText);
  if (tokens !== null) {
    const names: string[] = [];
    let i = 0;
    while (i < tokens.length && tokens[i].label !== 'import') i++;
    if (i >= tokens.length) return names;
    i++;
    if (i < tokens.length && tokens[i].label === 'name' && tokens[i].value === 'type') i++;
    if (i < tokens.length && tokens[i].label === '{') {
      i++;
      while (i < tokens.length && tokens[i].label !== '}') {
        const t = tokens[i];
        if (t.label === 'name') {
          if (t.value === 'type' || t.value === 'typeof') { i++; continue; }
          let name = t.value;
          if (
            i + 2 < tokens.length &&
            tokens[i + 1].label === 'name' && tokens[i + 1].value === 'as' &&
            tokens[i + 2].label === 'name'
          ) {
            name = tokens[i + 2].value;
            i += 2;
          }
          names.push(name);
        }
        i++;
      }
      return names;
    }
    if (i < tokens.length && tokens[i].label === '*') {
      while (i < tokens.length && tokens[i].label !== 'name') i++;
      if (i < tokens.length) names.push(tokens[i].value);
    } else if (i < tokens.length && tokens[i].label === 'name') {
      names.push(tokens[i].value);
    }
    return names;
  }
  return manualExtractImportNames(importText);
}

/**
 * Returns the module specifier of an import statement — the string literal
 * after `from` (or the bare side-effect string). `null` when none found.
 */
export function importModuleTarget(importText: string): string | null {
  const tokens = tokenizeCode(importText);
  if (tokens === null) return null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].label === 'string') return tokens[i].value;
  }
  return null;
}

function manualCollectCalledIdentifiers(code: string): Set<string> {
  const result = new Set<string>();
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
    if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) { i = skipComment(code, i); continue; }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < code.length && isIdentChar(code[j])) j++;
      const before = i === 0 ? '' : code[i - 1];
      if (before !== '.' && !isIdentChar(before)) {
        let k = skipWhitespace(code, j);
        if (code[k] === '<') k = skipTrackGeneric(code, k);
        if (code[k] === '(') result.add(code.slice(i, j));
      }
      i = j;
      continue;
    }
    i++;
  }
  return result;
}

function manualContainsIdentifier(code: string, name: string): boolean {
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
    if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) { i = skipComment(code, i); continue; }
    if (isIdentStart(c) && code.slice(i, i + name.length) === name) {
      const after = i + name.length;
      if ((after >= code.length || !isIdentChar(code[after])) && (i === 0 || !isIdentChar(code[i - 1]))) return true;
    }
    i++;
  }
  return false;
}

function manualIsIdentifierImported(code: string, name: string): boolean {
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
    if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) { i = skipComment(code, i); continue; }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < code.length && isIdentChar(code[j])) j++;
      const word = code.slice(i, j);
      if (word === 'import') {
        let k = j;
        while (k < code.length) {
          if (code[k] === ';' || code[k] === '\n') break;
          if (code[k] === '"' || code[k] === "'" || code[k] === '`') { k = skipString(code, k); continue; }
          if (isIdentStart(code[k]) && code.slice(k, k + name.length) === name) {
            const a = k + name.length;
            if ((a >= code.length || !isIdentChar(code[a])) && (k === 0 || !isIdentChar(code[k - 1]))) return true;
          }
          k++;
        }
      }
      i = j;
      continue;
    }
    i++;
  }
  return false;
}

function manualExtractImportNames(importText: string): string[] {
  const names: string[] = [];
  const open = importText.indexOf('{');
  if (open !== -1) {
    const close = importText.indexOf('}', open + 1);
    if (close !== -1) {
      let i = open + 1;
      while (i < close) {
        const c = importText[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(importText, i); continue; }
        if (isIdentStart(c)) {
          let j = i + 1;
          while (j < close && isIdentChar(importText[j])) j++;
          let word = importText.slice(i, j);
          if (word === 'type' || word === 'typeof') { i = j; continue; }
          let k = skipWhitespace(importText, j);
          if (importText.slice(k, k + 2) === 'as' && !isIdentChar(importText[k + 2])) {
            let m = skipWhitespace(importText, k + 2);
            if (isIdentStart(importText[m])) {
              let n = m + 1;
              while (n < close && isIdentChar(importText[n])) n++;
              word = importText.slice(m, n);
            }
          }
          names.push(word);
          i = j;
          continue;
        }
        i++;
      }
      return names;
    }
  }
  let i = 0;
  while (i < importText.length && !isIdentStart(importText[i])) i++;
  while (i < importText.length && isIdentChar(importText[i])) i++;
  i = skipWhitespace(importText, i);
  if (importText[i] === '*') {
    i = skipWhitespace(importText, i + 1);
    if (importText.slice(i, i + 2) === 'as') i = skipWhitespace(importText, i + 2);
    if (isIdentStart(importText[i])) {
      let j = i + 1;
      while (j < importText.length && isIdentChar(importText[j])) j++;
      names.push(importText.slice(i, j));
    }
  } else if (isIdentStart(importText[i])) {
    let j = i + 1;
    while (j < importText.length && isIdentChar(importText[j])) j++;
    names.push(importText.slice(i, j));
  }
  return names;
}
