/** @module features — LSP feature providers: document links, semantic tokens, signature help, code actions, colors, formatting. */

import { connection, documents, project } from './context';
import { VESK_INTRINSICS, RUNTIME_SIGNATURES, NAMED_COLORS } from './knowledge';
import { getComponentPropNames } from './components';
import { resolveImportPath } from './project';
import { isInsideStyleBlock, parseCSSColorValue } from './css';
import { formatVesk, fullDocumentEdit, prettierOptions } from './formatting';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DocumentLink, SemanticTokensParams, SemanticTokens, SignatureHelpParams, SignatureHelp, SignatureInformation, CodeActionParams, CodeAction, CodeActionKind, DocumentColorParams, ColorInformation, ColorPresentationParams, ColorPresentation, DocumentFormattingParams, DocumentRangeFormattingParams, TextEdit, Range, Position, MarkupKind } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Register document links, semantic tokens, signature help, code actions, color, and formatting handlers. */
export function registerFeatures(): void {
  connection.onDocumentLinks(async (params) => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) return [];

      const source = document.getText();
      const links: DocumentLink[] = [];
      const importRe = /import\s+(?:\{[^}]*\}|[^'"]*)\s+from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      const docDir = dirname(document.uri.replace(/^file:\/\//, ''));

      while ((m = importRe.exec(source)) !== null) {
        const importPath = m[1];
        const from = m.index;
        const to = from + m[0].length;

        const docPath = document.uri.replace(/^file:\/\//, '');
        const resolved = resolveImportPath(importPath, docPath, project);

        if (resolved && existsSync(resolved)) {
          links.push({ range: { start: document.positionAt(from), end: document.positionAt(to) }, target: `file://${resolved}` });
          continue;
        }

        if (importPath.startsWith('@vesk/') && project.workspaceRoot) {
          const pkgName = importPath.split('/')[1];
          for (const [fp] of project.files) {
            if (fp.includes(`packages/${pkgName}`) && fp.endsWith('/index.js')) {
              links.push({ range: { start: document.positionAt(from), end: document.positionAt(to) }, target: `file://${fp}` });
              break;
            }
          }
        }
      }

      return links;
    } catch {
      return [];
    }
  });

  (connection.languages as any).semanticTokens.on(async (params: SemanticTokensParams): Promise<SemanticTokens> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const source = document.getText();
    const lines = source.split('\n');
    const data: number[] = [];
    let prevLine = 0, prevChar = 0;

    function addToken(line: number, char: number, length: number, type: number, modifiers: number) {
      const deltaLine = line - prevLine;
      const deltaChar = deltaLine === 0 ? char - prevChar : char;
      data.push(deltaLine, deltaChar, length, type, modifiers);
      prevLine = line;
      prevChar = deltaLine === 0 ? char : char;
    }

    const compRe = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?component\s+([A-Za-z_$]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = compRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      const col = m.index - source.lastIndexOf('\n', m.index) - 1;
      addToken(line, col, m[0].length, 0, m[0].startsWith('export') ? 3 : 0);
      const nameLine = source.substring(0, m.index + m[1].length - 1).split('\n').length - 1;
      const nameCol = (m.index + m[0].indexOf(m[1])) - source.lastIndexOf('\n', m.index + m[0].indexOf(m[1])) - 1;
      addToken(nameLine, nameCol, m[1].length, 0, 1);
    }

    const reactiveRe = /&\[([\s\S]*?)\]/g;
    while ((m = reactiveRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      const col = m.index - source.lastIndexOf('\n', m.index) - 1;
      addToken(line, col, m[0].length, 1, 0);
    }

    const keywords = ['track', 'effect', 'derived', 'root', 'get', 'set', 'slot', 'reconcile', 'redirect', 'permanentRedirect', 'notFound', 'useRouter', 'useNavigate', 'useParams', 'usePathname', 'useSearchParams', 'useFetch'];
    for (const kw of keywords) {
      const kwRe = new RegExp(`\\b${kw}\\b`, 'g');
      while ((m = kwRe.exec(source)) !== null) {
        const line = source.substring(0, m.index).split('\n').length - 1;
        const col = m.index - source.lastIndexOf('\n', m.index) - 1;
        addToken(line, col, m[0].length, 2, 0);
      }
    }

    const intrinsicNames = VESK_INTRINSICS.filter(i => i.kind === 6).map(i => i.name);
    for (const name of intrinsicNames) {
      const tagRe = new RegExp(`<${name}([\\s/>])`, 'g');
      while ((m = tagRe.exec(source)) !== null) {
        const line = source.substring(0, m.index).split('\n').length - 1;
        const col = m.index - source.lastIndexOf('\n', m.index) - 1;
        addToken(line, col, name.length + 1, 2, 0);
      }
    }

    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
    while ((m = styleRe.exec(source)) !== null) {
      const styleText = m[1];
      const styleStart = m.index + m[0].indexOf(styleText);
      const propRe = /^(\s*)([\w-]+)\s*(?=:)/gm;
      let pm: RegExpExecArray | null;
      while ((pm = propRe.exec(styleText)) !== null) {
        const absOffset = styleStart + pm.index + pm[1].length;
        const line = source.substring(0, absOffset).split('\n').length - 1;
        const col = absOffset - source.lastIndexOf('\n', absOffset) - 1;
        addToken(line, col, pm[2].length, 5, 0);
      }
    }

    return { data };
  });

  connection.onSignatureHelp(async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) return null;

      const source = document.getText();
      const offset = document.offsetAt(params.position);
      const before = source.substring(Math.max(0, offset - 500), offset);

      const call = before.match(/([A-Za-z_$][\w$]*)\s*\([^)]*$/);
      if (!call) return null;
      const callee = call[1];
      const signatures: SignatureInformation[] = [];

      const runtimeSig = RUNTIME_SIGNATURES[callee];
      if (runtimeSig) {
        signatures.push({
          label: runtimeSig.label,
          documentation: { kind: MarkupKind.Markdown, value: runtimeSig.docs },
          parameters: runtimeSig.params.map(p => ({ label: p.label, documentation: p.docs })),
        });
      }

      const intr = VESK_INTRINSICS.find(i => i.name === callee && i.kind === 6);
      if (intr) {
        signatures.push({
          label: `${callee}(props)`,
          documentation: { kind: MarkupKind.Markdown, value: intr.docs },
          parameters: [{ label: 'props', documentation: 'Component props object' }],
        });
      }

      if (project.componentSources.has(callee)) {
        const propInfo = getComponentPropNames(callee, document.uri);
        const propsDoc = propInfo && propInfo.props.length > 0 ? `Known props: \`${propInfo.props.join('`, `')}\`` : 'Component props';
        signatures.push({
          label: `${callee}(props)`,
          documentation: { kind: MarkupKind.Markdown, value: propsDoc },
          parameters: [{ label: 'props', documentation: propsDoc }],
        });
      }

      if (signatures.length > 0) {
        const argsStr = before.substring(before.lastIndexOf('(', before.length) + 1);
        const activeParam = argsStr.match(/,/g)?.length || 0;
        return { signatures, activeSignature: 0, activeParameter: activeParam };
      }

      return null;
    } catch {
      return null;
    }
  });

  connection.onCodeAction(async (params: CodeActionParams): Promise<CodeAction[]> => {
    try {
      const actions: CodeAction[] = [];
      const document = documents.get(params.textDocument.uri);
      if (!document) return actions;

      const source = document.getText();

      for (const diag of params.context.diagnostics) {
        if (diag.message.includes('title') || diag.message.includes('<title>')) {
          actions.push({
            title: 'Wrap in <Head> element',
            kind: CodeActionKind.QuickFix,
            edit: {
              changes: {
                [document.uri]: [TextEdit.insert(params.range.start, '<Head>\n  ')],
              },
            },
          });
        }
      }

      const importLines: { line: number; text: string }[] = [];
      const nonImportLines: { line: number; text: string }[] = [];
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('import ')) {
          importLines.push({ line: i, text: lines[i] });
        } else if (!importLines.length || nonImportLines.length > 0 || lines[i].trim()) {
          nonImportLines.push({ line: i, text: lines[i] });
        }
      }

      if (importLines.length > 0) {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const imp of importLines) {
          const key = imp.text.replace(/\s+/g, ' ').trim();
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(imp.text);
          }
        }
        deduped.sort();
        const organized = deduped.join('\n') + '\n\n';
        const importStart = importLines[0].line;
        const importEnd = importLines[importLines.length - 1].line;
        if (organized.trim() !== importLines.map(l => l.text).join('\n').trim()) {
          actions.push({
            title: 'Organize imports',
            kind: CodeActionKind.SourceOrganizeImports,
            edit: {
              changes: {
                [document.uri]: [TextEdit.replace({ start: { line: importStart, character: 0 }, end: { line: importEnd + 1, character: 0 } }, organized)],
              },
            },
          });
        }
      }

      return actions;
    } catch {
      return [];
    }
  });

  connection.onDocumentColor(async (params: DocumentColorParams): Promise<ColorInformation[]> => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) return [];

      const text = document.getText();
      const colors: ColorInformation[] = [];

      const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
      let sm: RegExpExecArray | null;
      while ((sm = styleRe.exec(text)) !== null) {
        const cssText = sm[1];
        const styleOffset = sm.index + sm[0].indexOf(cssText);
        const colorRe = /(?:color|background(?:-color)?|border(?:-color)?|outline(?:-color)?)\s*:\s*([^;{}]+)/gi;
        let cm: RegExpExecArray | null;
        while ((cm = colorRe.exec(cssText)) !== null) {
          const val = cm[1].trim();
          const colorVal = parseCSSColorValue(val);
          if (colorVal) {
            const absOffset = styleOffset + cm.index + cm[0].indexOf(val);
            const startPos = document.positionAt(absOffset);
            const endPos = document.positionAt(absOffset + val.length);
            colors.push({ color: colorVal, range: { start: startPos, end: endPos } });
          }
        }

        const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
        let hm: RegExpExecArray | null;
        while ((hm = hexRe.exec(cssText)) !== null) {
          const colorVal = parseCSSColorValue(hm[0]);
          if (colorVal) {
            const absOffset = styleOffset + hm.index;
            const startPos = document.positionAt(absOffset);
            const endPos = document.positionAt(absOffset + hm[0].length);
            colors.push({ color: colorVal, range: { start: startPos, end: endPos } });
          }
        }
      }

      return colors;
    } catch {
      return [];
    }
  });

  connection.onColorPresentation(async (params: ColorPresentationParams): Promise<ColorPresentation[]> => {
    try {
      const c = params.color;
      const r = Math.round(c.red * 255), g = Math.round(c.green * 255), b = Math.round(c.blue * 255);
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      return [
        { label: hex },
        { label: `rgb(${r}, ${g}, ${b})` },
        { label: `rgba(${r}, ${g}, ${b}, ${c.alpha.toFixed(2)})` },
      ];
    } catch {
      return [];
    }
  });

  connection.onDocumentFormatting(async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) return [];
      const source = document.getText();
      try {
        const formatted = await format(source, prettierOptions);
        if (formatted === source) return [];
        return [fullDocumentEdit(document, formatted)];
      } catch (err) {
        connection.console.error(`[vesk] prettier failed (${(err as Error).message}), falling back to indenter`);
        const formatted = formatVesk(source);
        if (formatted === source) return [];
        return [fullDocumentEdit(document, formatted)];
      }
    } catch {
      return [];
    }
  });

  connection.onDocumentRangeFormatting(async (params: DocumentRangeFormattingParams): Promise<TextEdit[]> => {
    try {
      const document = documents.get(params.textDocument.uri);
      if (!document) return [];
      const source = document.getText();
      const lines = source.split('\n');
      const startLine = params.range.start.line;
      const endLine = params.range.end.line;
      const selectedSource = lines.slice(startLine, endLine + 1).join('\n');
      const formatted = formatVesk(selectedSource);
      return [TextEdit.replace(params.range, formatted)];
    } catch {
      return [];
    }
  });
}

async function format(source: string, options: any): Promise<string> {
  const { format } = await import('prettier');
  return format(source, options);
}