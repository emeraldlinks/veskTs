import type { IRNode, ComponentIR, IRRoot } from './ir.js';
export declare function irNodeToJS(node: IRNode, importedNames?: Set<string> | null, isAsync?: boolean): string;
export declare function generateFunctionBody(comp: ComponentIR, importedNames: Set<string>): string;
export declare function buildComponentMap(irRoot: IRRoot, useSharedScope: boolean): Map<string, Function>;
//# sourceMappingURL=server-jsgen.d.ts.map