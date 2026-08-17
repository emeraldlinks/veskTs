import { parse } from '@vesk/compiler';
import { connection } from './context';
import { project } from './context';
import { isKnownGlobal } from './knowledge';
import { analyzeDocument, isLoopBoundInJsxText, walkNode } from './analysis';
import { findFileByExportName, resolveImportPath } from './project';
import { getComponentPropNames, extractPropTypesFromSource } from './components';
import { getWordAtPosition, getWordRangeAtPosition } from './text-utils';
import { Diagnostic, DiagnosticSeverity, Position, Range } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function validateDocument(document: TextDocument): void {
  const source = document.getText();
  const diagnostics: Diagnostic[] = [];
  const lines = source.split('\n');

  try {
    const ast = parse(source, {});
    if (ast && ast.body) {
      const componentNames = new Set<string>();
      for (const node of ast.body) {
        let target: any = node;
        if (node.type === 'ExportNamedDeclaration' && node.declaration) target = node.declaration;
        if (node.type === 'ExportDefaultDeclaration' && node.declaration) target = node.declaration;
        if (target.type === 'ComponentDeclaration' && target.id) {
          if (componentNames.has(target.id.name)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: target.loc.start.line - 1, character: target.loc.start.column },
                end: { line: target.loc.end.line - 1, character: target.loc.end.column },
              },
              message: `Duplicate component name: '${target.id.name}'`,
              source: 'vesk',
            });
          }
          componentNames.add(target.id.name);
        }
      }

      // Type-aware: check JSX attribute types on component usages
      try {
        walkNode(ast, (node) => {
          if (node.type === 'JSXOpeningElement') {
            const nameNode = (node as any).name;
            if (!nameNode) return;
            const compName = getJSXName(nameNode);
            if (!compName || !/^[A-Z]/.test(compName)) return;
            const propTypes = extractPropTypesFromSource(source, compName);
            if (propTypes && propTypes.size > 0) {
              for (const attr of (node as any).attributes || []) {
                if (attr.type !== 'JSXAttribute' || !attr.name) continue;
                const attrName = attr.name.type === 'JSXIdentifier' ? attr.name.name : '';
                if (!attrName || attrName.startsWith('on') || attrName === 'class' || attrName === 'style' || attrName === 'key' || attrName === 'ref') continue;
                const expectedType = propTypes.get(attrName);
                if (expectedType === undefined) {
                  const hasTypedProps = Array.from(propTypes.keys()).some(k => k !== 'props');
                  if (hasTypedProps) {
                    const from = attr.name.start;
                    const line = source.substring(0, from).split('\n').length - 1;
                    const col = from - source.lastIndexOf('\n', from) - 1;
                    diagnostics.push({
                      severity: DiagnosticSeverity.Warning,
                      range: { start: { line, character: col }, end: { line, character: col + attrName.length } },
                      message: `Unknown prop '${attrName}' on <${compName}>. Available: ${Array.from(propTypes.keys()).join(', ')}`,
                      source: 'vesk',
                    });
                  }
                }
              }
            }
          }
        });
      } catch {}
    }
  } catch (e: any) {
    const msg = e.message || String(e);
    const match = msg.match(/\((\d+):(\d+)\)/);
    if (match) {
      const line = parseInt(match[1]) - 1;
      const col = parseInt(match[2]) - 1;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line, character: col },
          end: { line, character: lines[line]?.length || col + 1 },
        },
        message: msg,
        source: 'vesk',
      });
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: msg,
        source: 'vesk',
      });
    }
  }

  const importRe = /import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from\s+['"][^'"]+['"]/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(source)) !== null) {
    const importedNames = (im[1] || im[2]).split(',').map(n => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    for (const name of importedNames) {
      if (!name) continue;
      const usageRe = new RegExp(`\\b${name}\\b`, 'g');
      const usageCount = (source.match(usageRe) || []).length;
      if (usageCount <= 1) {
        const from = im.index + im[0].indexOf(name);
        const to = from + name.length;
        const line = source.substring(0, from).split('\n').length - 1;
        const col = from - source.lastIndexOf('\n', from) - 1;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line, character: col }, end: { line, character: col + name.length } },
          message: `Unused import: '${name}'`,
          source: 'vesk',
        });
      }
    }
  }

  const importAllRe = /import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let im2: RegExpExecArray | null;
  while ((im2 = importAllRe.exec(source)) !== null) {
    const importedNames = (im2[1] || im2[2]).split(',').map(n => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    const importPath = im2[3];
    if (!importPath.startsWith('.') && !importPath.startsWith('@')) continue;
    const resolvedFile = resolveImportPath(importPath, document.uri.replace(/^file:\/\//, ''), project);
    if (!resolvedFile || !existsSync(resolvedFile)) continue;
    const targetFile = project.files.get(resolvedFile);
    if (!targetFile) continue;
    for (const name of importedNames) {
      if (!name || name === '*') continue;
      const isExported = targetFile.exports.some(e => e.name === name);
      if (!isExported) {
        const from = im2.index + im2[0].indexOf(name);
        const line2 = source.substring(0, from).split('\n').length - 1;
        const col2 = from - source.lastIndexOf('\n', from) - 1;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start: { line: line2, character: col2 }, end: { line: line2, character: col2 + name.length } },
          message: `'${name}' is not exported from '${importPath}'`,
          source: 'vesk',
        });
      }
    }
  }

  const jsxTagRe = /<([A-Z][a-zA-Z0-9_$]*)[\s/>]/g;
  let m: RegExpExecArray | null;
  while ((m = jsxTagRe.exec(source)) !== null) {
    const tagName = m[1];
    if (isKnownGlobal(tagName)) continue;
    if (project.componentSources.has(tagName)) continue;
    if (findFileByExportName(tagName)) continue;
    const localDef = new RegExp(`component\\s+${tagName}\\b`).test(source);
    if (localDef) continue;
    const alreadyImported = new RegExp(`import\\s+[\\s\\S]*?\\b${tagName}\\b[\\s\\S]*?from\\s+['"]`).test(source);
    if (alreadyImported) continue;
    if (HTML_ELEMENTS.includes(tagName.toLowerCase())) continue;

    const from = m.index + 1;
    const line = source.substring(0, from).split('\n').length - 1;
    const col = from - source.lastIndexOf('\n', from) - 1;
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: { start: { line, character: col }, end: { line, character: col + tagName.length } },
      message: `Unknown component '${tagName}' — neither imported nor defined locally`,
      source: 'vesk',
    });
  }

  const analysis = analyzeDocument(source);
  if (analysis.ok) {
    const known = new Set<string>(analysis.symbols.keys());
    for (const name of analysis.imports) known.add(name);
    const flagged = new Set<string>();
    for (const used of analysis.used) {
      if (known.has(used.name) || isKnownGlobal(used.name) || used.name === 'props') continue;
      if (isLoopBoundInJsxText(source, used.start, used.name)) continue;
      const key = `${used.name}:${used.start}`;
      if (flagged.has(key)) continue;
      flagged.add(key);
      const from = used.start;
      const line = source.substring(0, from).split('\n').length - 1;
      const col = from - source.lastIndexOf('\n', from) - 1;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: { start: { line, character: col }, end: { line, character: col + used.name.length } },
        message: `Cannot find name '${used.name}'`,
        source: 'vesk',
      });
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

/** Extract the name from a JSX name node (Identifier or MemberExpression). */
function getJSXName(node: any): string {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return `${getJSXName(node.object)}.${node.property?.name || ''}`;
  }
  return '';
}

import { existsSync } from 'node:fs';
import { HTML_ELEMENTS } from './knowledge';