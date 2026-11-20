import type { VeskDocsAuthConfig, VeskDocsSecuritySchemeConfig } from '@vesk/types';
import type { OperationRecord, ProjectIntelligence, ResponseRecord, SchemaNode } from '@vesk/docs/src/ir';
import { securitySchemesFromRequirements } from '@vesk/docs/src/auth';
import { resolveDocsSessionAuth, sessionSecurityScheme } from '@vesk/docs/src/auth-session';

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: Record<string, VeskDocsSecuritySchemeConfig>;
  security?: Array<Record<string, string[]>>;
  auth?: VeskDocsAuthConfig;
}

function schemaValue(record: { schema: SchemaNode | null; schemaRef: string | null }): SchemaNode | null {
  if (record.schemaRef) return { $ref: `#/components/schemas/${record.schemaRef}` };
  return record.schema;
}

function responseObject(response: ResponseRecord): Record<string, unknown> {
  const content: Record<string, { schema?: SchemaNode }> = {};
  const schema = schemaValue(response);
  for (const contentType of response.contentTypes) {
    content[contentType] = schema ? { schema } : {};
  }
  const headers: Record<string, { description: string; schema: SchemaNode; required?: boolean }> = {};
  for (const header of response.headers) {
    headers[header.name] = {
      description: header.description ?? 'Response header',
      ...(header.provenance.certainty === 'explicit' ? { required: true } : {}),
      schema: header.schema,
    };
  }
  return {
    description: response.description,
    ...(Object.keys(content).length > 0 ? { content } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function operationSecurity(
  operation: OperationRecord,
  knownSchemes: Set<string>,
  globalSecurity: Array<Record<string, string[]>>,
): { requirements: Array<Record<string, string[]>> | null; secured: boolean } {
  if (operation.securityExempt) return { requirements: [], secured: false };
  const requirements = operation.security.filter((requirement) => knownSchemes.has(requirement.scheme));
  if (requirements.length > 0) {
    return {
      requirements: requirements.map((requirement) => ({ [requirement.scheme]: requirement.scopes })),
      secured: true,
    };
  }
  const inherited = globalSecurity.filter((entry) => Object.keys(entry).every((scheme) => knownSchemes.has(scheme)));
  return { requirements: null, secured: inherited.length > 0 };
}

function operationObject(
  operation: OperationRecord,
  knownSchemes: Set<string>,
  globalSecurity: Array<Record<string, string[]>>,
): Record<string, unknown> {
  const requestBody = operation.requestBody;
  const requestSchema = requestBody ? schemaValue(requestBody) : null;
  const responses: Record<string, unknown> = {};
  for (const response of operation.responses) {
    responses[String(response.status)] = responseObject(response);
  }
  const security = operationSecurity(operation, knownSchemes, globalSecurity);
  if (security.secured) {
    if (!responses['401']) responses['401'] = { description: 'Authentication required' };
    if (!responses['403']) responses['403'] = { description: 'Authenticated but not authorized' };
  }
  return {
    operationId: operation.id,
    ...(operation.summary ? { summary: operation.summary } : {}),
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.parameters.length > 0
      ? {
          parameters: operation.parameters.map((parameter) => ({
            name: parameter.name,
            in: parameter.location,
            required: parameter.location === 'path' ? true : parameter.required,
            ...(parameter.description ? { description: parameter.description } : {}),
            schema: parameter.schema,
          })),
        }
      : {}),
    ...(requestBody && requestSchema
      ? {
          requestBody: {
            required: requestBody.required,
            content: {
              [requestBody.contentType]: { schema: requestSchema },
            },
          },
        }
      : {}),
    responses,
    ...(security.requirements !== null ? { security: security.requirements } : {}),
  };
}

export function generateOpenApi(intelligence: ProjectIntelligence, options: OpenApiOptions = {}): Record<string, unknown> {
  const allRequirements = intelligence.routes.flatMap((route) => route.operations.flatMap((operation) => operation.security));
  const securitySchemes: Record<string, unknown> = {};
  for (const scheme of securitySchemesFromRequirements(allRequirements)) securitySchemes[scheme.id] = scheme.definition;
  for (const scheme of intelligence.securitySchemes ?? []) securitySchemes[scheme.id] = scheme.definition;
  const session = resolveDocsSessionAuth(options.auth);
  if (session) {
    const generated = sessionSecurityScheme(session);
    securitySchemes[generated.id] = generated.definition;
  }
  for (const [id, scheme] of Object.entries(options.securitySchemes ?? {})) securitySchemes[id] = scheme;
  const knownSchemes = new Set(Object.keys(securitySchemes));
  const globalSecurity = (options.security ?? []).filter((entry) => Object.keys(entry).every((scheme) => knownSchemes.has(scheme)));

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...intelligence.routes].sort((a, b) => a.openApiPath.localeCompare(b.openApiPath))) {
    const methods: Record<string, unknown> = {};
    for (const operation of [...route.operations].sort((a, b) => a.method.localeCompare(b.method))) {
      methods[operation.method.toLowerCase()] = operationObject(operation, knownSchemes, globalSecurity);
    }
    paths[route.openApiPath] = methods;
  }
  const schemas: Record<string, SchemaNode> = {};
  for (const schema of intelligence.schemas) schemas[schema.id] = schema.schema;
  const descriptionParts = [options.description];
  if (options.auth?.loginPath) descriptionParts.push(`Log in at ${options.auth.loginPath} to obtain a session cookie.`);
  const description = descriptionParts.filter((part): part is string => Boolean(part)).join('\n\n');
  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Vesk API',
      version: options.version ?? '1.0.0',
      ...(description ? { description } : {}),
    },
    ...(options.servers && options.servers.length > 0 ? { servers: options.servers } : {}),
    ...(globalSecurity.length > 0 ? { security: globalSecurity } : {}),
    paths,
    components: {
      ...(Object.keys(schemas).length > 0 ? { schemas } : {}),
      ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    },
  };
}

export function generateOpenApiJson(intelligence: ProjectIntelligence, options: OpenApiOptions = {}): string {
  return `${JSON.stringify(generateOpenApi(intelligence, options), null, 2)}\n`;
}
