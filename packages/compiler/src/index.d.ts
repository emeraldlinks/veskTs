/** @vesk/compiler — Compiler API types */

export type Component<T = Record<string, unknown>> = (props: T) => string;

export function parse(source: string, options?: { mode?: 'expression' | 'statement' }): any;
export function createBaseParser(): any;
export function generateIR(ast: any, source: string): any;

export function render(source: string, componentName: string, props?: Record<string, any>, registry?: Map<string, any>, options?: { hydrate?: boolean }): string | Promise<string>;

export function compileClient(source: string, componentName?: string | null, options?: { forceClient?: boolean; hydrate?: boolean }): string;
export const compile: typeof compileClient;

// ── Config ─────────────────────────────────────────────────────

export interface VeskPlugin {
  name: string;
  onCSS?: (content: string, filePath: string) => Promise<string | null> | string | null;
  onFileWatch?: (filePath: string) => Promise<{ handled: boolean }> | { handled: boolean };
  onTransformJS?: (code: string, filePath: string) => Promise<string | null> | string | null;
  onBuildStart?: () => Promise<void> | void;
  onBuildEnd?: () => Promise<void> | void;
}

export interface VeskConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string;
  ssg?: {
    getStaticPaths?: () => Promise<{ paths: { params: Record<string, string> }[] }>;
  };
  plugins?: VeskPlugin[];
}

export function defineConfig(config: VeskConfig): VeskConfig;
export function validateConfig(config: VeskConfig): VeskConfig;

// ── Router / file scanning ─────────────────────────────────────

export function scanRoutes(appDir: string, options?: { layoutCompName?: string; pageCompName?: string }): any[];
export function scanComponents(componentsDir: string): Map<string, string>;
export function collectSources(tree: any[]): Map<string, string>;
export function matchUrl(tree: any[], pathname: string): { nodes: any[]; params: Record<string, string> } | null;

// ── IR classes ─────────────────────────────────────────────────

export class IRRoot { constructor(body: any[], source: string, options?: any); }
export class ComponentIR { constructor(name: string, params: any[], body: any[], options?: any); }
export class StaticNode { constructor(tag: string, attrs: Record<string, any>, children: any[], options?: any); }
export class TextNode { constructor(value: string); }
export class DynamicBinding { constructor(expression: any); }
export class OpaqueDynamicRegion { constructor(body: any[], options?: any); }
export class MapRegion { constructor(expression: any, body: any[], keyExpr?: any); }
export class ComponentCall { constructor(name: string, attrs: Record<string, any>, children?: any[]); }
export class Expression { constructor(ast: any, raw: string); }

// ── VeskPlugin (acorn parser plugin) ───────────────────────────

export const VeskPlugin: any;
