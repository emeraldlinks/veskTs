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

/** True when a node is a type-only import/export (`import type`, `export type`). */
export function isTypeOnlyImportExport(node: any): boolean {
  if (!node) return false;
  if (node.type === 'ImportDeclaration') return node.importKind === 'type';
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
    return node.exportKind === 'type';
  }
  return false;
}

/** True when a specifier is type-only inside a mixed import/export. */
function isTypeOnlySpecifier(node: any): boolean {
  if (!node) return false;
  if (node.importKind === 'type') return true;
  if (node.exportKind === 'type') return true;
  return false;
}

/** True when the AST contains any TypeScript-only node. */
export function hasTsSyntax(ast: any): boolean {
  let found = false;
  walk(ast, null, {
    _(node: any, context: any) {
      if (TS_NODE_TYPES.has(node.type)) {
        found = true;
        return;
      }
      if (isTypeOnlyImportExport(node) || isTypeOnlySpecifier(node)) {
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
    if (node.exportKind === 'type') return true;
    return !!node.declaration && isTypeOnlyStatement(node.declaration);
  }
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
    return isTypeOnlyImportExport(node);
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
 * - type-only imports/exports (`import type`, `export type { ... }`, and
 *   inline `type` specifiers inside mixed import/export statements)
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
    ImportDeclaration(node: any, context: any) {
      if (isTypeOnlyImportExport(node)) return null;
      if (Array.isArray(node.specifiers)) {
        const kept = node.specifiers.filter((s: any) => !isTypeOnlySpecifier(s));
        if (kept.length === 0) return null;
        node.specifiers = kept;
      }
      return context.next();
    },
    ExportNamedDeclaration(node: any, context: any) {
      if (isTypeOnlyImportExport(node)) return null;
      if (Array.isArray(node.specifiers)) {
        const kept = node.specifiers.filter((s: any) => !isTypeOnlySpecifier(s));
        if (kept.length === 0 && node.declaration == null) return null;
        node.specifiers = kept;
      }
      return context.next();
    },
    ExportAllDeclaration(node: any, context: any) {
      if (isTypeOnlyImportExport(node)) return null;
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
