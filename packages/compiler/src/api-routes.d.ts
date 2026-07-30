import type { ApiRouteNode } from './types.js';
export declare function scanApiRoutes(apiDir: string): ApiRouteNode[];
export declare function matchApiUrl(tree: ApiRouteNode[], pathname: string): {
    node: ApiRouteNode;
    params: Record<string, string>;
} | null;
export declare function parseCookies(str: string): Record<string, string>;
export interface DevCache extends Map<string, number> {
}
export declare function executeApiRoute(filePath: string, method: string, request: Request, params?: Record<string, string>, locals?: Record<string, unknown>, devCache?: DevCache): Promise<Response | null>;
//# sourceMappingURL=api-routes.d.ts.map