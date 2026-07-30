export declare function levenshtein(a: string, b: string): number;
export declare function didYouMean(name: string, candidates: string[], maxDistance?: number): string | null;
export interface VeskErrorOptions {
    file?: string;
    line?: number;
    column?: number;
    suggestions?: string[];
    nextSteps?: string[];
    tip?: string;
    code?: string;
    [key: string]: unknown;
}
export declare class VeskError extends Error {
    name: string;
    file: string;
    line: number;
    column: number;
    suggestions: string[];
    nextSteps: string[];
    tip: string;
    code?: string;
    constructor(message: string, opts?: VeskErrorOptions);
    static notFound(name: string, candidates?: string[], context?: VeskErrorOptions): VeskError;
    static classDecl(context?: VeskErrorOptions): VeskError;
    static serverBlockInClient(compName: string, context?: VeskErrorOptions): VeskError;
    static clientBlockInServer(compName: string, context?: VeskErrorOptions): VeskError;
    static componentNotFound(name: string, available?: string[], context?: VeskErrorOptions): VeskError;
    static configError(msg: string, validOptions?: string[], context?: VeskErrorOptions): VeskError;
    toString(): string;
    toJSON(): Record<string, unknown>;
}
//# sourceMappingURL=errors.d.ts.map