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
import { withStandaloneTokens } from '@vesk/compiler/src/vesk-plugin';
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
  // No parser runs here, so the plugin cannot infer component bodies from its
  // own component-depth counter and every JSX tag would be read as relational
  // operators. `withStandaloneTokens` asks it to read JSX tags directly.
  return withStandaloneTokens(() => {
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
  });
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
      if (prev && (prev.label === '.' || prev.label === '?.')) {
        // Member calls (`useFetch.text(`) surface the receiver so an
        // auto-importable function used as a receiver is still imported.
        const obj = i >= 2 ? tokens[i - 2] : null;
        const next = tokens[i + 1];
        if (obj && obj.label === 'name' && next) {
          const nextCh = code[next.start];
          if (nextCh === '(' || nextCh === '<') result.add(obj.value);
        }
        continue;
      }
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
  let prevIdent: [number, number] | null = null;
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
      } else if (before === '.' && prevIdent) {
        let p = i - 1;
        while (
          p > prevIdent[1] &&
          (code[p] === '.' || code[p] === '?' || code[p] === '\n' || code[p] === '\t' || code[p] === ' ')
        ) p--;
        if (p === prevIdent[1]) {
          let k = skipWhitespace(code, j);
          if (code[k] === '(') result.add(code.slice(prevIdent[0], prevIdent[1]));
        }
      }
      prevIdent = [i, j];
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

/**
 * True when `code` declares `name` as a real top-level value (`const`/`let`/
 * `var`/`function`/`class`). Used to tell a `.vsk` component — a registry entry
 * with no binding — apart from an ordinary JS/TS declaration, whose
 * `export { name }` must keep native module semantics.
 */
export function hasTopLevelValueDeclaration(code: string, name: string): boolean {
  const tokens = tokenizeCode(code);
  if (tokens === null) return false;
  const declWords = ['const', 'let', 'var', 'function', 'class'];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].label !== 'name' || tokens[i].value !== name) continue;
    const prev = tokens[i - 1];
    // Declaration keywords carry their own token label (`const`, `var`,
    // `function`, `class`); `let` arrives as a plain name. Match on value.
    if (!prev || !declWords.includes(prev.value)) continue;
    // `export const X` / `export function X` are preceded by `export`.
    if (i >= 2) {
      const pp = tokens[i - 2];
      if (pp && pp.label === 'name' && pp.value === 'export') continue;
    }
    return true;
  }
  return false;
}

/** One entry of a same-file `export { A, B as C }` specifier list. */
export interface VskSpecifierExport {
  local: string;
  exported: string;
  /** Byte span of the whole `export { … }` statement, including any `;`. */
  start: number;
  end: number;
}

/**
 * Finds same-file export *specifier lists* — `export { A }`, `export { A as B }`
 * — and returns them with their source spans so the caller can remove them.
 *
 * A `.vsk` component is a registry entry keyed by its declared name, not a
 * top-level binding, so acorn's module validator rejects `export { A }` with
 * `Export 'A' is not defined`. Export *declarations* (`export component A`,
 * `export const A = 1`) and re-exports (`export … from '…'`) are left alone:
 * those parse fine and are handled in the IR generator.
 */
export function findSpecifierExports(code: string): VskSpecifierExport[] {
  const tokens = tokenizeCode(code);
  if (tokens === null) return [];
  const out: VskSpecifierExport[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].label !== 'export') continue;
    // A specifier list starts with `{`. `export default`, `export const` and
    // `export *` take another route and are left for the IR generator.
    if (!tokens[i + 1] || tokens[i + 1].label !== '{') continue;
    // Find this statement's `}` and note any module source, which makes it a
    // re-export (`export { A } from './x.vsk'`) rather than a specifier list.
    let k = i + 2;
    let depth = 1;
    for (; k < tokens.length; k++) {
      const lbl = tokens[k].label;
      if (lbl === 'string') { continue; }
      if (lbl === '{') depth++;
      else if (lbl === '}') { depth--; if (depth === 0) break; }
    }
    // A re-export puts `from '…'` AFTER the closing brace, so check past it.
    let isReexport = false;
    for (let j = k + 1; j < tokens.length; j++) {
      const lbl = tokens[j].label;
      if (lbl === 'string') { isReexport = true; break; }
      if (lbl === ';' || lbl === 'export' || lbl === 'import' || lbl === '}') break;
    }
    if (depth !== 0 || isReexport) continue;
    const pairs = readSpecifierPairs(code, tokens[i + 1].end, tokens[k].end);
    if (pairs === null) continue;
    const stmtEnd = tokens[k].end;
    for (const [local, exported] of pairs) out.push({ local, exported, start: tokens[i].start, end: stmtEnd });
    i = k;
  }
  return out;
}

/**
 * Reads `A, B as C` pairs from the text between a `{` and its matching `}`.
 * Returns `null` for anything that is not a plain (optionally `as`-aliased)
 * identifier list, so unusual forms are left to the normal parser.
 */
function readSpecifierPairs(code: string, from: number, to: number): Array<[string, string]> | null {
  // Wrapped in parens so a leading `{` is a block, not the start of an object.
  const tokens = tokenizeCode(`(${code.slice(from, to)})`);
  if (tokens === null || tokens.length < 2) return null;
  const pairs: Array<[string, string]> = [];
  let i = 1; // skip the '('
  while (i < tokens.length) {
    const local = tokens[i];
    if (!local || local.label === ')' || local.label === ';') break;
    if (local.label !== 'name') return null;
    const asTok = tokens[i + 1];
    if (asTok && asTok.label === 'name' && asTok.value === 'as') {
      const exported = tokens[i + 2];
      if (!exported || exported.label !== 'name') return null;
      pairs.push([local.value, exported.value]);
      i += 3;
    } else {
      pairs.push([local.value, local.value]);
      i += 1;
    }
    const sep = tokens[i];
    if (!sep || sep.label !== ',') break;
    i += 1;
  }
  return pairs.length > 0 ? pairs : null;
}

/**
 * The Vesk TrackDecl form `const &[count] = track(0)` exists only for the
 * parser: `VeskParserPlugin` consumes the `&` and returns an `ArrayPattern`
 * tagged `lazy: true` whose `start` points at the `[`. The marker character
 * itself survives in the source text, so every raw slice of that text is
 * invalid JavaScript — `new Function` rejects it, and a browser rejects the
 * whole module.
 *
 * Blank exactly those marker characters. Offsets come from the already parsed
 * AST (each `lazy` pattern's `start - 1`), never from a text scan.
 */
function collectTrackDeclMarkers(node: any, out: Set<number>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectTrackDeclMarkers(child, out);
    return;
  }
  if (node.type === 'ArrayPattern' && node.lazy === true && typeof node.start === 'number') {
    out.add(node.start - 1);
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') collectTrackDeclMarkers(value, out);
  }
}

/** `text` must be `source.slice(base, …)`; `node` is AST parsed from `source`. */
export function stripTrackDeclMarkers(text: string, base: number, node: any): string {
  const offsets = new Set<number>();
  collectTrackDeclMarkers(node, offsets);
  if (offsets.size === 0) return text;
  const sorted = [...offsets].sort((a, b) => a - b);
  let out = '';
  let prev = 0;
  for (const offset of sorted) {
    const i = offset - base;
    if (i < prev || i >= text.length) continue;
    out += text.slice(prev, i) + ' ';
    prev = i + 1;
  }
  return out + text.slice(prev);
}
