/** @vesk/runtime — Server-side entry point types */

// ── Middleware Context ─────────────────────────────────────────
export interface Context {
  request: Request;
  params: Record<string, string>;
  url: URL;
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T;
}

// ── Component type ───────────────────────────────────────────
export type Component<T = Record<string, unknown>> = (props: T) => string;

// ── Reactivity primitives ──────────────────────────────────────

export function track<T>(value: T | (() => T)): { get(): T; set(v: T): void; peek(): T };
export function get<T>(cell: { get(): T }): T;
export function set<T>(cell: { set(v: T): void }, value: T): void;
export function untrack<T>(fn: () => T): T;
export function peek<T>(cell: { peek(): T }): T;
export function derived<T>(fn: () => T): { get(): T; peek(): T };
export function flushSync(): void;
export function tick(): Promise<void>;
export function active_block(): any;
export function set_active_block(block: any): void;
export function set_active_component(c: any): void;
export function create_component_ctx(): any;
export function push_component(ctx: any): void;
export function pop_component(): any;
export function with_block<T>(block: any, fn: () => T): T;
export function with_scope<T>(fn: () => T): T;
export function scope<T>(fn: () => T): T;
export function safe_scope<T>(fn: () => T): T;

// ── Block primitives ───────────────────────────────────────────

export function effect(fn: () => void): { destroy(): void };
export function user_effect(fn: () => void): { destroy(): void };
export function block(fn: () => void): any;
export function branch(fn: () => void): any;
export function root<T>(fn: () => T): T;
export function render(fn: () => void): any;
export function pre_effect(fn: () => void): { destroy(): void };
export function destroy_block(block: any): void;
export function destroy_block_children(block: any): void;
export function pause_block(block: any): void;
export function resume_block(block: any): void;
export function is_destroyed(block: any): boolean;
export function unlink_block(block: any): void;
export function create_try_block(fn: () => void): any;
export function boundary_fn_running_block(): boolean;
export function batch<T>(fn: () => T): T;

// ── Context ────────────────────────────────────────────────────

export class Context<T> {
  constructor(defaultValue: T);
  get(): T;
  set(value: T): void;
}
export function createContext<T>(defaultValue: T): Context<T>;
export function getActiveComponent(): any;
export function setActiveComponent(component: any): void;

// ── Resources ──────────────────────────────────────────────────

export function createResource<T>(fetcher: () => Promise<T>): { (): T; loading: boolean; error: any };
export function setSsrData(key: string, data: any): void;
export function resolveSsrResources(): Promise<void>;
export function useFetch(url: string, options?: RequestInit): { data: any; loading: boolean; error: any };

// ── Portal ─────────────────────────────────────────────────────

export function Portal(props: { to: string; children: any }): any;

// ── Router ─────────────────────────────────────────────────────

export interface Router {
  start(): void;
  navigate(path: string, opts?: { replace?: boolean }): void;
  prefetch(path: string): void;
  get currentPath(): string;
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  refresh(): void;
}
export function createRouter(routes: any[], options?: { container?: HTMLElement; prefetch?: boolean; hydrate?: 'full' | 'viewport' | 'idle' | 'interaction' }): Router;
export function createFileRouter(routeTree: any[], options?: { container?: HTMLElement; middleware?: any; prefetch?: boolean; hydrate?: 'full' | 'viewport' | 'idle' | 'interaction' }): Router;
export function Outlet(props: { children?: any }): any;
export function Link(props: { href: string; children?: any; class?: string; style?: string; target?: string; rel?: string }): any;
export function NavLink(props: { href: string; children?: any; class?: string; style?: string; target?: string; rel?: string; activeClass?: string; ariaCurrent?: boolean | string }): any;
export function useNavigate(): (path: string, opts?: { replace?: boolean }) => void;
export function useParams(): Record<string, string>;
export function usePathname(): string;
export function useSearchParams(): [URLSearchParams, (params: Record<string, string> | string) => void];
export function useRouter(): Router;
export function buildRouteTree(routes: any[]): any[];
export function defineRoute(pattern: string, config: any): any;

// ── VeskRequest / VeskResponse — enhanced request/response for API routes ──

export class VeskRequest extends ServerRequest {
  query: Record<string, string>;
  ip: string;
  protocol: string;
  hostname: string;
  body: Promise<Record<string, any> | string>;
}

export class VeskResponse extends ServerResponse {
  setCookie(name: string, value: string, opts?: {
    maxAge?: number; httpOnly?: boolean; secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None'; path?: string; domain?: string;
  }): VeskResponse;
  clearCookie(name: string, opts?: { path?: string; domain?: string }): VeskResponse;
  setCsp(policy: string | false): VeskResponse;
  setSecurityHeader(name: string, value: string | false): VeskResponse;
  cache(ttlSeconds: number): VeskResponse;
  noCache(): VeskResponse;
  cors(opts?: { origin?: string; methods?: string; headers?: string; credentials?: boolean }): VeskResponse;
  static html(html: string, init?: ResponseInit): VeskResponse;
}

export function applyRequestSecurity(request: VeskRequest, response: VeskResponse): void;

// ── Navigation errors ──────────────────────────────────────────

export class Redirect extends Error {
  url: string;
  status: number;
  name: 'Redirect';
}
export function redirect(url: string, status?: number): never;
export function permanentRedirect(url: string): never;
export class NotFoundError extends Error {
  name: 'NotFoundError';
}
export function notFound(): never;

// ── Server request/response ────────────────────────────────────

export interface CookieStore {
  get(name: string): string | undefined;
  getAll(): { name: string; value: string }[];
  toString(): string;
  [key: string]: string | undefined;
}
export function cookies(): CookieStore;

export interface HeaderStore {
  get(name: string): string | null;
  has(name: string): boolean;
  entries(): IterableIterator<[string, string]>;
  [key: string]: string | undefined | ((name: string) => any);
}
export function headers(): HeaderStore;
export function locals(): Record<string, any>;

export class ServerResponse {
  constructor(init?: ResponseInit);
  status: number;
  headers: Headers;
  body: any;
  json(data: any): void;
  text(data: string): void;
  redirect(url: string, status?: number): void;
}
export class ServerRequest {
  constructor(request: Request);
  url: string;
  method: string;
  headers: Headers;
  params: Record<string, string>;
  cookies: CookieStore;
  json(): Promise<any>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}

export function useBody(): Promise<any>;
export function useParams(): Record<string, string>;
export function useRequest(): ServerRequest;
export function withValidation(schema: any, handler: (data: any) => any): (data: any) => any;
export function cors(options?: { origin?: string; methods?: string; credentials?: boolean }): (req: Request) => Response | null;

// ── Hooks ──────────────────────────────────────────────────────

export function defineHook(name: string, fn: (...args: any[]) => any): void;
export function removeHook(name: string): void;
export function runHooks(name: string, ...args: any[]): Promise<any[]>;
export function webhook(name: string, handler: (payload: any) => any): void;

// ── ISR ────────────────────────────────────────────────────────

export function isr(config: { ttl?: number; tags?: string[] }): any;
export function revalidatePath(path: string): Promise<void>;
export function revalidateTag(tag: string): Promise<void>;
export function clearIsrCache(): void;
export function pageIsr(config: { ttl?: number; tags?: string[] }): any;
export function componentIsr(config: { ttl?: number; tags?: string[] }): any;
export function revalidateComponent(name: string): Promise<void>;
export function isrConfigToRevalidate(config: any): boolean;

// ── SEO ────────────────────────────────────────────────────────

export function JsonLd(props: { data: Record<string, any> }): any;
export function ArticleSchema(props: { headline: string; datePublished: string; author: string; image?: string; description?: string }): any;
export function ProductSchema(props: { name: string; description?: string; image?: string; price?: string; currency?: string }): any;
export function FAQPageSchema(props: { questions: { question: string; answer: string }[] }): any;
export function BreadcrumbListSchema(props: { items: { name: string; url: string }[] }): any;
export function OrganizationSchema(props: { name: string; url?: string; logo?: string }): any;
export function LocalBusinessSchema(props: { name: string; address: string; phone?: string; image?: string }): any;
export function VideoSchema(props: { name: string; description?: string; thumbnailUrl?: string; uploadDate?: string }): any;

// ── Image ──────────────────────────────────────────────────────

export function Image(props: { src: string; alt: string; width?: number; height?: number; class?: string; loading?: 'lazy' | 'eager'; sizes?: string; priority?: boolean }): any;

// ── Experiment (A/B testing) ───────────────────────────────────

export function Experiment(props: { name: string; variants: Record<string, any>; fallback?: any }): any;

// ── Form ───────────────────────────────────────────────────────

export function Form(props: { action?: string; method?: string; onSubmit?: (data: Record<string, any>) => void; children?: any; class?: string; validation?: 'blur' | 'submit' }): any;
export function Field(props: { name: string; label?: string; type?: string; validate?: ((value: any) => string | null)[]; children?: any; class?: string }): any;
export function required(msg?: string): (value: any) => string | null;
export function email(msg?: string): (value: any) => string | null;
export function minLength(len: number, msg?: string): (value: any) => string | null;
export function maxLength(len: number, msg?: string): (value: any) => string | null;
export function pattern(regex: RegExp, msg?: string): (value: any) => string | null;
export function custom(fn: (value: any) => string | null): (value: any) => string | null;
