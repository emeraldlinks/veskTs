/**
 * Completion plugin — supplies vesk-level completion items at positions where
 * TypeScript contributes nothing (token-boundary positions where the TS
 * language service is unavailable, e.g. right after `<Tag ` or after `{`).
 */

import type { LanguageServicePlugin } from '@volar/language-service';
import { CompletionItemKind, InsertTextFormat, MarkupKind } from 'vscode-languageserver-types';
import { getVirtualCode, createLogging, isInsideImport, isInsideExport } from '../utils';
import { VeskVirtualCode, scanReactiveBindings, scanComponentUsages } from '../language-plugin';
import { EVENT_HANDLER_NAMES, EVENT_HANDLERS, COMPLETION_GLOBALS } from '../knowledge';

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

/**
 * True when the offset sits in the attribute area of an open tag — between the
 * tag name and the closing `>` (e.g. `<Card `, `<Card t|itle=`).
 */
function isInTagAttributeArea(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const tagStart = before.lastIndexOf('<');
  const lineStart = before.lastIndexOf('\n');
  if (tagStart <= lineStart) {
    return false;
  }
  const tagSegment = before.slice(tagStart + 1);
  if (!/^[A-Za-z][\w$-]*(\s|$)/.test(tagSegment)) {
    return false;
  }
  return !/[>=]/.test(tagSegment);
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
          const linePrefix = source.slice(0, offset);
          // Prefix-only word (matching the caret-at-end semantics of the old
          // heuristic LSP): a caret right after `<Card ` completes an empty
          // word, not the `title` that happens to start at the offset.
          const lastWord = linePrefix.match(/[a-zA-Z_$][\w$]*$/)?.[0] || '';
          const wordRegex = new RegExp(`^${escapeRegex(lastWord)}`);

          const isAttrPosition = isInTagAttributeArea(source, offset);
          const isExpressionPosition = /{[^}]*$/.test(linePrefix) && !isAttrPosition;

          log(`Completion at offset ${offset}: attr=${isAttrPosition} expr=${isExpressionPosition} word='${lastWord}'`);

          if (isAttrPosition) {
            const items = buildAttributeItems(source, offset, wordRegex);
            return items.length > 0 ? { isIncomplete: true, items } : undefined;
          }

          if (isExpressionPosition) {
            const items = buildExpressionItems(source, wordRegex);
            return items.length > 0 ? { isIncomplete: true, items } : undefined;
          }

          // Tag-open position: `<` (or `<Name`) — offer intrinsics + components.
          if (/<\s*$/.test(linePrefix) || /<\s*[A-Za-z]*$/.test(linePrefix)) {
            const items: any[] = [];
            for (const tag of INTRINSIC_TAGS) {
              if (wordRegex.test(tag)) {
                items.push({
                  label: tag,
                  kind: CompletionItemKind.Class,
                  detail: 'Vesk intrinsic',
                  insertText: tag,
                });
              }
            }
            const components = scanComponentUsages(source);
            for (const [name] of components) {
              if (wordRegex.test(name)) {
                items.push({
                  label: name,
                  kind: CompletionItemKind.Class,
                  detail: 'Component',
                  insertText: name,
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
  const currentTagName = segment.match(/^<\s*([A-Z][\w$]*)/)?.[1] ?? null;

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
