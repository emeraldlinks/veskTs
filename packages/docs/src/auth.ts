import { relative } from 'node:path';
import ts from 'typescript';
import type { SecurityRequirementRecord, SecuritySchemeDefinition, SecuritySchemeRecord } from '@vesk/docs/src/ir';
import { provenanceSchema, sourceLocationFromNode } from '@vesk/docs/src/schema';

const BUILT_IN_SCHEMES: Record<string, SecuritySchemeDefinition> = {
  bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer <token>' },
  apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'X-API-Key: <key>' },
  sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session', description: 'Session cookie set by the application login route.' },
};

export interface SecurityDetection {
  requirements: SecurityRequirementRecord[];
  schemes: SecuritySchemeRecord[];
  public: boolean;
}

export interface MiddlewareSecurityRecord {
  file: string;
  scope: string;
  requirements: SecurityRequirementRecord[];
  schemes: SecuritySchemeRecord[];
}

function sourceOf(node: ts.Node): ReturnType<typeof sourceLocationFromNode> {
  return sourceLocationFromNode(node);
}

function commentText(comment: string | ts.NodeArray<ts.JSDocComment> | undefined): string {
  if (comment === undefined) return '';
  if (typeof comment === 'string') return comment.trim();
  const parts: string[] = [];
  for (const part of comment) {
    if (typeof part === 'string') parts.push(part);
    else if ('text' in part && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join('').trim();
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}

function expressionText(node: ts.Expression): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${expressionText(node.expression)}.${node.name.text}`;
  if (ts.isCallExpression(node)) return expressionText(node.expression);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node)) {
    return expressionText(node.expression);
  }
  return '';
}

function firstStringArgument(node: ts.CallExpression): string {
  const argument = node.arguments[0];
  if (!argument) return '';
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  return '';
}

function schemeFromCredentialText(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower.includes('authorization')) return 'bearerAuth';
  if (lower.includes('api-key') || lower.includes('apikey')) return 'apiKey';
  if (lower.includes('session')) return 'sessionCookie';
  return null;
}

export function builtInSecurityScheme(id: string): SecuritySchemeRecord | null {
  const definition = BUILT_IN_SCHEMES[id];
  if (!definition) return null;
  return {
    id,
    definition,
    provenance: provenanceSchema(null, 'inferred', null, `Built-in Vesk ${id} security scheme`),
  };
}

export function securitySchemesFromRequirements(requirements: SecurityRequirementRecord[]): SecuritySchemeRecord[] {
  const records = new Map<string, SecuritySchemeRecord>();
  for (const requirement of requirements) {
    const scheme = builtInSecurityScheme(requirement.scheme);
    if (!scheme) continue;
    records.set(scheme.id, {
      ...scheme,
      provenance: provenanceSchema(
        null,
        requirement.provenance.certainty,
        requirement.provenance.source ?? null,
        requirement.provenance.reason ?? scheme.provenance.reason,
      ),
    });
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function dedupeSecurityRequirements(requirements: SecurityRequirementRecord[]): SecurityRequirementRecord[] {
  const seen = new Set<string>();
  const result: SecurityRequirementRecord[] = [];
  for (const requirement of requirements) {
    if (seen.has(requirement.scheme)) continue;
    seen.add(requirement.scheme);
    result.push(requirement);
  }
  return result;
}

export function detectSecurity(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  options: { conditionalUser?: boolean; defaultScheme?: string } = {},
): SecurityDetection {
  const requirements: SecurityRequirementRecord[] = [];
  const seen = new Set<string>();
  let isPublic = false;
  let usesAuthenticatedLocals = false;

  const add = (scheme: string, certainty: 'explicit' | 'inferred', reason: string, sourceNode: ts.Node, scopes: string[] = []): void => {
    if (seen.has(scheme)) return;
    seen.add(scheme);
    requirements.push({
      scheme,
      scopes,
      provenance: provenanceSchema(scopes, certainty, sourceOf(sourceNode) ?? sourceOf(sourceFile), reason),
    });
  };

  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text === 'public') {
      isPublic = true;
      continue;
    }
    if (tag.tagName.text !== 'security') continue;
    const words = splitWords(commentText(tag.comment));
    if (words[0] === 'none' || words[0] === 'public') {
      isPublic = true;
      continue;
    }
    if (words[0]) add(words[0], 'explicit', 'Declared with @security', tag, words.slice(1));
  }

  const visit = (current: ts.Node, parents: ts.Node[]): void => {
    if (ts.isCallExpression(current)) {
      const argument = firstStringArgument(current);
      const receiver = expressionText(current.expression);
      if (argument) {
        if (argument === 'user' && receiver.toLowerCase().endsWith('set')) {
          const guarded = parents.some((parent) =>
            ts.isIfStatement(parent) && schemeFromCredentialText(expressionText(parent.expression)) !== null,
          );
          if (options.conditionalUser && guarded) {
            const conditionalScheme = parents
              .filter((parent): parent is ts.IfStatement => ts.isIfStatement(parent))
              .map((parent) => schemeFromCredentialText(expressionText(parent.expression)))
              .find((value): value is string => value !== null);
            add(conditionalScheme ?? 'sessionCookie', 'inferred', 'Middleware guards an authenticated user local', current);
          }
        }
      }
    }
    if (ts.isPropertyAccessExpression(current) && current.name.text === 'user') {
      const receiver = expressionText(current.expression);
      if (receiver === 'locals' || receiver.endsWith('.locals')) usesAuthenticatedLocals = true;
    }
    const nextParents = [...parents, current];
    ts.forEachChild(current, (child) => visit(child, nextParents));
  };
  visit(node, []);

  if (!isPublic && usesAuthenticatedLocals && requirements.length === 0) {
    add(options.defaultScheme ?? 'sessionCookie', 'inferred', 'Reads an authenticated locals.user value', node);
  }

  if (isPublic) return { requirements: [], schemes: [], public: true };
  return { requirements, schemes: securitySchemesFromRequirements(requirements), public: false };
}

function normalizeScopeSegment(segment: string): string {
  if (segment.startsWith('[...') && segment.endsWith(']')) return `*${segment.slice(4, -1)}`;
  if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`;
  return segment;
}

function middlewareScope(file: string, appDir: string): string | null {
  const parts = relative(appDir, file).split('\\').join('/').split('/');
  const name = parts[parts.length - 1] ?? '';
  if (!name.startsWith('middleware.')) return null;
  const directories = parts.slice(0, -1);
  const apiIndex = directories.indexOf('api');
  const scoped = apiIndex >= 0 ? directories.slice(apiIndex + 1) : [];
  const scope = scoped.map(normalizeScopeSegment).join('/');
  return scope ? `/${scope}` : '/';
}

function findMiddlewareDeclaration(sourceFile: ts.SourceFile): ts.Node | null {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'middleware') return statement;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'middleware') return declaration;
      }
    }
  }
  return null;
}

export function middlewareScopeMatches(scope: string, fullPath: string): boolean {
  if (scope === '/') return true;
  return fullPath === scope || fullPath.startsWith(`${scope}/`);
}

export function analyzeMiddlewareSecurity(program: ts.Program, appDir: string): MiddlewareSecurityRecord[] {
  const records: MiddlewareSecurityRecord[] = [];
  for (const file of program.getRootFileNames()) {
    const name = file.split('\\').join('/').split('/').pop() ?? '';
    if (!name.startsWith('middleware.')) continue;
    const scope = middlewareScope(file, appDir);
    if (scope === null) continue;
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const declaration = findMiddlewareDeclaration(sourceFile);
    if (!declaration) continue;
    const detection = detectSecurity(declaration, sourceFile, { conditionalUser: true });
    if (detection.public) continue;
    records.push({
      file,
      scope,
      requirements: detection.requirements,
      schemes: detection.schemes,
    });
  }
  return records.sort((a, b) => a.scope.localeCompare(b.scope) || a.file.localeCompare(b.file));
}
