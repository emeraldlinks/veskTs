import type { Node as ESTreeNode } from 'estree';
export declare class Expression {
    raw: string;
    ast: ESTreeNode | null;
    source: string | null;
    deps: string[];
    constructor(raw: string, deps?: string[], ast?: ESTreeNode | null, source?: string | null);
}
export declare class IRRoot {
    components: ComponentIR[];
    imports: string[];
    importedNames: Set<string>;
    staticProps: string | null;
    loadFn: string | null;
    topLevelCode: string[];
    constructor(components: ComponentIR[], imports?: string[], importedNames?: Set<string>, staticProps?: string | null, loadFn?: string | null, topLevelCode?: string[]);
}
export declare class ComponentIR {
    name: string;
    paramNames: string[];
    isClient: boolean;
    isAsync: boolean;
    mode: 'expression' | 'statement';
    body: IRNode[];
    style: string | null;
    exported: boolean;
    defaultExport: boolean;
    constructor(name: string, paramNames: string[], body: IRNode[], opts?: {
        isClient?: boolean;
        isAsync?: boolean;
        mode?: 'expression' | 'statement';
        exported?: boolean;
        defaultExport?: boolean;
    });
}
export declare class StaticNode {
    tag: string;
    attributes: {
        name: string;
        value: string;
    }[];
    children: IRNode[];
    selfClosing: boolean;
    keyExpr: Expression | null;
    constructor(tag: string, attributes: {
        name: string;
        value: string;
    }[], children: IRNode[], keyExpr?: Expression | null);
}
export declare class TextNode {
    value: string;
    constructor(value: string);
}
export declare class DynamicBinding {
    kind: 'text' | 'attribute';
    target: string | null;
    expression: Expression;
    constructor(expression: Expression, kind?: 'text' | 'attribute', target?: string | null);
}
export declare class OpaqueDynamicRegion {
    condition: Expression;
    consequentNodes: IRNode[];
    alternateNodes: IRNode[];
    constructor(condition: Expression, consequentNodes: IRNode[], alternateNodes?: IRNode[]);
}
export declare class MapRegion {
    expression: Expression;
    itemVariable: string;
    bodyTemplate: IRNode[];
    keyExpr: Expression | null;
    constructor(expression: Expression, itemVariable: string, bodyTemplate: IRNode[], keyExpr?: Expression | null);
}
export declare class ComponentRef {
    componentName: string;
    constructor(componentName: string);
}
export declare class ComponentCall {
    componentName: string;
    props: {
        name: string;
        value: Expression;
    }[];
    spreadProps: Expression[];
    children: IRNode[];
    constructor(componentName: string, props: {
        name: string;
        value: Expression;
    }[], children?: IRNode[], spreadProps?: Expression[]);
}
export declare class SlotNode {
    constructor();
}
export declare class WhileLoop {
    condition: Expression;
    bodyTemplate: IRNode[];
    isDoWhile: boolean;
    constructor(condition: Expression, bodyTemplate: IRNode[], isDoWhile?: boolean);
}
export declare class SwitchCase {
    body: IRNode[];
    constructor(body: IRNode[]);
}
export declare class SwitchBlock {
    discriminant: Expression;
    cases: Array<{
        test: Expression | null;
        body: IRNode[];
    }>;
    constructor(discriminant: Expression, cases: Array<{
        test: Expression | null;
        body: IRNode[];
    }>);
}
export declare class TryCatch {
    bodyTemplate: IRNode[];
    catchBody: IRNode[];
    catchParamName: string | null;
    constructor(bodyTemplate: IRNode[], catchBody: IRNode[], catchParamName?: string | null);
}
export declare class TrackDecl {
    name: string;
    rawName: string | null;
    init: string;
    constructor(name: string, init: string, rawName: string | null);
}
export declare class RuntimeStatement {
    raw: string;
    ast: ESTreeNode | null;
    source: string | null;
    constructor(raw: string, ast?: ESTreeNode | null, source?: string | null);
}
export declare class ForLoop {
    init: string;
    condition: Expression;
    update: string;
    bodyTemplate: IRNode[];
    kind: 'for' | 'for-in';
    constructor(init: string, condition: Expression, update: string, bodyTemplate: IRNode[], kind?: 'for' | 'for-in');
}
export declare class ServerBlock {
    children: IRNode[];
    constructor(children: IRNode[]);
}
export declare class ClientBlock {
    children: IRNode[];
    constructor(children: IRNode[]);
}
export declare class HeadBlock {
    children: IRNode[];
    constructor(children: IRNode[]);
}
export type IRNode = StaticNode | TextNode | DynamicBinding | OpaqueDynamicRegion | MapRegion | WhileLoop | SwitchBlock | TryCatch | ForLoop | TrackDecl | RuntimeStatement | ComponentRef | ComponentCall | ServerBlock | ClientBlock | HeadBlock | SlotNode;
//# sourceMappingURL=ir.d.ts.map