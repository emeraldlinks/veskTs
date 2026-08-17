/** @module type-utils — Type printing, inference, and resolution for the Vesk LSP. */

import type {
  DocAnalysis, SymbolInfo, TypeDeclaration, FunctionParam,
  TSType, TSKeywordType, TSTypeReference, TSArrayType, TSTupleType,
  TSUnionType, TSIntersectionType, TSTypeLiteral, TSLiteralType,
  TSFunctionType, TSConstructorType, TSTypeOperator, TSTypePredicate,
  TSIndexedAccessType, TSConditionalType, TSMappedType,
  TSPropertySignature, TSMethodSignature, TSCallSignatureDeclaration,
  TSQualifiedName, TSInterfaceBody,
  VariableDeclarator, Pattern, Expression,
} from './types';

// ── Type printing ────────────────────────────────────────────

/** Cast an AST node to a specific subtype for safe property access. */
function as<T>(node: unknown): T { return node as T; }

/** Convert an AST type node into a human-readable string. */
export function printTypeNode(node: TSType | undefined | null): string {
  if (!node) return 'unknown';
  const t = node.type;
  if (t === 'TSNumberKeyword')    return 'number';
  if (t === 'TSStringKeyword')    return 'string';
  if (t === 'TSBooleanKeyword')   return 'boolean';
  if (t === 'TSAnyKeyword')       return 'any';
  if (t === 'TSUnknownKeyword')   return 'unknown';
  if (t === 'TSVoidKeyword')      return 'void';
  if (t === 'TSNeverKeyword')     return 'never';
  if (t === 'TSNullKeyword')      return 'null';
  if (t === 'TSUndefinedKeyword') return 'undefined';
  if (t === 'TSObjectKeyword')    return 'object';
  if (t === 'TSBigIntKeyword')    return 'bigint';
  if (t === 'TSSymbolKeyword')    return 'symbol';
  if (t === 'TSTypeReference')    return printTypeReference(as<TSTypeReference>(node));
  if (t === 'TSArrayType')        return `${printTypeNode(as<TSArrayType>(node).elementType)}[]`;
  if (t === 'TSTupleType')        return `[${(as<TSTupleType>(node).elementTypes || []).map((s: TSType) => printTypeNode(s)).join(', ')}]`;
  if (t === 'TSUnionType')        return (as<TSUnionType>(node).types || []).map((s: TSType) => printTypeNode(s)).join(' | ');
  if (t === 'TSIntersectionType') return (as<TSIntersectionType>(node).types || []).map((s: TSType) => printTypeNode(s)).join(' & ');
  if (t === 'TSTypeLiteral')      return printTypeLiteral(as<TSTypeLiteral>(node));
  if (t === 'TSLiteralType') {
    const l = as<TSLiteralType>(node).literal;
    if (!l) return '';
    if (typeof l === 'object' && 'value' in l) return JSON.stringify(l.value ?? '');
    return '';
  }
  if (t === 'TSFunctionType')     return printFunctionType(as<TSFunctionType>(node));
  if (t === 'TSConstructorType')  return `new ${printFunctionType(as<TSFunctionType>(node))}`;
  if (t === 'TSTypeOperator')     { const op = as<TSTypeOperator>(node); return `${op.operator || ''}${printTypeNode(op.typeAnnotation)}`; }
  if (t === 'TSTypePredicate')    { const p = as<TSTypePredicate>(node); return `${p.parameterName?.name || ''} is ${printTypeNode(p.typeAnnotation)}`; }
  if (t === 'TSIndexedAccessType') { const ia = as<TSIndexedAccessType>(node); return `${printTypeNode(ia.objectType)}[${printTypeNode(ia.indexType)}]`; }
  if (t === 'TSConditionalType')   { const c = as<TSConditionalType>(node); return `${printTypeNode(c.checkType)} extends ${printTypeNode(c.extendsType)} ? ${printTypeNode(c.trueType)} : ${printTypeNode(c.falseType)}`; }
  if (t === 'TSMappedType')       return '{ [K in string]: … }';
  if (t === 'TSSymbolType')       return 'symbol';
  if (t === 'TSSemplateLiteralType') return 'string';
  if (t === 'TSInferType')        return `infer ${as<{ typeParameter?: { params?: Array<{ name: { name: string } }> } }>(node).typeParameter?.params?.[0]?.name?.name || 'T'}`;
  if (t === 'TSParenthesizedType') return `(${printTypeNode(as<{ typeAnnotation: TSType }>(node).typeAnnotation)})`;
  if (t === 'TSImportType')       return `import(${String(as<{ argument?: { value?: string | number } }>(node).argument?.value ?? '')}).…`;
  return '';
}

/** Print a TSTypeReference node. */
function printTypeReference(node: TSTypeReference): string {
  const name = node.typeName ? printQualifiedName(node.typeName) : '';
  const params = node.typeParameters?.params?.length
    ? `<${node.typeParameters.params.map(p => printTypeNode(p)).join(', ')}>`
    : '';
  return name + params;
}

/** Print a TSFunctionType or TSConstructorType node. */
function printFunctionType(node: TSFunctionType): string {
  const params = (node.parameters || []).map(p => printPattern(p)).join(', ');
  const ret = node.returnType ? printTypeNode(node.returnType.typeAnnotation) : '';
  return `(${params})${ret ? ' => ' + ret : ''}`;
}

/** Print a TSQualifiedName (e.g. `React.FC`). */
function printQualifiedName(node: TSQualifiedName | { type: string; name?: string; left?: TSQualifiedName; right?: { name: string } } | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier') return (node as { name: string }).name;
  if (node.type === 'TSQualifiedName') {
    const left = printQualifiedName(node.left);
    return `${left}.${node.right?.name ?? ''}`;
  }
  return '';
}

/** Print a TSTypeLiteral node. */
function printTypeLiteral(node: TSTypeLiteral): string {
  const members = (node.members || [])
    .map(m => printTypeMember(m))
    .filter(Boolean);
  return members.length ? `{ ${members.join('; ')} }` : '{}';
}

/** Print a single type literal member. */
export function printTypeMember(member: TSPropertySignature | TSMethodSignature | TSCallSignatureDeclaration | { type: string; [key: string]: unknown }): string {
  if (!member) return '';
  if (member.type === 'TSPropertySignature') {
    const p = member as TSPropertySignature;
    const key = p.key?.type === 'Identifier' ? p.key.name : (p.key as { value?: string })?.value ?? '';
    const opt = p.optional ? '?' : '';
    const t = p.typeAnnotation ? printTypeNode(p.typeAnnotation.typeAnnotation) : '';
    return `${key}${opt}${t ? ': ' + t : ''}`;
  }
  if (member.type === 'TSMethodSignature') {
    const m = member as TSMethodSignature;
    const key = m.key?.type === 'Identifier' ? m.key.name : '';
    const params = (m.params || []).map(p => printPattern(p)).join(', ');
    const ret = m.returnType ? printTypeNode(m.returnType.typeAnnotation) : '';
    return `${key}(${params})${ret ? ': ' + ret : ''}`;
  }
  if (member.type === 'TSCallSignatureDeclaration') {
    const c = member as TSCallSignatureDeclaration;
    const params = (c.parameters || []).map(p => printPattern(p)).join(', ');
    const ret = c.returnType ? printTypeNode(c.returnType.typeAnnotation) : '';
    return `(${params})${ret ? ': ' + ret : ''}`;
  }
  if (member.type === 'TSIndexSignature') return '[key: string]: …';
  return '';
}

/** Print a destructured pattern as a type annotation. */
function printPattern(pattern: Pattern | undefined): string {
  if (!pattern) return '';
  if (pattern.type === 'Identifier') {
    const id = pattern as { name: string; typeAnnotation?: { typeAnnotation: TSType } };
    return id.typeAnnotation ? `${id.name}: ${printTypeNode(id.typeAnnotation.typeAnnotation)}` : id.name;
  }
  return '…';
}

// ── Type member extraction ───────────────────────────────────

/** Extract property names and types from a TSTypeLiteral node. */
export function typeLiteralMembers(node: TSTypeLiteral | TSInterfaceBody | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!node) return map;

  const members = 'members' in node ? node.members : ('body' in node ? (node as TSInterfaceBody).body : []);
  for (const member of members) {
    if (member.type === 'TSPropertySignature') {
      const key = member.key?.type === 'Identifier' ? member.key.name : (member.key as { value?: string })?.value ?? '';
      if (key) map.set(key, printTypeNode(member.typeAnnotation?.typeAnnotation));
    }
    if (member.type === 'TSMethodSignature') {
      const key = member.key?.type === 'Identifier' ? member.key.name : '';
      if (key) map.set(key, 'function');
    }
  }
  return map;
}

// ── Type inference from AST nodes ────────────────────────────

/**
 * Infer a type string from a variable declarator's type annotation or
 * initializer expression. Checks `typeAnnotation` first, then falls
 * back to the initializer.
 */
export function inferTypeFromDeclarator(
  decl: VariableDeclarator,
  analysis?: DocAnalysis,
): string | undefined {
  if (decl.typeAnnotation) {
    const t = printTypeNode(decl.typeAnnotation.typeAnnotation);
    if (t && t !== 'unknown') return t;
  }
  return decl.init ? inferTypeFromInitializer(decl.init, analysis) : undefined;
}

/**
 * Infer a type string from an expression node. Uses structural
 * heuristics: literals → primitive types, `track(x)` → inner type,
 * `as T` / `satisfies T` → annotated type.
 */
export function inferTypeFromInitializer(
  node: Expression | undefined,
  analysis?: DocAnalysis,
): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'Literal': {
      const v = (node as { value: string | number | boolean | null; regex?: unknown }).value;
      if (v === null) return 'null';
      if (typeof v === 'number')  return 'number';
      if (typeof v === 'string')  return 'string';
      if (typeof v === 'boolean') return 'boolean';
      if ((node as { regex?: unknown }).regex) return 'RegExp';
      return 'unknown';
    }
    case 'Identifier': {
      const id = node as { name: string };
      if (analysis) {
        const syms = analysis.symbols.get(id.name);
        if (syms?.length && syms[0].type) return syms[0].type;
      }
      return undefined;
    }
    case 'ObjectExpression':  return 'object';
    case 'ArrayExpression':   return 'array';
    case 'TemplateLiteral':   return 'string';
    case 'ArrowFunctionExpression':
    case 'FunctionExpression': return 'function';
    case 'ThisExpression':    return 'this';
    case 'UnaryExpression':   return typeof (node as { argument: { value?: unknown } }).argument?.value === 'number' ? 'number' : inferTypeFromInitializer((node as { argument: Expression }).argument, analysis);
    case 'CallExpression': {
      const call = node as { callee: Expression; arguments: Expression[] };
      const calleeName = call.callee.type === 'Identifier' ? (call.callee as { name: string }).name : undefined;
      if ((calleeName === 'track' || calleeName === 'cell') && call.arguments.length) {
        return inferTypeFromInitializer(call.arguments[0], analysis) || 'unknown';
      }
      if (calleeName === 'derived') return 'Derived<T>';
      if (call.callee.type === 'MemberExpression') {
        const member = call.callee as { property: { name?: string } };
        if (member.property?.name === 'call') return 'function';
      }
      return calleeName;
    }
    case 'NewExpression': {
      const ne = node as { callee: Expression };
      return ne.callee.type === 'Identifier' ? (ne.callee as { name: string }).name : undefined;
    }
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion': {
      const asserted = node as { typeAnnotation: { typeAnnotation: TSType }; expression: Expression };
      const t = printTypeNode(asserted.typeAnnotation?.typeAnnotation);
      if (t && t !== 'unknown') return t;
      return inferTypeFromInitializer(asserted.expression, analysis);
    }
    case 'TSNonNullExpression': {
      const nn = node as { expression: Expression };
      return inferTypeFromInitializer(nn.expression, analysis);
    }
    case 'SequenceExpression': {
      const seq = node as { expressions: Expression[] };
      return inferTypeFromInitializer(seq.expressions?.[seq.expressions.length - 1], analysis);
    }
    default: return undefined;
  }
}

// ── Type resolution ──────────────────────────────────────────

/** Type resolution context — maps of name → declarations across the project. */
export interface TypeContext {
  /** Local type declarations in the current file. */
  local: Map<string, TypeDeclaration>;
  /** Global type declarations from `.d.ts` and project index. */
  global: Map<string, TypeDeclaration>;
}

/** Resolve a type reference name to its TypeDeclaration. */
export function resolveType(
  name: string,
  ctx: TypeContext,
): TypeDeclaration | undefined {
  return ctx.local.get(name) || ctx.global.get(name);
}

/** Resolve a TSTypeReference to its member map, if it refers to an interface/type literal. */
export function resolveTypeMembers(
  typeName: { type: string; name?: string; left?: unknown; right?: { name: string } } | undefined,
  ctx: TypeContext,
): Map<string, string> | undefined {
  if (!typeName) return undefined;

  const name = typeName.type === 'Identifier'
    ? (typeName as { name: string }).name
    : typeName.type === 'TSQualifiedName'
      ? printQualifiedName(typeName as TSQualifiedName)
      : undefined;
  if (!name) return undefined;

  const decl = resolveType(name, ctx);
  if (!decl?.members) return undefined;
  return decl.members;
}

/** Build a TypeContext from the project index and a file's AST. */
export function buildTypeContext(
  typeDeclarations: Map<string, TypeDeclaration>,
  fileTypes: TypeDeclaration[],
): TypeContext {
  const local = new Map<string, TypeDeclaration>();
  for (const td of fileTypes) local.set(td.name, td);
  return { local, global: typeDeclarations };
}

/** Extract TypeDeclarations from interface/type/function statements in a file. */
export function extractFileTypes(
  filePath: string,
  ast: { body?: Array<{ type: string; id?: { name: string }; start: number; end: number; body?: unknown; typeAnnotation?: unknown; params?: unknown; typeParameters?: unknown; extends?: unknown }> },
): TypeDeclaration[] {
  const result: TypeDeclaration[] = [];
  if (!ast?.body) return result;

  for (const stmt of ast.body) {
    if (stmt.type === 'TSInterfaceDeclaration') {
      const id = stmt.id;
      if (!id?.name) continue;
      const body = stmt.body as TSInterfaceBody | undefined;
      const members = body ? typeLiteralMembers(body) : new Map();
      const extendsRef = (stmt as { extends?: Array<{ typeName?: { name: string } }> }).extends;
      result.push({
        name: id.name,
        kind: 'interface',
        filePath,
        start: stmt.start,
        end: stmt.end,
        line: 0,
        members,
        extends: extendsRef?.map(e => e.typeName?.name ?? '').filter(Boolean),
      });
    } else if (stmt.type === 'TSTypeAliasDeclaration') {
      const id = stmt.id;
      if (!id?.name) continue;
      const ta = stmt as { typeAnnotation: TSType; typeParameters?: { params?: Array<{ name: { name: string } }> } };
      let members: Map<string, string> | undefined;
      if (ta.typeAnnotation?.type === 'TSTypeLiteral') {
        members = typeLiteralMembers(ta.typeAnnotation as TSTypeLiteral);
      }
      result.push({
        name: id.name,
        kind: 'type',
        filePath,
        start: stmt.start,
        end: stmt.end,
        line: 0,
        typeParams: ta.typeParameters?.params?.map(p => p.name.name),
        members,
      });
    } else if (stmt.type === 'FunctionDeclaration') {
      const id = stmt.id;
      if (!id?.name) continue;
      const fn = stmt as { params: Pattern[]; returnType?: { typeAnnotation: TSType }; typeParameters?: { params?: Array<{ name: { name: string } }> } };
      result.push({
        name: id.name,
        kind: 'function',
        filePath,
        start: stmt.start,
        end: stmt.end,
        line: 0,
        params: fn.params.map(p => extractParamInfo(p)),
        returnType: fn.returnType ? printTypeNode(fn.returnType.typeAnnotation) : undefined,
        typeParams: fn.typeParameters?.params?.map(p => p.name.name),
      });
    } else if (stmt.type === 'ClassDeclaration') {
      const id = stmt.id;
      if (!id?.name) continue;
      result.push({
        name: id.name,
        kind: 'class',
        filePath,
        start: stmt.start,
        end: stmt.end,
        line: 0,
      });
    } else if (stmt.type === 'TSEnumDeclaration') {
      const id = stmt.id;
      if (!id?.name) continue;
      result.push({
        name: id.name,
        kind: 'enum',
        filePath,
        start: stmt.start,
        end: stmt.end,
        line: 0,
      });
    } else if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const inner = (stmt as { declaration?: typeof stmt }).declaration;
      if (inner) {
        const innerTypes = extractFileTypes(filePath, { body: [inner] });
        result.push(...innerTypes);
      }
    }
  }
  return result;
}

/** Extract function parameter info from a Pattern node. */
function extractParamInfo(pattern: Pattern): FunctionParam {
  if (pattern.type === 'Identifier') {
    const id = pattern as { name: string; optional?: boolean; typeAnnotation?: { typeAnnotation: TSType }; defaultValue?: Expression };
    return {
      name: id.name,
      type: id.typeAnnotation ? printTypeNode(id.typeAnnotation.typeAnnotation) : undefined,
      optional: id.optional ?? false,
      defaultValue: id.defaultValue ? '{…}' : undefined,
    };
  }
  return { name: '…', optional: false };
}

// ── JSDoc tag extraction ─────────────────────────────────────

/** Parse `@param`, `@returns`, `@type` tags from a JSDoc string. */
export function parseJSDocTags(jsdoc: string): Map<string, string> {
  const tags = new Map<string, string>();
  if (!jsdoc) return tags;
  const re = /@(\w+)\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsdoc)) !== null) {
    tags.set(m[1], m[2].trim());
  }
  return tags;
}

/** Extract the `@type` annotation from a JSDoc comment, if present. */
export function getJSDocType(jsdoc: string): string | undefined {
  const tags = parseJSDocTags(jsdoc);
  return tags.get('type') || tags.get('typedef') || undefined;
}

/** Extract `@param name — type` from a JSDoc comment. */
export function getJSDocParamType(jsdoc: string, paramName: string): string | undefined {
  const tags = parseJSDocTags(jsdoc);
  const paramTag = tags.get('param') || '';
  const re = new RegExp(`${paramName}\\s*[—:-]\\s*(.+)`);
  const match = paramTag.match(re);
  return match?.[1]?.trim();
}
