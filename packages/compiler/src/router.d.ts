import type { RouteNode } from './types.js';
export interface ScanOptions {
    layoutCompName?: string;
    pageCompName?: string;
    compName?: string;
}
export interface MatchResult {
    nodes: RouteNode[];
    params: Record<string, string>;
}
export declare function extractMiddleware(sourcePath: string): string | null;
export declare function scanRoutes(appDir: string, options?: ScanOptions): RouteNode[];
export declare function scanComponents(componentsDir: string): Map<string, string>;
export declare function collectSources(tree: RouteNode[]): Map<string, string>;
export interface RouteManifestOptions {
    importPrefix?: string;
}
export declare function generateRouteManifest(tree: RouteNode[], options?: RouteManifestOptions): string;
export declare function matchUrl(tree: RouteNode[], pathname: string): MatchResult | null;
//# sourceMappingURL=router.d.ts.map