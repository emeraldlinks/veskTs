/**
 * Auto-insert plugin — closes HTML tags when the user types `>`.
 *
 * All heuristics run on the ORIGINAL .vsk text: the incoming `position` is a
 * caret mapped into generated coordinates, which chunk-level mappings can
 * smear across collapsed/reordered generated code. Mapping back through
 * VeskVirtualCode and scanning the user's own text is exact in both compiled
 * and transient-error (retained last-good) states.
 *
 * The VS Code client must actively send the `volar/client/autoInsert` request
 * on text changes (see extension/vsk-vscode/src/extension.ts); vanilla
 * vscode-languageclient does not do this on its own.
 *
 * The back-scan is a small state machine: it steps over quoted attribute
 * values ("…" / '…'), template literals (`…`), and braced expressions ({…},
 * including strings nested inside), so tags WITH attributes auto-close too —
 * a naive scan that stops at the first quote would kill every
 * `<div class="x">`.
 */

import type { LanguageServicePlugin } from '@volar/language-service';
import { getVirtualCode, createLogging } from '../utils';
import { VeskVirtualCode } from '../language-plugin';

const { log } = createLogging('[Vesk Auto-Insert Plugin]');

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'command',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Scan bounds so pathological input can't stall completion latency. */
const MAX_SCAN_CHARS = 2000;
const MAX_SCAN_LINES = 12;

/**
 * Walk backwards from the character before `offset` to find the `<` that
 * opens the tag whose `>` was just typed. Returns the index of `<`, or -1.
 *
 * Terminates without a match when the scan proves the caret is not inside a
 * tag: another unquoted `>` (sibling tag / arrow function), a statement `;`,
 * a `{` at brace depth 0 (JSX expression region), or an unterminated string.
 */
function findTagOpen(text: string, offset: number): number {
  let braces = 0;
  let quote: string | null = null;
  let newlines = 0;

  const min = Math.max(0, offset - MAX_SCAN_CHARS);
  let i = offset - 2;
  for (; i >= min; i--) {
    const char = text[i];

    if (char === '\n') {
      newlines++;
      if (newlines > MAX_SCAN_LINES) {
        return -1;
      }
    }

    if (quote) {
      if (char === '\\' && i - 1 >= min) {
        i--; // skip escaped character inside string
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (braces > 0) {
      if (char === '}') {
        braces++;
      } else if (char === '{') {
        braces--;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '}') {
      braces++;
      continue;
    }
    if (char === '<') {
      return i;
    }
    // Not plausibly part of an open tag.
    if (char === '>' || char === '{' || char === ';') {
      return -1;
    }
  }
  return -1;
}

export function createAutoInsertPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-auto-insert',
    capabilities: {
      autoInsertionProvider: {
        triggerCharacters: ['>'],
      },
    },
    create(context) {
      // volar-service-typescript's `typescript-syntactic` plugin answers the
      // same request with its own JSX close-tag snippets (e.g. `$0</br>` even
      // for void elements). Volar takes the FIRST non-empty result, so ours
      // already wins when it has an answer — but for every case we decline
      // (void, self-closing, components) TS's would leak through. Disable
      // theirs entirely: vesk owns tag auto-insertion.
      for (const [plugin, instance] of context.plugins) {
        if (plugin.name === 'typescript-syntactic' && instance.provideAutoInsertSnippet) {
          instance.provideAutoInsertSnippet = undefined;
        }
      }
      return {
        async provideAutoInsertSnippet(document, position, lastChange, _token) {
          if (!document.uri.endsWith('.vsk')) {
            return null;
          }

          if (!lastChange.text.endsWith('>')) {
            return null;
          }

          const { virtualCode } = getVirtualCode(document, context);

          if (!(virtualCode instanceof VeskVirtualCode)) {
            return null;
          }

          const text = virtualCode.originalCode || document.getText();
          const mappedCaret = virtualCode.generatedOffsetToSourceOffset(document.offsetAt(position));
          // Tolerate small mapping drift: skip whitespace back to what must be
          // the typed '>'.
          let caret = Math.min(mappedCaret ?? document.offsetAt(position), text.length);
          while (caret > 0 && /\s/.test(text[caret - 1])) {
            caret--;
          }
          if (caret < 1 || text[caret - 1] !== '>') {
            return null;
          }

          // Self-closing tag '/>'.
          if (text[caret - 2] === '/') {
            return null;
          }

          const tagOpen = findTagOpen(text, caret);
          if (tagOpen < 0) {
            return null;
          }

          const isComponentTag = /^[A-Z][\w$]*/.test(text.slice(tagOpen + 1));
          if (isComponentTag) {
            return null;
          }

          const tagNameMatch = text.slice(tagOpen + 1).match(/^[a-zA-Z][\w$-]*/);
          if (!tagNameMatch) {
            return null;
          }
          const tagName = tagNameMatch[0];
          if (VOID_ELEMENTS.has(tagName)) {
            return null;
          }

          log(`Auto-insert closing tag for '${tagName}'`);
          return `</${tagName}>`;
        },
      };
    },
  };
}
