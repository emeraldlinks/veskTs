import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';
import type { IntelligenceDiagnostic } from '@vesk/docs/src/ir';
import { scanApiRoutes } from '@vesk/compiler/src/api-routes';
import { analyzeApiRoute, flattenApiRoutes } from '@vesk/docs/src/api-analyzer';
import {
  analyzeMiddlewareSecurity,
  dedupeSecurityRequirements,
  middlewareScopeMatches,
  securitySchemesFromRequirements,
} from '@vesk/docs/src/auth';
import { cachePath, hashFiles, hashText, loadCache, saveCache } from '@vesk/docs/src/cache';
import type { DependencyRecord, ModuleRecord, ProjectIntelligence, RouteRecord, SchemaRecord, SecuritySchemeRecord } from '@vesk/docs/src/ir';
import { SchemaRegistry, generatorVersion, sourceLocationFromNode } from '@vesk/docs/src/schema';
import { createIntelligenceProgram } from '@vesk/docs/src/ts-program';

export interface AnalyzeProjectOptions {
  projectRoot: string;
  appDir?: string;
  exclude?: string[];
  cacheDir?: string;
  disableCache?: boolean;
  defaultSecurityScheme?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readProjectName(projectRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { name?: string };
    if (parsed.name) return parsed.name;
  } catch {
    return basename(projectRoot);
  }
  return basename(projectRoot);
}

function collectModules(files: string[], program: ts.Program): { modules: ModuleRecord[]; dependencies: DependencyRecord[] } {
  const modules: ModuleRecord[] = [];
  const dependencies: DependencyRecord[] = [];
  for (const file of files) {
    if (file.endsWith('.d.ts')) continue;
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const imports: ModuleRecord['imports'] = [];
    const exports: ModuleRecord['exports'] = [];
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
        imports.push({ specifier, source: sourceLocationFromNode(statement) ?? { file, line: 1, column: 1 } });
        const kind = statement.importClause?.isTypeOnly ? 'type' : specifier.startsWith('@vesk/') ? 'framework' : 'import';
        dependencies.push({ from: file, to: specifier, kind });
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
        imports.push({ specifier, source: sourceLocationFromNode(statement) ?? { file, line: 1, column: 1 } });
        dependencies.push({ from: file, to: specifier, kind: statement.isTypeOnly ? 'type' : 'import' });
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      const exported = Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
      if (!exported) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        exports.push({ name: statement.name.text, source: sourceLocationFromNode(statement) ?? { file, line: 1, column: 1 } });
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exports.push({ name: declaration.name.text, source: sourceLocationFromNode(declaration) ?? { file, line: 1, column: 1 } });
          }
        }
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          exports.push({ name: specifier.name.text, source: sourceLocationFromNode(specifier) ?? { file, line: 1, column: 1 } });
        }
      }
    }
    modules.push({ file, imports, exports });
  }
  return { modules, dependencies };
}

function mergeSchemas(target: Map<string, SchemaRecord>, schemas: SchemaRecord[]): void {
  for (const schema of schemas) {
    if (!target.has(schema.id)) target.set(schema.id, schema);
  }
}

export function analyzeProject(options: AnalyzeProjectOptions): ProjectIntelligence {
  const projectRoot = resolve(options.projectRoot);
  const appDir = options.appDir ? resolve(projectRoot, options.appDir) : join(projectRoot, 'app');
  const result = createIntelligenceProgram({ projectRoot, appDir, exclude: options.exclude });
  const checker = result.program.getTypeChecker();
  const registry = new SchemaRegistry(checker, generatorVersion());
  const apiTree = scanApiRoutes(join(appDir, 'api'));
  const routeNodes = flattenApiRoutes(apiTree).sort((a, b) => a.fullPath.localeCompare(b.fullPath));
  const middlewareSecurity = analyzeMiddlewareSecurity(result.program, appDir);
  const diagnostics: IntelligenceDiagnostic[] = [];
  const cacheFile = cachePath(projectRoot, options.cacheDir);
  const cache = options.disableCache ? null : loadCache(cacheFile, generatorVersion());
  const routesById = new Map<string, RouteRecord>();
  const routeCache: Record<string, import('@vesk/docs/src/cache').CachedRoute> = {};
  const allSchemas = new Map<string, SchemaRecord>();
  const allSecuritySchemes = new Map<string, SecuritySchemeRecord>();

  for (const route of routeNodes) {
    if (!route.filePath) continue;
    const applicableMiddleware = middlewareSecurity.filter((record) => middlewareScopeMatches(record.scope, route.fullPath));
    const inheritedSecurity = dedupeSecurityRequirements(applicableMiddleware.flatMap((record) => record.requirements));
    const routeId = route.fullPath;
    const cached = cache?.routes[routeId];
    if (cached && hashFiles([route.filePath, ...cached.dependencies]) === cached.hash) {
      const sourceFile = result.program.getSourceFile(route.filePath);
      if (sourceFile) {
        routesById.set(routeId, cached.route);
        routeCache[routeId] = cached;
        mergeSchemas(allSchemas, cached.schemas);
        mergeSchemas(registry.records, cached.schemas);
        diagnostics.push(...cached.diagnostics);
        continue;
      }
    }
    const sourceFile = result.program.getSourceFile(route.filePath);
    if (!sourceFile) {
      diagnostics.push({
        code: 'VESK-DOCS-003',
        message: `API route source could not be loaded: ${route.filePath}`,
        severity: 'warning',
        source: { file: route.filePath, line: 1, column: 1 },
      });
      continue;
    }
    const before = new Set(registry.records.keys());
    const beforeDiagnostics = diagnostics.length;
    const analyzed = analyzeApiRoute(
      route,
      sourceFile,
      checker,
      registry,
      projectRoot,
      diagnostics,
      inheritedSecurity,
      options.defaultSecurityScheme,
    );
    if (!analyzed) continue;
    routesById.set(routeId, analyzed);
    const newSchemas = [...registry.records.values()].filter((schema) => !before.has(schema.id));
    mergeSchemas(allSchemas, newSchemas);
    const dependencyFiles = unique([
      route.filePath,
      ...applicableMiddleware.map((record) => record.file),
      ...newSchemas.map((schema) => schema.source?.file).filter((file): file is string => Boolean(file)),
    ]);
    routeCache[routeId] = {
      hash: hashFiles(dependencyFiles),
      dependencies: dependencyFiles,
      route: analyzed,
      schemas: newSchemas,
      diagnostics: diagnostics.slice(beforeDiagnostics),
    };
  }

  for (const middleware of middlewareSecurity) {
    for (const scheme of middleware.schemes) allSecuritySchemes.set(scheme.id, scheme);
  }
  for (const route of routesById.values()) {
    for (const operation of route.operations) {
      for (const scheme of securitySchemesFromRequirements(operation.security)) allSecuritySchemes.set(scheme.id, scheme);
    }
  }

  if (!options.disableCache) {
    saveCache(cacheFile, { version: 1, generatorVersion: generatorVersion(), routes: routeCache });
  }

  const sourceHash = hashFiles(result.projectFiles);
  const projectId = hashText(`${readProjectName(projectRoot)}:${sourceHash}`);
  const { modules, dependencies } = collectModules(result.projectFiles, result.program);
  return {
    schemaVersion: 1,
    projectId,
    sourceHash,
    generatorVersion: generatorVersion(),
    routes: [...routesById.values()],
    schemas: [...allSchemas.values()].sort((a, b) => a.id.localeCompare(b.id)),
    securitySchemes: [...allSecuritySchemes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    modules,
    dependencies,
    diagnostics,
  };
}

export function analyzeRoutesOnly(options: AnalyzeProjectOptions): RouteRecord[] {
  return analyzeProject(options).routes;
}
