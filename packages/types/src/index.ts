/**
 * @vesk/types — single source of truth for every public Vesk framework type.
 *
 * This package is a pure leaf: no imports from other framework packages, no
 * runtime values. Framework packages re-export these types for backward
 * compatibility, but new code should import from '@vesk/types' directly.
 */

// ────────────────────────────────────────────────────────────────────────────
// Routing
// ────────────────────────────────────────────────────────────────────────────

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
  /** ISR: seconds after which the cached page may be revalidated. */
  _revalidate?: number;
  _isrTags?: string[];
  _pageName?: string;
  _layoutName?: string;
  _errorName?: string;
  _notFoundName?: string;
  /** Client-bundle chunk URL for this node (code-split dev/prod builds). */
  chunk?: string;
  chunkError?: string;
}

export interface ApiRouteNode {
  path: string;
  fullPath: string;
  isDynamic: boolean;
  isCatchAll: boolean;
  filePath: string | null;
  children: ApiRouteNode[];
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  request: Request;
  params: Record<string, string>;
  url: URL;
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  [key: string]: unknown;
}

export interface MiddlewareEntry {
  sourcePath: string;
  node: RouteNode;
}

export interface MiddlewareChainOptions {
  onLast?: (rewriteUrl: string | null, ctx?: MiddlewareContext) => Response | Promise<Response | null> | null;
  plugins?: VeskPlugin[];
}

export interface MiddlewareChainItem {
  sourcePath: string;
  node: RouteNode;
}

export interface MiddlewareExtractResult {
  params: string;
  body: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Plugins
// ────────────────────────────────────────────────────────────────────────────

export interface VeskPlugin {
  name: string;
  provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
  onRequest?: (ctx: MiddlewareContext) => void | Promise<void>;
  onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
  onFileWatch?: (filePath: string) => { handled: boolean } | Promise<{ handled: boolean }>;
  onTransformJS?: (code: string, filePath: string) => string | null | Promise<string | null>;
  onBuildStart?: () => void | Promise<void>;
  onBuildEnd?: () => void | Promise<void>;
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Security
// ────────────────────────────────────────────────────────────────────────────

export interface VeskCors {
  origin: string | string[];
  methods?: string;
  headers?: string;
  credentials?: boolean;
  maxAge?: number;
}

export interface VeskRateLimit {
  windowMs?: number;
  max?: number;
}

export type VeskSecurityPreset = 'strict' | 'default' | 'minimal' | 'off';

export interface VeskSecurity {
  xFrameOptions?: string | false;
  hsts?: string | false;
  referrerPolicy?: string | false;
  contentSecurityPolicy?: boolean | string;
  autoEscape?: boolean;
  csrf?: boolean;
  cors?: VeskCors;
  trustProxy?: boolean | string;
  rateLimit?: VeskRateLimit;
  redactLogs?: boolean;
  [key: string]: unknown;
}

/** Adapter-side alias kept for the prod server / platform handlers. */
export interface SecurityConfig {
  security?: VeskSecurity;
  trustProxy?: boolean;
  rateLimit?: VeskRateLimit;
}

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

/** Raw-HTML handling policy for the `<Md>` renderer.
 * - `'escape'` (default): every HTML-ish construct renders as visible text.
 * - `'allow'`: raw HTML passes through verbatim — only use with trusted content.
 * - `'allowlist'`: only `allowTags` pass through; event-handler attributes are
 *   dropped and `href`/`src` go through URL sanitization. */
export type MdHtmlMode = 'escape' | 'allow' | 'allowlist';

export interface MdConfig {
  /** Raw-HTML policy for Markdown rendering. Default 'escape'. */
  html?: MdHtmlMode;
  /** Tag allowlist for `html: 'allowlist'`. Lowercased during validation. */
  allowTags?: string[];
}

export interface VeskConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string;
  ssg?: { getStaticPaths?: () => Promise<{ paths: Array<{ params: Record<string, string> }> }> };
  plugins?: VeskPlugin[];
  security?: VeskSecurity | VeskSecurityPreset | false | ((preset: (name: string, overrides?: VeskSecurity) => VeskSecurity) => VeskSecurity);
  /** Client router route-data freshness TTL in milliseconds. The SPA router
   * refetches a route's server data when it is older than this. Default 0 =
   * always fetch fresh data on every SPA visit. */
  routeDataCache?: number;
  /** Markdown (`<Md>`) rendering options. */
  md?: MdConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// Build pipeline
// ────────────────────────────────────────────────────────────────────────────

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
  /** Markdown policy applied for the build (SSG prerender warnings). */
  md?: MdConfig;
}

export interface DevServerOptions {
  port?: number;
  /** Bind address. Defaults to 127.0.0.1 (loopback) — pass '0.0.0.0' to expose. */
  host?: string;
  publicDir?: string;
  block?: boolean;
  /** Request body size cap in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

export interface ProdServerOptions {
  port?: number;
  /** Bind address. Defaults to 127.0.0.1 (loopback) — pass '0.0.0.0' to expose. */
  host?: string;
  /** Request body size cap in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

export interface SsrFunctionOptions {
  ancestorLayouts?: AncestorLayout[];
  middlewareCode?: string | null;
}

export interface ApiFunctionOptions {
  middlewareCode?: string | null;
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
   * WITHOUT a stat call.
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

export interface ChunkEntry {
  name: string;
  code: string;
}

export interface MonolithicBundleParts {
  componentLines: string[];
  hydratorLines: string[];
  aliasLines: string[];
  hydratorAliasLines: string[];
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

// ────────────────────────────────────────────────────────────────────────────
// Server rendering
// ────────────────────────────────────────────────────────────────────────────

export interface RenderPageResult {
  body: string;
  head: string;
  props: Record<string, unknown>;
}

export interface SSGResult {
  html: string;
  body: string;
  head: string;
  props: string;
  clientCode: string;
  static: boolean;
  staticLists: boolean;
}

export interface DataScriptPayload {
  props?: Record<string, unknown>;
  ssrData?: Record<string, unknown>;
}

/**
 * When provided, hydration data (serialized props + useFetch SSR data) is
 * served as an external classic script (`<script src="...">`) instead of an
 * inline `<script>globalThis.__vsk_ssr_data = ...</script>`. Inline data
 * scripts are blocked by strict Content-Security-Policy headers
 * (`script-src 'self'` without `'unsafe-inline'`), so servers must deliver
 * the payload through an origin-served file. The callback stores the payload
 * server-side and returns the script src URL (or null to fall back to inline).
 */
export type ExternalDataScript = (payload: DataScriptPayload) => string | null;

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renderable component content. Text values, arrays of them (what `{list.map(...)}`
 * produces), or nothing — this is the type of `children` and of any JSX-expression
 * container's value.
 */
export type Component = string | number | boolean | null | undefined | Component[];

/**
 * Props shape for layouts: they receive their child tree as `children`.
 */
export interface LayoutProps {
	children?: Component;
}

// ────────────────────────────────────────────────────────────────────────────
// Requests & responses (structural shapes — @vesk/runtime provides classes)
// ────────────────────────────────────────────────────────────────────────────

export interface CookieStore {
  get(name: string): string | undefined;
  getAll(): Array<{ name: string; value: string }>;
  toString(): string;
  [name: string]: unknown;
}

export interface ServerRequest extends Request {
  cookies: CookieStore | Record<string, string>;
  params: Record<string, string>;
  locals: Record<string, unknown>;
}

export interface VeskRequest extends ServerRequest {
  readonly query: Record<string, string>;
  ip: string;
  protocol: string;
  hostname: string;
  parsedUrl: URL;
  getBody(): Promise<unknown>;
}

export interface SetCookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  domain?: string;
}

export interface VeskResponse extends Response {
  setStatus(code: number): VeskResponse;
  build(): VeskResponse;
  setCookie(name: string, value: string, opts?: SetCookieOptions): VeskResponse;
  clearCookie(name: string, opts?: { path?: string; domain?: string }): VeskResponse;
  setCsp(policy: string | false): VeskResponse;
  setSecurityHeader(name: string, value: string | false): VeskResponse;
  cache(ttlSeconds: number): VeskResponse;
  noCache(): VeskResponse;
  cors(opts?: { origin?: string; methods?: string; headers?: string; credentials?: boolean }): VeskResponse;
}
