export interface VeskPlugin {
  name: string;
  onBuildStart?: () => Promise<void> | void;
  onBuildEnd?: () => Promise<void> | void;
  onCSS?: (content: string, filePath: string) => Promise<string | null> | string | null;
  [key: string]: unknown;
}

export interface VeskSecurity {
  xFrameOptions?: string;
  hsts?: string | boolean;
  referrerPolicy?: string | boolean;
  contentSecurityPolicy?: string | boolean;
  trustProxy?: boolean | string;
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  [key: string]: unknown;
}

export interface RouteNode {
  path: string;
  fullPath: string;
  isGroup: boolean;
  isDynamic: boolean;
  isCatchAll: boolean;
  page: string | null;
  layout: string | null;
  loading: string | null;
  error: string | null;
  notFound: string | null;
  offline: string | null;
  network: string | null;
  hasMiddleware: boolean;
  children: RouteNode[];
  sourceDir: string;
  segmentCount: number;
  _revalidate?: number;
  _isrTags?: string[];
  _pageName?: string;
  _layoutName?: string;
  chunk?: string;
}

export interface ApiRouteNode {
  path: string;
  fullPath: string;
  isDynamic: boolean;
  isCatchAll: boolean;
  filePath: string;
  children: ApiRouteNode[];
}

export interface MiddlewareChainItem {
  sourcePath: string;
  node: RouteNode;
}

export interface AncestorLayout {
  sourceDir: string;
  layoutCompName: string;
}

export interface BuildOptions {
  outDir?: string;
  publicDir?: string;
  plugins?: VeskPlugin[];
  seo?: boolean;
  strictSeo?: boolean;
  siteUrl?: string;
  ssg?: boolean;
  codeSplit?: boolean;
  hmr?: boolean;
  target?: 'node' | 'edge';
  platform?: 'node' | 'vercel' | 'netlify' | 'cloudflare' | 'deno' | 'aws' | 'edge' | 'coxmos';
  /** Client router route-data freshness TTL (ms). Default 0 = always refetch. */
  routeDataCache?: number;
}

export interface DevServerOptions {
  port?: number;
  publicDir?: string;
  block?: boolean;
}

export interface ProdServerOptions {
  port?: number;
}

export interface SsrFunctionOptions {
  ancestorLayouts?: AncestorLayout[];
  middlewareCode?: string | null;
}

export interface ApiFunctionOptions {
  middlewareCode?: string | null;
}

export interface ClientBundleOptions {
  codeSplit?: boolean;
  hmr?: boolean;
  importRuntime?: boolean;
  routeDataCache?: number;
  /**
   * Incremental compile cache for dev rebuilds. Pass the same object across
   * calls; unchanged files (matched by mtime + size) reuse their previously
   * compiled output instead of re-running compileClient, and the main bundle
   * is reused when its inputs (route tree + runtime import names) are
   * unchanged.
   */
  cache?: ClientBundleCache;
  /**
   * Hot-path restriction for dev rebuilds: only these absolute paths are
   * checked against the filesystem; every other cached file is reused
   * WITHOUT a stat call. Correct under the dev-watcher assumption that any
   * change to a file surfaces as a watch event naming that file.
   */
  only?: string[];
  /**
   * When set together with `only`, the result carries the raw compiled
   * component source for each restricted path (imports/wrappers stripped),
   * so callers building HMR fnSources don't need a second compileClient
   * pass.
   */
  returnEditedSources?: boolean;
}

export interface ClientBundleFileEntry {
  mtimeMs: number;
  size: number;
  compCode: string;
  hydCode: string;
  actualName: string | null;
  runtimeNames: string[];
  /** Absolute paths of this file's .vsk imports, in emission order. */
  imports: string[];
}

export interface ClientBundleCache {
  files: Map<string, ClientBundleFileEntry>;
  mainBundle?: { key: string; code: string };
}

export interface ChunkEntry {
  name: string;
  code: string;
}

export interface ClientBundleResult {
  main: string;
  chunks: ChunkEntry[];
  /** Present when a cache was passed: files served from the incremental cache. */
  cachedFileHits?: number;
  /** Present when a cache was passed: files actually recompiled this call. */
  compiledFiles?: number;
  /** Present when a cache was passed: true when the main bundle was reused. */
  mainFromCache?: boolean;
  /** Present when returnEditedSources was set: path → stripped component source. */
  editedSources?: Map<string, string>;
  /** Present when returnEditedSources was set: path → resolved component name. */
  editedNames?: Map<string, string | null>;
}

export interface ManifestRouteEntry {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
}

export interface ManifestActionEntry {
  id: string;
  function: string;
}

export interface ManifestPrerenderedEntry {
  path: string;
  file: string;
}

export interface Manifest {
  version: number;
  middleware: boolean;
  routes: ManifestRouteEntry[];
  prerendered: ManifestPrerenderedEntry[];
  static: {
    prefix: string;
    dir: string;
  };
  actions?: ManifestActionEntry[];
}

export interface SsgRouteResult {
  path: string;
  html: string;
  static: boolean;
  params?: Record<string, string>;
}

export interface BuildResult {
  routeTree: RouteNode[];
  apiTree: ApiRouteNode[];
  ssrRoutes: RouteNode[];
  apiRoutes: ApiRouteNode[];
  manifest: Manifest;
}

export interface ImageRef {
  source: string;
  src: string;
}

export interface ImageResult {
  src: string;
  baseName: string;
  files: string[];
  widths: number[];
}

export interface MiddlewareExtractResult {
  params: string;
  body: string;
}

export interface SeoCheckIssue {
  severity: 'warn' | 'error';
  message: string;
}

export interface SeoAuditResult {
  passed: number;
  errors: number;
  warnings: number;
}

export interface CombinedPageInfo {
  path: string;
  src: string;
  hasLayout: boolean;
}

export interface SecurityConfig {
  security?: VeskSecurity;
  trustProxy?: boolean;
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
}

export interface MonolithicBundleParts {
  componentLines: string[];
  hydratorLines: string[];
  aliasLines: string[];
  hydratorAliasLines: string[];
}
