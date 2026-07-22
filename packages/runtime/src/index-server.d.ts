export class Context<T> {
  constructor(defaultValue: T);
  get(): T;
  set(value: T): void;
}
export function createContext<T>(defaultValue: T): Context<T>;
export function getActiveComponent(): any;
export function setActiveComponent(component: any): void;

export function track<T>(initialValue: T): { get(): T; set(v: T): void; peek(): T };
export function effect(fn: () => void): { destroy(): void };
export function batch<T>(fn: () => T): T;
export function derived<T>(fn: () => T): { get(): T; peek(): T };

export function createResource<T>(fetcher: () => Promise<T>): { (): T; loading: boolean; error: any };

export interface Router {
  start(): void;
  navigate(path: string, opts?: { replace?: boolean }): void;
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  refresh(): void;
}
export function createRouter(routes: any[], options?: any): Router;
export function createFileRouter(routeTree: any[], options?: { middleware?: any }): Router;
export function Outlet(props: { children?: any }): any;
export function Link(props: { href: string; children?: any; class?: string }): any;
export function NavLink(props: { href: string; children?: any; class?: string; activeClass?: string }): any;
export function useNavigate(): (path: string) => void;
export function useParams(): Record<string, string>;
export function usePathname(): string;
export function useSearchParams(): [URLSearchParams, (params: Record<string, string>) => void];
export function useRouter(): Router;
export function buildRouteTree(routes: any[]): any[];
export function defineRoute(pattern: string, component: any, options?: any): any;
export function Redirect(props: { to: string }): any;
export function redirect(path: string): void;
export function permanentRedirect(path: string): void;
export function notFound(): void;
export class Redirect extends Error { url: string; status: number; name: 'Redirect' }
export class NotFoundError extends Error { name: 'NotFoundError' }

export interface CookieStore {
  get(name: string): string | undefined;
  getAll(): { name: string; value: string }[];
  toString(): string;
  [key: string]: string | undefined;
}
export interface HeaderStore {
  get(name: string): string | null;
  has(name: string): boolean;
  entries(): IterableIterator<[string, string]>;
  [key: string]: string | undefined | ((name: string) => any);
}
export function cookies(): CookieStore;
export function headers(): HeaderStore;

/** Mutable per-request context shared between middleware and page/API handlers */
export function locals(): Record<string, any>;
