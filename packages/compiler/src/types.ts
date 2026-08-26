import type { IRRoot } from '@vesk/compiler/src/ir';

// Canonical shared types live in @vesk/types — re-exported here so existing
// `@vesk/compiler/src/types` imports keep working.
export type {
  RouteNode,
  ApiRouteNode,
  MiddlewareContext,
  VeskPlugin,
  VeskCors,
  VeskRateLimit,
  VeskSecurityPreset,
  VeskSecurity,
  VeskConfig,
  MdConfig,
  MdHtmlMode,
  MiddlewareEntry,
  MiddlewareChainOptions,
  RenderPageResult,
  SSGResult,
  DataScriptPayload,
  ExternalDataScript,
} from '@vesk/types';

export interface CompileFileResult {
  ir: IRRoot;
  componentMap: Map<string, Function>;
  __vesk: Record<string, unknown>;
}

export interface FullPageOptions {
  cssUrl?: string;
  cssUrls?: string[];
  clientScriptUrl?: string;
  pageHead?: string;
  security?: import('@vesk/types').VeskSecurity;
  __vesk?: Record<string, unknown>;
  hydrate?: boolean;
  sourcePath?: string;
  externalDataScript?: import('@vesk/types').ExternalDataScript;
  cached?: CompileFileResult;
}

export const VESK_BUILTINS = [
  'useFetch', 'useRouter', 'useParams', 'usePathname', 'useSearchParams',
  'useNavigate', 'useHead', 'useTitle',
  'Form', 'Field', 'Link', 'NavLink', 'Outlet',
  'Image', 'Portal',
  'Experiment',
  'LoadingIndicator', 'useLoadingIndicator',
  'defineAction',
  'required', 'email', 'minLength', 'maxLength', 'pattern', 'custom',
  'track', 'get', 'set', 'derived', 'effect', 'batch', 'untrack',
  'cookies', 'headers', 'locals',
  'VeskResponse', 'VeskRequest', 'ServerRequest', 'ServerResponse',
  'redirect', 'permanentRedirect', 'notFound',
] as const;

export type VeskBuiltin = typeof VESK_BUILTINS[number];
