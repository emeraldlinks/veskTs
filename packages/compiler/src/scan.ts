/**
 * Shared character-level scanners for structured text that regex is too
 * fragile to parse: balanced delimiters, strings, comments and top-level
 * separators. Used where the input can contain nested delimiters, `>`
 * inside quoted attributes or braces inside strings/comments.
 */

export function isWhitespaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\u00a0' || ch === '\ufeff';
}

export function isIdentStartCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 36 || code >= 128
  );
}

export function isIdentCharCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

export function isIdentStart(ch: string): boolean {
  return ch.length > 0 && isIdentCharCode(ch.charCodeAt(0));
}

export function isIdentChar(ch: string): boolean {
  return ch.length > 0 && isIdentCharCode(ch.charCodeAt(0));
}

/**
 * True when `text` (ignoring leading whitespace) begins with the whole
 * identifier `ident` — the character after it is not an identifier char,
 * and the character before its start is not an identifier char either.
 */
export function startsWithIdentifier(text: string, ident: string): boolean {
  let i = 0;
  while (i < text.length && isWhitespaceChar(text[i])) i++;
  if (text.slice(i, i + ident.length) !== ident) return false;
  if (i > 0 && isIdentChar(text[i - 1])) return false;
  const after = i + ident.length;
  return after >= text.length || !isIdentChar(text[after]);
}

/**
 * Strips a leading `const` / `let` / `var` keyword (plus surrounding
 * whitespace) from a declaration prefix. Returns the remainder or the
 * input unchanged when no keyword is present.
 */
export function stripDeclKeyword(text: string): string {
  for (const kw of ['const', 'let', 'var']) {
    if (startsWithIdentifier(text, kw)) {
      let i = 0;
      while (i < text.length && isWhitespaceChar(text[i])) i++;
      i += kw.length;
      while (i < text.length && isWhitespaceChar(text[i])) i++;
      return text.slice(i);
    }
  }
  return text;
}

/**
 * Removes trailing semicolons (and whitespace between them) from `text`.
 */
export function stripTrailingSemicolons(text: string): string {
  let end = text.length;
  while (end > 0) {
    const ch = text[end - 1];
    if (ch === ';') { end--; continue; }
    if (isWhitespaceChar(ch)) { end--; continue; }
    break;
  }
  return text.slice(0, end);
}

export function skipWhitespace(text: string, i: number): number {
  while (i < text.length && isWhitespaceChar(text[i])) i++;
  return i;
}

/**
 * Collapses runs starting at a newline into a single space (JSX text
 * normalization): every `\n` plus any following whitespace becomes `' '`.
 */
export function collapseNewlineWhitespace(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      out += ' ';
      while (i < text.length && isWhitespaceChar(text[i])) i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Skips a string starting at `i` (`"`, `'` or `` ` `` — backticks keep
 * nested `${...}` template depth). Returns the index just past the closing
 * quote, or `text.length` when unterminated.
 */
export function skipString(text: string, i: number): number {
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return i;
  let j = i + 1;
  if (quote === '`') {
    let depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '$' && text[j + 1] === '{') { depth++; j += 2; continue; }
      if (c === '}' && depth > 0) { depth--; j++; continue; }
      if (c === '`' && depth === 0) return j + 1;
      j++;
    }
    return text.length;
  }
  while (j < text.length) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === quote) return j + 1;
    j++;
  }
  return text.length;
}

/**
 * Skips a `//` or `/* ... *​/` comment starting at `i`. Returns the index
 * just past the comment (past the newline for `//`), or `i` when no
 * comment starts here.
 */
export function skipComment(text: string, i: number): number {
  if (text[i] === '/' && text[i + 1] === '/') {
    let j = i + 2;
    while (j < text.length && text[j] !== '\n') j++;
    return j;
  }
  if (text[i] === '/' && text[i + 1] === '*') {
    let j = i + 2;
    while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++;
    return Math.min(j + 2, text.length);
  }
  return i;
}

/**
 * Given the index of an opening `(`, `[` or `{`, returns the index of its
 * matching closing delimiter. Strings, `//` and `/* ... *​/` comments are
 * skipped so delimiters inside them do not count. Returns `text.length`
 * when the block is unterminated.
 */
export function findBalancedEnd(text: string, openIndex: number): number {
  const open = text[openIndex];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : null;
  if (close === null) return openIndex;
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { i = skipComment(text, i); continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return text.length;
}

/**
 * Splits `text` on every whole-identifier occurrence of `sep` that sits at
 * bracket depth 0, outside strings and comments. The identifier must be a
 * complete word (non-identifier characters on both sides), so `of` matches
 * `for (x of y)` but not `xoff` or `info`. The surrounding separator text
 * is not included in the parts.
 */
export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { i = skipComment(text, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth > 0) depth--;
    } else if (depth === 0 && c === sep[0] && text.slice(i, i + sep.length) === sep) {
      const before = i === 0 ? ' ' : text[i - 1];
      const after = i + sep.length < text.length ? text[i + sep.length] : ' ';
      if (!isIdentChar(before) && !isIdentChar(after)) {
        parts.push(text.slice(last, i).trimEnd());
        i += sep.length;
        while (i < text.length && isWhitespaceChar(text[i])) i++;
        last = i;
        continue;
      }
    }
    i++;
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * True when `text` contains a whole-identifier `of` or `in` at bracket
 * depth 0, outside strings and comments — used to tell `for (... of ...)`
 * and `for (... in ...)` headers apart from classic `for` loops.
 */
export function containsForOfIn(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) { i = skipComment(text, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth > 0) depth--;
    } else if (depth === 0 && (c === 'o' || c === 'i') && (text.slice(i, i + 2) === 'of' || text.slice(i, i + 2) === 'in')) {
      const before = i === 0 ? ' ' : text[i - 1];
      const after = i + 2 < text.length ? text[i + 2] : ' ';
      if (!isIdentChar(before) && !isIdentChar(after)) return true;
    }
    i++;
  }
  return false;
}

/**
 * Extracts the argument text of a `track<...>(...)` call from an init
 * expression. Handles nested generics (`track<Map<string, number>>(...)`)
 * and balanced parens in the argument. Returns the inner expression text,
 * or the original input when the text is not a whole `track(...)` call.
 */
export function unwrapTrackCall(init: string): string {
  const text = init.trim();
  if (!startsWithIdentifier(text, 'track')) return init;
  let i = skipWhitespace(text, 5);
  if (text[i] === '<') {
    i = skipTrackGeneric(text, i);
    i = skipWhitespace(text, i);
  }
  if (text[i] !== '(') return init;
  const end = findBalancedEnd(text, i);
  if (skipWhitespace(text, end + 1) !== text.length) return init;
  return text.slice(i + 1, end);
}

/**
 * Removes a leading `track<...>` generic clause from an init expression
 * (client-side `track` calls have no generic args). Returns the input
 * unchanged when it does not start with a `track<` generic.
 */
export function stripTrackGeneric(init: string): string {
  const text = init.trim();
  if (!startsWithIdentifier(text, 'track')) return init;
  let i = skipWhitespace(text, 5);
  if (text[i] !== '<') return init;
  const end = skipTrackGeneric(text, i);
  return text.slice(0, i) + text.slice(end);
}

export function skipTrackGeneric(text: string, open: number): number {
  let depth = 0;
  let j = open;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(text, j); continue; }
    if (c === '<') depth++;
    else if (c === '>') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return text.length;
}

/**
 * Scans a CSS block starting at `start` (an opening `{`) and returns the
 * index just past its matching `}`. Quoted strings and `/* ... *​/`
 * comments are skipped so braces inside them (e.g. `url("data:...{}")`)
 * do not confuse the nesting count.
 */
export function cssBlockEnd(css: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = skipString(css, i);
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      i = skipComment(css, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

/**
 * Given the index of a `<` in HTML, returns the index just past the
 * matching `>` — `>` inside quoted attribute values is not treated as a
 * delimiter. Returns `-1` when the tag is unterminated.
 */
export function htmlTagEnd(html: string, lt: number): number {
  let i = lt + 1;
  while (i < html.length) {
    const c = html[i];
    if (c === '"' || c === "'") {
      i = skipString(html, i);
      continue;
    }
    if (c === '>') return i + 1;
    i++;
  }
  return -1;
}

/**
 * Reads the tag name of an HTML token like `<div`, `</span>` or `<my-el`.
 * Returns `null` when the token is not a tag. The tag name itself cannot
 * contain quotes or `>` so a simple character scan suffices.
 */
export function htmlTagName(token: string): string | null {
  let i = 0;
  if (token[i] !== '<') return null;
  i++;
  if (token[i] === '/') i++;
  const start = i;
  while (i < token.length) {
    const code = token.charCodeAt(i);
    if (
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45
    ) {
      i++;
    } else break;
  }
  return i > start ? token.slice(start, i) : null;
}
