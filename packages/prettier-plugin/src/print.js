import { doc } from 'prettier';

const { builders: b, utils } = doc;
const {
  group,
  indent,
  hardline,
  softline,
  line,
  literalline,
  join,
  fill,
  ifBreak,
  lineSuffix,
  breakParent,
  conditionalGroup,
  indentIfBreak,
} = b;
const { replaceEndOfLine, stripTrailingHardline, willBreak } = utils;

// ── Helpers ─────────────────────────────────────────────────────

function semi(options) {
  return options.semi ? ';' : '';
}

function printComment(comment) {
  return comment.type === 'Line' ? '//' + comment.value : '/*' + comment.value + '*/';
}

function quoteString(str, single) {
  const quote = single ? "'" : '"';
  const out = [];
  for (const ch of str) {
    if (ch === quote) out.push('\\' + ch);
    else if (ch === '\\') out.push('\\\\');
    else if (ch === '\n') out.push('\\n');
    else if (ch === '\r') out.push('\\r');
    else if (ch === '\t') out.push('\\t');
    else if (ch === '\u2028') out.push('\\u2028');
    else if (ch === '\u2029') out.push('\\u2029');
    else out.push(ch);
  }
  return quote + out.join('') + quote;
}

function hasBlankLineBetween(prevNode, nextNode) {
  return (
    prevNode &&
    nextNode &&
    prevNode.loc &&
    nextNode.loc &&
    nextNode.loc.start.line - prevNode.loc.end.line >= 2
  );
}

function wasOriginallySingleLine(node) {
  return node.loc && node.loc.start.line === node.loc.end.line;
}

const PRECEDENCE = {
  '||': 1,
  '??': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '===': 6,
  '!==': 6,
  '<': 7,
  '<=': 7,
  '>': 7,
  '>=': 7,
  in: 7,
  instanceof: 7,
  '<<': 8,
  '>>': 8,
  '>>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
  '**': 11,
};

function binaryPrecedence(node) {
  return node.operator === 'in' || node.operator === 'instanceof'
    ? 7
    : node.operator === '??'
      ? 1
      : PRECEDENCE[node.operator] ?? 1;
}

function needsBinaryParens(child, operator, side) {
  if (!child || child.type !== 'BinaryExpression') return false;
  const childPrec = binaryPrecedence(child);
  const parentPrec = PRECEDENCE[operator] ?? 1;
  if (childPrec < parentPrec) return true;
  if (childPrec === parentPrec) {
    if (operator === '**') return side === 'left';
    if (operator === '??' || child.operator === '??') return true;
    return side === 'right';
  }
  return false;
}

// ── Statement list printing ─────────────────────────────────────

function printStatementList(docs, nodes, options) {
  const out = [];
  for (let i = 0; i < docs.length; i++) {
    out.push(docs[i]);
    if (i < docs.length - 1) {
      out.push(hasBlankLineBetween(nodes[i], nodes[i + 1]) ? [hardline, hardline] : hardline);
    }
  }
  return out;
}

function printBlock(node, path, options, print) {
  if (!node.body.length) return '{}';
  const docs = path.map(print, 'body');
  return group([
    '{',
    indent([hardline, ...printStatementList(docs, node.body, options)]),
    hardline,
    '}',
  ]);
}

function printFunctionParams(node, path, options, print) {
  if (!node.params || node.params.length === 0) return '()';
  return printParams(node, path, options, print);
}

function printParams(node, path, options, print) {
  const params = node.params || [];
  if (params.length === 0) return '';
  const docs = path.map(print, 'params');
  const typeParams = node.typeParameters ? path.call(print, 'typeParameters') : '';
  return group([
    typeParams ? ['<', typeParams, '>'] : '',
    '(',
    indent([softline, join([',', line], docs)]),
    ifBreak(options.trailingComma === 'none' ? '' : ','),
    softline,
    ')',
    node.returnType ? path.call(print, 'returnType') : '',
  ]);
}

function printCallArguments(args, path, options, print) {
  if (args.length === 0) return '()';
  const docs = path.map(print, 'arguments');
  return group([
    '(',
    indent([softline, join([',', line], docs)]),
    ifBreak(options.trailingComma === 'none' ? '' : ','),
    softline,
    ')',
  ]);
}

function printStringLiteral(value, options) {
  return quoteString(value, options.singleQuote);
}

function printLiteral(node, options) {
  if (node.value === null) return 'null';
  if (typeof node.value === 'string') return printStringLiteral(node.value, options);
  if (typeof node.value === 'bigint') return (node.bigint ?? String(node.value)) + 'n';
  if (typeof node.value === 'number') return node.raw ?? String(node.value);
  if (typeof node.value === 'boolean') return String(node.value);
  if (node.regex) return node.raw;
  return String(node.value);
}

function printJSXElementName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return printJSXElementName(node.object) + '.' + printJSXElementName(node.property);
  if (node.type === 'JSXNamespacedName') return node.namespace.name + ':' + node.name.name;
  return '';
}

function normalizeJSXText(raw) {
  return raw.replace(/\s+/g, ' ').trim();
}

function findForAnnotation(node, options) {
  const anns = options.__vskAnnotations;
  if (!anns || !Array.isArray(anns)) return null;
  return anns.find((a) => a.kind === 'for-clause' && a.forStart === node.start) || null;
}

// ── JSX ─────────────────────────────────────────────────────────

function printJSXOpeningElement(node, path, options, print) {
  const tagName = printJSXElementName(node.name);
  const attrs = node.attributes || [];
  const attrDocs = [];
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].type === 'JSXSpreadAttribute') {
      attrDocs.push(['{...', path.call(print, 'attributes', i, 'argument'), '}']);
    } else {
      attrDocs.push(path.call(print, 'attributes', i));
    }
  }
  const hasAttrs = attrDocs.length > 0;
  const typeArgs = node.typeArguments ? path.call(print, 'typeArguments') : '';
  const attrsDoc = hasAttrs ? indent([line, join(line, attrDocs)]) : '';
  if (node.selfClosing) {
    return group(['<', tagName, typeArgs, attrsDoc, hasAttrs ? line : ' ', '/>']);
  }
  return group(['<', tagName, typeArgs, attrsDoc, hasAttrs ? softline : '', '>']);
}

const VESK_JSX_HEADER_RE = /^for\s*\([\s\S]*\)$/;
const VESK_JSX_KEYWORD_RE = /^(empty|else)$/;

function printJSXChildren(node, path, options, print) {
  const children = node.children || [];
  const docs = [];
  const childNodes = [];
  let pendingText = '';
  let pendingTextNode = null;

  const flush = () => {
    if (pendingText) {
      docs.push(pendingText);
      childNodes.push(pendingTextNode);
      pendingText = '';
      pendingTextNode = null;
    }
  };

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'JSXText') {
      const raw = options.originalText.slice(child.start, child.end);
      const text = normalizeJSXText(raw);
      const next = children[i + 1];
      const isControlHeader =
        (VESK_JSX_HEADER_RE.test(text) || VESK_JSX_KEYWORD_RE.test(text)) &&
        next &&
        next.type === 'JSXExpressionContainer' &&
        next.expression &&
        next.expression.type !== 'JSXEmptyExpression';
      if (isControlHeader) {
        flush();
        const exprDoc = path.call((p) => print(p), 'children', i + 1, 'expression');
        docs.push([text, ' ', '{', indent([hardline, exprDoc]), hardline, '}']);
        childNodes.push(next);
        i++;
        continue;
      }
      if (!text) continue;
      if (pendingText) pendingText += ' ' + text;
      else { pendingText = text; pendingTextNode = child; }
    } else {
      flush();
      docs.push(path.call(print, 'children', i));
      childNodes.push(child);
    }
  }
  flush();

  return { docs, childNodes };
}

function printJSXElement(node, path, options, print) {
  const tagName = printJSXElementName(node.openingElement.name);
  const openTag = path.call(
    (openPath) => printJSXOpeningElement(openPath.node, openPath, options, print),
    'openingElement',
  );

  if (node.openingElement.selfClosing || !node.closingElement) {
    return openTag;
  }

  if (tagName === 'style') {
    // Preserve <style> content verbatim (CSS is not re-flowed).
    const raw = options.originalText.slice(node.start, node.end);
    return raw;
  }

  const { docs, childNodes } = printJSXChildren(node, path, options, print);
  const closeTag = ['</', tagName, '>'];

  if (docs.length === 0) {
    return [openTag, closeTag];
  }

  // Single inline text child keeps the tightest layout.
  if (docs.length === 1 && typeof docs[0] === 'string' && wasOriginallySingleLine(node)) {
    return group([openTag, indent([softline, docs[0]]), softline, closeTag]);
  }

  // Single simple expression child hugs the tags: <h1>{count}</h1>
  if (
    docs.length === 1 &&
    childNodes.length === 1 &&
    childNodes[0].type === 'JSXExpressionContainer' &&
    isSimpleExpression(childNodes[0].expression)
  ) {
    return group([openTag, docs[0], closeTag]);
  }

  const body = [];
  for (let i = 0; i < docs.length; i++) {
    body.push(typeof docs[i] === 'string' ? docs[i] : docs[i]);
    if (i < docs.length - 1) {
      body.push(hasBlankLineBetween(childNodes[i], childNodes[i + 1]) ? [hardline, hardline] : hardline);
    }
  }

  return group([openTag, indent([hardline, ...body]), hardline, closeTag]);
}

function printJSXFragment(node, path, options, print) {
  const { docs, childNodes } = printJSXChildren(node, path, options, print);
  if (docs.length === 0) return '<></>';
  if (docs.length === 1 && wasOriginallySingleLine(node)) {
    return group(['<>', indent([softline, docs[0]]), softline, '</>']);
  }
  const body = [];
  for (let i = 0; i < docs.length; i++) {
    body.push(docs[i]);
    if (i < docs.length - 1) {
      body.push(hasBlankLineBetween(childNodes[i], childNodes[i + 1]) ? [hardline, hardline] : hardline);
    }
  }
  return group(['<>', indent([hardline, ...body]), hardline, '</>']);
}

function isSimpleExpression(node) {
  if (!node) return false;
  switch (node.type) {
    case 'Identifier':
    case 'Literal':
    case 'TemplateLiteral':
    case 'MemberExpression':
    case 'CallExpression':
    case 'ThisExpression':
      return true;
    default:
      return false;
  }
}

// ── Expressions ─────────────────────────────────────────────────

function printBinaryExpression(node, path, options, print, parent) {
  const leftDoc = path.call(print, 'left');
  const rightDoc = path.call(print, 'right');
  const left = node.left;
  const right = node.right;

  const wrapLeft = needsBinaryParens(left, node.operator, 'left') || isSequenceLike(left);
  const wrapRight = needsBinaryParens(right, node.operator, 'right') || isSequenceLike(right);

  const doc = [
    wrapLeft ? ['(', leftDoc, ')'] : leftDoc,
    ' ',
    node.operator,
    ' ',
    wrapRight ? ['(', rightDoc, ')'] : rightDoc,
  ];

  if (parent && (parent.type === 'IfStatement' || parent.type === 'WhileStatement' || parent.type === 'ForStatement')) {
    return doc;
  }
  return doc;
}

function isSequenceLike(node) {
  return node && node.type === 'SequenceExpression';
}

// ── TypeScript nodes ────────────────────────────────────────────

function printTSType(node, path, options, print) {
  const kind = {
    TSStringKeyword: 'string',
    TSNumberKeyword: 'number',
    TSBooleanKeyword: 'boolean',
    TSAnyKeyword: 'any',
    TSUnknownKeyword: 'unknown',
    TSVoidKeyword: 'void',
    TSNeverKeyword: 'never',
    TSObjectKeyword: 'object',
    TSSymbolKeyword: 'symbol',
    TSBigIntKeyword: 'bigint',
    TSIntrinsicKeyword: 'intrinsic',
    TSThisType: 'this',
    TSUndefinedKeyword: 'undefined',
    TSNullKeyword: 'null',
  };
  return kind[node.type];
}

// ── Main dispatch ───────────────────────────────────────────────

function finishVeskNode(node, parts, nodeContent) {
  if (node.trailingComments && node.trailingComments.length > 0) {
    const trailingParts = [];
    let previousComment = null;
    for (let i = 0; i < node.trailingComments.length; i++) {
      const comment = node.trailingComments[i];
      const isInline = node.loc && comment.loc && node.loc.end.line === comment.loc.start.line;
      const commentDoc = printComment(comment);
      if (isInline) {
        if (comment.type === 'Line') {
          trailingParts.push(lineSuffix([' ', commentDoc]));
          trailingParts.push(breakParent);
        } else {
          trailingParts.push(' ' + commentDoc);
        }
      } else {
        const refs = [hardline];
        if (previousComment) {
          if (hasBlankLineBetween(previousComment, comment)) refs.push(hardline);
        } else if (hasBlankLineBetween(node, comment)) {
          refs.push(hardline);
        }
        refs.push(commentDoc);
        trailingParts.push(lineSuffix(refs));
      }
      previousComment = comment;
    }
    parts.push(nodeContent, ...trailingParts);
    return parts;
  }
  if (parts.length > 0) {
    parts.push(nodeContent);
    return parts;
  }
  return nodeContent;
}

export function printVeskNode(path, options, print) {
  const node = path.node;
  if (!node || typeof node !== 'object') {
    return String(node ?? '');
  }

  const parts = [];

  // Leading comments
  if (node.leadingComments && node.leadingComments.length > 0) {
    for (let i = 0; i < node.leadingComments.length; i++) {
      const comment = node.leadingComments[i];
      parts.push(printComment(comment));
      parts.push(hardline);
      if (i < node.leadingComments.length - 1 && hasBlankLineBetween(comment, node.leadingComments[i + 1])) {
        parts.push(hardline);
      } else if (i === node.leadingComments.length - 1 && hasBlankLineBetween(comment, node)) {
        parts.push(hardline);
      }
    }
  }

  // prettier-ignore: keep the node's original text verbatim.
  if (node.leadingComments && node.leadingComments.some((c) => c.value.trim() === 'prettier-ignore')) {
    const raw = options.originalText.slice(node.start, node.end);
    return finishVeskNode(node, parts, replaceEndOfLine(raw));
  }

  let nodeContent;

  switch (node.type) {
    case 'Program': {
      const stmts = [];
      const bodyDocs = path.map(print, 'body');
      for (let i = 0; i < bodyDocs.length; i++) {
        stmts.push(bodyDocs[i]);
        if (i < bodyDocs.length - 1) {
          stmts.push(hasBlankLineBetween(node.body[i], node.body[i + 1]) ? [hardline, hardline] : hardline);
        }
      }
      nodeContent = stmts.length > 0 ? [...stmts, hardline] : stmts;
      break;
    }

    case 'ImportDeclaration': {
      const specs = node.specifiers || [];
      const source = printStringLiteral(node.source.value, options);
      if (specs.length === 0) {
        nodeContent = group(['import ', source, semi(options)]);
        break;
      }
      const defaultSpec = specs.find((s) => s.type === 'ImportDefaultSpecifier');
      const namespaceSpec = specs.find((s) => s.type === 'ImportNamespaceSpecifier');
      const namedSpecs = specs.filter((s) => s.type === 'ImportSpecifier');
      const leading = [];
      if (defaultSpec) {
        leading.push(path.call(print, 'specifiers', specs.indexOf(defaultSpec)));
      }
      if (namespaceSpec) {
        leading.push(path.call(print, 'specifiers', specs.indexOf(namespaceSpec)));
      }
      const specDocs = [];
      for (const s of namedSpecs) specDocs.push(path.call(print, 'specifiers', specs.indexOf(s)));
      const header = ['import '];
      if (leading.length) header.push(leading.join(', '));
      if (leading.length && namedSpecs.length) header.push(', ');
      if (namedSpecs.length) {
        header.push(
          group([
            '{',
            indent([softline, join([',', line], specDocs)]),
            ifBreak(options.trailingComma === 'none' ? '' : ','),
            softline,
            '}',
          ]),
        );
      }
      header.push(' from ', source, semi(options));
      nodeContent = group(header);
      break;
    }

    case 'ImportSpecifier':
      nodeContent = [
        path.call(print, 'imported'),
        node.imported.name !== node.local.name ? [' as ', path.call(print, 'local')] : '',
      ];
      break;
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      nodeContent = path.call(print, 'local');
      break;

    case 'ExportNamedDeclaration': {
      if (node.declaration) {
        nodeContent = ['export ', path.call(print, 'declaration')];
        break;
      }
      const specs = node.specifiers || [];
      const source = node.source ? [' from ', printStringLiteral(node.source.value, options)] : '';
      nodeContent = group([
        'export {',
        indent([softline, join([',', line], path.map(print, 'specifiers'))]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        '}',
        source,
        semi(options),
      ]);
      break;
    }
    case 'ExportSpecifier':
      nodeContent = [
        path.call(print, 'local'),
        node.exported.name !== node.local.name ? [' as ', path.call(print, 'exported')] : '',
      ];
      break;
    case 'ExportDefaultDeclaration':
      nodeContent = ['export default ', path.call(print, 'declaration')];
      break;

    case 'ComponentDeclaration': {
      const idDoc = path.call(print, 'id');
      const typeParams = node.typeParameters ? path.call(print, 'typeParameters') : '';
      const paramsDoc =
        node.params && node.params.length > 0
          ? group([
              '(',
              indent([softline, join([',', line], path.map(print, 'params'))]),
              ifBreak(options.trailingComma === 'none' ? '' : ','),
              softline,
              ')',
            ])
          : '';
      const bodyDoc = path.call(print, 'body');
      nodeContent = group([
        'component',
        node.async ? ' async' : '',
        ' ',
        idDoc,
        typeParams,
        paramsDoc,
        node.client ? ' client' : '',
        ' ',
        bodyDoc,
      ]);
      break;
    }

    case 'VariableDeclaration': {
      const declDocs = path.map(print, 'declarations');
      if (declDocs.length === 1) {
        nodeContent = group([node.kind, ' ', declDocs[0], semi(options)]);
      } else {
        nodeContent = group([
          node.kind,
          indent([line, join([',', line], declDocs)]),
          semi(options),
        ]);
      }
      break;
    }
    case 'VariableDeclarator': {
      const idDoc = path.call(print, 'id');
      nodeContent = node.init
        ? group([idDoc, ' = ', path.call(print, 'init')])
        : idDoc;
      break;
    }

    case 'FunctionDeclaration': {
      const idDoc = path.call(print, 'id');
      const paramsDoc = printFunctionParams(node, path, options, print);
      nodeContent = group([
        node.async ? 'async ' : '',
        'function',
        node.generator ? '*' : '',
        ' ',
        idDoc,
        paramsDoc,
        ' ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'FunctionExpression': {
      const idDoc = node.id ? [' ', path.call(print, 'id')] : '';
      const paramsDoc = printFunctionParams(node, path, options, print);
      nodeContent = group([
        node.async ? 'async ' : '',
        'function',
        node.generator ? '*' : '',
        idDoc,
        paramsDoc,
        ' ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'ArrowFunctionExpression': {
      const emptyParams = !node.params || node.params.length === 0;
      const paramsDoc = emptyParams
        ? '()'
        : printParams(node, path, options, print);
      const isBlockBody = node.body.type === 'BlockStatement';
      nodeContent = group([
        node.async ? 'async ' : '',
        paramsDoc,
        ' =>',
        isBlockBody ? ' ' : indent([line, path.call(print, 'body')]),
        isBlockBody ? path.call(print, 'body') : '',
      ]);
      break;
    }

    case 'BlockStatement':
      nodeContent = printBlock(node, path, options, print);
      break;

    case 'VeskBlock': {
      const bodyDocs = path.map(print, 'body');
      if (!node.body.length) {
        nodeContent = [node.tag, ' {}'];
        break;
      }
      nodeContent = group([
        node.tag,
        ' {',
        indent([hardline, ...printStatementList(bodyDocs, node.body, options)]),
        hardline,
        '}',
      ]);
      break;
    }

    case 'ExpressionStatement':
      nodeContent = group([path.call(print, 'expression'), semi(options)]);
      break;

    case 'IfStatement': {
      const testDoc = path.call(print, 'test');
      const consequentDoc = path.call(print, 'consequent');
      const alternate = node.alternate;
      const alternateDoc = alternate
        ? alternate.type === 'IfStatement'
          ? path.call(print, 'alternate')
          : ['else ', path.call(print, 'alternate')]
        : '';
      nodeContent = group([
        'if (',
        testDoc,
        ') ',
        consequentDoc,
        alternate ? [' ', alternateDoc] : '',
      ]);
      break;
    }

    case 'ForStatement': {
      const initDoc = node.init ? path.call(print, 'init') : '';
      const testDoc = node.test ? path.call(print, 'test') : '';
      const updateDoc = node.update ? path.call(print, 'update') : '';
      nodeContent = group([
        'for (',
        initDoc,
        '; ',
        testDoc,
        '; ',
        updateDoc,
        ') ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'ForInStatement':
    case 'ForOfStatement': {
      const ann = findForAnnotation(node, options);
      let extra = '';
      if (ann) {
        if (ann.keyRange) {
          const keyText = options.originalText.slice(ann.keyRange[0], ann.keyRange[1]);
          extra = ['; key ', keyText];
        } else if (ann.indexName) {
          extra = ['; index ', ann.indexName];
        }
      }
      nodeContent = group([
        'for',
        node.type === 'ForOfStatement' && node.await ? ' await' : '',
        ' (',
        path.call(print, 'left'),
        ' ',
        node.type === 'ForOfStatement' ? 'of' : 'in',
        ' ',
        path.call(print, 'right'),
        extra,
        ') ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'WhileStatement':
      nodeContent = group(['while (', path.call(print, 'test'), ') ', path.call(print, 'body')]);
      break;
    case 'DoWhileStatement':
      nodeContent = group(['do ', path.call(print, 'body'), ' while (', path.call(print, 'test'), ')', semi(options)]);
      break;

    case 'TryStatement': {
      const parts2 = ['try ', path.call(print, 'block')];
      if (node.handler) {
        const paramDoc = node.handler.param
          ? [' (', path.call(print, 'handler', 'param'), ')']
          : '';
        parts2.push(' catch', paramDoc, ' ', path.call(print, 'handler', 'body'));
      }
      if (node.finalizer) {
        parts2.push(' finally ', path.call(print, 'finalizer'));
      }
      nodeContent = group(parts2);
      break;
    }
    case 'ThrowStatement':
      nodeContent = group(['throw ', path.call(print, 'argument'), semi(options)]);
      break;
    case 'ReturnStatement':
      nodeContent = group([
        'return',
        node.argument ? [' ', path.call(print, 'argument')] : '',
        semi(options),
      ]);
      break;
    case 'BreakStatement':
      nodeContent = ['break', node.label ? [' ', path.call(print, 'label')] : '', semi(options)];
      break;
    case 'ContinueStatement':
      nodeContent = ['continue', node.label ? [' ', path.call(print, 'label')] : '', semi(options)];
      break;
    case 'DebuggerStatement':
      nodeContent = ['debugger', semi(options)];
      break;
    case 'EmptyStatement':
      nodeContent = ';';
      break;
    case 'LabeledStatement':
      nodeContent = group([path.call(print, 'label'), ': ', path.call(print, 'body')]);
      break;

    case 'SwitchStatement': {
      const caseDocs = path.map(print, 'cases');
      nodeContent = group([
        'switch (',
        path.call(print, 'discriminant'),
        ') {',
        indent([hardline, join(hardline, caseDocs)]),
        hardline,
        '}',
      ]);
      break;
    }
    case 'SwitchCase': {
      const testDoc = node.test
        ? ['case ', path.call(print, 'test'), ':']
        : 'default:';
      if (!node.consequent.length) {
        nodeContent = testDoc;
      } else {
        const bodyDocs = path.map(print, 'consequent');
        nodeContent = [
          testDoc,
          indent([hardline, ...printStatementList(bodyDocs, node.consequent, options)]),
        ];
      }
      break;
    }

    case 'ClassDeclaration': {
      const extendsDoc = node.superClass ? [' extends ', path.call(print, 'superClass')] : '';
      nodeContent = group([
        'class ',
        path.call(print, 'id'),
        extendsDoc,
        ' ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'ClassBody': {
      const memberDocs = path.map(print, 'body');
      nodeContent = group([
        '{',
        indent([hardline, join(hardline, memberDocs)]),
        hardline,
        '}',
      ]);
      break;
    }
    case 'MethodDefinition': {
      const keyDoc = path.call(print, 'key');
      const paramsDoc = printParams(node.value, path, options, print);
      const prefix =
        (node.static ? 'static ' : '') +
        (node.kind === 'get' ? 'get ' : node.kind === 'set' ? 'set ' : '');
      nodeContent = group([prefix, keyDoc, paramsDoc, ' ', path.call(print, 'value', 'body')]);
      break;
    }
    case 'PropertyDefinition': {
      nodeContent = group([
        node.static ? 'static ' : '',
        path.call(print, 'key'),
        node.value ? [' = ', path.call(print, 'value')] : '',
        semi(options),
      ]);
      break;
    }

    case 'CallExpression': {
      const calleeDoc = path.call(print, 'callee');
      const argsDoc = printCallArguments(node.arguments, path, options, print);
      nodeContent = group([calleeDoc, argsDoc]);
      break;
    }
    case 'NewExpression': {
      const argsDoc = printCallArguments(node.arguments, path, options, print);
      nodeContent = group(['new ', path.call(print, 'callee'), argsDoc]);
      break;
    }
    case 'MemberExpression': {
      const objDoc = path.call(print, 'object');
      const propDoc = path.call(print, 'property');
      nodeContent = node.computed
        ? [objDoc, node.optional ? '?.[' : '[', propDoc, ']']
        : [objDoc, node.optional ? '?.' : '.', propDoc];
      break;
    }
    case 'ChainExpression':
      nodeContent = path.call(print, 'expression');
      break;

    case 'UnaryExpression': {
      const arg = node.argument;
      const wrap =
        arg.type === 'BinaryExpression' ||
        arg.type === 'UnaryExpression' ||
        arg.type === 'UpdateExpression' ||
        arg.type === 'SequenceExpression';
      nodeContent = [
        node.operator,
        wrap ? ['(', path.call(print, 'argument'), ')'] : path.call(print, 'argument'),
      ];
      break;
    }
    case 'UpdateExpression':
      nodeContent = node.prefix
        ? [node.operator, path.call(print, 'argument')]
        : [path.call(print, 'argument'), node.operator];
      break;
    case 'BinaryExpression':
      nodeContent = printBinaryExpression(node, path, options, print);
      break;
    case 'LogicalExpression':
      nodeContent = printBinaryExpression(node, path, options, print);
      break;
    case 'AssignmentExpression': {
      const wrapLeft =
        node.left.type === 'BinaryExpression' || node.left.type === 'SequenceExpression';
      nodeContent = group([
        wrapLeft ? ['(', path.call(print, 'left'), ')'] : path.call(print, 'left'),
        ' ',
        node.operator,
        ' ',
        node.right.type === 'AssignmentExpression' || node.right.type === 'SequenceExpression'
          ? ['(', path.call(print, 'right'), ')']
          : path.call(print, 'right'),
      ]);
      break;
    }
    case 'ConditionalExpression': {
      const testDoc = path.call(print, 'test');
      nodeContent = group([
        testDoc.type === 'BinaryExpression' || testDoc.type === 'SequenceExpression'
          ? ['(', testDoc, ')']
          : testDoc,
        indent([line, '? ', path.call(print, 'consequent')]),
        indent([line, ': ', path.call(print, 'alternate')]),
      ]);
      break;
    }
    case 'SequenceExpression':
      nodeContent = join(', ', path.map(print, 'expressions'));
      break;

    case 'ObjectExpression': {
      if (!node.properties.length) {
        nodeContent = '{}';
        break;
      }
      const propDocs = path.map(print, 'properties');
      nodeContent = group([
        '{',
        options.bracketSpacing ? ' ' : '',
        indent([softline, join([',', line], propDocs)]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        options.bracketSpacing ? ' ' : '',
        '}',
      ]);
      break;
    }
    case 'Property': {
      const keyDoc = path.call(print, 'key');
      if (node.method) {
        const paramsDoc = printParams(node.value, path, options, print);
        nodeContent = group([keyDoc, paramsDoc, ' ', path.call(print, 'value', 'body')]);
        break;
      }
      if (node.kind === 'get' || node.kind === 'set') {
        const paramsDoc = printParams(node.value, path, options, print);
        nodeContent = group([node.kind, ' ', keyDoc, paramsDoc, ' ', path.call(print, 'value', 'body')]);
        break;
      }
      if (node.shorthand) {
        nodeContent = keyDoc;
        break;
      }
      const valueDoc = path.call(print, 'value');
      nodeContent = group([
        node.computed ? '[' : '',
        keyDoc,
        node.computed ? ']' : '',
        ': ',
        valueDoc,
      ]);
      break;
    }
    case 'SpreadElement':
      nodeContent = ['...', path.call(print, 'argument')];
      break;

    case 'ArrayExpression': {
      if (!node.elements.length) {
        nodeContent = '[]';
        break;
      }
      const elemDocs = path.map(print, 'elements');
      nodeContent = group([
        '[',
        indent([softline, join([',', line], elemDocs)]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        ']',
      ]);
      break;
    }

    case 'TemplateLiteral': {
      const parts2 = ['`'];
      for (let i = 0; i < node.quasis.length; i++) {
        parts2.push(node.quasis[i].value.raw);
        if (i < node.expressions.length) {
          parts2.push('${', path.call(print, 'expressions', i), '}');
        }
      }
      parts2.push('`');
      nodeContent = parts2;
      break;
    }
    case 'TemplateElement':
      nodeContent = node.value.raw;
      break;
    case 'TaggedTemplateExpression':
      nodeContent = group([path.call(print, 'tag'), path.call(print, 'quasi')]);
      break;

    case 'Identifier':
      nodeContent = node.name;
      break;
    case 'PrivateIdentifier':
      nodeContent = '#' + node.name;
      break;
    case 'Literal':
      nodeContent = printLiteral(node, options);
      break;
    case 'ThisExpression':
      nodeContent = 'this';
      break;
    case 'Super':
      nodeContent = 'super';
      break;
    case 'AwaitExpression':
      nodeContent = ['await ', path.call(print, 'argument')];
      break;
    case 'YieldExpression':
      nodeContent = [
        'yield',
        node.delegate ? '*' : '',
        node.argument ? [' ', path.call(print, 'argument')] : '',
      ];
      break;
    case 'MetaProperty':
      nodeContent = [path.call(print, 'meta'), '.', path.call(print, 'property')];
      break;
    case 'ImportExpression':
      nodeContent = group(['import(', path.call(print, 'source'), ')']);
      break;

    // Patterns
    case 'ArrayPattern': {
      const elemDocs = path.map(print, 'elements');
      nodeContent = group([
        node.lazy ? '&[' : '[',
        indent([softline, join([',', line], elemDocs)]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        ']',
      ]);
      break;
    }
    case 'ObjectPattern': {
      if (!node.properties.length) {
        nodeContent = '{}';
        break;
      }
      const propDocs = path.map(print, 'properties');
      nodeContent = group([
        '{',
        indent([softline, join([',', line], propDocs)]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        '}',
      ]);
      break;
    }
    case 'AssignmentPattern':
      nodeContent = group([
        path.call(print, 'left'),
        ' = ',
        path.call(print, 'right'),
      ]);
      break;
    case 'RestElement':
      nodeContent = ['...', path.call(print, 'argument')];
      break;

    // TypeScript
    case 'TSTypeAnnotation':
      nodeContent = [': ', path.call(print, 'typeAnnotation')];
      break;
    case 'TSTypeReference': {
      const nameDoc = path.call(print, 'typeName');
      nodeContent = [
        nameDoc,
        node.typeArguments ? path.call(print, 'typeArguments') : node.typeParameters ? path.call(print, 'typeParameters') : '',
      ];
      break;
    }
    case 'TSQualifiedName':
      nodeContent = [path.call(print, 'left'), '.', path.call(print, 'right')];
      break;
    case 'TSArrayType':
      nodeContent = [path.call(print, 'elementType'), '[]'];
      break;
    case 'TSUnionType':
      nodeContent = join(' | ', path.map(print, 'types'));
      break;
    case 'TSIntersectionType':
      nodeContent = join(' & ', path.map(print, 'types'));
      break;
    case 'TSTupleType':
      nodeContent = group([
        '[',
        indent([softline, join([',', line], path.map(print, 'elementTypes'))]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        ']',
      ]);
      break;
    case 'TSNamedTupleMember':
      nodeContent = group([path.call(print, 'label'), ': ', path.call(print, 'elementType')]);
      break;
    case 'TSOptionalType':
      nodeContent = [path.call(print, 'typeAnnotation'), '?'];
      break;
    case 'TSLiteralType':
      nodeContent = path.call(print, 'literal');
      break;
    case 'TSFunctionType': {
      const paramsDoc = printParams(node, path, options, print);
      nodeContent = group([paramsDoc, ' => ', path.call(print, 'returnType')]);
      break;
    }
    case 'TSConstructorType':
      nodeContent = group(['new ', printParams(node, path, options, print), ' => ', path.call(print, 'returnType')]);
      break;
    case 'TSTypeLiteral': {
      if (!node.members.length) {
        nodeContent = '{}';
        break;
      }
      const memberDocs = path.map(print, 'members');
      nodeContent = group([
        '{',
        indent([hardline, ...printStatementList(memberDocs, node.members, options)]),
        hardline,
        '}',
      ]);
      break;
    }
    case 'TSPropertySignature': {
      const optional = node.optional ? '?' : '';
      nodeContent = group([
        node.computed ? '[' : '',
        path.call(print, 'key'),
        node.computed ? ']' : '',
        optional,
        node.typeAnnotation ? path.call(print, 'typeAnnotation') : '',
        semi(options),
      ]);
      break;
    }
    case 'TSMethodSignature': {
      const optional = node.optional ? '?' : '';
      const paramsDoc = printParams(node, path, options, print);
      nodeContent = group([
        path.call(print, 'key'),
        optional,
        paramsDoc,
        node.returnType ? path.call(print, 'returnType') : '',
        semi(options),
      ]);
      break;
    }
    case 'TSIndexSignature':
      nodeContent = group([
        '[',
        join(', ', path.map(print, 'parameters')),
        ']',
        node.typeAnnotation ? path.call(print, 'typeAnnotation') : '',
        semi(options),
      ]);
      break;
    case 'TSInterfaceDeclaration': {
      const extendsDoc = node.extends && node.extends.length
        ? [' extends ', join(', ', path.map(print, 'extends'))]
        : '';
      nodeContent = group([
        'interface ',
        path.call(print, 'id'),
        extendsDoc,
        ' ',
        path.call(print, 'body'),
      ]);
      break;
    }
    case 'TSInterfaceBody': {
      const memberDocs = path.map(print, 'body');
      nodeContent = group([
        '{',
        indent([hardline, ...printStatementList(memberDocs, node.body, options)]),
        hardline,
        '}',
      ]);
      break;
    }
    case 'TSInterfaceHeritage':
      nodeContent = group([
        path.call(print, 'expression'),
        node.typeArguments ? path.call(print, 'typeArguments') : '',
      ]);
      break;
    case 'TSTypeAliasDeclaration':
      nodeContent = group([
        'type ',
        path.call(print, 'id'),
        node.typeParameters ? path.call(print, 'typeParameters') : '',
        ' = ',
        path.call(print, 'typeAnnotation'),
        semi(options),
      ]);
      break;
    case 'TSEnumDeclaration': {
      const memberDocs = path.map(print, 'members');
      nodeContent = group([
        'enum ',
        path.call(print, 'id'),
        ' {',
        indent([hardline, join([',', line], memberDocs)]),
        hardline,
        '}',
      ]);
      break;
    }
    case 'TSEnumMember':
      nodeContent = group([
        path.call(print, 'id'),
        node.initializer ? [' = ', path.call(print, 'initializer')] : '',
      ]);
      break;
    case 'TSTypeParameterDeclaration':
      nodeContent = group([
        '<',
        indent([softline, join([',', line], path.map(print, 'params'))]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        '>',
      ]);
      break;
    case 'TSTypeParameterInstantiation':
      nodeContent = group([
        '<',
        indent([softline, join([',', line], path.map(print, 'params'))]),
        ifBreak(options.trailingComma === 'none' ? '' : ','),
        softline,
        '>',
      ]);
      break;
    case 'TSTypeParameter': {
      const constraint = node.constraint ? [' extends ', path.call(print, 'constraint')] : '';
      const defaultVal = node.default ? [' = ', path.call(print, 'default')] : '';
      nodeContent = group([path.call(print, 'name'), constraint, defaultVal]);
      break;
    }
    case 'TSAsExpression':
      nodeContent = group([path.call(print, 'expression'), ' as ', path.call(print, 'typeAnnotation')]);
      break;
    case 'TSSatisfiesExpression':
      nodeContent = group([path.call(print, 'expression'), ' satisfies ', path.call(print, 'typeAnnotation')]);
      break;
    case 'TSIndexedAccessType':
      nodeContent = [path.call(print, 'objectType'), '[', path.call(print, 'indexType'), ']'];
      break;
    case 'TSConditionalType':
      nodeContent = group([
        path.call(print, 'checkType'),
        ' extends ',
        path.call(print, 'extendsType'),
        ' ? ',
        path.call(print, 'trueType'),
        ' : ',
        path.call(print, 'falseType'),
      ]);
      break;
    case 'TSMappedType':
      nodeContent = group(['{ [', path.call(print, 'key'), ']: ', path.call(print, 'typeAnnotation'), ' }']);
      break;
    case 'TSNonNullExpression':
      nodeContent = [path.call(print, 'expression'), '!'];
      break;
    case 'TSTypeOperator':
      nodeContent = [node.operator, ' ', path.call(print, 'typeAnnotation')];
      break;

    // JSX
    case 'JSXElement':
      nodeContent = printJSXElement(node, path, options, print);
      break;
    case 'JSXFragment':
      nodeContent = printJSXFragment(node, path, options, print);
      break;
    case 'JSXOpeningElement':
      nodeContent = printJSXOpeningElement(node, path, options, print);
      break;
    case 'JSXClosingElement':
      nodeContent = ['</', printJSXElementName(node.name), '>'];
      break;
    case 'JSXAttribute': {
      const name = printJSXElementName(node.name);
      if (node.shorthand) {
        nodeContent = ['{', name, '}'];
        break;
      }
      if (!node.value) {
        nodeContent = name;
        break;
      }
      if (node.value.type === 'Literal') {
        nodeContent = [name, '=', quoteString(String(node.value.value), options.jsxSingleQuote)];
        break;
      }
      if (node.value.type === 'JSXExpressionContainer') {
        const expr = node.value.expression;
        if (expr.type === 'Literal' && typeof expr.value === 'string') {
          nodeContent = [name, '=', quoteString(expr.value, options.jsxSingleQuote)];
          break;
        }
        nodeContent = [name, '={', path.call(print, 'value', 'expression'), '}'];
        break;
      }
      nodeContent = name;
      break;
    }
    case 'JSXSpreadAttribute':
      nodeContent = ['{...', path.call(print, 'argument'), '}'];
      break;
    case 'JSXExpressionContainer': {
      if (node.expression.type === 'JSXEmptyExpression') {
        nodeContent = options.originalText.slice(node.start, node.end);
        break;
      }
      const exprDoc = path.call(print, 'expression');
      nodeContent = group(['{', exprDoc, '}']);
      break;
    }
    case 'JSXEmptyExpression':
      nodeContent = '';
      break;
    case 'JSXIdentifier':
    case 'JSXNamespacedName':
    case 'JSXMemberExpression':
      nodeContent = printJSXElementName(node);
      break;
    case 'JSXText':
      nodeContent = normalizeJSXText(node.value);
      break;

    default: {
      // Known type-keyword nodes and catch-alls.
      const keyword = printTSType(node, path, options, print);
      if (keyword) {
        nodeContent = keyword;
        break;
      }
      nodeContent = '<<UNKNOWN:'+node.type+'>>';
      break;
    }
  }

  // Inner comments (comments placed inside a node with no statement slot)
  if (node.innerComments && node.innerComments.length > 0) {
    const inner = node.innerComments.map(printComment);
    if (Array.isArray(nodeContent)) {
      return [...parts, ...inner, ...nodeContent];
    }
    return [...parts, ...inner, nodeContent];
  }

  return finishVeskNode(node, parts, nodeContent);
}
