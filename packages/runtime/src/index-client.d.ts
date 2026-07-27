/** @vesk/runtime — Client-side entry point types */

// ── Component type ───────────────────────────────────────────
export type Component<T = Record<string, unknown>> = (props: T) => Node | DocumentFragment | string | null | undefined;

// ── Reactivity primitives ──────────────────────────────────────

export class Cell<T = any> {
  constructor(initialValue: T);
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
}

export function track<T>(value: T | (() => T)): Cell<T>;
export function get<T>(cell: Cell<T>): T;
export function set<T>(cell: Cell<T>, value: T): void;
export function untrack<T>(fn: () => T): T;
export function peek<T>(cell: Cell<T>): T;
export function derived<T>(fn: () => T): Cell<T>;
export function flushSync(): void;
export function tick(): Promise<void>;
export function schedule_update(): void;
export function queue_microtask(fn: () => void): void;
export function active_block(): any;
export function set_active_block(block: any): void;
export function set_active_component(c: any): void;
export function is_mutating_allowed(): boolean;
export function tracking(): boolean;
export function teardown(): void;
export function run_block(block: any): void;
export function run_teardown(fn: () => void): void;
export function create_component_ctx(): any;
export function push_component(ctx: any): void;
export function pop_component(): any;
export function with_block<T>(block: any, fn: () => T): T;
export function with_scope<T>(fn: () => T): T;
export function scope<T>(fn: () => T): T;
export function safe_scope<T>(fn: () => T): T;
export function set_tracking(v: boolean): void;
export function set_active_reaction(r: any): void;
export function is_block_dirty(block: any): boolean;
export function destroy_non_branch_children(block: any): void;
export function disable_scoped_flush(): void;

// ── Block primitives ───────────────────────────────────────────

export function effect(fn: () => void): () => void;
export function user_effect(fn: () => void): () => void;
export function block(fn: () => void): any;
export function branch(fn: () => void): any;
export function root<T>(fn: () => T): T;
export function render(fn: () => void): any;
export function pre_effect(fn: () => void): () => void;
export function destroy_block(block: any): void;
export function destroy_block_children(block: any): void;
export function pause_block(block: any): void;
export function resume_block(block: any): void;
export function is_destroyed(block: any): boolean;
export function unlink_block(block: any): void;
export function create_try_block(fn: () => void): any;
export function boundary_fn_running_block(): boolean;
export function batch<T>(fn: () => T): T;

// ── Hydration ──────────────────────────────────────────────────

export function hydrate(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function hydrateViewport(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function hydrateIdle(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function hydrateOnInteraction(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>, options?: { events?: string[] }): { cancel: () => void; hydrateNow: () => void };
export function needsHydration(el: Element): boolean;
export function hydrationCount(container: HTMLElement): number;
export function createHydrateWalker(container: HTMLElement): any;
export function collectVskMarkers(container: HTMLElement): number;
export function reactiveProps(props: Record<string, any>): Record<string, any>;

// ── Bindings ──────────────────────────────────────────────────

export function bindValue(cell: Cell<string>): { value: string; onInput: (e: Event) => void };
export function bindChecked(cell: Cell<boolean>): { checked: boolean; onChange: (e: Event) => void };
export function bindGroup(cell: Cell<string>): { value: string; onChange: (e: Event) => void };

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
export function clearSsrData(key: string): void;
export function resolveSsrResources(): Promise<void>;
export function useFetch(url: string, options?: RequestInit): { data: any; loading: boolean; error: any };

// ── Portal ─────────────────────────────────────────────────────

export function Portal(props: { to: string; children: any }): any;

// ── Reconcile ──────────────────────────────────────────────────

export function reconcile<T>(parent: HTMLElement, items: T[], keyFn: (item: T) => any, renderFn: (item: T, index: number) => HTMLElement): void;

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

// ── VeskRequest / VeskResponse — type-only — use @vesk/runtime/server for the full classes ──

export type VeskRequest = Request & {
  cookies: Record<string, string>;
  locals: Record<string, any>;
  params: Record<string, string>;
  query: Record<string, string>;
  ip: string;
  protocol: string;
  hostname: string;
};
export type VeskResponse = Response;

