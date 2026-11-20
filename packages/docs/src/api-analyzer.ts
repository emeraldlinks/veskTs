import ts from 'typescript';
import type { ApiRouteNode, IntelligenceCertainty, IntelligenceSourceLocation } from '@vesk/types';
import type {
  CookieRuleRecord,
  IntelligenceDiagnostic,
  OperationRecord,
  ParameterRecord,
  RequestBodyRecord,
  ResponseHeaderRecord,
  ResponseRecord,
  RouteRecord,
  SchemaNode,
  SecurityRequirementRecord,
} from '@vesk/docs/src/ir';
import { SchemaRegistry, provenanceSchema, sourceLocationFromNode } from '@vesk/docs/src/schema';
import { dedupeSecurityRequirements, detectSecurity } from '@vesk/docs/src/auth';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface HandlerInfo {
  method: HttpMethod;
  name: string;
  node: ts.FunctionLikeDeclaration | ts.VariableDeclaration | ts.ExportSpecifier;
  parameterNames: string[];
}

interface OperationContext {
  checker: ts.TypeChecker;
  registry: SchemaRegistry;
  route: ApiRouteNode;
  sourceFile: ts.SourceFile;
  projectRoot: string;
  diagnostics: IntelligenceDiagnostic[];
  handler: HandlerInfo;
  inheritedSecurity: SecurityRequirementRecord[];
  defaultSecurityScheme: string;
}

interface SchemaResult {
  schema: SchemaNode;
  ref: string | null;
}

function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.some((method) => method === value);
}

function identifierText(node: ts.Node | undefined): string {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
}

function expressionText(node: ts.Expression): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${expressionText(node.expression)}.${node.name.text}`;
  if (ts.isCallExpression(node)) return expressionText(node.expression);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) return expressionText(node.expression);
  return '';
}

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}

function isResponseReceiver(node: ts.Expression): boolean {
  const text = expressionText(node);
  return text === 'VeskResponse' || text === 'Response' || text.endsWith('Response') || text === 'res' || text === 'response';
}

function jsdocComment(comment: string | ts.NodeArray<ts.JSDocComment> | undefined): string {
  if (comment === undefined) return '';
  if (typeof comment === 'string') return comment.trim();
  const parts: string[] = [];
  for (const part of comment) {
    if (typeof part === 'string') parts.push(part);
    else if ('text' in part && typeof part.text === 'string') parts.push(part.text);
  }
  return parts.join('').trim();
}

function jsdocInfo(node: ts.Node): { summary: string | null; description: string | null; tags: ts.JSDocTag[] } {
  const tags = [...ts.getJSDocTags(node)];
  let summary: string | null = null;
  let description: string | null = null;
  for (const tag of tags) {
    const text = jsdocComment(tag.comment);
    if (tag.tagName.text === 'summary' && text) summary = text;
    if (tag.tagName.text === 'description' && text) description = text;
  }
  const docs = ts.getJSDocCommentsAndTags(node);
  for (const doc of docs) {
    if (!ts.isJSDoc(doc)) continue;
    const text = jsdocComment(doc.comment);
    if (text) {
      if (!description) description = text;
      else if (!summary) summary = text;
    }
  }
  return { summary, description, tags };
}

function forEachDescendant(node: ts.Node, visit: (child: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    visit(child);
    forEachDescendant(child, visit);
  });
}

function exportedHandlers(sourceFile: ts.SourceFile): HandlerInfo[] {
  const handlers: HandlerInfo[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(statement)) {
      const method = statement.name.text;
      if (isHttpMethod(method)) {
        handlers.push({
          method,
          name: statement.name.text,
          node: statement,
          parameterNames: statement.parameters.map((parameter) => identifierText(parameter.name)),
        });
      }
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const method = identifierText(declaration.name);
        if (!isHttpMethod(method)) continue;
        handlers.push({ method, name: method, node: declaration, parameterNames: [] });
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        const method = specifier.name.text;
        if (!isHttpMethod(method)) continue;
        handlers.push({ method, name: method, node: specifier, parameterNames: [] });
      }
    }
  }
  return handlers;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function sanitizeId(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = ch.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === '_' || ch === '-') out += ch;
    else out += '_';
  }
  return out || 'operation';
}

function openApiPath(path: string): string {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '/') {
      if (current.length > 0) segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) segments.push(current);
  return `/${segments
    .map((segment) => (segment.length > 0 && segment[0] === ':' ? `{${segment.slice(1)}}` : segment))
    .join('/')}`;
}

function pathParameterNames(path: string): string[] {
  const names: string[] = [];
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment.length > 1 && segment[0] === ':') names.push(segment.slice(1));
  }
  return names;
}

function sourceFor(node: ts.Node | undefined, context: OperationContext): IntelligenceSourceLocation {
  return sourceLocationFromNode(node) ?? {
    file: context.sourceFile.fileName,
    line: 1,
    column: 1,
  };
}

function resolveSchema(type: ts.Type, hint: string, node: ts.Node | undefined, context: OperationContext, certainty: IntelligenceCertainty, nameHint?: string): SchemaResult {
  const source = sourceFor(node, context);
  const resolution = context.registry.schemaFor(type, { nameHint: nameHint ?? hint, node, source, certainty });
  return { schema: resolution.schema, ref: resolution.ref };
}

function inferParameterRequired(type: ts.Type): boolean {
  if (!type.isUnion()) return true;
  return !type.types.some((part) => Boolean(part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
}

function pathParameters(context: OperationContext): ParameterRecord[] {
  const names = pathParameterNames(context.route.fullPath);
  const params: ParameterRecord[] = [];
  for (const name of names) {
    let numeric = false;
    forEachDescendant(context.handler.node, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = expressionText(node.expression);
      if (callee !== 'Number' && callee !== 'parseInt' && callee !== 'parseFloat') return;
      const arg = node.arguments[0];
      if (arg && expressionText(unwrap(arg)) === `params.${name}`) numeric = true;
      if (arg && expressionText(unwrap(arg)).endsWith(`.params.${name}`)) numeric = true;
    });
    const source = sourceFor(context.handler.node, context);
    params.push({
      name,
      location: 'path',
      required: true,
      description: context.route.isCatchAll && name === names[names.length - 1] ? 'Remaining path segments' : null,
      schema: { type: numeric ? 'number' : 'string' },
      provenance: provenanceSchema({ type: numeric ? 'number' : 'string' }, numeric ? 'inferred' : 'explicit', source),
    });
  }
  return params;
}

function requestBodies(context: OperationContext): RequestBodyRecord[] {
  const bodies: RequestBodyRecord[] = [];
  forEachDescendant(context.handler.node, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return;
    const methodName = callee.name.text;
    if (methodName !== 'json' && methodName !== 'formData' && methodName !== 'text') return;
    if (isResponseReceiver(callee.expression)) return;
    const source = sourceFor(node, context);
    let certainty: IntelligenceCertainty = 'unknown';
    let typeNode: ts.TypeNode | undefined;
    if (node.typeArguments && node.typeArguments.length > 0) {
      typeNode = node.typeArguments[0];
      certainty = 'explicit';
    } else {
      let current: ts.Node = node;
      while (current.parent && (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent))) {
        current = current.parent;
      }
      if (ts.isAsExpression(current.parent) && current.parent.type) {
        typeNode = current.parent.type;
        certainty = 'explicit';
      } else if (ts.isVariableDeclaration(current.parent) && current.parent.type) {
        typeNode = current.parent.type;
        certainty = 'resolved';
      }
    }
    let schema: SchemaNode = {};
    let ref: string | null = null;
    if (typeNode) {
      const type = context.checker.getTypeFromTypeNode(typeNode);
      const result = resolveSchema(type, 'RequestBody', typeNode, context, certainty, identifierText(typeNode) || 'RequestBody');
      schema = result.schema;
      ref = result.ref;
    } else {
      context.diagnostics.push({
        code: 'VESK-DOCS-001',
        message: 'Request body type could not be resolved; add a type argument to req.json<T>().',
        severity: 'warning',
        source,
      });
    }
    bodies.push({
      contentType: methodName === 'json' ? 'application/json' : methodName === 'formData' ? 'multipart/form-data' : 'text/plain',
      required: true,
      schema,
      schemaRef: ref,
      provenance: provenanceSchema(schema, certainty, source, certainty === 'unknown' ? 'No typed body source found' : undefined),
    });
  });
  return bodies;
}

function queryAndHeaderParameters(context: OperationContext): ParameterRecord[] {
  const params: ParameterRecord[] = [];
  const seen = new Set<string>();
  forEachDescendant(context.handler.node, (node) => {
    const source = sourceFor(node, context);
    let location: 'query' | 'header' | 'cookie' | null = null;
    let name = '';
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = expressionText(node.expression);
      if (receiver === 'query' || receiver.endsWith('.query')) {
        location = 'query';
        name = node.name.text;
      } else if ((receiver === 'headers' || receiver.endsWith('.headers')) && node.name.text === 'get') {
        location = 'header';
      } else if ((receiver === 'cookies' || receiver.endsWith('.cookies')) && node.name.text === 'get') {
        location = 'cookie';
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
      const receiver = expressionText(node.expression);
      if (receiver === 'query' || receiver.endsWith('.query')) {
        location = 'query';
        name = node.argumentExpression.text;
      }
    }
    if (!location) return;
    if (!name && ts.isCallExpression(node.parent)) {
      const literal = node.parent.arguments[0];
      if (literal && ts.isStringLiteral(literal)) name = literal.text;
    }
    if (!name) return;
    const key = `${location}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const type = context.checker.getTypeAtLocation(node);
    const resolved = resolveSchema(type, name, node, context, 'inferred', `${location}_${name}`);
    params.push({
      name,
      location,
      required: inferParameterRequired(type) && location === 'query',
      description: null,
      schema: resolved.schema,
      provenance: provenanceSchema(resolved.schema, 'inferred', source, 'Referenced from the handler body'),
    });
  });
  return params;
}

function callChain(node: ts.Expression): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  let current = unwrap(node);
  while (ts.isCallExpression(current)) {
    calls.push(current);
    if (!ts.isPropertyAccessExpression(current.expression)) break;
    current = unwrap(current.expression.expression);
  }
  return calls;
}

function numberFromNode(node: ts.Expression | undefined): number | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) return -Number(value.operand.text);
  return undefined;
}

function numberFromText(value: string): number | undefined {
  let text = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch >= '0' && ch <= '9') text += ch;
    else if (text) break;
  }
  return text ? Number(text) : undefined;
}

function stringFromNode(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && identifierText(property.name) === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
  }
  return undefined;
}

function primitiveOptionValue(node: ts.Expression): string | number | boolean | undefined {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  const numeric = numberFromNode(value);
  if (numeric !== undefined) return numeric;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function responseFromReturn(returnNode: ts.ReturnStatement, context: OperationContext): ResponseRecord | null {
  const expression = returnNode.expression;
  if (!expression) return null;
  const source = sourceFor(returnNode, context);
  const calls = callChain(expression);
  let status = 200;
  const statusTag = jsdocInfo(context.handler.node).tags.find((tag) => tag.tagName.text === 'status');
  const annotatedStatus = statusTag ? numberFromText(jsdocComment(statusTag.comment)) : undefined;
  if (annotatedStatus !== undefined) status = annotatedStatus;
  let contentType = 'application/json';
  let bodyNode: ts.Expression | undefined;
  let factoryFound = false;
  const headers: ResponseHeaderRecord[] = [];
  const cookies: CookieRuleRecord[] = [];

  for (const call of calls) {
    if (!ts.isPropertyAccessExpression(call.expression)) continue;
    const name = call.expression.name.text;
    if (name === 'json' || name === 'text' || name === 'html' || name === 'stream' || name === 'body') {
      factoryFound = true;
      contentType = name === 'json' ? 'application/json' : name === 'html' ? 'text/html' : name === 'text' ? 'text/plain' : 'application/octet-stream';
      bodyNode = call.arguments[0];
      const init = call.arguments[1];
      if (init && ts.isObjectLiteralExpression(init)) {
        const explicitStatus = numberFromNode(objectProperty(init, 'status'));
        if (explicitStatus !== undefined) status = explicitStatus;
      }
    }
    if (name === 'setStatus' || name === 'status') {
      const explicitStatus = numberFromNode(call.arguments[0]);
      if (explicitStatus !== undefined) status = explicitStatus;
    }
    if (name === 'redirect') {
      factoryFound = true;
      const receiver = ts.isPropertyAccessExpression(call.expression) ? expressionText(call.expression.expression) : '';
      status = numberFromNode(call.arguments[1]) ?? (receiver === 'VeskResponse' ? 307 : 302);
      contentType = 'text/plain';
    }
    if (name === 'setHeader' || name === 'header') {
      const headerName = stringFromNode(call.arguments[0]);
      if (headerName) {
        const headerType = call.arguments[1] ? context.checker.getTypeAtLocation(call.arguments[1]) : undefined;
        const resolved = headerType ? resolveSchema(headerType, headerName, call, context, 'inferred', `header_${headerName}`) : { schema: { type: 'string' }, ref: null };
        headers.push({
          name: headerName,
          description: null,
          schema: resolved.schema,
          provenance: provenanceSchema(resolved.schema, 'inferred', source, 'Header set in the handler'),
        });
      }
    }
    if (name === 'setCookie' || name === 'cookie') {
      const cookieName = stringFromNode(call.arguments[0]);
      if (cookieName) {
        const optionsNode = call.arguments[2];
        const options: Record<string, string | number | boolean> = {};
        if (optionsNode && ts.isObjectLiteralExpression(optionsNode)) {
          for (const property of optionsNode.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = identifierText(property.name);
            if (key === 'value') continue;
            const value = primitiveOptionValue(property.initializer);
            if (value !== undefined) options[key] = value;
          }
        }
        const record = { ...options };
        cookies.push({
          name: cookieName,
          options: record,
          provenance: provenanceSchema(record, 'inferred', source, 'Cookie options only; value omitted'),
        });
      }
    }
  }

  let schema: SchemaNode = {};
  let schemaRef: string | null = null;
  let certainty: IntelligenceCertainty = 'unknown';
  if (bodyNode) {
    const type = context.checker.getTypeAtLocation(bodyNode);
    const resolved = resolveSchema(type, 'ResponseBody', bodyNode, context, 'inferred', 'ResponseBody');
    schema = resolved.schema;
    schemaRef = resolved.ref;
    certainty = 'inferred';
  } else if (!factoryFound) {
    const type = context.checker.getTypeAtLocation(expression);
    if (type && context.checker.typeToString(type) !== 'void' && context.checker.typeToString(type) !== 'never') {
      const resolved = resolveSchema(type, 'ResponseBody', expression, context, 'inferred', 'ResponseBody');
      schema = resolved.schema;
      schemaRef = resolved.ref;
      certainty = 'inferred';
    }
  }
  if (!bodyNode && !factoryFound && certainty === 'unknown') {
    context.diagnostics.push({
      code: 'VESK-DOCS-002',
      message: 'Response body type could not be resolved from this return statement.',
      severity: 'warning',
      source,
    });
  }
  return {
    status,
    description: status >= 200 && status < 300 ? 'Successful response' : `Response ${status}`,
    contentTypes: [contentType],
    headers,
    cookies,
    schema,
    schemaRef,
    provenance: provenanceSchema(schema, certainty, source, certainty === 'unknown' ? 'No response body source found' : undefined),
  };
}

function thrownResponse(call: ts.CallExpression, context: OperationContext): ResponseRecord | null {
  const name = expressionText(call.expression);
  let status: number | undefined;
  if (name === 'notFound') status = 404;
  else if (name === 'permanentRedirect') status = 308;
  else if (name === 'redirect') status = numberFromNode(call.arguments[1]) ?? 302;
  if (status === undefined) return null;
  return {
    status,
    description: status === 404 ? 'Not Found' : status === 308 ? 'Permanent Redirect' : `Response ${status}`,
    contentTypes: [],
    headers: [],
    cookies: [],
    schema: null,
    schemaRef: null,
    provenance: provenanceSchema(null, 'inferred', sourceFor(call, context), 'Thrown response helper'),
  };
}

function responses(context: OperationContext): ResponseRecord[] {
  const records: ResponseRecord[] = [];
  forEachDescendant(context.handler.node, (node) => {
    if (!ts.isReturnStatement(node)) return;
    let parent: ts.Node | undefined = node.parent;
    while (parent && parent !== context.handler.node) {
      if (ts.isFunctionLike(parent)) return;
      parent = parent.parent;
    }
    const record = responseFromReturn(node, context);
    if (record) records.push(record);
  });
  forEachDescendant(context.handler.node, (node) => {
    if (!ts.isCallExpression(node)) return;
    let parent: ts.Node | undefined = node.parent;
    while (parent && parent !== context.handler.node) {
      if (ts.isFunctionLike(parent)) return;
      parent = parent.parent;
    }
    const record = thrownResponse(node, context);
    if (record) records.push(record);
  });
  const unique = new Map<number | 'default', ResponseRecord>();
  for (const record of records) {
    if (!unique.has(record.status)) unique.set(record.status, record);
  }
  if (unique.size === 0) {
    const source = sourceFor(context.handler.node, context);
    unique.set(200, {
      status: 200,
      description: 'Successful response',
      contentTypes: [],
      headers: [],
      cookies: [],
      schema: null,
      schemaRef: null,
      provenance: provenanceSchema(null, 'unknown', source, 'No explicit response found'),
    });
  }
  return [...unique.values()];
}

function securityRequirements(context: OperationContext): { requirements: SecurityRequirementRecord[]; exempt: boolean } {
  const detection = detectSecurity(context.handler.node, context.sourceFile, { defaultScheme: context.defaultSecurityScheme });
  if (detection.public) return { requirements: [], exempt: true };
  return {
    requirements: dedupeSecurityRequirements([...context.inheritedSecurity, ...detection.requirements]),
    exempt: false,
  };
}

function pickRequestBody(context: OperationContext, bodies: RequestBodyRecord[]): RequestBodyRecord | null {
  if (bodies.length === 0) return null;
  const first = bodies[0];
  for (let i = 1; i < bodies.length; i++) {
    if (bodies[i].schemaRef !== first.schemaRef || bodies[i].contentType !== first.contentType) {
      const source = sourceFor(context.handler.node, context);
      return {
        ...first,
        provenance: provenanceSchema(first.schema, 'contradictory', source, 'Multiple distinct request body shapes found'),
      };
    }
  }
  return first;
}

function analyzeHandler(context: OperationContext): OperationRecord {
  const info = jsdocInfo(context.handler.node);
  const source = sourceFor(context.handler.node, context);
  const params = [...pathParameters(context), ...queryAndHeaderParameters(context)];
  const operationId = sanitizeId(`${context.route.fullPath}_${context.handler.method}`);
  const security = securityRequirements(context);
  return {
    id: operationId,
    method: context.handler.method,
    handler: context.handler.name,
    summary: info.summary,
    description: info.description,
    parameters: params,
    requestBody: pickRequestBody(context, requestBodies(context)),
    responses: responses(context),
    security: security.requirements,
    ...(security.exempt ? { securityExempt: true } : {}),
    middleware: info.tags
      .filter((tag) => tag.tagName.text === 'middleware')
      .map((tag) => jsdocComment(tag.comment))
      .filter((value) => value.length > 0),
    provenance: provenanceSchema(null, 'explicit', source),
  };
}

export function analyzeApiRoute(
  route: ApiRouteNode,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  registry: SchemaRegistry,
  projectRoot: string,
  diagnostics: IntelligenceDiagnostic[],
  inheritedSecurity: SecurityRequirementRecord[] = [],
  defaultSecurityScheme = 'sessionCookie',
): RouteRecord | null {
  if (!route.filePath) return null;
  const handlers = exportedHandlers(sourceFile);
  if (handlers.length === 0) return null;
  const source = sourceLocationFromNode(sourceFile) ?? { file: route.filePath, line: 1, column: 1 };
  const operations = handlers.map((handler) =>
    analyzeHandler({ checker, registry, route, sourceFile, projectRoot, diagnostics, handler, inheritedSecurity, defaultSecurityScheme }),
  );
  return {
    id: sanitizeId(route.fullPath),
    path: route.fullPath,
    openApiPath: openApiPath(`/api${route.fullPath === '/' ? '' : route.fullPath}`),
    sourceFile: route.filePath,
    sourceLocation: source,
    operations,
    provenance: provenanceSchema(null, 'explicit', source),
  };
}

export function flattenApiRoutes(roots: ApiRouteNode[]): ApiRouteNode[] {
  const routes: ApiRouteNode[] = [];
  const visit = (node: ApiRouteNode): void => {
    if (node.filePath) routes.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return routes;
}
