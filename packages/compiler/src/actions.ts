import { walk } from 'zimmerframe';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { parse } from '@vesk/compiler/src/parser';
import { stripTsTypes, hasTsSyntax, isTypeOnlyStatement, stripCodeTypes } from '@vesk/compiler/src/strip-ts';

export interface ActionInfo {
  id: string;
  url: string;
}

export const ACTION_PREFIX = '/_vesk/action/';

export function hashString(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h1 ^ h2).toString(36).slice(0, 12);
}

function literal(value: string | boolean | number): Record<string, unknown> {
  return { type: 'Literal', value };
}

function memberExpr(object: Record<string, unknown>, property: string): Record<string, unknown> {
  return {
    type: 'MemberExpression',
    object,
    property: { type: 'Identifier', name: property },
    computed: false,
    optional: false,
  };
}

function isDefineActionCall(node: any): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'defineAction'
  );
}

function actionUrl(id: string): string {
  return `${ACTION_PREFIX}${id}`;
}

/**
 * Transform a top-level statement's `defineAction(...)` calls.
 *
 * - `server`: inject a stable id as the first argument so the runtime
 *   registers `defineAction("<id>", {...})` into the shared registry.
 * - `client`: replace the call with a stub object literal carrying the same
 *   id + endpoint URL. The `execute` handler (server-only code) is stripped
 *   from the client bundle entirely.
 *
 * Both modes derive the id from the raw call source, so the ids match.
 */
export function rewriteTopLevelActions(code: string, mode: 'server' | 'client'): string {
  if (!code.includes('defineAction')) return stripCodeTypes(code);
  let ast: any;
  try {
    ast = parse(code);
  } catch {
    return code;
  }

  const hadTs = hasTsSyntax(ast);

  ast = walk(ast, null, {
    CallExpression(node: any, context: any) {
      if (isDefineActionCall(node)) {
        const id = hashString(code.slice(node.start ?? 0, node.end ?? code.length));
        if (mode === 'client') {
          return {
            type: 'ObjectExpression',
            properties: [
              { type: 'Property', kind: 'init', method: false, shorthand: false, computed: false, key: { type: 'Identifier', name: '__veskAction' }, value: literal(true) },
              { type: 'Property', kind: 'init', method: false, shorthand: false, computed: false, key: { type: 'Identifier', name: 'id' }, value: literal(id) },
              { type: 'Property', kind: 'init', method: false, shorthand: false, computed: false, key: { type: 'Identifier', name: 'url' }, value: literal(actionUrl(id)) },
            ],
          };
        }
        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'defineAction' },
          arguments: [literal(id), ...(node.arguments || [])],
          optional: false,
        };
      }
      return context.next();
    },
  });

  return printWithTypesStripped(ast, code, hadTs);
}

function printWithTypesStripped(ast: any, code: string, hadTs = hasTsSyntax(ast)): string {
  if (!hadTs) return code;
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

export function transformTopLevelForActions(topLevelCode: string[], mode: 'server' | 'client'): string[] {
  const out: string[] = [];
  for (const c of topLevelCode) {
    const rewritten = rewriteTopLevelActions(c, mode);
    if (rewritten !== '') out.push(rewritten);
  }
  return out;
}

/** Collect the stable action ids defined by a page source (for the manifest). */
export function collectActionIds(source: string): string[] {
  const ids: string[] = [];
  const stmts = collectTopLevelStatements(source);
  for (const code of stmts) {
    if (!code.includes('defineAction')) continue;
    let ast: any;
    try {
      ast = parse(code);
    } catch {
      continue;
    }
    walk(ast, null, {
      CallExpression(node: any, context: any) {
        if (isDefineActionCall(node)) {
          ids.push(hashString(code.slice(node.start ?? 0, node.end ?? code.length)));
          return;
        }
        return context.next();
      },
    });
  }
  return ids;
}

function collectTopLevelStatements(source: string): string[] {
  try {
    const ast = parse(source);
    const statements: string[] = [];
    for (const node of ast.body) {
      const type = (node as any).type;
      if (type === 'ImportDeclaration') continue;
      if (type === 'ExportNamedDeclaration' && (node as any).declaration) continue;
      if (type === 'ExportDefaultDeclaration') {
        const d = (node as any).declaration;
        if (d && typeof d.start === 'number' && typeof d.end === 'number') {
          statements.push(source.slice(d.start, d.end));
        }
        continue;
      }
      if (type === 'ComponentDeclaration') continue;
      if (type === 'ClassDeclaration') continue;
      if (typeof (node as any).start === 'number' && typeof (node as any).end === 'number') {
        statements.push(source.slice((node as any).start, (node as any).end));
      }
    }
    return statements;
  } catch {
    return [];
  }
}
