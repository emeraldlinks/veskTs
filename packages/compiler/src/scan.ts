/**
 * Shared character-level scanners for structured text that regex is too
 * fragile to parse: balanced delimiters, strings, comments and top-level
 * separators. Used where the input can contain nested delimiters, `>`
 * inside quoted attributes or braces inside strings/comments.
 */

export function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
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
 * Splits `text` on every match of `sep` that occurs at bracket depth 0,
 * outside strings and comments. `sep` is matched with its own flags plus
 * `g` (a new global regex is built, so a sticky `y` flag is not preserved).
 */
export function splitTopLevel(text: string, sep: RegExp): string[] {
  const re = new RegExp(sep.source, sep.flags.includes('g') ? sep.flags : sep.flags + 'g');
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
    } else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m.index === i) {
        parts.push(text.slice(last, i));
        i += m[0].length;
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
 * Extracts the argument text of a `track<...>(...)` call from an init
 * expression. Handles nested generics (`track<Map<string, number>>(...)`)
 * and balanced parens in the argument. Returns the inner expression text,
 * or the original input when the text is not a whole `track(...)` call.
 */
export function unwrapTrackCall(init: string): string {
  const text = init.trim();
  const m = /^track\b/.exec(text);
  if (!m) return init;
  let i = skipWhitespace(text, m[0].length);
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
  const m = /^track\b/.exec(text);
  if (!m) return init;
  let i = skipWhitespace(text, m[0].length);
  if (text[i] !== '<') return init;
  const end = skipTrackGeneric(text, i);
  return text.slice(0, i) + text.slice(end);
}

function skipTrackGeneric(text: string, open: number): number {
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
  while (i < token.length && /[a-zA-Z0-9-]/.test(token[i])) i++;
  return i > start ? token.slice(start, i) : null;
}
