import { connection, documents, project, settings } from './context';
import { VESK_INTRINSICS, TAILWIND_CLASSES, COMPLETION_GLOBALS, EVENT_HANDLER_NAMES, EVENT_HANDLERS, HTML_ELEMENTS, VOID_ELEMENTS, CSS_PROPERTIES, TAG_SPECIFIC_ATTRIBUTES, GLOBAL_HTML_ATTRIBUTES } from './knowledge';
import { analyzeDocument, findEnclosingExpression, findEnclosingTag } from './analysis';
import { getOpeningTagName, isInClassAttribute, isInAttributeValue } from './text-utils';
import { isInsideStyleBlock, getCSSPrefix } from './css';
import { getComponentPropNames } from './components';
import { makeImportEdit } from './text-utils';
import { relative } from 'node:path';
import { CompletionItem, CompletionItemKind, InsertTextFormat, MarkupKind } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function registerCompletions(): void {
  connection.onCompletion(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const position = params.position;
    const source = document.getText();
    const offset = document.offsetAt(position);
    const linePrefix = source.substring(0, offset);
    const lastWord = linePrefix.match(/[a-zA-Z_$][\w$]*$/)?.[0] || '';
    const isComponentContext = /<\s*$/.test(linePrefix) || /<\s*[A-Za-z]*$/.test(linePrefix);
    const isClassAttr = isInClassAttribute(document, position);
    const isAttrValue = isInAttributeValue(document, position);

    const items: CompletionItem[] = [];

    if (isInsideStyleBlock(document, position)) {
      const { property, valuePrefix } = getCSSPrefix(document, position);
      if (property) {
        const propDef = CSS_PROPERTIES[property];
        if (propDef) {
          for (const val of propDef.values) {
            if (val.startsWith(valuePrefix)) {
              items.push({
                label: val,
                kind: CompletionItemKind.Value,
                detail: `CSS value — ${property}`,
                insertText: val.slice(valuePrefix.length),
              });
            }
          }
        }
        if (/color|background|border|outline|shadow/i.test(property)) {
          const colors = ['red', 'blue', 'green', 'white', 'black', 'gray', 'transparent', 'currentColor', 'inherit', '#000', '#fff', 'rgb(0,0,0)', 'rgba(0,0,0,1)'];
          for (const c of colors) {
            if (c.startsWith(valuePrefix)) {
              items.push({ label: c, kind: CompletionItemKind.Color, detail: `Color — ${property}` });
            }
          }
        }
      } else {
        const propNames = Object.keys(CSS_PROPERTIES);
        for (const prop of propNames) {
          if (prop.startsWith(valuePrefix)) {
            items.push({
              label: prop,
              kind: CompletionItemKind.Property,
              detail: CSS_PROPERTIES[prop].description,
              insertText: `${prop}: $0;`,
              insertTextFormat: InsertTextFormat.Snippet,
            });
          }
        }
      }
      return items;
    }

    const analysis = analyzeDocument(source);
    const enclosingExpr = findEnclosingExpression(analysis, offset);
    const enclosingTag = findEnclosingTag(analysis, offset);
    const fallbackTagName = getOpeningTagName(document, position);
    const inAttrRegion = enclosingTag !== null || (fallbackTagName !== null && !isAttrValue && !isClassAttr);

    if (enclosingExpr) {
      return buildExpressionCompletions(analysis, lastWord);
    }

    if (isClassAttr) {
      if (settings.tailwindCompletion) {
        for (const cls of project.tailwindClasses) {
          if (cls.startsWith(lastWord)) {
            items.push({
              label: cls,
              kind: CompletionItemKind.Value,
              detail: 'Tailwind CSS',
              insertText: cls.slice(lastWord.length),
            });
          }
        }
      }
      return items;
    }

    if (inAttrRegion) {
      const tagName = enclosingTag?.name || fallbackTagName;
      if (tagName) {
        const usedNames = new Set(enclosingTag ? enclosingTag.attrs.map(a => a.name) : []);
        for (const attr of buildAttributeCompletions(tagName, document.uri, usedNames)) {
          if (attr.label!.startsWith(lastWord)) items.push(attr);
        }
      }
      return items;
    }

    if (!isAttrValue) {
      for (const intr of VESK_INTRINSICS) {
        if (intr.name.startsWith(lastWord)) {
          const isComponent = intr.kind === CompletionItemKind.Class;
          items.push({
            label: intr.name,
            kind: intr.kind,
            detail: intr.detail,
            documentation: { kind: MarkupKind.Markdown, value: intr.docs },
            insertText: intr.insertText,
            insertTextFormat: intr.insertText ? InsertTextFormat.Snippet : undefined,
          });
        }
      }
    }

    if (isComponentContext || !isAttrValue) {
      const docUri = document.uri.replace(/^file:\/\//, '');
      for (const [name, srcPath] of project.componentSources) {
        if (!name.startsWith(lastWord)) continue;
        if (srcPath === docUri) continue;
        const srcFile = project.files.get(srcPath);
        if (srcFile) {
          const comp = srcFile.components.find(c => c.name === name);
          if (!comp || !comp.exported) continue;
        }
        const importEdit = makeImportEdit(document, [name], srcPath);
        items.push({
          label: name,
          kind: CompletionItemKind.Class,
          detail: `Component — ${relative(project.workspaceRoot, srcPath)}`,
          additionalTextEdits: importEdit ? [importEdit] : undefined,
        });
      }
    }

    if (!isAttrValue) {
      const docUri = document.uri.replace(/^file:\/\//, '');
      for (const [filePath, file] of project.files) {
        if (filePath === docUri) continue;
        for (const exp of file.exports) {
          if (!exp.name.startsWith(lastWord) || items.some(i => i.label === exp.name)) continue;
          const importEdit = makeImportEdit(document, [exp.name], filePath, exp.isDefault);
          items.push({
            label: exp.name,
            kind: CompletionItemKind.Variable,
            detail: `export from ${relative(project.workspaceRoot, filePath)}${exp.isDefault ? ' (default)' : ''}`,
            additionalTextEdits: importEdit ? [importEdit] : undefined,
          });
        }
      }
    }

    if (lastWord.startsWith('/') && !isAttrValue) {
      try {
        if (project.appDir) {
          const { scanRoutes } = await import('@vesk/compiler');
          const routes = scanRoutes(project.appDir);
          function addRoutePaths(nodes: any[], prefix: string) {
            for (const n of nodes) {
              const full = n.fullPath;
              if (full && full.startsWith(lastWord) && full !== '/') {
                items.push({ label: full, kind: CompletionItemKind.Value, detail: 'Route' });
              }
              if (n.children) addRoutePaths(n.children, full);
            }
          }
          addRoutePaths(routes, '');
        }
      } catch {}
    }

    if (isComponentContext || /<\s*[a-z]/i.test(linePrefix)) {
      for (const tag of HTML_ELEMENTS) {
        if (tag.startsWith(lastWord) && !items.some(i => i.label === tag)) {
          const isVoid = VOID_ELEMENTS.has(tag);
          items.push({
            label: tag,
            kind: CompletionItemKind.Property,
            detail: 'HTML element',
            insertText: isVoid ? `${tag}>` : `${tag}>$0</${tag}>`,
            insertTextFormat: InsertTextFormat.Snippet,
          });
        }
      }
    }

    return items;
  });

  connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
    return item;
  });
}

function buildAttributeCompletions(tagName: string, docUri: string, usedNames: Set<string>): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>(usedNames);
  const isComponent = /^[A-Z]/.test(tagName);

  let props: string[] = [];
  if (isComponent) {
    const info = getComponentPropNames(tagName, docUri);
    props = info ? info.props : [];
  } else {
    props = [...(TAG_SPECIFIC_ATTRIBUTES[tagName] || []), ...GLOBAL_HTML_ATTRIBUTES];
  }

  for (const p of props) {
    if (seen.has(p)) continue;
    seen.add(p);
    items.push({
      label: p,
      kind: CompletionItemKind.Property,
      detail: isComponent ? 'Component prop' : 'HTML attribute',
      insertText: `${p}={$0}`,
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  for (const ev of EVENT_HANDLER_NAMES) {
    if (seen.has(ev)) continue;
    seen.add(ev);
    items.push({
      label: ev,
      kind: CompletionItemKind.Event,
      detail: 'Event handler',
      documentation: { kind: MarkupKind.Markdown, value: EVENT_HANDLERS[ev] },
      insertText: `${ev}={$0}`,
      insertTextFormat: InsertTextFormat.Snippet,
    });
  }

  return items;
}

function buildExpressionCompletions(analysis: any, lastWord: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const added = new Set<string>();

  const push = (label: string, kind: CompletionItemKind, detail: string, docs?: string, insertText?: string) => {
    if (added.has(label) || !label.startsWith(lastWord)) return;
    added.add(label);
    items.push({
      label,
      kind,
      detail,
      documentation: docs ? { kind: MarkupKind.Markdown, value: docs } : undefined,
      insertText,
      insertTextFormat: insertText ? InsertTextFormat.Snippet : undefined,
    });
  };

  for (const [name, syms] of analysis.symbols) {
    const kind = syms[0]?.kind;
    const detail =
      kind === 'reactive' ? 'Reactive binding' :
      kind === 'param' ? 'Component parameter' :
      kind === 'import' ? 'Imported symbol' :
      kind === 'function' ? 'Function' :
      kind === 'class' ? 'Class' : 'Local variable';
    push(name, kind === 'reactive' || kind === 'variable' ? CompletionItemKind.Variable : CompletionItemKind.Function, detail);
  }

  for (const intr of VESK_INTRINSICS) {
    if (intr.kind === CompletionItemKind.Class) continue;
    push(intr.name, intr.kind, intr.detail, intr.docs);
  }

  for (const g of COMPLETION_GLOBALS) {
    push(g.name, CompletionItemKind.Variable, g.detail);
  }

  return items;
}