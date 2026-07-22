export class Cell<T = any> {
  constructor(initialValue: T);
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
}

export function track<T>(value: T | (() => T)): Cell<T>;
export function effect(fn: () => void): () => void;
export function batch(fn: () => void): void;
export function derived<T>(fn: () => T): Cell<T>;

export function hydrate(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function hydrateViewport(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function hydrateIdle(container: HTMLElement, component: (props: Record<string, any>) => HTMLElement, props?: Record<string, any>): void;
export function needsHydration(el: Element): boolean;
export function hydrationCount(container: HTMLElement): number;
export function createHydrateWalker(container: HTMLElement): { nextElement: () => Element | null; subWalker: () => any };

export function bindValue(cell: Cell<string>): { value: string; onInput: (e: Event) => void };
export function bindChecked(cell: Cell<boolean>): { checked: boolean; onChange: (e: Event) => void };
export function bindGroup(cell: Cell<string>): { value: string; onChange: (e: Event) => void };

export class Context<T> {
  constructor(defaultValue: T);
  get(): T;
  set(value: T): void;
}
export function createContext<T>(defaultValue: T): Context<T>;
export function getActiveComponent(): any;
export function setActiveComponent(component: any): void;

export function createResource<T>(fetcher: () => Promise<T>): { (): T; loading: boolean; error: any };

export function reconcile<T>(parent: HTMLElement, items: T[], keyFn: (item: T) => any, renderFn: (item: T, index: number) => HTMLElement): void;

export interface Router {
  start(): void;
  navigate(path: string): void;
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
export function buildRouteTree(routes: any[]): any[];
export function defineRoute(pattern: string, component: any, options?: any): any;
export function Redirect(props: { to: string }): any;
export function redirect(path: string): void;
