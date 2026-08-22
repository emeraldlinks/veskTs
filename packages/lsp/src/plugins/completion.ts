/**
 * Completion plugin — supplies vesk-level completion items at positions where
 * TypeScript contributes nothing (token-boundary positions where the TS
 * language service is unavailable, e.g. right after `<Tag ` or after `{`).
 */

import type { LanguageServicePlugin } from '@volar/language-service';
import { CompletionItemKind, InsertTextFormat, MarkupKind } from 'vscode-languageserver-types';
import { getVirtualCode, createLogging, isInsideImport, isInsideExport } from '../utils';
import { VeskVirtualCode, scanReactiveBindings, scanComponentUsages } from '../language-plugin';
import { EVENT_HANDLER_NAMES, EVENT_HANDLERS, COMPLETION_GLOBALS, HTML_ELEMENTS, VOID_ELEMENTS, HTML_ELEMENT_DOCS, GLOBAL_HTML_ATTRIBUTES, TAG_SPECIFIC_ATTRIBUTES } from '../knowledge';

const { log } = createLogging('[Vesk Completion Plugin]');

/** Intrinsic tag names (Head, Form, ...) offered at tag-open positions. */
const INTRINSIC_TAGS = [
  'Head',
  'Form',
  'Field',
  'Link',
  'NavLink',
  'Outlet',
  'Image',
  'Portal',
  'Experiment',
  'JsonLd',
  'ArticleSchema',
  'ProfileSchema',
  'SoftwareSchema',
  'Script',
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Completion-relevant caret contexts inside a .vsk file. */
type CompletionContext = 'tag-open' | 'attr' | 'expr' | 'none';

/**
 * Classify the caret context with one forward pass over the text before the
 * offset, using a stack-based state machine:
 * - code: TS statements (default)
 * - tag:  inside an element's opening tag (`<div class="x" … >`)
 * - expr: inside a `{ … }` container — a JSX expression in an open tag, or a
 *   statement/object brace in a component body
 *
 * `<Name` pushes `tag` from ANY state (statement-mode bodies hold bare JSX
 * inside plain braces), `{` pushes `expr`, and each closer pops back to
 * whatever context opened it — so attribute expressions return to their tag,
 * and tags inside body braces return to their expression.
 *
 * Strings, template literals and comments are stepped over so attribute
 * values containing `>`/`{`/`<` don't derail the state machine. Replaces the
 * old line-prefix heuristics, which misclassified component bodies
 * (`component X() {` + bare JSX) as "inside an expression".
 */
function classifyCompletionContext(text: string, offset: number): CompletionContext {
  const start = Math.max(0, offset - 8000);
  const stack: Array<'tag' | 'expr'> = [];
  let state: 'code' | 'tag' | 'expr' = 'code';
  let quote: string | null = null;

  const enter = (s: 'tag' | 'expr'): 'tag' | 'expr' => {
    stack.push(s);
    return s;
  };
  const exit = (): 'code' | 'tag' | 'expr' => stack.pop() ?? 'code';

  let i = start;
  while (i < offset) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }

    switch (state) {
      case 'code': {
        if (ch === '/' && text[i + 1] === '/') {
          // line comment
          while (i < offset && text[i] !== '\n') i++;
          continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
          // block comment
          const end = text.indexOf('*/', i + 2);
          if (end === -1 || end >= offset) return 'none';
          i = end + 2;
          continue;
        }
        if (ch === '{') {
          state = enter('expr');
          break;
        }
        if (ch === '<') {
          const nextChar = text[i + 1];
          if (nextChar && /[A-Za-z]/.test(nextChar)) {
            state = enter('tag');
            break;
          }
          if (nextChar === '>') {
            // fragment open `<>` — skip its `>` as part of the tag
            state = enter('tag');
            i++;
          }
        }
        break;
      }
      case 'tag': {
        if (ch === '{') {
          state = enter('expr');
          break;
        }
        if (ch === '>') {
          state = exit();
          break;
        }
        if (ch === '/' && text[i + 1] === '>') {
          state = exit();
          i++;
          break;
        }
        if (ch === '<') {
          // malformed nesting — treat as a new tag start attempt
          const nextChar = text[i + 1];
          if (nextChar && /[A-Za-z/>]/.test(nextChar)) {
            state = enter('tag');
          }
        }
        break;
      }
      case 'expr': {
        if (ch === '{') {
          state = enter('expr');
          break;
        }
        if (ch === '}') {
          state = exit();
          break;
        }
        if (ch === '<') {
          const nextChar = text[i + 1];
          if (nextChar && /[A-Za-z]/.test(nextChar)) {
            state = enter('tag'); // JSX element inside a statement body / expression
          }
        }
        break;
      }
    }
    i++;
  }

  if (state === 'expr') {
    return 'expr';
  }
  if (state !== 'tag') {
    return 'none';
  }

  // Inside an open tag: distinguish tag-name position from attribute area by
  // whether whitespace follows the tag name before the caret.
  let tagStart = offset - 1;
  while (tagStart >= start && text[tagStart] !== '<') tagStart--;
  const segment = text.slice(tagStart + 1, offset);
  const nameMatch = segment.match(/^[A-Za-z][\w$.:-]*/);
  if (!nameMatch) {
    // Caret directly after `<` — a tag-name position.
    return segment.length === 0 ? 'tag-open' : 'none';
  }
  const afterName = segment.slice(nameMatch[0].length);
  return afterName.length > 0 ? 'attr' : 'tag-open';
}

export function createCompletionPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-completion',
    capabilities: {
      completionProvider: {
        resolveProvider: false,
      },
    },
    create(context) {
      return {
        isAdditionalCompletion: true,
        async provideCompletionItems(document, position, _completionContext, _token) {
          if (!document.uri.endsWith('.vsk')) {
            return undefined;
          }

          const { virtualCode } = getVirtualCode(document, context);
          if (!(virtualCode instanceof VeskVirtualCode)) {
            return undefined;
          }

          const source = document.getText();
          const offset = document.offsetAt(position);
          // Heuristics run on the ORIGINAL .vsk text, not the generated
          // virtual code: generated JSX is collapsed/reordered and chunk-level
          // mappings can place a mid-JSX caret somewhere unrelated (e.g.
          // inside the cell-decl preamble), which would misclassify context.
          const originalText = virtualCode.originalCode || source;
          const mappedSourceOffset = virtualCode.generatedOffsetToSourceOffset(offset);
          const srcOffset = mappedSourceOffset ?? offset;
          const linePrefix = originalText.slice(0, srcOffset);
          // Prefix-only word (matching the caret-at-end semantics of the old
          // heuristic LSP): a caret right after `<Card ` completes an empty
          // word, not the `title` that happens to start at the offset.
          const lastWord = linePrefix.match(/[a-zA-Z_$][\w$]*$/)?.[0] || '';
          const wordRegex = new RegExp(`^${escapeRegex(lastWord)}`);

          const contextKind = classifyCompletionContext(originalText, srcOffset);

          log(
            `Completion gen-offset=${offset} src-offset=${srcOffset}: context=${contextKind} word='${lastWord}'`,
          );

          if (contextKind === 'attr') {
            const items = buildAttributeItems(originalText, srcOffset, wordRegex);
            return items.length > 0 ? { isIncomplete: true, items } : undefined;
          }

          if (contextKind === 'expr') {
            const items = buildExpressionItems(originalText, wordRegex);
            return items.length > 0 ? { isIncomplete: true, items } : undefined;
          }

          // Tag-open position: `<` (or `<Name`) — offer intrinsics + components.
          if (contextKind === 'tag-open') {
            const items: any[] = [];
            for (const tag of HTML_ELEMENTS) {
              if (!wordRegex.test(tag)) {
                continue;
              }
              items.push({
                label: tag,
                kind: CompletionItemKind.Class,
                detail: 'HTML element',
                documentation: VOID_ELEMENTS.has(tag)
                  ? { kind: MarkupKind.Markdown, value: `${HTML_ELEMENT_DOCS[tag] ?? ''}\n\nVoid element — no closing tag.` }
                  : HTML_ELEMENT_DOCS[tag]
                    ? { kind: MarkupKind.Markdown, value: HTML_ELEMENT_DOCS[tag] }
                    : undefined,
                insertText: tag,
                // Rank above generic TS scope suggestions at tag positions.
                sortText: `0${tag}`,
              });
            }
            for (const tag of INTRINSIC_TAGS) {
              if (wordRegex.test(tag)) {
                items.push({
                  label: tag,
                  kind: CompletionItemKind.Class,
                  detail: 'Vesk intrinsic',
                  insertText: tag,
                  sortText: `0${tag}`,
                });
              }
            }
            const components = scanComponentUsages(originalText);
            for (const [name] of components) {
              if (wordRegex.test(name)) {
                items.push({
                  label: name,
                  kind: CompletionItemKind.Class,
                  detail: 'Component',
                  insertText: name,
                  sortText: `1${name}`,
                });
              }
            }
            return items.length > 0 ? { isIncomplete: true, items } : undefined;
          }

          // Suppress TS items inside import/export statements.
          if (isInsideImport(source, offset) || isInsideExport(source, offset)) {
            return undefined;
          }

          return undefined;
        },
      };
    },
  };
}

function buildAttributeItems(source: string, offset: number, wordRegex: RegExp): any[] {
  const items: any[] = [];
  const seen = new Set<string>();

  const push = (label: string, kind: CompletionItemKind, detail: string, docs?: string) => {
    if (seen.has(label) || !wordRegex.test(label)) {
      return;
    }
    seen.add(label);
    items.push({
      label,
      kind,
      detail,
      documentation: docs ? { kind: MarkupKind.Markdown, value: docs } : undefined,
      insertText: `${label}={$0}`,
      insertTextFormat: InsertTextFormat.Snippet,
    });
  };

  // Current tag's already-used attribute names, so they can be excluded.
  const before = source.slice(0, offset);
  const tagStart = before.lastIndexOf('<');
  const tagEnd = source.indexOf('>', tagStart);
  const segment = source.slice(tagStart, tagEnd === -1 ? source.length : tagEnd);
  const currentTagName = segment.match(/^<\s*([A-Za-z][\w$]*)/)?.[1] ?? null;

  const usedNames = new Set<string>();
  const usedPattern = /([\w$]+)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g;
  let usedMatch: RegExpExecArray | null;
  while ((usedMatch = usedPattern.exec(segment)) !== null) {
    usedNames.add(usedMatch[1]);
  }

  // Inferred props: union of attribute names seen on usages of the current tag
  // (or of every component tag when the current tag can't be determined).
  const usages = scanComponentUsages(source);
  const inferredProps = new Set<string>();
  for (const [tagName, usage] of usages) {
    if (currentTagName && currentTagName !== tagName) {
      continue;
    }
    for (const attr of usage.attrs) {
      inferredProps.add(attr);
    }
  }
  for (const attr of inferredProps) {
    if (usedNames.has(attr)) {
      continue;
    }
    push(attr, CompletionItemKind.Property, 'Component prop');
  }

  // Event handlers with docs.
  for (const ev of EVENT_HANDLER_NAMES) {
    if (usedNames.has(ev)) {
      continue;
    }
    push(ev, CompletionItemKind.Event, 'Event handler', EVENT_HANDLERS[ev]);
  }

  // HTML attributes for intrinsic (lowercase) element tags.
  if (currentTagName && currentTagName[0] === currentTagName[0].toLowerCase()) {
    for (const attr of GLOBAL_HTML_ATTRIBUTES) {
      push(attr, CompletionItemKind.Property, 'HTML attribute');
    }
    const tagAttrs = TAG_SPECIFIC_ATTRIBUTES[currentTagName];
    for (const attr of tagAttrs ?? []) {
      push(attr, CompletionItemKind.Property, `<${currentTagName}> attribute`);
    }
  }

  // The `props` param is always available in component bodies.
  push('props', CompletionItemKind.Variable, 'Component parameter');

  return items;
}

function buildExpressionItems(source: string, wordRegex: RegExp): any[] {
  const items: any[] = [];
  const seen = new Set<string>();

  const push = (label: string, kind: CompletionItemKind, detail: string) => {
    if (seen.has(label) || !wordRegex.test(label)) {
      return;
    }
    seen.add(label);
    items.push({ label, kind, detail });
  };

  for (const name of scanReactiveBindings(source)) {
    push(name, CompletionItemKind.Variable, 'Reactive binding');
  }

  // Runtime imports actually used in this file (`import { track } from '@vesk/runtime'`).
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]@vesk\/runtime['"]/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importPattern.exec(source)) !== null) {
    for (const name of importMatch[1].split(',')) {
      const trimmed = name.trim();
      if (trimmed) {
        push(trimmed, CompletionItemKind.Function, 'Runtime function');
      }
    }
  }

  push('props', CompletionItemKind.Variable, 'Component parameter');

  for (const g of COMPLETION_GLOBALS) {
    push(g.name, CompletionItemKind.Variable, g.detail);
  }

  return items;
}
