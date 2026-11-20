import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  GeneratedDocsAsset,
  ManifestIntelligenceInfo,
  VeskConfig,
  VeskDocsAuthConfig,
  VeskDocsSecuritySchemeConfig,
} from '@vesk/types';
import type { ProjectIntelligence } from '@vesk/docs/src/ir';
import { generateDocsHtml } from '@vesk/docs/src/docs-html';
import { generateOpenApiJson } from '@vesk/docs/src/openapi';
import { readSwaggerUiAssets } from '@vesk/docs/src/swagger-ui';
import { generateOpenApiYaml } from '@vesk/docs/src/yaml';

export type IntelligenceEnvironment = 'dev' | 'prod';

export interface ResolvedDocsConfig {
  docsPath: string | null;
  playground: boolean;
  openApiJsonPath: string | null;
  openApiYamlPath: string | null;
  securitySchemes?: Record<string, VeskDocsSecuritySchemeConfig>;
  security?: Array<Record<string, string[]>>;
  auth?: VeskDocsAuthConfig;
}

export interface IntelligenceArtifacts {
  projectFile: string;
  projectJson: string;
  openApiJson: string;
  openApiJsonPath: string | null;
  openApiYaml: string;
  openApiYamlPath: string | null;
  docsHtml: string | null;
  docsPath: string | null;
  docsAssets: GeneratedDocsAsset[];
}

export interface WriteArtifactsOptions {
  intelligence: ProjectIntelligence;
  config: VeskConfig | undefined;
  outDir: string;
  projectRoot: string;
  environment: IntelligenceEnvironment;
  appPaths?: string[];
  publicDir?: string;
  title?: string;
  version?: string;
}

export function isIntelligenceEnabled(config: VeskConfig | undefined): boolean {
  return config?.intelligence?.enabled !== false;
}

export function resolveDocsConfig(config: VeskConfig | undefined, environment: IntelligenceEnvironment): ResolvedDocsConfig | null {
  if (!isIntelligenceEnabled(config)) return null;
  const docs = config?.docs;
  if (docs === false) return null;
  if (docs?.enabled === false) return null;
  const uiEnabled = environment === 'dev' ? docs?.dev !== false : docs?.prod === true;
  const openapi = docs?.openapi === false ? false : docs?.openapi;
  return {
    docsPath: uiEnabled ? docs?.path ?? '/docs' : null,
    playground: docs?.playground !== false,
    openApiJsonPath: openapi === false ? null : openapi?.jsonPath ?? '/openapi.json',
    openApiYamlPath: openapi === false ? null : openapi?.yamlPath ?? '/openapi.yaml',
    ...(docs?.securitySchemes ? { securitySchemes: docs.securitySchemes } : {}),
    ...(docs?.security ? { security: docs.security } : {}),
    ...(docs?.auth ? { auth: docs.auth } : {}),
  };
}

export function formatDocsUrl(baseUrl: string, docsPath: string | null): string | null {
  if (!docsPath) return null;
  const path = docsPath.startsWith('/') ? docsPath : `/${docsPath}`;
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function relativeArtifactPath(urlPath: string): string {
  let clean = urlPath;
  while (clean.startsWith('/')) clean = clean.slice(1);
  while (clean.endsWith('/')) clean = clean.slice(0, -1);
  return clean;
}

function publicFileExists(publicDir: string | undefined, urlPath: string): boolean {
  if (!publicDir) return false;
  const target = resolve(publicDir, relativeArtifactPath(urlPath));
  return existsSync(target);
}

function routeExists(appPaths: string[] | undefined, urlPath: string): boolean {
  if (!appPaths) return false;
  const normalized = urlPath.length > 1 && urlPath.endsWith('/') ? urlPath.slice(0, -1) : urlPath;
  return appPaths.some((candidate) => candidate === normalized);
}

export function buildIntelligenceArtifacts(options: WriteArtifactsOptions): IntelligenceArtifacts {
  const docs = resolveDocsConfig(options.config, options.environment);
  const projectJson = `${JSON.stringify(options.intelligence, null, 2)}\n`;
  const openApiOptions = {
    title: options.title,
    version: options.version,
    ...(docs?.securitySchemes ? { securitySchemes: docs.securitySchemes } : {}),
    ...(docs?.security ? { security: docs.security } : {}),
    ...(docs?.auth ? { auth: docs.auth } : {}),
  };
  const openApiJson = generateOpenApiJson(options.intelligence, openApiOptions);
  const openApiYaml = generateOpenApiYaml(options.intelligence, openApiOptions);
  const openApiJsonPath = docs?.openApiJsonPath && !publicFileExists(options.publicDir, docs.openApiJsonPath) ? docs.openApiJsonPath : null;
  const openApiYamlPath = docs?.openApiYamlPath && !publicFileExists(options.publicDir, docs.openApiYamlPath) ? docs.openApiYamlPath : null;
  const requestedDocsPath = docs && docs.docsPath && !routeExists(options.appPaths, docs.docsPath) && !publicFileExists(options.publicDir, docs.docsPath) && !publicFileExists(options.publicDir, `${docs.docsPath}/index.html`) ? docs.docsPath : null;
  const requestedAssetsPath = requestedDocsPath ? `${requestedDocsPath.replace(/\/+$/, '')}/swagger-ui` : null;
  const generatedAssets = requestedAssetsPath
    ? readSwaggerUiAssets().map((asset) => ({
        path: `${requestedAssetsPath}/${asset.file}`,
        contentType: asset.contentType,
        content: asset.content,
      }))
    : [];
  const docsPath = generatedAssets.some((asset) => routeExists(options.appPaths, asset.path) || publicFileExists(options.publicDir, asset.path)) ? null : requestedDocsPath;
  const docsAssets = docsPath ? generatedAssets : [];
  const docsHtml = docs && docsPath
    ? generateDocsHtml(options.intelligence, {
        title: options.title,
        docsPath,
        openApiJsonPath,
        openApiYamlPath,
        playground: docs.playground,
        swaggerAssetsPath: `${docsPath.replace(/\/+$/, '')}/swagger-ui`,
        securitySchemes: docs.securitySchemes,
        security: docs.security,
        auth: docs.auth,
      })
    : null;
  return {
    projectFile: 'intelligence/project.json',
    projectJson,
    openApiJson,
    openApiJsonPath,
    openApiYaml,
    openApiYamlPath,
    docsHtml,
    docsPath,
    docsAssets,
  };
}

export function writeIntelligenceArtifacts(options: WriteArtifactsOptions): ManifestIntelligenceInfo {
  const artifacts = buildIntelligenceArtifacts(options);
  const projectPath = join(options.outDir, artifacts.projectFile);
  mkdirSync(join(options.outDir, 'intelligence'), { recursive: true });
  writeFileSync(projectPath, artifacts.projectJson, 'utf8');
  const staticRoot = join(options.outDir, 'static', 'public');
  if (artifacts.openApiJsonPath) {
    const target = join(staticRoot, relativeArtifactPath(artifacts.openApiJsonPath));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifacts.openApiJson, 'utf8');
  }
  if (artifacts.openApiYamlPath) {
    const target = join(staticRoot, relativeArtifactPath(artifacts.openApiYamlPath));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifacts.openApiYaml, 'utf8');
  }
  if (artifacts.docsHtml && artifacts.docsPath) {
    const target = join(staticRoot, relativeArtifactPath(artifacts.docsPath), 'index.html');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, artifacts.docsHtml, 'utf8');
  }
  for (const asset of artifacts.docsAssets) {
    const target = join(staticRoot, relativeArtifactPath(asset.path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, asset.content, 'utf8');
  }
  return {
    projectFile: artifacts.projectFile,
    hash: options.intelligence.sourceHash,
    docsPath: artifacts.docsPath,
    openapiPaths: [artifacts.openApiJsonPath, artifacts.openApiYamlPath].filter((path): path is string => Boolean(path)),
  };
}

export function intelligenceRoutePaths(config: VeskConfig | undefined, environment: IntelligenceEnvironment): string[] {
  const docs = resolveDocsConfig(config, environment);
  if (!docs) return [];
  return [docs.docsPath, docs.openApiJsonPath, docs.openApiYamlPath].filter((path): path is string => Boolean(path));
}

export function artifactRelativePath(urlPath: string): string {
  return relative(resolve('/'), resolve('/', relativeArtifactPath(urlPath)));
}
