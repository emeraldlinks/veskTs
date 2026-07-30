import type { RouteNode } from './types.js';
import type { MiddlewareChainOptions } from './types.js';
export interface MiddlewareEntry {
    sourcePath: string;
    node: RouteNode;
}
export declare function collectMiddlewareChain(routeTree: RouteNode[], url: string, appDir: string): MiddlewareEntry[];
export declare function loadMiddleware(sourcePath: string): Promise<((ctx: any, next: any) => any) | null>;
export declare function executeMiddlewareChain(chain: MiddlewareEntry[], request: Request, params: Record<string, string>, options?: MiddlewareChainOptions): Promise<{
    response: Response | null;
    redirected: boolean;
    locals: Record<string, unknown>;
    rewriteUrl: string | null;
}>;
//# sourceMappingURL=middleware.d.ts.map