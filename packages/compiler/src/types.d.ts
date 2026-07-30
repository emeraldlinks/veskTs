import type { IRRoot } from './ir.js';
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
export interface VeskPlugin {
    name: string;
    provides?: Record<string, (() => unknown | Promise<unknown>) | unknown>;
    onRequest?: (ctx: Record<string, unknown>) => void | Promise<void>;
    onCSS?: (content: string, filePath: string) => string | null | Promise<string | null>;
    onFileWatch?: (filePath: string) => {
        handled: boolean;
    } | Promise<{
        handled: boolean;
    }>;
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
    ssg?: {
        getStaticPaths?: () => Promise<{
            paths: Array<{
                params: Record<string, string>;
            }>;
        }>;
    };
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
export interface FullPageOptions {
    cssUrl?: string;
    cssUrls?: string[];
    clientScriptUrl?: string;
    pageHead?: string;
    security?: VeskSecurity;
    __vesk?: Record<string, unknown>;
    hydrate?: boolean;
}
export declare const VESK_BUILTINS: readonly ["useFetch", "useRouter", "useParams", "usePathname", "useSearchParams", "useNavigate", "useHead", "useTitle", "Form", "Field", "Link", "NavLink", "Outlet", "Image", "Portal", "Experiment", "required", "email", "minLength", "maxLength", "pattern", "custom", "track", "get", "set", "derived", "effect", "batch", "untrack", "cookies", "headers", "locals", "VeskResponse", "VeskRequest", "ServerRequest", "ServerResponse", "redirect", "permanentRedirect", "notFound"];
export type VeskBuiltin = typeof VESK_BUILTINS[number];
//# sourceMappingURL=types.d.ts.map