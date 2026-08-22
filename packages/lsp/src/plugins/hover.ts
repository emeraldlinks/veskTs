/**
 * Hover plugin — replaces volar-service-typescript's hover with a wrapper that
 * keeps TS hover when present and adds vesk-level documentation: event
 * handlers, HTML element docs (TS gives nothing for intrinsics), reactive
 * binding markers, and inferred component props.
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import { MarkupKind } from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { getVirtualCode, createLogging, getWordFromPosition, concatMarkdownContents } from '../utils';
import { VeskVirtualCode, scanReactiveBindings, scanComponentUsages } from '../language-plugin';
import { EVENT_HANDLERS, HTML_ELEMENTS, HTML_ELEMENT_DOCS } from '../knowledge';

const { log } = createLogging('[Vesk Hover Plugin]');

export function createHoverPlugin(): LanguageServicePlugin {
  return {
    name: 'vesk-hover',
    capabilities: {
      hoverProvider: true,
    },
    create(context) {
      // Disable typescript-semantic's provideHover so it doesn't merge with ours.
      let originalInstance: LanguageServicePluginInstance | undefined;
      let originalProvideHover: LanguageServicePluginInstance['provideHover'] | undefined;
      for (const [plugin, instance] of context.plugins) {
        if (plugin.name === 'typescript-semantic') {
          originalInstance = instance;
          originalProvideHover = instance.provideHover;
          instance.provideHover = undefined;
        }
      }
      return {
        async provideHover(document, position, token) {
          if (!document.uri.includes('.vsk')) {
            return undefined;
          }

          // Volar serves feature requests against the virtual TSX document
          // (volar-embedded-content://…), so `document.getText()` is the
          // GENERATED code. Knowledge scans (track decls, component usages,
          // event handlers) must run on the ORIGINAL .vsk source; answers are
          // still returned in the received document's coordinates so Volar can
          // map them back.
          const decoded = context.decodeEmbeddedDocumentUri(URI.parse(document.uri));
          let sourceText = document.getText();
          if (decoded) {
            const [sourceUri] = decoded;
            const sourceScript = context.language.scripts.get(sourceUri);
            if (sourceScript) {
              sourceText = sourceScript.snapshot.getText(0, sourceScript.snapshot.getLength());
            }
          }

          const source = document.getText();
          const offset = document.offsetAt(position);
          const word = getWordFromPosition(source, offset);
          const wordText = word.word;

          if (!wordText) {
            return undefined;
          }

          const { virtualCode } = getVirtualCode(document, context);
          if (!(virtualCode instanceof VeskVirtualCode)) {
            return undefined;
          }

          const markdown: string[] = [];

          // 1. TS hover (when typescript-semantic still runs at this position).
          if (originalProvideHover && originalInstance) {
            try {
              const tsHover = await originalProvideHover.call(originalInstance, document, position, token);
              // contents may be MarkupContent {kind,value}, MarkupContent[], or string.
              let content = '';
              if (tsHover && typeof tsHover.contents === 'string') {
                content = tsHover.contents;
              } else if (tsHover && Array.isArray(tsHover.contents)) {
                content = tsHover.contents
                  .map((c: any) => (typeof c === 'string' ? c : c.value ?? ''))
                  .join('\n');
              } else if (tsHover && tsHover.contents && typeof tsHover.contents === 'object' && 'value' in tsHover.contents && typeof tsHover.contents.value === 'string') {
                content = tsHover.contents.value;
              }
              if (content.trim()) {
                markdown.push(content);
              }
            } catch (err) {
              log(`TS hover failed at ${offset}:`, err);
            }
          }

          // 2. Reactive binding marker.
          if (scanReactiveBindings(sourceText).includes(wordText)) {
            markdown.push('`[reactive binding]`');
          }

          // 3. HTML element docs — TS cannot hover intrinsic elements because the
          //    ambient JSX namespace types them as `unknown`.
          if (HTML_ELEMENTS.includes(wordText) && HTML_ELEMENT_DOCS[wordText]) {
            markdown.push(HTML_ELEMENT_DOCS[wordText]);
          }

          // 4. Event handler docs.
          if (EVENT_HANDLERS[wordText]) {
            markdown.push(EVENT_HANDLERS[wordText]);
          }

          // 5. Inferred component props (from `<Name` usages).
          const usages = scanComponentUsages(sourceText);
          const usage = usages.get(wordText);
          if (usage && usage.attrs.size > 0) {
            const props = [...usage.attrs].sort().join(', ');
            markdown.push(`**Props:** ${props}`);
          }

          if (markdown.length === 0) {
            return undefined;
          }

          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: concatMarkdownContents(...markdown),
            },
            range: {
              start: document.positionAt(word.start),
              end: document.positionAt(word.end),
            },
          };
        },
      };
    },
  };
}