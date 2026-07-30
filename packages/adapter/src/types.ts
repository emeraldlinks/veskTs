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
}

export interface ChunkEntry {
  name: string;
  code: string;
}

export interface ClientBundleResult {
  main: string;
  chunks: ChunkEntry[];
}

export interface ManifestRouteEntry {
  path: string;
  type: 'ssr' | 'api';
  function: string;
  revalidate?: number;
  tags?: string[];
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
