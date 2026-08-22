/**
 * Auto-insert plugin — closes HTML tags when the user types `>`.
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

export function createAutoInsertPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-auto-insert',
    capabilities: {
      autoInsertionProvider: {
        triggerCharacters: ['>'],
      },
    },
    create(context) {
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

          const offset = document.offsetAt(position);
          const mapping = virtualCode.findMappingByGeneratedRange(lastChange.rangeOffset, offset);

          if (!mapping) {
            return null;
          }

          const sourceOffset = mapping.sourceOffsets[0];
          const sourceCode = virtualCode.originalCode;

          if (sourceCode[sourceOffset - 1] === '/') {
            // self-closing tag '/>'
            return null;
          }

          let found = false;
          let i = sourceOffset - 1;
          for (; i >= 0; i--) {
            const char = sourceCode[i];
            if (char === '<') {
              found = true;
              break;
            }
            if (char === '\n') {
              break;
            }
            if (char === '>' && sourceCode[i - 1] !== '/') {
              break;
            }
            if (char === '"' || char === "'") {
              break;
            }
          }
          if (!found) {
            return null;
          }

          const isComponentTag = /^[A-Z][\w$]*/.test(sourceCode.slice(i + 1));
          if (isComponentTag) {
            return null;
          }

          const tagNameStart = i + 1;
          const tagNameMatch = sourceCode.slice(tagNameStart).match(/^[a-zA-Z][\w$-]*/);
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
