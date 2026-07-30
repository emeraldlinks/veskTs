import type { ComponentIR } from './ir.js';
export declare function renderHeadHtml(comp: ComponentIR, props?: Record<string, unknown>): string;
export declare function mergeHeadHtml(pageHead: string, layoutHead: string): {
    html: string;
    conflicts: Array<{
        key: string;
        message: string;
    }>;
};
//# sourceMappingURL=server-head.d.ts.map