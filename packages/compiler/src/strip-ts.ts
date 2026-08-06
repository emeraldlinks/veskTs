import { walk } from 'zimmerframe';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { parse } from '@vesk/compiler/src/parser';

const TS_NODE_TYPES = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
  'TSTypeAnnotation',
  'TSTypeParameterDeclaration',
  'TSTypeParameterInstantiation',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSDeclareFunction',
  'TSDeclareStatement',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'TSImportEqualsDeclaration',
  'TSParameterProperty',
]);

/** True when the AST contains any TypeScript-only node. */
export function hasTsSyntax(ast: any): boolean {
  let found = false;
  walk(ast, null, {
    _(node: any, context: any) {
      if (TS_NODE_TYPES.has(node.type)) {
        found = true;
        return;
      }
      return context.next();
    },
  });
  return found;
}

const TYPE_ONLY_STATEMENTS = new Set([
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSDeclareFunction',
  'TSDeclareStatement',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'TSImportEqualsDeclaration',
]);

/** True when a Program-body statement is type-only (safe to drop from emitted JS). */
export function isTypeOnlyStatement(node: any): boolean {
  if (!node) return true;
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    return !!node.declaration && isTypeOnlyStatement(node.declaration);
  }
  return TYPE_ONLY_STATEMENTS.has(node.type);
}

/**
 * Removes TypeScript-only syntax from an estree AST:
 * - type annotations on declarators, params, return types and class fields
 * - `as` / `satisfies` / `!` / `<T>expr` / generic-call wrappers, replaced by
 *   their inner expression
 * - type arguments on call/new expressions and type parameter declarations
 * - whole type-only statements (interfaces, type aliases, declare/abstract
 *   members), replaced by null entries
 *
 * Returns a new tree (zimmerframe walks are immutable); callers must use the
 * return value.
 */
export function stripTsTypes(ast: any): any {
  return walk(ast, null, {
    TSAsExpression(node: any, context: any) {
      return context.visit(node.expression);
    },
    TSSatisfiesExpression(node: any, context: any) {
      return context.visit(node.expression);
    },
    TSNonNullExpression(node: any, context: any) {
      return context.visit(node.expression);
    },
    TSTypeAssertion(node: any, context: any) {
      return context.visit(node.expression);
    },
    TSInstantiationExpression(node: any, context: any) {
      return context.visit(node.expression);
    },
    VariableDeclarator(node: any, context: any) {
      if (node.id && node.id.typeAnnotation) node.id.typeAnnotation = null;
      return context.next();
    },
    FunctionDeclaration(node: any, context: any) {
      stripFunctionTypes(node);
      return context.next();
    },
    FunctionExpression(node: any, context: any) {
      stripFunctionTypes(node);
      return context.next();
    },
    ArrowFunctionExpression(node: any, context: any) {
      stripFunctionTypes(node);
      return context.next();
    },
    CallExpression(node: any, context: any) {
      if (node.typeArguments) node.typeArguments = null;
      return context.next();
    },
    NewExpression(node: any, context: any) {
      if (node.typeArguments) node.typeArguments = null;
      return context.next();
    },
    PropertyDefinition(node: any, context: any) {
      if (node.typeAnnotation) node.typeAnnotation = null;
      return context.next();
    },
    TSInterfaceDeclaration(node: any) {
      return null;
    },
    TSTypeAliasDeclaration(node: any) {
      return null;
    },
    TSDeclareFunction(node: any) {
      return null;
    },
    TSEnumDeclaration(node: any) {
      return null;
    },
    TSTypeParameterDeclaration(node: any) {
      return null;
    },
  });
}

function stripFunctionTypes(node: any): void {
  if (node.returnType) node.returnType = null;
  if (node.typeParameters) node.typeParameters = null;
  for (const p of node.params || []) {
    if (p.typeAnnotation) p.typeAnnotation = null;
    if (p.optional) p.optional = false;
  }
}

/**
 * Strips TypeScript-only syntax from a plain-JS source snippet (a top-level
 * function like `load`/`getStaticProps`, or an action block). Returns the
 * original source untouched when there is no TS syntax or the reprint fails,
 * so byte-identical fast paths stay intact.
 */
export function stripCodeTypes(code: string): string {
  let ast: any;
  try {
    ast = parse(code);
  } catch {
    return code;
  }
  if (!hasTsSyntax(ast)) return code;
  const stripped = stripTsTypes(ast);
  if (stripped.type === 'Program' && Array.isArray(stripped.body)) {
    stripped.body = stripped.body.filter((n: any) => !isTypeOnlyStatement(n));
  }
  try {
    return print(stripped, ts()).code;
  } catch {
    return code;
  }
}
