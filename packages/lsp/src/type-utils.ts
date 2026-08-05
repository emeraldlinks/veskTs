import type { DocAnalysis } from './types';

export function printTypeNode(node: any): string {
  if (!node) return 'unknown';
  switch (node.type) {
    case 'TSNumberKeyword': return 'number';
    case 'TSStringKeyword': return 'string';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSAnyKeyword': return 'any';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSVoidKeyword': return 'void';
    case 'TSNeverKeyword': return 'never';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSObjectKeyword': return 'object';
    case 'TSBigIntKeyword': return 'bigint';
    case 'TSSymbolKeyword': return 'symbol';
    case 'TSTypeReference': {
      const name = node.typeName?.name || node.typeName?.typeName?.name || node.typeName?.left?.name || '';
      const args = node.typeParameters?.params?.length ? `<${node.typeParameters.params.map((p: any) => printTypeNode(p)).join(', ')}>` : '';
      return name + args;
    }
    case 'TSArrayType': return `${printTypeNode(node.elementType)}[]`;
    case 'TSTupleType': return `[${(node.elementTypes || []).map((t: any) => printTypeNode(t)).join(', ')}]`;
    case 'TSUnionType': return (node.types || []).map((t: any) => printTypeNode(t)).join(' | ');
    case 'TSIntersectionType': return (node.types || []).map((t: any) => printTypeNode(t)).join(' & ');
    case 'TSTypeLiteral': {
      const members = (node.members || []).map((m: any) => printTypeMember(m)).filter(Boolean);
      return members.length ? `{ ${members.join('; ')} }` : '{}';
    }
    case 'TSLiteralType': {
      const l = node.literal;
      return l && typeof l === 'object' ? String(l.value ?? '') : '';
    }
    case 'TSStringLiteral': return JSON.stringify(node.value);
    case 'TSNumberLiteral': return String(node.value);
    case 'TSBooleanLiteral': return String(node.value);
    case 'TSFunctionType': return '(…) => …';
    case 'TSConstructorType': return 'new (…) => …';
    case 'TSTypeOperator': return `${node.operator || ''}${printTypeNode(node.typeAnnotation)}`;
    case 'TSTypePredicate': return `${node.parameterName?.name || ''} is ${printTypeNode(node.typeAnnotation)}`;
    case 'TSIndexedAccessType': return `${printTypeNode(node.objectType)}[${printTypeNode(node.indexType)}]`;
    case 'TSQualifiedName': return `${node.left?.name ?? printTypeNode(node.left)}.${node.right?.name ?? ''}`;
    case 'TSConditionalType': return '…';
    case 'TSMappedType': return '{ … }';
    default: return '';
  }
}

export function printTypeMember(member: any): string {
  if (!member) return '';
  if (member.type === 'TSPropertySignature') {
    const key = member.key?.name ?? member.key?.value ?? '';
    const opt = member.optional ? '?' : '';
    const t = member.typeAnnotation ? printTypeNode(member.typeAnnotation.typeAnnotation) : '';
    return `${key}${opt}${t ? ': ' + t : ''}`;
  }
  if (member.type === 'TSMethodSignature') {
    const key = member.key?.name ?? '';
    return `${key}(…)`;
  }
  if (member.type === 'TSIndexSignature') return '[key: string]: …';
  if (member.type === 'TSCallSignatureDeclaration') return '(…)';
  return '';
}

export function typeLiteralMembers(node: any): Map<string, string> {
  const map = new Map<string, string>();
  if (!node || node.type !== 'TSTypeLiteral') return map;
  for (const member of node.members || []) {
    if (member.type !== 'TSPropertySignature') continue;
    const key = member.key?.name;
    if (key) map.set(key, printTypeNode(member.typeAnnotation?.typeAnnotation));
  }
  return map;
}

export function inferTypeFromInitializer(node: any, analysis?: DocAnalysis): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'Literal': {
      const v = node.value;
      if (v === null) return 'null';
      if (typeof v === 'number') return 'number';
      if (typeof v === 'string') return 'string';
      if (typeof v === 'boolean') return 'boolean';
      if (typeof v === 'bigint') return 'bigint';
      if (node.regex) return 'RegExp';
      return 'unknown';
    }
    case 'Identifier': {
      if (analysis) {
        const syms = analysis.symbols.get(node.name);
        if (syms && syms.length && syms[0].type) return syms[0].type;
      }
      return node.name;
    }
    case 'ObjectExpression': return 'object';
    case 'ArrayExpression': return 'array';
    case 'CallExpression': {
      const calleeName = node.callee?.name;
      if ((calleeName === 'track' || calleeName === 'cell') && node.arguments?.length) {
        return inferTypeFromInitializer(node.arguments[0], analysis) || 'unknown';
      }
      if (calleeName === 'derived') return 'Derived<T>';
      if (node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'call') return 'function';
      return calleeName || undefined;
    }
    case 'NewExpression': return node.callee?.name || undefined;
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
      if (node.typeAnnotation) {
        const t = printTypeNode(node.typeAnnotation?.typeAnnotation);
        if (t) return t;
      }
      return inferTypeFromInitializer(node.expression, analysis);
    case 'UnaryExpression':
      return typeof node.argument?.value === 'number' ? 'number' : inferTypeFromInitializer(node.argument, analysis);
    case 'TemplateLiteral': return 'string';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'function';
    case 'SequenceExpression':
      return inferTypeFromInitializer(node.expressions?.[node.expressions.length - 1], analysis);
    default: return undefined;
  }
}