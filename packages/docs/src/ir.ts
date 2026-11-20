import type { IntelligenceProvenance, IntelligenceSourceLocation } from '@vesk/types';

export type SchemaNode = Record<string, unknown>;

export interface SchemaRecord {
  id: string;
  name: string;
  source: IntelligenceSourceLocation | null;
  schema: SchemaNode;
  dependencies: string[];
  provenance: IntelligenceProvenance<SchemaNode>;
}

export interface ParameterRecord {
  name: string;
  location: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description: string | null;
  schema: SchemaNode;
  provenance: IntelligenceProvenance<SchemaNode>;
}

export interface ResponseHeaderRecord {
  name: string;
  description: string | null;
  schema: SchemaNode;
  provenance: IntelligenceProvenance<SchemaNode>;
}

export interface CookieRuleRecord {
  name: string;
  options: Record<string, string | number | boolean>;
  provenance: IntelligenceProvenance<Record<string, string | number | boolean>>;
}

export interface ResponseRecord {
  status: number | 'default';
  description: string;
  contentTypes: string[];
  headers: ResponseHeaderRecord[];
  cookies: CookieRuleRecord[];
  schema: SchemaNode | null;
  schemaRef: string | null;
  provenance: IntelligenceProvenance<SchemaNode | null>;
}

export interface RequestBodyRecord {
  contentType: string;
  required: boolean;
  schema: SchemaNode | null;
  schemaRef: string | null;
  provenance: IntelligenceProvenance<SchemaNode | null>;
}

export interface SecurityRequirementRecord {
  scheme: string;
  scopes: string[];
  provenance: IntelligenceProvenance<string[]>;
}

export type SecuritySchemeDefinition =
  | { type: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string; description?: string }
  | { type: 'http'; scheme: 'bearer' | 'basic'; bearerFormat?: string; description?: string };

export interface SecuritySchemeRecord {
  id: string;
  definition: SecuritySchemeDefinition;
  provenance: IntelligenceProvenance<null>;
}

export interface OperationRecord {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  handler: string;
  summary: string | null;
  description: string | null;
  parameters: ParameterRecord[];
  requestBody: RequestBodyRecord | null;
  responses: ResponseRecord[];
  security: SecurityRequirementRecord[];
  securityExempt?: boolean;
  middleware: string[];
  provenance: IntelligenceProvenance<null>;
}

export interface RouteRecord {
  id: string;
  path: string;
  openApiPath: string;
  sourceFile: string;
  sourceLocation: IntelligenceSourceLocation;
  operations: OperationRecord[];
  provenance: IntelligenceProvenance<null>;
}

export interface ModuleRecord {
  file: string;
  imports: Array<{ specifier: string; source: IntelligenceSourceLocation }>;
  exports: Array<{ name: string; source: IntelligenceSourceLocation }>;
}

export interface DependencyRecord {
  from: string;
  to: string;
  kind: 'import' | 'type' | 'framework';
}

export interface IntelligenceDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  source?: IntelligenceSourceLocation;
}

export interface ProjectIntelligence {
  schemaVersion: 1;
  projectId: string;
  sourceHash: string;
  generatorVersion: string;
  routes: RouteRecord[];
  schemas: SchemaRecord[];
  securitySchemes: SecuritySchemeRecord[];
  modules: ModuleRecord[];
  dependencies: DependencyRecord[];
  diagnostics: IntelligenceDiagnostic[];
}
