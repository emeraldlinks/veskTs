import type { IRNode } from './ir.js';
export declare let __vskHydrate: boolean;
export declare let __vskId: number;
export declare let __vskImportedNames: Set<string> | null;
export declare function resetVskState(hydrate?: boolean): void;
export declare function setVskImportedNames(names: Set<string> | null): void;
export declare function prettifyHtml(html: string): string;
export declare function isStatic(body: IRNode[]): boolean;
export declare function escapeHtml(str: string): string;
export declare function redactLog(str: string): string;
export declare function setRedactLogging(enabled: boolean): void;
export declare function raw(value: unknown): string;
export declare function csrfToken(sessionId?: string, host?: string): string;
export declare function verifyCsrfToken(token: string, host?: string): boolean;
export declare function csrfGuard(request: Record<string, unknown>, host?: string): void;
export declare function signCookie(name: string, value: string, host?: string): Promise<string>;
export declare function unsignCookie(name: string, signedValue: string, host?: string): Promise<string | null>;
export interface CookieOptions {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    path?: string;
    maxAge?: number;
    domain?: string;
}
export declare function setSignedCookie(name: string, value: string, options?: CookieOptions, host?: string): Promise<string>;
export declare function readSignedCookie(name: string, cookieString: string, host?: string): Promise<string | null>;
export interface SecurityConfig {
    security?: {
        xFrameOptions?: string | false;
        referrerPolicy?: string | false;
        hsts?: string | false;
        contentSecurityPolicy?: string | false;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export declare function securityHeaders(config?: SecurityConfig): Record<string, string>;
export interface CorsConfig {
    cors?: {
        origin: string | string[];
        methods?: string;
        headers?: string;
        credentials?: boolean;
        maxAge?: number;
    };
    [key: string]: unknown;
}
export declare function corsHeaders(security?: CorsConfig, requestOrigin?: string, host?: string): Record<string, string>;
export declare function corsPreflight(request: Record<string, unknown>, security?: CorsConfig): boolean;
export declare class CorsResponse extends Error {
    status: number;
    headers: Record<string, string>;
    constructor(headers: Record<string, string>);
}
export declare function securityComment(config?: SecurityConfig): string;
export interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    cleanupIntervalMs?: number;
}
export declare function createRateLimiter(options?: RateLimitOptions): {
    check: (key: string) => boolean;
    remaining: (key: string) => number;
    reset: (key: string) => void;
    getConfig: () => {
        windowMs: number;
        max: number;
    };
    middleware: (request: Record<string, unknown>, response?: Record<string, unknown>) => boolean;
};
export declare function getClientIp(request: Record<string, unknown> | undefined, trustProxy?: boolean | string): string;
export declare function getClientProtocol(request: Record<string, unknown> | undefined, trustProxy?: boolean | string): string;
export declare function applyTrustProxy(ctx: Record<string, unknown>, trustProxy: boolean | string): void;
export declare function exprJS(raw: string): string;
export declare function indent(code: string, level?: number): string;
export declare function tryEvalExpr(raw: string, props: Record<string, unknown>, locals?: Record<string, unknown>): unknown;
export declare function childrenToHTML(nodes: IRNode[]): string;
export declare function extractTopLevelNames(topLevelCode: string[]): string[];
export declare function extractRuntimeNames(importStrs: string[]): string[];
export declare function buildParamInit(paramNames: string[]): string;
export declare function setRuntimeModule(mod: Record<string, unknown>): void;
export declare function loadRuntimeImports(importStrs: string[]): Record<string, unknown>;
export declare function evalTopLevelCode(topLevelCode: string[], __vesk: Record<string, unknown>): void;
export declare function callStaticProps(fnSource: string): Promise<unknown>;
export declare function callLoadFunction(fnSource: string, currentProps: Record<string, unknown>, __vesk: Record<string, unknown>): Promise<unknown>;
//# sourceMappingURL=server-utils.d.ts.map