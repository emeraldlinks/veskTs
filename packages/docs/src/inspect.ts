import type { OperationRecord, ProjectIntelligence, RouteRecord, SchemaRecord } from '@vesk/docs/src/ir';

export interface InspectResult {
  kind: 'summary' | 'routes' | 'route' | 'operations' | 'schemas' | 'schema' | 'diagnostics' | 'dependencies';
  query: string | null;
  data: unknown;
}

function matches(value: string, query: string | null): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query.toLowerCase());
}

function operationMatches(operation: OperationRecord, query: string): boolean {
  return matches(`${operation.method} ${operation.id} ${operation.handler}`, query)
    || operation.parameters.some((parameter) => matches(parameter.name, query))
    || operation.responses.some((response) => matches(String(response.status), query));
}

function filterRoutes(intelligence: ProjectIntelligence, query: string | null): RouteRecord[] {
  return intelligence.routes.filter((route) => {
    if (matches(route.path, query)) return true;
    return route.operations.some((operation) => (query ? operationMatches(operation, query) : true));
  });
}

function filterSchemas(intelligence: ProjectIntelligence, query: string | null): SchemaRecord[] {
  return intelligence.schemas.filter((schema) => matches(`${schema.name} ${schema.id}`, query));
}

export function inspect(intelligence: ProjectIntelligence, query: string | null = null): InspectResult {
  const normalized = query?.trim() ?? '';
  const lowered = normalized.toLowerCase();
  if (lowered === 'routes' || lowered === 'api') {
    return { kind: 'routes', query: null, data: filterRoutes(intelligence, null) };
  }
  if (lowered.startsWith('route ')) {
    const target = normalized.slice('route '.length).trim();
    return { kind: 'route', query: target, data: filterRoutes(intelligence, target)[0] ?? null };
  }
  if (lowered === 'schemas' || lowered === 'types') {
    return { kind: 'schemas', query: null, data: filterSchemas(intelligence, null) };
  }
  if (lowered.startsWith('schema ')) {
    const target = normalized.slice('schema '.length).trim();
    return { kind: 'schema', query: target, data: filterSchemas(intelligence, target)[0] ?? null };
  }
  if (lowered === 'operations' || lowered === 'methods') {
    const operations = intelligence.routes.flatMap((route) => route.operations.map((operation) => ({ route: route.path, operation })));
    return { kind: 'operations', query: null, data: operations };
  }
  if (lowered === 'diagnostics' || lowered === 'warnings') {
    return { kind: 'diagnostics', query: null, data: intelligence.diagnostics };
  }
  if (lowered === 'dependencies' || lowered === 'imports') {
    return { kind: 'dependencies', query: null, data: intelligence.dependencies };
  }
  if (normalized.length > 0) {
    const routes = filterRoutes(intelligence, normalized);
    const schemas = filterSchemas(intelligence, normalized);
    if (routes.length > 0) return { kind: 'routes', query: normalized, data: routes };
    if (schemas.length > 0) return { kind: 'schemas', query: normalized, data: schemas };
    return { kind: 'summary', query: normalized, data: intelligence };
  }
  return {
    kind: 'summary',
    query: null,
    data: {
      projectId: intelligence.projectId,
      generatorVersion: intelligence.generatorVersion,
      routes: intelligence.routes.length,
      operations: intelligence.routes.reduce((total, route) => total + route.operations.length, 0),
      schemas: intelligence.schemas.length,
      diagnostics: intelligence.diagnostics.length,
      sourceHash: intelligence.sourceHash,
    },
  };
}

function formatOperation(operation: OperationRecord): string {
  const params = operation.parameters.length > 0 ? ` params=${operation.parameters.length}` : '';
  const body = operation.requestBody ? ' body' : '';
  const responses = operation.responses.map((response) => String(response.status)).join(',');
  return `  ${operation.method.padEnd(6)} ${operation.id}${params}${body} -> ${responses || 'none'}`;
}

function formatRoute(route: RouteRecord): string {
  const lines = [`${route.path}  [${route.sourceFile}]`];
  for (const operation of route.operations) lines.push(formatOperation(operation));
  return lines.join('\n');
}

export function formatInspection(result: InspectResult, json: boolean): string {
  if (json) return `${JSON.stringify(result.data, null, 2)}\n`;
  const data = result.data;
  if (result.kind === 'summary' && !result.query) {
    const value = data as { projectId: string; generatorVersion: string; routes: number; operations: number; schemas: number; diagnostics: number; sourceHash: string };
    return [
      `Vesk Intelligence ${value.generatorVersion}`,
      `Project: ${value.projectId}`,
      `Source: ${value.sourceHash.slice(0, 16)}`,
      `Routes: ${value.routes}`,
      `Operations: ${value.operations}`,
      `Schemas: ${value.schemas}`,
      `Diagnostics: ${value.diagnostics}`,
    ].join('\n');
  }
  if (result.kind === 'routes' || result.kind === 'route') {
    if (!data) return `No route matched${result.query ? `: ${result.query}` : ''}.`;
    const routes = Array.isArray(data) ? (data as RouteRecord[]) : [data as RouteRecord];
    if (routes.length === 0) return `No routes matched${result.query ? `: ${result.query}` : ''}.`;
    return routes.map(formatRoute).join('\n');
  }
  if (result.kind === 'schemas' || result.kind === 'schema') {
    if (!data) return `No schema matched${result.query ? `: ${result.query}` : ''}.`;
    const schemas = Array.isArray(data) ? (data as SchemaRecord[]) : [data as SchemaRecord];
    if (schemas.length === 0) return `No schemas matched${result.query ? `: ${result.query}` : ''}.`;
    return schemas.map((schema) => `${schema.id}\n${JSON.stringify(schema.schema, null, 2)}`).join('\n');
  }
  if (result.kind === 'operations') {
    const operations = data as Array<{ route: string; operation: OperationRecord }>;
    return operations.map((entry) => `${entry.route}\n${formatOperation(entry.operation)}`).join('\n');
  }
  if (result.kind === 'diagnostics') {
    const diagnostics = data as ProjectIntelligence['diagnostics'];
    if (diagnostics.length === 0) return 'No diagnostics.';
    return diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.code}: ${item.message}${item.source ? ` (${item.source.file}:${item.source.line})` : ''}`).join('\n');
  }
  if (result.kind === 'dependencies') {
    const dependencies = data as ProjectIntelligence['dependencies'];
    return dependencies.map((item) => `${item.kind.padEnd(9)} ${item.from} -> ${item.to}`).join('\n');
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}
