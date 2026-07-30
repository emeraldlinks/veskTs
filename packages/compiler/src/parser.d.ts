import * as acorn from 'acorn';
import type { Program } from 'estree';
export interface ParseOptions {
    filename?: string;
    [key: string]: unknown;
}
export declare function createBaseParser(): typeof acorn.Parser;
export declare function parse(source: string, options?: ParseOptions): Program;
//# sourceMappingURL=parser.d.ts.map