import { parse } from '@vesk/compiler/src/parser';
import { getPropsType } from '@vesk/compiler/src/ir-generator';
import {
  skipWhitespace,
  findBalancedEnd,
  splitTopLevel,
  startsWithIdentifier,
  stripDeclKeyword,
  stripTrailingSemicolons,
  isWhitespaceChar,
  isIdentStart,
  isIdentChar,
  htmlTagEnd,
  collapseNewlineWhitespace,
} from '@vesk/compiler/src/scan';
import { containsIdentifier, isIdentifierImported } from '@vesk/compiler/src/tokens';

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Collects edit operations that rewrite `&[...] = track<...>(...)`
 * declarations into plain typed `let` declarations, using the parsed AST so
 * nested generics (`track<Map<string, number>>(...)`), type annotations and
 * nested statement positions are handled without regex. `wrapped` is the
 * fake component source (offsets inside it), `prefixLen` the distance from
 * the start of `wrapped` to the start of the real body text.
 */
function collectTrackDeclEdits(wrapped: string, ast: any, prefixLen: number): Edit[] {
  const edits: Edit[] = [];
  function walk(stmts: any[]): void {
    for (const stmt of stmts) {
      if (!stmt) continue;
      if (stmt.type === 'VariableDeclaration') {
        for (const decl of stmt.declarations) {
          const id = decl.id;
          if (!id || id.type !== 'ArrayPattern' || id.lazy !== true) continue;
          if (!decl.init) continue;
          const names = (id.elements || [])
            .map((el: any) => (el ? el.name : null))
            .filter((n: any): n is string => typeof n === 'string');
          const initText = wrapped.slice(decl.init.start, decl.init.end);
          if (names.length === 0) {
            edits.push({ start: decl.start - prefixLen, end: decl.end - prefixLen, text: `let _ = ${initText};` });
            continue;
          }
          const annotation = id.typeAnnotation?.typeAnnotation
            ? wrapped.slice(id.typeAnnotation.typeAnnotation.start, id.typeAnnotation.typeAnnotation.end).trim()
            : decl.init.typeArguments
              ? wrapped.slice(decl.init.typeArguments.start + 1, decl.init.typeArguments.end - 1).trim()
              : '';
          const first = names[0]!;
          let replacement: string;
          if (annotation) {
            replacement = `let ${first}: ${annotation} = (${initText} as unknown as ${annotation});`;
          } else {
            replacement = `let ${first}: any = ${initText};`;
          }
          for (let n = 1; n < names.length; n++) {
            replacement += ` let ${names[n]}: any = ${first};`;
          }
          edits.push({ start: decl.start - prefixLen, end: decl.end - prefixLen, text: replacement });
        }
        continue;
      }
      const kids: any[] = [];
      if (stmt.consequent) kids.push(stmt.consequent);
      if (stmt.alternate) kids.push(stmt.alternate);
      if (Array.isArray(stmt.body)) kids.push(...stmt.body);
      else if (stmt.body && stmt.body.type) kids.push(stmt.body);
      if (Array.isArray(stmt.cases)) {
        for (const c of stmt.cases) if (Array.isArray(c.consequent)) kids.push(...c.consequent);
      }
      if (stmt.handler) kids.push(stmt.handler.body);
      if (stmt.finalizer) kids.push(stmt.finalizer.body);
      walk(kids);
    }
  }
  walk(ast.body);
  return edits;
}

const REWRITER_WRAPPER = 'component __VskRewriter() { ';
const REWRITER_WRAPPER_LEN = REWRITER_WRAPPER.length;

function rewriteTrackDecls(text: string): string {
  if (!text.includes('&[')) return text;
  const wrapped = REWRITER_WRAPPER + text + ' }';
  let ast: any;
  try {
    ast = parse(wrapped);
  } catch {
    return text;
  }
  const edits = collectTrackDeclEdits(wrapped, ast, REWRITER_WRAPPER_LEN);
  if (edits.length === 0) return text;
  return applyEdits(text, edits);
}

function stripStyleBlocks(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<' && text.slice(i, i + 6) === '<style') {
      const next = i + 6;
      if (next >= text.length || isWhitespaceChar(text[next]) || text[next] === '>' || text[next] === '/') {
        const openEnd = htmlTagEnd(text, i);
        if (openEnd !== -1) {
          const closeIdx = text.indexOf('</style>', openEnd);
          if (closeIdx !== -1) {
            i = closeIdx + '</style>'.length;
            continue;
          }
        }
      }
    }
    out.push(text[i]);
    i++;
  }
  return out.join('');
}

function getComponents(ast: any): Array<{ node: any; exported: boolean; defaultExport: boolean; start: number }> {
  const out: Array<{ node: any; exported: boolean; defaultExport: boolean; start: number }> = [];
  for (const stmt of ast.body || []) {
    if (stmt.type === 'ComponentDeclaration') {
      out.push({ node: stmt, exported: false, defaultExport: false, start: stmt.start });
    } else if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'ComponentDeclaration') {
      out.push({ node: stmt.declaration, exported: true, defaultExport: false, start: stmt.start });
    } else if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration?.type === 'ComponentDeclaration') {
      out.push({ node: stmt.declaration, exported: true, defaultExport: true, start: stmt.start });
    }
  }
  return out;
}

interface ForClauseAnnotation {
  kind: string;
  clauseStart: number;
  clauseEnd: number;
}

function blankForClauses(source: string, ast: any): string {
  const annotations = (ast as { __vskAnnotations?: ForClauseAnnotation[] }).__vskAnnotations ?? [];
  let out = source;
  for (const ann of annotations) {
    if (ann.kind !== 'for-clause') continue;
    out = out.slice(0, ann.clauseStart) + ' '.repeat(ann.clauseEnd - ann.clauseStart) + out.slice(ann.clauseEnd);
  }
  return out;
}

function extractForHeader(text: string): string | null {
  if (!startsWithIdentifier(text, 'for')) return null;
  const i = skipWhitespace(text, 3);
  if (text[i] !== '(') return null;
  const end = findBalancedEnd(text, i);
  return text.slice(i + 1, end);
}

function getJSXTagName(el: any): string | null {
  const name = el?.openingElement?.name ?? el?.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return name.object.name + '.' + name.property.name;
  if (name.type === 'JSXNamespacedName') return name.namespace.name + ':' + name.name.name;
  return null;
}

function tsxBlock(source: string, body: any, indent: string): string {
  const stmts = body && body.type === 'BlockStatement'
    ? body.body
    : body ? (Array.isArray(body) ? body : [body]) : [];
  const inner = tsxEmitBody(source, stmts, indent + '  ');
  return `{\n${inner}\n${indent}}`;
}

function tsxEmitJSXChildren(source: string, children: any[]): string {
  const parts: string[] = [];
  let i = 0;
  let forPending = false;
  while (i < children.length) {
    const child = children[i];
    if (child.type !== 'JSXText') forPending = false;
    if (child.type === 'JSXText') {
      const text = collapseNewlineWhitespace(child.value);
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//')) { i++; continue; }

      const forDecl = extractForHeader(trimmed);
      const nextChild = children[i + 1];
      if (forDecl !== null && nextChild !== undefined && (
        nextChild.type === 'JSXExpressionContainer' ||
        nextChild.type === 'JSXElement' ||
        nextChild.type === 'JSXFragment'
      )) {
        let bodyText: string;
        if (nextChild.type === 'JSXExpressionContainer') {
          const exprNode = nextChild.expression;
          if (exprNode.type === 'JSXEmptyExpression') { parts.push(text); i++; continue; }
          bodyText = tsxEmitJSXExprBody(source, exprNode);
        } else if (nextChild.type === 'JSXFragment') {
          bodyText = tsxEmitJSXFragment(source, nextChild);
        } else {
          bodyText = tsxEmitJSXElement(source, nextChild);
        }

        let emptyText = '';
        let consumed = 2;
        const emptyTextNode = children[i + 2];
        const emptyContainer = children[i + 3];
        if (
          emptyTextNode && emptyTextNode.type === 'JSXText' &&
          ['#empty', 'empty'].includes(emptyTextNode.value.trim()) &&
          emptyContainer && emptyContainer.type === 'JSXExpressionContainer' &&
          emptyContainer.expression.type !== 'JSXEmptyExpression'
        ) {
          emptyText = tsxEmitJSXExprBody(source, emptyContainer.expression);
          consumed = 4;
        }

        const ofParts = splitTopLevel(forDecl, 'of');
        if (ofParts.length === 2) {
          const itemVar = stripDeclKeyword(ofParts[0]).trim();
          const arrExpr = ofParts[1].trim();
          const map = `{ ${arrExpr}.map((${itemVar}: (typeof ${arrExpr})[number]) => (${bodyText})) }`;
          if (emptyText) {
            parts.push(`{ (() => { const _v = ${arrExpr}; return _v.length === 0 ? (${emptyText}) : _v.map((${itemVar}: (typeof _v)[number]) => (${bodyText})); })() }`);
          } else {
            parts.push(map);
          }
          i += consumed;
          forPending = true;
          continue;
        }
        const inParts = splitTopLevel(forDecl, 'in');
        if (inParts.length === 2) {
          const itemVar = stripDeclKeyword(inParts[0]).trim();
          const objExpr = inParts[1].trim();
          parts.push(`{ Object.keys(${objExpr}).map((${itemVar}) => (${bodyText})) }`);
          i += consumed;
          forPending = true;
          continue;
        }
      }

      if (forPending && trimmed === '}') { forPending = false; i++; continue; }
      forPending = false;
      parts.push(text);
      i++;
    } else if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type === 'JSXEmptyExpression') { i++; continue; }
      parts.push(`{${source.slice(child.expression.start, child.expression.end)}}`);
      i++;
    } else if (child.type === 'JSXElement') {
      if (getJSXTagName(child) === 'style') { i++; continue; }
      parts.push(tsxEmitJSXElement(source, child));
      i++;
    } else if (child.type === 'JSXFragment') {
      parts.push(tsxEmitJSXFragment(source, child));
      i++;
    } else {
      i++;
    }
  }
  return parts.join('');
}

function tsxEmitJSXExprBody(source: string, expr: any): string {
  if (expr.type === 'JSXElement') return tsxEmitJSXElement(source, expr);
  if (expr.type === 'JSXFragment') return tsxEmitJSXFragment(source, expr);
  return source.slice(expr.start, expr.end);
}

function tsxEmitJSXElement(source: string, el: any): string {
  const opening = source.slice(el.openingElement.start, el.openingElement.end);
  if (el.openingElement.selfClosing) return opening;
  const inner = tsxEmitJSXChildren(source, el.children ?? []);
  const closing = el.closingElement ? source.slice(el.closingElement.start, el.closingElement.end) : '';
  return opening + inner + closing;
}

function tsxEmitJSXFragment(source: string, frag: any): string {
  const inner = tsxEmitJSXChildren(source, frag.children ?? []);
  return '<>' + inner + '</>';
}

function tsxEmitIf(source: string, stmt: any, indent: string): string {
  const cond = source.slice(stmt.test.start, stmt.test.end);
  let out = `${indent}if (${cond}) ${tsxBlock(source, stmt.consequent, indent)}`;
  if (stmt.alternate) {
    const altBlock = stmt.alternate.type === 'BlockStatement'
      ? tsxBlock(source, stmt.alternate, indent)
      : tsxBlock(source, [stmt.alternate], indent);
    out += ` else ${altBlock}`;
  }
  return out;
}

function tsxEmitForOf(source: string, stmt: any, indent: string): string {
  const left = source.slice(stmt.left.start, stmt.left.end);
  const right = source.slice(stmt.right.start, stmt.right.end);
  return `${indent}for (${left} of ${right}) ${tsxBlock(source, stmt.body, indent)}`;
}

function tsxEmitForIn(source: string, stmt: any, indent: string): string {
  const left = source.slice(stmt.left.start, stmt.left.end);
  const right = source.slice(stmt.right.start, stmt.right.end);
  return `${indent}for (${left} in ${right}) ${tsxBlock(source, stmt.body, indent)}`;
}

function tsxEmitFor(source: string, stmt: any, indent: string): string {
  const init = stmt.init ? source.slice(stmt.init.start, stmt.init.end) : '';
  const test = stmt.test ? source.slice(stmt.test.start, stmt.test.end) : '';
  const update = stmt.update ? source.slice(stmt.update.start, stmt.update.end) : '';
  return `${indent}for (${init}; ${test}; ${update}) ${tsxBlock(source, stmt.body, indent)}`;
}

function tsxEmitWhile(source: string, stmt: any, indent: string): string {
  const test = source.slice(stmt.test.start, stmt.test.end);
  return `${indent}while (${test}) ${tsxBlock(source, stmt.body, indent)}`;
}

function tsxEmitDoWhile(source: string, stmt: any, indent: string): string {
  const test = source.slice(stmt.test.start, stmt.test.end);
  return `${indent}do ${tsxBlock(source, stmt.body, indent)} while (${test});`;
}

function tsxEmitSwitch(source: string, stmt: any, indent: string): string {
  const disc = source.slice(stmt.discriminant.start, stmt.discriminant.end);
  const lines: string[] = [`${indent}switch (${disc}) {`];
  for (const c of stmt.cases ?? []) {
    if (c.test) {
      lines.push(`${indent}  case ${source.slice(c.test.start, c.test.end)}:`);
    } else {
      lines.push(`${indent}  default:`);
    }
    const bodyText = tsxEmitBody(source, c.consequent, indent + '    ');
    if (bodyText) lines.push(bodyText);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function tsxEmitTry(source: string, stmt: any, indent: string): string {
  let out = `${indent}try ${tsxBlock(source, stmt.block, indent)}`;
  if (stmt.handler) {
    const param = stmt.handler.param ? source.slice(stmt.handler.param.start, stmt.handler.param.end) : '';
    out += ` catch${param ? ` (${param})` : ''} ${tsxBlock(source, stmt.handler.body, indent)}`;
  }
  if (stmt.finalizer) {
    out += ` finally ${tsxBlock(source, stmt.finalizer, indent)}`;
  }
  return out;
}

function tsxEmitStatement(source: string, stmt: any, indent: string, isLast: boolean): string {
  switch (stmt.type) {
    case 'JSXElement':
      if (getJSXTagName(stmt) === 'style') return '';
      return indent + tsxEmitJSXElement(source, stmt) + (isLast ? '' : ';');
    case 'JSXFragment':
      return indent + tsxEmitJSXFragment(source, stmt) + (isLast ? '' : ';');
    case 'JSXExpressionContainer': {
      if (stmt.expression.type === 'JSXEmptyExpression') return '';
      const text = `{${source.slice(stmt.expression.start, stmt.expression.end)}}`;
      return indent + text + (isLast ? '' : ';');
    }
    case 'VeskBlock': {
      if (stmt.tag === 'empty') return '';
      const lines: string[] = [];
      const innerStmts = stmt.body ?? [];
      for (let i = 0; i < innerStmts.length; i++) {
        const t = tsxEmitStatement(source, innerStmts[i], indent, isLast && i === innerStmts.length - 1);
        if (t !== '') lines.push(t);
      }
      return lines.join('\n');
    }
    case 'IfStatement':
      return tsxEmitIf(source, stmt, indent);
    case 'ForOfStatement':
      return tsxEmitForOf(source, stmt, indent);
    case 'ForInStatement':
      return tsxEmitForIn(source, stmt, indent);
    case 'ForStatement':
      return tsxEmitFor(source, stmt, indent);
    case 'WhileStatement':
      return tsxEmitWhile(source, stmt, indent);
    case 'DoWhileStatement':
      return tsxEmitDoWhile(source, stmt, indent);
    case 'SwitchStatement':
      return tsxEmitSwitch(source, stmt, indent);
    case 'TryStatement':
      return tsxEmitTry(source, stmt, indent);
    case 'LabeledStatement': {
      const body = tsxEmitStatement(source, stmt.body, indent, isLast);
      return `${indent}${stmt.label.name}:\n${body}`;
    }
    default: {
      let text = stripTrailingSemicolons(source.slice(stmt.start, stmt.end).trimEnd());
      if (text === '') return '';
      return indent + text + (text.endsWith('}') || isLast ? '' : ';');
    }
  }
}

function tsxEmitBody(source: string, stmts: any[], indent: string): string {
  const lines: string[] = [];
  let i = 0;
  while (i < stmts.length) {
    const stmt = stmts[i];
    const isLast = i === stmts.length - 1;
    if (
      stmt.type === 'ForOfStatement' &&
      stmts[i + 1] && stmts[i + 1].type === 'VeskBlock' && stmts[i + 1].tag === 'empty'
    ) {
      const empty = stmts[i + 1];
      lines.push(tsxEmitForOf(source, stmt, indent));
      const inner = empty.body ?? [];
      if (inner.length > 0) {
        const emptyText = tsxEmitBody(source, inner, indent + '  ');
        const arrExpr = source.slice(stmt.right.start, stmt.right.end);
        lines.push(`${indent}${arrExpr}.length === 0 && (() => {`);
        lines.push(emptyText);
        lines.push(`${indent}})();`);
      }
      i += 2;
      continue;
    }
    const text = tsxEmitStatement(source, stmt, indent, isLast);
    if (text !== '') lines.push(text);
    i++;
  }
  return lines.join('\n');
}

function isStatementMode(node: any): boolean {
  const stmts = node.body?.body ?? [];
  return !(stmts.length === 1 && stmts[0].type === 'ReturnStatement');
}

/** Replaces the first whole-word occurrence of `word` in `text`. */
function replaceFirstKeyword(text: string, word: string, replacement: string): string {
  let i = 0;
  while (i < text.length) {
    if (isIdentStart(text[i])) {
      let j = i + 1;
      while (j < text.length && isIdentChar(text[j])) j++;
      if (text.slice(i, j) === word) return text.slice(0, i) + replacement + text.slice(j);
      i = j;
      continue;
    }
    i++;
  }
  return text;
}

/**
 * Removes a trailing `client` keyword from a component header (the header is
 * the text from the declaration start up to the body `{`), so `component Foo
 * client {` becomes `component Foo {`. Returns the text with the keyword
 * replaced by a single space.
 */
function stripTrailingClient(text: string): string {
  let end = text.length;
  while (end > 0 && isWhitespaceChar(text[end - 1])) end--;
  let wordStart = end;
  while (wordStart > 0 && isIdentChar(text[wordStart - 1])) wordStart--;
  if (text.slice(wordStart, end) === 'client') {
    return text.slice(0, wordStart).trimEnd() + ' ';
  }
  return text;
}

export function vskToTsx(source: string): string {
  let ast: any;
  try {
    ast = parse(source);
  } catch {
    return source;
  }

  const clean = blankForClauses(source, ast);
  const edits: Edit[] = [];
  for (const { node, start } of getComponents(ast)) {
    const body = node.body;
    if (!body || body.start == null || body.end == null) continue;
    let transformed = stripTrailingClient(replaceFirstKeyword(clean.slice(start, body.start), 'component', 'function'));
    if (!transformed.includes('(')) {
      transformed = transformed.trimEnd() + '() ';
    }
    const statementMode = isStatementMode(node);
    let wrapped: string;
    if (statementMode) {
      const bodyText = rewriteTrackDecls(tsxEmitBody(clean, body.body ?? [], ''));
      wrapped = '{ ' + bodyText.trim() + ' }';
    } else {
      const raw = clean.slice(body.start, body.end);
      const inner = raw.trim();
      const hasBraces = inner.startsWith('{') && inner.endsWith('}');
      const core = hasBraces ? inner.slice(1, -1) : inner;
      const bodyText = rewriteTrackDecls(stripStyleBlocks(core));
      wrapped = hasBraces ? '{ ' + bodyText.trim() + ' }' : bodyText;
    }
    edits.push({ start, end: body.end, text: transformed + wrapped });
  }

  const out = applyEdits(source, edits);

  const isModule = (ast.body || []).some(
    (s: any) =>
      s.type === 'ImportDeclaration' ||
      s.type === 'ExportNamedDeclaration' ||
      s.type === 'ExportDefaultDeclaration' ||
      s.type === 'ExportAllDeclaration'
  );
  if (isModule && containsIdentifier(out, 'Head') && !isIdentifierImported(out, 'Head')) {
    return `declare const Head: (props: { children?: unknown }) => unknown;\n${out}`;
  }
  return out;
}

function isTypeDecl(stmt: any): boolean {
  return (
    stmt.type === 'TSInterfaceDeclaration' ||
    stmt.type === 'TSTypeAliasDeclaration' ||
    (stmt.type === 'ExportNamedDeclaration' &&
      (stmt.declaration?.type === 'TSInterfaceDeclaration' || stmt.declaration?.type === 'TSTypeAliasDeclaration'))
  );
}

export function generateVskDts(source: string): string {
  let ast: any;
  try {
    ast = parse(source);
  } catch {
    return '';
  }

  const lines: string[] = ['/* generated by vesk — do not edit */', ''];
  const typeDeclNames = new Set<string>();

  for (const stmt of ast.body || []) {
    if (isTypeDecl(stmt)) {
      const name = stmt.id?.name || stmt.declaration?.id?.name;
      if (name) typeDeclNames.add(name);
      lines.push(source.slice(stmt.start, stmt.end), '');
    }
  }

  for (const stmt of ast.body || []) {
    if (stmt.type === 'ImportDeclaration') {
      const src = stmt.source?.value;
      if (typeof src === 'string' && !src.endsWith('.css')) {
        lines.push(source.slice(stmt.start, stmt.end), '');
      }
    }
  }

  for (const { node, defaultExport } of getComponents(ast)) {
    const name = node.id?.name;
    if (!name) continue;
    const propsType = getPropsType(node.params, source);
    const typeName = `${name}Props`;
    const hasType = propsType !== null && propsType !== undefined;
    const collision = typeDeclNames.has(typeName);
    const signature = hasType
      ? (collision ? propsType : typeName) + ' & { children?: unknown }'
      : 'any';
    if (hasType && !collision) {
      lines.push(`export type ${typeName} = ${propsType};`, '');
    } else if (!hasType && !collision) {
      lines.push(`export type ${typeName} = any;`, '');
    }
    if (defaultExport) {
      lines.push(`export default function ${name}(props: ${signature}): unknown;`, '');
    } else {
      lines.push(`export declare function ${name}(props: ${signature}): unknown;`, '');
    }
  }

  return lines.join('\n');
}
