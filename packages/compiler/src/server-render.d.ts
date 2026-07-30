import type { CompileFileResult, RenderPageResult, SSGResult, FullPageOptions } from './types.js';
export declare function compileFile(source: string): CompileFileResult;
export declare function render(source: string, componentName: string, props?: Record<string, unknown>, registry?: Map<string, Function>, options?: Record<string, unknown>): string | Promise<string>;
export declare function renderPage(source: string, componentName: string, props?: Record<string, unknown>, registry?: Map<string, Function>, options?: Record<string, unknown>): RenderPageResult | Promise<RenderPageResult>;
export declare function ssg(source: string, componentName?: string, customProps?: Record<string, unknown>, options?: {
    registry?: Map<string, Function>;
    cssUrl?: string;
    cssUrls?: string[];
    [key: string]: unknown;
}): Promise<SSGResult>;
export declare function renderFullPage(source: string, componentName: string, props?: Record<string, unknown>, registry?: Map<string, Function>, options?: FullPageOptions): Promise<string>;
export declare function renderPageStream(source: string, componentName: string, props?: Record<string, unknown>, registry?: Map<string, Function>, options?: FullPageOptions): AsyncGenerator<string>;
//# sourceMappingURL=server-render.d.ts.map