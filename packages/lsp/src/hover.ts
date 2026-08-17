import { connection, documents, project } from './context';
import { VESK_INTRINSICS, HTML_ELEMENT_DOCS, EVENT_HANDLERS, TAG_SPECIFIC_ATTRIBUTES, GLOBAL_HTML_ATTRIBUTES } from './knowledge';
import { analyzeDocument } from './analysis';
import { getWordAtPosition, getWordRangeAtPosition, getJSDoc, getJSDocForFile } from './text-utils';
import { getComponentPropNames, getComponentPropsTypes } from './components';
import { findFileByExportName } from './project';
import { relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Hover, MarkupKind, Position } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function registerHover(): void {
  connection.onHover(async (params): Promise<Hover | null> => {
    try {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const word = getWordAtPosition(document, params.position);
    if (!word) return null;

    const range = getWordRangeAtPosition(document, params.position);
    const source = document.getText();
    const offset = document.offsetAt(params.position);
    const analysis = analyzeDocument(source);

    for (const tag of analysis.tags) {
      for (const attr of tag.attrs) {
        if (attr.nameStart <= offset && offset <= attr.nameEnd) {
          if (EVENT_HANDLERS[attr.name]) {
            return {
              contents: { kind: MarkupKind.Markdown, value: `**${attr.name}**\n\n${EVENT_HANDLERS[attr.name]}\n\n_Event handler on \`<${tag.name}>\`_` },
              range,
            };
          }
          if (tag.isComponent) {
            const types = getComponentPropsTypes(tag.name, document.uri);
            const typeStr = types?.get(attr.name);
            const typeLine = typeStr ? `\n\n_Type: \`${typeStr}\`_` : '';
            const compInfo = getComponentPropNames(tag.name, document.uri);
            const declared = compInfo
              ? `\n\n_Declared in \`${relative(project.workspaceRoot, compInfo.source.replace(/^file:\/\//, ''))}\`_`
              : '';
            return {
              contents: { kind: MarkupKind.Markdown, value: `**${attr.name}**\n\nProp of \`<${tag.name}>\`${typeLine}${declared}` },
              range,
            };
          }
          if (TAG_SPECIFIC_ATTRIBUTES[tag.name]?.includes(attr.name) || GLOBAL_HTML_ATTRIBUTES.includes(attr.name)) {
            return {
              contents: { kind: MarkupKind.Markdown, value: `**${attr.name}**\n\nAttribute of \`<${tag.name}>\`` },
              range,
            };
          }
        }
      }
    }

    for (const tag of analysis.tags) {
      if (offset >= tag.nameStart && offset <= tag.nameEnd) {
        if (HTML_ELEMENT_DOCS[tag.name.toLowerCase()]) {
          const name = tag.name.toLowerCase();
          return {
            contents: { kind: MarkupKind.Markdown, value: `**\`<${name}>\`** — HTML element\n\n${HTML_ELEMENT_DOCS[name]}` },
            range,
          };
        }
      }
    }

    const intr = VESK_INTRINSICS.find(i => i.name === word);
    if (intr) {
      const sigLine = intr.signature ? `\n\n\`${intr.signature}\`` : '';
      return {
        contents: { kind: MarkupKind.Markdown, value: `**${intr.name}**\n\n${intr.docs}${sigLine}\n\n---\n_Auto-imported from @vesk/runtime_` },
        range,
      };
    }

    const srcPath = project.componentSources.get(word);
    if (srcPath && existsSync(srcPath)) {
      const rel = relative(project.workspaceRoot, srcPath);
      const fileSource = readFileSync(srcPath, 'utf-8');
      const lines = fileSource.split('\n');
      const compLine = lines.findIndex((l: string) => l.includes(`component ${word}`));
      const rawSignature = compLine >= 0 ? lines[compLine].trim() : word;
      const isAsync = /\basync\s+component\b/.test(rawSignature);
      const asyncLabel = isAsync ? 'async ' : '';
      const signature = rawSignature.replace(/\basync\s+component\b/, 'component');
      const jsdoc = getJSDocForFile(srcPath, word);
      const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
      const propInfo = getComponentPropNames(word, document.uri);
      const propsLine = propInfo && propInfo.props.length > 0 ? `\n\n_Props: \`${propInfo.props.join('`, `')}\`_` : '';
      const types = getComponentPropsTypes(word, document.uri);
      let typeTable = '';
      if (types && types.size > 0) {
        const rows = Array.from(types.entries()).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join('\n');
        typeTable = `\n\n| Prop | Type |\n| --- | --- |\n${rows}`;
      }
      return {
        contents: { kind: MarkupKind.Markdown, value: `**${asyncLabel}${word}**\n\n\`${signature}\`\n\n_Declared in \`${rel}:${compLine + 1}\`_${doc}${propsLine}${typeTable}` },
        range,
      };
    }

    const localComp = analysis.components.find(c => c.name === word);
    if (localComp) {
      const line = localComp.line + 1;
      const signature = document.getText().split('\n')[localComp.line]?.trim() || word;
      const asyncLabel = localComp.async ? 'async ' : '';
      const propInfo = getComponentPropNames(word, document.uri);
      const propsLine = propInfo && propInfo.props.length > 0 ? `\n\n_Props: \`${propInfo.props.join('`, `')}\`_` : '';
      const types = getComponentPropsTypes(word, document.uri);
      let typeTable = '';
      if (types && types.size > 0) {
        const rows = Array.from(types.entries()).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join('\n');
        typeTable = `\n\n| Prop | Type |\n| --- | --- |\n${rows}`;
      }
      return {
        contents: { kind: MarkupKind.Markdown, value: `**${asyncLabel}${word}** — _component_\n\n\`${signature}\`\n\n_Local component (line ${line})_${propsLine}${typeTable}` },
        range,
      };
    }

    const file = findFileByExportName(word);
    if (file) {
      const rel = relative(project.workspaceRoot, file.path);
      const expInfo = file.exports.find(e => e.name === word);
      const defaultLabel = expInfo?.isDefault ? ' (default)' : '';
      const jsdoc = getJSDocForFile(file.path, word);
      const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
      return {
        contents: { kind: MarkupKind.Markdown, value: `**${word}**\n\nExported from \`${rel}\`${defaultLabel}${doc}` },
        range,
      };
    }

    const syms = analysis.symbols.get(word);
    if (syms && syms.length > 0) {
      const kinds = new Set(syms.map(s => s.kind));
      const typeStr = syms.find(s => s.type)?.type;
      const typeLine = typeStr ? `\n\n_Type: \`${typeStr}\`_` : '';
      const label = kinds.has('reactive')
        ? `**${word}** — _reactive binding_${typeLine}\n\nCreated by \`track()\` (or \`cell\`). Reading it tracks the value; assignment updates it.`
        : kinds.has('param')
          ? `**${word}** — _component parameter_${typeLine}\n\nA prop of the enclosing component.`
          : kinds.has('function')
            ? `**${word}** — _function_${typeLine}`
            : kinds.has('class')
              ? `**${word}** — _class_${typeLine}`
              : kinds.has('interface')
                ? `**${word}** — _interface_`
                : kinds.has('type')
                  ? `**${word}** — _type alias_`
                  : kinds.has('enum')
                    ? `**${word}** — _enum_`
                    : kinds.has('import')
                      ? `**${word}** — _imported symbol_${typeLine}`
                      : `**${word}** — _variable_${typeLine}`;
      let declBlock = '';
      if (kinds.has('interface') || kinds.has('type') || kinds.has('enum')) {
        const d = syms.find(s => typeof s.declStart === 'number' && typeof s.declEnd === 'number');
        if (d && d.declStart !== undefined && d.declEnd !== undefined) {
          const declSrc = document.getText().slice(d.declStart, d.declEnd).trim();
          if (declSrc) declBlock = `\n\n\`\`\`\n${declSrc}\n\`\`\``;
        }
      }
      const line = document.getText().split('\n').findIndex(l => new RegExp(`\\b${word}\\b`).test(l) && /(?:component|function|const|let|var|class|interface|type|enum)\s/.test(l));
      const loc = line >= 0 ? `\n\n_Declared on line ${line + 1}_` : '';
      const jsdoc = line >= 0 ? getJSDoc(document.getText(), line) : null;
      const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
      return { contents: { kind: MarkupKind.Markdown, value: label + declBlock + loc + doc }, range };
    }

    const localSource = document.getText();
    const localLines = localSource.split('\n');
    for (let i = 0; i < localLines.length; i++) {
      const re = new RegExp(`(?:component|function|const|let|var|class)\\s+${word}\\b`);
      if (re.test(localLines[i])) {
        const jsdoc = getJSDoc(localSource, i);
        const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
        return {
          contents: { kind: MarkupKind.Markdown, value: `**${word}**${doc}` },
          range,
        };
      }
    }

    return null;
    } catch { return null; }
  });
}