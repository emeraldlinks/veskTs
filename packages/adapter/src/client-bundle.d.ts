import type { RouteNode, ClientBundleOptions, ClientBundleResult } from './types.js';
export declare function generateClientBundle(routeTree: RouteNode[], appDir: string, componentMap?: Map<string, string>, options?: ClientBundleOptions): Promise<ClientBundleResult>;
export declare function buildRuntimeCode(runtimeDir: string): string;
//# sourceMappingURL=client-bundle.d.ts.map