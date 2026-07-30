import type { IRNode } from './ir.js';
declare function isStaticIR(body: IRNode[]): boolean;
export declare function escapeHtml(str: string): string;
export declare function compileClient(source: string, _componentName: string | null, options?: {
    forceClient?: boolean;
    hydrate?: boolean;
}): string;
export { compileClient as compile, isStaticIR };
//# sourceMappingURL=client-codegen.d.ts.map