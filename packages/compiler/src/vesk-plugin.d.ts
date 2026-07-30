import * as acorn from 'acorn';
declare module 'acorn' {
    interface Parser {
        pos: number;
        start: number;
        end: number;
        type: any;
        value: any;
        exprAllowed: boolean;
        inType: boolean;
        curContext(): any;
        readToken(code: number): any;
        isLet(context: any): boolean;
        parseBindingAtom(): any;
        parseExpression(noIn: boolean, refDestructuringErrors: any): any;
        parseStatement(context: any, ...args: any[]): any;
        parseBlock(createNewLexicalScope?: boolean, node?: any, exitStrict?: boolean): any;
        startNode(): any;
        finishNode(node: any, type: string): any;
        expect(token: any): void;
        enterScope(flags: number): void;
        exitScope(): void;
        semicolon(): void;
        raise(pos: number, message: string): void;
        next(): void;
        eat(token: any): boolean;
        jsx_parseElementAt(startPos: number, startLoc?: any): any;
        jsx_parseElement(): any;
        jsx_parseExpressionContainer(): any;
        jsx_parseClosingElementAt(pos: number, loc: any): any;
        jsx_parseElementName(): any;
        parseIdent(allowBinding?: boolean): any;
        parseFunctionParams(node: any): void;
        parseExprAtom(): any;
        isContextual(name: string): boolean;
        startLoc: any;
        endLoc: any;
        lastTokEnd: number;
        lastTokStart: number;
        lastTokEndLoc: any;
        lastTokStartLoc: any;
        curLine: number;
        lineStart: number;
        startNodeAt(pos: number, loc?: any): any;
        checkUnreserved(ref: any): any;
    }
}
export interface VeskPluginConfig {
    [key: string]: unknown;
}
export declare function VeskParserPlugin(config?: VeskPluginConfig): (Parser: typeof acorn.Parser) => typeof acorn.Parser;
//# sourceMappingURL=vesk-plugin.d.ts.map