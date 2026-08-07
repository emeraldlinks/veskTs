import type { IRRoot, ComponentIR, IRNode } from '@vesk/compiler/src/ir';

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
}

export interface ApiRouteNode {
  path: string;
  fullPath: string;
  isDynamic: boolean;
  isCatchAll: boolean;
  filePath: string | null;
  children: ApiRouteNode[];
}

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

export interface VeskPlugin {
  name: string;
  provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
  onRequest?: (ctx: MiddlewareContext) => void | Promise<void>;
  onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
  onFileWatch?: (filePath: string) => { handled: boolean } | Promise<{ handled: boolean }>;
  onTransformJS?: (code: string, filePath: string) => string | null | Promise<string | null>;
  onBuildStart?: () => void | Promise<void>;
  onBuildEnd?: () => void | Promise<void>;
}

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
}

export interface VeskConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string;
  ssg?: { getStaticPaths?: () => Promise<{ paths: Array<{ params: Record<string, string> }> }> };
  plugins?: VeskPlugin[];
  security?: VeskSecurity | VeskSecurityPreset | false | ((preset: (name: string, overrides?: VeskSecurity) => VeskSecurity) => VeskSecurity);
}

export interface MiddlewareEntry {
  sourcePath: string;
  node: RouteNode;
}

export interface MiddlewareChainOptions {
  onLast?: (rewriteUrl: string | null) => Response | Promise<Response>;
  plugins?: VeskPlugin[];
}

export interface CompileFileResult {
  ir: IRRoot;
  componentMap: Map<string, Function>;
  __vesk: Record<string, unknown>;
}

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

export interface FullPageOptions {
  cssUrl?: string;
  cssUrls?: string[];
  clientScriptUrl?: string;
  pageHead?: string;
  security?: VeskSecurity;
  __vesk?: Record<string, unknown>;
  hydrate?: boolean;
  sourcePath?: string;
  externalDataScript?: ExternalDataScript;
}

export const VESK_BUILTINS = [
  'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams',
  'useNavigate', 'useHead', 'useTitle',
  'Form', 'Field', 'Link', 'NavLink', 'Outlet',
  'Image', 'Portal',
  'Experiment',
  'defineAction',
  'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom',
  'track', 'get', 'set', 'derived', 'effect', 'batch', 'untrack',
  'cookies', 'headers', 'locals',
  'VeskResponse', 'VeskRequest', 'ServerRequest', 'ServerResponse',
  'redirect', 'permanentRedirect', 'notFound',
] as const;

export type VeskBuiltin = typeof VESK_BUILTINS[number];
