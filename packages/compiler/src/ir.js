export class Expression {
    raw;
    ast;
    source;
    deps;
    constructor(raw, deps = [], ast = null, source = null) {
        this.raw = raw;
        this.deps = deps;
        this.ast = ast;
        this.source = source;
    }
}
export class IRRoot {
    components;
    imports;
    importedNames;
    staticProps;
    loadFn;
    topLevelCode;
    constructor(components, imports = [], importedNames = new Set(), staticProps = null, loadFn = null, topLevelCode = []) {
        this.components = components;
        this.imports = imports;
        this.importedNames = importedNames;
        this.staticProps = staticProps;
        this.loadFn = loadFn;
        this.topLevelCode = topLevelCode;
    }
}
export class ComponentIR {
    name;
    paramNames;
    isClient;
    isAsync;
    mode;
    body;
    style;
    exported;
    defaultExport;
    constructor(name, paramNames, body, opts = {}) {
        this.name = name;
        this.paramNames = paramNames;
        this.body = body;
        this.isClient = opts.isClient ?? false;
        this.isAsync = opts.isAsync ?? false;
        this.mode = opts.mode ?? 'expression';
        this.style = null;
        this.exported = opts.exported ?? false;
        this.defaultExport = opts.defaultExport ?? false;
    }
}
export class StaticNode {
    tag;
    attributes;
    children;
    selfClosing;
    keyExpr;
    constructor(tag, attributes, children, keyExpr = null) {
        this.tag = tag;
        this.attributes = attributes;
        this.children = children;
        this.selfClosing = false;
        this.keyExpr = keyExpr;
    }
}
export class TextNode {
    value;
    constructor(value) {
        this.value = value;
    }
}
export class DynamicBinding {
    kind;
    target;
    expression;
    constructor(expression, kind = 'text', target = null) {
        this.expression = expression;
        this.kind = kind;
        this.target = target;
    }
}
export class OpaqueDynamicRegion {
    condition;
    consequentNodes;
    alternateNodes;
    constructor(condition, consequentNodes, alternateNodes = []) {
        this.condition = condition;
        this.consequentNodes = consequentNodes;
        this.alternateNodes = alternateNodes;
    }
}
export class MapRegion {
    expression;
    itemVariable;
    bodyTemplate;
    keyExpr;
    constructor(expression, itemVariable, bodyTemplate, keyExpr = null) {
        this.expression = expression;
        this.itemVariable = itemVariable;
        this.bodyTemplate = bodyTemplate;
        this.keyExpr = keyExpr;
    }
}
export class ComponentRef {
    componentName;
    constructor(componentName) {
        this.componentName = componentName;
    }
}
export class ComponentCall {
    componentName;
    props;
    spreadProps;
    children;
    constructor(componentName, props, children = [], spreadProps = []) {
        this.componentName = componentName;
        this.props = props;
        this.children = children;
        this.spreadProps = spreadProps;
    }
}
export class SlotNode {
    constructor() { }
}
export class WhileLoop {
    condition;
    bodyTemplate;
    isDoWhile;
    constructor(condition, bodyTemplate, isDoWhile = false) {
        this.condition = condition;
        this.bodyTemplate = bodyTemplate;
        this.isDoWhile = isDoWhile;
    }
}
export class SwitchCase {
    body;
    constructor(body) {
        this.body = body;
    }
}
export class SwitchBlock {
    discriminant;
    cases;
    constructor(discriminant, cases) {
        this.discriminant = discriminant;
        this.cases = cases;
    }
}
export class TryCatch {
    bodyTemplate;
    catchBody;
    catchParamName;
    constructor(bodyTemplate, catchBody, catchParamName = null) {
        this.bodyTemplate = bodyTemplate;
        this.catchBody = catchBody;
        this.catchParamName = catchParamName;
    }
}
export class TrackDecl {
    name;
    rawName;
    init;
    constructor(name, init, rawName) {
        this.name = name;
        this.init = init;
        this.rawName = rawName || null;
    }
}
export class RuntimeStatement {
    raw;
    ast;
    source;
    constructor(raw, ast = null, source = null) {
        this.raw = raw;
        this.ast = ast;
        this.source = source;
    }
}
export class ForLoop {
    init;
    condition;
    update;
    bodyTemplate;
    kind;
    constructor(init, condition, update, bodyTemplate, kind = 'for') {
        this.init = init;
        this.condition = condition;
        this.update = update;
        this.bodyTemplate = bodyTemplate;
        this.kind = kind;
    }
}
export class ServerBlock {
    children;
    constructor(children) {
        this.children = children;
    }
}
export class ClientBlock {
    children;
    constructor(children) {
        this.children = children;
    }
}
export class HeadBlock {
    children;
    constructor(children) {
        this.children = children;
    }
}
