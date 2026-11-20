export * from '@vesk/docs/src/ir';
export { analyzeProject, analyzeRoutesOnly } from '@vesk/docs/src/analyzer';
export { analyzeApiRoute, flattenApiRoutes } from '@vesk/docs/src/api-analyzer';
export { createIntelligenceProgram } from '@vesk/docs/src/ts-program';
export { SchemaRegistry, generatorVersion, provenanceSchema, refSchema, sourceLocationFromNode } from '@vesk/docs/src/schema';
export {
  analyzeMiddlewareSecurity,
  builtInSecurityScheme,
  dedupeSecurityRequirements,
  detectSecurity,
  middlewareScopeMatches,
  securitySchemesFromRequirements,
} from '@vesk/docs/src/auth';
export { generateOpenApi, generateOpenApiJson } from '@vesk/docs/src/openapi';
export { generateOpenApiYaml, toYaml } from '@vesk/docs/src/yaml';
export { generateDocsHtml } from '@vesk/docs/src/docs-html';
export { formatInspection, inspect } from '@vesk/docs/src/inspect';
export type { InspectResult } from '@vesk/docs/src/inspect';
export {
  artifactRelativePath,
  buildIntelligenceArtifacts,
  formatDocsUrl,
  intelligenceRoutePaths,
  isIntelligenceEnabled,
  resolveDocsConfig,
  writeIntelligenceArtifacts,
} from '@vesk/docs/src/artifacts';
export { hashFiles, hashText, loadCache, saveCache } from '@vesk/docs/src/cache';
